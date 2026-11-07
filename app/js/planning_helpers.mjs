// These helpers summarise the user's own records. They do not estimate local prices.
export const EXPENSE_CHOICES = Object.freeze({
  essentialItems: ["Rent / home costs", "Groceries", "Electricity / water / gas", "Travel to work", "Healthcare", "Education", "Family support", "Insurance", "Other"],
  personalItems: ["Eating out", "Shopping", "Subscriptions", "Entertainment", "Hobbies", "Holidays", "Gifts", "Other"],
});
export const GOAL_NAMES = Object.freeze({
  saving: "Future savings", car: "Car", bike: "Bike / scooter", laptop: "Laptop / computer",
  home: "Home", plot: "Plot / land", farm: "Farm", renovation: "Home repairs", business: "Business",
  education: "Education", medical: "Medical costs", wedding: "Wedding", travel: "Travel",
  phone: "Phone", appliance: "Appliance", moving: "Moving home", baby: "New baby",
  celebration: "Family celebration", other: "Another goal",
});
export function sumExpenseItems(items) {
  if (!Array.isArray(items) || items.length > 30) throw new Error("Use up to 30 expense items.");
  for (const item of items) {
    if (!item.name?.trim() || item.name.length > 80 || !Number.isFinite(item.amount) || item.amount < 0) {
      throw new Error("Give every expense a name and an amount of zero or more.");
    }
  }
  const total = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  if (total > 10000000) throw new Error("The monthly total must be below ₹1 crore.");
  return total;
}
export function monthlySuggestions(entries, now = new Date()) {
  const current = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const months = new Map();
  const essentials = new Set(["Food and groceries", "Housing and rent", "Utilities", "Transport", "Health", "Education", "Family support"]);
  for (const entry of entries || []) {
    const month = entry.date?.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > current || !Number.isFinite(entry.amount) || entry.amount <= 0) continue;
    const field = entry.type === "income" ? "monthlyTakeHomeIncome"
      : entry.type !== "expense" ? null : entry.category === "Loan EMI" ? "monthlyDebtPayment"
      : essentials.has(entry.category) ? "monthlyEssentialExpenses"
      : entry.category === "Personal" ? "monthlyDiscretionaryExpenses" : null;
    if (!field) continue; // Unclassified "Other" is not automatically essential or personal.
    const values = months.get(month) || {};
    values[field] = (values[field] || 0) + entry.amount;
    months.set(month, values);
  }
  return [...months].sort(([a],[b]) => b.localeCompare(a)).slice(0,6)
    .map(([month,values]) => ({month, current: month === current, values}));
}
export function upsertGoal(plans, id, name, profile, now = new Date().toISOString()) {
  if (!name.trim() || name.trim().length > 80) throw new Error("Give this plan a short name.");
  const previous = plans.find(plan => plan.id === id);
  const {activeGoalId, ...snapshot} = structuredClone(profile);
  const goal = {id, name: name.trim(), category: profile.includeGoal ? profile.goalType : "saving",
    profile: snapshot, createdAt: previous?.createdAt || now, updatedAt: now};
  return previous ? plans.map(plan => plan.id === id ? goal : plan) : [...plans, goal];
}
