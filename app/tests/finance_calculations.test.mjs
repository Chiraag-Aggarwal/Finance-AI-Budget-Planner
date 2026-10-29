import assert from "node:assert/strict";
import test from "node:test";

import { calculateLoanEmi, calculatePlan, LOAN_TERMS_BY_GOAL, validateProfile } from "../js/finance_calculations.mjs";


// Use one complete example profile and change only the values a test needs.
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
    includeGoal: true,
    goalSavings: 40000,
    emergencyFundMonths: 6,
    region: "Pune, Maharashtra",
    goalType: "car",
    goalPrice: 1200000,
    plannedDownPayment: 240000,
    monthsUntilGoal: 12,
    goalComfortPercent: 50,
    considerLoan: false,
    loanRatePercent: null,
    maxComfortableNewEmi: null,
    preferredLoanTermMonths: null,
    ...changes,
  };
}


test("calculates monthly surplus, emergency target, and goal savings", () => {
  const plan = calculatePlan(makeProfile());

  assert.equal(plan.cashFlow.monthlyOutgoings, 55000);
  assert.equal(plan.cashFlow.monthlySurplus, 45000);
  assert.equal(plan.emergencyFund.target, 270000);
  assert.equal(plan.emergencyFund.gap, 120000);
  assert.equal(plan.goal.remainingDownPayment, 200000);
  assert.equal(plan.goal.requiredMonthlySaving, 200000 / 12);
  assert.equal(plan.goal.comfortableMonthlySaving, 22500);
  assert.equal(plan.goal.fitsChosenMonthlyAmount, true);
});


test("counts the current EMI before estimating goal savings", () => {
  const withoutEmi = calculatePlan(makeProfile({ monthlyDebtPayment: 0 }));
  const withEmi = calculatePlan(makeProfile({ monthlyDebtPayment: 5000 }));

  assert.equal(withoutEmi.cashFlow.monthlySurplus, 50000);
  assert.equal(withEmi.cashFlow.monthlySurplus, 45000);
  assert.equal(withEmi.goal.comfortableMonthlySaving, 22500);
  assert.equal(withEmi.emergencyFund.target, 270000);
  assert.equal(withEmi.goal.scenarios[2].monthlySaving, 45000);
  assert.equal(withoutEmi.goal.scenarios[2].monthlySaving, 50000);
});


test("compares down-payment and full cash-purchase timelines", () => {
  const plan = calculatePlan(makeProfile());

  assert.equal(plan.goal.remainingFullPrice, 1160000);
  assert.equal(plan.goal.requiredMonthlyFullPriceSaving, 1160000 / 12);
  assert.equal(plan.goal.savingsByDeadline, 310000);
  assert.equal(plan.goal.downPaymentShortfallAtDeadline, 0);
  assert.equal(plan.goal.fullPriceShortfallAtDeadline, 890000);
  assert.equal(plan.goal.monthsToFullCashAtChosenPace, 52);
  assert.equal(plan.goal.cashPurchaseFitsChosenTimeline, false);
});


test("compares cautious, selected, and all-surplus goal scenarios", () => {
  const plan = calculatePlan(makeProfile());

  assert.deepEqual(
    plan.goal.scenarios.map((scenario) => scenario.monthlySaving),
    [11250, 22500, 45000]
  );
  assert.deepEqual(
    plan.goal.scenarios.map((scenario) => scenario.monthsToDownPayment),
    [18, 9, 5]
  );
  assert.deepEqual(
    plan.goal.scenarios.map((scenario) => scenario.monthsToFullCashPurchase),
    [104, 52, 26]
  );
});


test("calculates EMI with an entered annual rate and handles zero interest", () => {
  assert.equal(calculateLoanEmi(120000, 0, 12), 10000);
  const emi = calculateLoanEmi(960000, 10, 60);
  assert.ok(emi > 20000 && emi < 21000);
  assert.throws(() => calculateLoanEmi(-1, 10, 60), RangeError);
});


test("recommends the shortest illustrated car term within the comfort limit", () => {
  const plan = calculatePlan(makeProfile({ considerLoan: true, loanRatePercent: 10 }));

  assert.equal(plan.loan.loanAmount, 960000);
  assert.equal(plan.loan.comfortableEmiLimit, 22500);
  assert.equal(plan.loan.status, "affordable-option");
  assert.equal(plan.loan.recommendation.months, 60);
  assert.equal(plan.goal.monthsToPurchaseAtChosenPace, 12);
  assert.equal(plan.goal.monthsToCompleteWithRecommendedLoan, 72);
  assert.ok(plan.loan.recommendation.emi <= plan.loan.comfortableEmiLimit);
  assert.ok(plan.loan.recommendation.totalInterest > 0);
  assert.deepEqual(plan.loan.scenarios.map((item) => item.months), [36, 60, 84]);
});


test("includes extra saving time when the planned down payment takes longer than the target date", () => {
  const plan = calculatePlan(makeProfile({
    considerLoan: true,
    loanRatePercent: 10,
    monthsUntilGoal: 6,
  }));

  assert.equal(plan.goal.monthsAtChosenSavingPace, 9);
  assert.equal(plan.goal.monthsToPurchaseAtChosenPace, 9);
  assert.equal(plan.goal.monthsToCompleteWithRecommendedLoan, 69);
});


test("uses a user EMI cap only up to the available monthly surplus", () => {
  const plan = calculatePlan(makeProfile({
    considerLoan: true,
    loanRatePercent: 10,
    maxComfortableNewEmi: 80000,
  }));

  assert.equal(plan.loan.comfortableEmiLimit, plan.cashFlow.monthlySurplus);
  assert.equal(plan.loan.recommendation.months, 36);
});


test("does not show a loan calculation unless the user opts in", () => {
  const plan = calculatePlan(makeProfile({ loanRatePercent: 10 }));
  assert.equal(plan.loan.status, "not-considered");
  assert.deepEqual(plan.loan.scenarios, []);
});


test("uses goal savings above the down-payment amount to reduce the loan", () => {
  const plan = calculatePlan(makeProfile({
    considerLoan: true,
    loanRatePercent: 10,
    totalSavings: 500000,
    goalSavings: 300000,
  }));
  assert.equal(plan.loan.cashForPurchase, 300000);
  assert.equal(plan.loan.loanAmount, 900000);
});


test("does not guess a loan rate when the user has no quote", () => {
  const plan = calculatePlan(makeProfile({ considerLoan: true }));

  assert.equal(plan.loan.status, "rate-needed");
  assert.equal(plan.loan.annualRatePercent, null);
  assert.deepEqual(plan.loan.scenarios, []);
});


test("shows when no loan term fits the user's monthly limit", () => {
  const plan = calculatePlan(makeProfile({
    monthlyTakeHomeIncome: 50000,
    monthlyEssentialExpenses: 45000,
    monthlyDiscretionaryExpenses: 10000,
    monthlyDebtPayment: 5000,
    goalComfortPercent: 50,
    considerLoan: true,
    loanRatePercent: 10,
  }));

  assert.equal(plan.loan.status, "no-affordable-option");
  assert.equal(plan.loan.comfortableEmiLimit, 0);
  assert.equal(plan.loan.recommendation, null);
  assert.equal(plan.goal.monthsToCompleteWithRecommendedLoan, null);
  assert.equal(plan.loan.maxAffordableLoanAtLongestTerm, 0);
  assert.equal(plan.loan.additionalDownPaymentNeeded, plan.loan.loanAmount);
  assert.equal(plan.loan.smallerLoanPlan, null);
});


test("offers an affordable smaller loan and timeline when all listed full-loan terms exceed the EMI limit", () => {
  const plan = calculatePlan(makeProfile({
    goalPrice: 1800000,
    considerLoan: true,
    loanRatePercent: 10,
  }));

  assert.equal(plan.loan.status, "no-affordable-option");
  assert.ok(plan.loan.additionalDownPaymentNeeded > 0);
  assert.ok(plan.loan.smallerLoanPlan.loanAmount < plan.loan.loanAmount);
  assert.ok(plan.loan.smallerLoanPlan.emi <= plan.loan.comfortableEmiLimit + 0.005);
  assert.equal(plan.loan.smallerLoanPlan.months, 36);
  assert.equal(plan.goal.monthsToCompleteWithSmallerLoan, 84);
});


test("uses example repayment terms for home and other goals", () => {
  const home = calculatePlan(makeProfile({ considerLoan: true, goalType: "home", loanRatePercent: 8 }));
  const other = calculatePlan(makeProfile({ considerLoan: true, goalType: "other", loanRatePercent: 8 }));

  assert.deepEqual(home.loan.scenarios.map((item) => item.months), [120, 180, 240, 300, 360]);
  assert.deepEqual(other.loan.scenarios.map((item) => item.months), [12, 24, 36, 60]);
});


test("validates optional loan rate and EMI limit", () => {
  assert.equal(validateProfile(makeProfile({ loanRatePercent: 51 })).isValid, false);
  assert.equal(validateProfile(makeProfile({ maxComfortableNewEmi: -1 })).isValid, false);
});


test("shows a monthly shortfall and no goal saving capacity when costs exceed income", () => {
  const plan = calculatePlan(
    makeProfile({
      monthlyTakeHomeIncome: 50000,
      monthlyEssentialExpenses: 45000,
      monthlyDiscretionaryExpenses: 10000,
      monthlyDebtPayment: 5000,
      goalComfortPercent: 100,
    })
  );

  assert.equal(plan.cashFlow.balanceAfterListedCosts, -10000);
  assert.equal(plan.cashFlow.monthlySurplus, 0);
  assert.equal(plan.cashFlow.monthlyShortfall, 10000);
  assert.equal(plan.goal.comfortableMonthlySaving, 0);
  assert.equal(plan.goal.fitsChosenMonthlyAmount, false);
  assert.equal(plan.goal.monthsAtChosenSavingPace, null);
  assert.equal(plan.goal.monthsToFullCashAtChosenPace, null);
  assert.equal(plan.goal.scenarios[2].monthsToFullCashPurchase, null);
  assert.equal(plan.goal.savingsByDeadline, 40000);
});


test("shows zero months when the down payment is already saved", () => {
  const plan = calculatePlan(
    makeProfile({
      goalSavings: 240000,
      totalSavings: 400000,
    })
  );

  assert.equal(plan.goal.remainingDownPayment, 0);
  assert.equal(plan.goal.requiredMonthlySaving, 0);
  assert.equal(plan.goal.monthsAtChosenSavingPace, 0);
});


test("shows that a fully saved cash goal needs no more saving time", () => {
  const plan = calculatePlan(
    makeProfile({
      totalSavings: 1400000,
      goalSavings: 1200000,
    })
  );

  assert.equal(plan.goal.remainingFullPrice, 0);
  assert.equal(plan.goal.monthsToFullCashAtChosenPace, 0);
  assert.equal(plan.goal.fullPriceShortfallAtDeadline, 0);
  assert.equal(plan.goal.cashPurchaseFitsChosenTimeline, true);
});


test("collects several input problems before doing calculations", () => {
  const result = validateProfile(
    makeProfile({
      monthlyTakeHomeIncome: 0,
      householdSize: 3,
      dependents: 4,
      totalSavings: 100,
      emergencyFund: 80,
      goalSavings: 40,
      goalPrice: 100000,
      plannedDownPayment: 100001,
      monthsUntilGoal: 0,
      goalComfortPercent: 101,
    })
  );

  assert.equal(result.isValid, false);
  assert.ok(result.errors.length >= 5);
});


test("requires a city or region for the local goal price context", () => {
  const result = validateProfile(makeProfile({ region: " " }));

  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((error) => error.includes("city, district, or region")));
});


test("rejects invalid input before calculating a plan", () => {
  assert.throws(
    () => calculatePlan(makeProfile({ monthlyDebtPayment: -1 })),
    /Please fix these inputs/
  );
});


test("allows a household to create a flexible savings plan without any goal details", () => {
  const profile = makeProfile({
    includeGoal: false,
    goalSavings: null,
    region: "",
    goalType: "",
    goalPrice: null,
    plannedDownPayment: null,
    monthsUntilGoal: null,
  });
  const validation = validateProfile(profile);
  assert.equal(validation.isValid, true, validation.errors.join(" "));

  const plan = calculatePlan(profile);
  assert.equal(plan.goal, null);
  assert.equal(plan.savingsPlan.monthlyAmount, 22500);
  assert.equal(plan.emergencyFund.monthsToTargetIfThatAmountIsUsed, 6);
  assert.deepEqual(plan.savingsPlan.projections.map((item) => item.months), [6, 12, 24, 36]);
  assert.equal(plan.savingsPlan.projections[0].plannedContributions, 135000);
  assert.equal(plan.savingsPlan.projections[0].usedForEmergencyFund, 120000);
  assert.equal(plan.savingsPlan.projections[0].extraSavingsAfterEmergencyTarget, 15000);
  assert.equal(plan.loan.status, "not-considered");
});


test("does not require a region or goal fields when the goal section is switched off", () => {
  const profile = makeProfile({ includeGoal: false, region: "", goalPrice: null });
  delete profile.goalSavings;
  delete profile.plannedDownPayment;
  delete profile.monthsUntilGoal;
  delete profile.goalType;

  assert.equal(validateProfile(profile).isValid, true);
  assert.equal(calculatePlan(profile).goal, null);
});


test("uses an affordable preferred repayment period when the user chooses one", () => {
  const plan = calculatePlan(makeProfile({
    considerLoan: true,
    loanRatePercent: 10,
    preferredLoanTermMonths: 84,
  }));

  assert.equal(plan.loan.preferredTermAffordable, true);
  assert.equal(plan.loan.recommendation.months, 84);
  assert.equal(plan.loan.recommendationUsesPreference, true);
  assert.equal(plan.loan.preferredScenario.isPreferred, true);
});


test("suggests an affordable alternative when the preferred repayment period is too short", () => {
  const plan = calculatePlan(makeProfile({
    considerLoan: true,
    loanRatePercent: 10,
    preferredLoanTermMonths: 36,
  }));

  assert.equal(plan.loan.preferredTermAffordable, false);
  assert.equal(plan.loan.recommendation.months, 60);
  assert.equal(plan.loan.recommendationUsesPreference, false);
});


test("offers repayment term examples for the expanded purchase categories", () => {
  const goalTypes = [
    "car", "bike", "laptop", "home", "plot", "farm", "renovation", "business",
    "education", "medical", "wedding", "travel", "phone", "appliance", "other",
  ];
  for (const goalType of goalTypes) {
    assert.equal(validateProfile(makeProfile({ goalType })).isValid, true, goalType);
    assert.ok(LOAN_TERMS_BY_GOAL[goalType].length >= 3, goalType);
  }
  assert.deepEqual(LOAN_TERMS_BY_GOAL.bike, [12, 24, 36, 48, 60]);
  assert.deepEqual(LOAN_TERMS_BY_GOAL.home, [120, 180, 240, 300, 360]);
});


test("rejects a repayment period that is not offered for the selected goal", () => {
  const result = validateProfile(makeProfile({ preferredLoanTermMonths: 25 }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((error) => error.includes("repayment period")));
});


test("keeps the emergency fund within total savings even without a goal", () => {
  const result = validateProfile(makeProfile({
    includeGoal: false,
    emergencyFund: 200000,
    totalSavings: 100000,
  }));
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((error) => error.includes("Emergency-fund savings")));
});
