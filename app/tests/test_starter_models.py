"""Check synthetic provenance, split isolation and artifact reproducibility."""
import csv
import hashlib
import json
from pathlib import Path
import runpy
import unittest

ROOT = Path(__file__).resolve().parents[2]

class StarterDataTests(unittest.TestCase):
    def test_rows_are_synthetic_and_groups_never_cross_splits(self):
        for name in ["transaction_notes.csv", "spending_scenarios.csv"]:
            with (ROOT/"data/synthetic"/name).open(encoding="utf-8", newline="") as stream:
                rows=list(csv.DictReader(stream))
            self.assertGreater(len(rows),100)
            groups={}
            for row in rows:
                self.assertEqual(row["source"],"synthetic")
                self.assertIn(row["split"],{"train","validation","test"})
                groups.setdefault(row["group"],set()).add(row["split"])
            self.assertTrue(all(len(splits)==1 for splits in groups.values()))

    def test_evaluation_hashes_match_shipped_datasets(self):
        report=json.loads((ROOT/"data/synthetic/evaluation.json").read_text())
        self.assertFalse(report["real_world_validation"])
        for name,digest in report["sha256"].items():
            self.assertEqual(hashlib.sha256((ROOT/"data/synthetic"/name).read_bytes()).hexdigest(),digest)
        self.assertGreater(report["forecast"]["mae_inr"],0)

    def test_exported_weights_are_reproducible_from_training_rows(self):
        trainer=runpy.run_path(str(ROOT/"ml/train_starter_models.py"))
        text=(ROOT/"app/js/starter_models.mjs").read_text(encoding="utf-8")
        artifact=json.loads(text.split(" = ",1)[1].strip().removesuffix(";"))
        categories=trainer["fit_categories"](trainer["category_data"](),artifact["category"]["smoothing"])
        self.assertEqual(categories["categories"],artifact["category"]["categories"])
        forecast=trainer["fit_forecast"](trainer["forecast_data"](),artifact["forecast"]["ridge"])
        self.assertEqual(forecast,artifact["forecast"]["coefficients"])

if __name__=="__main__":
    unittest.main()
