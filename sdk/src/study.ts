import {
  studySpecSchema,
  canonical,
  type StudyInput,
  type StudySpec,
  type Decisions,
} from "./contracts.js";
/** Validate and normalize the serializable study contract, including defaults and decision domains. */
export function validateStudy(input: StudyInput): StudySpec {
  const spec = studySpecSchema.parse(input);
  for (const key of ["decisions", "objectives", "constraints"] as const)
    Object.assign(spec, {
      [key]: Object.fromEntries(
        Object.entries(spec[key]).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      ),
    });
  for (const [name, d] of Object.entries(spec.decisions)) {
    if (d.kind === "categorical") {
      if (
        new Set(d.choices).size !== d.choices.length ||
        !d.choices.includes(d.baseline)
      )
        throw Error(
          `${name}: categories must be unique and include the baseline`,
        );
    } else if (d.kind !== "boolean") {
      if (d.lower >= d.upper || d.baseline < d.lower || d.baseline > d.upper)
        throw Error(`${name}: invalid bounds or baseline`);
      if (
        d.kind === "integer" &&
        ((d.baseline - d.lower) % d.step !== 0 ||
          ![d.lower, d.upper, d.baseline].every(Number.isSafeInteger))
      )
        throw Error(`${name}: invalid integer step or range`);
    }
  }
  if (
    new Set(spec.searchSeeds).size !== spec.searchSeeds.length ||
    new Set(spec.validationSeeds).size !== spec.validationSeeds.length ||
    spec.searchSeeds.some((s) => spec.validationSeeds.includes(s))
  )
    throw Error("Search and validation seeds must be unique and disjoint");
  if (Object.hasOwn(spec.constraints, "domain_validity"))
    throw Error("domain_validity is reserved for domain validation");
  canonical(spec.inputs);
  return spec;
}
export function baselineDecisions(spec: StudySpec): Decisions {
  return Object.fromEntries(
    Object.entries(spec.decisions).map(([key, d]) => [key, d.baseline]),
  );
}
export function encodeDecisions(spec: StudySpec, values: Decisions): number[] {
  if (Object.keys(values).some((k) => !Object.hasOwn(spec.decisions, k)))
    throw Error("Unknown decision");
  return Object.entries(spec.decisions).map(([key, d]) => {
    const v = values[key];
    if (d.kind === "boolean") {
      if (typeof v !== "boolean") throw Error(`${key}: expected boolean`);
      return v ? 1 : 0;
    }
    if (d.kind === "categorical") {
      if (typeof v !== "string")
        throw Error(`${key}: expected category string`);
      const index = d.choices.indexOf(v);
      if (index < 0) throw Error(`${key}: unknown category`);
      return index;
    }
    if (
      typeof v !== "number" ||
      !Number.isFinite(v) ||
      v < d.lower ||
      v > d.upper ||
      (d.kind === "integer" &&
        (!Number.isSafeInteger(v) || (v - d.lower) % d.step !== 0))
    )
      throw Error(`${key}: outside decision domain`);
    return v;
  });
}
export function decodeDecisions(spec: StudySpec, genes: number[]): Decisions {
  if (genes.length !== Object.keys(spec.decisions).length)
    throw Error("Incorrect gene dimension");
  const values = Object.fromEntries(
    Object.entries(spec.decisions).map(([key, d], i) => [
      key,
      d.kind === "boolean"
        ? genes[i] === 1
        : d.kind === "categorical"
          ? d.choices[genes[i]]
          : genes[i],
    ]),
  );
  if (canonical(encodeDecisions(spec, values)) !== canonical(genes))
    throw Error("Invalid encoded decisions");
  return values;
}
export function compileStudy(spec: StudySpec) {
  return {
    schema_version: 1,
    name: spec.name,
    variable_ids: Object.keys(spec.decisions),
    problem: {
      variables: Object.values(spec.decisions).map((d) =>
        d.kind === "boolean"
          ? { kind: "binary" }
          : d.kind === "categorical"
            ? { kind: "categorical", choices: d.choices.length }
            : d.kind === "integer"
              ? { kind: d.kind, lower: d.lower, upper: d.upper, step: d.step }
              : { kind: d.kind, lower: d.lower, upper: d.upper },
      ),
      objectives: Object.entries(spec.objectives).map(([name, o]) => ({
        name,
        direction: o.direction,
      })),
    },
    constraints: [
      ...Object.keys(spec.constraints).map((name) => ({
        name,
        feasible_when: "lte_zero",
      })),
      { name: "domain_validity", feasible_when: "lte_zero" },
    ],
    artifacts: [],
    metadata: { study: spec },
  };
}
