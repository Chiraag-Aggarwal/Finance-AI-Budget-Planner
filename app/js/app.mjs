import { calculatePlan, LOAN_TERMS_BY_GOAL, validateProfile } from "./finance_calculations.mjs";


// Keep saved information in this browser only. The version helps us update it later.
const SAVED_PROFILE_KEY_PREFIX = "finance-ai-planner-profile-v1";

const form = document.querySelector("#finance-form");
const errorBox = document.querySelector("#form-errors");
const errorList = document.querySelector("#form-error-list");
const saveCheckbox = document.querySelector("#save-on-device");
const saveStatus = document.querySelector("#save-status");
const clearButton = document.querySelector("#clear-saved");
const results = document.querySelector("#plan-results");
const emptyResults = document.querySelector("#empty-results");
const loanToggle = form.elements.namedItem("considerLoan");
const goalToggle = form.elements.namedItem("includeGoal");
const goalFields = document.querySelectorAll("[data-goal-input]");
const loanFields = document.querySelectorAll("[data-loan-input]");
const goalTypeSelect = form.elements.namedItem("goalType");
const preferredTermSelect = form.elements.namedItem("preferredLoanTermMonths");

let currentUserId = null;
let activeProfile = null;
let activePlan = null;

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});


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

// Offer repayment terms that match the selected purchase category.
function formatLoanTerm(months) {
  if (months >= 12 && months % 12 === 0) {
    const years = months / 12;
    return `${years} ${years === 1 ? "year" : "years"}`;
  }
  return `${months} months`;
}

function updatePreferredTerms() {
  const previousValue = preferredTermSelect.value;
  const terms = LOAN_TERMS_BY_GOAL[goalTypeSelect.value] || LOAN_TERMS_BY_GOAL.other;
  preferredTermSelect.replaceChildren();

  const compareOption = document.createElement("option");
  compareOption.value = "";
  compareOption.textContent = "Compare all options";
  preferredTermSelect.append(compareOption);

  for (const months of terms) {
    const option = document.createElement("option");
    option.value = String(months);
    option.textContent = formatLoanTerm(months);
    preferredTermSelect.append(option);
  }

  preferredTermSelect.value = terms.includes(Number(previousValue)) ? previousValue : "";
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

  if (!enabled) loanToggle.checked = false;
  updatePreferredTerms();
  updateLoanFields();
}

goalToggle.addEventListener("change", updateGoalFields);
goalTypeSelect.addEventListener("change", updatePreferredTerms);
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
  const selectedTerm = preferredTermSelect.value;

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
    emergencyFundMonths: readNumber("emergencyFundMonths"),
    goalComfortPercent: readNumber("goalComfortPercent"),
    region: form.elements.namedItem("region").value.trim(),
    goalType: form.elements.namedItem("goalType").value,
    goalPrice: includeGoal ? readNumber("goalPrice") : null,
    plannedDownPayment: includeGoal ? readNumber("plannedDownPayment") : null,
    monthsUntilGoal: includeGoal ? readNumber("monthsUntilGoal") : null,
    considerLoan: compareLoan,
    loanRatePercent: compareLoan ? readOptionalNumber("loanRatePercent") : null,
    preferredLoanTermMonths: compareLoan && selectedTerm !== "" ? Number(selectedTerm) : null,
    maxComfortableNewEmi: compareLoan ? readOptionalNumber("maxComfortableNewEmi") : null,
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


// Show how much the down payment needs each month and compare it with the user's choice.
function showGoalPlan(plan) {
  if (!plan.goal) return;
  showText("result-required-saving", formatRupees(plan.goal.requiredMonthlySaving));
  showText("result-comfort-saving", formatRupees(plan.goal.comfortableMonthlySaving));
  showText("result-saving-gap", formatRupees(plan.goal.monthlySavingGap));
  showText("result-down-payment-gap", formatRupees(plan.goal.remainingDownPayment));
  showText("result-required-cash-saving", formatRupees(plan.goal.requiredMonthlyFullPriceSaving));
  showText("result-savings-by-deadline", formatRupees(plan.goal.savingsByDeadline));
  showText("result-down-payment-deadline-gap", formatRupees(plan.goal.downPaymentShortfallAtDeadline));
  showText("result-full-price-deadline-gap", formatRupees(plan.goal.fullPriceShortfallAtDeadline));
  showText("result-full-cash-timeline", formatMonths(plan.goal.monthsToFullCashAtChosenPace));

  if (plan.goal.fitsChosenMonthlyAmount) {
    showText(
      "result-goal-message",
      "The required monthly saving fits within the amount you chose for this goal."
    );
  } else if (plan.goal.monthsAtChosenSavingPace === null) {
    showText(
      "result-goal-message",
      "There is no positive monthly amount assigned to this goal, so a savings timeline cannot be estimated."
    );
  } else {
    showText(
      "result-goal-message",
      `At your chosen monthly amount, saving the remaining down payment could take about ${plan.goal.monthsAtChosenSavingPace} months.`
    );
  }

  if (plan.goal.fullPriceShortfallAtDeadline > 0) {
    showText(
      "result-cash-message",
      `At this pace, the simple cash-purchase estimate is short by ${formatRupees(plan.goal.fullPriceShortfallAtDeadline)} at your target date. It does not assume a new loan.`
    );
  } else {
    showText(
      "result-cash-message",
      "At this pace, the simple estimate reaches the full target price in cash by your selected date, before any price changes."
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
function showLoanPlan(loan) {
  const card = document.querySelector("#loan-plan-card");
  card.hidden = loan.status === "not-considered" || loan.status === "goal-needed";
  if (card.hidden) return;

  showText("result-loan-amount", formatRupees(loan.loanAmount));
  showText("result-loan-cap", formatRupees(loan.comfortableEmiLimit));
  showText("result-loan-rate", loan.annualRatePercent === null ? "Not entered" : `${loan.annualRatePercent}% p.a.`);

  const rows = document.querySelector("#loan-scenario-rows");
  const table = document.querySelector("#loan-scenario-wrap");
  rows.replaceChildren();
  table.hidden = loan.scenarios.length === 0;

  if (loan.status === "no-loan-needed") {
    showText("result-loan-message", "Your planned down payment covers the entered purchase price, so this estimate does not need a loan.");
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
    const preferred = document.createElement("td");
    term.scope = "row";
    term.textContent = formatLoanTerm(scenario.months);
    emi.textContent = formatRupees(scenario.emi);
    interest.textContent = formatRupees(scenario.totalInterest);
    fits.textContent = scenario.affordable ? "Within your limit" : "Above your limit";
    preferred.textContent = scenario.isPreferred ? "Your choice" : "—";
    if (scenario.isPreferred) row.classList.add("preferred-loan-row");
    row.append(term, emi, interest, fits, preferred);
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
  } else {
    showText(
      "result-loan-message",
      `None of these example terms fits your ${formatRupees(loan.comfortableEmiLimit)} monthly limit. At the longest example term, a loan of about ${formatRupees(loan.maxAffordableLoanAtLongestTerm)} would fit this limit; the difference may need a larger down payment, lower target price, or later purchase.`
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
        `Your down-payment timeline needs ${formatRupees(plan.goal.monthlySavingGap)} more per month than your selected amount. Consider changing the deadline, target, or saving share.`
      );
    }

    if (plan.goal.fullPriceShortfallAtDeadline > 0) {
      guidance.push(
        `For a cash purchase, the projected gap at your target date is ${formatRupees(plan.goal.fullPriceShortfallAtDeadline)}. This estimate does not include a new loan or investment returns.`
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
  showGoalPlan(plan.goal ? plan : { goal: null });
  showFlexibleSavings(plan);
  showLoanPlan(plan.loan);
  showNotes(plan.notes, plan, profile);

  emptyResults.hidden = true;
  results.hidden = false;
}


// Save only when the user ticks the local-save box.
function saveProfileOnThisDevice(profile) {
  if (!saveCheckbox.checked) {
    saveStatus.textContent = "Not saved. Your figures are only being used for this page.";
    return;
  }

  try {
    window.localStorage.setItem(getSavedProfileKey(), JSON.stringify(profile));
    saveStatus.textContent = "Saved in this browser on this device.";
  } catch {
    saveStatus.textContent = "The browser could not save these details. Your calculation is still shown.";
  }
}


// Put saved values back into their form fields when the page is reopened.
function fillForm(profile) {
  const preferredTerm = profile.preferredLoanTermMonths;
  for (const [fieldName, value] of Object.entries(profile)) {
    if (fieldName === "preferredLoanTermMonths") continue;
    const field = form.elements.namedItem(fieldName);
    if (!field || value === null || value === undefined) continue;
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else {
      field.value = String(value);
    }
  }

  // Build the right term choices before restoring the user's saved selection.
  updateGoalFields();
  if (preferredTerm !== null && preferredTerm !== undefined) {
    preferredTermSelect.value = String(preferredTerm);
  }
}


// Load a saved profile only from this browser; invalid saved data is ignored.
function loadSavedProfile() {
  if (currentUserId === null) {
    return;
  }

  try {
    const savedText = window.localStorage.getItem(getSavedProfileKey());
    if (!savedText) {
      return;
    }

    const savedProfile = JSON.parse(savedText);
    if (savedProfile.includeGoal === undefined) savedProfile.includeGoal = true;
    if (typeof savedProfile.region !== "string" && savedProfile.includeGoal) {
      fillForm(savedProfile);
      saveCheckbox.checked = true;
      saveStatus.textContent = "Your saved plan is from an older version. Add your city or region, then calculate again.";
      return;
    }

    const validation = validateProfile(savedProfile);

    if (!validation.isValid) {
      return;
    }

    fillForm(savedProfile);
    saveCheckbox.checked = true;
    showPlan(savedProfile, calculatePlan(savedProfile));
    saveStatus.textContent = "Loaded your saved details from this browser.";
  } catch {
    // Ignore storage problems and let the user enter a new plan.
  }
}


// Calculate when the form is submitted.
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
  saveProfileOnThisDevice(profile);
  document.querySelector("#results").scrollIntoView({ behavior: "smooth", block: "start" });
});


// Remove saved numbers and reset the page when the user asks to clear them.
clearButton.addEventListener("click", () => {
  try {
    window.localStorage.removeItem(getSavedProfileKey());
    saveStatus.textContent = "Saved details cleared from this browser.";
  } catch {
    saveStatus.textContent = "The browser could not access its saved details.";
  }

  form.reset();
  updateGoalFields();
  saveCheckbox.checked = false;
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
window.addEventListener("finance-user-ready", (event) => {
  currentUserId = String(event.detail.id);
  document.querySelector('#finance-form [name="region"]').value = event.detail.region;
  loadSavedProfile();
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
