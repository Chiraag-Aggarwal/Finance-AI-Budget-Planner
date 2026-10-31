import { buildSavingsBudget, interpretConstraintMessage } from "./budget_recommendations.mjs";


// Keep the user's budget and chat preferences in this page only.
const chatForm = document.querySelector("#savings-chat-form");
const chatInput = document.querySelector("#savings-chat-input");
const chatMessages = document.querySelector("#savings-chat-messages");
const rows = document.querySelector("#savings-budget-rows");
const table = document.querySelector("#savings-budget-table-wrap");
const planMessage = document.querySelector("#savings-plan-message");
const draftNote = document.querySelector("#savings-draft-note");
const regionNote = document.querySelector("#savings-region-note");
const modelNote = document.querySelector("#savings-model-note");
const coachIntro = document.querySelector("#savings-coach-intro");

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

let monthlySummary = { categoryTotals: [], isComplete: false };
let adjustableCategories = new Set([
  "Other", "Personal", "Transport", "Utilities", "Food and groceries",
]);
let lockedCategories = new Set();
let maximumCuts = new Map();
let lastDiscussedCategory = null;
let profileRegion = "";


function formatRupees(amount) {
  return currency.format(amount);
}


function addChatMessage(messageText, sender) {
  const message = document.createElement("li");
  message.className = `chat-message ${sender}-message`;
  message.textContent = messageText;
  chatMessages.append(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}


// Explain the suggested changes without asking the user to set a savings target.
function savingsMessage(plan) {
  if (plan.status === "needs-income") return "Add income to see a monthly estimate.";
  if (plan.status === "needs-expenses") return "Add expenses to see where spending may be adjusted. Missing expenses are not assumed to be zero.";
  if (plan.modelUsed) {
    return window.financeTranslate?.("The values above use your personal spending forecast. Income is held at the amount recorded for the selected complete month.")
      || "The values above use your personal spending forecast. Income is held at the amount recorded for the selected complete month.";
  }

  if (plan.status === "monthly-shortfall") {
    const amountOver = formatRupees(Math.abs(plan.currentBalance));
    return plan.totalCut > 0
      ? `Recorded spending is ${amountOver} above income. Suggested changes could reduce the gap by ${formatRupees(plan.totalCut)} per month.`
      : `Recorded spending is ${amountOver} above income. Add flexible expenses to see possible changes.`;
  }

  if (plan.status === "starter-suggestions") {
    return `These small changes could free ${formatRupees(plan.totalCut)} each month. After them, your recorded budget could leave about ${formatRupees(plan.availableToSave)} for future savings.`;
  }

  return `Your recorded budget leaves ${formatRupees(plan.availableToSave)} after expenses. No adjustable spending was found in the categories recorded; use Adjust suggestions to explore another category.`;
}


// Show the remaining balance and practical reductions from flexible categories.
function showSavingsBudget() {
  const forecast = monthlySummary.isComplete
    && monthlySummary.selectedMonth === monthlySummary.nextMonthForecast?.historyMonths?.at(-1)
    ? monthlySummary.nextMonthForecast
    : null;
  const plan = buildSavingsBudget(monthlySummary, 0, {
    adjustableCategories,
    lockedCategories,
    maximumCuts,
    region: profileRegion,
    nextMonthForecast: forecast,
  });

  planMessage.textContent = savingsMessage(plan);
  coachIntro.textContent = plan.modelUsed
    ? (window.financeTranslate?.("Plan next month using your personal spending forecast.")
      || "Plan next month using your personal spending forecast.")
    : (window.financeTranslate?.("See practical changes based on the spending you recorded this month.")
      || "See practical changes based on the spending you recorded this month.");
  modelNote.textContent = plan.modelUsed
    ? (window.financeTranslate?.("Forecast: a trend from 3–6 consecutive complete months. Savings ideas use optional fixed examples, not learned savings outcomes.")
      || "Forecast: a trend from 3–6 consecutive complete months. Savings ideas use optional fixed examples, not learned savings outcomes.")
    : (window.financeTranslate?.("Savings ideas use this month's recorded spending now. A personal forecast needs 3 consecutive recent months marked complete.")
      || "Savings ideas use this month's recorded spending now. A personal forecast needs 3 consecutive recent months marked complete.");
  document.querySelector("#savings-balance-label").textContent = plan.modelUsed
    ? (window.financeTranslate?.("Estimated balance next month") || "Estimated balance next month")
    : (window.financeTranslate?.("Current balance this month") || "Current balance this month");
  document.querySelector("#savings-current-heading").textContent = plan.modelUsed
    ? (window.financeTranslate?.("Estimated next-month spending") || "Estimated next-month spending")
    : (window.financeTranslate?.("Current monthly spend") || "Current monthly spend");
  document.querySelector("#savings-suggested-heading").textContent = plan.modelUsed
    ? (window.financeTranslate?.("Suggested next-month spending") || "Suggested next-month spending")
    : (window.financeTranslate?.("Suggested monthly spend") || "Suggested monthly spend");
  document.querySelector("#savings-budget-caption").textContent = plan.modelUsed
    ? (window.financeTranslate?.("Next-month spending forecast, suggested amount, and possible savings by category") || "Next-month spending forecast, suggested amount, and possible savings by category")
    : (window.financeTranslate?.("Current monthly spending, suggested spending, and possible savings by category") || "Current monthly spending, suggested spending, and possible savings by category");
  regionNote.textContent = plan.region
    ? `Your profile region is ${plan.region}. Savings calculations use your tracked amounts; regional price differences are not included.`
    : "";
  draftNote.hidden = monthlySummary.isComplete || plan.currentBalance === null;
  document.querySelector("#savings-recorded-balance").textContent = plan.currentBalance === null
    ? "—"
    : formatRupees(plan.currentBalance);
  document.querySelector("#savings-adjustment-total").textContent = plan.currentBalance === null
    ? "—"
    : formatRupees(plan.totalCut);
  document.querySelector("#savings-available-amount").textContent = plan.availableToSave === null
    ? "—"
    : formatRupees(plan.availableToSave);

  rows.replaceChildren();
  table.hidden = plan.cuts.length === 0;

  for (const cut of plan.cuts) {
    const row = document.createElement("tr");
    const category = document.createElement("th");
    category.scope = "row";
    category.textContent = cut.category;
    row.append(category);

    for (const amount of [cut.currentAmount, cut.newAmount, cut.proposedCut]) {
      const cell = document.createElement("td");
      cell.textContent = formatRupees(amount);
      row.append(cell);
    }
    rows.append(row);
  }
}

// Interpret plain-language limits for categories and recalculate the plan.
chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) {
    return;
  }

  addChatMessage(message, "user");
  chatInput.value = "";

  const choice = interpretConstraintMessage(message, lastDiscussedCategory);
  if (choice.type === "unknown-category") {
    addChatMessage("Please mention a tracker category such as groceries, housing, utilities, transport, health, education, family support, Personal, or Other. Existing Loan EMI is always protected.", "assistant");
    return;
  }

  if (choice.type === "protected") {
    lastDiscussedCategory = choice.category;
    addChatMessage("I’ll keep your existing Loan EMI unchanged. It remains part of your monthly costs.", "assistant");
    return;
  }

  lastDiscussedCategory = choice.category;
  if (choice.type === "fixed") {
    lockedCategories.add(choice.category);
    adjustableCategories.delete(choice.category);
    maximumCuts.delete(choice.category);
    addChatMessage(`Understood. I’ll leave ${choice.category} unchanged.`, "assistant");
  } else if (choice.type === "adjustable") {
    lockedCategories.delete(choice.category);
    adjustableCategories.add(choice.category);
    if (choice.maximum === null) {
      maximumCuts.delete(choice.category);
      addChatMessage(`I’ll consider a modest reduction in ${choice.category}, up to 10% of its tracked total.`, "assistant");
    } else {
      maximumCuts.set(choice.category, choice.maximum);
      addChatMessage(`I’ll cap the suggested reduction in ${choice.category} at ${formatRupees(choice.maximum)} per month.`, "assistant");
    }
  } else {
    addChatMessage(`Should ${choice.category} stay fixed, or can it change? You can say “${choice.category} is fixed” or “I can reduce ${choice.category} by ₹500.”`, "assistant");
    return;
  }

  showSavingsBudget();
  if (!monthlySummary.isComplete) {
    addChatMessage("I’ve noted that limit. The table is a draft from entries so far; mark the month complete when you have entered the rest.", "assistant");
  }
});


// The tracker sends an updated summary whenever entries or the selected month change.
window.addEventListener("finance-budget-summary", (event) => {
  monthlySummary = event.detail;
  showSavingsBudget();
});


// Include the saved location in the explanation without inventing local prices.
window.addEventListener("finance-user-profile", (event) => {
  profileRegion = event.detail.region || "";
  showSavingsBudget();
});


showSavingsBudget();
