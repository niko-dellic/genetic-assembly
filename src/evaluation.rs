use crate::types::Individual;
use wasm_bindgen::prelude::*;

/// Evaluate objectives for an individual using coefficient matrix
pub fn evaluate(individual: &mut Individual, objective_matrix: &[Vec<f64>]) {
    individual.objectives = objective_matrix
        .iter()
        .map(|obj_coeffs| {
            individual
                .genes
                .iter()
                .zip(obj_coeffs.iter())
                .map(|(g, c)| g * c)
                .sum()
        })
        .collect();
}

/// Call JavaScript evaluation function from Rust
pub fn evaluate_with_js_function(
    genes: &[f64],
    eval_fn: &js_sys::Function,
) -> Result<Vec<f64>, JsValue> {
    let genes_array = js_sys::Array::new();
    for &gene in genes {
        genes_array.push(&JsValue::from_f64(gene));
    }

    let result = eval_fn.call1(&JsValue::NULL, &genes_array)?;
    let objectives_array = js_sys::Array::from(&result);
    let mut objectives = Vec::new();

    for i in 0..objectives_array.length() {
        let val = objectives_array.get(i);
        if let Some(num) = val.as_f64() {
            objectives.push(num);
        } else {
            return Err(JsValue::from_str(
                "Evaluation function must return an array of numbers",
            ));
        }
    }

    Ok(objectives)
}
