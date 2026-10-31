import { summarizeMonth, TRANSACTION_CATEGORIES, validateTransaction } from "./budget_tracker.mjs";
import { suggestCategoryFromHistory } from "./transaction_classifier.mjs";
import { forecastNextMonthSpending } from "./budget_forecast.mjs";
import { loadFinanceData, saveFinanceDataField } from "./finance_data.mjs";


// This key is used only to import entries saved by an older browser-only version.
const TRANSACTIONS_KEY_PREFIX = "finance-ai-monthly-entries-v1";

const form = document.querySelector("#transaction-form");
const typeInput = document.querySelector("#transaction-type");
const categoryInput = document.querySelector("#transaction-category");
const dateInput = document.querySelector("#transaction-date");
const noteInput = document.querySelector("#transaction-note");
const categorySuggestion = document.querySelector("#transaction-category-suggestion");
const categorySuggestionButton = document.querySelector("#use-transaction-category-suggestion");
const categorySuggestionName = document.querySelector("#transaction-category-suggestion-name");
let suggestedCategory = null;
const monthInput = document.querySelector("#budget-month");
const completeMonthInput = document.querySelector("#budget-complete-month");
const statusText = document.querySelector("#tracker-status");
const errorBox = document.querySelector("#transaction-errors");
const errorList = document.querySelector("#transaction-error-list");
const transactionRows = document.querySelector("#transaction-rows");
const forecastStatus = document.querySelector("#spending-forecast-status");
const forecastResults = document.querySelector("#spending-forecast-results");
const forecastTotal = document.querySelector("#spending-forecast-total");
const forecastCategories = document.querySelector("#spending-forecast-categories");
const forecastNoCategories = document.querySelector("#spending-forecast-no-categories");
const forecastIncomeCard = document.querySelector("#spending-forecast-income-card");
const forecastIncome = document.querySelector("#spending-forecast-income");

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


function getTransactionsKey() {
  return `${TRANSACTIONS_KEY_PREFIX}-${currentUserId}`;
}


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
async function saveTransactions() {
  if (currentUserId === null) return;

  try {
    await saveFinanceDataField("transactions", transactions);
  } catch (error) {
    console.error("Finance AI transaction save failed.", error);
  }
}

async function saveCompletedMonths() {
  if (currentUserId === null) return;
  try {
    await saveFinanceDataField("completedMonths", [...completedMonths].sort());
  } catch (error) {
    console.error("Finance AI completed-month save failed.", error);
  }
}


// Show the personal forecast and the saved take-home income for context.
function updateSpendingForecast(forecast = null) {
  forecastResults.hidden = true;
  forecastIncomeCard.hidden = !Number.isFinite(plannerMonthlyIncome) || plannerMonthlyIncome <= 0;

  if (currentUserId === null) {
    forecastStatus.textContent = "Sign in to build a forecast from your saved budget history.";
    return;
  }

  const spendingForecast = forecast ?? forecastNextMonthSpending(transactions, [...completedMonths], new Date());
  if (spendingForecast.status === "needs-recent-month") {
    forecastStatus.textContent = "Complete a recent month to refresh your forecast.";
    return;
  }
  if (spendingForecast.status === "needs-more-history") {
    forecastStatus.textContent = "Mark 3 consecutive recent months complete to get a personal forecast. Missing months are not assumed to be zero.";
    return;
  }

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
    row.append(category, amount);
    forecastCategories.append(row);
  }
}


// Show totals, category bars, and the entry list for the selected month.
function updateTracker() {
  const selectedMonth = monthInput.value || getCurrentMonth();
  monthInput.value = selectedMonth;
  completeMonthInput.disabled = currentUserId === null || selectedMonth > getCurrentMonth();
  completeMonthInput.checked = completedMonths.has(selectedMonth);
  const summary = summarizeMonth(transactions, selectedMonth);

  document.querySelector("#category-summary-caption").textContent =
    `For ${new Date(`${selectedMonth}-01T12:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}.`;
  document.querySelector("#tracker-income").textContent = formatRupees(summary.totalIncome);
  document.querySelector("#tracker-expenses").textContent = formatRupees(summary.totalExpenses);
  document.querySelector("#tracker-balance").textContent = formatRupees(summary.monthlyBalance);
  document.querySelector("#tracker-balance").classList.toggle("warning", summary.monthlyBalance < 0);

  showCategoryBreakdown(summary);
  showTransactionList(selectedMonth, summary.entryCount);
  const spendingForecast = forecastNextMonthSpending(transactions, [...completedMonths], new Date());
  updateSpendingForecast(spendingForecast);
  window.dispatchEvent(new CustomEvent("finance-budget-summary", {
    detail: {
      ...summary,
      isComplete: completeMonthInput.checked,
      selectedMonth,
      nextMonthForecast: spendingForecast,
    },
  }));
}


// Make a short bar for each category so spending is easy to compare.
function showCategoryBreakdown(summary) {
  const list = document.querySelector("#category-summary");
  const emptyMessage = document.querySelector("#category-summary-empty");
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
  const emptyMessage = document.querySelector("#transaction-empty");
  const tableWrap = document.querySelector("#transaction-table-wrap");
  const monthEntries = transactions
    .filter((item) => item.date.startsWith(selectedMonth))
    .sort((first, second) => second.date.localeCompare(first.date));

  transactionRows.replaceChildren();
  emptyMessage.hidden = entryCount > 0;
  tableWrap.hidden = entryCount === 0;
  document.querySelector("#transaction-count").textContent =
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


// Read account entries first, then import old browser-only entries if needed.
async function loadTransactions() {
  if (currentUserId === null) {
    return;
  }
  try {
    const accountData = await loadFinanceData();
    completedMonths = new Set(
      Array.isArray(accountData.completedMonths)
        ? accountData.completedMonths.filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month))
        : [],
    );
    const savedIncome = Number(accountData.plannerProfile?.monthlyTakeHomeIncome);
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

    const savedText = window.localStorage.getItem(getTransactionsKey());
    if (!savedText) return;
    const savedEntries = JSON.parse(savedText);
    if (!Array.isArray(savedEntries)) {
      return;
    }

    transactions = savedEntries.filter((entry) => validateTransaction(entry).isValid);
    await saveFinanceDataField("transactions", transactions);
    window.localStorage.removeItem(getTransactionsKey());
    statusText.textContent = "Your previous income and expense entries were moved to your account.";
    updateTracker();
  } catch {
    statusText.textContent = "Your saved entries could not be synced. You can still add entries.";
  }
}


// Add one income or expense record.
form.addEventListener("submit", (event) => {
  event.preventDefault();

  const entry = {
    id: makeEntryId(),
    type: typeInput.value,
    category: categoryInput.value,
    date: dateInput.value,
    amount: Number(document.querySelector("#transaction-amount").value),
    note: document.querySelector("#transaction-note").value.trim(),
  };

  const validation = validateTransaction(entry);
  showTransactionErrors(validation.errors);
  if (!validation.isValid) {
    return;
  }

  transactions.push(entry);
  const entryMonth = entry.date.slice(0, 7);
  const wasComplete = completedMonths.delete(entryMonth);
  monthInput.value = entryMonth;
  completeMonthInput.checked = false;
  form.reset();
  categorySuggestion.hidden = true;
  suggestedCategory = null;
  typeInput.value = "expense";
  updateCategoryChoices();
  dateInput.value = getToday();
  updateTracker();
  saveTransactions();
  if (wasComplete) saveCompletedMonths();
});


// Show a clickable category hint when this note matches the user's history.
function updateCategorySuggestion() {
  suggestedCategory = null;
  categorySuggestion.hidden = true;

  if (!currentUserId || !noteInput.value.trim()) return;

  const result = suggestCategoryFromHistory(transactions, typeInput.value, noteInput.value);
  if (result.status !== "suggestion") return;

  const option = [...categoryInput.options]
    .find((item) => item.value === result.category);
  if (!option) return;

  suggestedCategory = result.category;
  categorySuggestionName.textContent = option.textContent;
  categorySuggestion.hidden = false;
}

categorySuggestionButton.addEventListener("click", () => {
  if (!suggestedCategory) return;

  categoryInput.value = suggestedCategory;
  categorySuggestion.hidden = true;
  suggestedCategory = null;
  categoryInput.focus();
});

// Update the category menu when the user chooses income or expense.
typeInput.addEventListener("change", () => {
  updateCategoryChoices();
  updateCategorySuggestion();
});

noteInput.addEventListener("input", updateCategorySuggestion);
window.addEventListener("finance-language-change", () => {
  updateCategorySuggestion();
  updateSpendingForecast();
});

// Recalculate the totals when the user views a different month.
monthInput.addEventListener("change", updateTracker);
completeMonthInput.addEventListener("change", () => {
  const selectedMonth = monthInput.value || getCurrentMonth();
  if (completeMonthInput.checked) {
    completedMonths.add(selectedMonth);
  } else {
    completedMonths.delete(selectedMonth);
  }
  updateTracker();
  saveCompletedMonths();
});



// Remove one selected entry from the list.
transactionRows.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-entry-id]");
  if (!button) {
    return;
  }

  const removedEntry = transactions.find((entry) => entry.id === button.dataset.entryId);
  transactions = transactions.filter((entry) => entry.id !== button.dataset.entryId);
  updateCategorySuggestion();
  const wasComplete = removedEntry && completedMonths.delete(removedEntry.date.slice(0, 7));
  updateTracker();
  saveTransactions();
  if (wasComplete) saveCompletedMonths();
});

// Clear all account entries after the user confirms the action.
document.querySelector("#clear-transactions").addEventListener("click", () => {
  if (!window.confirm("Clear all income and expense entries saved to your account?")) {
    return;
  }

  transactions = [];
  completedMonths.clear();
  updateCategorySuggestion();
  updateTracker();
  saveTransactions();
  saveCompletedMonths();
});


// Start with today's date and month, then load account entries after sign-in.
dateInput.value = getToday();
monthInput.value = getCurrentMonth();
updateCategoryChoices();
updateTracker();


// Keep each signed-in user's budget history in their own account.
window.addEventListener("finance-user-ready", async (event) => {
  currentUserId = String(event.detail.id);
  transactions = [];
  completedMonths = new Set();
  plannerMonthlyIncome = null;
  await loadTransactions();
  updateCategorySuggestion();
  updateTracker();
});


window.addEventListener("finance-user-logout", () => {
  currentUserId = null;
  transactions = [];
  completedMonths = new Set();
  plannerMonthlyIncome = null;
  updateCategorySuggestion();
  updateTracker();
});

window.addEventListener("finance-planner-profile", (event) => {
  const income = Number(event.detail?.monthlyTakeHomeIncome);
  plannerMonthlyIncome = Number.isFinite(income) && income > 0 ? income : null;
  updateSpendingForecast();
});
