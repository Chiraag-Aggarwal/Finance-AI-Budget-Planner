import { calculatePlan, validateProfile } from "./finance_calculations.mjs";
import { loadFinanceData, saveFinanceDataField } from "./finance_data.mjs";


// This key is used only to import plans saved by an earlier browser-only version.
const SAVED_PROFILE_KEY_PREFIX = "finance-ai-planner-profile-v1";

const form = document.querySelector("#finance-form");
const errorBox = document.querySelector("#form-errors");
const errorList = document.querySelector("#form-error-list");
const saveStatus = document.querySelector("#save-status");
const clearButton = document.querySelector("#clear-saved");
const results = document.querySelector("#plan-results");
const emptyResults = document.querySelector("#empty-results");
const loanToggle = form.elements.namedItem("considerLoan");
const goalToggle = form.elements.namedItem("includeGoal");
const useGoalAssetsToggle = form.elements.namedItem("useGoalAssets");
const goalFields = document.querySelectorAll("[data-goal-input]");
const goalAssetFields = document.querySelectorAll("[data-goal-asset-input]");
const loanFields = document.querySelectorAll("[data-loan-input]");
const goalTypeSelect = form.elements.namedItem("goalType");

let currentUserId = null;
let activeProfile = null;
let activePlan = null;
let plannerSaveTimer = null;
let lastSavedPlannerSignature = null;

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const GOAL_DETAILS = Object.freeze({
  car: {
    category: "purchase",
    priceLabel: "What is the car's estimated on-road cost?",
    goalHint: "Include registration, insurance, and other on-road amounts you expect to pay.",
    contributionLabel: "Planned down payment",
    timelineLabel: "How many months until you hope to buy the car?",
  },
  bike: {
    category: "purchase",
    priceLabel: "What is the estimated price of the bike or scooter?",
    goalHint: "Include registration, insurance, or accessories only if you expect to pay for them.",
    contributionLabel: "Planned down payment",
    timelineLabel: "How many months until you plan to buy the bike or scooter?",
  },
  laptop: {
    category: "item",
    priceLabel: "What is the estimated price of the laptop or computer?",
    goalHint: "Include the computer and any essential accessories you plan to buy.",
    contributionLabel: "Amount to pay upfront",
    timelineLabel: "How many months until you plan to buy the computer?",
  },
  home: {
    category: "purchase",
    priceLabel: "What is the estimated cost of the house or flat?",
    goalHint: "Use a recent local quote; include registration and other one-time fees if known.",
    contributionLabel: "Planned down payment",
    timelineLabel: "How many months until you hope to buy the home?",
  },
  plot: {
    category: "purchase",
    priceLabel: "What is the estimated cost of the plot or land?",
    goalHint: "Use a recent local quote; include registration and other one-time costs if known.",
    contributionLabel: "Planned down payment",
    timelineLabel: "How many months until you plan to buy the land?",
  },
  farm: {
    category: "project",
    priceLabel: "What is the estimated cost of the farm or agricultural land?",
    goalHint: "Include only the land, equipment, or setup costs you want this plan to cover.",
    contributionLabel: "Amount to contribute upfront",
    timelineLabel: "How many months until you need the farm or land funds?",
  },
  renovation: {
    category: "project",
    priceLabel: "What is the estimated renovation or repair budget?",
    goalHint: "Include the contractor, materials, and labour costs you expect.",
    contributionLabel: "Amount to have ready before work starts",
    timelineLabel: "How many months until renovation work is expected to start?",
  },
  business: {
    category: "project",
    priceLabel: "What is the estimated start-up or equipment cost?",
    goalHint: "Include set-up and equipment costs. This planner does not estimate future business income.",
    contributionLabel: "Amount to have ready before business set-up",
    timelineLabel: "How many months until you need the start-up funds?",
  },
  education: {
    category: "event",
    priceLabel: "What education or training costs do you expect to cover?",
    goalHint: "If fees are split across dates, plan for the next major fee and its due date.",
    contributionLabel: "Amount to have ready for the next fee",
    timelineLabel: "How many months until the next major fee is due?",
    contributionHelp: "Enter the amount you want ready for that fee. Current goal savings are listed separately below.",
    timelineHelp: "Enter whole months from now until the next major fee is due. Loan repayment is chosen separately.",
    loanHelp: "Optional. Compare a loan for remaining education or training costs with sample EMIs against your monthly budget.",
  },
  medical: {
    category: "event",
    priceLabel: "What out-of-pocket medical cost do you expect?",
    goalHint: "Use the amount your household expects to pay after insurance or confirmed coverage.",
    contributionLabel: "Amount to have ready for the medical bill",
    timelineLabel: "How many months until the medical payment is due?",
    contributionHelp: "Enter the amount you want ready for the expected bill. Current goal savings are listed separately below.",
    timelineHelp: "Enter whole months from now until the medical bill is due. Loan repayment is chosen separately.",
    loanHelp: "Optional. Compare financing the remaining medical cost with sample EMIs against your monthly budget.",
  },
  wedding: {
    category: "event",
    priceLabel: "What share of wedding costs will your household pay?",
    goalHint: "Include only the share this household expects to pay; leave out amounts others have agreed to cover.",
    contributionLabel: "Amount to cover from savings by the wedding",
    timelineLabel: "How many months until the wedding?",
    contributionHelp: "Enter the total amount this household wants to fund from savings by the wedding. Current goal savings are listed separately below.",
    timelineHelp: "Enter whole months from now until the wedding. Loan repayment is chosen separately.",
    loanHelp: "Optional. Compare a loan for the remaining wedding costs with sample EMIs against your monthly budget.",
  },
  travel: {
    category: "event",
    priceLabel: "What is the estimated total cost of your trip?",
    goalHint: "Include trip costs your household expects to pay, such as tickets, lodging, and local travel.",
    contributionLabel: "Amount to cover from savings before the trip",
    timelineLabel: "How many months until you plan to travel?",
    contributionHelp: "Enter the total amount you want ready from savings before travel. Current goal savings are listed separately below.",
    timelineHelp: "Enter whole months from now until your planned trip. Loan repayment is chosen separately.",
    loanHelp: "Optional. Compare financing the remaining trip cost with sample EMIs against your monthly budget.",
  },
  phone: {
    category: "item",
    priceLabel: "What is the estimated price of the phone?",
    goalHint: "Use a recent price for the model you plan to buy.",
    contributionLabel: "Amount to pay upfront",
    timelineLabel: "How many months until you plan to buy the phone?",
  },
  appliance: {
    category: "item",
    priceLabel: "What is the estimated cost of the appliance?",
    goalHint: "Include delivery or installation if you expect to pay those costs.",
    contributionLabel: "Amount to pay upfront",
    timelineLabel: "How many months until you plan to buy the appliance?",
  },
  other: {
    category: "event",
    priceLabel: "What is the estimated cost of this goal?",
    goalHint: "Name this goal, then enter the amount you expect to need and when you will need it.",
    contributionLabel: "Amount to cover from savings for this goal",
    timelineLabel: "How many months until you need the money?",
  },
});

const GOAL_CATEGORY_COPY = Object.freeze({
  purchase: {
    contributionHelp: "Enter the total upfront amount you want ready by the purchase date. Current goal savings are listed separately below.",
    timelineHelp: "Enter whole months from 1 to 360 until you plan to buy. Loan repayment is chosen separately.",
    loanHelp: "Optional. Compare the amount left after your planned upfront payment with sample loan repayments and your monthly EMI limit.",
  },
  item: {
    contributionHelp: "Enter the total amount you want to pay upfront. Current goal savings are listed separately below.",
    timelineHelp: "Enter whole months from 1 to 360 until you plan to buy it. Loan repayment is chosen separately.",
    loanHelp: "Optional. Compare financing the remaining item cost with sample loan repayments and your monthly EMI limit.",
  },
  project: {
    contributionHelp: "Enter the total amount you want ready before work or set-up begins. Current goal savings are listed separately below.",
    timelineHelp: "Enter whole months from 1 to 360 until the work or set-up begins. Loan repayment is chosen separately.",
    loanHelp: "Optional. Compare financing the remaining project or set-up cost with your monthly EMI limit.",
  },
  event: {
    contributionHelp: "Enter the total amount you want to cover from savings by then. Current goal savings are listed separately below.",
    timelineHelp: "Enter whole months from 1 to 360 until the event or payment is due. Loan repayment is chosen separately.",
    loanHelp: "Optional. Compare borrowing the remaining event or payment cost with sample EMIs against your monthly budget.",
  },
});

const goalCopyElements = Object.fromEntries(
  [...document.querySelectorAll("[data-goal-copy]")]
    .map((element) => [element.dataset.goalCopy, element])
);
const customGoalField = document.querySelector("[data-custom-goal]");
const customGoalName = form.elements.namedItem("goalLabel");


// Show whole rupees in the results, using Indian number grouping.
function formatRupees(amount) {
  return currency.format(amount);
}


function getSavedProfileKey() {
  return `${SAVED_PROFILE_KEY_PREFIX}-${currentUserId}`;
}


// Show goal and loan questions only when they apply to this user's plan.
function updateLoanFields() {
  loanFields.forEach((field) => {
    field.hidden = !goalToggle.checked || !loanToggle.checked;
    field.querySelectorAll("input, select").forEach((control) => {
      control.disabled = field.hidden;
    });
  });
}

function formatLoanTerm(months) {
  if (months >= 12 && months % 12 === 0) {
    const years = months / 12;
    return `${years} ${years === 1 ? "year" : "years"}`;
  }
  return `${months} months`;
}

function updateGoalAssetFields() {
  const enabled = goalToggle.checked && useGoalAssetsToggle.checked;
  goalAssetFields.forEach((field) => {
    field.hidden = !enabled;
    field.querySelectorAll("input, select").forEach((control) => {
      if (control.dataset.assetRequired === undefined) {
        control.dataset.assetRequired = String(control.required);
      }
      control.disabled = !enabled;
      control.required = enabled && control.dataset.assetRequired === "true";
    });
  });
}

function updateGoalCopy() {
  const detail = GOAL_DETAILS[goalTypeSelect.value] || GOAL_DETAILS.other;
  const categoryCopy = GOAL_CATEGORY_COPY[detail.category];
  const copy = {
    priceLabel: detail.priceLabel,
    goalHint: detail.goalHint,
    contributionLabel: detail.contributionLabel,
    contributionHelp: detail.contributionHelp || categoryCopy.contributionHelp,
    timelineLabel: detail.timelineLabel,
    timelineHelp: detail.timelineHelp || categoryCopy.timelineHelp,
    loanHelp: detail.loanHelp || categoryCopy.loanHelp,
  };

  for (const [key, value] of Object.entries(copy)) {
    goalCopyElements[key].textContent = value;
  }
}

function updateCustomGoalField() {
  const enabled = goalToggle.checked && goalTypeSelect.value === "other";
  customGoalField.hidden = !enabled;
  customGoalName.disabled = !enabled;
  customGoalName.required = enabled;
}

function updateGoalFields() {
  const enabled = goalToggle.checked;
  goalFields.forEach((field) => {
    field.hidden = !enabled;
    field.querySelectorAll("input, select").forEach((control) => {
      if (control.dataset.goalRequired === undefined) {
        control.dataset.goalRequired = String(control.required);
      }
      control.disabled = !enabled;
      control.required = enabled && control.dataset.goalRequired === "true";
    });
  });

  if (!enabled) {
    loanToggle.checked = false;
    useGoalAssetsToggle.checked = false;
  }
  updateGoalCopy();
  updateCustomGoalField();
  updateGoalAssetFields();
  updateLoanFields();
}

goalToggle.addEventListener("change", updateGoalFields);
useGoalAssetsToggle.addEventListener("change", updateGoalAssetFields);
goalTypeSelect.addEventListener("change", () => {
  updateGoalCopy();
  updateCustomGoalField();
});
loanToggle.addEventListener("change", updateLoanFields);
updateGoalFields();


// Explain the timeline in months without making it sound guaranteed.
function formatMonths(months) {
  if (months === null) {
    return "No timeline at this saving amount";
  }

  if (months === 0) {
    return "Ready now";
  }

  if (months >= 12) {
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    return remainingMonths === 0
      ? `About ${years} ${years === 1 ? "year" : "years"}`
      : `About ${years} years and ${remainingMonths} months`;
  }

  return `${months} months`;
}


// Read one number from the form. A blank required field becomes NaN and is caught by validation.
function readNumber(fieldName) {
  const value = form.elements.namedItem(fieldName).value.trim();
  return value === "" ? NaN : Number(value);
}


// Optional loan fields stay empty until the user has a lender quote or EMI limit.
function readOptionalNumber(fieldName) {
  const value = form.elements.namedItem(fieldName).value.trim();
  return value === "" ? null : Number(value);
}


// Collect only the goal details the user chose to provide.
function readProfileFromForm() {
  const includeGoal = goalToggle.checked;
  const compareLoan = includeGoal && loanToggle.checked;
  const useGoalAssets = includeGoal && useGoalAssetsToggle.checked;

  return {
    includeGoal,
    monthlyTakeHomeIncome: readNumber("monthlyTakeHomeIncome"),
    monthlyEssentialExpenses: readNumber("monthlyEssentialExpenses"),
    monthlyDiscretionaryExpenses: readNumber("monthlyDiscretionaryExpenses"),
    monthlyDebtPayment: readNumber("monthlyDebtPayment"),
    householdSize: readNumber("householdSize"),
    dependents: readNumber("dependents"),
    totalSavings: readNumber("totalSavings"),
    emergencyFund: readNumber("emergencyFund"),
    goalSavings: includeGoal ? readNumber("goalSavings") : null,
    useGoalAssets,
    goalAssetContribution: useGoalAssets ? readNumber("goalAssetContribution") : 0,
    emergencyFundMonths: readNumber("emergencyFundMonths"),
    goalComfortPercent: readNumber("goalComfortPercent"),
    region: form.elements.namedItem("region").value.trim(),
    goalType: goalTypeSelect.value,
    goalLabel: includeGoal && goalTypeSelect.value === "other" ? customGoalName.value.trim() : "",
    goalPrice: includeGoal ? readNumber("goalPrice") : null,
    plannedDownPayment: includeGoal ? readNumber("plannedDownPayment") : null,
    monthsUntilGoal: includeGoal ? readNumber("monthsUntilGoal") : null,
    considerLoan: compareLoan,
    loanRatePercent: compareLoan ? readOptionalNumber("loanRatePercent") : null,
    // Work out the EMI cap and suitable term from the entered budget.
    preferredLoanTermMonths: null,
    maxComfortableNewEmi: null,
  };
}


// Put an amount or message in a page element without interpreting it as HTML.
function showText(elementId, value) {
  document.getElementById(elementId).textContent = value;
}


// Replace the error list each time the user submits the form.
function showValidationErrors(errors) {
  errorList.replaceChildren();

  for (const error of errors) {
    const listItem = document.createElement("li");
    listItem.textContent = error;
    errorList.append(listItem);
  }

  errorBox.hidden = errors.length === 0;

  if (errors.length > 0) {
    errorBox.focus();
  }
}


// Mark an amount as needing attention when it is below zero or above the budget.
function setWarning(elementId, shouldWarn) {
  document.getElementById(elementId).classList.toggle("warning", shouldWarn);
}


// Fill the top summary cards after the user calculates a plan.
function showOverview(profile, plan) {
  showText("overview-income", formatRupees(profile.monthlyTakeHomeIncome));
  showText("overview-balance", formatRupees(plan.cashFlow.balanceAfterListedCosts));
  showText("overview-emergency", formatRupees(plan.emergencyFund.gap));

  if (plan.goal) {
    showText("overview-plan-label", "Goal saving needed");
    showText("overview-plan-hint", "Per month to meet your timeline");
    showText("overview-goal", formatRupees(plan.goal.requiredMonthlySaving));
  } else {
    showText("overview-plan-label", "Suggested monthly saving");
    showText("overview-plan-hint", "Flexible amount for your future");
    showText("overview-goal", formatRupees(plan.savingsPlan.monthlyAmount));
  }

  const status = plan.cashFlow.monthlyShortfall > 0
    ? "Monthly costs exceed income"
    : "Plan calculated from your entries";
  showText("overview-status", status);
  setWarning("overview-balance", plan.cashFlow.monthlyShortfall > 0);
}


// Display the monthly income, costs, and resulting balance.
function showCashFlow(profile, plan) {
  showText("result-income", formatRupees(profile.monthlyTakeHomeIncome));
  showText("result-essentials", formatRupees(profile.monthlyEssentialExpenses));
  showText("result-discretionary", formatRupees(profile.monthlyDiscretionaryExpenses));
  showText("result-debt-payment", formatRupees(profile.monthlyDebtPayment));
  showText("result-balance", formatRupees(plan.cashFlow.balanceAfterListedCosts));

  if (plan.cashFlow.monthlyShortfall > 0) {
    showText("cash-flow-message", "The costs entered are higher than the take-home income entered.");
  } else {
    showText("cash-flow-message", "This is the amount left after the costs listed above, before your planned monthly savings.");
  }
  setWarning("cash-flow-message", plan.cashFlow.monthlyShortfall > 0);
}


// Explain the emergency-fund amount using the number of months the user chose.
function showEmergencyFund(plan) {
  showText("result-emergency-gap", formatRupees(plan.emergencyFund.gap));
  showText("result-emergency-target", formatRupees(plan.emergencyFund.target));
  showText("result-emergency-current", formatRupees(plan.emergencyFund.current));
  showText("result-emergency-months", `${plan.emergencyFund.selectedMonths} months`);

  if (plan.emergencyFund.gap === 0) {
    showText("result-emergency-time", "Your current emergency fund meets the target you selected.");
  } else if (plan.emergencyFund.monthsToTargetIfThatAmountIsUsed === null) {
    showText(
      "result-emergency-time",
      "No monthly amount is assigned toward this emergency-fund gap."
    );
  } else {
    showText(
      "result-emergency-time",
      `If you set aside ${formatRupees(plan.emergencyFund.monthlyAmountOutsideGoalPlan)} each month for this gap, it could take about ${plan.emergencyFund.monthsToTargetIfThatAmountIsUsed} months.`
    );
  }
}


// Show the monthly amount needed for the selected goal contribution.
function showGoalPlan(plan) {
  if (!plan.goal) return;
  showText("result-required-saving", formatRupees(plan.goal.requiredMonthlySaving));
  showText("result-comfort-saving", formatRupees(plan.goal.comfortableMonthlySaving));
  showText("result-saving-gap", formatRupees(plan.goal.monthlySavingGap));
  showText("result-assets-included", formatRupees(plan.goal.assetsOrFamilyFundsUsed));
  showText("result-down-payment-gap", formatRupees(plan.goal.remainingDownPayment));
  showText("result-required-cash-saving", formatRupees(plan.goal.requiredMonthlyFullPriceSaving));
  showText("result-savings-by-deadline", formatRupees(plan.goal.savingsByDeadline));
  showText("result-down-payment-deadline-gap", formatRupees(plan.goal.downPaymentShortfallAtDeadline));
  showText("result-full-price-deadline-gap", formatRupees(plan.goal.fullPriceShortfallAtDeadline));
  if (plan.loan.status === "affordable-option") {
    if (plan.goal.monthsToCompleteWithRecommendedLoan === null) {
      showText("result-full-cash-timeline", "Not available with this saving amount");
      showText(
        "result-timeline-explainer",
        "Your monthly saving amount does not reach the planned upfront contribution, so the time including a loan cannot be estimated. Increase the saving amount or move the purchase date to review the timeline."
      );
    } else {
      showText("result-full-cash-timeline", formatMonths(plan.goal.monthsToCompleteWithRecommendedLoan));
      showText(
        "result-timeline-explainer",
        "This estimate includes the time until your planned purchase date or until your planned upfront contribution is saved, whichever takes longer, plus the affordable loan repayment term shown below. Current expenses and EMIs are included when checking the new EMI limit. Fees, price changes, changing rates, and lender approval are not included."
      );
    }
  } else if (plan.loan.status === "no-loan-needed") {
    showText("result-full-cash-timeline", formatMonths(plan.goal.monthsToPurchaseAtChosenPace));
    showText(
      "result-timeline-explainer",
      "Your selected savings or other funds cover the estimated goal cost, so no new loan is needed. The time shown is based on your target purchase date and the time needed to save the planned upfront contribution."
    );
  } else if (plan.loan.status === "rate-needed") {
    showText("result-full-cash-timeline", "Add an interest rate to include a loan");
    showText(
      "result-timeline-explainer",
      `Cash-only reference: ${formatMonths(plan.goal.monthsToFullCashAtChosenPace)}. Enter a lender's quoted annual interest rate to estimate the total time including loan repayment.`
    );
  } else if (plan.loan.status === "no-affordable-option") {
    if (plan.loan.smallerLoanPlan) {
      if (plan.goal.monthsToCompleteWithSmallerLoan === null) {
        showText("result-full-cash-timeline", "No timeline at this saving amount");
        showText(
          "result-timeline-explainer",
          "A smaller loan could fit your EMI limit, but there is no monthly saving amount available to estimate when its extra upfront contribution would be ready."
        );
      } else {
        showText("result-full-cash-timeline", formatMonths(plan.goal.monthsToCompleteWithSmallerLoan));
        showText(
          "result-timeline-explainer",
          `This estimate first adds ${formatRupees(plan.loan.additionalDownPaymentNeeded)} of extra upfront saving, then ${formatLoanTerm(plan.loan.smallerLoanPlan.months)} of loan repayments. It assumes your current expenses and EMIs stay the same and that you save your selected amount each month. Fees, price changes, rate changes, and lender approval are not included.`
        );
      }
    } else {
      showText("result-full-cash-timeline", formatMonths(plan.goal.monthsToFullCashAtChosenPace));
      showText(
        "result-timeline-explainer",
        "No new loan payment fits your current monthly EMI limit. The time shown is the cash-only estimate for saving the remaining goal cost; increasing your savings or reducing the goal cost may change it."
      );
    }
  } else {
    showText("result-full-cash-timeline", formatMonths(plan.goal.monthsToFullCashAtChosenPace));
    showText(
      "result-timeline-explainer",
      plan.goal.monthsToFullCashAtChosenPace !== null && plan.goal.monthsToFullCashAtChosenPace > 120
        ? "This is a long cash-only estimate. Review the goal cost, monthly saving, or target date. Turn on loan and EMI comparison to include an affordable loan repayment term."
        : "Loan comparison is off, so this is a cash-only estimate. Turn it on and enter an annual rate to see the time including loan repayment."
    );
  }

  if (plan.goal.fitsChosenMonthlyAmount) {
    showText(
      "result-goal-message",
      "Your selected monthly savings amount can reach this contribution target by your goal date."
    );
  } else if (plan.goal.monthsAtChosenSavingPace === null) {
    showText(
      "result-goal-message",
      "There is no positive monthly amount assigned to this goal, so a savings timeline cannot be estimated."
    );
  } else {
    showText(
      "result-goal-message",
      `At your selected monthly saving amount, reaching the planned contribution could take about ${plan.goal.monthsAtChosenSavingPace} months.`
    );
  }

  if (plan.goal.fullPriceShortfallAtDeadline > 0) {
    showText(
      "result-cash-message",
      `At this pace, the full estimated goal cost would be short by ${formatRupees(plan.goal.fullPriceShortfallAtDeadline)} at your target date. This cash estimate does not include a loan.`
    );
  } else {
    showText(
      "result-cash-message",
      "At this pace, you could cover the full estimated goal cost in cash by your target date, before price changes."
    );
  }

  showGoalScenarios(plan.goal.scenarios);
}


// Show a no-goal savings plan at four simple time points.
function showFlexibleSavings(plan) {
  const card = document.querySelector("#flexible-savings-card");
  card.hidden = !plan.savingsPlan;
  if (!plan.savingsPlan) return;

  showText("result-flexible-saving", formatRupees(plan.savingsPlan.monthlyAmount));
  showText(
    "result-flexible-message",
    plan.emergencyFund.gap > 0
      ? "Your monthly contributions first build the emergency fund to the target you selected. After that, they become extra future savings."
      : "Your selected emergency-fund target is met, so the monthly contributions add to your flexible future savings."
  );

  const rows = document.querySelector("#flexible-savings-rows");
  rows.replaceChildren();
  for (const projection of plan.savingsPlan.projections) {
    const row = document.createElement("tr");
    const horizon = document.createElement("th");
    const contributions = document.createElement("td");
    const emergency = document.createElement("td");
    const extra = document.createElement("td");
    horizon.scope = "row";
    horizon.textContent = formatMonths(projection.months);
    contributions.textContent = formatRupees(projection.plannedContributions);
    emergency.textContent = formatRupees(projection.usedForEmergencyFund);
    extra.textContent = formatRupees(projection.extraSavingsAfterEmergencyTarget);
    row.append(horizon, contributions, emergency, extra);
    rows.append(row);
  }
}


// Show an EMI comparison only when the user enters a quoted annual rate.
function showLoanPlan(plan) {
  const { loan, goal } = plan;
  const card = document.querySelector("#loan-plan-card");
  card.hidden = loan.status === "not-considered" || loan.status === "goal-needed";
  if (card.hidden) return;

  showText("result-loan-amount", formatRupees(loan.loanAmount));
  showText("result-loan-cap", formatRupees(loan.comfortableEmiLimit));
  showText("result-loan-rate", loan.annualRatePercent === null ? "Not entered" : `${loan.annualRatePercent}% p.a.`);
  const monthsBeforePurchase = loan.smallerLoanPlan?.monthsUntilPurchase
    ?? goal?.monthsToPurchaseAtChosenPace
    ?? null;
  showText("result-loan-wait-time", formatMonths(monthsBeforePurchase));
  const suggestedTerm = loan.recommendation?.months
    ?? loan.smallerLoanPlan?.months
    ?? (loan.status === "no-loan-needed" ? "No loan needed"
      : loan.status === "rate-needed" ? "Add a lender rate first"
        : "No loan fits this limit");
  showText(
    "result-loan-term",
    typeof suggestedTerm === "number" ? formatLoanTerm(suggestedTerm) : suggestedTerm,
  );

  const rows = document.querySelector("#loan-scenario-rows");
  const table = document.querySelector("#loan-scenario-wrap");
  rows.replaceChildren();
  table.hidden = loan.scenarios.length === 0;

  if (loan.status === "no-loan-needed") {
    showText("result-loan-message", "The savings or other funds you chose cover the estimated goal cost, so no loan is needed in this estimate.");
    return;
  }
  if (loan.status === "rate-needed") {
    showText("result-loan-message", "Enter a lender's quoted annual interest rate to compare loan amount, monthly EMI, and repayment terms.");
    return;
  }

  for (const scenario of loan.scenarios) {
    const row = document.createElement("tr");
    const term = document.createElement("th");
    const emi = document.createElement("td");
    const interest = document.createElement("td");
    const fits = document.createElement("td");
    const recommended = document.createElement("td");
    term.scope = "row";
    term.textContent = formatLoanTerm(scenario.months);
    emi.textContent = formatRupees(scenario.emi);
    interest.textContent = formatRupees(scenario.totalInterest);
    fits.textContent = scenario.affordable ? "Within your limit" : "Above your limit";
    const isRecommended = loan.recommendation?.months === scenario.months;
    recommended.textContent = isRecommended ? "Recommended" : "—";
    if (isRecommended) row.classList.add("preferred-loan-row");
    row.append(term, emi, interest, fits, recommended);
    rows.append(row);
  }

  if (loan.recommendation) {
    const option = loan.recommendation;
    if (loan.recommendationUsesPreference) {
      showText(
        "result-loan-message",
        `Your chosen ${formatLoanTerm(option.months)} repayment period fits your monthly limit: estimated EMI ${formatRupees(option.emi)} and total interest ${formatRupees(option.totalInterest)}. A longer term usually increases total interest in this estimate.`
      );
    } else if (loan.preferredScenario) {
      showText(
        "result-loan-message",
        `Your chosen ${formatLoanTerm(loan.preferredScenario.months)} repayment period is above your monthly limit. The shortest example period that fits is ${formatLoanTerm(option.months)}, with an estimated EMI of ${formatRupees(option.emi)} and total interest of ${formatRupees(option.totalInterest)}.`
      );
    } else {
      showText(
        "result-loan-message",
        `The shortest example term within your comfort limit is ${formatLoanTerm(option.months)}: estimated EMI ${formatRupees(option.emi)} per month and total interest ${formatRupees(option.totalInterest)}. A longer term lowers the EMI but usually increases total interest in this estimate.`
      );
    }
  } else if (loan.smallerLoanPlan) {
    const option = loan.smallerLoanPlan;
    showText(
      "result-loan-message",
      `No listed loan term fits your monthly EMI limit. If you save an additional ${formatRupees(loan.additionalDownPaymentNeeded)} toward the upfront amount, an estimated loan of ${formatRupees(option.loanAmount)} over ${formatLoanTerm(option.months)} could fit at about ${formatRupees(option.emi)} per month. Estimated interest for this example is ${formatRupees(option.totalInterest)}.`
    );
  } else {
    showText(
      "result-loan-message",
      `No new loan payment fits your ${formatRupees(loan.comfortableEmiLimit)} monthly EMI limit. Consider saving the remaining goal cost in cash, increasing monthly savings, or lowering the goal cost.`
    );
  }
}


// Add the scenario rows as text; user-entered values are never treated as HTML.
function showGoalScenarios(scenarios) {
  const rows = document.querySelector("#goal-scenario-rows");
  rows.replaceChildren();

  for (const scenario of scenarios) {
    const row = document.createElement("tr");
    const name = document.createElement("th");
    const monthlyAmount = document.createElement("td");
    const downPaymentTime = document.createElement("td");
    const fullPriceTime = document.createElement("td");

    name.scope = "row";
    name.textContent = scenario.name;
    monthlyAmount.textContent = formatRupees(scenario.monthlySaving);
    downPaymentTime.textContent = formatMonths(scenario.monthsToDownPayment);
    fullPriceTime.textContent = formatMonths(scenario.monthsToFullCashPurchase);
    row.append(name, monthlyAmount, downPaymentTime, fullPriceTime);
    rows.append(row);
  }
}


// Add the calculation notes as text, so user-entered data is never treated as markup.
function showNotes(notes, plan, profile) {
  const noteList = document.querySelector("#plan-notes");
  noteList.replaceChildren();

  const guidance = [];
  if (plan.cashFlow.monthlyShortfall > 0) {
    guidance.push(plan.goal
      ? `Your listed costs exceed take-home income by ${formatRupees(plan.cashFlow.monthlyShortfall)} per month. Review the budget before adding a goal contribution.`
      : `Your listed costs exceed take-home income by ${formatRupees(plan.cashFlow.monthlyShortfall)} per month. Review your costs before setting a savings amount.`);
  }

  if (plan.emergencyFund.gap > 0) {
    guidance.push(
      `Your emergency fund is ${formatRupees(plan.emergencyFund.gap)} below the target you selected.`
    );
  }

  if (plan.goal) {
    if (!plan.goal.fitsChosenMonthlyAmount) {
      guidance.push(
        `Your goal contribution needs ${formatRupees(plan.goal.monthlySavingGap)} more per month than your selected amount. Consider changing the target date, cost, or monthly saving share.`
      );
    }

    if (plan.goal.fullPriceShortfallAtDeadline > 0) {
      guidance.push(
        `If you plan to cover the full goal cost in cash, the projected gap at your target date is ${formatRupees(plan.goal.fullPriceShortfallAtDeadline)}. This estimate excludes borrowing and investment returns.`
      );
    }

    guidance.push(
      `Your profile region is ${profile.region}. It is shown as location context; this calculation uses your own budget figures.`
    );
  } else if (plan.emergencyFund.gap > 0) {
    guidance.push(
      `Your flexible plan sets aside ${formatRupees(plan.savingsPlan.monthlyAmount)} each month, first toward your emergency-fund target.`
    );
  }

  for (const note of [...guidance, ...notes]) {
    const listItem = document.createElement("li");
    listItem.textContent = note;
    noteList.append(listItem);
  }
}


// Render all result cards from the same calculation result.
function showPlan(profile, plan) {
  activeProfile = profile;
  activePlan = plan;
  showOverview(profile, plan);
  showCashFlow(profile, plan);
  showEmergencyFund(plan);
  document.querySelector("#goal-plan-card").hidden = !plan.goal;
  document.querySelector("#goal-scenario-card").hidden = !plan.goal;
  const goalTitle = document.querySelector("#goal-plan-card .result-card-heading h3");
  goalTitle.textContent = profile.goalType === "other" && profile.goalLabel
    ? `Plan for ${profile.goalLabel}`
    : "Goal funding plan";
  showGoalPlan(plan.goal ? plan : { goal: null });
  showFlexibleSavings(plan);
  showLoanPlan(plan);
  showNotes(plan.notes, plan, profile);

  emptyResults.hidden = true;
  results.hidden = false;
}


// Save the planner details to this signed-in user's account automatically.
async function saveProfileToAccount(profile) {
  window.clearTimeout(plannerSaveTimer);
  const savedProfile = JSON.parse(JSON.stringify(profile));
  try {
    await saveFinanceDataField("plannerProfile", savedProfile);
    lastSavedPlannerSignature = JSON.stringify(savedProfile);
  } catch (error) {
    console.error("Finance AI could not save the planner details.", error);
  }
}

// Save incomplete planner drafts in the background as the user edits.
function schedulePlannerAutoSave() {
  window.clearTimeout(plannerSaveTimer);
  if (currentUserId === null) return;

  plannerSaveTimer = window.setTimeout(async () => {
    const profile = JSON.parse(JSON.stringify(readProfileFromForm()));
    const signature = JSON.stringify(profile);
    if (signature === lastSavedPlannerSignature) return;

    try {
      await saveFinanceDataField("plannerProfile", profile);
      lastSavedPlannerSignature = signature;
    } catch (error) {
      console.error("Finance AI planner auto-save failed.", error);
    }
  }, 250);
}


// Put saved values back into their form fields when the page is reopened.
function fillForm(profile) {
  for (const [fieldName, value] of Object.entries(profile)) {
    const field = form.elements.namedItem(fieldName);
    if (!field || value === undefined) continue;
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else {
      field.value = value === null ? "" : String(value);
    }
  }

  updateGoalFields();
}


// Load the account copy first. Older browser-only plans are imported once.
async function loadSavedProfile() {
  if (currentUserId === null) {
    return;
  }

  try {
    const accountData = await loadFinanceData();
    let savedProfile = accountData.plannerProfile;
    let isLegacyBrowserCopy = !Object.hasOwn(accountData, "plannerProfile");

    if (isLegacyBrowserCopy) {
      const savedText = window.localStorage.getItem(getSavedProfileKey());
      if (!savedText) return;
      savedProfile = JSON.parse(savedText);
    }
    if (!savedProfile || typeof savedProfile !== "object") {
      return;
    }

    // Older saved plans may contain manual term or EMI overrides that this simpler flow no longer uses.
    savedProfile.preferredLoanTermMonths = null;
    savedProfile.maxComfortableNewEmi = null;
    if (savedProfile.includeGoal === undefined) savedProfile.includeGoal = true;
    if (typeof savedProfile.region !== "string" && savedProfile.includeGoal) {
      fillForm(savedProfile);
      lastSavedPlannerSignature = JSON.stringify(savedProfile);
      return;
    }

    const validation = validateProfile(savedProfile);
    fillForm(savedProfile);
    lastSavedPlannerSignature = JSON.stringify(savedProfile);

    // Restore a partial draft too; only calculate results when it is complete.
    if (!validation.isValid) {
      return;
    }

    showPlan(savedProfile, calculatePlan(savedProfile));
    if (isLegacyBrowserCopy) {
      await saveFinanceDataField("plannerProfile", savedProfile);
      window.localStorage.removeItem(getSavedProfileKey());
      saveStatus.textContent = "Your previous plan has been moved to your account.";
    } else {
      saveStatus.textContent = "Loaded your saved plan from your account.";
    }
  } catch {
    saveStatus.textContent = "Your saved plan could not be synced. You can still enter and calculate a plan.";
  }
}


// Calculate when the form is submitted.
form.addEventListener("input", schedulePlannerAutoSave);
form.addEventListener("change", schedulePlannerAutoSave);

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const profile = readProfileFromForm();
  const validation = validateProfile(profile);
  showValidationErrors(validation.errors);

  if (!validation.isValid) {
    return;
  }

  const plan = calculatePlan(profile);
  showPlan(profile, plan);
  saveProfileToAccount(profile);
  document.querySelector("#results").scrollIntoView({ behavior: "smooth", block: "start" });
});


// Remove saved numbers and reset the page when the user asks to clear them.
clearButton.addEventListener("click", () => {
  window.clearTimeout(plannerSaveTimer);
  lastSavedPlannerSignature = null;
  saveFinanceDataField("plannerProfile", null)
    .then(() => {
      window.localStorage.removeItem(getSavedProfileKey());
      saveStatus.textContent = "Your saved plan was removed from your account.";
    })
    .catch(() => {
      saveStatus.textContent = "Could not remove the saved plan. Check your connection and try again.";
    });

  form.reset();
  updateGoalFields();
  activeProfile = null;
  activePlan = null;
  showValidationErrors([]);
  results.hidden = true;
  emptyResults.hidden = false;
  showText("overview-income", "—");
  showText("overview-balance", "—");
  showText("overview-emergency", "—");
  showText("overview-goal", "—");
  showText("overview-plan-label", "Goal saving needed");
  showText("overview-plan-hint", "Per month to meet your timeline");
  showText("overview-status", "Waiting for your figures");
});


// Load local finance details only after the account server confirms who signed in.
window.addEventListener("finance-user-ready", async (event) => {
  window.clearTimeout(plannerSaveTimer);
  lastSavedPlannerSignature = null;
  currentUserId = String(event.detail.id);
  document.querySelector('#finance-form [name="region"]').value = event.detail.region;
  await loadSavedProfile();
  document.querySelector('#finance-form [name="region"]').value = event.detail.region;
});


window.addEventListener("finance-user-profile", (event) => {
  if (currentUserId !== String(event.detail.id)) {
    return;
  }
  document.querySelector('#finance-form [name="region"]').value = event.detail.region;
  if (activeProfile && activePlan) {
    activeProfile.region = event.detail.region;
    showNotes(activePlan.notes, activePlan, activeProfile);
  }
});


window.addEventListener("finance-user-logout", () => {
  window.clearTimeout(plannerSaveTimer);
  lastSavedPlannerSignature = null;
  currentUserId = null;
  activeProfile = null;
  activePlan = null;
  form.reset();
  updateGoalFields();
  results.hidden = true;
  emptyResults.hidden = false;
  showText("overview-income", "—");
  showText("overview-balance", "—");
  showText("overview-emergency", "—");
  showText("overview-goal", "—");
  showText("overview-plan-label", "Goal saving needed");
  showText("overview-plan-hint", "Per month to meet your timeline");
  showText("overview-status", "Waiting for your figures");
});
