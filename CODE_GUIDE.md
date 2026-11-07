# Understanding the Finance AI code

This guide is a reading map for someone opening the project for the first time.
The app uses HTML, CSS and JavaScript in the browser, with a Python server.
Node.js runs development tests; it is not the application backend.

## Start with these files

1. Read [README.md](README.md) for features and the run commands.
2. Open [app/server.py](app/server.py). `main()` starts the server;
   `APP_PAGES` lists the pages and the JavaScript controller for each page.
3. Open [app/layout.html](app/layout.html), then one page such as
   [app/budget.html](app/budget.html). Python places that page inside the shared layout.
4. Follow the page's controller, such as [budget_ui.mjs](app/js/budget_ui.mjs).
   It connects buttons and fields to smaller calculation, storage and document modules.
5. Read the matching tests in [app/tests](app/tests) for examples and edge cases.

## Where to make a change

| Task | Main files | Responsibility |
| --- | --- | --- |
| Page content | `app/*.html` | Fields, headings and accessible labels. `layout.html` and `auth.html` are shared templates. |
| Appearance | `app/styles.css`, `themes.css`, `workspace-tools.css` | Base components, theme colours/layouts, then goal/import/popover components. |
| Login and recovery | `app/js/account_ui.mjs`, `app/server.py` | Browser forms, server sessions, password hashing and one-time email links. |
| Navigation | `app/js/navigation.mjs`, `page_scope.mjs`, `pending_saves.mjs` | Change pages, clean up listeners, and finish queued saves. |
| Account data | `app/js/finance_data.mjs`, `app/server.py` | Load and save only the authenticated account's data. |
| Planner | `app/js/app.mjs`, `finance_calculations.mjs` | Read inputs, validate, calculate cash flow/EMIs/goals, then display results. |
| Saved goals | `app/js/planner_tools.mjs`, `planning_helpers.mjs` | Goal selection, independent saved snapshots and grouped cards. |
| Expense breakdown | `app/js/expense_editor.mjs` | Named expense rows, validation and their summed total. |
| Suggested amount | `app/js/amount_hints.mjs`, `planning_helpers.mjs` | One optional recorded amount for each planner field. |
| Budget entries | `app/js/budget_ui.mjs`, `budget_tracker.mjs` | Add/remove transactions and calculate monthly totals. |
| Import and Excel export | `app/js/budget_documents.mjs`, `app/finance_documents.py` | Read tables, review/edit rows, and export dated transaction details. |
| Savings and forecasts | `app/js/budget_savings_ui.mjs`, `budget_recommendations.mjs`, `budget_forecast.mjs` | Show provisional forecasts and optional spending changes. |
| Note categories | `app/js/category_starter.mjs`, `transaction_classifier.mjs` | Prefer the user's own labelled notes, then a synthetic-trained starter. |
| Language | `app/js/i18n.mjs`, `workspace_copy.mjs` | English/Hindi text and reversible language switching. |
| Profile and settings | `app/js/profile_page.mjs`, `settings.mjs` | Profile editing, export/deletion and appearance preferences. |
| Model training | `ml/train_starter_models.py`, `data/synthetic/` | Reproducible fictional examples, training and synthetic-only evaluation. |

## How a budget entry moves through the app

1. `budget_ui.mjs` reads the form. `budget_tracker.mjs` checks its date, amount,
   type and category before it becomes a transaction.
2. The UI refreshes its totals. `finance_data.mjs` queues a snapshot for saving.
3. `server.py` checks the session, owner guard and allowed data fields.
4. The server writes to the configured store. MongoDB is required in production;
   SQLite is used only when explicitly running the local development/test path.
5. A refresh loads the saved account data. A new login starts with a fresh account
   context, so an old page response cannot populate a different user's workspace.

A document follows a similar route, with an extra review step. Python extracts
rows into an in-memory preview. The browser may suggest missing categories, but
nothing is added until the user reviews and saves the selected rows. Original
uploads are not retained. Images and scanned documents are not supported by OCR.

## How the planner stays understandable

`finance_calculations.mjs` contains formulas, not UI or database calls. `app.mjs`
passes a validated profile to those formulas and displays the returned values.
`planner_tools.mjs` saves a copy of that profile for each goal. Editing one saved
plan must not mutate another, and separate plans do not automatically reserve
shared savings against each other.

Amount hints use observed totals. They prefer the most recent past month with
relevant entries, falling back to the current month when necessary. They do not
invent a zero for an unknown category or treat a past month as proof of complete
reporting. See [the planner guide](app/README.md#budget-documents-and-saved-goals)
for the surrounding import and goal workflow.

## Calculations and ML are different parts

- Cash flow, emergency funds, savings targets and EMIs are deterministic formulas.
- Note categories use personal note matching and a synthetic-trained Naive Bayes
  starter. A weak match can return no suggestion.
- Repeated-purchase forecasts can use a synthetic-trained regression blended with
  a daily-rate estimate and personal history. Sparse inputs use simpler observed
  amounts or explicit planner totals.
- Proposed savings cuts use visible rules. They are not learned savings outcomes.

`app/js/starter_models.mjs` is generated model data. Do not hand-edit or reformat
its weights. Change the trainer and run its documented workflow when training is
actually needed. Its reported scores measure fictional examples, not real-world
accuracy. See [ml/README.md](ml/README.md) for evidence and limitations.

## Read the Python server in sections

The server remains one entry point so startup, migration and tests share the same
helpers. Section comments mark storage adapters, account/token handling, email,
finance-data validation, HTTP routes and startup. To trace a request, start at
`FinanceRequestHandler.do_GET`, `do_POST`, `do_PUT` or `do_PATCH`, then follow the
helper it calls. `MongoStore` holds MongoDB operations; SQLite helpers use the
same account-owned data contract.

Never log or commit `.env`, credentials, password hashes, session tokens or real
financial records. The browser's owner header is an extra guard, not a substitute
for the server's session checks. Do not remove page disposal, account-epoch or
queued-save checks when simplifying UI code.

## Tests and safe example data

From `app/`, run:

```powershell
node --test tests/*.test.mjs
python -B -m unittest discover -s tests -p "test_*.py"
```

JavaScript tests cover calculations, models, lifecycle and UI contracts. Python
tests cover API validation, storage, account flows and document handling.
`tests/workspace_server.py` starts a disposable local test server for
`tests/workspace.browser.mjs`; it does not load `.env` or contact real email or
MongoDB services. See [the browser test instructions](app/README.md) for setup.
These tests do not prove live Atlas or email-provider availability.

[Small upload samples](sample_uploads/START_HERE.txt) and
[larger samples without categories](sample_uploads_no_category/START_HERE.txt)
contain invented records and expected totals. Use a demo account. The included
passbook picture illustrates the unsupported photo case; upload its readable
PDF alternative to test table import. Zip downloads stay local because they
duplicate the individual sample files in this repository.

## Keep future changes readable

- Keep financial formulas separate from DOM events and database access.
- Use clear names and small helpers. Comments should explain a decision or limit,
  rather than repeat an obvious assignment.
- Add English/Hindi wording together; preserve labels, keyboard use and error messages.
- Test changed behaviour with meaningful examples before publishing.
- Keep secrets and generated test output outside version control. GitHub updates
  do not require a deployment; the Render configuration uses manual deployment.
