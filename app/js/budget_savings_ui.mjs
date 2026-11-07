// Insights page: render savings examples and apply this page's temporary chat constraints.
// Budget totals arrive from budget_ui; this module does not alter saved transactions.

import { buildSavingsBudget, interpretConstraintMessage } from "./budget_recommendations.mjs";
import { createPageScope } from "./page_scope.mjs";

// Mount this page inside the persistent layout; dispose it when leaving.
export function mountPage(root, user) {
  const scope = createPageScope(root);
  // Keep the user's budget and chat preferences in this page only.
  const chatForm = root.querySelector("#savings-chat-form");
  const chatInput = root.querySelector("#savings-chat-input");
  const chatMessages = root.querySelector("#savings-chat-messages");
  const rows = root.querySelector("#savings-budget-rows");
  const table = root.querySelector("#savings-budget-table-wrap");
  const planMessage = root.querySelector("#savings-plan-message");
  const draftNote = root.querySelector("#savings-draft-note");
  const regionNote = root.querySelector("#savings-region-note");
  const modelNote = root.querySelector("#savings-model-note");

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
  let profileRegion = user.region || "";


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
      return window.financeTranslate?.("These are provisional spending estimates, not guaranteed savings. Income is held at the amount you entered.")
        || "These are provisional spending estimates, not guaranteed savings. Income is held at the amount you entered.";
    }

    if (plan.status === "monthly-shortfall") {
      const amountOver = formatRupees(Math.abs(plan.currentBalance));
      return plan.totalCut > 0
        ? `Recorded spending is ${amountOver} above income. Suggested changes could reduce the gap by ${formatRupees(plan.totalCut)} per month.`
        : `Recorded spending is ${amountOver} above income. Add personal expenses to see possible changes.`;
    }

    if (plan.status === "starter-suggestions") {
      return `These small changes could free ${formatRupees(plan.totalCut)} each month. After them, your recorded budget could leave about ${formatRupees(plan.availableToSave)} for future savings.`;
    }

    return `Your recorded budget leaves ${formatRupees(plan.availableToSave)} after expenses. No adjustable spending was found in the categories recorded; use Adjust suggestions to explore another category.`;
  }


  // Show the remaining balance and practical reductions from flexible categories.
  function showSavingsBudget() {
    const forecast = monthlySummary.nextMonthForecast || null;
    const plan = buildSavingsBudget(monthlySummary, 0, {
      adjustableCategories,
      lockedCategories,
      maximumCuts,
      region: profileRegion,
      nextMonthForecast: forecast,
    });

    planMessage.textContent = savingsMessage(plan);
    modelNote.textContent = plan.modelUsed
      ? (window.financeTranslate?.("Forecasts use your entries and, for repeated purchases, a synthetic starter model. Suggested reductions are optional examples, not learned savings outcomes.")
        || "Forecasts use your entries and, for repeated purchases, a synthetic starter model. Suggested reductions are optional examples, not learned savings outcomes.")
      : (window.financeTranslate?.("Savings ideas use your entries immediately. Add missing expenses before deciding how much you can save.")
        || "Savings ideas use your entries immediately. Add missing expenses before deciding how much you can save.");
    root.querySelector("#savings-balance-label").textContent = plan.modelUsed
      ? (window.financeTranslate?.("Estimated balance next month") || "Estimated balance next month")
      : (window.financeTranslate?.("Current balance this month") || "Current balance this month");
    root.querySelector("#savings-current-heading").textContent = plan.modelUsed
      ? (window.financeTranslate?.("Estimated next-month spending") || "Estimated next-month spending")
      : (window.financeTranslate?.("Current monthly spend") || "Current monthly spend");
    root.querySelector("#savings-suggested-heading").textContent = plan.modelUsed
      ? (window.financeTranslate?.("Suggested next-month spending") || "Suggested next-month spending")
      : (window.financeTranslate?.("Suggested monthly spend") || "Suggested monthly spend");
    root.querySelector("#savings-budget-caption").textContent = plan.modelUsed
      ? (window.financeTranslate?.("Next-month spending forecast, suggested amount, and possible savings by category") || "Next-month spending forecast, suggested amount, and possible savings by category")
      : (window.financeTranslate?.("Current monthly spending, suggested spending, and possible savings by category") || "Current monthly spending, suggested spending, and possible savings by category");
    regionNote.textContent = plan.region
      ? `Your profile region is ${plan.region}. Savings calculations use your tracked amounts; regional price differences are not included.`
      : "";
    draftNote.hidden = monthlySummary.isComplete || plan.currentBalance === null;
    root.querySelector("#savings-recorded-balance").textContent = plan.currentBalance === null
      ? "—"
      : formatRupees(plan.currentBalance);
    root.querySelector("#savings-adjustment-total").textContent = plan.currentBalance === null
      ? "—"
      : formatRupees(plan.totalCut);
    root.querySelector("#savings-available-amount").textContent = plan.availableToSave === null
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
      addChatMessage("I’ve noted that limit. The table updates when you add more entries; missing expenses remain unknown.", "assistant");
    }
  });


  // The tracker sends an updated summary whenever entries or the selected month change.
  scope.listen(root, "finance-budget-summary", (event) => {
    if (String(event.detail.ownerId) !== String(user.id)) return;
    monthlySummary = event.detail;
    showSavingsBudget();
  });


  // Include the saved location in the explanation without inventing local prices.
  scope.listen(window, "finance-user-profile", (event) => {
    if (String(event.detail.id) !== String(user.id)) return;
    profileRegion = event.detail.region || "";
    showSavingsBudget();
  });


  showSavingsBudget();

  // A new account must not inherit the previous account's chat constraints.
  scope.listen(window, "finance-user-logout", () => {
    adjustableCategories = new Set(["Other", "Personal", "Transport", "Utilities", "Food and groceries"]);
    lockedCategories = new Set();
    maximumCuts = new Map();
    lastDiscussedCategory = null;
    profileRegion = "";
    monthlySummary = { categoryTotals: [], isComplete: false };
    chatMessages.replaceChildren();
    chatInput.value = "";
    showSavingsBudget();
  });
  return { ready: scope.start(user), dispose: scope.dispose };
}
