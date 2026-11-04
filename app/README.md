# Finance AI planner

A beginner-friendly Indian household budgeting and goal-planning app. The browser interface uses HTML, CSS, and JavaScript modules. Its Python API stores accounts, sessions, planner inputs, and budget entries in MongoDB when `MONGODB_URI` is configured. SQLite remains available for local development without a database connection.

## Main features

- Create an account with name, email, password, and a required city, district, or region. New accounts must verify their email with a one-time link that expires after 24 hours.
- Sign in and out using a server-side session. Passwords are stored as salted PBKDF2 hashes, never as plain text; only a hash of each session token is saved.
- Edit the account name and region in the profile section. The profile region is prefilled in the goal planner and shown with savings guidance.
- Switch between English and Hindi. The selected language is remembered in this browser.
- Plan monthly cash flow and an emergency fund with or without a specific purchase goal. In no-goal mode, see a flexible monthly savings amount and simple 6, 12, 24, and 36-month contribution examples.
- Plan goals such as a car, bike or scooter, laptop, house or flat, plot, farm land, renovation, business equipment, education, medical costs, wedding, travel, phone, appliances, or another purchase.
- Compare several example EMI periods using the rate from the user’s lender quote. A preferred period is checked against monthly surplus after existing costs and EMIs; if it is not affordable, the planner shows the shortest example period that fits, when one does. The app does not infer a lender rate from income or savings; enter the rate quoted by the lender.
- Track income and expenses manually. Entries, planner drafts and profile changes save to the signed-in account. Old browser-only financial copies are no longer silently imported; server data is authoritative.
- See provisional next-month spending estimates immediately from recent expenses or explicit Planner totals. Repeated purchases can use a synthetic-trained starter blended with a daily-rate baseline; available account history refines it. No three-month wait or manual completion checkbox is required.
- Get draft savings suggestions from entered income and expenses. Missing categories remain unknown. Months close automatically by calendar date; this does not verify that every expense was recorded. Current EMI and protected categories remain unchanged.

## Project files

- `server.py` serves the app, validates account requests, hashes passwords, creates server-side sessions, and saves account and finance data in MongoDB or local SQLite.
- `migrate_sqlite_to_mongodb.py` safely copies existing SQLite account records and saved server data. It does not copy active login sessions; users sign in again afterward.
- `layout.html` is the shared header, navigation, footer, and document shell. `auth.html` holds the existing sign-in, sign-up, verification, and password-recovery forms. Python combines these trusted templates with each page; neither template is a public URL.
- `index.html` is the dashboard: the saved planner overview, this month's recorded totals, and useful shortcuts. It displays the signed-in user's actual saved figures, not demonstration numbers.
- `budget.html` contains the monthly tracker and entries; `planner.html` contains all household, goal, asset, and loan inputs and their results.
- `insights.html` contains the savings coach, adjustment chat, and next-month forecast. It reads the same account data as the tracker.
- `profile.html` contains profile editing, data export, and account deletion. `settings.html` contains appearance preferences.
- `styles.css` retains the existing component styles. `themes.css` adds Bloom, Sunrise, Ocean, light/dark variants, and responsive page layouts.
- `js/dashboard.mjs` builds the overview with the same financial calculation module as the planner.
- `js/navigation.mjs` handles the three-line menu, active links, and old section bookmarks. `js/pending_saves.mjs` finishes queued edits before internal page navigation or sign-out, preventing page changes from dropping pending edits.
- `js/settings.mjs` stores each account's appearance preferences in this browser. Bloom with light mode is the default; existing light/dark preferences are preserved.
- `js/i18n.mjs` switches the interface between English and Hindi using a local translation dictionary.
- `js/account_ui.mjs` connects sign-in, sign-up, profile edits, and sign-out to the Python API.
- `js/finance_data.mjs` sends signed-in users' saved plan and budget entries to the account-scoped API.
- `js/app.mjs` validates finance inputs and shows cash-flow, emergency-fund, and goal calculations.
- `js/finance_calculations.mjs` contains the transparent cash-flow, emergency-fund, optional goal, flexible savings, and reducing-balance EMI formulas.
- `js/budget_ui.mjs` manages the manual monthly tracker.
- `js/budget_savings_ui.mjs` presents goal-independent draft savings suggestions and passes the profile region into the output context.
- `js/budget_recommendations.mjs` calculates possible category changes and interprets short English or Hindi chat instructions.
- `ml/` and `data/` are outside this `app` folder. Their README files explain the per-user models and why survey or aggregate datasets are not used as personal cash-spending labels.

## Region and regional cost data review

**Reviewed 31 October 2026.** The profile's city, district, or region is saved and displayed as location context only. The app does not turn it into a cost adjustment. Budget, savings, and loan calculations use the amounts the user enters; a goal price must come from the user's own current quote.

I reviewed these official Indian sources for reusable regional price data:

- **Department of Consumer Affairs (DoCA), Price Monitoring System (PMS):** the Department's [Price Monitoring Division page](https://consumeraffairs.gov.in/pages/price-monitoring-division), last updated 15 October 2026, reports daily retail and wholesale prices for 41 essential food commodities from 579 reporting centres. Its [commodity list](https://fcainfoweb.nic.in/ListofCommodity.aspx) and [centre list](https://fcainfoweb.nic.in/ListofCentersRevamp.aspx) show the item and location coverage. The Department says prices are reported by State/UT Civil Supplies Departments and collected through a mobile app, including averages from three markets. This is useful for checking individual food-item prices, but it is not a household budget: it does not provide the quantities a household buys or cover broad costs such as rent, healthcare, education, transport, and services. Centre observations may not represent every nearby market; reported quality and variety can differ. The [public price-report interface](https://fcainfoweb.nic.in/reports/report_menu_web.aspx) also uses a CAPTCHA, and I found no documented stable public API for automated regional price retrieval during this review. Therefore, the app does not convert this source into a monthly grocery or household-cost estimate.
- **MoSPI Consumer Price Index (CPI):** the [official CPI catalogue](https://esankhyiki.mospi.gov.in/catalogue-main/catalogue?product=CPI) provides monthly State/UT and Rural/Urban/Combined index series. At the review date, the catalogue listed August 2026 as provisional, released 14 September 2026, under the new 2024=100 base. MoSPI describes CPI as measuring price changes over time for a selected basket. It is an inflation index, not an absolute rupee cost-of-living comparison between cities or States, so the app does not use State index values to multiply or alter a user's expenses.
- **HCES 2023-24:** the [official HCES report](https://mospi.gov.in/sites/default/files/publication_reports/Final_Report_HCES_2023-24L.pdf) gives household consumption statistics, including regional estimates. Its method values purchases at purchase price, home-produced food at ex-farm prices, and gifts/free collections at imputed local retail prices; the survey also includes some goods received free through programmes. These are consumption valuations and are not necessarily cash outflows. HCES is not used to adjust budget or goal calculations.

No reviewed source is a suitable, complete regional household-cost estimate for this app's current inputs. Region remains context only; users should enter their own expenses and a current local goal quote. HCES is not used for local-price or cash-spending advice. See [the project data-source review](../data/README.md).

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

Use the Python server to preview the redesigned app. Do not open the HTML fragments directly or use a static-only preview server: Python supplies the shared layout and authenticated APIs. Routes are `/`, `/budget.html`, `/planner.html`, `/insights.html`, `/profile.html`, and `/settings.html`. Restart the local Python process after changing server routes. This local redesign does not publish or update a deployed service.

### Themes and page checks

Settings offers **Bloom** (violet/lavender/yellow), **Sunrise** (coral/apricot/teal), and **Ocean** (cobalt/lime/peach). Color mode, accent, text size, and reduced motion remain available. These settings do not change financial inputs, formulas, or models. The same decorative piggy-bank illustration appears in all three designs. It is generated artwork, not a chart or a financial prediction.

Run the automated checks from `app`:

```powershell
node --test tests/*.test.mjs
python -m unittest discover -s tests -p "test_*.py"
```

The page tests check shared authentication forms, unique IDs, preserved planner inputs, valid module links, and private template routes. JavaScript tests also check backward-compatible preferences, all three themes, and queued-save failures. The UI redesign was checked in a local browser with a disposable account: page navigation, goal-specific questions, budget/profile/planner saving, refresh and sign-in again, savings adjustments, forecasts, English/Hindi switching, and phone-width layouts. Test figures are not included in the app. Automated database/email tests use test stores and mocked mail transports; they do not establish live Atlas or Brevo availability.

The server listens on `127.0.0.1` by default. If `MONGODB_URI` is not set in development, account records and sessions are saved to `app/data/finance_ai_accounts.sqlite3`; saved plan and budget data use the same local SQLite database. The server does not expose the database or Python source as static files.

## Use MongoDB

Create a MongoDB deployment and database user, then copy its connection URI from MongoDB Atlas. Install the MongoDB Python driver:

```powershell
cd app
python -m pip install -r requirements.txt
```

For local use, copy `app/.env.example` to `app/.env`, replace the URI placeholders with your Atlas values, and run `python server.py`. The local server reads `app/.env` automatically. The root `.gitignore` excludes `.env`, so never commit or share the filled-in file. You can also set `MONGODB_URI` and `MONGODB_DATABASE` as environment variables; those take precedence over `app/.env`.

For deployment, configure `MONGODB_URI`, `MONGODB_DATABASE`, `FINANCE_AI_ENV=production`, and `FINANCE_AI_COOKIE_SECURE=1` in the hosting provider's private environment settings. Do not use the local `.env` file in a public repository.

The MongoDB database uses these collections:

- `users` stores a user's name, email, region, salted password hash, email verification status, and account creation time. Emails have a unique index.
- `sessions` stores hashed browser session tokens and expiration times. Expired sessions are removed by MongoDB's TTL index.
- `finance_data` stores each account's planner inputs, income and expense entries, and update time. The API derives the account ID from the signed-in session, so a request cannot choose another user's account.
- `password_resets` stores one-time password-reset token hashes and expiry times.
- `email_verifications` stores only a hash of each active verification token and its expiry and resend-limit timestamps. MongoDB removes expired verification records with a TTL index.

The MongoDB connection is checked when the server starts; MongoDB connection or configuration errors stop startup instead of silently switching to SQLite. To move a current local SQLite account database, first set `MONGODB_URI` and `MONGODB_DATABASE`, then run:

```powershell
python migrate_sqlite_to_mongodb.py
```

Run this before opening the public site. The migration keeps existing numeric account IDs and password hashes, allowing legacy browser-saved plans and transactions to be matched and imported after the user signs in again. It does not copy session tokens or plaintext passwords. The script stops if it detects conflicting account IDs or emails.

## Privacy and deployment

Account profile fields (name, email, and region), a salted password hash, email-verification status, and account creation time are stored in the configured database. The signed-in account’s planner inputs, budget entries, and calendar-closed month metadata (legacy field name completedMonths) are saved separately under that account ID. Appearance settings and language are stored in the browser, not in the account database. Sign-out clears the active server session. Sign-up allows one Finance AI account per normalized email address; trying the same address with different letter casing is still treated as the same account. The app cannot tell whether one person owns multiple different email addresses.

### What the database stores

MongoDB stores account profiles in `users`, hashed session tokens and expiry times in `sessions`, planner inputs, budget transactions, calendar-closed month metadata (legacy field name completedMonths), and any account settings saved through the API in `finance_data`, password-reset token hashes in `password_resets`, and verification token hashes and resend-limit data in `email_verifications`. The planner and budget records are selected by the signed-in account ID.

Local SQLite uses the matching `users`, `sessions`, and `user_finance_data` tables plus `password_reset_tokens` and `email_verification_tokens`. The `user_finance_data` payload holds planner inputs, budget transactions, calendar-closed month metadata (legacy field name completedMonths), and any submitted account settings. Foreign-key cascades connect those records to the account row. In both storage paths, raw passwords and raw one-time email links are not stored. The current appearance and language controls save preferences locally in each browser.

### Export and delete account data

From the signed-in Profile page, **Download my data** downloads a JSON file with the account profile, planner information, budget entries, and any settings saved in the account database. The export does not include password hashes, session tokens, or password-reset and email-verification tokens. The export endpoint derives the account ID from the signed-in session and does not accept a caller-selected user ID.

**Delete account and data** requires the current password and typing `DELETE`. The server uses the signed-in account ID, removes the profile and every linked database record, invalidates all sessions, and clears the current browser’s account-specific saved data. SQLite deletes related rows through foreign-key cascades. MongoDB removes the related documents in a transaction. The action cannot be undone. Browser-only preferences or unsynced drafts on another device cannot be erased remotely; they need to be cleared on that device.

**Professional review required before public release:** this app’s privacy wording is a factual product description, not a legal privacy policy or a claim of legal compliance. Have a qualified privacy professional review it and prepare any required public-facing policy before release.

### Email verification

New sign-ups are not signed in until they open the email link. Each link can be used once and expires after 24 hours. Only a SHA-256 hash of its random token is stored in the database. The resend screen always gives the same response for known and unknown email addresses. A resend is limited to one per minute and five per account per hour; requests are also rate-limited by IP. English and Hindi instructions are available in the app, and the email includes both languages.

Configure the same SMTP sender settings listed in `.env.example` before allowing sign-ups. Set `FINANCE_AI_PUBLIC_URL` to the exact address users will open (use `http://127.0.0.1:8000` locally and the full HTTPS address after deployment). Without complete SMTP and public URL settings, new sign-ups are safely refused; existing accounts can still sign in. If mail delivery fails after an account is created, the user can use **Resend verification email** after one minute.

Existing users are not locked out: older SQLite databases are migrated with `email_verified = 1` by default, while new accounts are explicitly stored as unverified. Existing MongoDB user documents without an `email_verified` field are treated as verified. The SQLite-to-MongoDB migration preserves the verification status.

### Forgot password

On the sign-in form, choose **Forgot password?**, enter the account email, and use the link sent to that inbox. The link expires after 30 minutes and works only once. The database stores a hash of the reset token, and a successful password change signs out existing sessions. The app returns the same response for existing and unknown email addresses to avoid revealing who has an account.

Password recovery and sign-up verification use the configured email provider. For local development, SMTP is supported; with Gmail, enable 2-Step Verification and create a Google App Password, then use it as `FINANCE_AI_SMTP_PASSWORD` rather than your normal Gmail password. Add local SMTP settings from `.env.example` to the private `app/.env` file while keeping its MongoDB settings. On Render Free, use Brevo over HTTPS because outbound SMTP ports are blocked; configure its API key and verified sender as private Render secrets. Set `FINANCE_AI_PUBLIC_URL` to `http://127.0.0.1:8000` locally or your full HTTPS site address in production. Never commit `.env` or share its secrets.

The repository includes a Render Blueprint at render.yaml. It sets the app root to app, installs app/requirements.txt, runs python server.py, binds through Render's PORT setting, and uses Render's HTTPS URL for account email links.

The Blueprint selects Render's Free plan to avoid surprise hosting charges. Render documents Free services as suitable for testing and hobby projects, not production: they can spin down after inactivity, and waking can take about a minute. Use this deployment only as a portfolio demo with test data until you choose a paid production plan and complete a security review. Finance data remains in MongoDB Atlas, not on Render's temporary disk.

For email, Render Free blocks outgoing SMTP ports 25, 465, and 587. The Blueprint uses the Brevo HTTPS API instead. Create a Brevo account, enable transactional email, verify a sender address, and provide its API key and verified sender when Render prompts for secrets. Brevo's Free plan currently allows up to 300 emails per day. Authenticating a domain you own improves sender verification and delivery; a free Gmail sender can be used for a small demonstration, but may be rewritten by the provider or filtered by recipient mail services.

The Blueprint also prompts for MONGODB_URI. Use the rotated database-user credential and a database user limited to the finance_ai database. After the Render service is created, open its Connect menu and copy the service's outbound IP ranges into the MongoDB Atlas IP Access List. Do not allow access from every IP. Render automatically supplies RENDER_EXTERNAL_URL for verification and password-reset links; if you later attach a custom domain, set FINANCE_AI_PUBLIC_URL to that HTTPS address.

For production secrets, Render's private Environment settings must contain MONGODB_URI, FINANCE_AI_BREVO_API_KEY, and FINANCE_AI_BREVO_SENDER. Never commit these values or put them in render.yaml. The app also requires FINANCE_AI_ENV=production, FINANCE_AI_COOKIE_SECURE=1, FINANCE_AI_EMAIL_PROVIDER=brevo, and MONGODB_DATABASE=finance_ai; the Blueprint sets these non-secret values. Production startup stops with a clear message if the required database, secure-cookie, HTTPS URL, or email configuration is missing.

The savings coach can use an immediate spending estimate for the current month, and recorded amounts for historical comparisons. Optional reductions use visible fixed caps (10% for Personal/Other and 5% for Transport, Utilities and Food/groceries). These are examples to review, not learned savings outcomes. Income stays at the user's entered amount. HCES is not used as cash spending. The app does not connect to banks or live local-price feeds. See [the model guide](../ml/README.md) for the synthetic starter, personal trends, abstention and validation limits.

The loan comparison uses the annual rate entered from a lender quote and a standard fixed-rate reducing-balance EMI formula. Example periods vary by purchase type (for example, a bike uses 1/2/3/4/5 years, a car 3/5/7 years, and a house or flat 10/15/20/25/30 years). These are calculator examples, not lender offers or claims about eligibility. The user can select a preferred period or compare all examples. A selected period is checked against the user’s monthly comfort cap, calculated from positive surplus after current costs and EMIs; if the chosen period does not fit, the app shows an affordable alternative when one exists. Savings assigned to the goal and any asset or family amount the user explicitly opts to use reduce the remaining down payment and estimated loan principal. For property, the user enters only the amount they can actually access, not its full estimated value; the app does not verify ownership or access. The app does not infer or promise a lender rate from income or savings; use the lender’s quote. Income, savings, and existing EMIs inform the affordability calculation, not the quoted rate. Estimates exclude fees, insurance, taxes, floating-rate changes, and lender eligibility checks. Before deciding, compare the lender’s Annual Percentage Rate (APR) and Key Facts Statement (KFS), which disclose the cost of credit and loan facts: [RBI Key Facts Statement guidance](https://systemhealth.rbi.org.in/Scripts/BS_ViewMasDirections.aspx_id=12256%282%29.html).

## Smooth navigation and session checks

Dashboard, Monthly budget, Planner, Insights, Profile, and Settings keep their
separate URLs. Menu clicks replace only the page content inside the signed-in
layout. The app preloads public page templates and modules after sign-in and
reuses the current account's in-memory saved-data cache. It does not repeat
the session lookup or download the same saved figures on each menu click.

The current page stays visible until the next page and queued saves are ready.
An unavailable page offers Retry without losing the current view. Back/Forward,
bookmarks, keyboard focus, English/Hindi, themes, and reduced motion are supported.
Page modules export mountPage and dispose their listeners and autosave handlers
when leaving; this prevents duplicate submissions after repeated visits.

First visits and full refreshes still verify the session with /api/me. Every
private API request still requires the server-side session. HTTP 401 returns to
sign-in and clears the active page and account data cache. Delayed responses from
an earlier account are rejected. Templates contain no user data; only these public
templates, not personal page snapshots, are prefetched. Network failures never
bypass authentication.

A first uncached page, pending save, or Render cold start can still take time.
No hosting setting can guarantee zero network latency. This change removes
unnecessary full-document reloads and repeated session checks during menu use.
No Render, MongoDB, email, or environment changes are required.

## Browser navigation checks

The optional browser suite uses Playwright and synthetic responses for all account
and finance API calls. It must run against the isolated preview below, never the
live app. Neither the preview nor the suite reads .env or uses MongoDB/email.

From the app directory, install the test-only browser dependency if needed:

    npm install --no-save --package-lock=false playwright
    npx playwright install chromium

Start the isolated preview in one terminal:

    python -B tests/browser_server.py

It prints a localhost URL with an available port. In a second terminal, run
node tests/navigation.browser.mjs followed by that printed URL. The suite covers
desktop/mobile page changes, repeated visits, pending and failed saves,
Back/Forward, keyboard focus, language/theme controls, refresh, expired sessions
and switching accounts. Close the preview with Ctrl+C after the checks.

## Checks

From the `app` folder, run the Python account, email, and storage tests plus all JavaScript tests:

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
node --test tests/*.test.mjs
```

The Python API tests use temporary SQLite data and mocked email delivery; MongoDB ownership tests use isolated fake collections. They do not require the private `.env` file and do not verify a live Atlas connection or deliver real email. JavaScript tests use Node's built-in test runner. Region regression tests verify that changing the saved location changes only its displayed context, not budget, savings, or goal calculations.

## Login isolation and simple emergency targets

A successful new login always replaces the current route with Dashboard.
Logout removes the active route generation and clears rendered private content,
account caches and page helpers. Back/Forward entries from older logins are ignored.
Browsers do not allow an app to erase the entire browser history; route-generation
checks prevent that history from restoring a previous login's page state.

Tabs notify each other of account changes using a non-secret browser event. Private
finance, profile, export and deletion requests include the expected owner ID.
The server uses the session cookie as authority and rejects a mismatched expected
owner, preventing an old tab from writing its notes into a newly signed-in account.
No owner ID supplied by a browser grants access to that owner's records.

Emergency-fund months offer every whole number from 0 to 12, plus a custom input
from 0 to 120. Zero skips the target; existing emergency savings remain separate.
The 120-month maximum is a typo guard, not a financial recommendation.
The calculation remains essentials plus existing EMI, multiplied by selected months.
The helper explains that the money is for essentials/EMIs when income stops or an
unexpected expense arrives. [Emergency-fund explanation source](https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/).

## Starter training and automatic month closure

Run from the project root:

    python ml/train_starter_models.py

See [training methods](../ml/README.md), [synthetic datasets](../data/synthetic/README.md),
and [measured synthetic evaluation](../data/synthetic/evaluation.json).
Every training row is explicitly fictional. The app ships only public model weights,
never shared personal history. Synthetic examples are not added to account budgets.

Calendar closure is recomputed on loading entries, adding/removing an entry,
returning to a visible page and local midnight while the tracker is open.
If the app is closed, the next visit performs the update. A server background job
is unnecessary because closure is derived from dates. Legacy completedMonths values
are safely recomputed; transactions and account profiles are not removed.
A closed month still may contain missing expenses, so the app does not treat it as
verified complete reporting or turn missing categories into zero.

The automated suite covers zero/custom emergency targets, legacy month metadata,
owner mismatch on API requests, delayed old-account responses, two-tab sign-out,
private note isolation, immediate forecasts, unknown notes, and synthetic split
integrity. Database and email tests use disposable/mocked services; passing them
does not claim current production Atlas or email availability.
