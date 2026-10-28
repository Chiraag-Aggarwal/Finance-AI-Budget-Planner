import assert from "node:assert/strict";
import test from "node:test";

import { summarizeMonth, validateTransaction } from "../js/budget_tracker.mjs";


function makeTransaction(changes = {}) {
  return {
    id: "entry-1",
    type: "expense",
    category: "Food and groceries",
    date: "2026-10-05",
    amount: 1250,
    note: "Weekly groceries",
    ...changes,
  };
}


test("accepts a valid income or expense entry", () => {
  assert.equal(validateTransaction(makeTransaction()).isValid, true);
  assert.equal(
    validateTransaction(
      makeTransaction({ type: "income", category: "Salary", amount: 50000 })
    ).isValid,
    true
  );
});


test("rejects a negative amount, impossible date, and mismatched category", () => {
  const result = validateTransaction(
    makeTransaction({
      amount: -50,
      date: "2026-02-30",
      category: "Salary",
    })
  );

  assert.equal(result.isValid, false);
  assert.equal(result.errors.length, 3);
});


test("summarizes one month and leaves other months out", () => {
  const entries = [
    makeTransaction({ id: "1", amount: 1200 }),
    makeTransaction({ id: "2", category: "Transport", amount: 800 }),
    makeTransaction({
      id: "3",
      type: "income",
      category: "Salary",
      amount: 50000,
    }),
    makeTransaction({ id: "4", date: "2026-09-30", amount: 9999 }),
  ];

  const summary = summarizeMonth(entries, "2026-10");

  assert.equal(summary.entryCount, 3);
  assert.equal(summary.incomeEntryCount, 1);
  assert.equal(summary.expenseEntryCount, 2);
  assert.equal(summary.totalIncome, 50000);
  assert.equal(summary.totalExpenses, 2000);
  assert.equal(summary.monthlyBalance, 48000);
  assert.deepEqual(summary.categoryTotals, [
    { category: "Food and groceries", amount: 1200 },
    { category: "Transport", amount: 800 },
  ]);
});


test("returns zero totals when there are no entries for the month", () => {
  const summary = summarizeMonth([], "2026-10");

  assert.equal(summary.totalIncome, 0);
  assert.equal(summary.incomeEntryCount, 0);
  assert.equal(summary.expenseEntryCount, 0);
  assert.equal(summary.totalExpenses, 0);
  assert.equal(summary.monthlyBalance, 0);
  assert.deepEqual(summary.categoryTotals, []);
});


test("rejects an invalid month format", () => {
  assert.throws(() => summarizeMonth([], "October 2026"), /YYYY-MM format/);
});
