/*
  Simple helpers for the monthly income and expense tracker.

  This file does not connect to a bank. It checks entries and adds up the
  entries the user has typed into the website.
*/

export const TRANSACTION_CATEGORIES = {
  income: ["Salary", "Business income", "Other income"],
  expense: [
    "Food and groceries",
    "Housing and rent",
    "Utilities",
    "Transport",
    "Health",
    "Education",
    "Loan EMI",
    "Family support",
    "Personal",
    "Other",
  ],
};


// Check a single entry before adding or saving it.
export function validateTransaction(transaction) {
  const errors = [];

  if (transaction === null || typeof transaction !== "object") {
    return { isValid: false, errors: ["Enter a transaction."] };
  }

  if (typeof transaction.id !== "string" || transaction.id.length === 0) {
    errors.push("The entry needs an ID so it can be removed later.");
  }

  if (!Object.hasOwn(TRANSACTION_CATEGORIES, transaction.type)) {
    errors.push("Choose income or expense.");
  } else if (!TRANSACTION_CATEGORIES[transaction.type].includes(transaction.category)) {
    errors.push("Choose a category that matches the entry type.");
  }

  // Expect a real calendar date written as YYYY-MM-DD.
  if (typeof transaction.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(transaction.date)) {
    errors.push("Choose a valid date.");
  } else {
    const [year, month, day] = transaction.date.split("-").map(Number);
    const dateCheck = new Date(Date.UTC(year, month - 1, day));
    const isRealDate = dateCheck.getUTCFullYear() === year
      && dateCheck.getUTCMonth() === month - 1
      && dateCheck.getUTCDate() === day;
    if (!isRealDate) {
      errors.push("Choose a real calendar date.");
    }
  }

  if (!Number.isFinite(transaction.amount) || transaction.amount <= 0) {
    errors.push("Amount must be more than zero.");
  }

  if (transaction.note !== undefined && typeof transaction.note !== "string") {
    errors.push("The note must be text.");
  } else if ((transaction.note ?? "").length > 80) {
    errors.push("Keep the note to 80 characters or fewer.");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}


// Add up entries for one month and group spending by its category.
export function summarizeMonth(transactions, month) {
  if (!Array.isArray(transactions)) {
    throw new TypeError("Transactions must be a list.");
  }

  if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
    throw new RangeError("Month must use the YYYY-MM format.");
  }

  const monthEntries = transactions.filter((transaction) => transaction.date.startsWith(month));
  let totalIncome = 0;
  let totalExpenses = 0;
  let incomeEntryCount = 0;
  let expenseEntryCount = 0;
  const spendingByCategory = {};

  for (const transaction of monthEntries) {
    if (transaction.type === "income") {
      totalIncome += transaction.amount;
      incomeEntryCount += 1;
    } else if (transaction.type === "expense") {
      totalExpenses += transaction.amount;
      expenseEntryCount += 1;
      const category = transaction.category;
      spendingByCategory[category] = (spendingByCategory[category] ?? 0) + transaction.amount;
    }
  }

  const categoryTotals = Object.entries(spendingByCategory)
    .map(([category, amount]) => ({ category, amount }))
    .sort((first, second) => second.amount - first.amount);

  return {
    month,
    entryCount: monthEntries.length,
    incomeEntryCount,
    expenseEntryCount,
    totalIncome,
    totalExpenses,
    monthlyBalance: totalIncome - totalExpenses,
    categoryTotals,
  };
}
