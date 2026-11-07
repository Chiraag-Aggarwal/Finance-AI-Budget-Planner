// Monthly budget controller: validate edits, save entries, and refresh totals/forecasts.
// Also supplies the Insights page; document import/export is delegated to budget_documents.

import { mountBudgetDocuments } from "./budget_documents.mjs";
import { summarizeMonth, TRANSACTION_CATEGORIES, validateTransaction } from "./budget_tracker.mjs";
import { createCategoryHelper } from "./category_starter.mjs";
import { forecastNextMonthSpending, closedBudgetMonths } from "./budget_forecast.mjs";
import { loadFinanceData, saveFinanceDataField } from "./finance_data.mjs";
import { createPageScope } from "./page_scope.mjs";

// Mount this page inside the persistent layout; dispose it when leaving.
export function mountPage(root, user) {
  const scope = createPageScope(root);

  const form = root.querySelector("#transaction-form");
  const typeInput = root.querySelector("#transaction-type");
  const categoryInput = root.querySelector("#transaction-category");
  const dateInput = root.querySelector("#transaction-date");
  const noteInput = root.querySelector("#transaction-note");
  const categorySuggestion = root.querySelector("#transaction-category-suggestion");
  const categorySuggestionButton = root.querySelector("#use-transaction-category-suggestion");
  const categorySuggestionName = root.querySelector("#transaction-category-suggestion-name");
  let suggestedCategory = null;
  const categoryHelper = createCategoryHelper(user.id);
  const monthInput = root.querySelector("#budget-month");
  const statusText = root.querySelector("#tracker-status");
  const errorBox = root.querySelector("#transaction-errors");
  const errorList = root.querySelector("#transaction-error-list");
  const transactionRows = root.querySelector("#transaction-rows");
  const forecastStatus = root.querySelector("#spending-forecast-status");
  const forecastResults = root.querySelector("#spending-forecast-results");
  const forecastTotal = root.querySelector("#spending-forecast-total");
  const forecastCategories = root.querySelector("#spending-forecast-categories");
  const forecastNoCategories = root.querySelector("#spending-forecast-no-categories");
  const forecastIncomeCard = root.querySelector("#spending-forecast-income-card");
  const forecastIncome = root.querySelector("#spending-forecast-income");

  const currency = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });

  // Entries are kept here while the page is open.
  let transactions = [];
  let currentUserId = null;
  let completedMonths = new Set();
  let plannerMonthlyIncome = null;
  let plannerProfile = null;
  let dataLoaded = false;
  let failedTransactions = false;
  let failedCompletedMonths = false;


  function formatRupees(amount) {
    return currency.format(amount);
  }


  // Use the user's local date, not the UTC date, for the default entry date.
  function getToday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }


  function getCurrentMonth() {
    return getToday().slice(0, 7);
  }


  // Give each entry a simple unique ID so the user can remove it later.
  function makeEntryId() {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }


  // Change the category choices when the user switches between income and expense.
  function updateCategoryChoices() {
    if (!typeInput || !categoryInput) return; // The insights page has no entry form.
    const categories = TRANSACTION_CATEGORIES[typeInput.value];
    categoryInput.replaceChildren();

    for (const category of categories) {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      categoryInput.append(option);
    }
  }


  function showTransactionErrors(errors) {
    errorList.replaceChildren();

    for (const error of errors) {
      const item = document.createElement("li");
      item.textContent = error;
      errorList.append(item);
    }

    errorBox.hidden = errors.length === 0;
    if (errors.length > 0) {
      errorBox.focus();
    }
  }


  // Save every budget change to the signed-in user's account automatically.
  async function saveTransactions(forNavigation = false) {
    if (currentUserId === null) return;

    try {
      await saveFinanceDataField("transactions", transactions);
      failedTransactions = false;
    } catch (error) {
      failedTransactions = true;
      if (forNavigation) throw error;
      console.error("Finance AI transaction save failed.", error);
    }
  }

  async function saveCompletedMonths(forNavigation = false) {
    if (currentUserId === null) return;
    try {
      await saveFinanceDataField("completedMonths", [...completedMonths].sort());
      failedCompletedMonths = false;
    } catch (error) {
      failedCompletedMonths = true;
      if (forNavigation) throw error;
      console.error("Finance AI completed-month save failed.", error);
    }
  }


  function syncClosedMonths() {
    if (!currentUserId || !dataLoaded) return;
    const closed = closedBudgetMonths(transactions, new Date());
    if (JSON.stringify(closed) === JSON.stringify([...completedMonths].sort())) return;
    completedMonths = new Set(closed);
    saveCompletedMonths();
  }

  // Show the personal forecast and the saved take-home income for context.
  function updateSpendingForecast(forecast = null) {
    if (!forecastResults) return; // Forecasts now live on the insights page.
    forecastResults.hidden = true;
    forecastIncomeCard.hidden = !Number.isFinite(plannerMonthlyIncome) || plannerMonthlyIncome <= 0;

    if (currentUserId === null) {
      forecastStatus.textContent = "Sign in to build a forecast from your saved budget history.";
      return;
    }

    const spendingForecast = forecast ?? forecastNextMonthSpending(transactions, [...completedMonths], new Date(), plannerProfile);
    if (spendingForecast.status !== "ready") {
      forecastStatus.textContent = "Add a recent expense or monthly expenses in Planner to see a starting estimate now.";
      return;
    }
    const modelNote = root.querySelector("#spending-forecast-model-note");
    modelNote.textContent = spendingForecast.usesSyntheticStarter
      ? "Provisional estimate: a model trained on fictional spending scenarios helps scale repeated purchases. It is not validated on real households."
      : "Starting estimate from your recorded amounts or planner totals. More entries help refine it; unrecorded expenses remain unknown.";

    const monthParts = spendingForecast.targetMonth.split("-").map(Number);
    const monthDate = new Date(monthParts[0], monthParts[1] - 1, 1, 12);
    const locale = window.financeLanguage?.() === "hi" ? "hi-IN" : "en-IN";
    const readyPrefix = window.financeTranslate?.("Starting budget estimate for")
      || "Starting budget estimate for";
    forecastStatus.textContent = readyPrefix + " "
      + monthDate.toLocaleDateString(locale, { month: "long", year: "numeric" }) + ".";
    forecastResults.hidden = false;
    forecastTotal.textContent = formatRupees(spendingForecast.total);
    forecastCategories.replaceChildren();
    forecastNoCategories.hidden = spendingForecast.categories.length > 0;

    if (Number.isFinite(plannerMonthlyIncome) && plannerMonthlyIncome > 0) {
      forecastIncome.textContent = formatRupees(plannerMonthlyIncome);
    }

    for (const item of spendingForecast.categories) {
      const row = document.createElement("li");
      const category = document.createElement("span");
      const amount = document.createElement("strong");
      category.textContent = item.category;
      amount.textContent = formatRupees(item.amount);
      const basis = document.createElement("small");
      const labels = {
        "synthetic-starter":"Synthetic starter estimate",
        "personal-blend":"Your history + synthetic starter",
        "personal-trend":"Your recorded spending trend",
        "recorded-amount":"Recorded amount carried forward",
        "planner-input":"Your monthly planner amount",
      };
      basis.textContent = window.financeTranslate?.(labels[item.source]) || labels[item.source];
      category.append(document.createElement("br"), basis);
      row.append(category, amount);
      forecastCategories.append(row);
    }
  }


  // Show totals, category bars, and the entry list for the selected month.
  function updateTracker() {
    const selectedMonth = monthInput.value || getCurrentMonth();
    monthInput.value = selectedMonth;
    syncClosedMonths();
    const summary = summarizeMonth(transactions, selectedMonth);

    const caption = root.querySelector("#category-summary-caption");
    if (caption) caption.textContent =
      `For ${new Date(`${selectedMonth}-01T12:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}.`;
    root.querySelector("#tracker-income").textContent = formatRupees(summary.totalIncome);
    root.querySelector("#tracker-expenses").textContent = formatRupees(summary.totalExpenses);
    root.querySelector("#tracker-balance").textContent = formatRupees(summary.monthlyBalance);
    root.querySelector("#tracker-balance").classList.toggle("warning", summary.monthlyBalance < 0);

    showCategoryBreakdown(summary);
    showTransactionList(selectedMonth, summary.entryCount);
    const spendingForecast = forecastNextMonthSpending(transactions, [...completedMonths], new Date(), plannerProfile);
    updateSpendingForecast(spendingForecast);
    root.dispatchEvent(new CustomEvent("finance-budget-summary", {
      detail: {
        ...summary,
        isComplete: false, // Calendar closure cannot verify that every expense was entered.
        isClosed: completedMonths.has(selectedMonth),
        ownerId: currentUserId,
        plannerMonthlyIncome,
        selectedMonth,
        nextMonthForecast: spendingForecast,
      },
    }));
  }


  // Make a short bar for each category so spending is easy to compare.
  function showCategoryBreakdown(summary) {
    const list = root.querySelector("#category-summary");
    if (!list) return;
    const emptyMessage = root.querySelector("#category-summary-empty");
    list.replaceChildren();
    emptyMessage.hidden = summary.categoryTotals.length > 0;

    for (const item of summary.categoryTotals) {
      const share = summary.totalExpenses === 0
        ? 0
        : item.amount / summary.totalExpenses * 100;
      const row = document.createElement("li");
      const line = document.createElement("div");
      const category = document.createElement("span");
      const amount = document.createElement("strong");
      const track = document.createElement("div");
      const fill = document.createElement("div");

      line.className = "category-line";
      category.textContent = item.category;
      amount.textContent = formatRupees(item.amount);
      line.append(category, amount);

      track.className = "category-track";
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-label", `${item.category} share of recorded expenses`);
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-valuenow", String(Math.round(share)));
      fill.className = "category-fill";
      fill.style.width = `${share}%`;
      track.append(fill);

      row.append(line, track);
      list.append(row);
    }
  }


  // Add a safe text-only row for each income or expense entry.
  function showTransactionList(selectedMonth, entryCount) {
    if (!transactionRows) return;
    const emptyMessage = root.querySelector("#transaction-empty");
    const tableWrap = root.querySelector("#transaction-table-wrap");
    const monthEntries = transactions
      .filter((item) => item.date.startsWith(selectedMonth))
      .sort((first, second) => second.date.localeCompare(first.date));

    transactionRows.replaceChildren();
    emptyMessage.hidden = entryCount > 0;
    tableWrap.hidden = entryCount === 0;
    root.querySelector("#transaction-count").textContent =
      `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`;

    for (const entry of monthEntries) {
      const row = document.createElement("tr");
      const dateCell = document.createElement("td");
      const categoryCell = document.createElement("td");
      const noteCell = document.createElement("td");
      const amountCell = document.createElement("td");
      const removeCell = document.createElement("td");
      const typeLabel = document.createElement("span");
      const removeButton = document.createElement("button");

      dateCell.textContent = new Date(`${entry.date}T12:00:00`).toLocaleDateString("en-IN");
      categoryCell.textContent = entry.category;
      typeLabel.className = "transaction-type-label";
      typeLabel.textContent = entry.type === "income" ? "Income" : "Expense";
      categoryCell.append(typeLabel);
      noteCell.textContent = entry.note || "—";
      amountCell.className = "amount-column";
      amountCell.textContent = `${entry.type === "income" ? "+" : "−"}${formatRupees(entry.amount)}`;

      removeButton.type = "button";
      removeButton.className = "transaction-delete";
      removeButton.dataset.entryId = entry.id;
      removeButton.setAttribute("aria-label", `Remove ${entry.category} entry from ${entry.date}`);
      removeButton.textContent = "Remove";
      removeCell.append(removeButton);

      row.append(dateCell, categoryCell, noteCell, amountCell, removeCell);
      transactionRows.append(row);
    }
  }


  // Read only the authenticated server account; never import a cached browser account.
  async function loadTransactions() {
    if (currentUserId === null) {
      return;
    }
    try {
      const accountData = await loadFinanceData();
      if (!scope.active) return;
      completedMonths = new Set(
        Array.isArray(accountData.completedMonths)
          ? accountData.completedMonths.filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month))
          : [],
      );
      plannerProfile = accountData.plannerProfile || null;
      dataLoaded = true;
      const savedIncome = Number(plannerProfile?.monthlyTakeHomeIncome);
      plannerMonthlyIncome = Number.isFinite(savedIncome) && savedIncome > 0 ? savedIncome : null;
      if (Object.hasOwn(accountData, "transactions")) {
        const savedEntries = accountData.transactions;
        transactions = Array.isArray(savedEntries)
          ? savedEntries.filter((entry) => validateTransaction(entry).isValid)
          : [];
        statusText.textContent = "Loaded your saved income and expenses from your account.";
        updateTracker();
        return;
      }

      // No automatic import of old browser copies: numeric IDs can be reused
      // after changing database installations. The server is the account source.
      transactions = [];
      updateTracker();
    } catch {
      statusText.textContent = "Your saved entries could not be synced. You can still add entries.";
    }
  }


  // Add one income or expense record.
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!dataLoaded) { showTransactionErrors(["Wait for your saved entries to load, then try again."]); return; }

    const entry = {
      id: makeEntryId(),
      type: typeInput.value,
      category: categoryInput.value,
      date: dateInput.value,
      amount: Number(root.querySelector("#transaction-amount").value),
      note: root.querySelector("#transaction-note").value.trim(),
    };

    const validation = validateTransaction(entry);
    showTransactionErrors(validation.errors);
    if (!validation.isValid) {
      return;
    }

    transactions.push(entry);
    const entryMonth = entry.date.slice(0, 7);
    monthInput.value = entryMonth;
    form.reset();
    categorySuggestion.hidden = true;
    suggestedCategory = null;
    typeInput.value = "expense";
    updateCategoryChoices();
    dateInput.value = getToday();
    updateTracker();
    saveTransactions();
  });


  // Show a clickable category hint when this note matches the user's history.
  function updateCategorySuggestion() {
    if (!categorySuggestion || !noteInput) return;
    suggestedCategory = null;
    categorySuggestion.hidden = true;

    if (!currentUserId || !noteInput.value.trim()) return;

    const result = categoryHelper.suggest(currentUserId, transactions, typeInput.value, noteInput.value);
    if (result.status !== "suggestion") return;

    const option = [...categoryInput.options]
      .find((item) => item.value === result.category);
    if (!option) return;

    suggestedCategory = result.category;
    categorySuggestionName.textContent = option.textContent;
    root.querySelector("#transaction-category-source").textContent = result.source === "personal-history"
      ? "Based on your own saved notes. Review before selecting."
      : "Suggested by a model trained on fictional example notes. Review before selecting.";
    categorySuggestion.hidden = false;
  }

  categorySuggestionButton?.addEventListener("click", () => {
    if (!suggestedCategory) return;

    categoryInput.value = suggestedCategory;
    categorySuggestion.hidden = true;
    suggestedCategory = null;
    categoryInput.focus();
  });

  // Update the category menu when the user chooses income or expense.
  typeInput?.addEventListener("change", () => {
    updateCategoryChoices();
    updateCategorySuggestion();
  });

  noteInput?.addEventListener("input", updateCategorySuggestion);
  scope.listen(window, "finance-language-change", () => {
    updateCategorySuggestion();
    updateSpendingForecast();
  });

  // Recalculate the totals when the user views a different month.
  monthInput.addEventListener("change", updateTracker);
  // Remove one selected entry from the list.
  transactionRows?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-entry-id]");
    if (!button) {
      return;
    }

    transactions = transactions.filter((entry) => entry.id !== button.dataset.entryId);
    updateCategorySuggestion();
    updateTracker();
    saveTransactions();
  });

  // Clear all account entries after the user confirms the action.
  root.querySelector("#clear-transactions")?.addEventListener("click", () => {
    if (!window.confirm("Clear all income and expense entries saved to your account?")) {
      return;
    }

    transactions = [];
    updateCategorySuggestion();
    updateTracker();
    saveTransactions();
  });


  mountBudgetDocuments(root, scope, user.id, {
    ready: () => dataLoaded && currentUserId !== null,
    entries: () => transactions,
    flush: () => failedTransactions ? saveTransactions(true) : Promise.resolve(),
    async add(entries) {
      if (!dataLoaded || !currentUserId) throw new Error("Wait for your saved entries to load, then try again.");
      const known = new Set(transactions.map(entry => entry.id));
      const next = [...transactions, ...entries.filter(entry => !known.has(entry.id))];
      if (next.length > 5000) throw new Error("Your budget can hold up to 5,000 entries. Export older entries before removing them.");
      transactions = next;
      monthInput.value = entries.at(-1).date.slice(0,7);
      updateTracker();
      await saveTransactions(true);
    },
  });

  // Start with today's date and month, then load account entries after sign-in.
  if (dateInput) dateInput.value = getToday();
  monthInput.value = getCurrentMonth();
  updateCategoryChoices();
  updateTracker();


  // Keep each signed-in user's budget history in their own account.
  scope.onReady( async (event) => {
    currentUserId = String(event.detail.id);
    transactions = [];
    completedMonths = new Set();
    plannerMonthlyIncome = null;
    await loadTransactions();
    if (!scope.active) return;
    updateCategorySuggestion();
    updateTracker();
  });


  scope.listen(window, "finance-user-logout", () => {
    currentUserId = null;
    transactions = [];
    completedMonths = new Set();
    plannerMonthlyIncome = null;
    updateCategorySuggestion();
    updateTracker();
  });

  scope.listen(window, "finance-planner-profile", (event) => {
    plannerProfile = event.detail || null;
    const income = Number(event.detail?.monthlyTakeHomeIncome);
    plannerMonthlyIncome = Number.isFinite(income) && income > 0 ? income : null;
    updateSpendingForecast();
  });
  // Retry failed writes before leaving; do not discard visible unsaved entries.
  scope.registerSave(async () => {
    if (failedTransactions) await saveTransactions(true);
    if (failedCompletedMonths) await saveCompletedMonths(true);
  });
  // A page left open across midnight closes yesterday's month automatically.
  let rolloverTimer;
  function scheduleRollover() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1);
    rolloverTimer = window.setTimeout(() => { updateTracker(); scheduleRollover(); }, midnight-now+100);
  }
  scheduleRollover();
  scope.listen(document, "visibilitychange", () => {
    if (document.visibilityState === "visible") updateTracker();
  });
  scope.onDispose(() => {
    currentUserId = null;
    plannerProfile = null;
    transactions = [];
    categoryHelper.dispose();
    window.clearTimeout(rolloverTimer);
  });
  return { ready: scope.start(user), dispose: scope.dispose };
}
