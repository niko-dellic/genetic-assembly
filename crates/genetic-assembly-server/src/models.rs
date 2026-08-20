use chrono::{DateTime, Utc};
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
    pub scene_revision_id: Uuid,
    pub evaluator_revision_id: Uuid,
    #[serde(default)]
    pub config: Nsga2Config,
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
    pub target: LeverTarget,
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

#[derive(Clone, Debug, Serialize)]
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

#[derive(Debug, FromRow)]
pub struct ClaimedRun {
    pub id: Uuid,
    pub scene_revision_id: Uuid,
    pub evaluator_revision_id: Uuid,
    pub config: serde_json::Value,
    pub checkpoint_key: Option<String>,
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
