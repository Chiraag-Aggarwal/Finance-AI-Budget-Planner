# Finance AI planner

A beginner-friendly Indian household budgeting and goal-planning app. The browser interface uses HTML, CSS, and JavaScript modules. The account API and SQLite storage use Python's standard library; no Node backend or third-party Python packages are required. The browser still uses JavaScript for the existing interface.

## Main features

- Create an account with name, email, password, and a required city, district, or region.
- Sign in and out using a server-side session. Passwords are stored as salted PBKDF2 hashes, never as plain text.
- Edit the account name and region in the profile section. The profile region is prefilled in the goal planner and shown with savings guidance.
- Switch between English and Hindi. The selected language is remembered in this browser.
- Plan monthly cash flow and an emergency fund with or without a specific purchase goal. In no-goal mode, see a flexible monthly savings amount and simple 6, 12, 24, and 36-month contribution examples.
- Plan goals such as a car, bike or scooter, laptop, house or flat, plot, farm land, renovation, business equipment, education, medical costs, wedding, travel, phone, appliances, or another purchase.
- Compare several example EMI periods using the rate from the user’s lender quote. A preferred period is checked against monthly surplus after existing costs and EMIs; if it is not affordable, the planner shows the shortest example period that fits, when one does. The app does not infer a lender rate from income or savings; enter the rate quoted by the lender.
- Track monthly income and expenses manually. Users can choose to save them in this browser; records are kept separately by account on the same device.
- Get draft monthly savings suggestions as soon as income and expense entries are added; marking the month complete refines the estimate. Missing income and expenses are not assumed to be zero. Existing EMI and sensitive expense categories are protected by default.

## Project files

- `server.py` serves the app, validates account requests, hashes passwords, creates server-side sessions, and saves account profiles in SQLite.
- `index.html` contains the sign-in, sign-up, profile, planner, and savings coach screens.
- `styles.css` contains the responsive layout and styles.
- `js/i18n.mjs` switches the interface between English and Hindi using a local translation dictionary.
- `js/account_ui.mjs` connects sign-in, sign-up, profile edits, and sign-out to the Python API.
- `js/app.mjs` validates finance inputs and shows cash-flow, emergency-fund, and goal calculations.
- `js/finance_calculations.mjs` contains the transparent cash-flow, emergency-fund, optional goal, flexible savings, and reducing-balance EMI formulas.
- `js/budget_ui.mjs` manages the manual monthly tracker.
- `js/budget_savings_ui.mjs` presents goal-independent draft savings suggestions and passes the profile region into the output context.
- `js/budget_recommendations.mjs` calculates possible category changes and interprets short English or Hindi chat instructions.
- `ml/` and `data/` are outside this `app` folder. They contain the separate experimental HCES food-consumption model and its data.

## Region and model limits

The account asks for a city, district, or region and saves it in the profile. The goal planner and savings output show that location as context. The current budget calculations still use the user's actual entered amounts; they do not change costs based on local prices.

The experimental HCES model has a `state_code` input and predicts recorded survey food consumption. That survey value is not necessarily cash spent on food and is not a savings or affordability label. The free-text profile location is not yet mapped to the model's state codes, and the model is not used to make budget recommendations. A validated state-code mapping and appropriate regional price data are needed before location can safely change numerical advice.

## Start the app

Install Python 3.10 or newer. Open PowerShell in the `app` folder and run:

```powershell
python server.py
```

Open `http://localhost:8000`. Keep the PowerShell window open while using the app; press `Ctrl+C` to stop it. If port 8000 is already in use, stop the old server or set another port before starting:

```powershell
$env:FINANCE_AI_PORT = "8001"
python server.py
```

The server listens on `127.0.0.1` by default. Account rows and session hashes are saved to `app/data/finance_ai_accounts.sqlite3`. The server only serves the app's HTML, CSS, and browser modules; it does not expose the database or Python source as static files.

## Privacy and deployment

Account name, email, region, password hash, and active session hashes are stored in the local SQLite database. Finance form values and optional transaction history remain in browser storage and are separated by account on that device; they do not sync between devices. Sign-out clears the server session. There is no email verification or password-reset flow yet.

The app is not deployed publicly. The local server binds to this computer only. A public deployment needs HTTPS, a protected database backup, a production server setup, and secure cookies. Set `FINANCE_AI_COOKIE_SECURE=1` behind HTTPS; do not expose the local development server directly to the internet.

The savings coach uses deterministic calculations and a small keyword-based helper, not a generative AI service. It does not connect to banks or live local price listings. Suggestions use recorded entries only; incomplete months are labeled as drafts. Automatic reductions are limited to modest examples for Personal, Other, Transport, Utilities, and Food and groceries. Rent, Health, Education, Family support, and Loan EMI are left unchanged unless the user asks to explore them.

The loan comparison uses the annual rate entered from a lender quote and a standard fixed-rate reducing-balance EMI formula. Example periods vary by purchase type (for example, a bike uses 1/2/3/4/5 years, a car 3/5/7 years, and a house or flat 10/15/20/25/30 years). These are calculator examples, not lender offers or claims about eligibility. The user can select a preferred period or compare all examples. A selected period is checked against the user’s monthly comfort cap, calculated from positive surplus after current costs and EMIs; if the chosen period does not fit, the app shows an affordable alternative when one exists. Savings assigned to the goal and any asset or family amount the user explicitly opts to use reduce the remaining down payment and estimated loan principal. For property, the user enters only the amount they can actually access, not its full estimated value; the app does not verify ownership or access. The app does not infer or promise a lender rate from income or savings; use the lender’s quote. Income, savings, and existing EMIs inform the affordability calculation, not the quoted rate. Estimates exclude fees, insurance, taxes, floating-rate changes, and lender eligibility checks. Before deciding, compare the lender’s Annual Percentage Rate (APR) and Key Facts Statement (KFS), which disclose the cost of credit and loan facts: [RBI Key Facts Statement guidance](https://systemhealth.rbi.org.in/Scripts/BS_ViewMasDirections.aspx_id=12256%282%29.html).

## Checks

From the `app` folder, run the Python account tests and the JavaScript calculation tests:

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
node --test tests/finance_calculations.test.mjs
node --test tests/budget_tracker.test.mjs
node --test tests/budget_recommendations.test.mjs
```

The account backend uses Python's standard library. JavaScript tests use Node's built-in test runner and no third-party packages.
