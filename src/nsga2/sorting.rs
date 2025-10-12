use crate::types::Individual;

/// Fast non-dominated sorting (NSGA-II)
pub fn fast_non_dominated_sort(population: &mut Vec<Individual>) -> Vec<Vec<usize>> {
    let n = population.len();
    let mut fronts: Vec<Vec<usize>> = vec![Vec::new()];
    let mut domination_count = vec![0; n];
    let mut dominated_solutions: Vec<Vec<usize>> = vec![Vec::new(); n];

    // For each individual
    for p in 0..n {
        for q in 0..n {
            if p == q {
                continue;
            }
            if dominates(&population[p], &population[q]) {
                dominated_solutions[p].push(q);
            } else if dominates(&population[q], &population[p]) {
                domination_count[p] += 1;
            }
        }
        if domination_count[p] == 0 {
            population[p].rank = 0;
            fronts[0].push(p);
        }
    }

    let mut i = 0;
    while i < fronts.len() && !fronts[i].is_empty() {
        let mut next_front = Vec::new();
        for &p in &fronts[i] {
            for &q in &dominated_solutions[p] {
                domination_count[q] -= 1;
                if domination_count[q] == 0 {
                    population[q].rank = i + 1;
                    next_front.push(q);
                }
            }
        }
        if !next_front.is_empty() {
            fronts.push(next_front);
        }
        i += 1;
    }

    fronts
}

/// Check if individual a dominates individual b (minimization)
pub fn dominates(a: &Individual, b: &Individual) -> bool {
    let mut better_in_one = false;
    for (obj_a, obj_b) in a.objectives.iter().zip(b.objectives.iter()) {
        if obj_a > obj_b {
            return false;
        }
        if obj_a < obj_b {
            better_in_one = true;
        }
    }
    better_in_one
}

/// Calculate crowding distance
pub fn calculate_crowding_distance(population: &mut Vec<Individual>, front: &[usize]) {
    if front.len() <= 2 {
        for &idx in front {
            population[idx].crowding_distance = f64::INFINITY;
        }
        return;
    }

    let num_objectives = population[front[0]].objectives.len();

    for &idx in front {
        population[idx].crowding_distance = 0.0;
    }

    for obj_idx in 0..num_objectives {
        let mut sorted_front = front.to_vec();
        sorted_front.sort_by(|&a, &b| {
            population[a].objectives[obj_idx]
                .partial_cmp(&population[b].objectives[obj_idx])
                .unwrap()
        });

        let min_val = population[sorted_front[0]].objectives[obj_idx];
        let max_val = population[sorted_front[sorted_front.len() - 1]].objectives[obj_idx];
        let range = max_val - min_val;

        population[sorted_front[0]].crowding_distance = f64::INFINITY;
        population[sorted_front[sorted_front.len() - 1]].crowding_distance = f64::INFINITY;

        if range > 0.0 {
            for i in 1..sorted_front.len() - 1 {
                let prev = population[sorted_front[i - 1]].objectives[obj_idx];
                let next = population[sorted_front[i + 1]].objectives[obj_idx];
                population[sorted_front[i]].crowding_distance += (next - prev) / range;
            }
        }
    }
}
