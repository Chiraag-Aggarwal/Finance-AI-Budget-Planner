// Dashboard uses the signed-in account's saved totals and the same planner calculations.
// Empty accounts show prompts instead of invented example balances.

import { calculatePlan, validateProfile } from "./finance_calculations.mjs";
import { summarizeMonth, validateTransaction } from "./budget_tracker.mjs";
import { loadFinanceData } from "./finance_data.mjs";
import { createPageScope } from "./page_scope.mjs";

// Mount this page inside the persistent layout; dispose it when leaving.
export function mountPage(root, user) {
  const scope = createPageScope(root);
  // This is a view of saved account data. It does not create another budget model.
  const currency = new Intl.NumberFormat("en-IN", { style:"currency", currency:"INR", maximumFractionDigits:0 });
  const money = (value) => currency.format(value);
  const show = (id, value) => { scope.getById(id).textContent = value; };
  let ownerId = null;
  let dashboardData = null;

  function render(user) {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    const locale = window.financeLanguage?.() === "hi" ? "hi-IN" : "en-IN";
    show("dashboard-month", now.toLocaleDateString(locale, { month:"long", year:"numeric" }));
    const entries = Array.isArray(dashboardData.transactions)
      ? dashboardData.transactions.filter((entry) => validateTransaction(entry).isValid) : [];
    const summary = summarizeMonth(entries, month);
    show("dashboard-income", money(summary.totalIncome));
    show("dashboard-expenses", money(summary.totalExpenses));
    show("dashboard-balance", money(summary.monthlyBalance));
    show("dashboard-budget-note", "Entries so far. Missing expenses are not assumed to be zero.");

    const saved = dashboardData.plannerProfile;
    if (!saved || typeof saved !== "object") return;
    // Match the planner's current automatic EMI/term selection for older drafts.
    const profile = { ...saved, region:user.region, includeGoal:saved.includeGoal ?? true,
      preferredLoanTermMonths:null, maxComfortableNewEmi:null };
    if (!validateProfile(profile).isValid) {
      show("overview-status", "Complete your saved plan to see the overview.");
      return;
    }
    const plan = calculatePlan(profile);
    show("overview-income", money(profile.monthlyTakeHomeIncome));
    show("overview-balance", money(plan.cashFlow.balanceAfterListedCosts));
    show("overview-emergency", money(plan.emergencyFund.gap));
    show("overview-goal", money(plan.goal ? plan.goal.requiredMonthlySaving : plan.savingsPlan.monthlyAmount));
    show("overview-plan-label", plan.goal ? "Goal saving needed" : "Suggested monthly saving");
    show("overview-plan-hint", plan.goal ? "Per month to meet your timeline" : "Flexible amount for your future");
    show("overview-status", plan.cashFlow.monthlyShortfall > 0 ? "Monthly costs exceed income" : "Plan calculated from your entries");
    scope.getById("overview-balance").classList.toggle("warning", plan.cashFlow.monthlyShortfall > 0);
    show("dashboard-goal-note", plan.goal ? "Review your goal funding, loan options and comfortable repayment plan." : "Your plan focuses on saving for the future, without a specific goal.");
  }

  scope.onReady( async (event) => {
    ownerId = String(event.detail.id);
    const requestedOwner = ownerId;
    try {
      const data = await loadFinanceData();
      if (ownerId !== requestedOwner) return;
      dashboardData = data;
      render(event.detail);
    } catch (error) {
      if (ownerId !== requestedOwner) return;
      const alert = scope.getById("dashboard-error");
      alert.textContent = error.message; alert.hidden = false;
    }
  });
  scope.listen(window, "finance-user-logout", () => {
    ownerId = null; dashboardData = null;
    for (const id of ["overview-income","overview-balance","overview-emergency","overview-goal","dashboard-income","dashboard-expenses","dashboard-balance"]) show(id,"—");
    show("overview-status", "Waiting for your figures");
    show("dashboard-goal-note", "Add the details for your plan");
    scope.getById("dashboard-error").hidden = true;
  });
  scope.onDispose(() => { ownerId = null; });
  return { ready: scope.start(user), dispose: scope.dispose };
}
