/*
  Simple, transparent calculations for the Indian Finance AI planner.
  This file checks form values and calculates cash flow, emergency savings,
  optional goal scenarios, and loan EMI examples. It does not train or use ML.
*/

// These are example comparison periods, not promises that a lender offers them.
export const LOAN_TERMS_BY_GOAL = Object.freeze({
  car: Object.freeze([36, 60, 84]),
  bike: Object.freeze([12, 24, 36, 48, 60]),
  laptop: Object.freeze([6, 12, 18, 24, 36]),
  home: Object.freeze([120, 180, 240, 300, 360]),
  plot: Object.freeze([60, 84, 120, 180, 240]),
  farm: Object.freeze([36, 60, 84, 120, 180]),
  renovation: Object.freeze([12, 24, 36, 60, 84]),
  business: Object.freeze([12, 24, 36, 60, 84, 120]),
  education: Object.freeze([12, 24, 36, 60, 84, 120]),
  medical: Object.freeze([6, 12, 18, 24, 36, 60]),
  wedding: Object.freeze([6, 12, 18, 24, 36, 60]),
  travel: Object.freeze([3, 6, 12, 18, 24, 36]),
  phone: Object.freeze([6, 12, 18, 24, 36]),
  appliance: Object.freeze([6, 12, 18, 24, 36]),
  other: Object.freeze([12, 24, 36, 60]),
});

const ALLOWED_GOAL_TYPES = Object.keys(LOAN_TERMS_BY_GOAL);

// Broad typo guards for a personal household planner, not financial eligibility rules.
export const MAX_MONTHLY_AMOUNT = 10_000_000; // ₹1 crore per month
export const MAX_SAVED_OR_GOAL_AMOUNT = 1_000_000_000; // ₹100 crore
export const MAX_HOUSEHOLD_SIZE = 50;
export const MAX_GOAL_HORIZON_MONTHS = 360; // 30 years

// Older saved plans did not have an optional-goal switch, so keep them as goals.
function hasSpecificGoal(profile) {
  return profile.includeGoal !== false;
}

// Return a timeline, or null when no monthly amount is assigned to the goal.
function monthsNeeded(amountRemaining, monthlySaving) {
  if (amountRemaining <= 0) return 0;
  if (monthlySaving <= 0) return null;
  return Math.ceil(amountRemaining / monthlySaving);
}

// Count only assets the user opted to use, capped at the remaining goal price.
function goalAssetFunds(profile) {
  const requestedAmount = profile.useGoalAssets === true ? profile.goalAssetContribution : 0;
  const amountStillNeeded = Math.max(profile.goalPrice - profile.goalSavings, 0);
  return Math.min(requestedAmount, amountStillNeeded);
}

// Build one comparable goal scenario from a monthly saving amount.
function makeGoalScenario(name, monthlySaving, profile, remainingDownPayment, remainingFullPrice, fundsAlreadyAvailable) {
  const savingsByDeadline = fundsAlreadyAvailable + monthlySaving * profile.monthsUntilGoal;

  return {
    name,
    monthlySaving,
    monthsToDownPayment: monthsNeeded(remainingDownPayment, monthlySaving),
    monthsToFullCashPurchase: monthsNeeded(remainingFullPrice, monthlySaving),
    savingsByDeadline,
    downPaymentShortfallAtDeadline: Math.max(profile.plannedDownPayment - savingsByDeadline, 0),
    fullPriceShortfallAtDeadline: Math.max(profile.goalPrice - savingsByDeadline, 0),
  };
}

// Check the numbers before using them in calculations.
export function validateProfile(profile) {
  const errors = [];

  if (profile === null || typeof profile !== "object" || Array.isArray(profile)) {
    return { isValid: false, errors: ["Enter your finance details as a profile."] };
  }

  if (profile.includeGoal !== undefined && typeof profile.includeGoal !== "boolean") {
    errors.push("Choose whether you want to plan for a specific goal.");
  }
  const includeGoal = hasSpecificGoal(profile);
  const useGoalAssets = includeGoal && profile.useGoalAssets === true;

  if (profile.useGoalAssets !== undefined && typeof profile.useGoalAssets !== "boolean") {
    errors.push("Choose whether to use assets or family support for this goal.");
  }
  if (profile.useGoalAssets === true && !includeGoal) {
    errors.push("Assets or family support can only be used for a specific goal.");
  }

  // A goal-free plan still needs only household, budget, savings, and comfort inputs.
  const requiredNumbers = [
    ["monthlyTakeHomeIncome", "Monthly take-home income"],
    ["monthlyEssentialExpenses", "Monthly essential expenses"],
    ["monthlyDiscretionaryExpenses", "Monthly discretionary expenses"],
    ["monthlyDebtPayment", "Current loan and EMI payments"],
    ["householdSize", "Household size"],
    ["dependents", "Number of dependents"],
    ["totalSavings", "Total savings"],
    ["emergencyFund", "Emergency fund"],
    ["emergencyFundMonths", "Emergency-fund months"],
    ["goalComfortPercent", "Comfortable share of monthly surplus"],
  ];

  if (includeGoal) {
    requiredNumbers.push(
      ["goalSavings", "Savings set aside for this goal"],
      ...(useGoalAssets ? [["goalAssetContribution", "Assets or family support for this goal"]] : []),
      ["goalPrice", "Goal price"],
      ["plannedDownPayment", "Planned goal contribution"],
      ["monthsUntilGoal", "Months until the goal"],
    );
  }

  for (const [field, label] of requiredNumbers) {
    if (!Number.isFinite(profile[field])) errors.push(`${label} must be a number.`);
  }

  if (errors.length > 0) return { isValid: false, errors };

  if (includeGoal && (typeof profile.region !== "string" || profile.region.trim().length < 2)) {
    errors.push("Enter a city, district, or region for your local price context.");
  }

  if (profile.monthlyTakeHomeIncome <= 0) {
    errors.push("Monthly take-home income must be more than zero.");
  }

  const amountsThatCannotBeNegative = [
    ["monthlyEssentialExpenses", "Monthly essential expenses"],
    ["monthlyDiscretionaryExpenses", "Monthly discretionary expenses"],
    ["monthlyDebtPayment", "Current loan and EMI payments"],
    ["totalSavings", "Total savings"],
    ["emergencyFund", "Emergency fund"],
  ];

  if (includeGoal) {
    amountsThatCannotBeNegative.push(
      ["goalSavings", "Savings set aside for this goal"],
      ...(useGoalAssets ? [["goalAssetContribution", "Assets or family support for this goal"]] : []),
      ["goalPrice", "Goal price"],
      ["plannedDownPayment", "Planned goal contribution"],
    );
  }

  for (const [field, label] of amountsThatCannotBeNegative) {
    if (profile[field] < 0) errors.push(`${label} cannot be negative.`);
  }

  const monthlyAmounts = [
    ["monthlyTakeHomeIncome", "Take-home income"],
    ["monthlyEssentialExpenses", "Essential expenses"],
    ["monthlyDiscretionaryExpenses", "Discretionary expenses"],
    ["monthlyDebtPayment", "Current loan and EMI payments"],
    ["maxComfortableNewEmi", "Comfortable new EMI limit"],
  ];
  for (const [field, label] of monthlyAmounts) {
    if (Number.isFinite(profile[field]) && profile[field] > MAX_MONTHLY_AMOUNT) {
      errors.push(`${label} is above the ₹1 crore monthly limit. Check the value for extra zeroes.`);
    }
  }

  const savingsAndGoalAmounts = [
    ["totalSavings", "Total savings"],
    ["emergencyFund", "Emergency fund"],
    ["goalSavings", "Savings set aside for this goal"],
    ["goalAssetContribution", "Assets or family support for this goal"],
    ["goalPrice", "Goal price"],
    ["plannedDownPayment", "Planned goal contribution"],
  ];
  for (const [field, label] of savingsAndGoalAmounts) {
    if (Number.isFinite(profile[field]) && profile[field] > MAX_SAVED_OR_GOAL_AMOUNT) {
      errors.push(`${label} is above the ₹100 crore limit. Check the value for extra zeroes.`);
    }
  }

  if (!Number.isInteger(profile.householdSize) || profile.householdSize < 1) {
    errors.push("Household size must be a whole number of at least 1.");
  } else if (profile.householdSize > MAX_HOUSEHOLD_SIZE) {
    errors.push("Household size cannot exceed 50 people.");
  }
  if (!Number.isInteger(profile.dependents) || profile.dependents < 0) {
    errors.push("Dependents must be a whole number and cannot be negative.");
  } else if (profile.dependents > profile.householdSize) {
    errors.push("Dependents cannot be more than the household size.");
  }
  if (!Number.isInteger(profile.emergencyFundMonths) || profile.emergencyFundMonths < 1) {
    errors.push("Choose at least 1 month for the emergency-fund target.");
  }

  if (includeGoal) {
    if (!Number.isInteger(profile.monthsUntilGoal) || profile.monthsUntilGoal < 1) {
      errors.push("Months until the goal must be a whole number of at least 1.");
    } else if (profile.monthsUntilGoal > MAX_GOAL_HORIZON_MONTHS) {
      errors.push("Months until the goal cannot exceed 360 months (30 years).");
    }
    if (profile.goalPrice <= 0) errors.push("Goal price must be more than zero.");
    if (profile.plannedDownPayment > profile.goalPrice) {
      errors.push("The planned goal contribution cannot be more than the estimated goal cost.");
    }
    if (!ALLOWED_GOAL_TYPES.includes(profile.goalType)) {
      errors.push("Choose a goal type from the list.");
    }
  }

  if (profile.goalComfortPercent < 0 || profile.goalComfortPercent > 100) {
    errors.push("Comfortable share must be between 0 and 100 percent.");
  }

  // These loan details are optional. The rate must come from the user's lender quote.
  if (profile.considerLoan !== undefined && typeof profile.considerLoan !== "boolean") {
    errors.push("Choose whether to include a loan comparison.");
  }
  if (profile.loanRatePercent !== undefined && profile.loanRatePercent !== null
    && (!Number.isFinite(profile.loanRatePercent) || profile.loanRatePercent < 0 || profile.loanRatePercent > 50)) {
    errors.push("Annual loan interest rate must be between 0 and 50 percent.");
  }
  if (profile.maxComfortableNewEmi !== undefined && profile.maxComfortableNewEmi !== null
    && (!Number.isFinite(profile.maxComfortableNewEmi) || profile.maxComfortableNewEmi < 0)) {
    errors.push("Comfortable new EMI limit must be zero or more.");
  }

  if (profile.preferredLoanTermMonths !== undefined && profile.preferredLoanTermMonths !== null) {
    const allowedTerms = includeGoal ? LOAN_TERMS_BY_GOAL[profile.goalType] : [];
    if (!Number.isInteger(profile.preferredLoanTermMonths)
      || !allowedTerms?.includes(profile.preferredLoanTermMonths)) {
      errors.push("Choose a repayment period from the options for this goal.");
    }
  }

  // Goal savings and emergency savings are separate parts of total savings.
  const earmarkedSavings = profile.emergencyFund + (includeGoal ? profile.goalSavings : 0);
  if (earmarkedSavings > profile.totalSavings) {
    errors.push(includeGoal
      ? "Emergency-fund savings and goal savings cannot add up to more than total savings."
      : "Emergency-fund savings cannot be more than total savings.");
  }

  return { isValid: errors.length === 0, errors };
}

// Estimate the monthly payment for a fixed-rate loan with a reducing balance.
export function calculateLoanEmi(principal, annualRatePercent, months) {
  if (!Number.isFinite(principal) || principal < 0
    || !Number.isFinite(annualRatePercent) || annualRatePercent < 0
    || !Number.isInteger(months) || months < 1) {
    throw new RangeError("Loan amount, interest rate, and term must be valid non-negative values.");
  }
  if (principal === 0) return 0;

  const monthlyRate = annualRatePercent / 1200;
  if (monthlyRate === 0) return principal / months;

  const growth = (1 + monthlyRate) ** months;
  return principal * monthlyRate * growth / (growth - 1);
}

// Work out the largest loan that stays within a monthly EMI limit.
function loanAmountForEmiLimit(monthlyLimit, annualRatePercent, months) {
  const monthlyRate = annualRatePercent / 1200;
  if (monthlyRate === 0) return monthlyLimit * months;
  return monthlyLimit * (1 - (1 + monthlyRate) ** -months) / monthlyRate;
}

// Compare every example term. Affordability uses the remaining surplus and comfort cap.
function calculateLoanEstimate(profile, monthlySurplus) {
  const includeGoal = hasSpecificGoal(profile);
  const assetFundsUsed = includeGoal ? goalAssetFunds(profile) : 0;
  const goalFundsAlreadyAvailable = includeGoal ? profile.goalSavings + assetFundsUsed : 0;
  const cashForPurchase = includeGoal
    ? Math.min(profile.goalPrice, Math.max(profile.plannedDownPayment, goalFundsAlreadyAvailable))
    : 0;
  const loanAmount = includeGoal ? Math.max(profile.goalPrice - cashForPurchase, 0) : 0;
  const automaticEmiLimit = monthlySurplus * profile.goalComfortPercent / 100;
  const comfortableEmiLimit = profile.maxComfortableNewEmi == null
    ? automaticEmiLimit
    : Math.min(profile.maxComfortableNewEmi, monthlySurplus);
  const base = {
    loanAmount,
    cashForPurchase,
    annualRatePercent: profile.loanRatePercent ?? null,
    comfortableEmiLimit,
    emiLimitSource: profile.maxComfortableNewEmi == null ? "chosen-surplus-share" : "user-entered",
    preferredTermMonths: profile.preferredLoanTermMonths ?? null,
    preferredScenario: null,
    preferredTermAffordable: null,
    recommendation: null,
    recommendationUsesPreference: false,
    scenarios: [],
    maxAffordableLoanAtLongestTerm: null,
    additionalDownPaymentNeeded: null,
    smallerLoanPlan: null,
  };

  if (!profile.considerLoan) return { ...base, status: "not-considered" };
  if (!includeGoal) return { ...base, status: "goal-needed" };
  if (loanAmount === 0) return { ...base, status: "no-loan-needed" };
  if (profile.loanRatePercent == null) return { ...base, status: "rate-needed" };

  const terms = LOAN_TERMS_BY_GOAL[profile.goalType];
  const scenarios = terms.map((months) => {
    const emi = calculateLoanEmi(loanAmount, profile.loanRatePercent, months);
    return {
      months,
      years: months / 12,
      emi,
      totalRepayment: emi * months,
      totalInterest: Math.max(emi * months - loanAmount, 0),
      affordable: emi <= comfortableEmiLimit + 0.005,
      isPreferred: months === profile.preferredLoanTermMonths,
    };
  });
  const longestTerm = terms.at(-1);
  const maxAffordableLoanAtLongestTerm = loanAmountForEmiLimit(
    comfortableEmiLimit,
    profile.loanRatePercent,
    longestTerm,
  );
  const preferredScenario = scenarios.find((scenario) => scenario.isPreferred) ?? null;
  const recommendation = preferredScenario?.affordable
    ? preferredScenario
    : scenarios.find((scenario) => scenario.affordable) ?? null;
  let smallerLoanPlan = null;
  if (!recommendation && comfortableEmiLimit > 0) {
    const currentGoalFunds = goalFundsAlreadyAvailable;
    const remainingPlannedContribution = Math.max(
      profile.plannedDownPayment - currentGoalFunds,
      0,
    );
    const comfortableMonthlySaving = monthlySurplus * profile.goalComfortPercent / 100;
    const candidatePlans = terms.map((months) => {
      const affordablePrincipal = Math.min(
        loanAmount,
        loanAmountForEmiLimit(comfortableEmiLimit, profile.loanRatePercent, months),
      );
      const additionalDownPaymentNeeded = Math.max(loanAmount - affordablePrincipal, 0);
      const monthsToContribution = monthsNeeded(
        remainingPlannedContribution + additionalDownPaymentNeeded,
        comfortableMonthlySaving,
      );
      const monthsUntilPurchase = monthsToContribution === null
        ? null
        : Math.max(profile.monthsUntilGoal, monthsToContribution);

      if (affordablePrincipal <= 0 || monthsUntilPurchase === null) return null;

      const emi = calculateLoanEmi(affordablePrincipal, profile.loanRatePercent, months);
      return {
        loanAmount: affordablePrincipal,
        additionalDownPaymentNeeded,
        months,
        emi,
        totalRepayment: emi * months,
        totalInterest: Math.max(emi * months - affordablePrincipal, 0),
        monthsToContribution,
        monthsUntilPurchase,
        monthsToComplete: monthsUntilPurchase + months,
      };
    }).filter(Boolean);

    // Pick the option that finishes soonest overall, including extra saving time.
    candidatePlans.sort((first, second) => first.monthsToComplete - second.monthsToComplete
      || first.totalInterest - second.totalInterest
      || first.months - second.months);
    smallerLoanPlan = candidatePlans[0] ?? null;
  }
  const additionalDownPaymentNeeded = smallerLoanPlan?.additionalDownPaymentNeeded
    ?? Math.max(loanAmount - maxAffordableLoanAtLongestTerm, 0);

  return {
    ...base,
    status: recommendation ? "affordable-option" : "no-affordable-option",
    scenarios,
    preferredScenario,
    preferredTermAffordable: preferredScenario?.affordable ?? null,
    recommendation,
    recommendationUsesPreference: Boolean(preferredScenario?.affordable),
    maxAffordableLoanAtLongestTerm,
    additionalDownPaymentNeeded,
    smallerLoanPlan,
  };
}

// Work out household cash flow and then either a flexible savings plan or a goal plan.
export function calculatePlan(profile) {
  const validation = validateProfile(profile);
  if (!validation.isValid) {
    throw new RangeError(`Please fix these inputs: ${validation.errors.join(" ")}`);
  }

  const includeGoal = hasSpecificGoal(profile);
  const monthlyOutgoings = profile.monthlyEssentialExpenses
    + profile.monthlyDiscretionaryExpenses
    + profile.monthlyDebtPayment;
  const balanceAfterListedCosts = profile.monthlyTakeHomeIncome - monthlyOutgoings;
  const monthlySurplus = Math.max(balanceAfterListedCosts, 0);
  const monthlyShortfall = Math.max(-balanceAfterListedCosts, 0);
  const comfortableMonthlySaving = monthlySurplus * profile.goalComfortPercent / 100;
  const loan = calculateLoanEstimate(profile, monthlySurplus);

  const emergencyFundMonthlyNeed = profile.monthlyEssentialExpenses + profile.monthlyDebtPayment;
  const emergencyFundTarget = emergencyFundMonthlyNeed * profile.emergencyFundMonths;
  const emergencyFundGap = Math.max(emergencyFundTarget - profile.emergencyFund, 0);

  // For a specific goal, the unused surplus can build the emergency fund.
  // Without a goal, use the selected monthly savings amount for this first.
  const monthlyAmountForEmergencyFund = includeGoal
    ? monthlySurplus - comfortableMonthlySaving
    : comfortableMonthlySaving;
  const monthsToEmergencyTarget = emergencyFundGap === 0
    ? 0
    : monthsNeeded(emergencyFundGap, monthlyAmountForEmergencyFund);

  let goal = null;
  let savingsPlan = null;
  const notes = [
    `The emergency-fund target uses ${profile.emergencyFundMonths} months of essential expenses and current loan/EMI payments.`,
    "Current loan and EMI payments are included in your monthly costs.",
  ];

  if (includeGoal) {
    const assetsOrFamilyFundsUsed = goalAssetFunds(profile);
    const goalFundsAlreadyAvailable = profile.goalSavings + assetsOrFamilyFundsUsed;
    const remainingDownPayment = Math.max(profile.plannedDownPayment - goalFundsAlreadyAvailable, 0);
    const requiredMonthlyGoalSaving = remainingDownPayment / profile.monthsUntilGoal;
    const monthlyGoalSavingGap = Math.max(requiredMonthlyGoalSaving - comfortableMonthlySaving, 0);
    const goalFitsChosenMonthlyAmount = monthlyGoalSavingGap === 0;
    const monthsToDownPaymentAtChosenPace = monthsNeeded(remainingDownPayment, comfortableMonthlySaving);
    const remainingFullPrice = Math.max(profile.goalPrice - goalFundsAlreadyAvailable, 0);
    const savingsByDeadline = goalFundsAlreadyAvailable
      + comfortableMonthlySaving * profile.monthsUntilGoal;
    const downPaymentShortfallAtDeadline = Math.max(profile.plannedDownPayment - savingsByDeadline, 0);
    const fullPriceShortfallAtDeadline = Math.max(profile.goalPrice - savingsByDeadline, 0);
    const monthsToFullCashAtChosenPace = monthsNeeded(remainingFullPrice, comfortableMonthlySaving);
    const scenarios = [
      makeGoalScenario("Half of chosen amount", comfortableMonthlySaving / 2, profile,
        remainingDownPayment, remainingFullPrice, goalFundsAlreadyAvailable),
      makeGoalScenario("Your chosen amount", comfortableMonthlySaving, profile,
        remainingDownPayment, remainingFullPrice, goalFundsAlreadyAvailable),
      makeGoalScenario("All listed surplus", monthlySurplus, profile,
        remainingDownPayment, remainingFullPrice, goalFundsAlreadyAvailable),
    ];

    goal = {
      type: profile.goalType,
      region: profile.region.trim(),
      price: profile.goalPrice,
      plannedDownPayment: profile.plannedDownPayment,
      savingsAlreadySetAside: profile.goalSavings,
      assetsOrFamilyFundsUsed,
      totalFundsAlreadyAvailable: goalFundsAlreadyAvailable,
      remainingDownPayment,
      monthsUntilGoal: profile.monthsUntilGoal,
      requiredMonthlySaving: requiredMonthlyGoalSaving,
      comfortableMonthlySaving,
      monthlySavingGap: monthlyGoalSavingGap,
      fitsChosenMonthlyAmount: goalFitsChosenMonthlyAmount,
      monthsAtChosenSavingPace: monthsToDownPaymentAtChosenPace,
      // The goal cannot be purchased before the chosen date or before its planned contribution is ready.
      monthsToPurchaseAtChosenPace: monthsToDownPaymentAtChosenPace === null
        ? null
        : Math.max(profile.monthsUntilGoal, monthsToDownPaymentAtChosenPace),
      remainingFullPrice,
      requiredMonthlyFullPriceSaving: remainingFullPrice / profile.monthsUntilGoal,
      monthsToFullCashAtChosenPace,
      savingsByDeadline,
      downPaymentShortfallAtDeadline,
      fullPriceShortfallAtDeadline,
      cashPurchaseFitsChosenTimeline: fullPriceShortfallAtDeadline === 0,
      scenarios,
    };

    // Add the recommended repayment period to the time needed before purchase.
    goal.monthsToCompleteWithRecommendedLoan = loan.status === "affordable-option"
      && goal.monthsToPurchaseAtChosenPace !== null
      ? goal.monthsToPurchaseAtChosenPace + loan.recommendation.months
      : null;
    goal.monthsToCompleteWithSmallerLoan = loan.smallerLoanPlan
      ? loan.smallerLoanPlan.monthsToComplete
      : null;

    notes.unshift(`The goal plan uses ${profile.goalComfortPercent}% of your listed positive monthly surplus.`);
    notes.push("Goal timelines assume the same monthly saving, no investment growth, and no price changes.");
    notes.push("The full-cost scenario assumes you save the entire goal cost; it does not estimate a new loan or EMI.");
    notes.push("The goal plan uses your inputs and transparent calculations, not an ML goal-success prediction.");
    if (profile.useGoalAssets === true) {
      notes.push("The goal plan includes only the asset or family amount you opted to use.");
    }
    if (!goalFitsChosenMonthlyAmount) {
      notes.push("The selected goal timeline needs more monthly savings than your chosen amount.");
    }
  } else {
    const horizons = [6, 12, 24, 36];
    savingsPlan = {
      monthlyAmount: comfortableMonthlySaving,
      comfortPercent: profile.goalComfortPercent,
      projections: horizons.map((months) => {
        const plannedContributions = comfortableMonthlySaving * months;
        const usedForEmergencyFund = Math.min(plannedContributions, emergencyFundGap);
        return {
          months,
          plannedContributions,
          usedForEmergencyFund,
          extraSavingsAfterEmergencyTarget: plannedContributions - usedForEmergencyFund,
        };
      }),
    };
    notes.unshift(`Your flexible savings plan sets aside ${profile.goalComfortPercent}% of your positive monthly surplus.`);
    notes.push("Savings projections assume the same monthly contribution and no investment growth or fees.");
    notes.push("When your emergency-fund target is not yet met, planned contributions go toward that target first.");
  }

  if (monthlyShortfall > 0) notes.push("Your listed monthly costs are higher than your take-home income.");
  if (emergencyFundGap > 0) notes.push("Your current emergency fund is below the target you selected.");

  return {
    cashFlow: {
      monthlyTakeHomeIncome: profile.monthlyTakeHomeIncome,
      monthlyOutgoings,
      balanceAfterListedCosts,
      monthlySurplus,
      monthlyShortfall,
    },
    emergencyFund: {
      target: emergencyFundTarget,
      current: profile.emergencyFund,
      gap: emergencyFundGap,
      selectedMonths: profile.emergencyFundMonths,
      monthlyAmountOutsideGoalPlan: monthlyAmountForEmergencyFund,
      monthsToTargetIfThatAmountIsUsed: monthsToEmergencyTarget,
    },
    goal,
    savingsPlan,
    loan,
    notes,
  };
}
