use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct OptimizationSpec {
    pub algorithm: String,
    pub num_vars: usize,
    pub population_size: usize,
    pub num_iterations: usize,
    pub crossover_rate: f64,
    pub mutation_rate: f64,
    pub num_offsprings: usize,
    pub objectives: Option<Vec<Vec<f64>>>,
    pub constraints: Option<Vec<Vec<f64>>>,
    pub initial_population: Option<Vec<Vec<f64>>>,
    pub seed: Option<u64>,
    pub progress_interval: Option<usize>,
}

#[derive(Serialize, Deserialize)]
pub struct OptimizationResult {
    pub pareto: Vec<Vec<f64>>,
    pub stats: OptimizationStats,
    pub full_population: Option<Vec<Vec<f64>>>,
    pub execution_time: Option<u64>,
}

#[derive(Serialize, Deserialize)]
pub struct OptimizationStats {
    pub iterations: usize,
    pub population_size: usize,
    pub pareto_size: usize,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct IndividualData {
    pub genes: Vec<f64>,
    pub objectives: Vec<f64>,
    pub rank: usize,
    pub crowding_distance: f64,
}

#[derive(Serialize, Deserialize)]
pub struct ProgressData {
    pub generation: usize,
    pub pareto_front: Vec<IndividualData>,
    pub full_population: Vec<IndividualData>,
    pub pareto_size: usize,
    pub population_size: usize,
}

#[derive(Clone, Debug)]
pub struct Individual {
    pub genes: Vec<f64>,
    pub objectives: Vec<f64>,
    pub rank: usize,
    pub crowding_distance: f64,
}
