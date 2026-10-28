"""Train and evaluate an experimental model for HCES food consumption.

Run prepare_hces_model_data.py first. This model estimates a survey value; it
does not estimate a family's cash budget, savings, or ability to afford a goal.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd


# The prepared data and results are kept inside the Finance AI project folder.
PROJECT_FOLDER = Path(__file__).resolve().parents[1]
DATA_FILE = PROJECT_FOLDER / "data" / "processed" / "hces_food_model_ready.csv"
ARTIFACT_FOLDER = PROJECT_FOLDER / "ml" / "artifacts"
MODEL_FILE = ARTIFACT_FOLDER / "food_consumption_ridge.json"
METRICS_FILE = ARTIFACT_FOLDER / "food_model_evaluation.json"

TARGET_COLUMN = "recorded_food_consumption_30d_inr"
WEIGHT_COLUMN = "survey_weight"
SPLIT_COLUMN = "split"

# These are the columns that already exist in the prepared CSV.
INPUT_CATEGORICAL_COLUMNS = ["state_code", "area", "household_type"]
NUMERIC_COLUMNS = [
    "family_size",
    "children_under_5",
    "children_5_to_17",
    "adults_18_to_59",
    "adults_60_plus",
]
INPUT_FEATURE_COLUMNS = [*INPUT_CATEGORICAL_COLUMNS, *NUMERIC_COLUMNS]

# These groupings are derived from existing household input columns.
ENGINEERED_CATEGORICAL_COLUMNS = [
    "state_area",
    "family_size_band",
    "state_area_family_size_band",
    "household_type_family_size_band",
    "area_family_size_band",
    "family_size_detail_band",
    "state_area_detail_size_band",
    "under5_band",
    "school_age_band",
    "working_adult_band",
    "senior_band",
]

# Try penalties across a broad range, with extra checks near the best value.
RIDGE_ALPHA_VALUES = [1.0, 10.0, 30.0, 50.0, 75.0, 100.0, 150.0, 200.0, 300.0, 500.0, 1000.0, 10000.0]
TARGET_TRANSFORMS = ["raw", "sqrt", "log1p", "fourth_root"]

# Compare different ways to describe family size and household composition.
BASE_MODEL_FEATURES = [
    *INPUT_CATEGORICAL_COLUMNS,
    "state_area",
    "family_size_band",
]
SIZE_INTERACTION_FEATURES = [*BASE_MODEL_FEATURES, "state_area_family_size_band"]
DETAILED_SIZE_FEATURES = [
    *BASE_MODEL_FEATURES,
    "family_size_detail_band",
    "state_area_detail_size_band",
]
AGE_BAND_FEATURES = [
    "under5_band",
    "school_age_band",
    "working_adult_band",
    "senior_band",
]
FEATURE_VARIANTS = {
    "current_features": BASE_MODEL_FEATURES,
    "state_area_size_interaction": SIZE_INTERACTION_FEATURES,
    "both_size_interactions": [
        *BASE_MODEL_FEATURES,
        "state_area_family_size_band",
        "household_type_family_size_band",
    ],
    "age_bands": [*BASE_MODEL_FEATURES, *AGE_BAND_FEATURES],
    "detailed_size_interaction": DETAILED_SIZE_FEATURES,
    "size_interaction_plus_age_bands": [
        *SIZE_INTERACTION_FEATURES,
        *AGE_BAND_FEATURES,
    ],
    "detailed_size_plus_age_bands": [
        *DETAILED_SIZE_FEATURES,
        *AGE_BAND_FEATURES,
    ],
}


def weighted_mean(values, weights):
    """Calculate an average where survey-weighted rows count more."""
    return float(np.average(values, weights=weights))


def weighted_median(values, weights):
    """Return the middle value after counting each row by its survey weight."""
    order = np.argsort(values)
    sorted_values = values[order]
    sorted_weights = weights[order]
    halfway_weight = sorted_weights.sum() / 2
    middle_position = np.searchsorted(np.cumsum(sorted_weights), halfway_weight)
    return float(sorted_values[middle_position])


def make_family_size_bands(family_sizes):
    """Group household sizes into small, medium, and larger families."""
    return pd.cut(
        family_sizes,
        bins=[0, 2, 4, np.inf],
        labels=["1-2", "3-4", "5+"],
        include_lowest=True,
    ).astype(str)


def add_model_features(rows):
    """Add useful categories without changing the prepared source table."""
    rows = rows.copy()

    # Area can differ across states, so give the model a combined category too.
    rows["state_area"] = (
        rows["state_code"].astype(str) + "_" + rows["area"].astype(str)
    )

    # These bands let Ridge learn family-size patterns that are not straight lines.
    rows["family_size_band"] = make_family_size_bands(rows["family_size"])

    # More detailed size bands allow a flexible state-and-area comparison.
    rows["family_size_detail_band"] = pd.cut(
        rows["family_size"],
        bins=[0, 1, 2, 3, 4, 6, np.inf],
        labels=["1", "2", "3", "4", "5-6", "7+"],
        include_lowest=True,
    ).astype(str)
    rows["state_area_family_size_band"] = (
        rows["state_area"].astype(str) + "_" + rows["family_size_band"].astype(str)
    )
    rows["state_area_detail_size_band"] = (
        rows["state_area"].astype(str)
        + "_"
        + rows["family_size_detail_band"].astype(str)
    )
    rows["household_type_family_size_band"] = (
        rows["household_type"].astype(str)
        + "_"
        + rows["family_size_band"].astype(str)
    )
    rows["area_family_size_band"] = (
        rows["area"].astype(str) + "_" + rows["family_size_band"].astype(str)
    )

    # Group age counts so the model can learn non-linear household patterns.
    rows["under5_band"] = np.select(
        [rows["children_under_5"] == 0, rows["children_under_5"] == 1],
        ["0", "1"],
        default="2+",
    )
    rows["school_age_band"] = np.select(
        [rows["children_5_to_17"] == 0, rows["children_5_to_17"] <= 2],
        ["0", "1-2"],
        default="3+",
    )
    rows["working_adult_band"] = np.select(
        [rows["adults_18_to_59"] == 0, rows["adults_18_to_59"] <= 2],
        ["0", "1-2"],
        default="3+",
    )
    rows["senior_band"] = np.select(
        [rows["adults_60_plus"] == 0, rows["adults_60_plus"] == 1],
        ["0", "1"],
        default="2+",
    )
    return rows


def transform_target(values, transform_name):
    """Compress a long-tailed target before fitting, when selected."""
    if transform_name == "raw":
        return values
    if transform_name == "sqrt":
        return np.sqrt(values)
    if transform_name == "log1p":
        return np.log1p(values)
    if transform_name == "fourth_root":
        return np.power(values, 0.25)
    raise ValueError(f"Unknown target transformation: {transform_name}")


def inverse_transform_target(values, transform_name):
    """Convert model output back into rupees and keep predictions non-negative."""
    values = np.maximum(values, 0.0)
    if transform_name == "raw":
        return values
    if transform_name == "sqrt":
        return values**2
    if transform_name == "log1p":
        return np.expm1(values)
    if transform_name == "fourth_root":
        return values**4
    raise ValueError(f"Unknown target transformation: {transform_name}")


def make_baseline(training_rows):
    """Create a simple median-based estimate to compare with the ML model."""
    overall_median = weighted_median(
        training_rows[TARGET_COLUMN].to_numpy(dtype=float),
        training_rows[WEIGHT_COLUMN].to_numpy(dtype=float),
    )

    rows = training_rows.copy()
    rows["family_size_band"] = make_family_size_bands(rows["family_size"])

    # The baseline estimate depends only on rural/urban area and family size.
    median_by_group = {}
    for (area, size_band), group_rows in rows.groupby(
        ["area", "family_size_band"], observed=True
    ):
        median_by_group[(str(area), str(size_band))] = weighted_median(
            group_rows[TARGET_COLUMN].to_numpy(dtype=float),
            group_rows[WEIGHT_COLUMN].to_numpy(dtype=float),
        )

    def predict(frame):
        """Predict for new rows, using the overall median for an unseen group."""
        size_bands = make_family_size_bands(frame["family_size"])
        predictions = []
        for area, size_band in zip(frame["area"], size_bands):
            group_key = (str(area), str(size_band))
            predictions.append(median_by_group.get(group_key, overall_median))
        return np.asarray(predictions, dtype=float)

    return predict


def learn_feature_encoding(training_rows, training_weights, categorical_columns):
    """Record category names and weighted averages/scales from training data."""
    encoding = {
        "categories": {},
        "numeric_mean": {},
        "numeric_scale": {},
        "encoded_columns": [],
    }

    # Each category gets its own 0-or-1 column (one-hot encoding).
    for column in categorical_columns:
        categories = sorted(training_rows[column].astype(str).unique().tolist())
        encoding["categories"][column] = categories
        for category in categories:
            encoding["encoded_columns"].append(f"{column}={category}")

    # Scaling numeric inputs keeps large and small numbers on similar footing.
    for column in NUMERIC_COLUMNS:
        values = training_rows[column].to_numpy(dtype=float)
        average = weighted_mean(values, training_weights)
        variance = weighted_mean((values - average) ** 2, training_weights)
        scale = float(np.sqrt(variance))

        # A column with one repeated value cannot be divided by zero.
        if scale == 0:
            scale = 1.0

        encoding["numeric_mean"][column] = average
        encoding["numeric_scale"][column] = scale
        encoding["encoded_columns"].append(column)

    return encoding


def make_design_matrix(rows, encoding):
    """Turn a table into the number matrix Ridge regression needs."""
    columns = []

    # The first column is always 1; its coefficient is the model's intercept.
    columns.append(np.ones((len(rows), 1), dtype=float))

    # Represent each text category with a separate 0-or-1 column.
    for column, categories in encoding["categories"].items():
        observed_values = rows[column].astype(str).to_numpy()
        for category in categories:
            is_category = (observed_values == category).astype(float)
            columns.append(is_category.reshape(-1, 1))

    # Standardize each numeric value using averages learned from training data.
    for column in NUMERIC_COLUMNS:
        values = rows[column].to_numpy(dtype=float)
        average = encoding["numeric_mean"][column]
        scale = encoding["numeric_scale"][column]
        standardized_values = (values - average) / scale
        columns.append(standardized_values.reshape(-1, 1))

    return np.concatenate(columns, axis=1)


def calculate_metrics(actual, predicted, weights):
    """Report weighted MAE and RMSE in rupees."""
    errors = predicted - actual
    mean_absolute_error = np.average(np.abs(errors), weights=weights)
    root_mean_squared_error = np.sqrt(np.average(errors**2, weights=weights))
    return {
        "weighted_mae_inr": float(mean_absolute_error),
        "weighted_rmse_inr": float(root_mean_squared_error),
    }


def calculate_group_metrics(rows, predictions, group_column):
    """Calculate errors separately for area or household-size groups."""
    if group_column == "family_size_band":
        group_names = make_family_size_bands(rows["family_size"])
    else:
        group_names = rows[group_column].astype(str)

    results = {}
    for group_name in sorted(group_names.astype(str).unique()):
        belongs_to_group = group_names.astype(str).eq(group_name).to_numpy()
        group_rows = rows.loc[belongs_to_group]
        results[str(group_name)] = {
            "rows": int(len(group_rows)),
            **calculate_metrics(
                group_rows[TARGET_COLUMN].to_numpy(dtype=float),
                predictions[belongs_to_group],
                group_rows[WEIGHT_COLUMN].to_numpy(dtype=float),
            ),
        }

    return results


def train_and_evaluate():
    """Fit Ridge regression, choose settings, then evaluate the held-out test set."""
    if not DATA_FILE.is_file():
        raise FileNotFoundError(
            f"Prepared data was not found at {DATA_FILE}. "
            "Run prepare_hces_model_data.py first."
        )

    # Load categories as text so their codes are not treated as measurements.
    data = pd.read_csv(
        DATA_FILE,
        dtype={column: "string" for column in INPUT_CATEGORICAL_COLUMNS},
    )

    required_columns = [*INPUT_FEATURE_COLUMNS, TARGET_COLUMN, WEIGHT_COLUMN, SPLIT_COLUMN]
    if data[required_columns].isna().any().any():
        raise ValueError("Prepared data contains missing inputs, targets, weights, or splits.")
    if set(data[SPLIT_COLUMN].unique()) != {"train", "validation", "test"}:
        raise ValueError("The data must contain train, validation, and test splits.")
    if (data[WEIGHT_COLUMN] <= 0).any():
        raise ValueError("Survey weights must be greater than zero.")

    # Training teaches the model; validation chooses settings; test checks the final result.
    training_rows = data.loc[data[SPLIT_COLUMN] == "train"].reset_index(drop=True)
    validation_rows = data.loc[data[SPLIT_COLUMN] == "validation"].reset_index(drop=True)
    test_rows = data.loc[data[SPLIT_COLUMN] == "test"].reset_index(drop=True)

    # Derived categories use only fields already available at prediction time.
    training_rows = add_model_features(training_rows)
    validation_rows = add_model_features(validation_rows)
    test_rows = add_model_features(test_rows)

    # Normalize weights to average 1. This keeps their relative importance and
    # makes the Ridge penalty easier to interpret.
    raw_training_weights = training_rows[WEIGHT_COLUMN].to_numpy(dtype=float)
    training_weights = raw_training_weights / raw_training_weights.mean()

    # Keep the target in rupees before each model tries a different transformation.
    training_targets = training_rows[TARGET_COLUMN].to_numpy(dtype=float)

    baseline_predict = make_baseline(training_rows)
    validation_actual = validation_rows[TARGET_COLUMN].to_numpy(dtype=float)
    validation_weights = validation_rows[WEIGHT_COLUMN].to_numpy(dtype=float)
    baseline_validation_predictions = baseline_predict(validation_rows)
    baseline_validation_metrics = calculate_metrics(
        validation_actual,
        baseline_validation_predictions,
        validation_weights,
    )

    # Try each feature version, target transformation, and penalty on validation data.
    candidates = []
    for variant_name, categorical_columns in FEATURE_VARIANTS.items():
        encoding = learn_feature_encoding(
            training_rows,
            training_weights,
            categorical_columns,
        )
        training_matrix = make_design_matrix(training_rows, encoding)
        validation_matrix = make_design_matrix(validation_rows, encoding)

        weighted_matrix = training_matrix * training_weights[:, None]
        left_side = training_matrix.T @ weighted_matrix

        for transform_name in TARGET_TRANSFORMS:
            transformed_targets = transform_target(training_targets, transform_name)
            target_average = weighted_mean(transformed_targets, training_weights)
            target_variance = weighted_mean(
                (transformed_targets - target_average) ** 2,
                training_weights,
            )
            target_scale = float(np.sqrt(target_variance))
            if not np.isfinite(target_scale) or target_scale <= 0:
                raise ValueError("Training target does not have usable variation.")

            scaled_targets = (transformed_targets - target_average) / target_scale
            right_side = training_matrix.T @ (scaled_targets * training_weights)

            for alpha in RIDGE_ALPHA_VALUES:
                ridge_equation = left_side.copy()

                # Ridge shrinks coefficients toward zero. Do not shrink the intercept.
                for coefficient_number in range(1, ridge_equation.shape[0]):
                    ridge_equation[coefficient_number, coefficient_number] += alpha

                coefficients = np.linalg.solve(ridge_equation, right_side)
                scaled_predictions = validation_matrix @ coefficients
                transformed_predictions = target_average + target_scale * scaled_predictions
                predictions = inverse_transform_target(
                    transformed_predictions,
                    transform_name,
                )
                metrics = calculate_metrics(validation_actual, predictions, validation_weights)

                candidates.append(
                    {
                        "feature_variant": variant_name,
                        "target_transform": transform_name,
                        "categorical_features": categorical_columns,
                        "encoding": encoding,
                        "target_average": target_average,
                        "target_scale": target_scale,
                        "alpha": alpha,
                        "coefficients": coefficients,
                        "predictions": predictions,
                        **metrics,
                    }
                )

    selected_candidate = min(candidates, key=lambda candidate: candidate["weighted_mae_inr"])
    validation_model_predictions = selected_candidate["predictions"]
    validation_model_metrics = {
        "weighted_mae_inr": selected_candidate["weighted_mae_inr"],
        "weighted_rmse_inr": selected_candidate["weighted_rmse_inr"],
    }
    validation_model_beats_baseline = (
        validation_model_metrics["weighted_mae_inr"]
        < baseline_validation_metrics["weighted_mae_inr"]
    )

    # Use the test rows only after choosing features, target scale, and alpha.
    test_matrix = make_design_matrix(test_rows, selected_candidate["encoding"])
    test_actual = test_rows[TARGET_COLUMN].to_numpy(dtype=float)
    test_weights = test_rows[WEIGHT_COLUMN].to_numpy(dtype=float)
    test_transformed_predictions = selected_candidate["target_average"] + selected_candidate[
        "target_scale"
    ] * (
        test_matrix @ selected_candidate["coefficients"]
    )
    test_model_predictions = inverse_transform_target(
        test_transformed_predictions,
        selected_candidate["target_transform"],
    )
    test_baseline_predictions = baseline_predict(test_rows)

    test_model_metrics = calculate_metrics(test_actual, test_model_predictions, test_weights)
    test_baseline_metrics = calculate_metrics(test_actual, test_baseline_predictions, test_weights)
    test_model_beats_baseline = (
        test_model_metrics["weighted_mae_inr"] < test_baseline_metrics["weighted_mae_inr"]
    )

    if validation_model_beats_baseline and test_model_beats_baseline:
        recommendation = (
            "candidate_beats_baseline_on_validation_and_test; "
            "review subgroup errors before app use"
        )
    else:
        recommendation = (
            "do_not_integrate_candidate_yet; retain deterministic calculations "
            "and investigate errors"
        )

    # Save enough information to reproduce predictions from this fitted model.
    model_details = {
        "model_name": "survey_weighted_ridge_regression",
        "model_status": "experimental; not an affordability model",
        "target": TARGET_COLUMN,
        "features": INPUT_FEATURE_COLUMNS,
        "selected_feature_variant": selected_candidate["feature_variant"],
        "target_transform": selected_candidate["target_transform"],
        "transformed_target_weighted_mean": selected_candidate["target_average"],
        "transformed_target_weighted_scale": selected_candidate["target_scale"],
        "engineered_features": {
            "state_area": "state_code combined with rural/urban area",
            "family_size_band": "family size grouped as 1-2, 3-4, or 5+ people",
            "state_area_family_size_band": "state/area combined with the 1-2, 3-4, or 5+ family-size band",
            "family_size_detail_band": "family size grouped as 1, 2, 3, 4, 5-6, or 7+ people",
            "state_area_detail_size_band": "state/area combined with the detailed family-size band",
            "household_type_family_size_band": "household type combined with the broad family-size band",
            "area_family_size_band": "rural/urban area combined with the broad family-size band",
            "under5_band": "children under 5 grouped as 0, 1, or 2+",
            "school_age_band": "children aged 5-17 grouped as 0, 1-2, or 3+",
            "working_adult_band": "adults aged 18-59 grouped as 0, 1-2, or 3+",
            "senior_band": "adults aged 60+ grouped as 0, 1, or 2+",
        },
        "categorical_features": selected_candidate["categorical_features"],
        "numeric_features": NUMERIC_COLUMNS,
        "survey_weight_column": WEIGHT_COLUMN,
        "survey_weight_is_predictor": False,
        "selected_alpha": selected_candidate["alpha"],
        "encoding": selected_candidate["encoding"],
        "coefficients_in_encoded_column_order_with_intercept_first": (
            selected_candidate["coefficients"].tolist()
        ),
        "intercept_column": "constant_1",
        "clip_negative_predictions_to_zero": True,
        "training_rows": int(len(training_rows)),
        "known_limit": (
            "Predicts survey-recorded 30-day food consumption, "
            "not necessarily household cash spending."
        ),
    }

    # Keep both overall and subgroup errors so the result can be reviewed fairly.
    validation_feature_experiments = {}
    for variant_name in FEATURE_VARIANTS:
        # Keep the best alpha for each feature variant for a clear comparison.
        variant_candidates = [
            candidate
            for candidate in candidates
            if candidate["feature_variant"] == variant_name
        ]
        best_variant_candidate = min(
            variant_candidates,
            key=lambda candidate: candidate["weighted_mae_inr"],
        )
        validation_feature_experiments[variant_name] = {
            "target_transform": best_variant_candidate["target_transform"],
            "selected_alpha": best_variant_candidate["alpha"],
            "weighted_mae_inr": best_variant_candidate["weighted_mae_inr"],
            "weighted_rmse_inr": best_variant_candidate["weighted_rmse_inr"],
        }

    evaluation_results = {
        "baseline": "survey-weighted median by area and family-size band (1-2, 3-4, 5+)",
        "candidate": "survey-weighted Ridge regression with validation-selected features and target transformation",
        "engineered_features": {
            "state_area": "state_code combined with rural/urban area",
            "family_size_band": "family size grouped as 1-2, 3-4, or 5+ people",
            "state_area_family_size_band": "state/area combined with the 1-2, 3-4, or 5+ family-size band",
            "family_size_detail_band": "family size grouped as 1, 2, 3, 4, 5-6, or 7+ people",
            "state_area_detail_size_band": "state/area combined with the detailed family-size band",
            "household_type_family_size_band": "household type combined with the broad family-size band",
            "area_family_size_band": "rural/urban area combined with the broad family-size band",
            "under5_band": "children under 5 grouped as 0, 1, or 2+",
            "school_age_band": "children aged 5-17 grouped as 0, 1-2, or 3+",
            "working_adult_band": "adults aged 18-59 grouped as 0, 1-2, or 3+",
            "senior_band": "adults aged 60+ grouped as 0, 1, or 2+",
        },
        "selection_rule": (
            "lowest validation weighted MAE across feature variants, target transformations, "
            "and alpha values; test evaluated after selection"
        ),
        "validation_feature_experiments": validation_feature_experiments,
        "alpha_values_checked": RIDGE_ALPHA_VALUES,
        "target_transforms_checked": TARGET_TRANSFORMS,
        "selected_feature_variant": selected_candidate["feature_variant"],
        "selected_target_transform": selected_candidate["target_transform"],
        "selected_alpha": selected_candidate["alpha"],
        "rows_by_split": {
            str(name): int(count)
            for name, count in data[SPLIT_COLUMN].value_counts().items()
        },
        "validation": {
            "baseline": baseline_validation_metrics,
            "candidate": validation_model_metrics,
            "candidate_beats_baseline_by_weighted_mae": validation_model_beats_baseline,
            "candidate_by_area": calculate_group_metrics(
                validation_rows, validation_model_predictions, "area"
            ),
            "baseline_by_family_size_band": calculate_group_metrics(
                validation_rows, baseline_validation_predictions, "family_size_band"
            ),
            "candidate_by_family_size_band": calculate_group_metrics(
                validation_rows, validation_model_predictions, "family_size_band"
            ),
        },
        "test": {
            "baseline": test_baseline_metrics,
            "candidate": test_model_metrics,
            "candidate_beats_baseline_by_weighted_mae": test_model_beats_baseline,
            "baseline_by_area": calculate_group_metrics(
                test_rows, test_baseline_predictions, "area"
            ),
            "candidate_by_area": calculate_group_metrics(
                test_rows, test_model_predictions, "area"
            ),
            "baseline_by_family_size_band": calculate_group_metrics(
                test_rows, test_baseline_predictions, "family_size_band"
            ),
            "candidate_by_family_size_band": calculate_group_metrics(
                test_rows, test_model_predictions, "family_size_band"
            ),
        },
        "recommendation": recommendation,
        "limitations": [
            "The source CSV is user-provided and derived; original derivation notes were not supplied.",
            "HCES food consumption may include home-produced or imputed consumption and is not necessarily cash spending.",
            "The model cannot predict savings, debt affordability, or financial-goal success.",
            "This held-out test split has been used in earlier candidate checks, so treat its result as exploratory.",
            "The detailed feature and target searches can overfit validation results; confirm with a new survey sample.",
            "Do not show this experimental estimate to users without further evaluation and review.",
        ],
    }

    ARTIFACT_FOLDER.mkdir(parents=True, exist_ok=True)
    MODEL_FILE.write_text(
        json.dumps(model_details, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    METRICS_FILE.write_text(
        json.dumps(evaluation_results, indent=2, allow_nan=False),
        encoding="utf-8",
    )

    # Print the most useful results in the terminal after training.
    print(
        json.dumps(
            {
                "selected_alpha": selected_candidate["alpha"],
                "selected_feature_variant": selected_candidate["feature_variant"],
                "selected_target_transform": selected_candidate["target_transform"],
                "validation_baseline_weighted_mae_inr": (
                    baseline_validation_metrics["weighted_mae_inr"]
                ),
                "validation_model_weighted_mae_inr": (
                    validation_model_metrics["weighted_mae_inr"]
                ),
                "test_baseline_weighted_mae_inr": test_baseline_metrics["weighted_mae_inr"],
                "test_model_weighted_mae_inr": test_model_metrics["weighted_mae_inr"],
                "recommendation": recommendation,
                "metrics_file": str(METRICS_FILE),
                "model_file": str(MODEL_FILE),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    train_and_evaluate()
