use genetic_assembly_core::*;
use std::sync::atomic::AtomicBool;
fn main() {
    let problem = ProblemSpec {
        variables: vec![
            Variable::Real {
                lower: 0.0,
                upper: 1.0,
            },
            Variable::Integer {
                lower: 0,
                upper: 6,
                step: 2,
            },
            Variable::Binary,
            Variable::Categorical { choices: 3 },
        ],
        objectives: vec![
            Objective {
                name: "sum".into(),
                direction: ObjectiveDirection::Minimize,
            },
            Objective {
                name: "opposite".into(),
                direction: ObjectiveDirection::Minimize,
            },
        ],
    };
    let config = Nsga2Config {
        population_size: 8,
        generations: 4,
        seed: 42,
        threads: Some(1),
        ..Default::default()
    };
    let evaluator = |genes: &[f64]| {
        Ok(Evaluation {
            objectives: vec![genes.iter().sum(), (1.0 - genes[0]).powi(2)],
            constraints: vec![genes[1] - 4.0],
            evidence: None,
        })
    };
    let started = std::time::Instant::now();
    let mut snapshots = Vec::new();
    let result = run_nsga2(
        problem.clone(),
        config.clone(),
        &evaluator,
        None,
        &AtomicBool::new(false),
        |checkpoint, summary| {
            snapshots.push(serde_json::json!({"generation":summary.generation,"population":checkpoint.population,"summary":summary}));
            RunControl::Continue
        },
    )
    .unwrap();
    println!(
        "{}",
        serde_json::json!({"problem":problem,"config":config,"result":result,"snapshots":snapshots,"nativeMs":started.elapsed().as_secs_f64()*1000.0})
    );
}
