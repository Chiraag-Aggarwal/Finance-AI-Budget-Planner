# Finance AI planner

A beginner-friendly Indian household budgeting and goal-planning app. The browser interface uses HTML, CSS, and JavaScript modules. Its Python API stores accounts, sessions, planner inputs, and budget entries in MongoDB when `MONGODB_URI` is configured. SQLite remains available for local development without a database connection.

## Main features

- Create an account with name, email, password, and a required city, district, or region.
- Sign in and out using a server-side session. Passwords are stored as salted PBKDF2 hashes, never as plain text; only a hash of each session token is saved.
- Edit the account name and region in the profile section. The profile region is prefilled in the goal planner and shown with savings guidance.
- Switch between English and Hindi. The selected language is remembered in this browser.
- Plan monthly cash flow and an emergency fund with or without a specific purchase goal. In no-goal mode, see a flexible monthly savings amount and simple 6, 12, 24, and 36-month contribution examples.
- Plan goals such as a car, bike or scooter, laptop, house or flat, plot, farm land, renovation, business equipment, education, medical costs, wedding, travel, phone, appliances, or another purchase.
- Compare several example EMI periods using the rate from the user’s lender quote. A preferred period is checked against monthly surplus after existing costs and EMIs; if it is not affordable, the planner shows the shortest example period that fits, when one does. The app does not infer a lender rate from income or savings; enter the rate quoted by the lender.
- Track income and expenses manually. Budget entries, planner drafts, and profile changes save automatically to the signed-in account. With MongoDB configured, they are available across devices. Earlier browser-only plan and transaction saves are imported the first time that account is opened.
- Get draft monthly savings suggestions as soon as income and expense entries are added; marking the month complete refines the estimate. Missing income and expenses are not assumed to be zero. Existing EMI and sensitive expense categories are protected by default.

## Project files

- `server.py` serves the app, validates account requests, hashes passwords, creates server-side sessions, and saves account and finance data in MongoDB or local SQLite.
- `migrate_sqlite_to_mongodb.py` safely copies existing SQLite account records and saved server data. It does not copy active login sessions; users sign in again afterward.
- `index.html` contains the sign-in, sign-up, profile, planner, and savings coach screens.
- `styles.css` contains the responsive layout and styles.
- `js/i18n.mjs` switches the interface between English and Hindi using a local translation dictionary.
- `js/account_ui.mjs` connects sign-in, sign-up, profile edits, and sign-out to the Python API.
- `js/finance_data.mjs` sends signed-in users' saved plan and budget entries to the account-scoped API.
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

Install Python 3.10 or newer. For local-only use, open PowerShell in the `app` folder and run:

```powershell
python server.py
```

Open `http://localhost:8000`. Keep the PowerShell window open while using the app; press `Ctrl+C` to stop it. If port 8000 is already in use, stop the old server or set another port before starting:

```powershell
$env:FINANCE_AI_PORT = "8001"
python server.py
```

The server listens on `127.0.0.1` by default. If `MONGODB_URI` is not set in development, account records and sessions are saved to `app/data/finance_ai_accounts.sqlite3`; saved plan and budget data use the same local SQLite database. The server does not expose the database or Python source as static files.

## Use MongoDB

Create a MongoDB deployment and database user, then copy its connection URI from MongoDB Atlas. Install the MongoDB Python driver:

```powershell
cd app
python -m pip install -r requirements.txt
```

For local use, copy `app/.env.example` to `app/.env`, replace the URI placeholders with your Atlas values, and run `python server.py`. The local server reads `app/.env` automatically. The root `.gitignore` excludes `.env`, so never commit or share the filled-in file. You can also set `MONGODB_URI` and `MONGODB_DATABASE` as environment variables; those take precedence over `app/.env`.

For deployment, configure `MONGODB_URI`, `MONGODB_DATABASE`, `FINANCE_AI_ENV=production`, and `FINANCE_AI_COOKIE_SECURE=1` in the hosting provider's private environment settings. Do not use the local `.env` file in a public repository.

The MongoDB database has three collections:

- `users` stores a user's name, email, region, salted password hash, and account creation time. Emails have a unique index.
- `sessions` stores hashed browser session tokens and expiration times. Expired sessions are removed by MongoDB's TTL index.
- `finance_data` stores each account's planner inputs, income and expense entries, and update time. The API derives the account ID from the signed-in session, so a request cannot choose another user's account.

The MongoDB connection is checked when the server starts; MongoDB connection or configuration errors stop startup instead of silently switching to SQLite. To move a current local SQLite account database, first set `MONGODB_URI` and `MONGODB_DATABASE`, then run:

```powershell
python migrate_sqlite_to_mongodb.py
```

Run this before opening the public site. The migration keeps existing numeric account IDs and password hashes, allowing legacy browser-saved plans and transactions to be matched and imported after the user signs in again. It does not copy session tokens or plaintext passwords. The script stops if it detects conflicting account IDs or emails.

## Privacy and deployment

Account name, email, region, password hash, and session records are stored in the configured database. Planner form values, monthly budget entries, and profile changes save automatically with the signed-in account and can be loaded on another device. Appearance choices are saved separately for each account in that browser; language remains in that browser. Sign-out clears the active server session. Sign-up allows one Finance AI account per normalized email address; trying the same address with different letter casing is still treated as the same account. The app cannot tell whether one person owns multiple different email addresses.

### Forgot password

On the sign-in form, choose **Forgot password?**, enter the account email, and use the link sent to that inbox. The link expires after 30 minutes and works only once. The database stores a hash of the reset token, and a successful password change signs out existing sessions. The app returns the same response for existing and unknown email addresses to avoid revealing who has an account.

Password recovery email is disabled until the app owner configures SMTP. For Gmail, enable 2-Step Verification and create a Google App Password; use that App Password as `FINANCE_AI_SMTP_PASSWORD`, never your normal Gmail password. Add the SMTP settings shown in `.env.example` to the existing private `app/.env` file, keeping its MongoDB settings. Set `FINANCE_AI_PUBLIC_URL` to `http://127.0.0.1:8000` for local use or the full HTTPS site address in production. Never commit the real `.env` file or share its secrets in chat. If the settings are missing, the app explains that recovery email is not configured.

The app is not deployed publicly. For a hosting provider, install `app/requirements.txt` and set `MONGODB_URI`, `MONGODB_DATABASE`, `FINANCE_AI_ENV=production`, and `FINANCE_AI_COOKIE_SECURE=1` in its private environment settings. The app binds to `0.0.0.0` in production and uses the hosting provider's `PORT` when supplied. Serve it over HTTPS, allow the hosting service to reach your MongoDB cluster, and configure database backups and access rules in MongoDB Atlas. Production startup fails if the MongoDB URI is missing or secure cookies are disabled. Do not expose the local development server directly to the internet.

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

The Python API and storage tests use Python's standard library and a temporary SQLite database. MongoDB connectivity requires the `pymongo[srv]` dependency and a reachable database URI; production deployment must use MongoDB. JavaScript tests use Node's built-in test runner.
