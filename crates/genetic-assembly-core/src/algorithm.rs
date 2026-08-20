use crate::operators::{Variation, make_child, random_genes, tournament};
use crate::sorting::{assign_crowding, fast_non_dominated_sort};
use crate::*;
use rand::SeedableRng;
use rand_chacha::ChaCha20Rng;
use rayon::prelude::*;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RunControl {
    Continue,
    Stop,
}

pub fn run_nsga2<E, O>(
    problem: ProblemSpec,
    config: Nsga2Config,
    evaluator: &E,
    resume: Option<Checkpoint>,
    cancellation: &AtomicBool,
    observer: O,
) -> Result<OptimizationResult, SolverError>
where
    E: Evaluator,
    O: FnMut(&Checkpoint, &GenerationSummary) -> RunControl,
{
    validate_problem_config(&problem, &config)?;
    let thread_count = config.threads.unwrap_or(0);
    let mut builder = rayon::ThreadPoolBuilder::new();
    if thread_count > 0 {
        builder = builder.num_threads(thread_count);
    }
    let pool = builder
        .build()
        .map_err(|error| SolverError::ThreadPool(error.to_string()))?;

    run_nsga2_impl(
        problem,
        config,
        |requests| evaluate_native_batch(&pool, evaluator, requests),
        None,
        resume,
        cancellation,
        observer,
    )
}

/// Run NSGA-II against a backend that evaluates an entire indexed batch. The
/// backend owns concurrency, which prevents oversubscription when it is a
/// subprocess supervisor or remote model runtime.
pub fn run_nsga2_batch<B, O>(
    problem: ProblemSpec,
    config: Nsga2Config,
    evaluator: &B,
    operators: Option<&dyn GenomeOperator>,
    resume: Option<Checkpoint>,
    cancellation: &AtomicBool,
    observer: O,
) -> Result<OptimizationResult, SolverError>
where
    B: BatchEvaluator + ?Sized,
    O: FnMut(&Checkpoint, &GenerationSummary) -> RunControl,
{
    validate_problem_config(&problem, &config)?;
    run_nsga2_impl(
        problem,
        config,
        |requests| {
            evaluator
                .evaluate_batch(requests)
                .map_err(SolverError::BatchEvaluation)
        },
        operators,
        resume,
        cancellation,
        observer,
    )
}

fn run_nsga2_impl<F, O>(
    problem: ProblemSpec,
    config: Nsga2Config,
    evaluate: F,
    operators: Option<&dyn GenomeOperator>,
    resume: Option<Checkpoint>,
    cancellation: &AtomicBool,
    mut observer: O,
) -> Result<OptimizationResult, SolverError>
where
    F: Fn(&[EvaluationRequest]) -> Result<Vec<EvaluatedCandidate>, SolverError>,
    O: FnMut(&Checkpoint, &GenerationSummary) -> RunControl,
{
    let directions: Vec<_> = problem
        .objectives
        .iter()
        .map(|objective| objective.direction)
        .collect();

    let (mut generation, mut population, mut evaluations) = if let Some(checkpoint) = resume {
        validate_checkpoint(&problem, &config, &checkpoint)?;
        let evaluations = checkpoint.population.len() as u64
            + checkpoint.generation as u64 * config.population_size as u64;
        (checkpoint.generation, checkpoint.population, evaluations)
    } else {
        let genes = if let Some(operators) = operators {
            let request = SeedPopulationRequest {
                size: config.population_size,
                seeds: (0..config.population_size)
                    .map(|index| operation_seed(config.seed, usize::MAX, index))
                    .collect(),
            };
            let genes = operators
                .seed_population(&request)
                .map_err(SolverError::GenomeOperation)?;
            if genes.len() != config.population_size {
                return Err(SolverError::GenomeOperation(EvaluationError::new(format!(
                    "seed_population returned {} candidates, expected {}",
                    genes.len(),
                    config.population_size
                ))));
            }
            genes
        } else {
            let mut rng = generation_rng(config.seed, usize::MAX);
            (0..config.population_size)
                .map(|_| random_genes(&problem.variables, &mut rng))
                .collect()
        };
        validate_gene_batch(&problem, &genes).map_err(SolverError::GenomeOperation)?;
        let population = evaluate_candidate_batch(&evaluate, &problem, genes, 0)?;
        (0, population, config.population_size as u64)
    };

    rank_and_crowd(&mut population, &directions);
    while generation < config.generations && !cancellation.load(Ordering::Relaxed) {
        let mut rng = generation_rng(config.seed, generation);
        let mutation_probability = config
            .mutation_probability
            .unwrap_or(1.0 / problem.variables.len() as f64);
        let variation = Variation {
            crossover_probability: config.crossover_probability,
            mutation_probability,
            sbx_distribution_index: config.sbx_distribution_index,
            mutation_distribution_index: config.mutation_distribution_index,
        };
        let base_id = (generation as u64 + 1) * config.population_size as u64;
        let genes = if let Some(operators) = operators {
            let requests: Vec<_> = (0..config.population_size)
                .map(|index| {
                    let left = tournament(&population, &mut rng);
                    let right = tournament(&population, &mut rng);
                    OffspringRequest {
                        id: base_id + index as u64,
                        left_id: left.id,
                        left_genes: left.genes.clone(),
                        right_id: right.id,
                        right_genes: right.genes.clone(),
                        seed: operation_seed(config.seed, generation, index),
                    }
                })
                .collect();
            let generated = operators
                .make_offspring(&requests)
                .map_err(SolverError::GenomeOperation)?;
            validate_generated_candidates(&requests, generated)?
        } else {
            (0..config.population_size)
                .map(|_| {
                    let left = tournament(&population, &mut rng);
                    let right = tournament(&population, &mut rng);
                    make_child(left, right, &problem.variables, &variation, &mut rng)
                })
                .collect()
        };
        validate_gene_batch(&problem, &genes).map_err(SolverError::GenomeOperation)?;
        let offspring = evaluate_candidate_batch(&evaluate, &problem, genes, base_id)?;
        evaluations += offspring.len() as u64;
        population.extend(offspring);
        population = environmental_selection(population, config.population_size, &directions);
        generation += 1;

        let checkpoint = checkpoint(&problem, &config, generation, &population);
        let summary = summarize_generation(generation, evaluations, &population);
        if observer(&checkpoint, &summary) == RunControl::Stop {
            break;
        }
    }

    rank_and_crowd(&mut population, &directions);
    let mut pareto_front: Vec<_> = population
        .iter()
        .filter(|individual| individual.rank == 0)
        .cloned()
        .collect();
    pareto_front.sort_by_key(|individual| individual.id);
    let checkpoint = checkpoint(&problem, &config, generation, &population);
    Ok(OptimizationResult {
        generations: generation,
        evaluations,
        pareto_front,
        final_population: population,
        checkpoint,
    })
}

fn evaluate_native_batch<E: Evaluator>(
    pool: &rayon::ThreadPool,
    evaluator: &E,
    requests: &[EvaluationRequest],
) -> Result<Vec<EvaluatedCandidate>, SolverError> {
    let results: Vec<_> = pool.install(|| {
        requests
            .par_iter()
            .enumerate()
            .map(|(index, request)| {
                let evaluation = evaluator
                    .evaluate(&request.genes)
                    .map_err(|source| SolverError::Evaluation { index, source })?;
                Ok(EvaluatedCandidate {
                    id: request.id,
                    genes: request.genes.clone(),
                    evaluation,
                })
            })
            .collect()
    });
    results.into_iter().collect()
}

fn evaluate_candidate_batch<F>(
    evaluate: &F,
    problem: &ProblemSpec,
    genes: Vec<Vec<f64>>,
    base_id: u64,
) -> Result<Vec<Individual>, SolverError>
where
    F: Fn(&[EvaluationRequest]) -> Result<Vec<EvaluatedCandidate>, SolverError>,
{
    let requests: Vec<_> = genes
        .into_iter()
        .enumerate()
        .map(|(index, genes)| EvaluationRequest {
            id: base_id + index as u64,
            genes,
        })
        .collect();
    let evaluated = evaluate(&requests)?;
    if evaluated.len() != requests.len() {
        return Err(SolverError::BatchEvaluation(EvaluationError::new(format!(
            "backend returned {} evaluations, expected {}",
            evaluated.len(),
            requests.len()
        ))));
    }
    let expected_ids: HashSet<_> = requests.iter().map(|request| request.id).collect();
    let returned_ids: HashSet<_> = evaluated.iter().map(|candidate| candidate.id).collect();
    if returned_ids.len() != evaluated.len() || returned_ids != expected_ids {
        return Err(SolverError::BatchEvaluation(EvaluationError::new(
            "backend returned duplicate, missing, or unexpected candidate IDs",
        )));
    }
    let mut by_id: std::collections::HashMap<_, _> = evaluated
        .into_iter()
        .map(|candidate| (candidate.id, candidate))
        .collect();
    requests
        .into_iter()
        .enumerate()
        .map(|(index, request)| {
            let candidate = by_id.remove(&request.id).expect("ID set was validated");
            validate_gene_batch(problem, std::slice::from_ref(&candidate.genes))
                .map_err(|source| SolverError::Evaluation { index, source })?;
            validate_evaluation(problem, &candidate.evaluation)
                .map_err(|source| SolverError::Evaluation { index, source })?;
            let violation = candidate
                .evaluation
                .constraints
                .iter()
                .map(|value| value.max(0.0))
                .sum();
            Ok(Individual {
                id: candidate.id,
                genes: candidate.genes,
                objectives: candidate.evaluation.objectives,
                constraints: candidate.evaluation.constraints,
                constraint_violation: violation,
                rank: usize::MAX,
                crowding_distance: 0.0,
                evidence: candidate.evaluation.evidence,
            })
        })
        .collect()
}

fn validate_generated_candidates(
    requests: &[OffspringRequest],
    generated: Vec<GeneratedCandidate>,
) -> Result<Vec<Vec<f64>>, SolverError> {
    if generated.len() != requests.len()
        || generated
            .iter()
            .zip(requests)
            .any(|(candidate, request)| candidate.id != request.id)
    {
        return Err(SolverError::GenomeOperation(EvaluationError::new(
            "make_offspring must return one candidate per request in request order",
        )));
    }
    Ok(generated
        .into_iter()
        .map(|candidate| candidate.genes)
        .collect())
}

fn environmental_selection(
    mut combined: Vec<Individual>,
    population_size: usize,
    directions: &[ObjectiveDirection],
) -> Vec<Individual> {
    let fronts = fast_non_dominated_sort(&mut combined, directions);
    for front in &fronts {
        assign_crowding(&mut combined, front, directions);
    }
    let mut selected = Vec::with_capacity(population_size);
    for front in fronts {
        if selected.len() + front.len() <= population_size {
            selected.extend(front.into_iter().map(|index| combined[index].clone()));
        } else {
            let remaining = population_size - selected.len();
            let mut partial: Vec<_> = front
                .into_iter()
                .map(|index| combined[index].clone())
                .collect();
            partial.sort_by(|left, right| {
                right
                    .crowding_distance
                    .total_cmp(&left.crowding_distance)
                    .then_with(|| left.id.cmp(&right.id))
            });
            selected.extend(partial.into_iter().take(remaining));
            break;
        }
    }
    rank_and_crowd(&mut selected, directions);
    selected
}

fn rank_and_crowd(population: &mut [Individual], directions: &[ObjectiveDirection]) {
    let fronts = fast_non_dominated_sort(population, directions);
    for front in fronts {
        assign_crowding(population, &front, directions);
    }
}

pub fn summarize_generation(
    generation: usize,
    evaluations: u64,
    population: &[Individual],
) -> GenerationSummary {
    let objective_count = population
        .first()
        .map_or(0, |individual| individual.objectives.len());
    let constraint_count = population
        .first()
        .map_or(0, |individual| individual.constraints.len());
    let objective_stats = (0..objective_count)
        .map(|index| numeric_statistics(population.iter().map(|item| item.objectives[index])))
        .collect();
    let constraint_stats = (0..constraint_count)
        .map(|index| numeric_statistics(population.iter().map(|item| item.constraints[index])))
        .collect();
    let feasible_count = population
        .iter()
        .filter(|individual| individual.feasible())
        .count();
    GenerationSummary {
        generation,
        population_size: population.len(),
        pareto_size: population
            .iter()
            .filter(|individual| individual.rank == 0)
            .count(),
        evaluations,
        sampled_front: population
            .iter()
            .filter(|individual| individual.rank == 0)
            .take(64)
            .cloned()
            .collect(),
        objective_stats,
        constraint_stats,
        total_violation_stats: (!population.is_empty()).then(|| {
            numeric_statistics(
                population
                    .iter()
                    .map(|individual| individual.constraint_violation),
            )
        }),
        feasible_count,
        infeasible_count: population.len().saturating_sub(feasible_count),
    }
}

fn numeric_statistics(values: impl Iterator<Item = f64>) -> NumericStatistics {
    let values: Vec<_> = values.collect();
    debug_assert!(!values.is_empty());
    let count = values.len() as f64;
    let mean = values.iter().sum::<f64>() / count;
    let variance = values
        .iter()
        .map(|value| {
            let delta = value - mean;
            delta * delta
        })
        .sum::<f64>()
        / count;
    NumericStatistics {
        min: values.iter().copied().fold(f64::INFINITY, f64::min),
        max: values.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        mean,
        stddev: variance.sqrt(),
    }
}

fn checkpoint(
    problem: &ProblemSpec,
    config: &Nsga2Config,
    generation: usize,
    population: &[Individual],
) -> Checkpoint {
    Checkpoint {
        schema_version: CHECKPOINT_SCHEMA_VERSION,
        engine_version: env!("CARGO_PKG_VERSION").to_string(),
        problem: problem.clone(),
        config: config.clone(),
        generation,
        population: population.to_vec(),
        rng: DeterministicRngState {
            seed: config.seed,
            next_generation: generation,
            scheme_version: RNG_SCHEME_VERSION,
        },
    }
}

fn generation_rng(seed: u64, generation: usize) -> ChaCha20Rng {
    let generation = generation as u64;
    let mixed = seed
        ^ generation
            .wrapping_add(0x9e37_79b9_7f4a_7c15)
            .wrapping_mul(0xbf58_476d_1ce4_e5b9);
    ChaCha20Rng::seed_from_u64(mixed)
}

fn operation_seed(seed: u64, generation: usize, index: usize) -> u64 {
    let generation = generation as u64;
    let index = index as u64;
    seed ^ generation
        .wrapping_add(0x9e37_79b9_7f4a_7c15)
        .wrapping_mul(0xbf58_476d_1ce4_e5b9)
        ^ index
            .wrapping_add(0x94d0_49bb_1331_11eb)
            .wrapping_mul(0xd6e8_feb8_6659_fd93)
}

fn validate_gene_batch(problem: &ProblemSpec, batch: &[Vec<f64>]) -> Result<(), EvaluationError> {
    for (candidate_index, genes) in batch.iter().enumerate() {
        if genes.len() != problem.variables.len() {
            return Err(EvaluationError::new(format!(
                "candidate {candidate_index} has {} genes, expected {}",
                genes.len(),
                problem.variables.len()
            )));
        }
        for (gene_index, (gene, variable)) in genes.iter().zip(&problem.variables).enumerate() {
            if !gene.is_finite() {
                return Err(EvaluationError::new(format!(
                    "candidate {candidate_index} gene {gene_index} is not finite"
                )));
            }
            let valid = match variable {
                Variable::Real { lower, upper } => (*lower..=*upper).contains(gene),
                Variable::Integer { lower, upper, step } => {
                    let rounded = gene.round();
                    (*gene - rounded).abs() <= f64::EPSILON
                        && rounded >= *lower as f64
                        && rounded <= *upper as f64
                        && ((rounded as i128 - *lower as i128) % *step as i128 == 0
                            || rounded == *upper as f64)
                }
                Variable::Binary => *gene == 0.0 || *gene == 1.0,
            };
            if !valid {
                return Err(EvaluationError::new(format!(
                    "candidate {candidate_index} gene {gene_index} violates its variable contract"
                )));
            }
        }
    }
    Ok(())
}

pub fn validate_problem_config(
    problem: &ProblemSpec,
    config: &Nsga2Config,
) -> Result<(), SolverError> {
    if problem.variables.is_empty() {
        return Err(SolverError::InvalidProblem(
            "at least one variable is required".into(),
        ));
    }
    if problem.objectives.is_empty() {
        return Err(SolverError::InvalidProblem(
            "at least one objective is required".into(),
        ));
    }
    for (index, variable) in problem.variables.iter().enumerate() {
        match variable {
            Variable::Real { lower, upper }
                if !lower.is_finite() || !upper.is_finite() || lower >= upper =>
            {
                return Err(SolverError::InvalidProblem(format!(
                    "real variable {index} has invalid bounds"
                )));
            }
            Variable::Integer { lower, upper, step } if lower > upper || *step == 0 => {
                return Err(SolverError::InvalidProblem(format!(
                    "integer variable {index} has invalid bounds or step"
                )));
            }
            Variable::Integer { lower, upper, .. }
                if lower.unsigned_abs() > 9_007_199_254_740_991
                    || upper.unsigned_abs() > 9_007_199_254_740_991 =>
            {
                return Err(SolverError::InvalidProblem(format!(
                    "integer variable {index} exceeds exact f64 integer range"
                )));
            }
            _ => {}
        }
    }
    if problem
        .objectives
        .iter()
        .any(|objective| objective.name.trim().is_empty())
    {
        return Err(SolverError::InvalidProblem(
            "objective names must not be empty".into(),
        ));
    }
    if config.population_size < 4 {
        return Err(SolverError::InvalidConfig(
            "population_size must be at least 4".into(),
        ));
    }
    for (name, value) in [
        ("crossover_probability", Some(config.crossover_probability)),
        ("mutation_probability", config.mutation_probability),
    ] {
        if let Some(value) = value
            && !(0.0..=1.0).contains(&value)
        {
            return Err(SolverError::InvalidConfig(format!(
                "{name} must be between 0 and 1"
            )));
        }
    }
    if !config.sbx_distribution_index.is_finite()
        || !config.mutation_distribution_index.is_finite()
        || config.sbx_distribution_index <= 0.0
        || config.mutation_distribution_index <= 0.0
    {
        return Err(SolverError::InvalidConfig(
            "distribution indices must be finite and positive".into(),
        ));
    }
    Ok(())
}

fn validate_evaluation(
    problem: &ProblemSpec,
    evaluation: &Evaluation,
) -> Result<(), EvaluationError> {
    if evaluation.objectives.len() != problem.objectives.len() {
        return Err(EvaluationError::new(format!(
            "expected {} objectives, got {}",
            problem.objectives.len(),
            evaluation.objectives.len()
        )));
    }
    if evaluation
        .objectives
        .iter()
        .chain(&evaluation.constraints)
        .any(|value| !value.is_finite())
    {
        return Err(EvaluationError::new(
            "objectives and constraints must be finite",
        ));
    }
    Ok(())
}

fn validate_checkpoint(
    problem: &ProblemSpec,
    config: &Nsga2Config,
    checkpoint: &Checkpoint,
) -> Result<(), SolverError> {
    if checkpoint.schema_version != CHECKPOINT_SCHEMA_VERSION
        || checkpoint.rng.scheme_version != RNG_SCHEME_VERSION
    {
        return Err(SolverError::IncompatibleCheckpoint(
            "unsupported schema or RNG scheme".into(),
        ));
    }
    if checkpoint.engine_version != env!("CARGO_PKG_VERSION") {
        return Err(SolverError::IncompatibleCheckpoint(
            "engine version changed".into(),
        ));
    }
    if &checkpoint.problem != problem || &checkpoint.config != config {
        return Err(SolverError::IncompatibleCheckpoint(
            "problem or configuration changed".into(),
        ));
    }
    if checkpoint.population.len() != config.population_size {
        return Err(SolverError::IncompatibleCheckpoint(
            "population size does not match".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zdt1(genes: &[f64]) -> Result<Evaluation, EvaluationError> {
        let f1 = genes[0];
        let g = 1.0 + 9.0 * genes[1..].iter().sum::<f64>() / (genes.len() - 1) as f64;
        Ok(Evaluation {
            objectives: vec![f1, g * (1.0 - (f1 / g).sqrt())],
            constraints: vec![],
            evidence: None,
        })
    }

    #[test]
    fn deterministic_across_thread_counts_and_resume() {
        let problem = ProblemSpec {
            variables: (0..8)
                .map(|_| Variable::Real {
                    lower: 0.0,
                    upper: 1.0,
                })
                .collect(),
            objectives: vec![
                Objective {
                    name: "f1".into(),
                    direction: ObjectiveDirection::Minimize,
                },
                Objective {
                    name: "f2".into(),
                    direction: ObjectiveDirection::Minimize,
                },
            ],
        };
        let config = Nsga2Config {
            population_size: 40,
            generations: 20,
            seed: 42,
            threads: Some(1),
            ..Default::default()
        };
        let cancel = AtomicBool::new(false);
        let one = run_nsga2(
            problem.clone(),
            config.clone(),
            &zdt1,
            None,
            &cancel,
            |_, _| RunControl::Continue,
        )
        .unwrap();
        let many = run_nsga2(
            problem.clone(),
            Nsga2Config {
                threads: Some(4),
                ..config.clone()
            },
            &zdt1,
            None,
            &cancel,
            |_, _| RunControl::Continue,
        )
        .unwrap();
        assert_eq!(one.pareto_front, many.pareto_front);

        let mut stopped = None;
        let partial = run_nsga2(
            problem.clone(),
            config.clone(),
            &zdt1,
            None,
            &cancel,
            |checkpoint, summary| {
                if summary.generation == 8 {
                    stopped = Some(checkpoint.clone());
                    RunControl::Stop
                } else {
                    RunControl::Continue
                }
            },
        )
        .unwrap();
        assert_eq!(partial.generations, 8);
        let resumed = run_nsga2(problem, config, &zdt1, stopped, &cancel, |_, _| {
            RunControl::Continue
        })
        .unwrap();
        assert_eq!(one.pareto_front, resumed.pareto_front);
    }

    #[test]
    fn generation_statistics_cover_objectives_constraints_and_feasibility() {
        let population = vec![
            Individual {
                id: 1,
                genes: vec![0.0],
                objectives: vec![1.0, 5.0],
                constraints: vec![-1.0],
                constraint_violation: 0.0,
                rank: 0,
                crowding_distance: 1.0,
                evidence: None,
            },
            Individual {
                id: 2,
                genes: vec![1.0],
                objectives: vec![3.0, 9.0],
                constraints: vec![2.0],
                constraint_violation: 2.0,
                rank: 1,
                crowding_distance: 0.0,
                evidence: None,
            },
        ];
        let summary = summarize_generation(4, 10, &population);
        assert_eq!(summary.generation, 4);
        assert_eq!(summary.pareto_size, 1);
        assert_eq!(summary.feasible_count, 1);
        assert_eq!(summary.infeasible_count, 1);
        assert_eq!(summary.objective_stats[0].mean, 2.0);
        assert_eq!(summary.objective_stats[0].stddev, 1.0);
        assert_eq!(summary.objective_stats[1].min, 5.0);
        assert_eq!(summary.objective_stats[1].max, 9.0);
        assert_eq!(summary.constraint_stats[0].mean, 0.5);
        assert_eq!(summary.total_violation_stats.unwrap().mean, 1.0);
    }

    struct RepairingBackend;

    impl BatchEvaluator for RepairingBackend {
        fn evaluate_batch(
            &self,
            candidates: &[EvaluationRequest],
        ) -> Result<Vec<EvaluatedCandidate>, EvaluationError> {
            Ok(candidates
                .iter()
                .map(|candidate| EvaluatedCandidate {
                    id: candidate.id,
                    genes: candidate.genes.clone(),
                    evaluation: Evaluation {
                        objectives: vec![candidate.genes[0], 1.0 - candidate.genes[0]],
                        constraints: vec![],
                        evidence: Some(EvaluationEvidence {
                            artifact_key: Some(format!("evidence/{}", candidate.id)),
                            ..Default::default()
                        }),
                    },
                })
                .collect())
        }
    }

    impl GenomeOperator for RepairingBackend {
        fn seed_population(
            &self,
            request: &SeedPopulationRequest,
        ) -> Result<Vec<Vec<f64>>, EvaluationError> {
            Ok(request
                .seeds
                .iter()
                .map(|seed| vec![(*seed % 101) as f64 / 100.0])
                .collect())
        }

        fn make_offspring(
            &self,
            requests: &[OffspringRequest],
        ) -> Result<Vec<GeneratedCandidate>, EvaluationError> {
            Ok(requests
                .iter()
                .map(|request| GeneratedCandidate {
                    id: request.id,
                    genes: vec![(request.left_genes[0] + request.right_genes[0]) / 2.0],
                })
                .collect())
        }
    }

    #[test]
    fn batch_backend_can_own_genome_operations_and_evidence() {
        let problem = ProblemSpec {
            variables: vec![Variable::Real {
                lower: 0.0,
                upper: 1.0,
            }],
            objectives: vec![
                Objective {
                    name: "left".into(),
                    direction: ObjectiveDirection::Minimize,
                },
                Objective {
                    name: "right".into(),
                    direction: ObjectiveDirection::Minimize,
                },
            ],
        };
        let config = Nsga2Config {
            population_size: 8,
            generations: 3,
            seed: 17,
            ..Default::default()
        };
        let cancel = AtomicBool::new(false);
        let backend = RepairingBackend;
        let result = run_nsga2_batch(
            problem.clone(),
            config.clone(),
            &backend,
            Some(&backend),
            None,
            &cancel,
            |_, _| RunControl::Continue,
        )
        .unwrap();
        assert_eq!(result.generations, 3);
        assert!(
            result
                .final_population
                .iter()
                .all(|candidate| candidate.evidence.is_some())
        );

        let many = run_nsga2_batch(
            problem.clone(),
            Nsga2Config {
                threads: Some(8),
                ..config.clone()
            },
            &backend,
            Some(&backend),
            None,
            &cancel,
            |_, _| RunControl::Continue,
        )
        .unwrap();
        assert_eq!(result.pareto_front, many.pareto_front);

        let mut checkpoint = None;
        run_nsga2_batch(
            problem.clone(),
            config.clone(),
            &backend,
            Some(&backend),
            None,
            &cancel,
            |current, summary| {
                if summary.generation == 1 {
                    checkpoint = Some(current.clone());
                    RunControl::Stop
                } else {
                    RunControl::Continue
                }
            },
        )
        .unwrap();
        let resumed = run_nsga2_batch(
            problem,
            config,
            &backend,
            Some(&backend),
            checkpoint,
            &cancel,
            |_, _| RunControl::Continue,
        )
        .unwrap();
        assert_eq!(result.pareto_front, resumed.pareto_front);
    }
}
