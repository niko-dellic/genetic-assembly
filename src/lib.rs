use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use rand::prelude::*;
use rand::rngs::SmallRng;
use rand::SeedableRng;

#[derive(Serialize, Deserialize)]
pub struct OptimizationSpec {
    pub algorithm: String, // "nsga2" or "nsga3"
    pub num_vars: usize,
    pub population_size: usize,
    pub num_iterations: usize,
    pub crossover_rate: f64,
    pub mutation_rate: f64,
    pub num_offsprings: usize,
    pub objectives: Vec<Vec<f64>>, // coefficient matrix for objectives
    pub constraints: Option<Vec<Vec<f64>>>, // optional constraint matrix
}

#[derive(Serialize, Deserialize)]
pub struct OptimizationResult {
    pub pareto: Vec<Vec<f64>>, // pareto front individuals
    pub stats: OptimizationStats,
}

#[derive(Serialize, Deserialize)]
pub struct OptimizationStats {
    pub iterations: usize,
    pub population_size: usize,
    pub pareto_size: usize,
}

#[derive(Clone, Debug)]
struct Individual {
    genes: Vec<f64>,
    objectives: Vec<f64>,
    rank: usize,
    crowding_distance: f64,
}

/// Fast non-dominated sorting (NSGA-II)
fn fast_non_dominated_sort(population: &mut Vec<Individual>) -> Vec<Vec<usize>> {
    let n = population.len();
    let mut fronts: Vec<Vec<usize>> = vec![Vec::new()];
    let mut domination_count = vec![0; n];
    let mut dominated_solutions: Vec<Vec<usize>> = vec![Vec::new(); n];

    // For each individual
    for p in 0..n {
        for q in 0..n {
            if p == q {
                continue;
            }
            if dominates(&population[p], &population[q]) {
                dominated_solutions[p].push(q);
            } else if dominates(&population[q], &population[p]) {
                domination_count[p] += 1;
            }
        }
        if domination_count[p] == 0 {
            population[p].rank = 0;
            fronts[0].push(p);
        }
    }

    let mut i = 0;
    while i < fronts.len() && !fronts[i].is_empty() {
        let mut next_front = Vec::new();
        for &p in &fronts[i] {
            for &q in &dominated_solutions[p] {
                domination_count[q] -= 1;
                if domination_count[q] == 0 {
                    population[q].rank = i + 1;
                    next_front.push(q);
                }
            }
        }
        if !next_front.is_empty() {
            fronts.push(next_front);
        }
        i += 1;
    }

    fronts
}

/// Check if individual a dominates individual b (minimization)
fn dominates(a: &Individual, b: &Individual) -> bool {
    let mut better_in_one = false;
    for (obj_a, obj_b) in a.objectives.iter().zip(b.objectives.iter()) {
        if obj_a > obj_b {
            return false;
        }
        if obj_a < obj_b {
            better_in_one = true;
        }
    }
    better_in_one
}

/// Calculate crowding distance
fn calculate_crowding_distance(population: &mut Vec<Individual>, front: &[usize]) {
    if front.len() <= 2 {
        for &idx in front {
            population[idx].crowding_distance = f64::INFINITY;
        }
        return;
    }

    let num_objectives = population[front[0]].objectives.len();

    for &idx in front {
        population[idx].crowding_distance = 0.0;
    }

    for obj_idx in 0..num_objectives {
        let mut sorted_front = front.to_vec();
        sorted_front.sort_by(|&a, &b| {
            population[a].objectives[obj_idx]
                .partial_cmp(&population[b].objectives[obj_idx])
                .unwrap()
        });

        let min_val = population[sorted_front[0]].objectives[obj_idx];
        let max_val = population[sorted_front[sorted_front.len() - 1]].objectives[obj_idx];
        let range = max_val - min_val;

        population[sorted_front[0]].crowding_distance = f64::INFINITY;
        population[sorted_front[sorted_front.len() - 1]].crowding_distance = f64::INFINITY;

        if range > 0.0 {
            for i in 1..sorted_front.len() - 1 {
                let prev = population[sorted_front[i - 1]].objectives[obj_idx];
                let next = population[sorted_front[i + 1]].objectives[obj_idx];
                population[sorted_front[i]].crowding_distance += (next - prev) / range;
            }
        }
    }
}

/// Binary tournament selection
fn tournament_selection<'a>(population: &'a [Individual], rng: &mut SmallRng) -> &'a Individual {
    let idx1 = rng.gen_range(0..population.len());
    let idx2 = rng.gen_range(0..population.len());

    let ind1 = &population[idx1];
    let ind2 = &population[idx2];

    if ind1.rank < ind2.rank {
        ind1
    } else if ind1.rank > ind2.rank {
        ind2
    } else if ind1.crowding_distance > ind2.crowding_distance {
        ind1
    } else {
        ind2
    }
}

/// Single-point crossover
fn crossover(parent1: &Individual, parent2: &Individual, rate: f64, rng: &mut SmallRng) -> Individual {
    if rng.gen::<f64>() > rate {
        return parent1.clone();
    }

    let point = rng.gen_range(1..parent1.genes.len());
    let mut child_genes = Vec::with_capacity(parent1.genes.len());

    child_genes.extend_from_slice(&parent1.genes[..point]);
    child_genes.extend_from_slice(&parent2.genes[point..]);

    Individual {
        genes: child_genes,
        objectives: Vec::new(),
        rank: 0,
        crowding_distance: 0.0,
    }
}

/// Bit-flip mutation for binary genes
fn mutate(individual: &mut Individual, rate: f64, rng: &mut SmallRng) {
    for gene in &mut individual.genes {
        if rng.gen::<f64>() < rate {
            *gene = if *gene > 0.5 { 0.0 } else { 1.0 };
        }
    }
}

/// Evaluate objectives for an individual
fn evaluate(individual: &mut Individual, objective_matrix: &[Vec<f64>]) {
    individual.objectives = objective_matrix
        .iter()
        .map(|obj_coeffs| {
            individual
                .genes
                .iter()
                .zip(obj_coeffs.iter())
                .map(|(g, c)| g * c)
                .sum()
        })
        .collect();
}

/// NSGA-II algorithm
fn run_nsga2(
    num_vars: usize,
    pop_size: usize,
    num_iterations: usize,
    crossover_rate: f64,
    mutation_rate: f64,
    num_offsprings: usize,
    objective_matrix: Vec<Vec<f64>>,
) -> Vec<Individual> {
    let mut rng = SmallRng::from_entropy();

    // Initialize population
    let mut population: Vec<Individual> = (0..pop_size)
        .map(|_| {
            let genes: Vec<f64> = (0..num_vars).map(|_| if rng.gen::<bool>() { 1.0 } else { 0.0 }).collect();
            let mut ind = Individual {
                genes,
                objectives: Vec::new(),
                rank: 0,
                crowding_distance: 0.0,
            };
            evaluate(&mut ind, &objective_matrix);
            ind
        })
        .collect();

    // Main loop
    for _ in 0..num_iterations {
        // Generate offspring
        let mut offspring = Vec::with_capacity(num_offsprings);
        for _ in 0..num_offsprings {
            let parent1 = tournament_selection(&population, &mut rng);
            let parent2 = tournament_selection(&population, &mut rng);
            let mut child = crossover(parent1, parent2, crossover_rate, &mut rng);
            mutate(&mut child, mutation_rate, &mut rng);
            evaluate(&mut child, &objective_matrix);
            offspring.push(child);
        }

        // Combine parent and offspring
        population.extend(offspring);

        // Non-dominated sorting
        let fronts = fast_non_dominated_sort(&mut population);

        // Calculate crowding distance for each front
        for front in &fronts {
            calculate_crowding_distance(&mut population, front);
        }

        // Select next generation
        let mut next_population = Vec::with_capacity(pop_size);
        for front in &fronts {
            if next_population.len() + front.len() <= pop_size {
                for &idx in front {
                    next_population.push(population[idx].clone());
                }
            } else {
                let mut sorted_front: Vec<_> = front.iter().map(|&idx| &population[idx]).collect();
                sorted_front.sort_by(|a, b| {
                    b.crowding_distance
                        .partial_cmp(&a.crowding_distance)
                        .unwrap()
                });
                for ind in sorted_front.iter().take(pop_size - next_population.len()) {
                    next_population.push((*ind).clone());
                }
                break;
            }
        }

        population = next_population;
    }

    population
}

/// Solve optimization problem from JSON specification
#[wasm_bindgen]
pub fn solve_json(spec_json: &str) -> Result<String, JsValue> {
    let spec: OptimizationSpec = serde_json::from_str(spec_json)
        .map_err(|e| JsValue::from_str(&format!("JSON parse error: {}", e)))?;

    if spec.algorithm != "nsga2" && spec.algorithm != "nsga3" {
        return Err(JsValue::from_str(&format!(
            "Unknown algorithm: {} (only nsga2 is currently supported)",
            spec.algorithm
        )));
    }

    let population = run_nsga2(
        spec.num_vars,
        spec.population_size,
        spec.num_iterations,
        spec.crossover_rate,
        spec.mutation_rate,
        spec.num_offsprings,
        spec.objectives,
    );

    // Extract pareto front (rank 0)
    let pareto: Vec<Vec<f64>> = population
        .iter()
        .filter(|ind| ind.rank == 0)
        .map(|ind| ind.genes.clone())
        .collect();

    let result = OptimizationResult {
        pareto: pareto.clone(),
        stats: OptimizationStats {
            iterations: spec.num_iterations,
            population_size: spec.population_size,
            pareto_size: pareto.len(),
        },
    };

    serde_json::to_string(&result)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Solve optimization problem using buffer-based API
#[wasm_bindgen]
pub fn solve_buffers(
    _x0_ptr: Option<Vec<f64>>,
    dims: usize,
    objectives_ptr: Vec<f64>,
    objectives_rows: usize,
    objectives_cols: usize,
    pop_size: usize,
    generations: usize,
) -> Result<Vec<f64>, JsValue> {
    // Parse objectives matrix
    if objectives_ptr.len() != objectives_rows * objectives_cols {
        return Err(JsValue::from_str("Invalid objectives matrix dimensions"));
    }

    let objective_matrix: Vec<Vec<f64>> = (0..objectives_rows)
        .map(|i| {
            objectives_ptr[i * objectives_cols..(i + 1) * objectives_cols].to_vec()
        })
        .collect();

    let population = run_nsga2(
        dims,
        pop_size,
        generations,
        0.9,  // default crossover rate
        0.1,  // default mutation rate
        (pop_size as f64 * 0.5) as usize,
        objective_matrix,
    );

    // Flatten genes into Float64Array
    Ok(population.iter().flat_map(|ind| ind.genes.clone()).collect())
}


