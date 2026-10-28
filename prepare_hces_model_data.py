"""Prepare the HCES CSV for the experimental food-consumption model.

Run this script before training the model. It creates a cleaned copy of the
needed columns and keeps the original household CSV unchanged.
"""

import json
import random
from pathlib import Path

import pandas as pd


# All project paths are based on this script's location.
PROJECT_FOLDER = Path(__file__).resolve().parent
SOURCE_CSV = PROJECT_FOLDER / "india_hces_household_spending.csv"
OUTPUT_FOLDER = PROJECT_FOLDER / "data" / "processed"
OUTPUT_CSV = OUTPUT_FOLDER / "hces_food_model_ready.csv"
SUMMARY_FILE = OUTPUT_FOLDER / "hces_food_model_summary.json"
README_FILE = OUTPUT_FOLDER / "README.md"

# A fixed seed makes the same households land in the same data splits each run.
RANDOM_SEED = 42

# These are household details the model will use to estimate food consumption.
FEATURE_COLUMNS = [
    "state_code",
    "area",
    "family_size",
    "children_under_5",
    "children_5_to_17",
    "adults_18_to_59",
    "adults_60_plus",
    "household_type",
]

# The answer the model learns to estimate.
TARGET_COLUMN = "recorded_food_consumption_30d_inr"

# Survey weights help the model reflect the survey design. They are not inputs.
WEIGHT_COLUMN = "survey_weight"

# Households in the same FSU are kept together when making data splits.
HOUSEHOLD_ID_COLUMN = "household_id"
FSU_COLUMNS = ["state_code", "area", "fsu_serial_no"]


def assign_fsu_splits(data):
    """Assign each survey FSU to train, validation, or test."""
    unique_fsus = data[FSU_COLUMNS].drop_duplicates()
    random_generator = random.Random(RANDOM_SEED)
    assignments = {}

    # Make separate splits for each state and rural/urban area.
    for (state, area), group in unique_fsus.groupby(["state_code", "area"], sort=True):
        fsu_numbers = group["fsu_serial_no"].astype(str).tolist()
        random_generator.shuffle(fsu_numbers)

        total_fsus = len(fsu_numbers)
        test_count = max(1, round(total_fsus * 0.10))
        validation_count = max(1, round(total_fsus * 0.10))

        if test_count + validation_count >= total_fsus:
            raise ValueError(
                f"Not enough FSUs to split state {state}, area {area}."
            )

        for position, fsu_number in enumerate(fsu_numbers):
            if position < test_count:
                split_name = "test"
            elif position < test_count + validation_count:
                split_name = "validation"
            else:
                split_name = "train"

            # The state and area are part of the key in case FSU numbers repeat.
            key = (str(state), str(area), fsu_number)
            assignments[key] = split_name

    return assignments


def main():
    """Check the source, prepare the model table, and save a summary."""
    if not SOURCE_CSV.is_file():
        raise FileNotFoundError(f"Could not find the source CSV: {SOURCE_CSV}")

    # Read only columns needed for model inputs, the target, weights, and splits.
    columns_to_read = list(
        dict.fromkeys(
            [HOUSEHOLD_ID_COLUMN, *FSU_COLUMNS, *FEATURE_COLUMNS, TARGET_COLUMN, WEIGHT_COLUMN]
        )
    )
    data = pd.read_csv(
        SOURCE_CSV,
        usecols=columns_to_read,
        dtype={"state_code": "string", "area": "string", "household_type": "string"},
    )

    source_row_count = len(data)

    # A repeated household ID could mean duplicate records, so stop and inspect it.
    duplicate_id_count = int(data[HOUSEHOLD_ID_COLUMN].duplicated().sum())
    if duplicate_id_count > 0:
        raise ValueError(
            f"Found {duplicate_id_count} repeated household IDs. Review them before continuing."
        )

    # Do not guess values for missing inputs, weights, or split information.
    required_columns = [*FEATURE_COLUMNS, WEIGHT_COLUMN, *FSU_COLUMNS]
    missing_counts = data[required_columns].isna().sum()
    columns_with_missing_values = missing_counts[missing_counts > 0]
    if not columns_with_missing_values.empty:
        raise ValueError(
            "Some model inputs or split fields are missing: "
            f"{columns_with_missing_values.to_dict()}"
        )

    if (data[WEIGHT_COLUMN] <= 0).any():
        raise ValueError("Every survey weight must be greater than zero.")

    observed_targets = data[TARGET_COLUMN].dropna()
    if (observed_targets < 0).any():
        raise ValueError("The food-consumption target contains negative values.")

    # Remove accidental spaces around category names, without changing numbers.
    for column in ["area", "household_type"]:
        data[column] = data[column].str.strip()

    # Rows without the answer (target) cannot teach a supervised model.
    # They stay in the original CSV and are omitted only from this prepared copy.
    missing_target_count = int(data[TARGET_COLUMN].isna().sum())
    prepared = data.loc[data[TARGET_COLUMN].notna()].copy()

    # Keep all households from the same FSU in one split to reduce data leakage.
    split_lookup = assign_fsu_splits(prepared)
    split_keys = zip(
        prepared["state_code"].astype(str),
        prepared["area"].astype(str),
        prepared["fsu_serial_no"].astype(str),
    )
    prepared["split"] = [split_lookup[key] for key in split_keys]

    # Keep a temporary copy of the group labels for the split summary below.
    split_groups = prepared[[*FSU_COLUMNS, "split"]].drop_duplicates()

    # Save no personal/record IDs. Keep only the survey weight and split label.
    output_columns = [*FEATURE_COLUMNS, TARGET_COLUMN, WEIGHT_COLUMN, "split"]
    prepared = prepared[output_columns]

    # Shuffle rows in a repeatable way so files are not grouped by source order.
    prepared = prepared.sample(frac=1, random_state=RANDOM_SEED).reset_index(drop=True)

    OUTPUT_FOLDER.mkdir(parents=True, exist_ok=True)
    prepared.to_csv(OUTPUT_CSV, index=False)

    # Count rows and survey groups so the split can be checked later.
    rows_by_split = {
        str(name): int(count)
        for name, count in prepared["split"].value_counts().sort_index().items()
    }
    fsus_by_split = (
        split_groups
        .groupby("split")
        .size()
        .astype(int)
        .to_dict()
    )
    rows_by_area_and_split = {}
    for split_name, split_rows in prepared.groupby("split", sort=True):
        rows_by_area_and_split[str(split_name)] = {
            str(area): int(count)
            for area, count in split_rows["area"].value_counts().items()
        }

    # This summary records what was done without storing household identifiers.
    summary = {
        "source_file": SOURCE_CSV.name,
        "source_rows": source_row_count,
        "unique_household_ids": int(data[HOUSEHOLD_ID_COLUMN].nunique()),
        "repeated_household_ids": duplicate_id_count,
        "rows_missing_target_excluded_from_training_table": missing_target_count,
        "prepared_rows": len(prepared),
        "feature_columns": FEATURE_COLUMNS,
        "target_column": TARGET_COLUMN,
        "survey_weight_column": WEIGHT_COLUMN,
        "survey_weight_is_a_predictor": False,
        "group_split_fields_not_exported": FSU_COLUMNS,
        "split_method": "Whole FSUs split within state and rural/urban groups; about 80/10/10",
        "random_seed": RANDOM_SEED,
        "rows_by_split": rows_by_split,
        "fsus_by_split": {str(name): count for name, count in fsus_by_split.items()},
        "rows_by_split_and_area": rows_by_area_and_split,
        "positive_survey_weights": bool((prepared[WEIGHT_COLUMN] > 0).all()),
        "target_nonnegative": bool((prepared[TARGET_COLUMN] >= 0).all()),
        "known_limits": [
            "Recorded food consumption is not necessarily money paid out of pocket.",
            "The source does not label savings, loan affordability, or financial-goal outcomes.",
            "The user-provided source is derived; its original derivation notes were not supplied.",
        ],
    }
    SUMMARY_FILE.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    # Keep a short explanation beside the prepared data.
    readme_text = (
        "# Prepared HCES data\n\n"
        "This file is a model-ready copy of the user-provided household CSV. "
        "The original CSV is unchanged.\n\n"
        f"- Target: `{TARGET_COLUMN}` (recorded 30-day food consumption).\n"
        f"- Inputs: {', '.join(f'`{name}`' for name in FEATURE_COLUMNS)}.\n"
        f"- Survey weight: `{WEIGHT_COLUMN}` is kept for model fitting and evaluation, "
        "not as an input.\n"
        "- Whole FSUs are kept together in train, validation, or test data. "
        "Household and FSU IDs are not exported.\n"
        f"- {missing_target_count} rows without a target are excluded from this prepared copy. "
        "No unknown values are filled with zero.\n\n"
        "## Limits\n\n"
        "Survey consumption may include home-produced or otherwise imputed items; "
        "it is not necessarily cash spending. This data cannot train a model for savings, "
        "debt affordability, or goal success. The source is a derived file and its "
        "original derivation notes were not supplied.\n"
    )
    README_FILE.write_text(readme_text, encoding="utf-8")

    print(
        json.dumps(
            {
                "prepared_rows": len(prepared),
                "rows_by_split": rows_by_split,
                "output_csv": str(OUTPUT_CSV),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
