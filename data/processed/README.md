# Prepared HCES data

This file is a model-ready copy of the user-provided household CSV. The original CSV is unchanged.

- Target: `recorded_food_consumption_30d_inr` (recorded 30-day food consumption).
- Inputs: `state_code`, `area`, `family_size`, `children_under_5`, `children_5_to_17`, `adults_18_to_59`, `adults_60_plus`, `household_type`.
- Survey weight: `survey_weight` is kept for model fitting and evaluation, not as an input.
- Whole FSUs are kept together in train, validation, or test data. Household and FSU IDs are not exported.
- 58 rows without a target are excluded from this prepared copy. No unknown values are filled with zero.

## Limits

Survey consumption may include home-produced or otherwise imputed items; it is not necessarily cash spending. This data cannot train a model for savings, debt affordability, or goal success. The source is a derived file and its original derivation notes were not supplied.
