use genetic_assembly_adapter::{
    ADAPTER_PROTOCOL_VERSION, AdapterLaunch, AdapterSession, OperatorMode, ProblemBundle,
};
use genetic_assembly_core::{
    BatchEvaluator, EvaluationRequest, GenomeOperator, Objective, ObjectiveDirection, ProblemSpec,
    SeedPopulationRequest, Variable,
};
use std::collections::BTreeMap;
use std::path::PathBuf;

fn fixture(mode: &str, timeout_ms: u64) -> AdapterSession {
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/adapter.mjs");
    AdapterSession::launch(
        AdapterLaunch {
            name: "fixture".into(),
            adapter_version: "fixture-v1".into(),
            protocol_version: ADAPTER_PROTOCOL_VERSION.into(),
            command: "node".into(),
            args: vec![fixture.to_string_lossy().into_owned()],
            environment: BTreeMap::from([("GA_ADAPTER_FIXTURE_MODE".into(), mode.into())]),
            timeout_ms,
            retry_limit: 0,
            ..Default::default()
        },
        "test-run",
        ProblemBundle {
            schema_version: 1,
            name: "fixture".into(),
            problem: ProblemSpec {
                variables: vec![Variable::Real {
                    lower: 0.0,
                    upper: 1.0,
                }],
                objectives: vec![Objective {
                    name: "value".into(),
                    direction: ObjectiveDirection::Minimize,
                }],
            },
            variable_ids: vec!["value".into()],
            constraints: vec![],
            artifacts: vec![],
            metadata: serde_json::Value::Null,
        },
    )
    .unwrap()
}

#[test]
fn subprocess_supports_domain_operations_evaluation_and_materialization() {
    let adapter = fixture("normal", 1_000);
    assert_eq!(adapter.capabilities().operator_mode, OperatorMode::Adapter);
    let genes = adapter
        .seed_population(&SeedPopulationRequest {
            size: 2,
            seeds: vec![u64::MAX, 17],
        })
        .unwrap();
    assert_eq!(genes.len(), 2);
    let requests = vec![EvaluationRequest {
        id: 3,
        genes: genes[0].clone(),
    }];
    let evaluated = adapter.evaluate_batch(&requests).unwrap();
    assert_eq!(evaluated[0].id, 3);
    assert_eq!(
        evaluated[0].evaluation.evidence.as_ref().unwrap().metadata["fixture"],
        "true"
    );
    let materialized = adapter.materialize(requests).unwrap();
    assert_eq!(materialized[0].data["value"], genes[0][0]);
}

#[test]
fn timeout_and_malformed_output_are_structured_errors() {
    let timeout = fixture("timeout", 500);
    let error = timeout
        .evaluate_batch(&[EvaluationRequest {
            id: 1,
            genes: vec![0.5],
        }])
        .unwrap_err();
    assert!(error.message.contains("timed out"));

    let malformed = fixture("malformed", 1_000);
    let error = malformed
        .evaluate_batch(&[EvaluationRequest {
            id: 1,
            genes: vec![0.5],
        }])
        .unwrap_err();
    assert!(error.message.contains("protocol error"));
}
