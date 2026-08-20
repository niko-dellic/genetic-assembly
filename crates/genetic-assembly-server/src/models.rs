use chrono::{DateTime, Utc};
use genetic_assembly_adapter::{AdapterLaunch, MaterializedCandidate, ProblemBundle};
use genetic_assembly_core::{
    GenerationSummary, Individual, Nsga2Config, ObjectiveDirection, Variable,
};
use genetic_assembly_scene::{LeverTarget, SceneManifest, ScenePatch};
use genetic_assembly_script::{EvaluatorManifest, ScriptLimits};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize)]
pub struct CreateEvaluatorRequest {
    pub source: String,
    pub manifest: EvaluatorManifest,
    #[serde(default)]
    pub limits: ScriptLimits,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CreateRunRequest {
    #[serde(default)]
    pub scene_revision_id: Option<Uuid>,
    #[serde(default)]
    pub evaluator_revision_id: Option<Uuid>,
    #[serde(default)]
    pub problem_revision_id: Option<Uuid>,
    #[serde(default)]
    pub adapter_revision_id: Option<Uuid>,
    #[serde(default)]
    pub config: Nsga2Config,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CreateProblemRequest {
    pub bundle: ProblemBundle,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CreateAdapterRequest {
    pub launch: AdapterLaunch,
}

#[derive(Clone, Debug, Serialize)]
pub struct ArtifactResponse {
    pub id: Uuid,
    pub content_hash: String,
    pub artifact_key: String,
    pub media_type: Option<String>,
    pub byte_length: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct RevisionResponse {
    pub id: Uuid,
    pub content_hash: String,
}

#[derive(Clone, Debug, Serialize, FromRow)]
pub struct RunStatusResponse {
    pub id: Uuid,
    pub status: String,
    pub current_generation: i32,
    pub config: serde_json::Value,
    pub error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ResultMember {
    pub individual: Individual,
    pub patches: Vec<ScenePatch>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materialization: Option<MaterializedCandidate>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RunResultsResponse {
    pub run_id: Uuid,
    pub members: Vec<ResultMember>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AnalyticsObjective {
    pub index: usize,
    pub name: String,
    pub direction: ObjectiveDirection,
}

#[derive(Clone, Debug, Serialize)]
pub struct AnalyticsLever {
    pub index: usize,
    pub id: String,
    #[serde(flatten)]
    pub variable: Variable,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<LeverTarget>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AnalyticsConstraint {
    pub index: usize,
    pub name: String,
    pub feasible_when: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct RunAnalyticsResponse {
    pub schema_version: u32,
    pub run_id: Uuid,
    pub status: String,
    pub history_complete: bool,
    pub objectives: Vec<AnalyticsObjective>,
    pub levers: Vec<AnalyticsLever>,
    pub constraints: Vec<AnalyticsConstraint>,
    pub candidates: Vec<ResultMember>,
    pub generations: Vec<GenerationSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RunEvent {
    Status {
        run_id: Uuid,
        status: String,
    },
    Generation {
        run_id: Uuid,
        summary: GenerationSummary,
    },
    Checkpoint {
        run_id: Uuid,
        generation: usize,
    },
    Completed {
        run_id: Uuid,
        pareto_size: usize,
    },
    Failed {
        run_id: Uuid,
        error: String,
    },
}

impl RunEvent {
    pub fn run_id(&self) -> Uuid {
        match self {
            Self::Status { run_id, .. }
            | Self::Generation { run_id, .. }
            | Self::Checkpoint { run_id, .. }
            | Self::Completed { run_id, .. }
            | Self::Failed { run_id, .. } => *run_id,
        }
    }
}

#[derive(Debug, FromRow)]
pub struct ClaimedRun {
    pub id: Uuid,
    pub scene_revision_id: Option<Uuid>,
    pub evaluator_revision_id: Option<Uuid>,
    pub problem_revision_id: Option<Uuid>,
    pub adapter_revision_id: Option<Uuid>,
    pub config: serde_json::Value,
    pub checkpoint_key: Option<String>,
}

#[derive(Debug, FromRow)]
pub struct ProblemRow {
    pub bundle: serde_json::Value,
    pub content_hash: String,
}

impl ProblemRow {
    pub fn parsed_bundle(&self) -> Result<ProblemBundle, serde_json::Error> {
        serde_json::from_value(self.bundle.clone())
    }
}

#[derive(Debug, FromRow)]
pub struct AdapterRow {
    pub launch: serde_json::Value,
    pub content_hash: String,
}

impl AdapterRow {
    pub fn parsed_launch(&self) -> Result<AdapterLaunch, serde_json::Error> {
        serde_json::from_value(self.launch.clone())
    }
}

#[derive(Debug, FromRow)]
pub struct SceneRow {
    pub manifest: serde_json::Value,
    pub artifact_key: String,
    pub content_hash: String,
}

impl SceneRow {
    pub fn parsed_manifest(&self) -> Result<SceneManifest, serde_json::Error> {
        serde_json::from_value(self.manifest.clone())
    }
}

#[derive(Debug, FromRow)]
pub struct EvaluatorRow {
    pub source: String,
    pub manifest: serde_json::Value,
    pub limits: serde_json::Value,
    pub source_hash: String,
}

impl EvaluatorRow {
    pub fn parsed_manifest(&self) -> Result<EvaluatorManifest, serde_json::Error> {
        serde_json::from_value(self.manifest.clone())
    }

    pub fn parsed_limits(&self) -> Result<ScriptLimits, serde_json::Error> {
        serde_json::from_value(self.limits.clone())
    }
}
