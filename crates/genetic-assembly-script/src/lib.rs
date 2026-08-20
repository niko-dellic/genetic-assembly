//! Trusted project-authored JavaScript evaluation support.
//!
//! This is deliberately a safety harness, not a hostile-code security boundary.
//! Each Rayon thread owns a small QuickJS runtime; the heavy scene remains one
//! shared Rust allocation and candidates are passed as metric snapshots.

use genetic_assembly_core::{Evaluation, EvaluationError, Evaluator, Objective};
use genetic_assembly_scene::SceneGeometry;
use rquickjs::{Context, Runtime};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use thiserror::Error;

static NEXT_EVALUATOR_ID: AtomicU64 = AtomicU64::new(1);

thread_local! {
    static WORKERS: RefCell<HashMap<u64, JsWorker>> = RefCell::new(HashMap::new());
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Constraint {
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct EvaluatorManifest {
    #[serde(default = "api_version")]
    pub api_version: u32,
    pub objectives: Vec<Objective>,
    #[serde(default)]
    pub constraints: Vec<Constraint>,
}

const fn api_version() -> u32 {
    1
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct ScriptLimits {
    pub memory_bytes: usize,
    pub stack_bytes: usize,
    pub timeout_ms: u64,
}

impl Default for ScriptLimits {
    fn default() -> Self {
        Self {
            memory_bytes: 16 * 1024 * 1024,
            stack_bytes: 512 * 1024,
            timeout_ms: 250,
        }
    }
}

#[derive(Clone)]
pub struct ScriptEvaluator {
    id: u64,
    scene: Arc<SceneGeometry>,
    source: Arc<str>,
    manifest: Arc<EvaluatorManifest>,
    limits: ScriptLimits,
}

impl ScriptEvaluator {
    pub fn new(
        scene: Arc<SceneGeometry>,
        source: impl Into<Arc<str>>,
        manifest: EvaluatorManifest,
        limits: ScriptLimits,
    ) -> Result<Self, ScriptError> {
        validate_evaluator_manifest(&manifest)?;
        let source = source.into();
        validate_source(&source)?;
        JsWorker::new(&source, &limits)?;
        Ok(Self {
            id: NEXT_EVALUATOR_ID.fetch_add(1, Ordering::Relaxed),
            scene,
            source,
            manifest: Arc::new(manifest),
            limits,
        })
    }

    pub fn manifest(&self) -> &EvaluatorManifest {
        &self.manifest
    }
    pub fn scene(&self) -> &Arc<SceneGeometry> {
        &self.scene
    }
}

/// Compile an evaluator once without binding it to a scene. The server uses
/// this when creating immutable evaluator revisions.
pub fn validate_evaluator_source(source: &str, limits: &ScriptLimits) -> Result<(), ScriptError> {
    JsWorker::new(source, limits).map(|_| ())
}

pub fn validate_evaluator_manifest(manifest: &EvaluatorManifest) -> Result<(), ScriptError> {
    if manifest.api_version != 1 {
        return Err(ScriptError::Validation(
            "only evaluator API version 1 is supported".into(),
        ));
    }
    if manifest.objectives.is_empty() {
        return Err(ScriptError::Validation(
            "at least one objective is required".into(),
        ));
    }
    let mut names = std::collections::HashSet::new();
    if manifest
        .objectives
        .iter()
        .any(|objective| objective.name.trim().is_empty() || !names.insert(objective.name.as_str()))
    {
        return Err(ScriptError::Validation(
            "objective names must be non-empty and unique".into(),
        ));
    }
    names.clear();
    if manifest.constraints.iter().any(|constraint| {
        constraint.name.trim().is_empty() || !names.insert(constraint.name.as_str())
    }) {
        return Err(ScriptError::Validation(
            "constraint names must be non-empty and unique".into(),
        ));
    }
    Ok(())
}

impl Evaluator for ScriptEvaluator {
    fn evaluate(&self, genes: &[f64]) -> Result<Evaluation, EvaluationError> {
        let snapshot = self
            .scene
            .metric_snapshot(genes)
            .map_err(|error| EvaluationError::new(error.to_string()))?;
        let input = serde_json::to_string(&snapshot)
            .map_err(|error| EvaluationError::new(error.to_string()))?;
        WORKERS.with(|workers| {
            let mut workers = workers.borrow_mut();
            if let std::collections::hash_map::Entry::Vacant(entry) = workers.entry(self.id) {
                let worker = JsWorker::new(&self.source, &self.limits)
                    .map_err(|error| EvaluationError::new(error.to_string()))?;
                entry.insert(worker);
            }
            let evaluation = workers
                .get_mut(&self.id)
                .expect("worker was inserted")
                .evaluate(&input, self.limits.timeout_ms)
                .map_err(|error| EvaluationError::new(error.to_string()))?;
            if evaluation.objectives.len() != self.manifest.objectives.len() {
                return Err(EvaluationError::new(format!(
                    "evaluator returned {} objectives, manifest declares {}",
                    evaluation.objectives.len(),
                    self.manifest.objectives.len()
                )));
            }
            if !self.manifest.constraints.is_empty()
                && evaluation.constraints.len() != self.manifest.constraints.len()
            {
                return Err(EvaluationError::new(format!(
                    "evaluator returned {} constraints, manifest declares {}",
                    evaluation.constraints.len(),
                    self.manifest.constraints.len()
                )));
            }
            Ok(evaluation)
        })
    }
}

struct JsWorker {
    runtime: Runtime,
    context: Context,
}

impl JsWorker {
    fn new(source: &str, limits: &ScriptLimits) -> Result<Self, ScriptError> {
        if !(1024 * 1024..=256 * 1024 * 1024).contains(&limits.memory_bytes) {
            return Err(ScriptError::Validation(
                "memory_bytes must be between 1 MiB and 256 MiB".into(),
            ));
        }
        if !(64 * 1024..=8 * 1024 * 1024).contains(&limits.stack_bytes) {
            return Err(ScriptError::Validation(
                "stack_bytes must be between 64 KiB and 8 MiB".into(),
            ));
        }
        if !(1..=60_000).contains(&limits.timeout_ms) {
            return Err(ScriptError::Validation(
                "timeout_ms must be between 1 and 60000".into(),
            ));
        }
        let runtime = Runtime::new().map_err(|error| ScriptError::Runtime(error.to_string()))?;
        runtime.set_memory_limit(limits.memory_bytes);
        runtime.set_max_stack_size(limits.stack_bytes);
        // `full` enables language intrinsics such as Object/JSON/Math but does
        // not add filesystem, network, clocks, or module loaders.
        let context =
            Context::full(&runtime).map_err(|error| ScriptError::Runtime(error.to_string()))?;
        let program = normalized_program(source)?;
        context.with(|ctx| {
            ctx.eval::<(), _>(program)
                .map_err(|error| ScriptError::Compile(error.to_string()))
        })?;
        Ok(Self { runtime, context })
    }

    fn evaluate(&mut self, input: &str, timeout_ms: u64) -> Result<Evaluation, ScriptError> {
        let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(1));
        self.runtime
            .set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline)));
        let expression =
            format!("JSON.stringify(globalThis.__gaEvaluate(globalThis.__gaContext({input})))");
        let output = self.context.with(|ctx| {
            ctx.eval::<String, _>(expression)
                .map_err(|error| ScriptError::Execution(error.to_string()))
        })?;
        let evaluation: Evaluation = serde_json::from_str(&output)
            .map_err(|error| ScriptError::Result(error.to_string()))?;
        if evaluation
            .objectives
            .iter()
            .chain(&evaluation.constraints)
            .any(|value| !value.is_finite())
        {
            return Err(ScriptError::Result(
                "objectives and constraints must be finite".into(),
            ));
        }
        Ok(evaluation)
    }
}

fn validate_source(source: &str) -> Result<(), ScriptError> {
    if source.len() > 256 * 1024 {
        return Err(ScriptError::Validation(
            "evaluator source exceeds 256 KiB".into(),
        ));
    }
    for forbidden in [
        "import ",
        "import(",
        "require(",
        "fetch(",
        "XMLHttpRequest",
        "WebSocket",
        "Date.now",
        "Math.random",
    ] {
        if source.contains(forbidden) {
            return Err(ScriptError::Validation(format!(
                "`{forbidden}` is unavailable in evaluator scripts"
            )));
        }
    }
    if !source.contains("export function evaluate") {
        return Err(ScriptError::Validation(
            "script must export `function evaluate(ctx)`".into(),
        ));
    }
    Ok(())
}

fn normalized_program(source: &str) -> Result<String, ScriptError> {
    validate_source(source)?;
    let source = source.replacen("export function evaluate", "function evaluate", 1);
    Ok(format!(
        r#"
"use strict";
Object.defineProperty(Math, "random", {{ value: undefined, writable: false, configurable: false }});
globalThis.Date = undefined;
globalThis.performance = undefined;
{source}
globalThis.__gaEvaluate = evaluate;
globalThis.__gaContext = function(input) {{
  const object = function(id) {{
    const value = input.objects[id];
    if (!value) throw new Error(`unknown object ${{id}}`);
    return value;
  }};
  const center = function(bounds) {{
    return bounds.min.map((value, index) => (value + bounds.max[index]) / 2);
  }};
  return Object.freeze({{
    objectCount: () => input.object_count,
    lever: (id) => {{ if (!(id in input.levers)) throw new Error(`unknown lever ${{id}}`); return input.levers[id]; }},
    visible: (id) => object(id).visible,
    bounds: (id) => object(id).bounds,
    surfaceArea: (id) => object(id).surface_area,
    volume: (id) => object(id).volume,
    vertexCount: (id) => object(id).vertex_count,
    triangleCount: (id) => object(id).triangle_count,
    metadata: (id, key) => object(id).metadata[key],
    property: (id, key) => object(id).properties[key],
    centerDistance: (left, right) => {{
      const a = center(object(left).bounds), b = center(object(right).bounds);
      return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
    }},
    targetDistance: (id, target) => {{
      const a = center(object(id).bounds);
      return Math.hypot(a[0]-target[0], a[1]-target[1], a[2]-target[2]);
    }},
    overlapVolume: (left, right) => {{
      const a = object(left).bounds, b = object(right).bounds;
      return [0,1,2].reduce((value, axis) => value * Math.max(0, Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis])), 1);
    }},
    intersects: (left, right) => {{
      const a = object(left).bounds, b = object(right).bounds;
      return [0,1,2].every((axis) => Math.min(a.max[axis], b.max[axis]) > Math.max(a.min[axis], b.min[axis]));
    }},
    targetPenalty: (value, target) => Math.abs(value - target),
    rangePenalty: (value, minimum, maximum) => value < minimum ? minimum-value : value > maximum ? value-maximum : 0
  }});
}};
"#
    ))
}

#[derive(Debug, Error)]
pub enum ScriptError {
    #[error("invalid evaluator: {0}")]
    Validation(String),
    #[error("JavaScript runtime failed: {0}")]
    Runtime(String),
    #[error("JavaScript compilation failed: {0}")]
    Compile(String),
    #[error("JavaScript evaluation failed or timed out: {0}")]
    Execution(String),
    #[error("invalid JavaScript evaluator result: {0}")]
    Result(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use genetic_assembly_scene::MetricSnapshot;

    #[test]
    fn rejects_ambient_randomness_and_imports() {
        let limits = ScriptLimits::default();
        assert!(
            JsWorker::new(
                "export function evaluate(ctx) { return { objectives: [Math.random()] }; }",
                &limits
            )
            .is_err()
        );
        assert!(
            JsWorker::new(
                "import x from 'x'; export function evaluate(ctx) { return { objectives: [0] }; }",
                &limits
            )
            .is_err()
        );
    }

    #[test]
    fn evaluates_catalog_context() {
        let source = r#"export function evaluate(ctx) {
          return { objectives: [ctx.lever("x") + ctx.objectCount()], constraints: [-1] };
        }"#;
        let mut worker = JsWorker::new(source, &ScriptLimits::default()).unwrap();
        let snapshot = MetricSnapshot {
            object_count: 2,
            levers: HashMap::from([("x".into(), 3.0)]),
            objects: HashMap::new(),
        };
        let result = worker
            .evaluate(&serde_json::to_string(&snapshot).unwrap(), 100)
            .unwrap();
        assert_eq!(result.objectives, vec![5.0]);
        assert_eq!(result.constraints, vec![-1.0]);
    }

    #[test]
    fn enforces_deadline_and_finite_result_shape() {
        let mut worker = JsWorker::new(
            "export function evaluate(ctx) { while (true) {} }",
            &ScriptLimits {
                timeout_ms: 5,
                ..ScriptLimits::default()
            },
        )
        .unwrap();
        assert!(
            worker
                .evaluate(r#"{"object_count":0,"levers":{},"objects":{}}"#, 5)
                .is_err()
        );

        let mut worker = JsWorker::new(
            "export function evaluate(ctx) { return { objectives: [1/0], constraints: [] }; }",
            &ScriptLimits::default(),
        )
        .unwrap();
        assert!(
            worker
                .evaluate(r#"{"object_count":0,"levers":{},"objects":{}}"#, 100)
                .is_err()
        );
    }
}
