//! A deterministic, native-first NSGA-II implementation.
//!
//! The core intentionally has no JavaScript, HTTP, database, or scene-format
//! dependencies. Callers may provide an [`Evaluator`] for native parallel
//! evaluation or a [`BatchEvaluator`] plus optional [`GenomeOperator`] for an
//! external project runtime. Random choices and ordering remain deterministic.

mod algorithm;
mod operators;
mod sorting;
mod types;

pub use algorithm::{RunControl, run_nsga2, run_nsga2_batch, validate_problem_config};
pub use sorting::{constraint_dominates, fast_non_dominated_sort};
pub use types::*;
