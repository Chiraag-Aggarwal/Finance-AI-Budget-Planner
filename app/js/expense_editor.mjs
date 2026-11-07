import { EXPENSE_CHOICES, sumExpenseItems } from "./planning_helpers.mjs";

const tr = text => window.financeTranslate?.(text) || text;
// Expense rows are always visible. A valid edit immediately updates the total.
export function createExpenseEditors(root, scope, onChange) {
  const form = root.querySelector("#finance-form");
  const editors = {};

  for (const [key, choices] of Object.entries(EXPENSE_CHOICES)) {
    const fieldName = key === "essentialItems"
      ? "monthlyEssentialExpenses" : "monthlyDiscretionaryExpenses";
    const totalInput = form.elements.namedItem(fieldName);
    const host = root.querySelector('[data-expense-editor="' + key + '"]');
    const rows = host.querySelector(".expense-rows");
    const error = host.querySelector(".expense-error");
    const manualButton = host.querySelector("[data-manual-total]");
    let editing = [];
    let lastComplete = [];

    function readTotal() {
      return sumExpenseItems(editing);
    }

    function sync(notify = true) {
      manualButton.hidden = editing.length === 0;
      totalInput.readOnly = editing.length > 0;
      try {
        const total = readTotal();
        lastComplete = structuredClone(editing);
        if (editing.length > 0 || notify) totalInput.value = total;
        error.textContent = "";
      } catch {
        // Keep the last complete numbers until the unfinished row is corrected.
        // Calculation and navigation also check this, so it cannot go unnoticed.
        error.textContent = tr("Finish the expense name and amount to update the total.");
      }
      if (notify) onChange();
    }

    function draw() {
      rows.replaceChildren();
      editing.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "expense-row";
        const categoryBox = document.createElement("div");
        categoryBox.className = "expense-category-box";
        const select = document.createElement("select");
        select.setAttribute("aria-label", tr("Expense category"));
        choices.forEach(choice => select.add(new Option(tr(choice), choice)));
        const isCustom = !choices.includes(item.name) || item.name === "Other";
        select.value = isCustom ? "Other" : item.name;

        // "Other" replaces the category selector with a text box in the same slot.
        const custom = document.createElement("input");
        custom.type = "text";
        custom.maxLength = 80;
        custom.placeholder = tr("Name this expense");
        custom.setAttribute("aria-label", tr("Other expense name"));
        custom.value = isCustom && item.name !== "Other" ? item.name : "";
        const chooseAgain = document.createElement("button");
        chooseAgain.type = "button";
        chooseAgain.className = "choose-expense-again";
        chooseAgain.textContent = "↶";
        chooseAgain.setAttribute("aria-label", tr("Choose an expense category"));
        function customMode(enabled) {
          select.hidden = enabled;
          custom.hidden = chooseAgain.hidden = !enabled;
          categoryBox.classList.toggle("is-custom", enabled);
        }
        customMode(isCustom);

        const amount = document.createElement("input");
        amount.type = "number";
        amount.min = "0";
        amount.max = "10000000";
        amount.step = "0.01";
        amount.inputMode = "decimal";
        amount.value = item.amount ?? "";
        amount.placeholder = "₹";
        amount.setAttribute("aria-label", tr("Monthly amount"));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "item-remove";
        remove.textContent = "×";
        remove.setAttribute("aria-label", tr("Remove expense"));

        select.addEventListener("change", () => {
          const other = select.value === "Other";
          item.name = other ? custom.value : select.value;
          customMode(other);
          if (other) custom.focus();
          sync();
        });
        chooseAgain.addEventListener("click", () => {
          item.name = choices[0];
          select.value = choices[0];
          customMode(false);
          select.focus();
          sync();
        });
        custom.addEventListener("input", () => { item.name = custom.value; sync(); });
        amount.addEventListener("input", () => {
          item.amount = amount.value === "" ? null : Number(amount.value);
          sync();
        });
        remove.addEventListener("click", () => {
          editing.splice(index, 1);
          draw();
          sync();
          host.querySelector("[data-add-expense]").focus();
        });
        categoryBox.append(select, custom, chooseAgain);
        row.append(categoryBox, amount, remove);
        rows.append(row);
      });
      host.querySelector("[data-add-expense]").disabled = editing.length >= 30;
    }

    scope.listen(host.querySelector("[data-add-expense]"), "click", () => {
      if (editing.length >= 30) return;
      editing.push({name: choices[0], amount: null});
      draw();
      sync();
      rows.lastElementChild.querySelector('input[type="number"]').focus();
    });
    scope.listen(manualButton, "click", () => {
      editing = [];
      lastComplete = [];
      totalInput.readOnly = false;
      error.textContent = "";
      draw();
      manualButton.hidden = true;
      onChange();
      totalInput.focus(); // Keep the total; the user can now type a different one.
    });

    editors[key] = {
      restore(items = []) {
        editing = structuredClone(items);
        lastComplete = structuredClone(items);
        error.textContent = "";
        draw();
        sync(false);
      },
      read() { return structuredClone(lastComplete); },
      validate() {
        try { readTotal(); return null; }
        catch {
          error.textContent = tr("Finish or remove the incomplete expense row.");
          return "Finish or remove the incomplete expense row.";
        }
      },
    };
    editors[key].restore();
  }

  function errors() {
    return [...new Set(Object.values(editors).map(editor => editor.validate()).filter(Boolean))];
  }
  scope.registerSave(() => {
    const problems = errors();
    if (problems.length) throw new Error(tr(problems[0]));
  });

  return {
    restore(profile) {
      for (const [key, editor] of Object.entries(editors)) editor.restore(profile[key] || []);
    },
    clear(key) { editors[key]?.restore([]); },
    read() { return Object.fromEntries(Object.entries(editors).map(([key, editor]) => [key, editor.read()])); },
    errors,
  };
}
