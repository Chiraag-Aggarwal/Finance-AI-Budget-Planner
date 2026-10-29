import { buildSavingsBudget, interpretConstraintMessage } from "./budget_recommendations.mjs";


// Keep the user's budget and chat preferences in this page only.
const targetForm = document.querySelector("#savings-target-form");
const targetInput = document.querySelector("#monthly-savings-target");
const chatForm = document.querySelector("#savings-chat-form");
const chatInput = document.querySelector("#savings-chat-input");
const chatMessages = document.querySelector("#savings-chat-messages");
const rows = document.querySelector("#savings-budget-rows");
const table = document.querySelector("#savings-budget-table-wrap");
const planMessage = document.querySelector("#savings-plan-message");
const draftNote = document.querySelector("#savings-draft-note");
const regionNote = document.querySelector("#savings-region-note");

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


// Explain the estimate in one short sentence, using the numbers shown below.
function savingsMessage(plan, target) {
  if (plan.status === "needs-income") return "Add income to see a monthly estimate.";
  if (plan.status === "needs-expenses") return "Add expenses to see where spending may be adjusted. Missing expenses are not assumed to be zero.";

  if (plan.status === "monthly-shortfall") {
    const amountOver = formatRupees(Math.abs(plan.currentBalance));
    return plan.totalCut > 0
      ? `Recorded spending is ${amountOver} above income. Suggested changes could reduce the gap by ${formatRupees(plan.totalCut)} per month.`
      : `Recorded spending is ${amountOver} above income. Add flexible expenses to see possible changes.`;
  }

  if (plan.status === "already-on-track") {
    return "Your current balance already meets this monthly target. No cuts are suggested.";
  }
  if (plan.status === "target-reached") {
    return `These changes could free ${formatRupees(plan.totalCut)} each month and meet your target.`;
  }
  if (plan.status === "target-shortfall") {
    return plan.totalCut > 0
      ? `These changes could free ${formatRupees(plan.totalCut)} each month. You could save about ${formatRupees(plan.availableToSave)}, leaving ${formatRupees(plan.targetGap)} of your target unmet.`
      : `Your target is ${formatRupees(target)} per month, but no adjustable spending was found in these entries.`;
  }
  if (plan.status === "starter-suggestions") {
    return `Small changes could free ${formatRupees(plan.totalCut)} each month for future savings.`;
  }
  return "No adjustable spending is available in these entries. Use Adjust suggestions to explore another category.";
}


// Show only the monthly totals and category changes the user can act on.
function showSavingsBudget() {
  if (!targetInput.validity.valid) {
    planMessage.textContent = "Enter a monthly target between ₹0 and ₹1 crore.";
    draftNote.hidden = true;
    document.querySelector("#savings-recorded-balance").textContent = "—";
    document.querySelector("#savings-adjustment-total").textContent = "—";
    document.querySelector("#savings-available-amount").textContent = "—";
    rows.replaceChildren();
    table.hidden = true;
    return;
  }

  const target = Number(targetInput.value || 0);
  const plan = buildSavingsBudget(monthlySummary, target, {
    adjustableCategories,
    lockedCategories,
    maximumCuts,
    region: profileRegion,
  });

  planMessage.textContent = savingsMessage(plan, target);
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


// Entering a monthly savings target updates the same budget, without a goal form.
targetForm.addEventListener("submit", (event) => {
  event.preventDefault();
  showSavingsBudget();
});

targetInput.addEventListener("input", showSavingsBudget);


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
