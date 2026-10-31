# Finance AI data sources and training decision

**Reviewed 31 October 2026.** No external dataset is currently used to train or personalize the live app. User-entered budget records stay associated with that user's account and power their own category helper and spending forecast.

## Why no public dataset was added

The app needs real cash transactions by household and, for savings recommendations, evidence of what happened after a person tried a suggested change. The sources reviewed do not provide both with appropriate Indian coverage and verified outcomes. Making rows up or relabeling a different measure as cash spending would create misleading predictions.

| Source | What it contains | Why it is not the savings-training dataset |
|---|---|---|
| [MoSPI HCES 2023–24](https://microdata.gov.in/NADA/index.php/catalog/237) | Household consumption survey data, with consumption valued across purchases, home production, gifts and other sources. | Consumption is useful for studying consumption patterns, but it is not necessarily cash outflow. It does not label income, savings, loans or whether a savings action worked. The user-provided derived CSV's original derivation notes were not supplied. The app does not use it. |
| [FinMark Trust India Financial Diaries](https://finmark.org.za/data-portal/IND/financial-diaries) | Income, expense, credit and savings categories for 86 households in Varanasi and nearby areas, February–June 2013. | The source explicitly says it is not nationally representative. It is small, old and geographically narrow for a current public India app. It is not used in the app. |
| [RBI payment-system releases](https://www.rbi.org.in/Scripts/Statistics.aspx) | Aggregate payment-system statistics, such as counts and values by payment rail and reporting period. | These are payment-network totals, not individual households' grocery, rent or transport spending, and they do not record savings actions or outcomes. |
| [CMIE Consumer Pyramids](https://www.dprc.duke.edu/node/4139) | A large longitudinal Indian household survey with income and expense-related modules. | Access is licensed or subscription-based; no authorized project copy is present. Household spending records also do not by themselves show which suggested cuts were adopted and achieved. |
| [MoneyData UK transaction workbook](https://data.mendeley.com/datasets/dnxtg6n4rv/1) | An anonymized UK retail-bank account sample with manually assigned categories. | It is one foreign account, and its descriptive categories are not representative Indian household labels. A local grouped-description test achieved 39.5% category accuracy versus a 28.1% majority baseline; at the tested confidence cutoff it covered 56.3% of cases with 58.0% precision. This exploratory performance was too weak and too poorly matched to deploy, so the workbook was removed. |

The [Zenodo digital-payment transaction sample](https://zenodo.org/records/17092322) reviewed for comparison describes customer IDs and phone numbers and is in Indonesian; it is not suitable for an Indian public app and was not downloaded or used.

## What the app learns now

- **Category helper:** compares a user's new transaction note with that same user's saved, manually categorized notes. The user confirms any suggestion.
- **Spending forecast:** after three consecutive complete months, estimates next month's category totals from up to six recent months in the same account. Missing months are not treated as zero.
- **Savings ideas:** available from the current month's entries right away. The suggested reductions use visible, fixed caps. There are no real outcome labels to train a model to claim that a particular cut will work for a household.

The app never pools user records into a cross-account model. The separate HCES food-consumption experiment was removed because it was not used by the app and could be mistaken for a cash-spending model. The original user-provided HCES CSV, if present in the project folder, is preserved and ignored by Git; it is not loaded by the website.

## What a credible future training dataset needs

For cash-spending forecasts, collect consented, anonymized monthly transactions with consistent categories and verified month completeness. Evaluate on later months and households not used to fit the model. For savings-action recommendations, also record what the user chose to change and the measured outcome over time, including cases where they could not or did not make the change. Report errors and coverage only after a suitable evaluation. Never fabricate rows, outcomes, or performance numbers.
