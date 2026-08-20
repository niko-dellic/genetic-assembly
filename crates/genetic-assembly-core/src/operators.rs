use crate::{Individual, Variable};
use rand::Rng;
use rand_chacha::ChaCha20Rng;

pub struct Variation {
    pub crossover_probability: f64,
    pub mutation_probability: f64,
    pub sbx_distribution_index: f64,
    pub mutation_distribution_index: f64,
}

pub fn random_genes(variables: &[Variable], rng: &mut ChaCha20Rng) -> Vec<f64> {
    variables
        .iter()
        .map(|variable| match variable {
            Variable::Real { lower, upper } => rng.random_range(*lower..=*upper),
            Variable::Integer { lower, upper, step } => {
                let span = (*upper as i128 - *lower as i128) as u128;
                let slots = (span / *step as u128) as u64;
                (*lower as i128 + rng.random_range(0..=slots) as i128 * *step as i128) as f64
            }
            Variable::Binary => {
                if rng.random_bool(0.5) {
                    1.0
                } else {
                    0.0
                }
            }
        })
        .collect()
}

pub fn tournament<'a>(population: &'a [Individual], rng: &mut ChaCha20Rng) -> &'a Individual {
    let left = &population[rng.random_range(0..population.len())];
    let right = &population[rng.random_range(0..population.len())];
    if left.rank < right.rank
        || (left.rank == right.rank && left.crowding_distance > right.crowding_distance)
        || (left.rank == right.rank
            && left.crowding_distance == right.crowding_distance
            && left.id < right.id)
    {
        left
    } else {
        right
    }
}

pub fn make_child(
    left: &Individual,
    right: &Individual,
    variables: &[Variable],
    variation: &Variation,
    rng: &mut ChaCha20Rng,
) -> Vec<f64> {
    let mut genes = Vec::with_capacity(variables.len());
    for (index, variable) in variables.iter().enumerate() {
        let mut value = match variable {
            Variable::Real { lower, upper } => sbx_one(
                left.genes[index],
                right.genes[index],
                *lower,
                *upper,
                variation.crossover_probability,
                variation.sbx_distribution_index,
                rng,
            ),
            Variable::Integer { lower, upper, step } => {
                let raw = sbx_one(
                    left.genes[index],
                    right.genes[index],
                    *lower as f64,
                    *upper as f64,
                    variation.crossover_probability,
                    variation.sbx_distribution_index,
                    rng,
                );
                quantize_integer(raw, *lower, *upper, *step)
            }
            Variable::Binary => {
                if rng.random_bool(variation.crossover_probability) && rng.random_bool(0.5) {
                    right.genes[index]
                } else {
                    left.genes[index]
                }
            }
        };

        if rng.random_bool(variation.mutation_probability) {
            value = match variable {
                Variable::Real { lower, upper } => polynomial_mutation(
                    value,
                    *lower,
                    *upper,
                    variation.mutation_distribution_index,
                    rng,
                ),
                Variable::Integer { lower, upper, step } => quantize_integer(
                    polynomial_mutation(
                        value,
                        *lower as f64,
                        *upper as f64,
                        variation.mutation_distribution_index,
                        rng,
                    ),
                    *lower,
                    *upper,
                    *step,
                ),
                Variable::Binary => {
                    if value >= 0.5 {
                        0.0
                    } else {
                        1.0
                    }
                }
            };
        }
        genes.push(value);
    }
    genes
}

fn sbx_one(
    left: f64,
    right: f64,
    lower: f64,
    upper: f64,
    probability: f64,
    eta: f64,
    rng: &mut ChaCha20Rng,
) -> f64 {
    if !rng.random_bool(probability) || (left - right).abs() <= 1e-14 {
        return left;
    }
    let (x1, x2) = if left < right {
        (left, right)
    } else {
        (right, left)
    };
    let random = rng.random::<f64>();
    let beta = 1.0 + (2.0 * (x1 - lower) / (x2 - x1));
    let alpha = 2.0 - beta.powf(-(eta + 1.0));
    let beta_q = if random <= 1.0 / alpha {
        (random * alpha).powf(1.0 / (eta + 1.0))
    } else {
        (1.0 / (2.0 - random * alpha)).powf(1.0 / (eta + 1.0))
    };
    let first = 0.5 * ((x1 + x2) - beta_q * (x2 - x1));

    let beta = 1.0 + (2.0 * (upper - x2) / (x2 - x1));
    let alpha = 2.0 - beta.powf(-(eta + 1.0));
    let beta_q = if random <= 1.0 / alpha {
        (random * alpha).powf(1.0 / (eta + 1.0))
    } else {
        (1.0 / (2.0 - random * alpha)).powf(1.0 / (eta + 1.0))
    };
    let second = 0.5 * ((x1 + x2) + beta_q * (x2 - x1));
    let chosen = if rng.random_bool(0.5) { first } else { second };
    chosen.clamp(lower, upper)
}

fn polynomial_mutation(value: f64, lower: f64, upper: f64, eta: f64, rng: &mut ChaCha20Rng) -> f64 {
    if upper <= lower {
        return lower;
    }
    let delta1 = (value - lower) / (upper - lower);
    let delta2 = (upper - value) / (upper - lower);
    let random = rng.random::<f64>();
    let mutation_power = 1.0 / (eta + 1.0);
    let delta_q = if random <= 0.5 {
        let value = 2.0 * random + (1.0 - 2.0 * random) * (1.0 - delta1).powf(eta + 1.0);
        value.powf(mutation_power) - 1.0
    } else {
        let value = 2.0 * (1.0 - random) + 2.0 * (random - 0.5) * (1.0 - delta2).powf(eta + 1.0);
        1.0 - value.powf(mutation_power)
    };
    (value + delta_q * (upper - lower)).clamp(lower, upper)
}

fn quantize_integer(value: f64, lower: i64, upper: i64, step: u64) -> f64 {
    let slot = ((value - lower as f64) / step as f64).round().max(0.0) as u128;
    let quantized = lower as i128 + slot.saturating_mul(step as u128) as i128;
    quantized.clamp(lower as i128, upper as i128) as f64
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    #[test]
    fn mixed_variation_stays_typed_and_bounded() {
        let variables = vec![
            Variable::Real {
                lower: -2.5,
                upper: 4.5,
            },
            Variable::Integer {
                lower: -7,
                upper: 17,
                step: 4,
            },
            Variable::Binary,
        ];
        let left = Individual {
            id: 1,
            genes: vec![-2.5, -7.0, 0.0],
            objectives: vec![],
            constraints: vec![],
            constraint_violation: 0.0,
            rank: 0,
            crowding_distance: 0.0,
        };
        let right = Individual {
            id: 2,
            genes: vec![4.5, 17.0, 1.0],
            ..left.clone()
        };
        let variation = Variation {
            crossover_probability: 1.0,
            mutation_probability: 1.0,
            sbx_distribution_index: 15.0,
            mutation_distribution_index: 20.0,
        };
        let mut rng = ChaCha20Rng::seed_from_u64(7);
        for _ in 0..1_000 {
            let genes = make_child(&left, &right, &variables, &variation, &mut rng);
            assert!((-2.5..=4.5).contains(&genes[0]));
            assert!((-7.0..=17.0).contains(&genes[1]));
            assert_eq!(((genes[1] as i64) + 7) % 4, 0);
            assert!(genes[2] == 0.0 || genes[2] == 1.0);
        }
    }
}
