use wasm_bindgen::prelude::*;

mod evaluation;
mod nsga2;
mod types;

use nsga2::{run_nsga2, run_nsga2_custom_eval};
use types::*;

/// Solve optimization problem from JavaScript object specification
#[wasm_bindgen]
pub fn solve_json(
    spec: JsValue,
    progress_callback: Option<js_sys::Function>,
) -> Result<JsValue, JsValue> {
    let start_time = js_sys::Date::now();

    let spec: OptimizationSpec = serde_wasm_bindgen::from_value(spec)
        .map_err(|e| JsValue::from_str(&format!("Spec parse error: {}", e)))?;

    if spec.algorithm != "nsga2" && spec.algorithm != "nsga3" {
        return Err(JsValue::from_str(&format!(
            "Unknown algorithm: {} (only nsga2 is currently supported)",
            spec.algorithm
        )));
    }

    // Ensure objectives are provided for solve_json
    let objectives = spec.objectives.ok_or_else(|| {
        JsValue::from_str(
            "objectives field is required for solve_json. Use solve_with_custom_eval for custom evaluation functions."
        )
    })?;

    let population = run_nsga2(
        spec.num_vars,
        spec.population_size,
        spec.num_iterations,
        spec.crossover_rate,
        spec.mutation_rate,
        spec.num_offsprings,
        objectives,
        spec.initial_population,
        spec.seed,
        progress_callback,
        spec.progress_interval.unwrap_or(usize::MAX),
    );

    // Extract pareto front (rank 0)
    let pareto: Vec<Vec<f64>> = population
        .iter()
        .filter(|ind| ind.rank == 0)
        .map(|ind| ind.genes.clone())
        .collect();

    // Extract full population for potential resuming
    let full_pop: Vec<Vec<f64>> = population.iter().map(|ind| ind.genes.clone()).collect();

    let execution_time = (js_sys::Date::now() - start_time) as u64;

    let result = OptimizationResult {
        pareto: pareto.clone(),
        stats: OptimizationStats {
            iterations: spec.num_iterations,
            population_size: spec.population_size,
            pareto_size: pareto.len(),
        },
        full_population: Some(full_pop),
        execution_time: Some(execution_time),
    };

    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Solve optimization problem with custom JavaScript evaluation function
/// This allows for non-linear objectives that cannot be expressed as coefficient matrices
#[wasm_bindgen]
pub fn solve_with_custom_eval(
    spec: JsValue,
    eval_fn: js_sys::Function,
    progress_callback: Option<js_sys::Function>,
) -> Result<JsValue, JsValue> {
    let start_time = js_sys::Date::now();

    let spec: OptimizationSpec = serde_wasm_bindgen::from_value(spec)
        .map_err(|e| JsValue::from_str(&format!("Spec parse error: {}", e)))?;

    if spec.algorithm != "nsga2" && spec.algorithm != "nsga3" {
        return Err(JsValue::from_str(&format!(
            "Unknown algorithm: {} (only nsga2 is currently supported)",
            spec.algorithm
        )));
    }

    // Note: num_objectives is inferred from the first evaluation
    let population = run_nsga2_custom_eval(
        spec.num_vars,
        spec.population_size,
        spec.num_iterations,
        spec.crossover_rate,
        spec.mutation_rate,
        spec.num_offsprings,
        eval_fn,
        spec.initial_population,
        spec.seed,
        progress_callback,
        spec.progress_interval.unwrap_or(usize::MAX),
    )?;

    // Extract pareto front (rank 0)
    let pareto: Vec<Vec<f64>> = population
        .iter()
        .filter(|ind| ind.rank == 0)
        .map(|ind| ind.genes.clone())
        .collect();

    // Extract full population for potential resuming
    let full_pop: Vec<Vec<f64>> = population.iter().map(|ind| ind.genes.clone()).collect();

    let execution_time = (js_sys::Date::now() - start_time) as u64;

    let result = OptimizationResult {
        pareto: pareto.clone(),
        stats: OptimizationStats {
            iterations: spec.num_iterations,
            population_size: spec.population_size,
            pareto_size: pareto.len(),
        },
        full_population: Some(full_pop),
        execution_time: Some(execution_time),
    };

    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
}

/// Solve optimization problem using buffer-based API
#[wasm_bindgen]
pub fn solve_buffers(
    _x0_ptr: Option<Vec<f64>>,
    dims: usize,
    objectives_ptr: Vec<f64>,
    objectives_rows: usize,
    objectives_cols: usize,
    pop_size: usize,
    generations: usize,
) -> Result<Vec<f64>, JsValue> {
    // Parse objectives matrix
    if objectives_ptr.len() != objectives_rows * objectives_cols {
        return Err(JsValue::from_str("Invalid objectives matrix dimensions"));
    }

    let objective_matrix: Vec<Vec<f64>> = (0..objectives_rows)
        .map(|i| objectives_ptr[i * objectives_cols..(i + 1) * objectives_cols].to_vec())
        .collect();

    let population = run_nsga2(
        dims,
        pop_size,
        generations,
        0.9, // default crossover rate
        0.1, // default mutation rate
        (pop_size as f64 * 0.5) as usize,
        objective_matrix,
        None,       // no initial population
        None,       // no seed
        None,       // no progress callback
        usize::MAX, // no progress interval
    );

    // Flatten genes into Float64Array
    Ok(population
        .iter()
        .flat_map(|ind| ind.genes.clone())
        .collect())
}
