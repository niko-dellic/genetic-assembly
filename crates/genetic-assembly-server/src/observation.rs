use super::*;
use axum::extract::Query;
use serde::Deserialize;
use serde_json::Value;
#[derive(Default, Deserialize)]
pub struct Cursor {
    #[serde(default)]
    after: i64,
    #[serde(default)]
    offset: i64,
    limit: Option<i64>,
}
pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/v3/operations/{id}/events", get(events).post(record))
        .route("/v3/operations/{id}/generations", get(generations))
}
async fn owns(s: &AppState, id: Uuid) -> Result<(), ApiError> {
    let exists:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM runs WHERE id=$1 UNION ALL SELECT 1 FROM study_jobs WHERE id=$1)").bind(id).fetch_one(&s.db).await?;
    if !exists {
        return Err(ApiError::NotFound("operation".into()));
    }
    Ok(())
}
pub(crate) async fn append(s: &AppState, id: Uuid, event: Value) -> Result<(), ApiError> {
    let key = if matches!(
        event["type"].as_str(),
        Some("completed" | "failed" | "cancelled")
    ) {
        "terminal".to_owned()
    } else {
        format!(
            "{}:{}:{}:{}:{}",
            event["type"], event["phase"], event["candidateId"], event["seed"], event["generation"]
        )
    };
    let event = json!({"operationId":id,"active":0,"queued":0})
        .as_object()
        .unwrap()
        .iter()
        .chain(
            event
                .as_object()
                .ok_or_else(|| ApiError::BadRequest("event must be an object".into()))?
                .iter(),
        )
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect::<serde_json::Map<_, _>>();
    let mut tx = s.db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(id.to_string())
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO operation_events(owner_id,event_key,event) VALUES($1,$2,$3) ON CONFLICT(owner_id,event_key) DO NOTHING").bind(id).bind(key).bind(Value::Object(event)).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}
async fn record(
    State(s): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Json(event): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    owns(&s, id).await?;
    if !matches!(
        event["type"].as_str(),
        Some("phase" | "evaluation-started" | "evaluation-completed" | "evaluation-failed")
    ) {
        return Err(ApiError::BadRequest("unsupported evaluator event".into()));
    }
    append(&s, id, event).await?;
    Ok(Json(json!({"ok":true})))
}
async fn events(
    State(s): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(c): Query<Cursor>,
) -> Result<Json<Value>, ApiError> {
    owns(&s, id).await?;
    let items:Vec<Value>=sqlx::query_scalar("SELECT event || jsonb_build_object('sequence',sequence) FROM operation_events WHERE owner_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 1000").bind(id).bind(c.after.max(0)).fetch_all(&s.db).await?;
    Ok(Json(json!({"items":items})))
}
async fn generations(
    State(s): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
    Query(c): Query<Cursor>,
) -> Result<Json<Value>, ApiError> {
    owns(&s, id).await?;
    let limit = c.limit.unwrap_or(50).clamp(1, 1000);
    let items: Vec<Value> = sqlx::query_scalar("SELECT snapshot FROM operation_generations WHERE owner_id=$1 ORDER BY generation LIMIT $3 OFFSET $2").bind(id).bind(c.offset.max(0)).bind(limit + 1).fetch_all(&s.db).await?;
    let next = (items.len() > limit as usize).then_some(c.offset.max(0) + limit);
    Ok(Json(
        json!({"items":items.into_iter().take(limit as usize).collect::<Vec<_>>(),"nextOffset":next}),
    ))
}

pub(crate) async fn snapshot(
    state: &AppState,
    run_id: Uuid,
    checkpoint: &genetic_assembly_core::Checkpoint,
    summary: &genetic_assembly_core::GenerationSummary,
) -> Result<Value, String> {
    let upper = (checkpoint.generation + 1) * checkpoint.config.population_size;
    let lower = checkpoint.generation * checkpoint.config.population_size;
    let records:Vec<Value>=sqlx::query_scalar("SELECT data FROM study_evaluations WHERE owner_id=$1 AND phase='search' AND candidate_id::bigint < $2 ORDER BY candidate_id::bigint,id").bind(run_id).bind(upper as i64).fetch_all(&state.db).await.map_err(|e|e.to_string())?;
    let mut grouped = std::collections::BTreeMap::<String, Vec<Value>>::new();
    for record in records {
        grouped
            .entry(record["candidateId"].as_str().unwrap_or_default().into())
            .or_default()
            .push(record);
    }
    let mut scored: Vec<(String, Vec<f64>)> = Vec::new();
    let spec: Option<Value> = sqlx::query_scalar(
        "SELECT spec FROM studies s JOIN study_runs r ON s.id=r.study_id WHERE r.run_id=$1",
    )
    .bind(run_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?;
    if let Some(spec) = spec {
        for (id, rows) in grouped {
            if rows.len() != spec["searchSeeds"].as_array().map_or(0, Vec::len)
                || rows.iter().any(|r| r["status"] != "completed")
            {
                continue;
            }
            let violated = rows[0]["constraints"]
                .as_object()
                .into_iter()
                .flat_map(|m| m.keys())
                .any(|key| {
                    rows.iter()
                        .map(|r| r["constraints"][key].as_f64().unwrap_or(1.0))
                        .sum::<f64>()
                        > 0.0
                });
            if violated {
                continue;
            }
            let scores = spec["objectives"]
                .as_object()
                .into_iter()
                .flat_map(|m| m.values())
                .map(|goal| {
                    let key = goal["metric"].as_str().unwrap_or_default();
                    let mean = rows
                        .iter()
                        .map(|r| r["metrics"][key].as_f64().unwrap_or(0.0))
                        .sum::<f64>()
                        / rows.len() as f64;
                    mean * if goal["direction"] == "maximize" {
                        -1.0
                    } else {
                        1.0
                    }
                })
                .collect();
            scored.push((id, scores));
        }
    }
    scored.sort_by_key(|(id, _)| id.parse::<u64>().unwrap_or(u64::MAX));
    let discovered: Vec<_> = scored
        .iter()
        .filter(|(_, b)| {
            !scored.iter().any(|(_, a)| {
                a.iter().zip(b).all(|(x, y)| *x <= y + 1e-12)
                    && a.iter().zip(b).any(|(x, y)| *x + 1e-12 < *y)
            })
        })
        .map(|(id, _)| id)
        .collect();
    Ok(
        json!({"generation":checkpoint.generation,"summary":summary,"evaluatedCandidateIds":(lower..upper).map(|id|id.to_string()).collect::<Vec<_>>(),"population":checkpoint.population.iter().map(|c|json!({"candidateId":c.id.to_string(),"rank":c.rank,"crowdingDistance":c.crowding_distance})).collect::<Vec<_>>(),"paretoCandidateIds":checkpoint.population.iter().filter(|c|c.rank==0&&c.feasible()).map(|c|c.id.to_string()).collect::<Vec<_>>(),"discoveredParetoCandidateIds":discovered}),
    )
}
