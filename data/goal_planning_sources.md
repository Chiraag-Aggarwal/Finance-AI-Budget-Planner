# Data choice for goal planning

## Decision

The goal planner does not train a model to predict whether a person will achieve a car, home, or savings goal. The Indian public datasets reviewed do not provide verified household-level goal outcomes over time. Training a goal-success model from the current HCES file would create an unsupported label and misleading predictions.

The app instead calculates cash flow and goal scenarios from the user's own income, expenses, current EMI, savings, target price, and timeline. For an optional loan comparison, the user supplies a lender-quoted annual rate; the app compares illustrative repayment periods and EMIs against the user's available monthly surplus. It does not predict loan approval or infer a lender's interest rate.

## Data reviewed

### HCES 2023-24 (user-provided derived CSV)

HCES measures household consumption. It is useful for the separate experimental food-consumption model, but it does not provide labels for income, savings, debt, or future purchase-goal success. The project's CSV is a user-provided derived file and its original derivation notes were not supplied. The browser planner does not load this CSV.

Official sources:

- MoSPI HCES report: <https://mospi.gov.in/sites/default/files/publication_reports/Final_Report_HCES_2023-24L.pdf>
- MoSPI HCES catalogue: <https://microdata.gov.in/NADA/index.php/catalog/237>

### All-India Debt and Investment Survey (AIDIS), 77th round (2019)

AIDIS is the strongest official Indian source found for household assets, indebtedness, and capital formation. Its microdata catalogue says a registered account is required to access the public-use files. It is a household-finance survey, but it does not follow each person's stated car/home goal to a later achieved/not-achieved outcome. It therefore cannot train that prediction.

Official catalogue: <https://microdata.gov.in/NADA/index.php/catalog/156>

### Consumer Pyramids Household Survey (CMIE-CPHS)

CMIE-CPHS is more promising for longitudinal household income, consumption, savings, and borrowing analysis. Access is licensed rather than an openly available project file, and the sources reviewed do not establish a verified goal-success label. It is not included in this project.

Background: <https://dvararesearch.com/resources/household-finance-data-sets/> and <https://dvararesearch.com/wp-content/uploads/2024/02/Household-Savings-The-Macroeconomy.pdf>

## What would be needed for future ML goal forecasts

A future goal model would need consented, longitudinal examples containing a goal type, starting price and date, household income and expenses, current EMIs, savings contributions over time, goal changes, and a verified outcome date or reason the goal was stopped. A model should be considered only after enough representative examples are collected and evaluated on households not used in training.

Until then, the app reports transparent arithmetic scenarios, with no assumed investment return, price growth, or new borrowing.
