import assert from "node:assert/strict";
import test from "node:test";

import { calculatePlan } from "../js/finance_calculations.mjs";
import {
  buildBudgetAdjustment,
  buildSavingsBudget,
  interpretConstraintMessage,
} from "../js/budget_recommendations.mjs";


function makeProfile(changes = {}) {
  return {
    monthlyTakeHomeIncome: 100000,
    monthlyEssentialExpenses: 40000,
    monthlyDiscretionaryExpenses: 10000,
    monthlyDebtPayment: 5000,
    householdSize: 4,
    dependents: 2,
    totalSavings: 300000,
    emergencyFund: 150000,
    goalSavings: 40000,
    emergencyFundMonths: 6,
    region: "Pune, Maharashtra",
    goalType: "car",
    goalPrice: 1200000,
    plannedDownPayment: 640000,
    monthsUntilGoal: 12,
    goalComfortPercent: 100,
    ...changes,
  };
}


function makeSummary(changes = {}) {
  return {
    categoryTotals: [
      { category: "Other", amount: 20000 },
      { category: "Personal", amount: 30000 },
      { category: "Loan EMI", amount: 5000 },
    ],
    isComplete: true,
    ...changes,
  };
}


test("uses complete monthly totals to show before and after amounts", () => {
  const profile = makeProfile();
  const baseline = calculatePlan(profile);
  const result = buildBudgetAdjustment(profile, baseline, makeSummary());

  assert.equal(result.requiredCut, 5000);
  assert.equal(result.totalCut, 5000);
  assert.deepEqual(result.cuts.map(({ category, proposedCut }) => [category, proposedCut]), [
    ["Other", 2000],
    ["Personal", 3000],
  ]);
  assert.equal(result.adjustedProfile.monthlyDebtPayment, profile.monthlyDebtPayment);
  assert.equal(result.afterPlan.goal.monthlySavingGap, 0);
  assert.equal(result.adjustedProfile.monthlyDiscretionaryExpenses, 5000);
});


test("does not invent itemized recommendations before the user confirms the month is complete", () => {
  const profile = makeProfile();
  const result = buildBudgetAdjustment(profile, calculatePlan(profile), makeSummary({ isComplete: false }));

  assert.equal(result.status, "needs-complete-month");
  assert.deepEqual(result.cuts, []);
  assert.equal(result.afterPlan.cashFlow.monthlySurplus, calculatePlan(profile).cashFlow.monthlySurplus);
});


test("respects a category the user says must stay fixed", () => {
  const profile = makeProfile();
  const result = buildBudgetAdjustment(profile, calculatePlan(profile), makeSummary(), {
    adjustableCategories: new Set(["Other", "Personal"]),
    lockedCategories: new Set(["Personal"]),
  });

  assert.deepEqual(result.cuts.map((cut) => cut.category), ["Other"]);
  assert.equal(result.cuts[0].proposedCut, 2000);
});


test("applies a stated cap to an essential category while protecting EMI", () => {
  const profile = makeProfile();
  const result = buildBudgetAdjustment(profile, calculatePlan(profile), makeSummary({
    categoryTotals: [
      { category: "Food and groceries", amount: 10000 },
      { category: "Loan EMI", amount: 5000 },
    ],
  }), {
    adjustableCategories: new Set(["Food and groceries", "Loan EMI"]),
    lockedCategories: new Set(),
    maximumCuts: new Map([["Food and groceries", 1200]]),
  });

  assert.deepEqual(result.cuts.map((cut) => [cut.category, cut.proposedCut]), [
    ["Food and groceries", 1200],
  ]);
  assert.equal(result.adjustedProfile.monthlyDebtPayment, profile.monthlyDebtPayment);
});


test("accounts for a monthly shortfall before estimating the spending cut needed", () => {
  const profile = makeProfile({ monthlyTakeHomeIncome: 50000, goalComfortPercent: 100 });
  const baseline = calculatePlan(profile);
  const result = buildBudgetAdjustment(profile, baseline, makeSummary());

  assert.equal(baseline.cashFlow.monthlyShortfall, 5000);
  assert.equal(result.requiredCut, 55000);
});


test("interprets fixed, adjustable, amount-limited, contextual, and EMI messages", () => {
  assert.deepEqual(interpretConstraintMessage("Groceries are fixed because of my family"), {
    type: "fixed",
    category: "Food and groceries",
  });
  assert.deepEqual(interpretConstraintMessage("I can reduce rent by ₹2,000"), {
    type: "adjustable",
    category: "Housing and rent",
    maximum: 2000,
  });
  assert.equal(interpretConstraintMessage("I can reduce rent by ₹0").maximum, 0);
  assert.equal(interpretConstraintMessage("I cannot reduce it", "Transport").category, "Transport");
  assert.equal(interpretConstraintMessage("I can reduce my EMI by ₹500").type, "protected");
});


test("understands common Hindi category limits in the budget chat", () => {
  assert.deepEqual(interpretConstraintMessage("किराना खर्च परिवार के कारण तय है"), {
    type: "fixed",
    category: "Food and groceries",
  });
  assert.deepEqual(interpretConstraintMessage("मैं यात्रा का खर्च ₹500 घटा सकता हूँ"), {
    type: "adjustable",
    category: "Transport",
    maximum: 500,
  });
  assert.equal(interpretConstraintMessage("मैं EMI कम कर सकता हूँ").type, "protected");
});


function makeSavingsSummary(changes = {}) {
  return {
    totalIncome: 100000,
    totalExpenses: 55000,
    categoryTotals: [
      { category: "Other", amount: 20000 },
      { category: "Personal", amount: 30000 },
      { category: "Loan EMI", amount: 5000 },
    ],
    isComplete: true,
    incomeEntryCount: 1,
    expenseEntryCount: 3,
    entryCount: 4,
    ...changes,
  };
}


test("offers a modest general savings plan without requiring a purchase goal", () => {
  const result = buildSavingsBudget(makeSavingsSummary());

  assert.equal(result.monthlySavingsTarget, 0);
  assert.equal(result.currentBalance, 45000);
  assert.equal(result.totalCut, 5000);
  assert.equal(result.afterBalance, 50000);
  assert.equal(result.availableToSave, 50000);
  assert.deepEqual(result.cuts.map(({ category, proposedCut, newAmount }) => [category, proposedCut, newAmount]), [
    ["Other", 2000, 18000],
    ["Personal", 3000, 27000],
  ]);
});


test("uses the personal trend forecast as the basis for next-month savings suggestions", () => {
  const result = buildSavingsBudget(makeSavingsSummary({
    selectedMonth: "2026-09",
    isComplete: true,
  }), 0, {
    nextMonthForecast: {
      status: "ready",
      targetMonth: "2026-10",
      historyMonths: ["2026-07", "2026-08", "2026-09"],
      total: 74000,
      categories: [
        { category: "Other", amount: 26000 },
        { category: "Personal", amount: 35000 },
        { category: "Transport", amount: 8000 },
        { category: "Loan EMI", amount: 5000 },
      ],
    },
  });

  assert.equal(result.modelUsed, true);
  assert.deepEqual(result.modelHistoryMonths, ["2026-07", "2026-08", "2026-09"]);
  assert.equal(result.currentBalance, 26000);
  assert.equal(result.totalCut, 6500);
  assert.equal(result.afterBalance, 32500);
  assert.deepEqual(result.cuts.map(({ category, currentAmount }) => [category, currentAmount]), [
    ["Personal", 35000],
    ["Other", 26000],
    ["Transport", 8000],
  ]);
});


test("uses recorded amounts when the trend model lacks a complete matching history", () => {
  const forecast = {
    status: "ready",
    targetMonth: "2026-10",
    historyMonths: ["2026-07", "2026-08", "2026-09"],
    total: 74000,
    categories: [{ category: "Personal", amount: 35000 }],
  };
  const incomplete = buildSavingsBudget(makeSavingsSummary({
    selectedMonth: "2026-09",
    isComplete: false,
  }), 0, { nextMonthForecast: forecast });
  const wrongMonth = buildSavingsBudget(makeSavingsSummary({
    selectedMonth: "2026-08",
    isComplete: true,
  }), 0, { nextMonthForecast: forecast });

  assert.equal(incomplete.modelUsed, false);
  assert.equal(incomplete.currentBalance, 45000);
  assert.equal(wrongMonth.modelUsed, false);
  assert.equal(wrongMonth.currentBalance, 45000);
});


test("keeps region as context without changing savings suggestions", () => {
  const pune = buildSavingsBudget(makeSavingsSummary(), 0, { region: "Pune, Maharashtra" });
  const delhi = buildSavingsBudget(makeSavingsSummary(), 0, { region: "Delhi" });
  const withoutRegion = ({ region, ...result }) => result;

  assert.equal(pune.region, "Pune, Maharashtra");
  assert.equal(delhi.region, "Delhi");
  assert.deepEqual(withoutRegion(pune), withoutRegion(delhi));
});


test("shows optional places to save more when the recorded balance already meets a target", () => {
  const result = buildSavingsBudget(makeSavingsSummary(), 40000);

  assert.equal(result.status, "already-on-track");
  assert.equal(result.totalCut, 5000);
  assert.equal(result.availableToSave, 50000);
  assert.equal(result.targetGap, 0);
  assert.deepEqual(result.cuts.map(({ category }) => category), ["Other", "Personal"]);
  assert.match(result.message, /Optional changes below could free/);
});


test("shows how much of a larger target remains after modest suggested cuts", () => {
  const result = buildSavingsBudget(makeSavingsSummary(), 60000);

  assert.equal(result.totalCut, 5000);
  assert.equal(result.availableToSave, 50000);
  assert.equal(result.targetGap, 10000);
  assert.equal(result.status, "target-shortfall");
});


test("shows a draft savings estimate before the user marks the month complete", () => {
  const result = buildSavingsBudget(makeSavingsSummary({ isComplete: false }));

  assert.equal(result.status, "starter-suggestions");
  assert.equal(result.isComplete, false);
  assert.equal(result.currentBalance, 45000);
  assert.ok(result.cuts.length > 0);
  assert.match(result.message, /^Draft based on entries so far:/);
  assert.match(result.message, /Missing categories are not treated as zero/);
});


test("asks for income and expenses instead of counting missing entries as zero", () => {
  const noIncome = buildSavingsBudget(makeSavingsSummary({ incomeEntryCount: 0 }));
  const noExpenses = buildSavingsBudget(makeSavingsSummary({ expenseEntryCount: 0 }));

  assert.equal(noIncome.status, "needs-income");
  assert.equal(noIncome.currentBalance, null);
  assert.equal(noExpenses.status, "needs-expenses");
  assert.equal(noExpenses.currentBalance, null);
});


test("suggests modest changes in selected categories but protects core bills and EMI", () => {
  const result = buildSavingsBudget(makeSavingsSummary({
    categoryTotals: [
      { category: "Food and groceries", amount: 10000 },
      { category: "Transport", amount: 10000 },
      { category: "Utilities", amount: 10000 },
      { category: "Housing and rent", amount: 20000 },
      { category: "Health", amount: 5000 },
      { category: "Loan EMI", amount: 5000 },
    ],
  }));

  assert.deepEqual(result.cuts.map(({ category }) => category), [
    "Transport", "Utilities", "Food and groceries",
  ]);
  assert.equal(result.totalCut, 1500);
});


test("respects fixed categories, user caps, and protects existing EMI", () => {
  const result = buildSavingsBudget(makeSavingsSummary({
    categoryTotals: [
      { category: "Food and groceries", amount: 10000 },
      { category: "Personal", amount: 30000 },
      { category: "Loan EMI", amount: 5000 },
    ],
  }), 50000, {
    adjustableCategories: new Set(["Food and groceries", "Loan EMI", "Personal"]),
    lockedCategories: new Set(["Personal"]),
    maximumCuts: new Map([["Food and groceries", 1200]]),
  });

  assert.deepEqual(result.cuts.map(({ category, proposedCut }) => [category, proposedCut]), [
    ["Food and groceries", 1200],
  ]);
});


test("rejects a negative monthly savings target", () => {
  assert.throws(() => buildSavingsBudget(makeSavingsSummary(), -1), RangeError);
});
