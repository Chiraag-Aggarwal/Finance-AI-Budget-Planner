// Document workflow: upload -> editable preview -> validate -> save selected rows.
// Python extracts the table; the account-scoped category helper only suggests categories.
// hooks connects this view to the budget page without owning another copy of its entries.

import { createCategoryHelper } from "./category_starter.mjs";
import { TRANSACTION_CATEGORIES, validateTransaction } from "./budget_tracker.mjs";
import { waitForFinanceSaves } from "./finance_data.mjs";
const tr = (text) => window.financeTranslate?.(text) || text;
// A matching date/type/amount/note flags a possible duplicate for review, not automatic deletion.
const fingerprint = (row) =>
  [row.date, row.type, Number(row.amount).toFixed(2), (row.note || "").trim().toLowerCase()].join(
    "|",
  );
function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountBudgetDocuments(root, scope, owner, hooks) {
  const fileInput = root.querySelector("#budget-document");
  if (!fileInput) return;
  const button = root.querySelector("#read-budget-document");
  const preview = root.querySelector("#import-preview");
  const body = root.querySelector("#import-rows");
  const message = root.querySelector("#import-message");
  const save = root.querySelector("#save-import");
  const controller = new AbortController();
  const categoryHelper = createCategoryHelper(owner);
  let rows = [],
    page = 0,
    requestVersion = 0;
  scope.onDispose(() => {
    controller.abort();
    categoryHelper.dispose();
    rows = [];
    fileInput.value = "";
  });

  function report(text) {
    message.textContent = tr(text);
  }
  // Abort on page disposal and send the owner guard so late requests cannot cross accounts.
  async function fetchPrivate(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      credentials: "same-origin",
      signal: controller.signal,
      headers: { "X-Finance-Owner": String(owner), ...options.headers },
    });
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new CustomEvent("finance-session-expired"));
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "The document request failed. Try again.");
    }
    return response;
  }
  // Render at most 25 editable rows; the full preview remains in this page instance.
  function draw() {
    body.replaceChildren();
    root.querySelector("#import-page").textContent = page + 1 + " / " + Math.ceil(rows.length / 25);
    root.querySelector("#import-previous").disabled = page === 0;
    root.querySelector("#import-next").disabled = (page + 1) * 25 >= rows.length;
    for (const row of rows.slice(page * 25, page * 25 + 25)) {
      const line = element("tr");
      const cell = (input) => {
        const td = element("td");
        td.append(input);
        line.append(td);
      };
      const selected = element("input");
      selected.type = "checkbox";
      selected.checked = row.selected;
      selected.setAttribute("aria-label", tr("Import this row"));
      selected.addEventListener("change", () => (row.selected = selected.checked));
      cell(selected);
      const date = element("input");
      date.type = "date";
      date.value = row.date;
      date.setAttribute("aria-label", tr("Transaction date"));
      date.addEventListener("input", () => (row.date = date.value));
      cell(date);
      const type = element("select");
      type.setAttribute("aria-label", tr("Entry type"));
      for (const [value, label] of [
        ["", "Choose"],
        ["income", "Income"],
        ["expense", "Expense"],
      ])
        type.add(new Option(tr(label), value));
      type.value = row.type;
      const category = element("select");
      category.setAttribute("aria-label", tr("Category"));
      function categories() {
        category.replaceChildren();
        for (const choice of TRANSACTION_CATEGORIES[row.type] || [])
          category.add(new Option(tr(choice), choice));
        if (!(TRANSACTION_CATEGORIES[row.type] || []).includes(row.category))
          row.category = row.type === "income" ? "Other income" : "Other";
        category.value = row.category;
      }
      type.addEventListener("change", () => {
        row.type = type.value;
        categories();
      });
      category.addEventListener("change", () => (row.category = category.value));
      categories();
      cell(type);
      cell(category);
      const amount = element("input");
      amount.type = "number";
      amount.min = "0.01";
      amount.max = "1000000000";
      amount.step = "0.01";
      amount.value = row.amount ?? "";
      amount.setAttribute("aria-label", tr("Amount in rupees"));
      amount.addEventListener(
        "input",
        () => (row.amount = amount.value === "" ? null : Number(amount.value)),
      );
      cell(amount);
      const note = element("input");
      note.type = "text";
      note.maxLength = 80;
      note.value = row.note;
      note.setAttribute("aria-label", tr("Short note"));
      note.addEventListener("input", () => (row.note = note.value));
      cell(note);
      const warning = element(
        "span",
        row.duplicate
          ? tr("Possible duplicate — check before selecting")
          : [...row.issues, ...(row.categorySuggested ? ["Suggested category — review"] : [])]
              .map(tr)
              .join(" · "),
      );
      cell(warning);
      body.append(line);
    }
  }
  // Reading a document creates a preview only. Saving is a separate, explicit step.
  scope.listen(button, "click", async () => {
    const file = fileInput.files?.[0];
    if (!file) {
      report("Choose a document first.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      report("Choose a file smaller than 4 MB.");
      return;
    }
    if (!hooks.ready()) {
      report("Wait for your saved entries to load, then try again.");
      return;
    }
    const version = ++requestVersion;
    button.disabled = true;
    preview.hidden = true;
    report("Reading your document…");
    try {
      const content = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("This file could not be read."));
        reader.readAsDataURL(file);
      });
      const response = await fetchPrivate("/api/budget/import-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          content,
          dateOrder: root.querySelector("#import-date-order").value,
        }),
      });
      const result = await response.json();
      if (!scope.active || version !== requestVersion) return;
      const seen = new Set(hooks.entries().map(fingerprint));
      rows = result.entries.map((entry) => {
        const duplicate = seen.has(fingerprint(entry));
        seen.add(fingerprint(entry));
        // The existing private helper can suggest a category; the preview keeps it editable.
        if (["Other", "Other income"].includes(entry.category) && entry.type) {
          const suggestion = categoryHelper.suggest(owner, hooks.entries(), entry.type, entry.note);
          if (suggestion.status === "suggestion") {
            entry.category = suggestion.category;
            entry.categorySuggested = true;
          }
        }
        return {
          ...entry,
          id: crypto.randomUUID(),
          duplicate,
          selected: !duplicate && entry.issues.length === 0,
        };
      });
      page = 0;
      preview.hidden = false;
      draw();
      report(result.notice);
      root.querySelector("#import-skipped").textContent =
        tr("Rows outside the transaction table:") + " " + result.skippedRows;
      preview.focus();
    } catch (error) {
      if (scope.active) report(error.message);
    } finally {
      if (scope.active) button.disabled = false;
    }
  });
  scope.listen(root.querySelector("#import-previous"), "click", () => {
    page--;
    draw();
  });
  scope.listen(root.querySelector("#import-next"), "click", () => {
    page++;
    draw();
  });
  scope.listen(root.querySelector("#cancel-import"), "click", () => {
    rows = [];
    preview.hidden = true;
    report("");
    fileInput.value = "";
  });
  // Revalidate edited rows and save only transaction fields, never preview metadata.
  scope.listen(save, "click", async () => {
    const selected = rows.filter((row) => row.selected);
    if (!selected.length) {
      report("Select at least one row to import.");
      return;
    }
    const entries = selected.map(({ id, date, type, category, amount, note }) => ({
      id,
      date,
      type,
      category,
      amount,
      note,
    }));
    if (entries.some((entry) => !validateTransaction(entry).isValid)) {
      report("Check the date, type and amount in each selected row.");
      return;
    }
    save.disabled = true;
    try {
      await hooks.add(entries);
      if (!scope.active) return;
      rows = [];
      preview.hidden = true;
      fileInput.value = "";
      report("Your selected entries were added.");
    } catch (error) {
      if (scope.active) report(error.message);
    } finally {
      if (scope.active) save.disabled = false;
    }
  });

  const download = root.querySelector("#download-budget");
  scope.listen(download, "click", async () => {
    download.disabled = true;
    const status = root.querySelector("#download-budget-message");
    status.textContent = "";
    try {
      if (!hooks.ready()) throw new Error("Wait for your saved entries to load, then try again.");
      // Finish autosaves before asking Python to export the account's stored entries.
      await hooks.flush();
      await waitForFinanceSaves();
      const month =
        root.querySelector("#download-budget-range").value === "month"
          ? root.querySelector("#budget-month").value
          : "";
      const response = await fetchPrivate(
        "/api/budget/export" + (month ? "?month=" + encodeURIComponent(month) : ""),
      );
      const blob = await response.blob();
      if (!scope.active) return;
      const url = URL.createObjectURL(blob),
        link = element("a");
      link.href = url;
      link.download = "Finance-AI-budget" + (month ? "-" + month : "") + ".xlsx";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (scope.active) status.textContent = tr(error.message);
    } finally {
      if (scope.active) download.disabled = false;
    }
  });
}
