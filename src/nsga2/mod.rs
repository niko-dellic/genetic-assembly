mod algorithm;
mod operators;
mod sorting;

// Only export the main algorithm functions
pub use algorithm::{run_nsga2, run_nsga2_custom_eval};
