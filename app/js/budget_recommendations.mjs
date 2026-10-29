import { calculatePlan } from "./finance_calculations.mjs";


// Existing loan payments are always protected from suggested reductions.
const EMI_CATEGORY = "Loan EMI";
const DEFAULT_ADJUSTABLE_CATEGORIES = new Set(["Personal", "Other"]);
const DEFAULT_REDUCTION_RATE = 0.10;
const DEFAULT_SAVINGS_REDUCTION_RATES = new Map([
  ["Other", 0.10],
  ["Personal", 0.10],
  ["Transport", 0.05],
  ["Utilities", 0.05],
  ["Food and groceries", 0.05],
]);
const DEFAULT_SAVINGS_CATEGORIES = new Set(DEFAULT_SAVINGS_REDUCTION_RATES.keys());


// Turn the monthly category tracker and the user's limits into a modest plan.
export function buildBudgetAdjustment(profile, baselinePlan, budgetSummary, constraints = {}) {
  const emptyResult = (status, message) => ({
    status,
    message,
    requiredCut: 0,
    totalCut: 0,
    remainingRequiredCut: baselinePlan.goal.monthlySavingGap,
    cuts: [],
    adjustedProfile: { ...profile },
    afterPlan: calculatePlan(profile),
  });

  if (baselinePlan.goal.monthlySavingGap <= 0) {
    return emptyResult("no-cut-needed", "Your selected monthly goal amount already covers the planned contribution timeline, so no spending cut is needed for this goal.");
  }

  if (profile.goalComfortPercent <= 0) {
    return emptyResult("zero-comfort-share", "Your goal comfort setting is 0%, so reducing expenses will not add money to this goal. Change the comfortable saving share if you want to model that trade-off.");
  }

  if (!budgetSummary?.isComplete) {
    return emptyResult("needs-complete-month", "To suggest a specific item such as groceries or transport, add all expenses to the monthly tracker and tick “I have entered all expenses for this month.” No itemized cuts are assumed yet.");
  }

  const categoryTotals = Array.isArray(budgetSummary.categoryTotals)
    ? budgetSummary.categoryTotals
    : [];
  const spending = new Map(categoryTotals.map(({ category, amount }) => [category, amount]));
  const adjustable = constraints.adjustableCategories instanceof Set
    ? constraints.adjustableCategories
    : DEFAULT_ADJUSTABLE_CATEGORIES;
  const locked = constraints.lockedCategories instanceof Set
    ? constraints.lockedCategories
    : new Set();
  const maximumCuts = constraints.maximumCuts instanceof Map
    ? constraints.maximumCuts
    : new Map();

  // Each rupee cut increases the user's chosen goal contribution by their
  // selected comfort percentage, so work out the spending reduction required.
  const comfortRate = profile.goalComfortPercent / 100;
  const requiredCut = Math.ceil(
    baselinePlan.cashFlow.monthlyShortfall
      + baselinePlan.goal.monthlySavingGap / comfortRate
  );
  const preferredOrder = ["Other", "Personal"];
  const otherEnabled = [...adjustable].filter((category) => !preferredOrder.includes(category));
  const candidates = [...preferredOrder, ...otherEnabled]
    .filter((category) => adjustable.has(category) && !locked.has(category))
    .filter((category) => category !== EMI_CATEGORY && spending.get(category) > 0);

  let essentialCutRoom = profile.monthlyEssentialExpenses;
  let discretionaryCutRoom = profile.monthlyDiscretionaryExpenses;
  let remainingTarget = requiredCut;
  const cuts = [];

  for (const category of candidates) {
    const currentAmount = spending.get(category);
    const isDiscretionary = category === "Personal" || category === "Other";
    const bucketRoom = isDiscretionary ? discretionaryCutRoom : essentialCutRoom;
    const explicitMaximum = maximumCuts.get(category);
    const suggestedMaximum = Number.isFinite(explicitMaximum)
      ? Math.min(explicitMaximum, currentAmount)
      : currentAmount * DEFAULT_REDUCTION_RATE;
    const proposedCut = Math.max(0, Math.min(suggestedMaximum, bucketRoom, remainingTarget));

    if (proposedCut <= 0) {
      continue;
    }

    cuts.push({
      category,
      currentAmount,
      proposedCut,
      newAmount: currentAmount - proposedCut,
    });
    remainingTarget -= proposedCut;

    if (isDiscretionary) {
      discretionaryCutRoom -= proposedCut;
    } else {
      essentialCutRoom -= proposedCut;
    }

    if (remainingTarget <= 0) {
      break;
    }
  }

  const totalCut = cuts.reduce((sum, item) => sum + item.proposedCut, 0);
  const adjustedProfile = {
    ...profile,
    monthlyEssentialExpenses: profile.monthlyEssentialExpenses - (profile.monthlyEssentialExpenses - essentialCutRoom),
    monthlyDiscretionaryExpenses: profile.monthlyDiscretionaryExpenses - (profile.monthlyDiscretionaryExpenses - discretionaryCutRoom),
  };
  const afterPlan = calculatePlan(adjustedProfile);
  const status = afterPlan.goal.monthlySavingGap === 0 ? "adjusted" : "partial";
  const message = totalCut === 0
    ? "No safe itemized reduction was found in the adjustable categories. Tell me which tracked category could change, or adjust your goal date or saving preference."
    : status === "adjusted"
      ? `A possible ${formatRupees(totalCut)} monthly reduction closes the selected goal contribution gap in this calculation. These are choices to review, not automatic instructions.`
      : `The modest reductions available here total ${formatRupees(totalCut)} per month. They help, but leave a ${formatRupees(afterPlan.goal.monthlySavingGap)} monthly goal contribution gap; you could also change the target date, goal cost, or saving share.`;

  return {
    status,
    message,
    requiredCut,
    totalCut,
    remainingRequiredCut: Math.max(requiredCut - totalCut, 0),
    cuts,
    adjustedProfile,
    afterPlan,
  };
}


// Build a savings estimate from the entries recorded for the selected month.
export function buildSavingsBudget(budgetSummary, monthlySavingsTarget = 0, constraints = {}) {
  if (!Number.isFinite(monthlySavingsTarget) || monthlySavingsTarget < 0) {
    throw new RangeError("The monthly savings target must be zero or a positive amount.");
  }

  const region = typeof constraints.region === "string" ? constraints.region.trim() : "";
  const totalIncome = Number.isFinite(budgetSummary?.totalIncome) ? budgetSummary.totalIncome : 0;
  const totalExpenses = Number.isFinite(budgetSummary?.totalExpenses) ? budgetSummary.totalExpenses : 0;
  const categoryTotals = Array.isArray(budgetSummary?.categoryTotals)
    ? budgetSummary.categoryTotals
    : [];
  const incomeEntryCount = Number.isInteger(budgetSummary?.incomeEntryCount)
    ? budgetSummary.incomeEntryCount
    : Number(totalIncome > 0);
  const expenseEntryCount = Number.isInteger(budgetSummary?.expenseEntryCount)
    ? budgetSummary.expenseEntryCount
    : Number(categoryTotals.length > 0 || totalExpenses > 0);
  const isComplete = budgetSummary?.isComplete === true;
  const emptyPlan = (status, message) => ({
    status,
    message,
    region,
    isComplete,
    incomeEntryCount,
    expenseEntryCount,
    monthlySavingsTarget,
    currentBalance: null,
    totalCut: 0,
    afterBalance: null,
    availableToSave: null,
    targetGap: null,
    cuts: [],
  });

  // Missing income or expense entries stay unknown; the planner never fills them with zero.
  if (incomeEntryCount === 0) {
    return emptyPlan("needs-income", "Add at least one income entry to estimate what may be available to save.");
  }
  if (expenseEntryCount === 0) {
    return emptyPlan("needs-expenses", "Add at least one expense entry. Unrecorded expenses are not treated as zero.");
  }

  const currentBalance = totalIncome - totalExpenses;
  const spending = new Map(categoryTotals.map(({ category, amount }) => [category, amount]));
  const adjustable = constraints.adjustableCategories instanceof Set
    ? constraints.adjustableCategories
    : DEFAULT_SAVINGS_CATEGORIES;
  const locked = constraints.lockedCategories instanceof Set
    ? constraints.lockedCategories
    : new Set();
  const maximumCuts = constraints.maximumCuts instanceof Map
    ? constraints.maximumCuts
    : new Map();
  const additionalCategories = [...adjustable].filter((category) => !DEFAULT_SAVINGS_CATEGORIES.has(category));
  const candidates = [...DEFAULT_SAVINGS_CATEGORIES, ...additionalCategories]
    .filter((category) => adjustable.has(category) && !locked.has(category))
    .filter((category) => category !== EMI_CATEGORY && Number.isFinite(spending.get(category)) && spending.get(category) > 0);

  const targetAlreadyMet = monthlySavingsTarget > 0 && currentBalance >= monthlySavingsTarget;

  // If the target is already met, show modest optional ways to save even more.
  const requiredCut = monthlySavingsTarget === 0 || targetAlreadyMet
    ? Number.POSITIVE_INFINITY
    : Math.max(monthlySavingsTarget - currentBalance, 0);
  let remainingCut = requiredCut;
  const cuts = [];

  for (const category of candidates) {
    const currentAmount = spending.get(category);
    const explicitMaximum = maximumCuts.get(category);
    const defaultRate = DEFAULT_SAVINGS_REDUCTION_RATES.get(category) ?? DEFAULT_REDUCTION_RATE;
    const suggestedMaximum = Number.isFinite(explicitMaximum)
      ? Math.min(explicitMaximum, currentAmount)
      : currentAmount * defaultRate;
    const proposedCut = Math.max(0, Math.min(suggestedMaximum, remainingCut));

    if (proposedCut === 0) continue;

    cuts.push({ category, currentAmount, proposedCut, newAmount: currentAmount - proposedCut });
    remainingCut -= proposedCut;
  }

  const totalCut = cuts.reduce((sum, item) => sum + item.proposedCut, 0);
  const afterBalance = currentBalance + totalCut;
  const availableToSave = Math.max(afterBalance, 0);
  const targetGap = monthlySavingsTarget === 0
    ? null
    : Math.max(monthlySavingsTarget - availableToSave, 0);

  let status;
  let message;
  if (currentBalance < 0 && afterBalance < 0) {
    status = "monthly-shortfall";
    message = `The recorded entries show spending ${formatRupees(Math.abs(currentBalance))} above income. The possible changes reduce that by ${formatRupees(totalCut)}, leaving a recorded shortfall of ${formatRupees(Math.abs(afterBalance))}.`;
  } else if (monthlySavingsTarget > 0 && targetAlreadyMet) {
    status = "already-on-track";
    message = totalCut > 0
      ? `Your monthly balance already meets this target. Optional changes below could free ${formatRupees(totalCut)} more each month.`
      : "Your balance meets this target, but no adjustable spending was found in the selected month's entries.";
  } else if (monthlySavingsTarget > 0 && targetGap === 0) {
    status = totalCut > 0 ? "target-reached" : "already-on-track";
    message = totalCut > 0
      ? `These changes could free about ${formatRupees(totalCut)} per month, bringing the amount available to save to ${formatRupees(availableToSave)} and meeting your target in this estimate.`
      : `Your recorded entries leave ${formatRupees(availableToSave)} per month, enough for the ${formatRupees(monthlySavingsTarget)} target you chose. You do not need a spending cut to meet it.`;
  } else if (monthlySavingsTarget > 0) {
    status = "target-shortfall";
    message = totalCut > 0
      ? `These modest changes could free ${formatRupees(totalCut)} per month. You would have about ${formatRupees(availableToSave)} available to save, leaving ${formatRupees(targetGap)} of your target unmet.`
      : `Your target is ${formatRupees(monthlySavingsTarget)} per month. No adjustable tracked categories are available yet; tell me which category could change.`;
  } else if (totalCut > 0) {
    status = "starter-suggestions";
    message = `A modest starting plan could free ${formatRupees(totalCut)} per month from flexible categories. If you set that amount aside, the recorded entries would support about ${formatRupees(availableToSave)} in monthly savings.`;
  } else {
    status = "no-flexible-categories";
    message = `The recorded entries leave ${formatRupees(availableToSave)} per month before these suggestions. Tell me which category could change to explore saving more.`;
  }

  if (!isComplete) {
    message = `Draft based on entries so far: ${message} Add remaining entries and mark the month complete for a fuller estimate. Missing categories are not treated as zero.`;
  }

  return {
    status,
    message,
    region,
    isComplete,
    incomeEntryCount,
    expenseEntryCount,
    monthlySavingsTarget,
    currentBalance,
    totalCut,
    afterBalance,
    availableToSave,
    targetGap,
    cuts,
  };
}


// Match a short user message to a known tracker category and their constraint.
export function interpretConstraintMessage(message, contextCategory = null) {
  const text = String(message ?? "").toLowerCase();
  const categoryPatterns = [
    ["Food and groceries", /\b(food|grocer(?:y|ies)|ration)\b|खाद्य|किराना|राशन/],
    ["Housing and rent", /\b(rent|housing|accommodation)\b|किराया|मकान|आवास/],
    ["Utilities", /\b(utilities|electricity|water bill|internet bill)\b|बिजली|पानी का बिल|इंटरनेट/],
    ["Transport", /\b(transport|fuel|commut(?:e|ing)|travel)\b|परिवहन|यात्रा|ईंधन|पेट्रोल/],
    ["Health", /\b(health|medicine|medical)\b|स्वास्थ्य|दवा|चिकित्सा/],
    ["Education", /\b(education|school|tuition|fees)\b|शिक्षा|स्कूल|ट्यूशन|फ़ीस/],
    [EMI_CATEGORY, /\b(emi|loan|installments?|instalments?)\b|ईएमआई|ऋण/],
    ["Family support", /\b(family support|supporting (?:my )?family|send money home)\b|परिवार की मदद|परिवार को पैसे/],
    ["Personal", /\b(personal|shopping|eating out|entertainment)\b|व्यक्तिगत|खरीदारी|मनोरंजन/],
    ["Other", /\bother\b|अन्य/],
  ];
  const match = categoryPatterns.find(([, pattern]) => pattern.test(text))
    ?? (contextCategory && (/\b(it|that|this|same)\b|^\s*(fixed|unchanged|yes|no)\b/.test(text)
      || /(?:इसे|वह|यह|उसे|इसका|उसका|तय|स्थिर|हाँ|नहीं)/.test(text))
      ? [contextCategory, null]
      : null);

  if (!match) {
    return { type: "unknown-category" };
  }

  const category = match[0];
  if (category === EMI_CATEGORY) {
    return { type: "protected", category };
  }

  const fixedPattern = /\b(can't|cannot|unable to|non[- ]negotiable|unavoidable|must keep|need to keep|not reduce|can't cut|cannot cut|(?:is|are|stays?) fixed)\b/;
  const hindiFixedPattern = /नहीं\s*(?:घटा|कम|बदल)|कम\s*नहीं|घटा\s*नहीं|तय\s*(?:है|रहे)|स्थिर|ज़रूरी\s*है/;
  const saysFixed = fixedPattern.test(text)
    || hindiFixedPattern.test(text)
    || (/\bfixed\b/.test(text) && !/\bnot fixed\b/.test(text));
  if (saysFixed) {
    return { type: "fixed", category };
  }

  const reducePattern = /\b(can|could|able to|willing to|okay to|ok to|allow(?:ed)? to)?\s*(reduce|cut|lower|trim|save on)\b/;
  const hindiReducePattern = /कम\s*कर|घटा|बचा|कटौती\s*कर/;
  if (!reducePattern.test(text) && !hindiReducePattern.test(text)) {
    return { type: "needs-choice", category };
  }

  // Accept an optional rupee symbol and commas, such as “by ₹2,000”.
  const amountMatch = text.match(/\bby\s*₹?\s*([\d,]+(?:\.\d{1,2})?)/)
    ?? text.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
  const maximum = amountMatch ? Number(amountMatch[1].replaceAll(",", "")) : null;
  return {
    type: "adjustable",
    category,
    maximum: Number.isFinite(maximum) ? Math.max(0, maximum) : null,
  };
}


function formatRupees(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}
