use serde::{Deserialize, Serialize};
use std::sync::atomic::AtomicBool;
use thiserror::Error;

pub const CHECKPOINT_SCHEMA_VERSION: u32 = 1;
pub const RNG_SCHEME_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Variable {
    Real {
        lower: f64,
        upper: f64,
    },
    Integer {
        lower: i64,
        upper: i64,
        #[serde(default = "default_step")]
        step: u64,
    },
    Binary,
}

const fn default_step() -> u64 {
    1
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ObjectiveDirection {
    Minimize,
    Maximize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Objective {
    pub name: String,
    pub direction: ObjectiveDirection,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ProblemSpec {
    pub variables: Vec<Variable>,
    pub objectives: Vec<Objective>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Nsga2Config {
    pub population_size: usize,
    pub generations: usize,
    pub crossover_probability: f64,
    /// Per-variable mutation probability. `None` means `1 / variable_count`.
    pub mutation_probability: Option<f64>,
    pub sbx_distribution_index: f64,
    pub mutation_distribution_index: f64,
    pub seed: u64,
    /// `None` or `0` lets Rayon choose the available parallelism.
    pub threads: Option<usize>,
}

impl Default for Nsga2Config {
    fn default() -> Self {
        Self {
            population_size: 100,
            generations: 200,
            crossover_probability: 0.9,
            mutation_probability: None,
            sbx_distribution_index: 15.0,
            mutation_distribution_index: 20.0,
            seed: 0,
            threads: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Evaluation {
    pub objectives: Vec<f64>,
    #[serde(default)]
    pub constraints: Vec<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Individual {
    pub id: u64,
    pub genes: Vec<f64>,
    pub objectives: Vec<f64>,
    pub constraints: Vec<f64>,
    pub constraint_violation: f64,
    pub rank: usize,
    pub crowding_distance: f64,
}

impl Individual {
    pub fn feasible(&self) -> bool {
        self.constraint_violation == 0.0
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeterministicRngState {
    pub seed: u64,
    pub next_generation: usize,
    pub scheme_version: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Checkpoint {
    pub schema_version: u32,
    pub engine_version: String,
    pub problem: ProblemSpec,
    pub config: Nsga2Config,
    /// Number of completed generations.
    pub generation: usize,
    pub population: Vec<Individual>,
    pub rng: DeterministicRngState,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct GenerationSummary {
    pub generation: usize,
    pub population_size: usize,
    pub pareto_size: usize,
    pub evaluations: u64,
    pub sampled_front: Vec<Individual>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct OptimizationResult {
    pub generations: usize,
    pub evaluations: u64,
    pub pareto_front: Vec<Individual>,
    pub final_population: Vec<Individual>,
    pub checkpoint: Checkpoint,
}

pub trait Evaluator: Sync {
    fn evaluate(&self, genes: &[f64]) -> Result<Evaluation, EvaluationError>;
}

impl<F> Evaluator for F
where
    F: Fn(&[f64]) -> Result<Evaluation, EvaluationError> + Sync,
{
    fn evaluate(&self, genes: &[f64]) -> Result<Evaluation, EvaluationError> {
        self(genes)
    }
}

#[derive(Clone, Debug, Error, Serialize, Deserialize, PartialEq, Eq)]
#[error("{message}")]
pub struct EvaluationError {
    pub message: String,
}

impl EvaluationError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

#[derive(Debug, Error)]
pub enum SolverError {
    #[error("invalid problem: {0}")]
    InvalidProblem(String),
    #[error("invalid configuration: {0}")]
    InvalidConfig(String),
    #[error("evaluation {index} failed: {source}")]
    Evaluation {
        index: usize,
        #[source]
        source: EvaluationError,
    },
    #[error("checkpoint is incompatible: {0}")]
    IncompatibleCheckpoint(String),
    #[error("failed to create evaluation thread pool: {0}")]
    ThreadPool(String),
}

pub type CancellationFlag = AtomicBool;
