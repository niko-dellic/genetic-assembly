//! Single-instance JSON ABI. The host owns transport; Rust owns solver state.
//! Buffers remain valid until the next ABI call, and no host pointer is dereferenced.
use genetic_assembly_core::{EvaluatedCandidate, Nsga2Config, ProblemSpec, SolverSession};
use serde::Deserialize;
use serde_json::{Value, json};
use std::cell::RefCell;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Command {
    Init {
        problem: ProblemSpec,
        config: Nsga2Config,
    },
    Ask,
    Tell {
        candidates: Vec<EvaluatedCandidate>,
    },
    Result,
    Summary,
    Snapshot,
}

#[derive(Default)]
struct Runtime {
    input: Vec<u8>,
    output: Vec<u8>,
    solver: Option<SolverSession>,
}
impl Runtime {
    fn execute(&mut self) -> Result<Value, String> {
        let command: Command = serde_json::from_slice(&self.input).map_err(|e| e.to_string())?;
        if let Command::Init { problem, config } = command {
            self.solver =
                Some(SolverSession::new(problem, config, None).map_err(|e| e.to_string())?);
            return Ok(json!({"engineVersion": env!("CARGO_PKG_VERSION"), "abiVersion": 1}));
        }
        let solver = self.solver.as_mut().ok_or("solver is not initialized")?;
        match command {
            Command::Ask => serde_json::to_value(solver.ask().map_err(|e| e.to_string())?),
            Command::Tell { candidates } => {
                solver.tell(candidates).map_err(|e| e.to_string())?;
                serde_json::to_value(solver.summary())
            }
            Command::Result => serde_json::to_value(solver.snapshot().map_err(|e| e.to_string())?),
            Command::Snapshot => {
                serde_json::to_value(solver.snapshot().map_err(|e| e.to_string())?)
            }
            Command::Summary => serde_json::to_value(solver.summary()),
            Command::Init { .. } => unreachable!(),
        }
        .map_err(|e| e.to_string())
    }
}
thread_local! { static RUNTIME: RefCell<Runtime> = RefCell::new(Runtime::default()); }

/// Reserve input bytes. The JS host writes into exported linear memory.
#[unsafe(no_mangle)]
pub extern "C" fn ga_input(length: usize) -> *mut u8 {
    RUNTIME.with_borrow_mut(|runtime| {
        runtime.input.resize(length, 0);
        runtime.input.as_mut_ptr()
    })
}
/// Process the input and return the response address. Errors are JSON values.
#[unsafe(no_mangle)]
pub extern "C" fn ga_execute() -> *const u8 {
    RUNTIME.with_borrow_mut(|runtime| {
        let response = match runtime.execute() {
            Ok(value) => json!({"ok": value}),
            Err(error) => json!({"error": error}),
        };
        runtime.output = serde_json::to_vec(&response).expect("JSON response is serializable");
        runtime.output.as_ptr()
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn ga_output_len() -> usize {
    RUNTIME.with_borrow(|runtime| runtime.output.len())
}
