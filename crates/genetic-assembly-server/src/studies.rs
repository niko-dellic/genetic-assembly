//! Versioned study orchestration and seed-level history. Solver mechanics remain domain-neutral.
use super::*;
use axum::extract::Query;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::Stdio;
use std::time::Duration;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Filter {
    #[serde(default)]
    offset: i64,
    phase: Option<String>,
    status: Option<String>,
    candidate_id: Option<String>,
    owner_id: Option<Uuid>,
}
fn page(items: Vec<Value>, offset: i64) -> Json<Value> {
    let next = if items.len() == 50 {
        Some(offset + 50)
    } else {
        None
    };
    Json(json!({"items":items,"nextOffset":next}))
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str, ApiError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| ApiError::BadRequest(format!("missing {key}")))
}
fn parse<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, ApiError> {
    serde_json::from_value(value).map_err(|e| ApiError::BadRequest(e.to_string()))
}

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/v2/studies", get(list_studies).post(prepare))
        .route("/v2/studies/{id}", get(get_study))
        .route("/v2/studies/{id}/runs", get(list_runs).post(start))
        .route("/v2/studies/{id}/jobs", get(list_jobs).post(create_job))
        .route("/v2/runs/{id}", get(super::get_run))
        .route("/v2/runs/{id}/cancel", post(super::cancel_run))
        .route("/v2/runs/{id}/analytics", get(super::run_analytics))
        .route("/v2/runs/{id}/results", get(results))
        .route("/v2/runs/{id}/export", get(export))
        .route("/v2/history/{id}", get(history))
        .route("/v2/evaluations", post(record))
        .route("/v2/cache/{key}", get(cache))
        .route("/v2/datasets", get(datasets).post(register_dataset))
        .route("/v2/datasets/{id}/resources/{*key}", get(resource))
        .route("/v2/jobs/{id}", get(get_job))
        .route("/v2/jobs/{id}/cancel", post(cancel_job))
        .route("/v2/artifacts", post(super::create_artifact))
        .route("/v2/artifacts/{id}", get(super::get_artifact))
        .route("/", get(inspector))
        .route("/inspector.js", get(inspector_js))
}
async fn inspector() -> Response {
    (
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        include_str!("../../../inspector/public/index.html"),
    )
        .into_response()
}
async fn inspector_js() -> Response {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        include_str!("../../../inspector/public/inspector.js"),
    )
        .into_response()
}

async fn prepare(
    State(state): State<Arc<AppState>>,
    Json(input): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let spec = &input["spec"];
    if spec["schemaVersion"] != 2 {
        return Err(ApiError::BadRequest("study schemaVersion must be 2".into()));
    }
    string(spec, "name")?;
    string(spec, "version")?;
    let runtime = &input["runtime"];
    let identity = string(runtime, "identity")?;
    let mut bundle: ProblemBundle = parse(input["bundle"].clone())?;
    let id = hex::encode(Sha256::digest(
        serde_json::to_vec(&json!({"spec":spec,"runtime":runtime}))
            .map_err(|e| ApiError::Internal(e.to_string()))?,
    ));
    bundle.metadata = json!({"study":spec,"studyId":id,"runtimeIdentity":identity});
    let (_, Json(problem)) =
        super::create_problem(State(state.clone()), Json(CreateProblemRequest { bundle })).await?;
    let mut environment: std::collections::BTreeMap<String, String> =
        parse(runtime.get("environment").cloned().unwrap_or(json!({})))?;
    environment.insert("GA_STUDY_ID".into(), id.clone());
    environment.insert("GA_RUNTIME_ID".into(), identity.into());
    if let Some(token) = &state.api_token {
        environment.insert("GA_API_TOKEN".into(), token.clone());
    }
    let launch = AdapterLaunch {
        name: spec["name"].as_str().unwrap().into(),
        adapter_version: identity.into(),
        protocol_version: ADAPTER_PROTOCOL_VERSION.into(),
        command: string(runtime, "command")?.into(),
        args: parse(runtime["args"].clone())?,
        working_directory: runtime["workingDirectory"].as_str().map(PathBuf::from),
        environment,
        timeout_ms: runtime["timeoutMs"].as_u64().unwrap_or(300_000),
        retry_limit: 1,
    };
    let (_, Json(adapter)) =
        super::create_adapter(State(state.clone()), Json(CreateAdapterRequest { launch })).await?;
    sqlx::query("INSERT INTO studies(id,spec,runtime,problem_revision_id,adapter_revision_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING").bind(&id).bind(spec).bind(runtime).bind(problem.id).bind(adapter.id).execute(&state.db).await?;
    get_study(State(state), Path(id)).await
}
async fn list_studies(
    State(s): State<Arc<AppState>>,
    Query(f): Query<Filter>,
) -> Result<Json<Value>, ApiError> {
    let rows=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'spec',spec,'runtime',runtime,'created_at',created_at) FROM studies ORDER BY created_at DESC,id LIMIT 50 OFFSET $1").bind(f.offset.max(0)).fetch_all(&s.db).await?;
    Ok(page(rows, f.offset.max(0)))
}
async fn get_study(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(sqlx::query_scalar("SELECT jsonb_build_object('id',id,'spec',spec,'runtime',runtime,'created_at',created_at) FROM studies WHERE id=$1").bind(id).fetch_optional(&s.db).await?.ok_or_else(||ApiError::NotFound("study".into()))?))
}
async fn start(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(config): Json<genetic_assembly_core::Nsga2Config>,
) -> Result<Json<RunStatusResponse>, ApiError> {
    let (problem, adapter): (Uuid, Uuid) =
        sqlx::query_as("SELECT problem_revision_id,adapter_revision_id FROM studies WHERE id=$1")
            .bind(&id)
            .fetch_optional(&s.db)
            .await?
            .ok_or_else(|| ApiError::NotFound("study".into()))?;
    let (_, Json(run)) = super::create_run(
        State(s.clone()),
        Json(CreateRunRequest {
            problem_revision_id: Some(problem),
            adapter_revision_id: Some(adapter),
            scene_revision_id: None,
            evaluator_revision_id: None,
            config,
        }),
    )
    .await?;
    sqlx::query("INSERT INTO study_runs(run_id,study_id) VALUES($1,$2)")
        .bind(run.id)
        .bind(id)
        .execute(&s.db)
        .await?;
    Ok(Json(run))
}
async fn list_runs(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(f): Query<Filter>,
) -> Result<Json<Value>, ApiError> {
    Ok(page(sqlx::query_scalar("SELECT to_jsonb(r) FROM runs r JOIN study_runs x ON x.run_id=r.id WHERE x.study_id=$1 ORDER BY r.created_at DESC,r.id LIMIT 50 OFFSET $2").bind(id).bind(f.offset.max(0)).fetch_all(&s.db).await?,f.offset.max(0)))
}
async fn record(
    State(s): State<Arc<AppState>>,
    Json(data): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let owner: Uuid = string(&data, "ownerId")?
        .parse()
        .map_err(|_| ApiError::BadRequest("invalid ownerId".into()))?;
    for key in ["decisions", "metrics", "constraints"] {
        if !data[key].is_object() {
            return Err(ApiError::BadRequest(format!("{key} must be an object")));
        }
    }
    for key in ["metrics", "constraints"] {
        if data[key]
            .as_object()
            .unwrap()
            .values()
            .any(|v| v.as_f64().is_none())
        {
            return Err(ApiError::BadRequest(format!(
                "{key} values must be finite numbers"
            )));
        }
    }
    let spec: Value = sqlx::query_scalar("SELECT spec FROM studies WHERE id=$1")
        .bind(string(&data, "studyId")?)
        .fetch_optional(&s.db)
        .await?
        .ok_or_else(|| ApiError::BadRequest("unknown study".into()))?;
    let phase = string(&data, "phase")?;
    let seeds = if phase == "validation" {
        &spec["validationSeeds"]
    } else {
        &spec["searchSeeds"]
    };
    if !seeds
        .as_array()
        .is_some_and(|seeds| seeds.contains(&data["seed"]))
    {
        return Err(ApiError::BadRequest(
            "seed is outside the declared phase seed set".into(),
        ));
    }
    if data["status"] == "completed" {
        for goal in spec["objectives"]
            .as_object()
            .into_iter()
            .flat_map(|v| v.values())
            .chain(
                spec["constraints"]
                    .as_object()
                    .into_iter()
                    .flat_map(|v| v.values()),
            )
        {
            let metric = goal["metric"]
                .as_str()
                .ok_or_else(|| ApiError::BadRequest("invalid goal".into()))?;
            if data["metrics"][metric].as_f64().is_none() {
                return Err(ApiError::BadRequest(format!(
                    "missing required metric {metric}"
                )));
            }
        }
        if data["constraints"]["domain_validity"].as_f64().is_none() {
            return Err(ApiError::BadRequest("missing domain validity".into()));
        }
    }
    let owns:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM study_runs WHERE run_id=$1 AND study_id=$2 UNION ALL SELECT 1 FROM study_jobs WHERE id=$1 AND study_id=$2)").bind(owner).bind(string(&data,"studyId")?).fetch_one(&s.db).await?;
    if !owns {
        return Err(ApiError::BadRequest(
            "evaluation owner does not belong to study".into(),
        ));
    }
    let count=sqlx::query("INSERT INTO study_evaluations(id,study_id,owner_id,candidate_id,phase,status,cache_key,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,status=EXCLUDED.status WHERE study_evaluations.cache_key=EXCLUDED.cache_key AND study_evaluations.owner_id=EXCLUDED.owner_id AND study_evaluations.phase=EXCLUDED.phase AND study_evaluations.study_id=EXCLUDED.study_id AND study_evaluations.candidate_id=EXCLUDED.candidate_id AND (study_evaluations.status<>'completed' OR (study_evaluations.data->'metrics'=EXCLUDED.data->'metrics' AND study_evaluations.data->'decisions'=EXCLUDED.data->'decisions' AND study_evaluations.data->'constraints'=EXCLUDED.data->'constraints'))")
 .bind(string(&data,"id")?).bind(string(&data,"studyId")?).bind(owner).bind(string(&data,"candidateId")?).bind(string(&data,"phase")?).bind(string(&data,"status")?).bind(string(&data,"cacheKey")?).bind(&data).execute(&s.db).await?.rows_affected();
    if count == 0 {
        return Err(ApiError::Conflict(
            "evaluation identity changed across retry".into(),
        ));
    }
    Ok(Json(data))
}
async fn cache(
    State(s): State<Arc<AppState>>,
    Path(key): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(sqlx::query_scalar("SELECT data FROM study_evaluations WHERE cache_key=$1 AND status='completed' ORDER BY created_at LIMIT 1").bind(key).fetch_optional(&s.db).await?.unwrap_or(Value::Null)))
}
async fn history(
    State(s): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(f): Query<Filter>,
) -> Result<Json<Value>, ApiError> {
    Ok(page(sqlx::query_scalar("SELECT data FROM study_evaluations WHERE owner_id=$1 AND ($2::text IS NULL OR phase=$2) AND ($3::text IS NULL OR status=$3) AND ($4::text IS NULL OR candidate_id=$4) ORDER BY created_at,id LIMIT 50 OFFSET $5").bind(id).bind(f.phase).bind(f.status).bind(f.candidate_id).bind(f.offset.max(0)).fetch_all(&s.db).await?,f.offset.max(0)))
}
#[derive(Serialize)]
struct Validated {
    candidate_id: String,
    decisions: Value,
    metrics: Value,
    constraints: Value,
    seed_count: usize,
}
async fn validated(s: &AppState, id: Uuid) -> Result<Value, ApiError> {
    let spec: Value = sqlx::query_scalar(
        "SELECT s.spec FROM studies s JOIN study_runs r ON r.study_id=s.id WHERE r.run_id=$1",
    )
    .bind(id)
    .fetch_optional(&s.db)
    .await?
    .ok_or_else(|| ApiError::NotFound("study run".into()))?;
    let records:Vec<Value>=sqlx::query_scalar("SELECT data FROM study_evaluations WHERE owner_id=$1 AND phase='validation' AND status='completed' ORDER BY candidate_id,id").bind(id).fetch_all(&s.db).await?;
    let expected = spec["validationSeeds"].as_array().map_or(0, Vec::len);
    let mut groups: std::collections::BTreeMap<String, Vec<Value>> =
        std::collections::BTreeMap::new();
    for r in records {
        groups
            .entry(r["candidateId"].as_str().unwrap_or_default().into())
            .or_default()
            .push(r);
    }
    let mut candidates = Vec::new();
    for (candidate_id, rows) in groups {
        if rows.len() != expected || expected == 0 {
            continue;
        }
        if rows
            .iter()
            .map(|r| r["seed"].as_u64())
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != expected
        {
            continue;
        }
        if rows.iter().any(|r| {
            r["metrics"]
                .as_object()
                .map(|m| m.keys().collect::<Vec<_>>())
                != rows[0]["metrics"]
                    .as_object()
                    .map(|m| m.keys().collect::<Vec<_>>())
                || r["constraints"]
                    .as_object()
                    .map(|m| m.keys().collect::<Vec<_>>())
                    != rows[0]["constraints"]
                        .as_object()
                        .map(|m| m.keys().collect::<Vec<_>>())
        }) {
            continue;
        }
        let mut metrics = serde_json::Map::new();
        let mut constraints = serde_json::Map::new();
        for key in rows[0]["metrics"].as_object().unwrap().keys() {
            let mean = rows
                .iter()
                .map(|r| r["metrics"][key].as_f64().unwrap_or(0.0))
                .sum::<f64>()
                / expected as f64;
            metrics.insert(key.clone(), json!(mean));
        }
        for key in rows[0]["constraints"].as_object().unwrap().keys() {
            let mean = rows
                .iter()
                .map(|r| r["constraints"][key].as_f64().unwrap_or(0.0))
                .sum::<f64>()
                / expected as f64;
            constraints.insert(key.clone(), json!(mean));
        }
        candidates.push(Validated {
            candidate_id,
            decisions: rows[0]["decisions"].clone(),
            metrics: Value::Object(metrics),
            constraints: Value::Object(constraints),
            seed_count: expected,
        });
    }
    let objectives = spec["objectives"]
        .as_object()
        .ok_or_else(|| ApiError::Internal("missing goals".into()))?;
    let violation = |c: &Validated| {
        c.constraints
            .as_object()
            .unwrap()
            .values()
            .map(|v| v.as_f64().unwrap_or(0.0).max(0.0))
            .sum::<f64>()
    };
    let dominates = |a: &Validated, b: &Validated| {
        let va = violation(a);
        let vb = violation(b);
        if va > 0.0 || vb > 0.0 {
            return va + 1e-12 < vb;
        }
        let mut better = false;
        for o in objectives.values() {
            let key = o["metric"].as_str().unwrap();
            let sign = if o["direction"] == "maximize" {
                -1.0
            } else {
                1.0
            };
            let x = a.metrics[key].as_f64().unwrap() * sign;
            let y = b.metrics[key].as_f64().unwrap() * sign;
            if x > y + 1e-12 {
                return false;
            }
            if x + 1e-12 < y {
                better = true;
            }
        }
        better
    };
    let front: Vec<_> = candidates
        .iter()
        .filter(|b| !candidates.iter().any(|a| dominates(a, b)))
        .collect();
    Ok(json!(front))
}
async fn results(
    State(s): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let Json(search) = super::run_results(State(s.clone()), Path(id)).await?;
    Ok(Json(
        json!({"search":search,"validated":validated(&s,id).await?}),
    ))
}
async fn export(
    State(s): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    let Json(result) = results(State(s.clone()), Path(id)).await?;
    let records: Vec<Value> = sqlx::query_scalar(
        "SELECT data FROM study_evaluations WHERE owner_id=$1 ORDER BY created_at,id",
    )
    .bind(id)
    .fetch_all(&s.db)
    .await?;
    let study:Value=sqlx::query_scalar("SELECT jsonb_build_object('id',s.id,'spec',s.spec,'runtime',s.runtime) FROM studies s JOIN study_runs r ON r.study_id=s.id WHERE r.run_id=$1").bind(id).fetch_one(&s.db).await?;
    Ok(Json(
        json!({"schemaVersion":2,"study":study,"results":result,"evaluations":records,"datasets":sqlx::query_scalar::<_,Value>("SELECT data FROM study_datasets WHERE study_id=$1 ORDER BY created_at,id").bind(study["id"].as_str()).fetch_all(&s.db).await?}),
    ))
}
async fn register_dataset(
    State(s): State<Arc<AppState>>,
    Json(data): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let resources = data["resources"]
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("resources must be an object".into()))?;
    if !resources.contains_key(string(&data, "manifestKey")?) {
        return Err(ApiError::BadRequest("dataset manifest is missing".into()));
    }
    for (key, value) in resources {
        if key.starts_with('/') || key.split('/').any(|v| v == ".." || v.is_empty()) {
            return Err(ApiError::BadRequest("unsafe resource key".into()));
        }
        let id: Uuid = parse(value.clone())?;
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM artifacts WHERE id=$1)")
            .bind(id)
            .fetch_one(&s.db)
            .await?;
        if !exists {
            return Err(ApiError::BadRequest("missing dataset resource".into()));
        }
    }
    let owner: Uuid = parse(data["ownerId"].clone())?;
    sqlx::query("INSERT INTO study_datasets(id,owner_id,study_id,data) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING").bind(string(&data,"id")?).bind(owner).bind(string(&data,"studyId")?).bind(&data).execute(&s.db).await?;
    Ok(Json(data))
}
async fn datasets(
    State(s): State<Arc<AppState>>,
    Query(f): Query<Filter>,
) -> Result<Json<Value>, ApiError> {
    let owner = f
        .owner_id
        .ok_or_else(|| ApiError::BadRequest("ownerId is required".into()))?;
    Ok(Json(json!(
        sqlx::query_scalar::<_, Value>(
            "SELECT data FROM study_datasets WHERE owner_id=$1 ORDER BY created_at,id"
        )
        .bind(owner)
        .fetch_all(&s.db)
        .await?
    )))
}
async fn resource(
    State(s): State<Arc<AppState>>,
    Path((id, key)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    let data: Value = sqlx::query_scalar("SELECT data FROM study_datasets WHERE id=$1")
        .bind(id)
        .fetch_optional(&s.db)
        .await?
        .ok_or_else(|| ApiError::NotFound("dataset".into()))?;
    let id: Uuid = parse(data["resources"][key].clone())?;
    super::get_artifact(State(s), Path(id)).await
}
async fn create_job(
    State(s): State<Arc<AppState>>,
    Path(study_id): Path<String>,
    Json(request): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let kind = string(&request, "kind")?;
    if !["baseline", "replay"].contains(&kind) {
        return Err(ApiError::BadRequest("unknown job kind".into()));
    }
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO study_jobs(id,study_id,kind,request) VALUES($1,$2,$3,$4)")
        .bind(id)
        .bind(study_id)
        .bind(kind)
        .bind(&request)
        .execute(&s.db)
        .await?;
    get_job(State(s), Path(id)).await
}
async fn list_jobs(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Query(f): Query<Filter>,
) -> Result<Json<Value>, ApiError> {
    Ok(page(sqlx::query_scalar("SELECT to_jsonb(j) FROM study_jobs j WHERE study_id=$1 ORDER BY created_at DESC,id LIMIT 50 OFFSET $2").bind(id).bind(f.offset.max(0)).fetch_all(&s.db).await?,f.offset.max(0)))
}
async fn get_job(
    State(s): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        sqlx::query_scalar("SELECT to_jsonb(j) FROM study_jobs j WHERE id=$1")
            .bind(id)
            .fetch_optional(&s.db)
            .await?
            .ok_or_else(|| ApiError::NotFound("job".into()))?,
    ))
}
async fn cancel_job(
    State(s): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    sqlx::query("UPDATE study_jobs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END WHERE id=$1").bind(id).execute(&s.db).await?;
    get_job(State(s), Path(id)).await
}

pub async fn jobs(state: Arc<AppState>) {
    let _=sqlx::query("UPDATE study_jobs SET status=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'queued' END WHERE status='running'").execute(&state.db).await;
    loop {
        if let Err(e) = one_job(&state).await {
            tracing::error!("study job: {e}");
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}
async fn one_job(s: &Arc<AppState>) -> Result<(), ApiError> {
    let job:Option<(Uuid,String,String,Value)>=sqlx::query_as("UPDATE study_jobs SET status='running' WHERE id=(SELECT id FROM study_jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,study_id,kind,request").fetch_optional(&s.db).await?;
    let Some((id, study_id, kind, request)) = job else {
        return Ok(());
    };
    let outcome = execute_job(s, id, &study_id, &kind, &request).await;
    let (status, result, error) = match outcome {
        Ok(value) => ("completed", Some(value), None),
        Err(error) if error == "cancelled" => ("cancelled", None, None),
        Err(error) => ("failed", None, Some(error)),
    };
    sqlx::query("UPDATE study_jobs SET status=$2,result=$3,error=$4 WHERE id=$1")
        .bind(id)
        .bind(status)
        .bind(result)
        .bind(error)
        .execute(&s.db)
        .await?;
    Ok(())
}
async fn execute_job(
    s: &Arc<AppState>,
    id: Uuid,
    study_id: &str,
    kind: &str,
    request: &Value,
) -> Result<Value, String> {
    let launch:Value=sqlx::query_scalar("SELECT a.launch FROM adapter_revisions a JOIN studies s ON s.adapter_revision_id=a.id WHERE s.id=$1").bind(study_id).fetch_one(&s.db).await.map_err(|e|e.to_string())?;
    let launch: AdapterLaunch = serde_json::from_value(launch).map_err(|e| e.to_string())?;
    let payload = json!({"id":id,"studyId":study_id,"kind":kind,"identity":launch.adapter_version,"decisions":request.get("decisions"),"candidateId":request.get("candidateId")});
    let mut command = tokio::process::Command::new(&launch.command);
    command
        .args(&launch.args)
        .envs(&launch.environment)
        .env("GA_JOB_REQUEST", payload.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = &launch.working_directory {
        command.current_dir(dir);
    }
    #[cfg(unix)]
    command.process_group(0);
    let child = command.spawn().map_err(|e| e.to_string())?;
    #[cfg(unix)]
    let group = ProcessGroup(child.id().unwrap_or(0) as i32);
    let output = child.wait_with_output();
    tokio::pin!(output);
    let cancellation = async {
        loop {
            tokio::time::sleep(Duration::from_millis(200)).await;
            let cancelled: bool =
                sqlx::query_scalar("SELECT cancel_requested FROM study_jobs WHERE id=$1")
                    .bind(id)
                    .fetch_one(&s.db)
                    .await
                    .unwrap_or(true);
            if cancelled {
                break;
            }
        }
    };
    let result = tokio::select! {result=&mut output=>{let result=result.map_err(|e|e.to_string())?;if !result.status.success(){Err(String::from_utf8_lossy(&result.stderr).chars().take(4096).collect())}else{serde_json::from_slice(&result.stdout).map_err(|e|e.to_string())}},_=cancellation=>Err("cancelled".into()),_=tokio::time::sleep(Duration::from_millis(launch.timeout_ms))=>Err("job timed out".into())};
    #[cfg(unix)]
    drop(group);
    result
}
#[cfg(unix)]
struct ProcessGroup(i32);
#[cfg(unix)]
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        if self.0 > 0 {
            unsafe {
                libc::kill(-self.0, libc::SIGKILL);
            }
        }
    }
}
