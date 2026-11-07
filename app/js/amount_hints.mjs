import { monthlySuggestions } from "./planning_helpers.mjs";

const tr = text => window.financeTranslate?.(text) || text;
const money = amount => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 0,
}).format(amount);

// Non-modal popovers are attached to the actual amount fields, not extra dropdowns.
export function mountAmountHints(root, scope, entries, useAmount) {
  const months = monthlySuggestions(entries);
  let current = null;
  function close() {
    if (!current) return;
    current.popup.hidden = true;
    current.input.setAttribute("aria-expanded", "false");
    current.wrap.classList.remove("suggestion-open");
    current = null;
  }

  for (const field of ["monthlyTakeHomeIncome", "monthlyEssentialExpenses",
    "monthlyDiscretionaryExpenses", "monthlyDebtPayment"]) {
    const input = root.querySelector('[name="' + field + '"]');
    const wrap = input.closest(".amount-input-wrap");
    const matches = months.filter(month => Number.isFinite(month.values[field])).slice(0, 3);
    if (!matches.length) continue;

    const popup = document.createElement("div");
    popup.className = "amount-popover";
    popup.id = field + "-suggestions";
    popup.hidden = true;
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", tr("Suggested amounts from your budget"));
    const heading = document.createElement("strong");
    heading.textContent = tr("From your monthly budget");
    const explanation = document.createElement("p");
    explanation.textContent = tr("Choose an amount to use. These totals include only your recorded entries.");
    popup.append(heading, explanation);

    matches.forEach(month => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-choice";
      const label = document.createElement("span");
      label.textContent = new Date(month.month + "-01T12:00:00").toLocaleDateString(
        window.financeLanguage?.() === "hi" ? "hi-IN" : "en-IN",
        {month: "short", year: "numeric"},
      );
      const amount = document.createElement("strong");
      amount.textContent = money(month.values[field]);
      const source = document.createElement("small");
      source.textContent = tr(month.current ? "This month so far" : "Past month · recorded total");
      button.append(label, amount, source);
      button.addEventListener("click", () => {
        useAmount(field, Math.round(month.values[field] * 100) / 100);
        close();
        // Focus without reopening the popover immediately after choosing.
        suppressFocus = true;
        input.focus({preventScroll: true});
        suppressFocus = false;
      });
      popup.append(button);
    });
    if (field === "monthlyEssentialExpenses" || field === "monthlyDiscretionaryExpenses") {
      const note = document.createElement("small");
      note.textContent = tr("Using a total replaces this expense breakdown.");
      popup.append(note);
    }
    wrap.append(popup);
    input.setAttribute("aria-controls", popup.id);
    input.setAttribute("aria-haspopup", "dialog");
    input.setAttribute("aria-expanded", "false");
    let suppressFocus = false;

    function show() {
      if (suppressFocus) return;
      close();
      popup.hidden = false;
      const box = wrap.getBoundingClientRect();
      popup.classList.toggle("opens-up", box.bottom + popup.offsetHeight > window.innerHeight - 16 && box.top > popup.offsetHeight + 16);
      input.setAttribute("aria-expanded", "true");
      wrap.classList.add("suggestion-open");
      current = {input, wrap, popup};
    }
    scope.listen(input, "focus", show);
    scope.listen(input, "click", show);
    scope.listen(input, "input", close);
    scope.listen(input, "keydown", event => {
      if (event.key === "ArrowDown" && !popup.hidden) {
        event.preventDefault();
        popup.querySelector("button").focus();
      }
    });
  }

  scope.listen(document, "pointerdown", event => {
    if (current && !current.wrap.contains(event.target)) close();
  });
  scope.listen(document, "focusin", event => {
    if (current && !current.wrap.contains(event.target)) close();
  });
  scope.listen(document, "keydown", event => {
    if (event.key !== "Escape" || !current) return;
    const input = current.input;
    close();
    // The input may already have focus; prevent its focus handler reopening.
    input.focus({preventScroll: true});
    close();
    event.preventDefault();
  });
  scope.onDispose(close);
  return {close};
}
