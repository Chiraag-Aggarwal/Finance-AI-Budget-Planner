import { summarizeMonth, TRANSACTION_CATEGORIES, validateTransaction } from "./budget_tracker.mjs";


// This key is used only in this browser. It is not sent to a server.
const TRANSACTIONS_KEY_PREFIX = "finance-ai-monthly-entries-v1";

const form = document.querySelector("#transaction-form");
const typeInput = document.querySelector("#transaction-type");
const categoryInput = document.querySelector("#transaction-category");
const dateInput = document.querySelector("#transaction-date");
const monthInput = document.querySelector("#budget-month");
const saveInput = document.querySelector("#save-transactions");
const completeMonthInput = document.querySelector("#budget-complete-month");
const statusText = document.querySelector("#tracker-status");
const errorBox = document.querySelector("#transaction-errors");
const errorList = document.querySelector("#transaction-error-list");
const transactionRows = document.querySelector("#transaction-rows");

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

// Entries are kept here while the page is open.
let transactions = [];
let currentUserId = null;


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


// Save entries only when the user has selected the save option.
function saveTransactions() {
  if (currentUserId === null) {
    return;
  }
  if (!saveInput.checked) {
    statusText.textContent = "Entries are only in this page and will clear when it closes.";
    return;
  }

  try {
    window.localStorage.setItem(getTransactionsKey(), JSON.stringify(transactions));
    statusText.textContent = "Entries saved in this browser on this device.";
  } catch {
    statusText.textContent = "The browser could not save entries. They remain here until the page closes.";
  }
}


// Show totals, category bars, and the entry list for the selected month.
function updateTracker() {
  const selectedMonth = monthInput.value || getCurrentMonth();
  monthInput.value = selectedMonth;
  const summary = summarizeMonth(transactions, selectedMonth);

  document.querySelector("#category-summary-caption").textContent =
    `For ${new Date(`${selectedMonth}-01T12:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}.`;
  document.querySelector("#tracker-income").textContent = formatRupees(summary.totalIncome);
  document.querySelector("#tracker-expenses").textContent = formatRupees(summary.totalExpenses);
  document.querySelector("#tracker-balance").textContent = formatRupees(summary.monthlyBalance);
  document.querySelector("#tracker-balance").classList.toggle("warning", summary.monthlyBalance < 0);

  showCategoryBreakdown(summary);
  showTransactionList(selectedMonth, summary.entryCount);
  window.dispatchEvent(new CustomEvent("finance-budget-summary", {
    detail: { ...summary, isComplete: completeMonthInput.checked },
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


// Read stored entries, but ignore any damaged or outdated rows.
function loadTransactions() {
  if (currentUserId === null) {
    return;
  }
  try {
    const savedText = window.localStorage.getItem(getTransactionsKey());
    if (!savedText) {
      return;
    }

    const savedEntries = JSON.parse(savedText);
    if (!Array.isArray(savedEntries)) {
      return;
    }

    transactions = savedEntries.filter((entry) => validateTransaction(entry).isValid);
    saveInput.checked = true;
    statusText.textContent = "Loaded saved entries from this browser.";
  } catch {
    statusText.textContent = "Saved entries could not be loaded from this browser.";
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
  monthInput.value = entry.date.slice(0, 7);
  completeMonthInput.checked = false;
  form.reset();
  typeInput.value = "expense";
  updateCategoryChoices();
  dateInput.value = getToday();
  updateTracker();
  saveTransactions();
});


// Update the category menu when the user chooses income or expense.
typeInput.addEventListener("change", updateCategoryChoices);

// Recalculate the totals when the user views a different month.
monthInput.addEventListener("change", () => {
  // A different month needs its own completeness confirmation.
  completeMonthInput.checked = false;
  updateTracker();
});
completeMonthInput.addEventListener("change", updateTracker);

// Save existing entries when the user opts in. Opting out removes the saved copy.
saveInput.addEventListener("change", () => {
  if (saveInput.checked) {
    saveTransactions();
    return;
  }

  try {
    if (currentUserId !== null) {
      window.localStorage.removeItem(getTransactionsKey());
    }
    statusText.textContent = "Saved entries removed. Current entries will clear when this page closes.";
  } catch {
    statusText.textContent = "The browser could not remove its saved entries.";
  }
});

// Remove one selected entry from the list.
transactionRows.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-entry-id]");
  if (!button) {
    return;
  }

  transactions = transactions.filter((entry) => entry.id !== button.dataset.entryId);
  completeMonthInput.checked = false;
  updateTracker();
  saveTransactions();
});

// Clear all entries after the user confirms the action.
document.querySelector("#clear-transactions").addEventListener("click", () => {
  if (!window.confirm("Clear all income and expense entries saved in this browser?")) {
    return;
  }

  transactions = [];
  completeMonthInput.checked = false;
  try {
    if (currentUserId !== null) {
      window.localStorage.removeItem(getTransactionsKey());
    }
    statusText.textContent = "All transaction entries were cleared from this browser.";
  } catch {
    statusText.textContent = "Entries were cleared from this page, but browser storage could not be accessed.";
  }

  saveInput.checked = false;
  updateTracker();
});


// Start with today's date and month, then load any entries the user saved earlier.
dateInput.value = getToday();
monthInput.value = getCurrentMonth();
updateCategoryChoices();
updateTracker();


// Keep each signed-in user's budget history separate in this browser.
window.addEventListener("finance-user-ready", (event) => {
  currentUserId = String(event.detail.id);
  transactions = [];
  saveInput.checked = false;
  loadTransactions();
  updateTracker();
});


window.addEventListener("finance-user-logout", () => {
  currentUserId = null;
  transactions = [];
  saveInput.checked = false;
  completeMonthInput.checked = false;
  updateTracker();
});
