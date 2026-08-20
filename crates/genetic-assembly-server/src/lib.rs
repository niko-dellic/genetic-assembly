mod error;
mod executor;
mod models;
mod storage;

use crate::error::ApiError;
use crate::models::*;
use crate::storage::{ArtifactStore, UnifiedArtifactStore};
use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Multipart, Path, State};
use axum::http::{HeaderMap, Request, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::{StreamExt, stream};
use genetic_assembly_adapter::{
    ADAPTER_PROTOCOL_VERSION, AdapterLaunch, PROBLEM_SCHEMA_VERSION, ProblemBundle,
};
use genetic_assembly_core::{ProblemSpec, validate_problem_config};
use genetic_assembly_scene::{SceneGeometry, SceneManifest};
use genetic_assembly_script::{
    EvaluatorManifest, validate_evaluator_manifest, validate_evaluator_source,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use sqlx::{FromRow, PgPool};
use std::collections::HashMap;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::net::TcpListener;
use tokio::sync::{RwLock, broadcast};
use tokio_stream::wrappers::BroadcastStream;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::info;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub bind: SocketAddr,
    pub database_url: String,
    pub artifact_root: PathBuf,
    pub s3_bucket: Option<String>,
    pub api_token: Option<String>,
}

impl ServerConfig {
    pub fn from_env() -> Result<Self, String> {
        let bind = std::env::var("GA_BIND")
            .unwrap_or_else(|_| "127.0.0.1:3001".into())
            .parse()
            .map_err(|error| format!("invalid GA_BIND: {error}"))?;
        let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
            "postgres://genetic_assembly:genetic_assembly@127.0.0.1:5432/genetic_assembly".into()
        });
        let artifact_root = std::env::var("GA_ARTIFACT_ROOT")
            .unwrap_or_else(|_| ".data/artifacts".into())
            .into();
        Ok(Self {
            bind,
            database_url,
            artifact_root,
            s3_bucket: std::env::var("GA_S3_BUCKET").ok(),
            api_token: std::env::var("GA_API_TOKEN").ok(),
        })
    }
}

pub struct AppState {
    pub db: PgPool,
    pub artifacts: Arc<dyn ArtifactStore>,
    pub events: RwLock<HashMap<Uuid, broadcast::Sender<RunEvent>>>,
    pub cancellations: RwLock<HashMap<Uuid, Arc<AtomicBool>>>,
    api_token: Option<String>,
}

impl AppState {
    pub async fn event_sender(&self, run_id: Uuid) -> broadcast::Sender<RunEvent> {
        if let Some(sender) = self.events.read().await.get(&run_id) {
            return sender.clone();
        }
        let mut events = self.events.write().await;
        events
            .entry(run_id)
            .or_insert_with(|| broadcast::channel(128).0)
            .clone()
    }
}

pub async fn run(config: ServerConfig) -> Result<(), Box<dyn std::error::Error>> {
    let db = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;
    sqlx::migrate!().run(&db).await?;
    let artifacts: Arc<dyn ArtifactStore> = if let Some(bucket) = &config.s3_bucket {
        Arc::new(UnifiedArtifactStore::s3_from_env(bucket)?)
    } else {
        Arc::new(UnifiedArtifactStore::local(&config.artifact_root)?)
    };
    let state = Arc::new(AppState {
        db,
        artifacts,
        events: RwLock::new(HashMap::new()),
        cancellations: RwLock::new(HashMap::new()),
        api_token: config.api_token,
    });
    tokio::spawn(executor::run_executor(state.clone()));
    let app = router(state);
    let listener = TcpListener::bind(config.bind).await?;
    info!(address=%config.bind, "genetic assembly server listening");
    axum::serve(listener, app).await?;
    Ok(())
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route(
            "/health",
            get(|| async {
                Json(json!({
                    "status":"ok",
                    "execution_mode":"single_run_in_process",
                    "adapter_protocol":ADAPTER_PROTOCOL_VERSION
                }))
            }),
        )
        .route("/v1/scenes", post(create_scene))
        .route("/v1/evaluators", post(create_evaluator))
        .route("/v1/artifacts", post(create_artifact))
        .route("/v1/artifacts/{id}", get(get_artifact))
        .route("/v1/problems", post(create_problem))
        .route("/v1/adapters", post(create_adapter))
        .route("/v1/runs", post(create_run))
        .route("/v1/runs/{id}", get(get_run))
        .route("/v1/runs/{id}/events", get(run_events))
        .route("/v1/runs/{id}/results", get(run_results))
        .route("/v1/runs/{id}/analytics", get(run_analytics))
        .route("/v1/runs/{id}/cancel", post(cancel_run))
        .layer(DefaultBodyLimit::max(256 * 1024 * 1024))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .layer(middleware::from_fn_with_state(state.clone(), authorize))
        .with_state(state)
}

async fn create_artifact(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<(StatusCode, Json<ArtifactResponse>), ApiError> {
    if body.is_empty() {
        return Err(ApiError::BadRequest(
            "artifact body must not be empty".into(),
        ));
    }
    let content_hash = hex::encode(Sha256::digest(&body));
    let media_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let artifact_key = format!("artifacts/{content_hash}");
    let byte_length = body.len();
    state.artifacts.put(&artifact_key, body.to_vec()).await?;
    if let Some((id, existing_media_type, existing_length)) =
        sqlx::query_as::<_, (Uuid, Option<String>, i64)>(
            "SELECT id,media_type,byte_length FROM artifacts WHERE content_hash=$1",
        )
        .bind(&content_hash)
        .fetch_optional(&state.db)
        .await?
    {
        return Ok((
            StatusCode::OK,
            Json(ArtifactResponse {
                id,
                content_hash,
                artifact_key,
                media_type: existing_media_type,
                byte_length: existing_length as usize,
            }),
        ));
    }
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO artifacts(id,content_hash,artifact_key,media_type,byte_length) VALUES($1,$2,$3,$4,$5)")
        .bind(id)
        .bind(&content_hash)
        .bind(&artifact_key)
        .bind(&media_type)
        .bind(byte_length as i64)
        .execute(&state.db)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(ArtifactResponse {
            id,
            content_hash,
            artifact_key,
            media_type,
            byte_length,
        }),
    ))
}

async fn get_artifact(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let (artifact_key, media_type) = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT artifact_key,media_type FROM artifacts WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound(format!("artifact {id}")))?;
    let bytes = state.artifacts.get(&artifact_key).await?;
    let mut response = Response::new(Body::from(bytes));
    if let Some(media_type) = media_type {
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            media_type.parse().map_err(|error| {
                ApiError::Internal(format!("invalid stored media type: {error}"))
            })?,
        );
    }
    Ok(response)
}

async fn create_problem(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateProblemRequest>,
) -> Result<(StatusCode, Json<RevisionResponse>), ApiError> {
    validate_problem_bundle(&state.db, &request.bundle).await?;
    let bytes = serde_json::to_vec(&request.bundle)
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let hash = hex::encode(Sha256::digest(&bytes));
    if let Some(id) =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM problem_revisions WHERE content_hash=$1")
            .bind(&hash)
            .fetch_optional(&state.db)
            .await?
    {
        return Ok((
            StatusCode::OK,
            Json(RevisionResponse {
                id,
                content_hash: hash,
            }),
        ));
    }
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO problem_revisions(id,content_hash,bundle) VALUES($1,$2,$3)")
        .bind(id)
        .bind(&hash)
        .bind(serde_json::to_value(request.bundle).map_err(|e| ApiError::Internal(e.to_string()))?)
        .execute(&state.db)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(RevisionResponse {
            id,
            content_hash: hash,
        }),
    ))
}

async fn validate_problem_bundle(db: &PgPool, bundle: &ProblemBundle) -> Result<(), ApiError> {
    if bundle.schema_version != PROBLEM_SCHEMA_VERSION {
        return Err(ApiError::BadRequest(format!(
            "unsupported problem schema {}, expected {PROBLEM_SCHEMA_VERSION}",
            bundle.schema_version
        )));
    }
    if bundle.name.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "problem name must not be empty".into(),
        ));
    }
    if !bundle.variable_ids.is_empty()
        && bundle.variable_ids.len() != bundle.problem.variables.len()
    {
        return Err(ApiError::BadRequest(
            "variable_ids must be empty or match problem.variables".into(),
        ));
    }
    let unique_ids: std::collections::HashSet<_> = bundle.variable_ids.iter().collect();
    if unique_ids.len() != bundle.variable_ids.len()
        || bundle.variable_ids.iter().any(|id| id.trim().is_empty())
    {
        return Err(ApiError::BadRequest(
            "variable_ids must be non-empty and unique".into(),
        ));
    }
    validate_problem_config(&bundle.problem, &Default::default())
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    for artifact in &bundle.artifacts {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM artifacts WHERE content_hash=$1 AND artifact_key=$2)",
        )
        .bind(&artifact.content_hash)
        .bind(&artifact.artifact_key)
        .fetch_one(db)
        .await?;
        if !exists {
            return Err(ApiError::BadRequest(format!(
                "artifact {} is not registered",
                artifact.name
            )));
        }
    }
    Ok(())
}

async fn create_adapter(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateAdapterRequest>,
) -> Result<(StatusCode, Json<RevisionResponse>), ApiError> {
    validate_adapter_launch(&request.launch)?;
    let bytes = serde_json::to_vec(&request.launch)
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let hash = hex::encode(Sha256::digest(&bytes));
    if let Some(id) =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM adapter_revisions WHERE content_hash=$1")
            .bind(&hash)
            .fetch_optional(&state.db)
            .await?
    {
        return Ok((
            StatusCode::OK,
            Json(RevisionResponse {
                id,
                content_hash: hash,
            }),
        ));
    }
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO adapter_revisions(id,content_hash,launch) VALUES($1,$2,$3)")
        .bind(id)
        .bind(&hash)
        .bind(serde_json::to_value(request.launch).map_err(|e| ApiError::Internal(e.to_string()))?)
        .execute(&state.db)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(RevisionResponse {
            id,
            content_hash: hash,
        }),
    ))
}

fn validate_adapter_launch(launch: &AdapterLaunch) -> Result<(), ApiError> {
    if launch.name.trim().is_empty()
        || launch.adapter_version.trim().is_empty()
        || launch.command.trim().is_empty()
    {
        return Err(ApiError::BadRequest(
            "adapter name, adapter_version, and command must not be empty".into(),
        ));
    }
    if launch.protocol_version != ADAPTER_PROTOCOL_VERSION {
        return Err(ApiError::BadRequest(format!(
            "unsupported adapter protocol {}, expected {ADAPTER_PROTOCOL_VERSION}",
            launch.protocol_version
        )));
    }
    if launch.timeout_ms == 0 || launch.retry_limit > 5 {
        return Err(ApiError::BadRequest(
            "adapter timeout must be positive and retry_limit must be <= 5".into(),
        ));
    }
    Ok(())
}

async fn authorize(
    State(state): State<Arc<AppState>>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let Some(token) = &state.api_token else {
        return Ok(next.run(request).await);
    };
    let expected = format!("Bearer {token}");
    if request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        == Some(expected.as_str())
    {
        Ok(next.run(request).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn create_scene(
    State(state): State<Arc<AppState>>,
    mut multipart: Multipart,
) -> Result<Json<RevisionResponse>, ApiError> {
    let mut glb = None;
    let mut manifest_bytes = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
    {
        match field.name() {
            Some("glb") => {
                glb = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|error| ApiError::BadRequest(error.to_string()))?
                        .to_vec(),
                )
            }
            Some("manifest") => {
                manifest_bytes = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|error| ApiError::BadRequest(error.to_string()))?
                        .to_vec(),
                )
            }
            _ => {}
        }
    }
    let glb =
        glb.ok_or_else(|| ApiError::BadRequest("multipart field `glb` is required".into()))?;
    let manifest_bytes = manifest_bytes
        .ok_or_else(|| ApiError::BadRequest("multipart field `manifest` is required".into()))?;
    let manifest: SceneManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    let scene = SceneGeometry::from_glb(&glb, manifest.clone())
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    let mut digest = Sha256::new();
    digest.update(&glb);
    digest.update(&manifest_bytes);
    let hash = hex::encode(digest.finalize());
    if let Some((id, artifact_key)) = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT id,artifact_key FROM scene_revisions WHERE content_hash=$1",
    )
    .bind(&hash)
    .fetch_optional(&state.db)
    .await?
    {
        // A content hash can outlive local/S3 artifact storage (for example
        // after a development volume is recreated). Re-uploading the same
        // content-addressed key is idempotent and repairs that split state.
        state.artifacts.put(&artifact_key, glb).await?;
        return Ok(Json(RevisionResponse {
            id,
            content_hash: hash,
        }));
    }
    let id = Uuid::new_v4();
    let artifact_key = format!("scenes/{hash}.glb");
    state.artifacts.put(&artifact_key, glb).await?;
    sqlx::query("INSERT INTO scene_revisions(id,content_hash,manifest,artifact_key,object_count,mesh_count) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(id).bind(&hash).bind(serde_json::to_value(manifest).map_err(|e| ApiError::Internal(e.to_string()))?)
        .bind(&artifact_key).bind(scene.object_count() as i32).bind(scene.mesh_count() as i32)
        .execute(&state.db).await?;
    Ok(Json(RevisionResponse {
        id,
        content_hash: hash,
    }))
}

async fn create_evaluator(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateEvaluatorRequest>,
) -> Result<Json<RevisionResponse>, ApiError> {
    validate_evaluator_source(&request.source, &request.limits)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    validate_evaluator_manifest(&request.manifest)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    let manifest = serde_json::to_vec(&request.manifest)
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let limits = serde_json::to_vec(&request.limits)
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let mut digest = Sha256::new();
    digest.update(request.source.as_bytes());
    digest.update(&manifest);
    digest.update(&limits);
    let hash = hex::encode(digest.finalize());
    if let Some(id) =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM evaluator_revisions WHERE source_hash=$1")
            .bind(&hash)
            .fetch_optional(&state.db)
            .await?
    {
        return Ok(Json(RevisionResponse {
            id,
            content_hash: hash,
        }));
    }
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO evaluator_revisions(id,source_hash,source,manifest,limits) VALUES($1,$2,$3,$4,$5)")
    .bind(id)
    .bind(&hash)
    .bind(request.source)
    .bind(serde_json::to_value(request.manifest).map_err(|e| ApiError::Internal(e.to_string()))?)
    .bind(serde_json::to_value(request.limits).map_err(|e| ApiError::Internal(e.to_string()))?)
    .execute(&state.db)
    .await?;
    Ok(Json(RevisionResponse {
        id,
        content_hash: hash,
    }))
}

async fn create_run(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateRunRequest>,
) -> Result<(StatusCode, Json<RunStatusResponse>), ApiError> {
    let three_pair = request.scene_revision_id.zip(request.evaluator_revision_id);
    let generic_pair = request.problem_revision_id.zip(request.adapter_revision_id);
    if three_pair.is_some() == generic_pair.is_some()
        || request.scene_revision_id.is_some() != request.evaluator_revision_id.is_some()
        || request.problem_revision_id.is_some() != request.adapter_revision_id.is_some()
    {
        return Err(ApiError::BadRequest(
            "provide exactly one complete scene/evaluator or problem/adapter revision pair".into(),
        ));
    }
    let problem = if let Some((scene_id, evaluator_id)) = three_pair {
        let scene_manifest: serde_json::Value =
            sqlx::query_scalar("SELECT manifest FROM scene_revisions WHERE id=$1")
                .bind(scene_id)
                .fetch_optional(&state.db)
                .await?
                .ok_or_else(|| ApiError::NotFound("scene revision".into()))?;
        let evaluator_manifest: serde_json::Value =
            sqlx::query_scalar("SELECT manifest FROM evaluator_revisions WHERE id=$1")
                .bind(evaluator_id)
                .fetch_optional(&state.db)
                .await?
                .ok_or_else(|| ApiError::NotFound("evaluator revision".into()))?;
        let scene_manifest: SceneManifest = serde_json::from_value(scene_manifest)
            .map_err(|error| ApiError::Internal(error.to_string()))?;
        let evaluator_manifest: EvaluatorManifest = serde_json::from_value(evaluator_manifest)
            .map_err(|error| ApiError::Internal(error.to_string()))?;
        ProblemSpec {
            variables: scene_manifest
                .levers
                .into_iter()
                .map(|lever| lever.variable)
                .collect(),
            objectives: evaluator_manifest.objectives,
        }
    } else {
        let (problem_id, adapter_id) = generic_pair.expect("pair was validated");
        let bundle: serde_json::Value =
            sqlx::query_scalar("SELECT bundle FROM problem_revisions WHERE id=$1")
                .bind(problem_id)
                .fetch_optional(&state.db)
                .await?
                .ok_or_else(|| ApiError::NotFound("problem revision".into()))?;
        let _: serde_json::Value =
            sqlx::query_scalar("SELECT launch FROM adapter_revisions WHERE id=$1")
                .bind(adapter_id)
                .fetch_optional(&state.db)
                .await?
                .ok_or_else(|| ApiError::NotFound("adapter revision".into()))?;
        serde_json::from_value::<ProblemBundle>(bundle)
            .map_err(|error| ApiError::Internal(error.to_string()))?
            .problem
    };
    validate_problem_config(&problem, &request.config)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO runs(id,scene_revision_id,evaluator_revision_id,problem_revision_id,adapter_revision_id,status,config) VALUES($1,$2,$3,$4,$5,'queued',$6)")
        .bind(id)
        .bind(request.scene_revision_id)
        .bind(request.evaluator_revision_id)
        .bind(request.problem_revision_id)
        .bind(request.adapter_revision_id)
        .bind(serde_json::to_value(request.config).map_err(|e| ApiError::Internal(e.to_string()))?)
        .execute(&state.db).await?;
    let response = fetch_run(&state.db, id).await?;
    emit_event(
        &state,
        RunEvent::Status {
            run_id: id,
            status: "queued".into(),
        },
    )
    .await?;
    Ok((StatusCode::ACCEPTED, Json(response)))
}

async fn get_run(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<RunStatusResponse>, ApiError> {
    Ok(Json(fetch_run(&state.db, id).await?))
}

async fn fetch_run(db: &PgPool, id: Uuid) -> Result<RunStatusResponse, ApiError> {
    sqlx::query_as::<_, RunStatusResponse>("SELECT id,status,current_generation,config,error,created_at,started_at,finished_at FROM runs WHERE id=$1")
        .bind(id).fetch_optional(db).await?.ok_or_else(|| ApiError::NotFound(format!("run {id}")))
}

async fn cancel_run(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<RunStatusResponse>, ApiError> {
    let status = sqlx::query_scalar::<_, String>("UPDATE runs SET cancel_requested=true, status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END, finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END WHERE id=$1 RETURNING status")
        .bind(id).fetch_optional(&state.db).await?.ok_or_else(|| ApiError::NotFound(format!("run {id}")))?;
    if let Some(flag) = state.cancellations.read().await.get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
    emit_event(&state, RunEvent::Status { run_id: id, status }).await?;
    Ok(Json(fetch_run(&state.db, id).await?))
}

#[derive(FromRow)]
struct FrontRow {
    individual: serde_json::Value,
    patches: serde_json::Value,
    materialization: Option<serde_json::Value>,
}

async fn run_results(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<RunResultsResponse>, ApiError> {
    let run = fetch_run(&state.db, id).await?;
    if run.status != "completed" && run.status != "cancelled" {
        if run.status == "failed" {
            return Err(ApiError::Conflict(format!(
                "run failed: {}",
                run.error
                    .as_deref()
                    .unwrap_or("no failure reason was recorded")
            )));
        }
        return Err(ApiError::Conflict(format!("run is {}", run.status)));
    }
    let members = fetch_front_members(&state.db, id).await?;
    Ok(Json(RunResultsResponse {
        run_id: id,
        members,
    }))
}

async fn fetch_front_members(db: &PgPool, id: Uuid) -> Result<Vec<ResultMember>, ApiError> {
    let rows = sqlx::query_as::<_, FrontRow>(
        "SELECT individual,patches,materialization FROM run_front_members WHERE run_id=$1 ORDER BY member_index",
    )
    .bind(id)
    .fetch_all(db)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(ResultMember {
                individual: serde_json::from_value(row.individual)
                    .map_err(|e| ApiError::Internal(e.to_string()))?,
                patches: serde_json::from_value(row.patches)
                    .map_err(|e| ApiError::Internal(e.to_string()))?,
                materialization: row
                    .materialization
                    .map(serde_json::from_value)
                    .transpose()
                    .map_err(|e| ApiError::Internal(e.to_string()))?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()
}

async fn run_analytics(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<RunAnalyticsResponse>, ApiError> {
    let run = fetch_run(&state.db, id).await?;
    let problem_revision_id =
        sqlx::query_scalar::<_, Option<Uuid>>("SELECT problem_revision_id FROM runs WHERE id=$1")
            .bind(id)
            .fetch_one(&state.db)
            .await?;
    if let Some(problem_revision_id) = problem_revision_id {
        return run_generic_analytics(&state, id, run, problem_revision_id).await;
    }
    let scene_manifest = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT scene_revisions.manifest FROM runs JOIN scene_revisions ON scene_revisions.id=runs.scene_revision_id WHERE runs.id=$1",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    let evaluator_manifest = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT evaluator_revisions.manifest FROM runs JOIN evaluator_revisions ON evaluator_revisions.id=runs.evaluator_revision_id WHERE runs.id=$1",
    )
    .bind(id)
    .fetch_one(&state.db)
    .await?;
    let scene_manifest: SceneManifest = serde_json::from_value(scene_manifest)
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let evaluator_manifest: EvaluatorManifest = serde_json::from_value(evaluator_manifest)
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let generations = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT summary FROM generation_summaries WHERE run_id=$1 ORDER BY generation",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|summary| {
        serde_json::from_value(summary).map_err(|error| ApiError::Internal(error.to_string()))
    })
    .collect::<Result<Vec<genetic_assembly_core::GenerationSummary>, ApiError>>()?;
    let candidates = fetch_front_members(&state.db, id).await?;
    let constraint_count = evaluator_manifest
        .constraints
        .len()
        .max(
            candidates
                .first()
                .map_or(0, |member| member.individual.constraints.len()),
        )
        .max(
            generations
                .iter()
                .map(|summary| summary.constraint_stats.len())
                .max()
                .unwrap_or(0),
        );
    let history_complete = !generations.is_empty()
        && generations.iter().all(|summary| {
            summary.objective_stats.len() == evaluator_manifest.objectives.len()
                && summary.constraint_stats.len() == constraint_count
                && summary.total_violation_stats.is_some()
                && summary.feasible_count + summary.infeasible_count == summary.population_size
        });
    let objectives = evaluator_manifest
        .objectives
        .into_iter()
        .enumerate()
        .map(|(index, objective)| AnalyticsObjective {
            index,
            name: objective.name,
            direction: objective.direction,
        })
        .collect();
    let levers = scene_manifest
        .levers
        .into_iter()
        .enumerate()
        .map(|(index, lever)| AnalyticsLever {
            index,
            id: lever.id,
            variable: lever.variable,
            target: Some(lever.target),
        })
        .collect();
    let constraints = (0..constraint_count)
        .map(|index| AnalyticsConstraint {
            index,
            name: evaluator_manifest.constraints.get(index).map_or_else(
                || format!("Constraint {}", index + 1),
                |constraint| constraint.name.clone(),
            ),
            feasible_when: "lte_zero",
        })
        .collect();
    Ok(Json(RunAnalyticsResponse {
        schema_version: 1,
        run_id: id,
        status: run.status,
        history_complete,
        objectives,
        levers,
        constraints,
        candidates,
        generations,
    }))
}

async fn run_generic_analytics(
    state: &AppState,
    id: Uuid,
    run: RunStatusResponse,
    problem_revision_id: Uuid,
) -> Result<Json<RunAnalyticsResponse>, ApiError> {
    let bundle = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT bundle FROM problem_revisions WHERE id=$1",
    )
    .bind(problem_revision_id)
    .fetch_one(&state.db)
    .await?;
    let bundle: ProblemBundle =
        serde_json::from_value(bundle).map_err(|error| ApiError::Internal(error.to_string()))?;
    let generations = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT summary FROM generation_summaries WHERE run_id=$1 ORDER BY generation",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|summary| {
        serde_json::from_value(summary).map_err(|error| ApiError::Internal(error.to_string()))
    })
    .collect::<Result<Vec<genetic_assembly_core::GenerationSummary>, ApiError>>()?;
    let candidates = fetch_front_members(&state.db, id).await?;
    let constraint_count = bundle.constraints.len().max(
        candidates
            .first()
            .map_or(0, |member| member.individual.constraints.len()),
    );
    let history_complete = !generations.is_empty()
        && generations.iter().all(|summary| {
            summary.objective_stats.len() == bundle.problem.objectives.len()
                && summary.constraint_stats.len() == constraint_count
                && summary.total_violation_stats.is_some()
                && summary.feasible_count + summary.infeasible_count == summary.population_size
        });
    let objectives = bundle
        .problem
        .objectives
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, objective)| AnalyticsObjective {
            index,
            name: objective.name,
            direction: objective.direction,
        })
        .collect();
    let levers = bundle
        .problem
        .variables
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, variable)| AnalyticsLever {
            index,
            id: bundle
                .variable_ids
                .get(index)
                .cloned()
                .unwrap_or_else(|| format!("Variable {}", index + 1)),
            variable,
            target: None,
        })
        .collect();
    let constraints = (0..constraint_count)
        .map(|index| AnalyticsConstraint {
            index,
            name: bundle
                .constraints
                .get(index)
                .map(|constraint| constraint.name.clone())
                .unwrap_or_else(|| format!("Constraint {}", index + 1)),
            feasible_when: "lte_zero",
        })
        .collect();
    Ok(Json(RunAnalyticsResponse {
        schema_version: 1,
        run_id: id,
        status: run.status,
        history_complete,
        objectives,
        levers,
        constraints,
        candidates,
        generations,
    }))
}

async fn run_events(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let status = fetch_run(&state.db, id).await?;
    let persisted = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT event FROM run_events WHERE run_id=$1 ORDER BY sequence",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await?
    .into_iter()
    .map(|event| {
        serde_json::from_value(event).map_err(|error| ApiError::Internal(error.to_string()))
    })
    .collect::<Result<Vec<RunEvent>, ApiError>>()?;
    let receiver = state.event_sender(id).await.subscribe();
    let initial_events = if persisted.is_empty() {
        let mut fallback = vec![RunEvent::Status {
            run_id: id,
            status: status.status,
        }];
        if let Some(summary) = sqlx::query_scalar::<_, serde_json::Value>(
            "SELECT summary FROM generation_summaries WHERE run_id=$1 ORDER BY generation DESC LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        {
            fallback.push(RunEvent::Generation {
                run_id: id,
                summary: serde_json::from_value(summary)
                    .map_err(|error| ApiError::Internal(error.to_string()))?,
            });
        }
        fallback
    } else {
        persisted
    };
    let initial = stream::iter(
        initial_events
            .into_iter()
            .map(|event| Ok::<_, Infallible>(sse_event(&event))),
    );
    let live = BroadcastStream::new(receiver).filter_map(|event| async move {
        match event {
            Ok(event) => Some(Ok::<_, Infallible>(sse_event(&event))),
            Err(_) => None,
        }
    });
    Ok(Sse::new(initial.chain(live)).keep_alive(KeepAlive::default()))
}

pub(crate) async fn emit_event(state: &AppState, event: RunEvent) -> Result<(), ApiError> {
    let run_id = event.run_id();
    sqlx::query("INSERT INTO run_events(run_id,event) VALUES($1,$2)")
        .bind(run_id)
        .bind(serde_json::to_value(&event).map_err(|error| ApiError::Internal(error.to_string()))?)
        .execute(&state.db)
        .await?;
    let _ = state.event_sender(run_id).await.send(event);
    Ok(())
}

fn sse_event(event: &RunEvent) -> Event {
    let id = match event {
        RunEvent::Status { status, .. } => format!("status-{status}"),
        RunEvent::Generation { summary, .. } => format!("generation-{}", summary.generation),
        RunEvent::Checkpoint { generation, .. } => format!("checkpoint-{generation}"),
        RunEvent::Completed { .. } => "completed".into(),
        RunEvent::Failed { .. } => "failed".into(),
    };
    Event::default()
        .id(id)
        .event("run")
        .data(serde_json::to_string(event).expect("event serializes"))
}
