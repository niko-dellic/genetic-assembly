//! A deterministic, native-first NSGA-II implementation.
//!
//! The core intentionally has no JavaScript, HTTP, database, or scene-format
//! dependencies. Callers provide an [`Evaluator`]; candidate evaluations are
//! parallelized while all random choices and ordering remain deterministic.

mod algorithm;
mod operators;
mod sorting;
mod types;

pub use algorithm::{RunControl, run_nsga2, validate_problem_config};
pub use sorting::{constraint_dominates, fast_non_dominated_sort};
pub use types::*;
