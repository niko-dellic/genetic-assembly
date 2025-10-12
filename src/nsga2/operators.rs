use rand::prelude::*;
use rand::rngs::SmallRng;
use crate::types::Individual;

/// Binary tournament selection
pub fn tournament_selection<'a>(population: &'a [Individual], rng: &mut SmallRng) -> &'a Individual {
    let idx1 = rng.gen_range(0..population.len());
    let idx2 = rng.gen_range(0..population.len());

    let ind1 = &population[idx1];
    let ind2 = &population[idx2];

    if ind1.rank < ind2.rank {
        ind1
    } else if ind1.rank > ind2.rank {
        ind2
    } else if ind1.crowding_distance > ind2.crowding_distance {
        ind1
    } else {
        ind2
    }
}

/// Single-point crossover
pub fn crossover(
    parent1: &Individual,
    parent2: &Individual,
    rate: f64,
    rng: &mut SmallRng,
) -> Individual {
    if rng.gen::<f64>() > rate {
        return parent1.clone();
    }

    let point = rng.gen_range(1..parent1.genes.len());
    let mut child_genes = Vec::with_capacity(parent1.genes.len());

    child_genes.extend_from_slice(&parent1.genes[..point]);
    child_genes.extend_from_slice(&parent2.genes[point..]);

    Individual {
        genes: child_genes,
        objectives: Vec::new(),
        rank: 0,
        crowding_distance: 0.0,
    }
}

/// Bit-flip mutation for binary genes
pub fn mutate(individual: &mut Individual, rate: f64, rng: &mut SmallRng) {
    for gene in &mut individual.genes {
        if rng.gen::<f64>() < rate {
            *gene = if *gene > 0.5 { 0.0 } else { 1.0 };
        }
    }
}

