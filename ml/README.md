# HCES food-consumption model

This folder contains an experimental machine-learning exercise for the Finance AI project.

## What the model estimates

It estimates a household's recorded 30-day food-consumption value from a few household details. HCES consumption can include home-produced or imputed items, so the value is not always the amount of cash a family paid for food.

This is not a model for income, savings, loan affordability, or whether someone can afford a house or car. The app's finance guidance should come from transparent calculations using the person's own inputs.

## Files and simple workflow

1. `prepare_hces_model_data.py` reads the original CSV and makes a smaller training table in `data/processed/`.
2. `ml/train_food_model.py` trains the model and saves it and its evaluation results in `ml/artifacts/`.

The scripts do not change the original CSV. The preparation step excludes rows without a food-consumption target only from the training copy. It does not fill unknown values with zero. It keeps households from the same survey FSU together in one split.

## How training works

- The script uses survey weights when fitting and evaluating the model. A survey weight is not a prediction input.
- It converts text categories to simple 0-or-1 columns and scales numeric columns.
- It derives extra family-size and age-composition groups from existing inputs. The prepared CSV stays unchanged.
- It compares seven feature versions and four target scales (rupees, square root, log, and fourth root), across twelve Ridge regularization settings. This is 336 candidate fits. Validation data chooses the best combination; test data checks it afterward.
- It compares the model with a weighted-median baseline and reports weighted MAE and RMSE overall and for area/family-size groups.
- If the model does not beat the baseline, the evaluation recommends not integrating it.

The extra categories are feature engineering, not new data. They let the model represent different patterns by state/area, family size, and household age composition. A target transformation compresses unusually large food-consumption values while training; predictions are converted back to rupees before scoring. The saved evaluation file records the validation comparison and selected model's test results. The test split has been used in earlier candidate checks, so treat it as exploratory. The goal is to reduce error without using the target as an input; zero error is not realistic for this survey and these limited household details.

## Run it

Open PowerShell in the Finance AI folder. Python with `pandas` and `numpy` must be available. Run:

```powershell
python prepare_hces_model_data.py
python ml\train_food_model.py
```

The model and results are written to:

- `ml/artifacts/food_consumption_ridge.json`
- `ml/artifacts/food_model_evaluation.json`

## Data limitations

The supplied CSV is user-provided and derived; its original derivation notes were not supplied. Neither the raw CSV nor the generated row-level training CSV is committed. Before using the local source again, verify its provenance, definitions, and reuse terms. Survey consumption is not necessarily a cash expense. The data has no labels for income, savings, debts, or goal outcomes, so it cannot train those predictions. The food model remains experimental and is not used by the app for personalized financial advice or guaranteed predictions.
