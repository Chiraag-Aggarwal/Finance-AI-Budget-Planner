import { loadFinanceData, saveFinanceDataField } from "./finance_data.mjs";
import { GOAL_NAMES, upsertGoal } from "./planning_helpers.mjs";
import { validateProfile } from "./finance_calculations.mjs";
import { createExpenseEditors } from "./expense_editor.mjs";
import { mountAmountHints } from "./amount_hints.mjs";

const tr = text => window.financeTranslate?.(text) || text;
const rupees = value => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 0,
}).format(value);
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function createPlannerTools(root, scope, hooks) {
  const form = root.querySelector("#finance-form");
  const list = root.querySelector("#saved-goals");
  const name = root.querySelector("#goal-plan-name");
  const message = root.querySelector("#goal-library-message");
  const saveButton = root.querySelector("#save-goal-plan");
  const home = root.querySelector("#planner-home");
  const chooser = root.querySelector("#goal-chooser");
  const editor = root.querySelector("#planner-editor");
  const resultSection = root.querySelector("#results");
  const resume = root.querySelector("#continue-draft");
  const goalSelect = form.elements.namedItem("goalType");
  const expenseEditors = createExpenseEditors(root, scope, hooks.changed);
  let plans = [];
  let activeId = null;
  let loaded = false;
  let saving = false;
  let isNewGoal = false;
  let hints = null;

  // These are three views of the same planner, so no extra sign-in/page load is needed.
  function showView(view) {
    hints?.close();
    root.dataset.plannerView = view;
    home.hidden = view !== "home";
    chooser.hidden = view !== "choose";
    editor.hidden = resultSection.hidden = view !== "edit";
    root.querySelector("#planner-required-note").hidden = view !== "edit";
  }

  function chosenGoalName() {
    root.querySelector("#chosen-goal-name").textContent =
      tr(GOAL_NAMES[goalSelect.value] || "Another goal");
  }

  function focusHome() {
    showView("home");
    root.querySelector("#add-new-goal").focus({preventScroll: true});
    home.scrollIntoView({behavior: "smooth", block: "start"});
  }

  function drawPlans() {
    list.replaceChildren();
    root.querySelector("#saved-goals-empty").hidden = plans.length > 0;
    for (const category of [...new Set(plans.map(plan => plan.category))]) {
      const group = node("section", undefined, "goal-group");
      group.append(node("h3", tr(GOAL_NAMES[category] || "Another goal")));
      const cards = node("div", undefined, "saved-goal-grid");

      for (const plan of plans.filter(item => item.category === category)) {
        const card = node("article", undefined, "saved-goal-card");
        if (plan.id === activeId) card.classList.add("is-editing");
        const title = node("strong", plan.name);
        const amount = node("p", plan.profile.includeGoal
          ? rupees(plan.profile.goalPrice) : tr("Monthly savings plan"));
        const open = node("button", tr("Open"), "button button-quiet");
        const edit = node("button", tr("Edit"), "button button-quiet");
        open.type = edit.type = "button";
        open.setAttribute("aria-label", tr("Open") + " " + plan.name);
        edit.setAttribute("aria-label", tr("Edit") + " " + plan.name);

        function activate() {
          if (saving) return false;
          activeId = plan.id;
          name.value = plan.name;
          hooks.fill({...structuredClone(plan.profile), activeGoalId: plan.id});
          showView("edit");
          hooks.changed();
          drawPlans();
          hooks.calculate();
          return true;
        }
        open.addEventListener("click", () => {
          if (activate()) resultSection.scrollIntoView({behavior: "smooth"});
        });
        edit.addEventListener("click", () => {
          if (!activate()) return;
          form.scrollIntoView({behavior: "smooth"});
          root.querySelector("#chosen-goal-name").focus({preventScroll: true});
        });
        card.append(title, amount, open, edit);
        cards.append(card);
      }
      group.append(cards);
      list.append(group);
    }
  }

  // Reuse the existing goal values; the user now chooses them as visual cards.
  const icons = {
    saving: "✦", car: "🚗", bike: "🛵", laptop: "💻", home: "🏠", plot: "⌖",
    farm: "🌱", renovation: "🛠", business: "💼", education: "🎓", medical: "♡",
    wedding: "💍", travel: "✈", phone: "📱", appliance: "▣",
    moving: "📦", baby: "🧸", celebration: "🎉", other: "+",
  };
  for (const option of goalSelect.options) {
    const button = node("button", undefined, "goal-choice-card");
    button.type = "button";
    button.dataset.goalChoice = option.value;
    const icon = node("span", icons[option.value] || "✦", "goal-choice-icon");
    icon.setAttribute("aria-hidden", "true");
    button.append(icon, node("span", option.textContent));
    scope.listen(button, "click", () => {
      if (isNewGoal) {
        activeId = null;
        name.value = "";
        message.textContent = "";
        hooks.newGoal();
      }
      isNewGoal = false;
      goalSelect.value = option.value;
      goalSelect.dispatchEvent(new Event("change", {bubbles: true}));
      chosenGoalName();
      resume.hidden = false;
      showView("edit");
      root.querySelector("#chosen-goal-name").focus({preventScroll: true});
      editor.scrollIntoView({behavior: "smooth", block: "start"});
    });
    root.querySelector("#goal-choice-grid").append(button);
  }

  scope.listen(root.querySelector("#add-new-goal"), "click", () => {
    if (saving || !loaded) return;
    isNewGoal = true;
    showView("choose");
    root.querySelector("#goal-chooser-title").focus({preventScroll: true});
  });
  scope.listen(root.querySelector("#change-goal"), "click", () => {
    if (expenseEditors.errors().length) return;
    isNewGoal = false;
    showView("choose");
    root.querySelector("#goal-chooser-title").focus({preventScroll: true});
  });
  root.querySelectorAll("[data-back-goals]").forEach(button => {
    scope.listen(button, "click", () => {
      if (saving || expenseEditors.errors().length) return;
      focusHome();
    });
  });
  scope.listen(resume, "click", () => {
    if (!loaded) return;
    showView("edit");
    chosenGoalName();
    root.querySelector("#chosen-goal-name").focus({preventScroll: true});
  });

  scope.listen(saveButton, "click", async () => {
    if (!loaded || saving) return;
    const profile = hooks.read();
    if (!validateProfile(profile).isValid || expenseEditors.errors().length) {
      hooks.calculate();
      return;
    }
    hooks.calculate();
    let next;
    try {
      next = upsertGoal(plans, activeId || crypto.randomUUID(), name.value, profile);
    } catch (error) {
      message.textContent = tr(error.message);
      name.focus();
      return;
    }
    if (next.length > 100) {
      message.textContent = tr("Save up to 100 goal plans.");
      return;
    }
    saving = true;
    saveButton.disabled = true;
    message.textContent = "";
    try {
      await saveFinanceDataField("goalPlans", next);
      if (!scope.active) return;
      plans = next;
      activeId = activeId || plans.at(-1).id;
      hooks.changed();
      drawPlans();
      root.querySelector("#goal-save-title").textContent = tr("Update this saved plan");
      root.querySelector("#goal-home-status").textContent = tr("Your goal plan is saved.");
      focusHome();
    } catch (error) {
      if (scope.active) message.textContent = tr(error.message);
    } finally {
      saving = false;
      if (scope.active) saveButton.disabled = false;
    }
  });

  // Clicking Planner in the menu returns to the overview, even from this same route.
  scope.listen(window, "finance-page-open", event => {
    if (event.detail.path !== "/planner.html") return;
    showView(event.detail.hash === "#results" ? "edit" : "home");
  });

  showView("home");
  return {
    get activeId() { return activeId; },
    readItems() { return expenseEditors.read(); },
    expenseErrors() { return expenseEditors.errors(); },
    restore(profile) {
      expenseEditors.restore(profile);
      activeId = plans.some(plan => plan.id === profile.activeGoalId) ? profile.activeGoalId : null;
      name.value = plans.find(plan => plan.id === activeId)?.name || "";
      resume.hidden = Object.keys(profile).length === 0;
      root.querySelector("#goal-save-title").textContent =
        tr(activeId ? "Update this saved plan" : "Keep this plan");
      chosenGoalName();
      drawPlans();
    },
    async load() {
      loaded = false;
      const data = await loadFinanceData();
      if (!scope.active) return;
      plans = Array.isArray(data.goalPlans) ? structuredClone(data.goalPlans) : [];
      loaded = true;
      drawPlans();
      hints = mountAmountHints(root, scope, data.transactions || [], (field, amount) => {
        const key = field === "monthlyEssentialExpenses" ? "essentialItems"
          : field === "monthlyDiscretionaryExpenses" ? "personalItems" : null;
        if (key) expenseEditors.clear(key);
        form.elements.namedItem(field).value = amount;
        hooks.changed();
      });
    },
  };
}
