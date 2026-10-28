import { buildSavingsBudget, interpretConstraintMessage } from "./budget_recommendations.mjs";


// Keep the user's budget and chat preferences in this page only.
const targetForm = document.querySelector("#savings-target-form");
const targetInput = document.querySelector("#monthly-savings-target");
const chatForm = document.querySelector("#savings-chat-form");
const chatInput = document.querySelector("#savings-chat-input");
const chatMessages = document.querySelector("#savings-chat-messages");
const rows = document.querySelector("#savings-budget-rows");
const table = document.querySelector("#savings-budget-table-wrap");
const emptyMessage = document.querySelector("#savings-budget-empty");
const planMessage = document.querySelector("#savings-plan-message");
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


// Show the tracked balance and what the user's category limits would change.
function showSavingsBudget() {
  const target = Number(targetInput.value);
  const plan = buildSavingsBudget(monthlySummary, target, {
    adjustableCategories,
    lockedCategories,
    maximumCuts,
    region: profileRegion,
  });

  planMessage.textContent = plan.message;
  regionNote.textContent = plan.region
    ? `Your profile region is ${plan.region}. Savings calculations use your tracked amounts; regional price differences are not included.`
    : "";
  document.querySelector("#savings-recorded-balance").textContent = plan.currentBalance === null
    ? "—"
    : formatRupees(plan.currentBalance);
  document.querySelector("#savings-adjustment-total").textContent = plan.currentBalance === null
    ? "—"
    : formatRupees(plan.totalCut);
  document.querySelector("#savings-available-amount").textContent = plan.availableToSave === null
    ? "—"
    : formatRupees(plan.availableToSave);
  document.querySelector("#savings-target-gap").textContent = plan.targetGap === null
    ? "No target set"
    : formatRupees(plan.targetGap);

  rows.replaceChildren();
  table.hidden = plan.cuts.length === 0;
  emptyMessage.hidden = plan.cuts.length !== 0;

  if (plan.cuts.length === 0) {
    emptyMessage.textContent = plan.currentBalance === null
      ? plan.status === "needs-income"
        ? "Add an income entry to start the estimate."
        : "Add at least one expense entry. Missing expenses are not treated as zero."
      : plan.status === "already-on-track"
        ? "Your recorded balance already covers the monthly savings target. No cuts are needed."
        : plan.status === "target-shortfall"
          ? "No flexible category is currently available for a reduction. Tell me what could change in the chat below."
          : plan.status === "no-flexible-categories"
            ? "No adjustable spending categories are available. Tell me which category could change in the chat below."
            : "No category reductions are needed for this monthly plan.";
  }

  for (const cut of plan.cuts) {
    const row = document.createElement("tr");
    const category = document.createElement("th");
    category.scope = "row";
    category.textContent = cut.category;
    row.append(category);

    for (const amount of [cut.currentAmount, cut.proposedCut, cut.newAmount]) {
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
