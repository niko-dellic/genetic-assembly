use crate::AppState;
use crate::models::{ClaimedRun, EvaluatorRow, RunEvent, SceneRow};
use genetic_assembly_core::{Checkpoint, Nsga2Config, ProblemSpec, RunControl, run_nsga2};
use genetic_assembly_scene::SceneGeometry;
use genetic_assembly_script::ScriptEvaluator;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::io::Cursor;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::mpsc;
use tracing::{error, info};
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
struct StoredCheckpoint {
    scene_hash: String,
    evaluator_hash: String,
    checkpoint: Checkpoint,
}

pub async fn run_executor(state: Arc<AppState>) {
    if let Err(error) = recover_expired(&state.db).await {
        error!(%error, "failed to recover expired run leases");
    }
    loop {
        match claim_next(&state.db).await {
            Ok(Some(run)) => {
                if let Err(error) = execute_run(state.clone(), run).await {
                    error!(%error, "run execution failed");
                }
            }
            Ok(None) => tokio::time::sleep(std::time::Duration::from_millis(500)).await,
            Err(error) => {
                error!(%error, "failed to claim queued run");
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
    }
}

async fn recover_expired(db: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE runs SET status='queued', lease_expires_at=NULL WHERE status='running' AND lease_expires_at < now()")
        .execute(db).await?;
    Ok(())
}

async fn claim_next(db: &PgPool) -> Result<Option<ClaimedRun>, sqlx::Error> {
    sqlx::query_as::<_, ClaimedRun>(
        r#"
        UPDATE runs SET status='running', started_at=COALESCE(started_at, now()),
          lease_expires_at=now() + interval '2 minutes'
        WHERE id = (
          SELECT id FROM runs WHERE status='queued' AND cancel_requested=false
          ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
        )
        RETURNING id, scene_revision_id, evaluator_revision_id, config, checkpoint_key
    "#,
    )
    .fetch_optional(db)
    .await
}

async fn execute_run(state: Arc<AppState>, run: ClaimedRun) -> Result<(), String> {
    let sender = state.event_sender(run.id).await;
    let _ = sender.send(RunEvent::Status {
        run_id: run.id,
        status: "running".into(),
    });
    let cancellation = Arc::new(AtomicBool::new(false));
    state
        .cancellations
        .write()
        .await
        .insert(run.id, cancellation.clone());
    let outcome = execute_run_inner(state.clone(), &run, cancellation.clone()).await;
    state.cancellations.write().await.remove(&run.id);
    if let Err(error) = &outcome {
        sqlx::query("UPDATE runs SET status='failed', error=$2, finished_at=now(), lease_expires_at=NULL WHERE id=$1")
            .bind(run.id).bind(error).execute(&state.db).await.map_err(|db_error| db_error.to_string())?;
        let _ = sender.send(RunEvent::Failed {
            run_id: run.id,
            error: error.clone(),
        });
    }
    outcome
}

async fn execute_run_inner(
    state: Arc<AppState>,
    run: &ClaimedRun,
    cancellation: Arc<AtomicBool>,
) -> Result<(), String> {
    let scene_row = sqlx::query_as::<_, SceneRow>(
        "SELECT manifest, artifact_key, content_hash FROM scene_revisions WHERE id=$1",
    )
    .bind(run.scene_revision_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "scene revision disappeared".to_string())?;
    let evaluator_row = sqlx::query_as::<_, EvaluatorRow>(
        "SELECT source, manifest, limits, source_hash FROM evaluator_revisions WHERE id=$1",
    )
    .bind(run.evaluator_revision_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "evaluator revision disappeared".to_string())?;
    let glb = state
        .artifacts
        .get(&scene_row.artifact_key)
        .await
        .map_err(|e| e.to_string())?;
    let manifest = scene_row.parsed_manifest().map_err(|e| e.to_string())?;
    let scene = Arc::new(SceneGeometry::from_glb(&glb, manifest).map_err(|e| e.to_string())?);
    let evaluator_manifest = evaluator_row.parsed_manifest().map_err(|e| e.to_string())?;
    let evaluator_limits = evaluator_row.parsed_limits().map_err(|e| e.to_string())?;
    let evaluator = ScriptEvaluator::new(
        scene.clone(),
        Arc::<str>::from(evaluator_row.source),
        evaluator_manifest.clone(),
        evaluator_limits,
    )
    .map_err(|e| e.to_string())?;
    let config: Nsga2Config =
        serde_json::from_value(run.config.clone()).map_err(|e| e.to_string())?;
    let problem = ProblemSpec {
        variables: scene.variables(),
        objectives: evaluator_manifest.objectives,
    };
    let resume = if let Some(key) = &run.checkpoint_key {
        let bytes = state.artifacts.get(key).await.map_err(|e| e.to_string())?;
        let decoded = zstd::decode_all(Cursor::new(bytes)).map_err(|e| e.to_string())?;
        let stored: StoredCheckpoint =
            rmp_serde::from_slice(&decoded).map_err(|e| e.to_string())?;
        if stored.scene_hash != scene_row.content_hash
            || stored.evaluator_hash != evaluator_row.source_hash
        {
            return Err("checkpoint scene or evaluator hash does not match".into());
        }
        Some(stored.checkpoint)
    } else {
        None
    };

    let (progress_tx, mut progress_rx) = mpsc::unbounded_channel();
    let run_id = run.id;
    let solve_cancel = cancellation.clone();
    let solve_task = tokio::task::spawn_blocking(move || {
        run_nsga2(
            problem,
            config,
            &evaluator,
            resume,
            &solve_cancel,
            |checkpoint, summary| {
                let _ = progress_tx.send((checkpoint.clone(), summary.clone()));
                if solve_cancel.load(Ordering::Relaxed) {
                    RunControl::Stop
                } else {
                    RunControl::Continue
                }
            },
        )
    });

    let persistence_state = state.clone();
    let scene_hash = scene_row.content_hash.clone();
    let evaluator_hash = evaluator_row.source_hash.clone();
    let persist_cancel = cancellation.clone();
    let persistence_task = tokio::spawn(async move {
        while let Some((checkpoint, summary)) = progress_rx.recv().await {
            persist_summary(&persistence_state, run_id, &summary).await?;
            let _ = persistence_state
                .event_sender(run_id)
                .await
                .send(RunEvent::Generation {
                    run_id,
                    summary: summary.clone(),
                });
            if summary.generation % 5 == 0 || persist_cancel.load(Ordering::Relaxed) {
                persist_checkpoint(
                    &persistence_state,
                    run_id,
                    &scene_hash,
                    &evaluator_hash,
                    &checkpoint,
                )
                .await?;
            }
        }
        Ok::<(), String>(())
    });

    let result = solve_task
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    persistence_task.await.map_err(|e| e.to_string())??;
    persist_checkpoint(
        &state,
        run.id,
        &scene_row.content_hash,
        &evaluator_row.source_hash,
        &result.checkpoint,
    )
    .await?;

    let result_key = format!("runs/{}/result.msgpack.zst", run.id);
    let encoded = rmp_serde::to_vec_named(&result).map_err(|e| e.to_string())?;
    let compressed = zstd::encode_all(Cursor::new(encoded), 6).map_err(|e| e.to_string())?;
    state
        .artifacts
        .put(&result_key, compressed)
        .await
        .map_err(|e| e.to_string())?;
    let mut transaction = state.db.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM run_front_members WHERE run_id=$1")
        .bind(run.id)
        .execute(&mut *transaction)
        .await
        .map_err(|e| e.to_string())?;
    for (index, individual) in result.pareto_front.iter().enumerate() {
        let patches = scene
            .patches(&individual.genes)
            .map_err(|e| e.to_string())?;
        sqlx::query("INSERT INTO run_front_members(run_id, member_index, individual, patches) VALUES ($1,$2,$3,$4)")
            .bind(run.id).bind(index as i32)
            .bind(serde_json::to_value(individual).map_err(|e| e.to_string())?)
            .bind(serde_json::to_value(patches).map_err(|e| e.to_string())?)
            .execute(&mut *transaction).await.map_err(|e| e.to_string())?;
    }
    let status = if cancellation.load(Ordering::Relaxed) {
        "cancelled"
    } else {
        "completed"
    };
    sqlx::query("UPDATE runs SET status=$2, current_generation=$3, result_key=$4, finished_at=now(), lease_expires_at=NULL WHERE id=$1")
        .bind(run.id).bind(status).bind(result.generations as i32).bind(&result_key)
        .execute(&mut *transaction).await.map_err(|e| e.to_string())?;
    transaction.commit().await.map_err(|e| e.to_string())?;
    let events = state.event_sender(run.id).await;
    if status == "cancelled" {
        let _ = events.send(RunEvent::Status {
            run_id: run.id,
            status: status.into(),
        });
    } else {
        let _ = events.send(RunEvent::Completed {
            run_id: run.id,
            pareto_size: result.pareto_front.len(),
        });
    }
    info!(run_id=%run.id, generations=result.generations, pareto=result.pareto_front.len(), "run finished");
    Ok(())
}

async fn persist_summary(
    state: &AppState,
    run_id: Uuid,
    summary: &genetic_assembly_core::GenerationSummary,
) -> Result<(), String> {
    let json = serde_json::to_value(summary).map_err(|e| e.to_string())?;
    let mut transaction = state.db.begin().await.map_err(|e| e.to_string())?;
    sqlx::query(
        r#"
      INSERT INTO generation_summaries(run_id,generation,summary) VALUES($1,$2,$3)
      ON CONFLICT(run_id,generation) DO UPDATE SET summary=excluded.summary
    "#,
    )
    .bind(run_id)
    .bind(summary.generation as i32)
    .bind(json)
    .execute(&mut *transaction)
    .await
    .map_err(|e| e.to_string())?;
    sqlx::query("UPDATE runs SET current_generation=$2, lease_expires_at=now()+interval '2 minutes' WHERE id=$1")
        .bind(run_id).bind(summary.generation as i32).execute(&mut *transaction).await.map_err(|e| e.to_string())?;
    transaction.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn persist_checkpoint(
    state: &AppState,
    run_id: Uuid,
    scene_hash: &str,
    evaluator_hash: &str,
    checkpoint: &Checkpoint,
) -> Result<(), String> {
    let key = format!(
        "runs/{run_id}/checkpoints/generation-{}.msgpack.zst",
        checkpoint.generation
    );
    let stored = StoredCheckpoint {
        scene_hash: scene_hash.into(),
        evaluator_hash: evaluator_hash.into(),
        checkpoint: checkpoint.clone(),
    };
    let encoded = rmp_serde::to_vec_named(&stored).map_err(|e| e.to_string())?;
    let compressed = zstd::encode_all(Cursor::new(encoded), 6).map_err(|e| e.to_string())?;
    state
        .artifacts
        .put(&key, compressed)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("UPDATE runs SET checkpoint_key=$2, current_generation=$3 WHERE id=$1")
        .bind(run_id)
        .bind(&key)
        .bind(checkpoint.generation as i32)
        .execute(&state.db)
        .await
        .map_err(|e| e.to_string())?;
    let _ = state.event_sender(run_id).await.send(RunEvent::Checkpoint {
        run_id,
        generation: checkpoint.generation,
    });
    Ok(())
}
