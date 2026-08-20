//! Language-independent adapter protocol and trusted local subprocess client.

use genetic_assembly_core::{
    BatchEvaluator, EvaluatedCandidate, EvaluationError, EvaluationRequest, GeneratedCandidate,
    GenomeOperator, OffspringRequest, ProblemSpec, SeedPopulationRequest,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use thiserror::Error;

pub const ADAPTER_PROTOCOL_VERSION: &str = "genetic-assembly-adapter-v1";
pub const PROBLEM_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OperatorMode {
    #[default]
    Builtin,
    Adapter,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConstraintSpec {
    pub name: String,
    #[serde(default = "default_feasible_when")]
    pub feasible_when: String,
}

fn default_feasible_when() -> String {
    "lte_zero".into()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArtifactReference {
    pub name: String,
    pub content_hash: String,
    pub artifact_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ProblemBundle {
    #[serde(default = "problem_schema_version")]
    pub schema_version: u32,
    pub name: String,
    pub problem: ProblemSpec,
    /// Stable project-facing identifiers in the same order as
    /// `problem.variables`. Missing identifiers are synthesized by clients.
    #[serde(default)]
    pub variable_ids: Vec<String>,
    #[serde(default)]
    pub constraints: Vec<ConstraintSpec>,
    #[serde(default)]
    pub artifacts: Vec<ArtifactReference>,
    #[serde(default)]
    pub metadata: Value,
}

const fn problem_schema_version() -> u32 {
    PROBLEM_SCHEMA_VERSION
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct AdapterLaunch {
    pub name: String,
    pub adapter_version: String,
    pub protocol_version: String,
    pub command: String,
    pub args: Vec<String>,
    pub working_directory: Option<PathBuf>,
    pub environment: BTreeMap<String, String>,
    pub timeout_ms: u64,
    pub retry_limit: usize,
}

impl Default for AdapterLaunch {
    fn default() -> Self {
        Self {
            name: "project-adapter".into(),
            adapter_version: String::new(),
            protocol_version: ADAPTER_PROTOCOL_VERSION.into(),
            command: String::new(),
            args: vec![],
            working_directory: None,
            environment: BTreeMap::new(),
            timeout_ms: 300_000,
            retry_limit: 1,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdapterCapabilities {
    #[serde(default)]
    pub operator_mode: OperatorMode,
    #[serde(default = "one")]
    pub max_concurrency: usize,
    #[serde(default)]
    pub validate_front: bool,
    #[serde(default)]
    pub materialize: bool,
}

const fn one() -> usize {
    1
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MaterializedCandidate {
    pub id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
    #[serde(default)]
    pub data: Value,
}

/// Protocol seeds are decimal strings so JavaScript adapters receive all 64
/// bits without IEEE-754 rounding.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AdapterSeedPopulationRequest {
    pub size: usize,
    pub seeds: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AdapterOffspringRequest {
    pub id: u64,
    pub left_id: u64,
    pub left_genes: Vec<f64>,
    pub right_id: u64,
    pub right_genes: Vec<f64>,
    pub seed: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AdapterRequest {
    Initialize {
        run_id: String,
        problem: ProblemBundle,
    },
    SeedPopulation {
        request: AdapterSeedPopulationRequest,
    },
    MakeOffspring {
        requests: Vec<AdapterOffspringRequest>,
    },
    EvaluateBatch {
        candidates: Vec<EvaluationRequest>,
        #[serde(default)]
        phase: String,
    },
    ValidateFront {
        candidates: Vec<EvaluationRequest>,
    },
    Materialize {
        candidates: Vec<EvaluationRequest>,
    },
    Cancel,
    Shutdown,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RequestEnvelope {
    pub protocol_version: String,
    pub request_id: u64,
    #[serde(flatten)]
    pub request: AdapterRequest,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AdapterResponse {
    Initialized {
        capabilities: AdapterCapabilities,
        adapter_version: String,
    },
    PopulationSeeded {
        genes: Vec<Vec<f64>>,
    },
    OffspringCreated {
        candidates: Vec<GeneratedCandidate>,
    },
    BatchEvaluated {
        candidates: Vec<EvaluatedCandidate>,
    },
    FrontValidated {
        candidates: Vec<EvaluatedCandidate>,
    },
    Materialized {
        candidates: Vec<MaterializedCandidate>,
    },
    Cancelled,
    Shutdown,
    Error {
        message: String,
        #[serde(default)]
        retryable: bool,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ResponseEnvelope {
    pub protocol_version: String,
    pub request_id: u64,
    #[serde(flatten)]
    pub response: AdapterResponse,
}

#[derive(Debug, Error)]
pub enum AdapterError {
    #[error("invalid adapter configuration: {0}")]
    Configuration(String),
    #[error("failed to start adapter: {0}")]
    Spawn(String),
    #[error("adapter I/O failed: {0}")]
    Io(String),
    #[error("adapter request timed out after {0} ms")]
    Timeout(u64),
    #[error("adapter protocol error: {0}")]
    Protocol(String),
    #[error("adapter rejected the request: {message}")]
    Rejected { message: String, retryable: bool },
}

struct RunningProcess {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<Result<String, String>>,
    stderr: Arc<Mutex<VecDeque<String>>>,
}

struct SessionState {
    launch: AdapterLaunch,
    run_id: String,
    problem: ProblemBundle,
    next_request_id: u64,
    process: Option<RunningProcess>,
    active_pid: Arc<AtomicU32>,
}

impl SessionState {
    fn start(&mut self) -> Result<AdapterCapabilities, AdapterError> {
        if self.launch.command.trim().is_empty() {
            return Err(AdapterError::Configuration(
                "adapter command must not be empty".into(),
            ));
        }
        if self.launch.protocol_version != ADAPTER_PROTOCOL_VERSION {
            return Err(AdapterError::Configuration(format!(
                "unsupported protocol {}, expected {ADAPTER_PROTOCOL_VERSION}",
                self.launch.protocol_version
            )));
        }
        let mut command = Command::new(&self.launch.command);
        command
            .args(&self.launch.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .envs(&self.launch.environment);
        if let Some(directory) = &self.launch.working_directory {
            command.current_dir(directory);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command
            .spawn()
            .map_err(|error| AdapterError::Spawn(error.to_string()))?;
        self.active_pid.store(child.id(), Ordering::Release);
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AdapterError::Spawn("adapter stdin was unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AdapterError::Spawn("adapter stdout was unavailable".into()))?;
        let stderr_stream = child
            .stderr
            .take()
            .ok_or_else(|| AdapterError::Spawn("adapter stderr was unavailable".into()))?;
        let (sender, lines) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let result = line.map_err(|error| error.to_string());
                if sender.send(result).is_err() {
                    break;
                }
            }
        });
        let stderr = Arc::new(Mutex::new(VecDeque::with_capacity(64)));
        let stderr_copy = stderr.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr_stream).lines().map_while(Result::ok) {
                let mut entries = stderr_copy.lock().expect("stderr mutex poisoned");
                if entries.len() == 64 {
                    entries.pop_front();
                }
                entries.push_back(line);
            }
        });
        self.process = Some(RunningProcess {
            child,
            stdin,
            lines,
            stderr,
        });
        let response = self.exchange(AdapterRequest::Initialize {
            run_id: self.run_id.clone(),
            problem: self.problem.clone(),
        })?;
        match response {
            AdapterResponse::Initialized {
                capabilities,
                adapter_version,
            } if adapter_version == self.launch.adapter_version => Ok(capabilities),
            AdapterResponse::Initialized {
                adapter_version, ..
            } => Err(AdapterError::Protocol(format!(
                "adapter reported version {adapter_version}, expected {}",
                self.launch.adapter_version
            ))),
            other => Err(AdapterError::Protocol(format!(
                "expected initialized, received {other:?}"
            ))),
        }
    }

    fn request(&mut self, request: AdapterRequest) -> Result<AdapterResponse, AdapterError> {
        let attempts = self.launch.retry_limit + 1;
        let mut last_error = None;
        for _ in 0..attempts {
            if self.process.is_none()
                && let Err(error) = self.start()
            {
                last_error = Some(error);
                self.terminate();
                continue;
            }
            match self.exchange(request.clone()) {
                Ok(AdapterResponse::Error { message, retryable }) => {
                    let error = AdapterError::Rejected { message, retryable };
                    if !retryable {
                        return Err(error);
                    }
                    last_error = Some(error);
                }
                Ok(response) => return Ok(response),
                Err(error) => last_error = Some(error),
            }
            self.terminate();
        }
        Err(last_error.unwrap_or_else(|| AdapterError::Protocol("request failed".into())))
    }

    fn exchange(&mut self, request: AdapterRequest) -> Result<AdapterResponse, AdapterError> {
        let request_id = self.next_request_id;
        self.next_request_id += 1;
        let envelope = RequestEnvelope {
            protocol_version: ADAPTER_PROTOCOL_VERSION.into(),
            request_id,
            request,
        };
        let process = self
            .process
            .as_mut()
            .ok_or_else(|| AdapterError::Io("adapter process is not running".into()))?;
        serde_json::to_writer(&mut process.stdin, &envelope)
            .map_err(|error| AdapterError::Io(error.to_string()))?;
        process
            .stdin
            .write_all(b"\n")
            .and_then(|_| process.stdin.flush())
            .map_err(|error| AdapterError::Io(error.to_string()))?;
        let line = process
            .lines
            .recv_timeout(Duration::from_millis(self.launch.timeout_ms))
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => AdapterError::Timeout(self.launch.timeout_ms),
                mpsc::RecvTimeoutError::Disconnected => {
                    let stderr = process
                        .stderr
                        .lock()
                        .expect("stderr mutex poisoned")
                        .iter()
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(" | ");
                    AdapterError::Io(format!("adapter exited; stderr: {stderr}"))
                }
            })?
            .map_err(AdapterError::Io)?;
        let response: ResponseEnvelope = serde_json::from_str(&line)
            .map_err(|error| AdapterError::Protocol(format!("{error}; line={line}")))?;
        if response.protocol_version != ADAPTER_PROTOCOL_VERSION {
            return Err(AdapterError::Protocol(format!(
                "response protocol {} does not match {ADAPTER_PROTOCOL_VERSION}",
                response.protocol_version
            )));
        }
        if response.request_id != request_id {
            return Err(AdapterError::Protocol(format!(
                "response request_id {} does not match {request_id}",
                response.request_id
            )));
        }
        Ok(response.response)
    }

    fn terminate(&mut self) {
        let Some(mut process) = self.process.take() else {
            self.active_pid.store(0, Ordering::Release);
            return;
        };
        terminate_process_tree(&mut process.child);
        self.active_pid.store(0, Ordering::Release);
    }
}

impl Drop for SessionState {
    fn drop(&mut self) {
        self.terminate();
    }
}

fn terminate_process_tree(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    #[cfg(not(unix))]
    let _ = child.kill();
    let _ = child.wait();
}

fn terminate_pid(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}

pub struct AdapterSession {
    state: Mutex<SessionState>,
    capabilities: AdapterCapabilities,
    active_pid: Arc<AtomicU32>,
}

impl AdapterSession {
    pub fn launch(
        launch: AdapterLaunch,
        run_id: impl Into<String>,
        problem: ProblemBundle,
    ) -> Result<Self, AdapterError> {
        let active_pid = Arc::new(AtomicU32::new(0));
        let mut state = SessionState {
            launch,
            run_id: run_id.into(),
            problem,
            next_request_id: 1,
            process: None,
            active_pid: active_pid.clone(),
        };
        let capabilities = state.start()?;
        Ok(Self {
            state: Mutex::new(state),
            capabilities,
            active_pid,
        })
    }

    pub fn capabilities(&self) -> &AdapterCapabilities {
        &self.capabilities
    }

    pub fn validate_front(
        &self,
        candidates: Vec<EvaluationRequest>,
    ) -> Result<Vec<EvaluatedCandidate>, AdapterError> {
        let response = self.request(AdapterRequest::ValidateFront { candidates })?;
        match response {
            AdapterResponse::FrontValidated { candidates } => Ok(candidates),
            other => Err(AdapterError::Protocol(format!(
                "expected front_validated, received {other:?}"
            ))),
        }
    }

    pub fn materialize(
        &self,
        candidates: Vec<EvaluationRequest>,
    ) -> Result<Vec<MaterializedCandidate>, AdapterError> {
        let response = self.request(AdapterRequest::Materialize { candidates })?;
        match response {
            AdapterResponse::Materialized { candidates } => Ok(candidates),
            other => Err(AdapterError::Protocol(format!(
                "expected materialized, received {other:?}"
            ))),
        }
    }

    pub fn cancel(&self) {
        // Kill the process group without waiting for an in-flight request to
        // release the session mutex. The blocked reader then wakes with a
        // disconnected channel and the solver observes cancellation.
        terminate_pid(self.active_pid.load(Ordering::Acquire));
        if let Ok(mut state) = self.state.try_lock() {
            state.terminate();
        }
    }

    fn request(&self, request: AdapterRequest) -> Result<AdapterResponse, AdapterError> {
        self.state
            .lock()
            .expect("adapter mutex poisoned")
            .request(request)
    }
}

impl BatchEvaluator for AdapterSession {
    fn evaluate_batch(
        &self,
        candidates: &[EvaluationRequest],
    ) -> Result<Vec<EvaluatedCandidate>, EvaluationError> {
        let response = self
            .request(AdapterRequest::EvaluateBatch {
                candidates: candidates.to_vec(),
                phase: "search".into(),
            })
            .map_err(|error| EvaluationError::new(error.to_string()))?;
        match response {
            AdapterResponse::BatchEvaluated { candidates } => Ok(candidates),
            other => Err(EvaluationError::new(format!(
                "expected batch_evaluated, received {other:?}"
            ))),
        }
    }
}

impl GenomeOperator for AdapterSession {
    fn seed_population(
        &self,
        request: &SeedPopulationRequest,
    ) -> Result<Vec<Vec<f64>>, EvaluationError> {
        let response = self
            .request(AdapterRequest::SeedPopulation {
                request: AdapterSeedPopulationRequest {
                    size: request.size,
                    seeds: request.seeds.iter().map(u64::to_string).collect(),
                },
            })
            .map_err(|error| EvaluationError::new(error.to_string()))?;
        match response {
            AdapterResponse::PopulationSeeded { genes } => Ok(genes),
            other => Err(EvaluationError::new(format!(
                "expected population_seeded, received {other:?}"
            ))),
        }
    }

    fn make_offspring(
        &self,
        requests: &[OffspringRequest],
    ) -> Result<Vec<GeneratedCandidate>, EvaluationError> {
        let response = self
            .request(AdapterRequest::MakeOffspring {
                requests: requests
                    .iter()
                    .map(|request| AdapterOffspringRequest {
                        id: request.id,
                        left_id: request.left_id,
                        left_genes: request.left_genes.clone(),
                        right_id: request.right_id,
                        right_genes: request.right_genes.clone(),
                        seed: request.seed.to_string(),
                    })
                    .collect(),
            })
            .map_err(|error| EvaluationError::new(error.to_string()))?;
        match response {
            AdapterResponse::OffspringCreated { candidates } => Ok(candidates),
            other => Err(EvaluationError::new(format!(
                "expected offspring_created, received {other:?}"
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_envelope_is_flat_ndjson_shape() {
        let envelope = RequestEnvelope {
            protocol_version: ADAPTER_PROTOCOL_VERSION.into(),
            request_id: 7,
            request: AdapterRequest::Cancel,
        };
        let json = serde_json::to_value(envelope).unwrap();
        assert_eq!(json["type"], "cancel");
        assert_eq!(json["request_id"], 7);
        assert_eq!(json["protocol_version"], ADAPTER_PROTOCOL_VERSION);
    }

    #[test]
    fn launch_defaults_are_local_and_bounded() {
        let launch = AdapterLaunch::default();
        assert_eq!(launch.protocol_version, ADAPTER_PROTOCOL_VERSION);
        assert_eq!(launch.timeout_ms, 300_000);
        assert_eq!(launch.retry_limit, 1);
    }
}
