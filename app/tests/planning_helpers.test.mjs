import test from "node:test";
import assert from "node:assert/strict";
import {
  monthlySuggestions,
  selectAmountSuggestion,
  sumExpenseItems,
  upsertGoal,
} from "../js/planning_helpers.mjs";

test("expense items add to a rounded total and reject invalid inputs", () => {
  assert.equal(
    sumExpenseItems([
      { name: "Rent", amount: 10000 },
      { name: "Food", amount: 2000.25 },
    ]),
    12000.25,
  );
  for (const items of [
    [{ name: "", amount: 10 }],
    [{ name: "Food", amount: NaN }],
    [{ name: "Food", amount: -1 }],
    [{ name: "Food", amount: 10000001 }],
  ])
    assert.throws(() => sumExpenseItems(items));
});
test("history suggestions separate EMI and personal costs, never invent zeroes", () => {
  const e = (category, amount, type = "expense", date = "2026-10-01") => ({
    category,
    amount,
    type,
    date,
  });
  const result = monthlySuggestions(
    [
      e("Salary", 60000, "income"),
      e("Housing and rent", 12000),
      e("Loan EMI", 5000),
      e("Personal", 2000),
      e("Other", 700),
      e("Utilities", 1000, "expense", "2026-11-02"),
      e("Personal", 999, "expense", "2026-12-01"),
    ],
    new Date(2026, 10, 7),
  );
  assert.equal(result[0].current, true);
  assert.deepEqual(result[1].values, {
    monthlyTakeHomeIncome: 60000,
    monthlyEssentialExpenses: 12000,
    monthlyDebtPayment: 5000,
    monthlyDiscretionaryExpenses: 2000,
  });
  assert.equal(result[0].values.monthlyTakeHomeIncome, undefined);
});
test("editing updates only the selected goal; snapshots do not share references", () => {
  const profile = { includeGoal: true, goalType: "car", goalPrice: 100000, activeGoalId: "g1" };
  const first = upsertGoal([], "g1", "Car", profile, "2026-11-01");
  const two = upsertGoal(
    first,
    "g2",
    "Another car",
    { ...profile, goalPrice: 200000 },
    "2026-11-02",
  );
  const edited = upsertGoal(
    two,
    "g1",
    "Car edited",
    { ...profile, goalPrice: 150000 },
    "2026-11-03",
  );
  assert.equal(edited.length, 2);
  assert.equal(edited[1].profile.goalPrice, 200000);
  assert.equal(edited[0].createdAt, "2026-11-01");
  assert.equal(edited[0].updatedAt, "2026-11-03");
  assert.equal(first[0].profile.goalPrice, 100000);
  assert.equal(edited[0].profile.activeGoalId, undefined);
});

const hintDate = new Date(2026, 10, 7);
const record = (date, amount, category = "Salary", type = "income") => ({
  date,
  amount,
  category,
  type,
});

test("one hint prefers the newest past month over the partial current month", () => {
  const months = monthlySuggestions(
    [
      record("2026-09-03", 71000),
      record("2026-11-02", 100000),
      record("2026-10-01", 70000),
      record("2026-10-15", 1561.75),
    ],
    hintDate,
  );
  const hint = selectAmountSuggestion(months, "monthlyTakeHomeIncome");
  assert.equal(hint.month, "2026-10");
  assert.equal(hint.current, false);
  assert.equal(hint.values.monthlyTakeHomeIncome, 71561.75);
});

test("hint selection is per field and falls back to current month without inventing zero", () => {
  const months = monthlySuggestions(
    [
      record("2026-10-01", 60000),
      record("2026-11-02", 1250, "Food and groceries", "expense"),
      record("2026-09-04", 5000, "Loan EMI", "expense"),
      record("2026-11-06", 900, "Other", "expense"),
    ],
    hintDate,
  );
  assert.equal(selectAmountSuggestion(months, "monthlyTakeHomeIncome").month, "2026-10");
  assert.equal(selectAmountSuggestion(months, "monthlyEssentialExpenses").current, true);
  assert.equal(selectAmountSuggestion(months, "monthlyDebtPayment").month, "2026-09");
  assert.equal(selectAmountSuggestion(months, "monthlyDiscretionaryExpenses"), null);
  assert.equal(selectAmountSuggestion([], "monthlyTakeHomeIncome"), null);
});

test("future or invalid records cannot become the suggested amount", () => {
  const months = monthlySuggestions(
    [
      record("2026-12-02", 100000),
      record("invalid", 5000),
      record("2026-10-03", NaN),
      record("2026-10-04", -100),
    ],
    hintDate,
  );
  assert.equal(selectAmountSuggestion(months, "monthlyTakeHomeIncome"), null);
});
