# Finance AI — Indian household budget planner

A beginner-friendly personal finance app for Indian households. It helps users understand monthly cash flow, plan general savings or a specific purchase, and compare illustrative loan EMIs against their budget.

## What the app does

- Tracks monthly income and spending entered by the user.
- Calculates remaining monthly balance and a user-selected emergency-fund target.
- Builds a flexible savings plan even when the user has no purchase goal.
- Plans one optional goal at a time, such as a car, bike, house, plot, education, medical costs, travel, or another purchase.
- Lets users explicitly include an accessible amount from assets or family support toward a goal; it does not treat total net worth or a property's full value as cash.
- Compares example EMI periods when the user supplies an annual interest rate from a lender quote. Existing EMIs and household expenses reduce the available monthly amount.
- Provides an English/Hindi interface, a private ML category helper, and a personal spending forecast.

The budget form's optional category helper learns from that account's saved descriptions and user-selected categories. A separate next-month spending forecast fits a simple linear trend to at least three consecutive completed months from the same account. Savings examples can use the current month's entries immediately; they are transparent fixed-rule examples, not learned savings outcomes. Accounts are never pooled.

The planner uses transparent arithmetic for budget and goal guidance. It does not predict goal success, approve loans, or infer a lender's interest rate from income. HCES survey consumption is not used as cash spending, income, savings, debt, or goal labels.

## Project layout

- `app/` — HTML/CSS/JavaScript interface and Python account server, with MongoDB for deployed accounts and finance data.
- `ml/` — notes on the small personal ML helpers used in the app and their limits.
- `data/` — dataset-source reviews and finance-model data requirements.

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

There is no suitable open, representative India dataset of personal cash transactions with verified savings-action outcomes. The app starts savings examples from the user's own entries. Its personal spending forecast appears after three consecutive completed months; no external or synthetic records are mixed into a user's calculations. See [the data source review](data/README.md) and [ML notes](ml/README.md).

## Privacy and limitations

Do not commit account databases, passwords, session data, personal finance records, API keys, or raw data that you are not licensed to redistribute. The app has no bank connection or live local-price feed. Loan estimates use a user-supplied lender quote and a fixed-rate reducing-balance formula; fees, insurance, taxes, lender eligibility, and future rate changes are outside the estimate.
