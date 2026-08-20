use crate::models::{AdapterRow, ClaimedRun, EvaluatorRow, ProblemRow, RunEvent, SceneRow};
use crate::{AppState, emit_event};
use genetic_assembly_adapter::{AdapterSession, OperatorMode};
use genetic_assembly_core::{
    Checkpoint, EvaluationRequest, Nsga2Config, ProblemSpec, RunControl, run_nsga2, run_nsga2_batch,
};
use genetic_assembly_scene::SceneGeometry;
use genetic_assembly_script::ScriptEvaluator;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::collections::{BTreeMap, HashMap};
use std::io::Cursor;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::mpsc;
use tracing::{error, info};
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
struct StoredCheckpoint {
    #[serde(default)]
    scene_hash: String,
    #[serde(default)]
    evaluator_hash: String,
    #[serde(default)]
    bindings: BTreeMap<String, String>,
    checkpoint: Checkpoint,
}

pub async fn run_executor(state: Arc<AppState>) {
    loop {
        if let Err(error) = recover_expired(&state.db).await {
            error!(%error, "failed to recover expired run leases");
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            continue;
        }
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
        WITH executor_guard AS (
          SELECT pg_try_advisory_xact_lock(3141592653589793) AS acquired
        ), candidate AS (
          SELECT queued.id
          FROM runs queued, executor_guard
          WHERE executor_guard.acquired
            AND queued.status='queued'
            AND queued.cancel_requested=false
            AND NOT EXISTS (SELECT 1 FROM runs active WHERE active.status='running')
          ORDER BY queued.created_at
          FOR UPDATE OF queued SKIP LOCKED
          LIMIT 1
        )
        UPDATE runs SET status='running', started_at=COALESCE(started_at, now()),
          lease_expires_at=now() + interval '2 minutes'
        WHERE id = (SELECT id FROM candidate)
        RETURNING id, scene_revision_id, evaluator_revision_id,
          problem_revision_id, adapter_revision_id, config, checkpoint_key
    "#,
    )
    .fetch_optional(db)
    .await
}

async fn execute_run(state: Arc<AppState>, run: ClaimedRun) -> Result<(), String> {
    emit_event(
        &state,
        RunEvent::Status {
            run_id: run.id,
            status: "running".into(),
        },
    )
    .await
    .map_err(|error| error.to_string())?;
    let cancellation = Arc::new(AtomicBool::new(false));
    state
        .cancellations
        .write()
        .await
        .insert(run.id, cancellation.clone());
    let outcome = execute_run_inner(state.clone(), &run, cancellation.clone()).await;
    state.cancellations.write().await.remove(&run.id);
    if let Err(error) = &outcome {
        if cancellation.load(Ordering::Relaxed) {
            sqlx::query("UPDATE runs SET status='cancelled', error=NULL, finished_at=now(), lease_expires_at=NULL WHERE id=$1")
                .bind(run.id).execute(&state.db).await.map_err(|db_error| db_error.to_string())?;
            emit_event(
                &state,
                RunEvent::Status {
                    run_id: run.id,
                    status: "cancelled".into(),
                },
            )
            .await
            .map_err(|event_error| event_error.to_string())?;
            return Ok(());
        }
        sqlx::query("UPDATE runs SET status='failed', error=$2, finished_at=now(), lease_expires_at=NULL WHERE id=$1")
            .bind(run.id).bind(error).execute(&state.db).await.map_err(|db_error| db_error.to_string())?;
        emit_event(
            &state,
            RunEvent::Failed {
                run_id: run.id,
                error: error.clone(),
            },
        )
        .await
        .map_err(|event_error| event_error.to_string())?;
    }
    outcome
}

async fn execute_run_inner(
    state: Arc<AppState>,
    run: &ClaimedRun,
    cancellation: Arc<AtomicBool>,
) -> Result<(), String> {
    if run.problem_revision_id.is_some() {
        return execute_generic_run_inner(state, run, cancellation).await;
    }
    let scene_revision_id = run
        .scene_revision_id
        .ok_or_else(|| "run has no scene revision".to_string())?;
    let evaluator_revision_id = run
        .evaluator_revision_id
        .ok_or_else(|| "run has no evaluator revision".to_string())?;
    let scene_row = sqlx::query_as::<_, SceneRow>(
        "SELECT manifest, artifact_key, content_hash FROM scene_revisions WHERE id=$1",
    )
    .bind(scene_revision_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "scene revision disappeared".to_string())?;
    let evaluator_row = sqlx::query_as::<_, EvaluatorRow>(
        "SELECT source, manifest, limits, source_hash FROM evaluator_revisions WHERE id=$1",
    )
    .bind(evaluator_revision_id)
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
    let bindings = BTreeMap::from([
        ("kind".into(), "three".into()),
        ("scene".into(), scene_row.content_hash.clone()),
        ("evaluator".into(), evaluator_row.source_hash.clone()),
        ("engine".into(), env!("CARGO_PKG_VERSION").to_string()),
    ]);
    let resume = if let Some(key) = &run.checkpoint_key {
        let bytes = state.artifacts.get(key).await.map_err(|e| e.to_string())?;
        let decoded = zstd::decode_all(Cursor::new(bytes)).map_err(|e| e.to_string())?;
        let stored: StoredCheckpoint =
            rmp_serde::from_slice(&decoded).map_err(|e| e.to_string())?;
        let legacy_matches = stored.scene_hash == scene_row.content_hash
            && stored.evaluator_hash == evaluator_row.source_hash;
        if !legacy_matches && stored.bindings != bindings {
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
    let persist_bindings = bindings.clone();
    let persist_cancel = cancellation.clone();
    let persistence_task = tokio::spawn(async move {
        while let Some((checkpoint, summary)) = progress_rx.recv().await {
            persist_summary(&persistence_state, run_id, &summary).await?;
            emit_event(
                &persistence_state,
                RunEvent::Generation {
                    run_id,
                    summary: summary.clone(),
                },
            )
            .await
            .map_err(|error| error.to_string())?;
            if summary.generation % 5 == 0 || persist_cancel.load(Ordering::Relaxed) {
                persist_checkpoint(&persistence_state, run_id, &persist_bindings, &checkpoint)
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
    persist_checkpoint(&state, run.id, &bindings, &result.checkpoint).await?;

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
        sqlx::query("INSERT INTO run_front_members(run_id, member_index, individual, patches, materialization) VALUES ($1,$2,$3,$4,NULL)")
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
    if status == "cancelled" {
        emit_event(
            &state,
            RunEvent::Status {
                run_id: run.id,
                status: status.into(),
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    } else {
        emit_event(
            &state,
            RunEvent::Completed {
                run_id: run.id,
                pareto_size: result.pareto_front.len(),
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    }
    info!(run_id=%run.id, generations=result.generations, pareto=result.pareto_front.len(), "run finished");
    Ok(())
}

async fn execute_generic_run_inner(
    state: Arc<AppState>,
    run: &ClaimedRun,
    cancellation: Arc<AtomicBool>,
) -> Result<(), String> {
    let problem_revision_id = run
        .problem_revision_id
        .ok_or_else(|| "run has no problem revision".to_string())?;
    let adapter_revision_id = run
        .adapter_revision_id
        .ok_or_else(|| "run has no adapter revision".to_string())?;
    let problem_row = sqlx::query_as::<_, ProblemRow>(
        "SELECT bundle,content_hash FROM problem_revisions WHERE id=$1",
    )
    .bind(problem_revision_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "problem revision disappeared".to_string())?;
    let adapter_row = sqlx::query_as::<_, AdapterRow>(
        "SELECT launch,content_hash FROM adapter_revisions WHERE id=$1",
    )
    .bind(adapter_revision_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "adapter revision disappeared".to_string())?;
    let bundle = problem_row
        .parsed_bundle()
        .map_err(|error| error.to_string())?;
    let launch = adapter_row
        .parsed_launch()
        .map_err(|error| error.to_string())?;
    let config: Nsga2Config =
        serde_json::from_value(run.config.clone()).map_err(|error| error.to_string())?;
    let problem = bundle.problem.clone();
    let bindings = BTreeMap::from([
        ("kind".into(), "adapter".into()),
        ("problem".into(), problem_row.content_hash.clone()),
        ("adapter".into(), adapter_row.content_hash.clone()),
        ("protocol".into(), launch.protocol_version.clone()),
        ("engine".into(), env!("CARGO_PKG_VERSION").to_string()),
    ]);
    let resume = if let Some(key) = &run.checkpoint_key {
        let bytes = state.artifacts.get(key).await.map_err(|e| e.to_string())?;
        let decoded = zstd::decode_all(Cursor::new(bytes)).map_err(|e| e.to_string())?;
        let stored: StoredCheckpoint =
            rmp_serde::from_slice(&decoded).map_err(|e| e.to_string())?;
        if stored.bindings != bindings {
            return Err("checkpoint problem, adapter, protocol, or engine hash changed".into());
        }
        Some(stored.checkpoint)
    } else {
        None
    };

    let (progress_tx, mut progress_rx) = mpsc::unbounded_channel();
    let run_id = run.id;
    let solve_cancel = cancellation.clone();
    let solve_task = tokio::task::spawn_blocking(move || {
        let adapter = Arc::new(
            AdapterSession::launch(launch, run_id.to_string(), bundle)
                .map_err(|error| error.to_string())?,
        );
        let finished = Arc::new(AtomicBool::new(false));
        let monitor_adapter = adapter.clone();
        let monitor_cancel = solve_cancel.clone();
        let monitor_finished = finished.clone();
        let monitor = std::thread::spawn(move || {
            while !monitor_finished.load(Ordering::Relaxed) {
                if monitor_cancel.load(Ordering::Relaxed) {
                    monitor_adapter.cancel();
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
        });
        let work = (|| {
            let operators = (adapter.capabilities().operator_mode == OperatorMode::Adapter)
                .then_some(adapter.as_ref() as &dyn genetic_assembly_core::GenomeOperator);
            let mut result = run_nsga2_batch(
                problem,
                config,
                adapter.as_ref(),
                operators,
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
            .map_err(|error| error.to_string())?;

            if adapter.capabilities().validate_front && !result.pareto_front.is_empty() {
                let requests: Vec<_> = result
                    .pareto_front
                    .iter()
                    .map(|individual| EvaluationRequest {
                        id: individual.id,
                        genes: individual.genes.clone(),
                    })
                    .collect();
                let validated = adapter
                    .validate_front(requests)
                    .map_err(|error| error.to_string())?;
                let validated: HashMap<_, _> = validated
                    .into_iter()
                    .map(|candidate| (candidate.id, candidate.evaluation))
                    .collect();
                for individual in &mut result.pareto_front {
                    if let Some(evaluation) = validated.get(&individual.id) {
                        let evidence = individual.evidence.get_or_insert_with(Default::default);
                        evidence.metadata.insert(
                            "validation_objectives".into(),
                            serde_json::to_string(&evaluation.objectives)
                                .map_err(|error| error.to_string())?,
                        );
                        evidence.metadata.insert(
                            "validation_constraints".into(),
                            serde_json::to_string(&evaluation.constraints)
                                .map_err(|error| error.to_string())?,
                        );
                    }
                }
            }
            let materializations = if adapter.capabilities().materialize {
                adapter
                    .materialize(
                        result
                            .pareto_front
                            .iter()
                            .map(|individual| EvaluationRequest {
                                id: individual.id,
                                genes: individual.genes.clone(),
                            })
                            .collect(),
                    )
                    .map_err(|error| error.to_string())?
            } else {
                vec![]
            };
            Ok::<_, String>((result, materializations))
        })();
        finished.store(true, Ordering::Relaxed);
        let _ = monitor.join();
        work
    });

    let persistence_state = state.clone();
    let persist_bindings = bindings.clone();
    let persist_cancel = cancellation.clone();
    let persistence_task = tokio::spawn(async move {
        while let Some((checkpoint, summary)) = progress_rx.recv().await {
            persist_summary(&persistence_state, run_id, &summary).await?;
            emit_event(
                &persistence_state,
                RunEvent::Generation {
                    run_id,
                    summary: summary.clone(),
                },
            )
            .await
            .map_err(|error| error.to_string())?;
            if summary.generation % 5 == 0 || persist_cancel.load(Ordering::Relaxed) {
                persist_checkpoint(&persistence_state, run_id, &persist_bindings, &checkpoint)
                    .await?;
            }
        }
        Ok::<(), String>(())
    });

    let (result, mut materializations) = solve_task.await.map_err(|error| error.to_string())??;
    persistence_task
        .await
        .map_err(|error| error.to_string())??;
    persist_checkpoint(&state, run.id, &bindings, &result.checkpoint).await?;

    for materialization in &mut materializations {
        let bytes = serde_json::to_vec(&materialization.data).map_err(|e| e.to_string())?;
        if bytes.len() > 64 * 1024 {
            let key = format!(
                "runs/{}/materializations/candidate-{}.json",
                run.id, materialization.id
            );
            state
                .artifacts
                .put(&key, bytes)
                .await
                .map_err(|error| error.to_string())?;
            materialization.artifact_key = Some(key);
            materialization.data = serde_json::Value::Null;
        }
    }
    let materializations: HashMap<_, _> = materializations
        .into_iter()
        .map(|candidate| (candidate.id, candidate))
        .collect();
    let result_key = format!("runs/{}/result.msgpack.zst", run.id);
    let encoded = rmp_serde::to_vec_named(&result).map_err(|error| error.to_string())?;
    let compressed =
        zstd::encode_all(Cursor::new(encoded), 6).map_err(|error| error.to_string())?;
    state
        .artifacts
        .put(&result_key, compressed)
        .await
        .map_err(|error| error.to_string())?;
    let mut transaction = state.db.begin().await.map_err(|error| error.to_string())?;
    sqlx::query("DELETE FROM run_front_members WHERE run_id=$1")
        .bind(run.id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    for (index, individual) in result.pareto_front.iter().enumerate() {
        sqlx::query("INSERT INTO run_front_members(run_id,member_index,individual,patches,materialization) VALUES($1,$2,$3,$4,$5)")
            .bind(run.id)
            .bind(index as i32)
            .bind(serde_json::to_value(individual).map_err(|error| error.to_string())?)
            .bind(serde_json::json!([]))
            .bind(materializations.get(&individual.id).map(serde_json::to_value).transpose().map_err(|error| error.to_string())?)
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
    }
    let status = if cancellation.load(Ordering::Relaxed) {
        "cancelled"
    } else {
        "completed"
    };
    sqlx::query("UPDATE runs SET status=$2,current_generation=$3,result_key=$4,finished_at=now(),lease_expires_at=NULL WHERE id=$1")
        .bind(run.id)
        .bind(status)
        .bind(result.generations as i32)
        .bind(&result_key)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    if status == "cancelled" {
        emit_event(
            &state,
            RunEvent::Status {
                run_id: run.id,
                status: status.into(),
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    } else {
        emit_event(
            &state,
            RunEvent::Completed {
                run_id: run.id,
                pareto_size: result.pareto_front.len(),
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    }
    info!(run_id=%run.id, generations=result.generations, pareto=result.pareto_front.len(), adapter=%adapter_row.content_hash, "adapter run finished");
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
    bindings: &BTreeMap<String, String>,
    checkpoint: &Checkpoint,
) -> Result<(), String> {
    let key = format!(
        "runs/{run_id}/checkpoints/generation-{}.msgpack.zst",
        checkpoint.generation
    );
    let stored = StoredCheckpoint {
        scene_hash: bindings.get("scene").cloned().unwrap_or_default(),
        evaluator_hash: bindings.get("evaluator").cloned().unwrap_or_default(),
        bindings: bindings.clone(),
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
    let already_emitted = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM run_events WHERE run_id=$1 AND event->>'type'='checkpoint' AND (event->>'generation')::bigint=$2)",
    )
    .bind(run_id)
    .bind(checkpoint.generation as i64)
    .fetch_one(&state.db)
    .await
    .map_err(|error| error.to_string())?;
    if !already_emitted {
        emit_event(
            state,
            RunEvent::Checkpoint {
                run_id,
                generation: checkpoint.generation,
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}
