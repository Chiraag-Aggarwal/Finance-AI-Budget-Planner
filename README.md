# Finance AI — Indian household budget planner

A beginner-friendly personal finance app for Indian households. It helps users understand monthly cash flow, plan general savings or a specific purchase, and compare illustrative loan EMIs against their budget.

## What the app does

- Tracks monthly income and spending, with reviewed CSV/Excel/Word-table/PDF imports and an organised Excel download.
- Calculates remaining monthly balance and a user-selected emergency-fund target.
- Builds a flexible savings plan even when the user has no purchase goal.
- Saves multiple named goal plans, grouped by category, with goal-specific questions and editable expense breakdowns. Each plan is calculated independently.
- Lets users explicitly include an accessible amount from assets or family support toward a goal; it does not treat total net worth or a property's full value as cash.
- Compares example EMI periods when the user supplies an annual interest rate from a lender quote. Existing EMIs and household expenses reduce the available monthly amount.
- Provides an English/Hindi interface, a private ML category helper, and a personal spending forecast.

The optional note helper uses a synthetic-trained Naive Bayes starter plus that account's own labelled notes. Next-month spending estimates are available immediately: simple carry-forward or Planner amounts for sparse inputs, a trained starter/daily-rate blend for repeated purchases, and personal trends when history exists. Synthetic examples are never copied into a user's transactions. Savings reductions remain transparent rules; accounts are never pooled.

The planner uses transparent arithmetic for budget and goal guidance. It does not predict goal success, approve loans, or infer a lender's interest rate from income. HCES survey consumption is not used as cash spending, income, savings, debt, or goal labels.

## Interface and themes

The app has separate Dashboard, Monthly budget, Planner, Savings & insights, Profile, and Settings pages. The three-line menu links to all pages. Bloom is the default design; Settings also offers Sunrise and Ocean, with light/dark mode, accent color, text size, and reduced motion. All three designs use the same piggy-bank illustration.

The interface uses plain HTML, CSS, and JavaScript. Python assembles shared page templates and serves the authenticated APIs; run `app/server.py` rather than opening an HTML fragment directly. See [the app guide](app/README.md) for the page/module map.

## Project layout

Start with [the code guide](CODE_GUIDE.md) for a beginner-friendly file map, request flow, model boundaries and testing workflow.

- `app/` — HTML/CSS/JavaScript interface and Python account server, with MongoDB for deployed accounts and finance data.
- `ml/` — notes on the small personal ML helpers used in the app and their limits.
- `data/` — dataset-source reviews and finance-model data requirements.

## Run the app

Install Python 3.10 or newer. In PowerShell, run:

```powershell
cd app
python -m pip install -r requirements.txt
python server.py
```

Open `http://localhost:8000` and keep the terminal open while using the app. If port 8000 is occupied, use another port:

```powershell
$env:FINANCE_AI_PORT = "8001"
python server.py
```

For local development, accounts are stored in a private SQLite file. Set `MONGODB_URI` to use MongoDB for accounts, saved plans, and income and expense entries. Signed-in users' planner drafts, budget entries, and profile changes save automatically. Deployment must set `FINANCE_AI_ENV=production` and `FINANCE_AI_COOKIE_SECURE=1`; the server refuses to start in production without MongoDB. See [the app setup and deployment guide](app/README.md). The database credentials and local user data are excluded from this repository.

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

## Data and ML limits

The source review did not establish a suitable open Indian dataset with verified savings-action outcomes. This version includes [explicitly synthetic starter datasets](data/synthetic/README.md), a [reproducible Python trainer](ml/train_starter_models.py), and [measured synthetic evaluation](data/synthetic/evaluation.json). These support initial suggestions, not claims of real-world accuracy. No three-month wait is imposed. See [the source review](data/README.md) and [model limitations](ml/README.md).

## Privacy and limitations

Do not commit account databases, passwords, session data, personal finance records, API keys, or raw data that you are not licensed to redistribute. The app has no bank connection or live local-price feed. Loan estimates use a user-supplied lender quote and a fixed-rate reducing-balance formula; fees, insurance, taxes, lender eligibility, and future rate changes are outside the estimate.

## Latest behavior

- New logins always open Dashboard; older login routes, page state and private note helpers are invalidated.
- Emergency targets offer 0–12 months and a custom 0–120 value; zero skips the target.
- Calendar months close automatically. Ending a month does not prove that every expense was entered.
- Note categories and provisional spending estimates work from initial inputs, with source labels and uncertainty.
- Training datasets are fictional, reproducible and included in data/synthetic. No credentials or real account records are included.

See [the app guide](app/README.md) for document formats, limits, privacy and end-to-end tests. Fictional upload examples are in [sample_uploads](sample_uploads/START_HERE.txt) and [sample_uploads_no_category](sample_uploads_no_category/START_HERE.txt).
