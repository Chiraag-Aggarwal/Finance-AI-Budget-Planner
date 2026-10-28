# Finance AI — Indian household budget planner

A beginner-friendly personal finance app for Indian households. It helps users understand monthly cash flow, plan general savings or a specific purchase, and compare illustrative loan EMIs against their budget.

## What the app does

- Tracks monthly income and spending entered by the user.
- Calculates remaining monthly balance and a user-selected emergency-fund target.
- Builds a flexible savings plan even when the user has no purchase goal.
- Plans one optional goal at a time, such as a car, bike, house, plot, education, medical costs, travel, or another purchase.
- Lets users explicitly include an accessible amount from assets or family support toward a goal; it does not treat total net worth or a property's full value as cash.
- Compares example EMI periods when the user supplies an annual interest rate from a lender quote. Existing EMIs and household expenses reduce the available monthly amount.
- Provides an English/Hindi interface and a small, rule-based budget helper.

The planner uses transparent arithmetic for budget and goal guidance. It does not predict goal success, approve loans, or infer a lender's interest rate from income. The separate HCES model estimates recorded survey food consumption only; the app does not use it for personal budget or loan recommendations.

## Project layout

- `app/` — HTML/CSS/JavaScript interface and Python standard-library account server.
- `ml/` — experimental, separate HCES food-consumption training script and saved model/evaluation artifacts.
- `data/goal_planning_sources.md` — data choices and limitations for future goal-planning models.
- `prepare_hces_model_data.py` — creates a model-ready copy from a locally supplied CSV.

## Run the app

Install Python 3.10 or newer. In PowerShell, run:

```powershell
cd app
python server.py
```

Open `http://localhost:8000` and keep the terminal open while using the app. If port 8000 is occupied, use another port:

```powershell
$env:FINANCE_AI_PORT = "8001"
python server.py
```

Account profiles are stored in a local SQLite database. Budget figures are saved in the browser only when the user opts in. The database and local user data are excluded from this repository.

## Run the checks

With Node.js installed, run the JavaScript tests from `app/`:

```powershell
cd app
node --test tests/*.test.mjs
```

Run the Python account tests from `app/`:

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
```

## Optional HCES experiment

The original `india_hces_household_spending.csv` and the prepared row-level training CSV are not included. The supplied source is a derived file whose original derivation notes were not provided, and the raw file exceeds GitHub's 100 MB per-file limit. The project `.gitignore` keeps both CSVs out of commits.

Only use a copy whose provenance, definitions, and reuse terms you have checked. Place it at the Finance AI folder root as `india_hces_household_spending.csv`, then run from that root:

```powershell
python prepare_hces_model_data.py
python ml/train_food_model.py
```

The scripts need Python with `pandas` and `numpy` installed. Read `ml/README.md` before interpreting the results. HCES consumption is not necessarily cash spending and does not provide labels for savings, debt, or goal outcomes. The model remains an experiment and is not wired into the public-facing planner.

## Privacy and limitations

Do not commit account databases, passwords, session data, personal finance records, API keys, or raw data that you are not licensed to redistribute. The app has no bank connection or live local-price feed. Loan estimates use a user-supplied lender quote and a fixed-rate reducing-balance formula; fees, insurance, taxes, lender eligibility, and future rate changes are outside the estimate.
