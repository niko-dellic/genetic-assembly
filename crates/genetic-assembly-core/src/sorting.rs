use crate::{Individual, ObjectiveDirection};

const EPSILON: f64 = 1e-12;
// JSON, Postgres JSONB, and browser clients cannot represent IEEE infinity.
// The normalized interior score is at most the objective count. This sentinel
// preserves the boundary preference while round-tripping through JSONB (whose
// decimal encoding of `f64::MAX` is not portable across JSON decoders).
const BOUNDARY_DISTANCE: f64 = 1.0e30;

pub fn constraint_dominates(
    a: &Individual,
    b: &Individual,
    directions: &[ObjectiveDirection],
) -> bool {
    match (a.feasible(), b.feasible()) {
        (true, false) => return true,
        (false, true) => return false,
        (false, false) => return a.constraint_violation + EPSILON < b.constraint_violation,
        (true, true) => {}
    }

    let mut strictly_better = false;
    for ((&left, &right), direction) in a.objectives.iter().zip(&b.objectives).zip(directions) {
        let (left, right) = match direction {
            ObjectiveDirection::Minimize => (left, right),
            ObjectiveDirection::Maximize => (-left, -right),
        };
        if left > right + EPSILON {
            return false;
        }
        if left + EPSILON < right {
            strictly_better = true;
        }
    }
    strictly_better
}

pub fn fast_non_dominated_sort(
    population: &mut [Individual],
    directions: &[ObjectiveDirection],
) -> Vec<Vec<usize>> {
    let count = population.len();
    let mut domination_counts = vec![0usize; count];
    let mut dominated = vec![Vec::<usize>::new(); count];
    let mut first = Vec::new();

    for p in 0..count {
        for q in (p + 1)..count {
            if constraint_dominates(&population[p], &population[q], directions) {
                dominated[p].push(q);
                domination_counts[q] += 1;
            } else if constraint_dominates(&population[q], &population[p], directions) {
                dominated[q].push(p);
                domination_counts[p] += 1;
            }
        }
        if domination_counts[p] == 0 {
            population[p].rank = 0;
            first.push(p);
        }
    }
    first.sort_by_key(|&index| population[index].id);

    let mut fronts = Vec::new();
    if !first.is_empty() {
        fronts.push(first);
    }
    let mut rank = 0;
    while rank < fronts.len() {
        let mut next = Vec::new();
        for &p in &fronts[rank] {
            for &q in &dominated[p] {
                domination_counts[q] -= 1;
                if domination_counts[q] == 0 {
                    population[q].rank = rank + 1;
                    next.push(q);
                }
            }
        }
        next.sort_by_key(|&index| population[index].id);
        if !next.is_empty() {
            fronts.push(next);
        }
        rank += 1;
    }
    fronts
}

pub fn assign_crowding(
    population: &mut [Individual],
    front: &[usize],
    directions: &[ObjectiveDirection],
) {
    for &index in front {
        population[index].crowding_distance = 0.0;
    }
    if front.len() <= 2 {
        for &index in front {
            population[index].crowding_distance = BOUNDARY_DISTANCE;
        }
        return;
    }

    for objective in 0..directions.len() {
        let mut ordered = front.to_vec();
        ordered.sort_by(|&left, &right| {
            let ordering = population[left].objectives[objective]
                .total_cmp(&population[right].objectives[objective]);
            ordering.then_with(|| population[left].id.cmp(&population[right].id))
        });
        let minimum = population[ordered[0]].objectives[objective];
        let maximum =
            population[*ordered.last().expect("front is non-empty")].objectives[objective];
        population[ordered[0]].crowding_distance = BOUNDARY_DISTANCE;
        population[*ordered.last().expect("front is non-empty")].crowding_distance =
            BOUNDARY_DISTANCE;
        let range = maximum - minimum;
        if range.abs() <= EPSILON {
            continue;
        }
        for window in ordered.windows(3) {
            let center = window[1];
            if population[center].crowding_distance == BOUNDARY_DISTANCE {
                continue;
            }
            let distance = (population[window[2]].objectives[objective]
                - population[window[0]].objectives[objective])
                .abs()
                / range.abs();
            population[center].crowding_distance += distance;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn individual(id: u64, objectives: &[f64], violation: f64) -> Individual {
        Individual {
            id,
            genes: vec![],
            objectives: objectives.to_vec(),
            constraints: if violation == 0.0 {
                vec![-1.0]
            } else {
                vec![violation]
            },
            constraint_violation: violation,
            rank: usize::MAX,
            crowding_distance: 0.0,
            evidence: None,
        }
    }

    #[test]
    fn constraint_domination_precedes_objectives() {
        let feasible = individual(1, &[100.0, 100.0], 0.0);
        let infeasible = individual(2, &[0.0, 0.0], 0.5);
        let less_infeasible = individual(3, &[50.0, 50.0], 0.25);
        let directions = [ObjectiveDirection::Minimize, ObjectiveDirection::Minimize];
        assert!(constraint_dominates(&feasible, &infeasible, &directions));
        assert!(constraint_dominates(
            &less_infeasible,
            &infeasible,
            &directions
        ));
        assert!(!constraint_dominates(&infeasible, &feasible, &directions));
    }

    #[test]
    fn honors_mixed_objective_directions_and_stable_ids() {
        let mut population = vec![
            individual(30, &[1.0, 3.0], 0.0),
            individual(10, &[2.0, 2.0], 0.0),
            individual(20, &[3.0, 1.0], 0.0),
            individual(40, &[4.0, 0.0], 0.0),
        ];
        let fronts = fast_non_dominated_sort(
            &mut population,
            &[ObjectiveDirection::Minimize, ObjectiveDirection::Maximize],
        );
        assert_eq!(fronts, vec![vec![0], vec![1], vec![2], vec![3]]);
        assert_eq!(
            population
                .iter()
                .map(|value| value.rank)
                .collect::<Vec<_>>(),
            vec![0, 1, 2, 3]
        );

        let mut tied = vec![individual(8, &[1.0], 0.0), individual(2, &[1.0], 0.0)];
        assert_eq!(
            fast_non_dominated_sort(&mut tied, &[ObjectiveDirection::Minimize])[0],
            vec![1, 0]
        );
    }
}
