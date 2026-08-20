use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
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
    /// Small, durable references and diagnostics associated with this
    /// evaluation. Large payloads belong in the caller's artifact store.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<EvaluationEvidence>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct EvaluationEvidence {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_key: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_ms: Option<u64>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<EvaluationEvidence>,
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
pub struct NumericStatistics {
    pub min: f64,
    pub max: f64,
    pub mean: f64,
    pub stddev: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct GenerationSummary {
    pub generation: usize,
    pub population_size: usize,
    pub pareto_size: usize,
    pub evaluations: u64,
    pub sampled_front: Vec<Individual>,
    #[serde(default)]
    pub objective_stats: Vec<NumericStatistics>,
    #[serde(default)]
    pub constraint_stats: Vec<NumericStatistics>,
    #[serde(default)]
    pub total_violation_stats: Option<NumericStatistics>,
    #[serde(default)]
    pub feasible_count: usize,
    #[serde(default)]
    pub infeasible_count: usize,
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

/// A stable request identifier plus a candidate genome. Batch backends must
/// return exactly one result for every request and preserve these identifiers.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct EvaluationRequest {
    pub id: u64,
    pub genes: Vec<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct EvaluatedCandidate {
    pub id: u64,
    /// The canonical genome after optional domain repair. Built-in evaluators
    /// normally return the request genome unchanged.
    pub genes: Vec<f64>,
    pub evaluation: Evaluation,
}

/// Batch boundary used by external model runtimes. Implementations own their
/// internal concurrency; the solver never nests a Rayon pool around this call.
pub trait BatchEvaluator: Sync {
    fn evaluate_batch(
        &self,
        candidates: &[EvaluationRequest],
    ) -> Result<Vec<EvaluatedCandidate>, EvaluationError>;
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct SeedPopulationRequest {
    pub size: usize,
    pub seeds: Vec<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct OffspringRequest {
    pub id: u64,
    pub left_id: u64,
    pub left_genes: Vec<f64>,
    pub right_id: u64,
    pub right_genes: Vec<f64>,
    pub seed: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct GeneratedCandidate {
    pub id: u64,
    pub genes: Vec<f64>,
}

/// Optional project-authored genome operations. NSGA-II selection, ranking,
/// crowding, checkpointing, and run lifecycle remain in Rust.
pub trait GenomeOperator: Sync {
    fn seed_population(
        &self,
        request: &SeedPopulationRequest,
    ) -> Result<Vec<Vec<f64>>, EvaluationError>;

    fn make_offspring(
        &self,
        requests: &[OffspringRequest],
    ) -> Result<Vec<GeneratedCandidate>, EvaluationError>;
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
    #[error("batch evaluation failed: {0}")]
    BatchEvaluation(#[source] EvaluationError),
    #[error("domain genome operation failed: {0}")]
    GenomeOperation(#[source] EvaluationError),
    #[error("checkpoint is incompatible: {0}")]
    IncompatibleCheckpoint(String),
    #[error("failed to create evaluation thread pool: {0}")]
    ThreadPool(String),
}

pub type CancellationFlag = AtomicBool;
