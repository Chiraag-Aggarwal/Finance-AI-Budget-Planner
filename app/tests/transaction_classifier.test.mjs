import assert from "node:assert/strict";
import test from "node:test";

import { suggestCategoryFromHistory } from "../js/transaction_classifier.mjs";

function makeHistory() {
  return [
    ["expense", "Food and groceries", "weekly groceries rice vegetables"],
    ["expense", "Food and groceries", "market groceries fruit vegetables"],
    ["expense", "Food and groceries", "monthly groceries and staples"],
    ["expense", "Food and groceries", "grocery shop milk and bread"],
    ["expense", "Transport", "metro card monthly recharge"],
    ["expense", "Transport", "bus pass commute recharge"],
    ["expense", "Transport", "taxi ride to office"],
    ["expense", "Transport", "train fare commute"],
  ].map(([type, category, note], index) => ({
    id: "history-" + index,
    type,
    category,
    note,
  }));
}

test("suggests a familiar category from the signed-in user's own notes", () => {
  const result = suggestCategoryFromHistory(
    makeHistory(),
    "expense",
    "weekly groceries rice",
  );
  assert.deepEqual(result, { status: "suggestion", category: "Food and groceries" });
});

test("stays quiet when there are too few examples or no close match", () => {
  assert.equal(
    suggestCategoryFromHistory(makeHistory().slice(0, 4), "expense", "weekly groceries").status,
    "not-enough-history",
  );
  assert.equal(
    suggestCategoryFromHistory(makeHistory(), "expense", "dentist appointment").status,
    "no-close-match",
  );
});

test("does not mix income notes into expense suggestions", () => {
  const allEntries = makeHistory();
  allEntries.push(
    ...makeHistory().slice(0, 4).map((entry) => ({
      ...entry,
      id: "income-" + entry.id,
      type: "income",
      category: "Salary",
    })),
  );
  assert.equal(
    suggestCategoryFromHistory(allEntries, "income", "weekly groceries rice").status,
    "not-enough-history",
  );
});
