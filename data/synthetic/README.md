# Explicitly synthetic starter datasets

Created for this project on **4 November 2026**. Every row is fictional and labelled **source=synthetic**. These are reusable training/development examples, not real household records, local Indian prices, or HCES data. No private user data or credentials were used.

| File | Contents | Label / target |
|---|---|---|
| transaction_notes.csv | English, Hindi and Hinglish notes covering 10 expense and 3 income categories | Manually specified example category |
| spending_scenarios.csv | Simulated repeated purchases at several points in a 30-day month | Simulated next-month category total in rupees |
| evaluation.json | Measured split counts, errors, baseline comparisons, configuration and file hashes | Synthetic development evaluation only |

The group column keeps variants of a base phrase, or snapshots of one simulated household, in the same split. The split column is train, validation or test.

For spending rows:

- progress: observed fraction of a simulated 30-day month;
- count: observed purchase count;
- observed: total recorded so far;
- next_month: simulator target, not an outcome from a person.

The simulator samples arbitrary amount scales between ₹500 and ₹50,000. This is an engineering test range, **not a statement about typical household spending**. It assumes purchases are recorded, uses a fixed 30-day month and omits real seasonality, irregular shocks, changing income, family circumstances, prices and reporting errors. Calendar month lengths and partial entry coverage can differ in the app.

Single bills and one-off purchases use transparent application rules outside this repeated-purchase model. End-to-end safeguards are tested separately from numerical model evaluation.

Regenerate with:

~~~powershell
python ml/train_starter_models.py
~~~

Run from the project root. Only Python's standard library is needed. No account database or environment file is read. The seed and file hashes make results reproducible. The app downloads only the JavaScript weights; it never adds synthetic transactions to a person's budget.

Do not present these files as real-life data or their metrics as real-user performance.
