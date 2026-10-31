/*
  A personal spending forecast trained only on the signed-in user's own cash
  expenses from months they explicitly marked complete.

  It fits a straight line to recent monthly totals, then tempers the trend
  toward the recent average to reduce sudden jumps.
*/
import { TRANSACTION_CATEGORIES } from "./budget_tracker.mjs";

const MINIMUM_MONTHS = 3;
const MAX_HISTORY_MONTHS = 6;

function monthNumber(month) {
  const parts = month.split("-").map(Number);
  return parts[0] * 12 + parts[1] - 1;
}

function formatMonth(date) {
  return String(date.getFullYear()) + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

function nextMonth(month) {
  const value = monthNumber(month) + 1;
  const year = Math.floor(value / 12);
  const monthValue = value % 12 + 1;
  return String(year) + "-" + String(monthValue).padStart(2, "0");
}

function isMonth(value) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const parts = value.split("-").map(Number);
  return parts[0] >= 1900 && parts[0] <= 9999;
}

function trendFor(values, horizon) {
  const count = values.length;
  const meanX = (count - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let denominator = 0;

  for (let index = 0; index < count; index += 1) {
    numerator += (index - meanX) * (values[index] - meanY);
    denominator += (index - meanX) ** 2;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const linePrediction = meanY + slope * ((count - 1 + horizon) - meanX);
  const recentValues = values.slice(-3);
  const recentAverage = recentValues.reduce((sum, value) => sum + value, 0) / recentValues.length;

  // Keep half the predicted trend, capped at a 25% change from the recent average.
  const dampedChange = (linePrediction - recentAverage) * 0.5;
  const maximumChange = recentAverage * 0.25;
  const adjusted = recentAverage + Math.max(-maximumChange, Math.min(maximumChange, dampedChange));
  return Math.max(0, Math.round(adjusted));
}

export function forecastNextMonthSpending(transactions, completedMonths, now = new Date()) {
  const currentMonth = formatMonth(now);
  const targetMonth = nextMonth(currentMonth);
  const completed = new Set(
    (Array.isArray(completedMonths) ? completedMonths : [])
      .filter(isMonth)
      .filter((month) => monthNumber(month) <= monthNumber(currentMonth)),
  );
  const completedList = [...completed].sort();
  const latestMonth = completedList.at(-1);

  if (!latestMonth || monthNumber(currentMonth) - monthNumber(latestMonth) > 1) {
    return { status: "needs-recent-month", targetMonth, historyMonths: [], categories: [], total: 0 };
  }

  // Use only the latest unbroken run. A missing month is never filled with zero.
  const consecutiveMonths = [latestMonth];
  let cursor = latestMonth;
  while (consecutiveMonths.length < MAX_HISTORY_MONTHS) {
    const previousNumber = monthNumber(cursor) - 1;
    const previousYear = Math.floor(previousNumber / 12);
    const previousMonthValue = previousNumber % 12 + 1;
    const previous = String(previousYear) + "-" + String(previousMonthValue).padStart(2, "0");
    if (!completed.has(previous)) break;
    consecutiveMonths.push(previous);
    cursor = previous;
  }
  const historyMonths = consecutiveMonths.reverse();

  if (historyMonths.length < MINIMUM_MONTHS) {
    return { status: "needs-more-history", targetMonth, historyMonths, categories: [], total: 0 };
  }

  const expenseCategories = TRANSACTION_CATEGORIES.expense;
  const totalsByMonth = new Map(historyMonths.map((month) => [month, new Map()]));

  for (const entry of Array.isArray(transactions) ? transactions : []) {
    if (
      entry?.type !== "expense"
      || !expenseCategories.includes(entry.category)
      || typeof entry.date !== "string"
      || !Number.isFinite(entry.amount)
      || entry.amount <= 0
    ) continue;

    const month = entry.date.slice(0, 7);
    const monthTotals = totalsByMonth.get(month);
    if (monthTotals) {
      monthTotals.set(entry.category, (monthTotals.get(entry.category) ?? 0) + entry.amount);
    }
  }

  const horizon = monthNumber(targetMonth) - monthNumber(historyMonths.at(-1));
  const categories = expenseCategories
    .map((category) => {
      const values = historyMonths.map((month) => totalsByMonth.get(month).get(category) ?? 0);
      if (values.every((value) => value === 0)) return null;
      return { category, amount: trendFor(values, horizon) };
    })
    .filter((item) => item && item.amount > 0)
    .sort((first, second) => second.amount - first.amount);

  return {
    status: "ready",
    targetMonth,
    historyMonths,
    total: categories.reduce((sum, item) => sum + item.amount, 0),
    categories,
  };
}
