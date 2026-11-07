/*
  Immediate, provisional spending estimates. Synthetic starter weights are public;
  private records are supplied only by the signed-in account's page instance.
  Closed means the calendar month ended, NOT that all its expenses were entered.
*/
import { TRANSACTION_CATEGORIES, validateTransaction } from "./budget_tracker.mjs";
import { STARTER_MODELS } from "./starter_models.mjs";

const variableCategories = new Set(["Food and groceries", "Transport", "Personal", "Other"]);
const monthOf = (date) =>
  String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0");
const monthNumber = (month) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
const monthFromNumber = (n) =>
  String(Math.floor(n / 12)) + "-" + String((n % 12) + 1).padStart(2, "0");

// Recompute when entries change, when the page opens, and at midnight.
// No fabricated zero entries or claims of complete reporting are created.
export function closedBudgetMonths(transactions, now = new Date()) {
  return [
    ...new Set(
      (Array.isArray(transactions) ? transactions : [])
        .filter((entry) => validateTransaction(entry).isValid)
        .map((entry) => entry.date.slice(0, 7))
        .filter((month) => month < monthOf(now)),
    ),
  ]
    .sort()
    .slice(-120);
}

// Use the same five features as the Python trainer, then blend with the daily-rate baseline.
function starterAmount(observed, progress, count) {
  const model = STARTER_MODELS.forecast;
  const p = Math.max(0.1, Math.min(1, progress));
  const n = Math.log1p(Math.min(count, 60));
  const features = [1, p, p * p, n, p * n];
  const logRatio = features.reduce((sum, x, i) => sum + x * model.coefficients[i], 0);
  const learned = observed * Math.max(1, Math.min(model.maximumMultiplier, Math.exp(logRatio)));
  return model.blend * learned + ((1 - model.blend) * observed) / p;
}

// Fit a simple trend but limit its adjustment around recent observed spending.
function personalTrend(points, targetMonth) {
  if (points.length === 1) return points[0].amount;
  // Actual month indices preserve gaps. An unrecorded category stays unknown.
  const x = points.map((item) => monthNumber(item.month));
  const meanX = x.reduce((a, b) => a + b) / x.length;
  const meanY = points.reduce((sum, item) => sum + item.amount, 0) / points.length;
  const denominator = x.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  const slope = denominator
    ? points.reduce((sum, item, i) => sum + (x[i] - meanX) * (item.amount - meanY), 0) / denominator
    : 0;
  const recent = points.slice(-3);
  const average = recent.reduce((sum, item) => sum + item.amount, 0) / recent.length;
  const line = meanY + slope * (monthNumber(targetMonth) - meanX);
  return Math.max(
    0,
    average + Math.max(-average * 0.25, Math.min(average * 0.25, (line - average) * 0.5)),
  );
}

// completedMonths is accepted for old callers but no longer controls eligibility.
export function forecastNextMonthSpending(
  transactions,
  completedMonths = [],
  now = new Date(),
  plannerProfile = null,
) {
  const current = monthOf(now);
  const targetMonth = monthFromNumber(monthNumber(current) + 1);
  const today = current + "-" + String(now.getDate()).padStart(2, "0");
  const entries = (Array.isArray(transactions) ? transactions : []).filter(
    (entry) =>
      validateTransaction(entry).isValid &&
      entry.type === "expense" &&
      entry.date <= today &&
      monthNumber(current) - monthNumber(entry.date.slice(0, 7)) <= 6,
  );
  const historyMonths = closedBudgetMonths(entries, now);
  const categories = [];
  for (const category of TRANSACTION_CATEGORIES.expense) {
    const records = entries.filter((entry) => entry.category === category);
    if (!records.length) continue;
    const totals = new Map();
    for (const entry of records) {
      const month = entry.date.slice(0, 7);
      totals.set(month, (totals.get(month) || 0) + entry.amount);
    }
    const latest = [...totals.keys()].sort().at(-1);
    if (monthNumber(current) - monthNumber(latest) > 1) continue;
    const points = [...totals.entries()]
      .filter(([m]) => m < current)
      .sort()
      .slice(-6)
      .map(([month, amount]) => ({ month, amount }));
    const present = records.filter((entry) => entry.date.startsWith(current));
    let amount, source;
    if (present.length) {
      const observed = totals.get(current);
      const days = new Set(present.map((entry) => entry.date));
      // A single purchase or a fixed bill is not multiplied by days in the month.
      if (variableCategories.has(category) && days.size >= 2) {
        const firstDay = Math.min(...present.map((entry) => Number(entry.date.slice(8))));
        const windowDays = now.getDate() - firstDay + 1;
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        amount = starterAmount(observed, windowDays / daysInMonth, present.length);
        source = "synthetic-starter";
      } else {
        amount = observed;
        source = "recorded-amount";
      }
      if (points.length && variableCategories.has(category)) {
        const trend = personalTrend(points, targetMonth);
        const weight = Math.min(0.75, points.length / (points.length + 2));
        amount = (1 - weight) * amount + weight * trend;
        source = "personal-blend";
      }
    } else {
      amount = personalTrend(points, targetMonth);
      source = points.length >= 2 ? "personal-trend" : "recorded-amount";
    }
    categories.push({ category, amount: Math.round(amount), source });
  }

  // A brand-new account can start from its explicit monthly planner totals.
  // Do not invent how essentials split into rent, food, health, etc.
  if (!categories.length && plannerProfile && typeof plannerProfile === "object") {
    for (const [field, category] of [
      ["monthlyEssentialExpenses", "Essential expenses (plan)"],
      ["monthlyDiscretionaryExpenses", "Flexible expenses (plan)"],
      ["monthlyDebtPayment", "Loan EMI"],
    ]) {
      const amount = plannerProfile[field];
      if (typeof amount === "number" && Number.isFinite(amount) && amount > 0 && amount <= 1e9)
        categories.push({ category, amount: Math.round(amount), source: "planner-input" });
    }
  }
  categories.sort((a, b) => b.amount - a.amount);
  return {
    status: categories.length ? "ready" : "needs-input",
    targetMonth,
    historyMonths,
    categories,
    total: categories.reduce((sum, item) => sum + item.amount, 0),
    provisional: true,
    usesSyntheticStarter: categories.some(
      (item) => item.source === "synthetic-starter" || item.source === "personal-blend",
    ),
  };
}
