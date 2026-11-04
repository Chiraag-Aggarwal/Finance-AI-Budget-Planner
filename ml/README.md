# Finance AI models

The browser uses small models, not a chatbot or a hosted generative-AI service.
Python builds the public starter artifacts; JavaScript runs them locally.
Private account records are never pooled into shared training.

## 1. Category suggestion from a short note

- A **multinomial Naive Bayes classifier** learns word/category associations from fictional English, Hindi and Hinglish notes.
- The current account's exact, unambiguous previously chosen label takes priority. Otherwise the existing TF-IDF/cosine-neighbour helper can use that account's history; the synthetic starter is the fallback.
- Income and expenses have separate candidate categories. Unknown, negated and low-scoring notes produce no suggestion.
- Suggestions do not change an entry until the user selects them. The UI says whether the source is their own history or the synthetic model.
- Each page creates an owner-bound helper and destroys it when leaving. No note/output is stored in a shared model cache.

## 2. Immediate spending estimates

There is no three-month eligibility rule. A single recent expense or explicit monthly Planner totals can produce a **provisional starting estimate**.

- One purchase, rent, EMI and other bills are carried forward as recorded. One bill is not multiplied by the number of days in the month.
- For repeated purchases on different dates in a variable category, a **ridge regression on the log of next-month/observed spending** learns a scaling factor from fictional spending scenarios. Features describe elapsed observation time and purchase count.
- A validation-selected blend combines that factor with a simple daily-rate estimate. The observation window begins at the first recorded purchase. This assumes entries are reasonably representative; incomplete logging or unusual purchases can invalidate it.
- Where history exists, an account-only damped linear trend contributes to the estimate. Missing months/categories are unknown, not zero. Gaps retain actual calendar spacing.
- With no recent expense records, explicit Planner totals are shown as aggregate essentials, flexible spending and EMI. They are not invented grocery/rent predictions.
- With no expense inputs, the app asks for an input. It cannot produce a useful personal prediction from nothing.
- These are spending estimates, not instructions to spend this amount. Savings reductions remain optional, visible percentage rules. There are no verified savings-action outcome labels.

Calendar months close automatically when their end date passes. The existing database field name **completedMonths** is retained for compatibility, but now holds calendar-closed recorded months. It does **not** certify that all expenses were entered. Legacy confirmations do not gate forecasts.

## Reproduce training

From the project root:

~~~powershell
python ml/train_starter_models.py
~~~

Python's standard library is sufficient. The script regenerates:

- data/synthetic/transaction_notes.csv
- data/synthetic/spending_scenarios.csv
- data/synthetic/evaluation.json
- app/js/starter_models.mjs

The public artifact contains only generated weights and a vocabulary of fictional examples. It contains no account notes, passwords or database configuration. Training is offline; Render does not train models during a request.

## What evaluation establishes

Read the generated evaluation JSON for measured counts, errors and dataset hashes. Results cover **synthetic examples only**. They do not establish accuracy for Indian households, local prices, or actual savings outcomes.

Base note phrases are split as groups; all superficial variants stay together. Simulated households are also grouped, keeping early/late-month snapshots in one split. Validation chooses classifier smoothing/abstention and the forecast blend. Test figures are reported separately. These datasets and tests have been inspected during development; they are not an independent external audit.

The forecast report compares the model with carrying forward the observed amount and with a daily-rate baseline. The blend performs better on this simulator, but that can reverse on real transactions. Test variants are correlated; do not describe the note-row count as independent people.

Before claiming real-world accuracy, obtain consented, representative, consistently recorded transaction histories; evaluate on later months and unseen households, measure category and sparse-data errors, and calibrate uncertainty. HCES consumption, synthetic scenarios and calculator outputs must not be relabelled as real outcomes.

Method reference: [AWS guidance on train/validation/test separation and leakage](https://docs.aws.amazon.com/prescriptive-guidance/latest/ml-operations-planning/splits-leakage.html). This implementation uses standard-library Python and vanilla JavaScript, not an AWS service.
