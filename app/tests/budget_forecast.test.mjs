import assert from "node:assert/strict";
import test from "node:test";

import { forecastNextMonthSpending } from "../js/budget_forecast.mjs";

const now = new Date(2026, 9, 31, 12);

function expense(month, category, amount, id = month + "-" + category) {
  return {
    id,
    type: "expense",
    category,
    date: month + "-15",
    amount,
  };
}

test("forecasts category totals from three consecutive completed cash-spending months", () => {
  const entries = [
    expense("2026-07", "Food and groceries", 10000),
    expense("2026-08", "Food and groceries", 11000),
    expense("2026-09", "Food and groceries", 12000),
    expense("2026-07", "Transport", 3000),
    expense("2026-08", "Transport", 3000),
    expense("2026-09", "Transport", 3000),
    expense("2026-09", "Salary", 100000),
  ];
  const result = forecastNextMonthSpending(
    entries,
    ["2026-07", "2026-08", "2026-09"],
    now,
  );

  assert.equal(result.status, "ready");
  assert.equal(result.targetMonth, "2026-11");
  assert.deepEqual(result.historyMonths, ["2026-07", "2026-08", "2026-09"]);
  assert.equal(result.categories.find((item) => item.category === "Food and groceries").amount, 12500);
  assert.equal(result.categories.find((item) => item.category === "Transport").amount, 3000);
  assert.equal(result.total, 15500);
});

test("requires a recent unbroken run of three complete months", () => {
  assert.equal(
    forecastNextMonthSpending([], ["2026-06", "2026-07", "2026-08"], now).status,
    "needs-recent-month",
  );
  assert.equal(
    forecastNextMonthSpending([], ["2026-08", "2026-09"], now).status,
    "needs-more-history",
  );
  assert.equal(
    forecastNextMonthSpending([], ["2026-07", "2026-09", "2026-10"], now).status,
    "needs-more-history",
  );
});

test("counts a missing category as zero only in a confirmed complete month", () => {
  const result = forecastNextMonthSpending([
    expense("2026-07", "Transport", 4000),
    expense("2026-09", "Transport", 2000),
  ], ["2026-07", "2026-08", "2026-09"], now);

  assert.equal(result.status, "ready");
  assert.equal(result.categories[0].category, "Transport");
  assert.ok(result.categories[0].amount > 0);
});

test("ignores unconfirmed-month transactions, income, invalid categories and future confirmations", () => {
  const result = forecastNextMonthSpending([
    expense("2026-07", "Food and groceries", 5000),
    expense("2026-08", "Food and groceries", 5000),
    expense("2026-09", "Food and groceries", 5000),
    expense("2026-09", "Salary", 90000),
    expense("2026-10", "Food and groceries", 100000),
  ], ["2026-07", "2026-08", "2026-09", "2026-12"], now);

  assert.equal(result.status, "ready");
  assert.equal(result.total, 5000);
});

test("returns a zero estimate when the user confirms months with no expenses", () => {
  const result = forecastNextMonthSpending([], ["2026-08", "2026-09", "2026-10"], now);
  assert.deepEqual(result, {
    status: "ready",
    targetMonth: "2026-11",
    historyMonths: ["2026-08", "2026-09", "2026-10"],
    total: 0,
    categories: [],
  });
});
