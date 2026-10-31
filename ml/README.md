# ML used by Finance AI

This folder documents the small models that run in the app. They use personal finance entries entered by the signed-in user; the app does not train a shared model from everyone’s private records.

## 1. Transaction category helper

The optional helper compares a new note with the user's own saved notes and manually chosen categories. It can suggest a likely category when there is enough matching history. The user must review the suggestion. This model does not change the entry by itself.

## 2. Next-month spending forecast

The app fits a simple linear trend to each category's monthly totals after the user has marked at least three consecutive months complete. It uses up to six recent months from the same account. It does not fill missing months with zero. The forecast is an estimate, not a promise.

Users do not need to wait for this model to get savings ideas. The savings coach can use this month's recorded expenses immediately. Its proposed reductions are modest, visible rules, not machine-learned claims about which actions save money in real life.

## Training data decision

There is not a suitable public, representative Indian household transaction dataset with verified outcomes showing which saving actions worked. Do not train a general Indian savings recommender on HCES consumption amounts, payment-network aggregates, synthetic transactions, or a small foreign bank-account sample. Those sources do not measure the required target.

The model will improve when the app has enough consented, correctly labeled personal history for a user's own forecast. To evaluate a future shared model, first obtain data that may legally be used, define the outcome, remove direct identifiers, split evaluation by household and time, and publish measured errors and limitations. Until then, use the per-user forecast and transparent calculations only.

See [the dataset review](../data/README.md) for sources and limitations.
