use super::operators::{crossover, mutate, tournament_selection};
use super::sorting::{calculate_crowding_distance, fast_non_dominated_sort};
use crate::evaluation::{evaluate, evaluate_with_js_function};
use crate::types::{Individual, IndividualData, ProgressData};
use rand::rngs::SmallRng;
use rand::Rng;
use rand::SeedableRng;
use wasm_bindgen::prelude::*;

/// NSGA-II implementation with coefficient matrix objectives
pub fn run_nsga2(
    num_vars: usize,
    pop_size: usize,
    num_iterations: usize,
    crossover_rate: f64,
    mutation_rate: f64,
    num_offsprings: usize,
    objective_matrix: Vec<Vec<f64>>,
    initial_population: Option<Vec<Vec<f64>>>,
    seed: Option<u64>,
    progress_callback: Option<js_sys::Function>,
    progress_interval: usize,
) -> Vec<Individual> {
    let mut rng = if let Some(s) = seed {
        SmallRng::seed_from_u64(s)
    } else {
        SmallRng::from_entropy()
    };

    // Initialize population (from provided or random)
    let mut population: Vec<Individual> = if let Some(init_pop) = initial_population {
        // Use provided initial population
        init_pop
            .into_iter()
            .map(|genes| {
                let mut ind = Individual {
                    genes,
                    objectives: Vec::new(),
                    rank: 0,
                    crowding_distance: 0.0,
                };
                evaluate(&mut ind, &objective_matrix);
                ind
            })
            .collect()
    } else {
        // Generate random population
        (0..pop_size)
            .map(|_| {
                let genes: Vec<f64> = (0..num_vars)
                    .map(|_| if rng.gen::<bool>() { 1.0 } else { 0.0 })
                    .collect();
                let mut ind = Individual {
                    genes,
                    objectives: Vec::new(),
                    rank: 0,
                    crowding_distance: 0.0,
                };
                evaluate(&mut ind, &objective_matrix);
                ind
            })
            .collect()
    };

    // Main loop
    for generation in 0..num_iterations {
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

        // Progress callback
        if let Some(callback) = &progress_callback {
            if generation % progress_interval == 0 || generation == num_iterations - 1 {
                let progress_data = create_progress_data(generation, &population);
                let _ = callback.call1(&JsValue::NULL, &progress_data);
            }
        }
    }

    population
}

/// NSGA-II implementation with custom JavaScript evaluation function
pub fn run_nsga2_custom_eval(
    num_vars: usize,
    pop_size: usize,
    num_iterations: usize,
    crossover_rate: f64,
    mutation_rate: f64,
    num_offsprings: usize,
    eval_fn: js_sys::Function,
    initial_population: Option<Vec<Vec<f64>>>,
    seed: Option<u64>,
    progress_callback: Option<js_sys::Function>,
    progress_interval: usize,
) -> Result<Vec<Individual>, JsValue> {
    let mut rng = if let Some(s) = seed {
        SmallRng::seed_from_u64(s)
    } else {
        SmallRng::from_entropy()
    };

    // Initialize population (from provided or random)
    let mut population: Vec<Individual> = if let Some(init_pop) = initial_population {
        // Use provided initial population
        let mut pop = Vec::new();
        for genes in init_pop {
            let objectives = evaluate_with_js_function(&genes, &eval_fn)?;
            pop.push(Individual {
                genes,
                objectives,
                rank: 0,
                crowding_distance: 0.0,
            });
        }
        pop
    } else {
        // Generate random population
        let mut pop = Vec::new();
        for _ in 0..pop_size {
            let genes: Vec<f64> = (0..num_vars).map(|_| rng.gen::<f64>()).collect();
            let objectives = evaluate_with_js_function(&genes, &eval_fn)?;
            pop.push(Individual {
                genes,
                objectives,
                rank: 0,
                crowding_distance: 0.0,
            });
        }
        pop
    };

    // Main evolution loop
    for gen in 0..num_iterations {
        // Non-dominated sorting
        let fronts = fast_non_dominated_sort(&mut population);

        // Calculate crowding distance for each front
        for front in &fronts {
            calculate_crowding_distance(&mut population, front);
        }

        // Generate offspring
        let mut offspring = Vec::with_capacity(num_offsprings);
        for _ in 0..num_offsprings {
            let parent1 = tournament_selection(&population, &mut rng);
            let parent2 = tournament_selection(&population, &mut rng);
            let mut child = crossover(parent1, parent2, crossover_rate, &mut rng);
            mutate(&mut child, mutation_rate, &mut rng);

            // Evaluate offspring with custom function
            child.objectives = evaluate_with_js_function(&child.genes, &eval_fn)?;
            offspring.push(child);
        }

        // Combine parent and offspring populations
        population.extend(offspring);

        // Non-dominated sorting on combined population
        let fronts = fast_non_dominated_sort(&mut population);

        // Calculate crowding distance
        for front in &fronts {
            calculate_crowding_distance(&mut population, front);
        }

        // Select next generation
        let mut next_population = Vec::new();
        for front in &fronts {
            if next_population.len() + front.len() <= pop_size {
                for &idx in front {
                    next_population.push(population[idx].clone());
                }
            } else {
                // Sort by crowding distance and fill remaining slots
                let mut remaining: Vec<_> = front.iter().map(|&idx| &population[idx]).collect();
                remaining.sort_by(|a, b| {
                    b.crowding_distance
                        .partial_cmp(&a.crowding_distance)
                        .unwrap()
                });
                for ind in remaining.iter().take(pop_size - next_population.len()) {
                    next_population.push((*ind).clone());
                }
                break;
            }
        }

        population = next_population;

        // Progress callback
        if let Some(ref callback) = progress_callback {
            if gen % progress_interval == 0 || gen == num_iterations - 1 {
                let progress_data = create_progress_data(gen + 1, &population);
                let _ = callback.call1(&JsValue::NULL, &progress_data);
            }
        }
    }

    // Final non-dominated sorting
    let fronts = fast_non_dominated_sort(&mut population);
    for front in &fronts {
        calculate_crowding_distance(&mut population, front);
    }

    Ok(population)
}

/// Create progress data for callback
pub fn create_progress_data(generation: usize, population: &[Individual]) -> JsValue {
    let pareto_front: Vec<IndividualData> = population
        .iter()
        .filter(|ind| ind.rank == 0)
        .map(|ind| IndividualData {
            genes: ind.genes.clone(),
            objectives: ind.objectives.clone(),
            rank: ind.rank,
            crowding_distance: ind.crowding_distance,
        })
        .collect();

    let full_population: Vec<IndividualData> = population
        .iter()
        .map(|ind| IndividualData {
            genes: ind.genes.clone(),
            objectives: ind.objectives.clone(),
            rank: ind.rank,
            crowding_distance: ind.crowding_distance,
        })
        .collect();

    let progress_data = ProgressData {
        generation,
        pareto_size: pareto_front.len(),
        population_size: population.len(),
        pareto_front,
        full_population,
    };

    serde_wasm_bindgen::to_value(&progress_data).unwrap()
}
