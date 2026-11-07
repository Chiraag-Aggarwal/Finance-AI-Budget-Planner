// Real HTTP, disposable local database, fictional accounts. No production services.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { chromium } = await import(process.env.FINANCE_AI_PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2];
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base || ""))
  throw new Error("Use the local fixture server.");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.FINANCE_AI_TEST_BROWSER,
});
const errors = [];
let checks = 0;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "finance-workspace-checks-"));
const csv = Buffer.from(
  "Date,Description,Debit,Credit\n01/10/2026,Groceries,1250,\n02/10/2026,Salary,,60000\n",
);
try {
  for (const viewport of [
    { width: 1365, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.setFixedTime(new Date(2026, 10, 7, 12));
    const ready = async (p) =>
      page.waitForFunction(
        (p) =>
          location.pathname === p &&
          !!document.querySelector(".page-view") &&
          !document.querySelector("#app-shell").inert,
        p,
      );
    const login = async (email) => {
      await page.locator('#login-form [name="email"]').fill(email);
      await page.locator('#login-form [name="password"]').fill("Browser-test-password-123");
      await page.locator('#login-form button[type="submit"]').click();
      await ready("/");
    };
    const nav = async (p) => {
      await page.locator("#main-menu-button").click();
      await page.locator('#main-menu a[href="' + p + '"]').click();
      await ready(p);
    };
    await page.goto(base);
    await login("workspace@example.com");
    // Clear only this test account for the next viewport.
    await page.evaluate(async () => {
      const { user } = await fetch("/api/me").then((r) => r.json());
      await fetch("/api/finance-data", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Finance-Owner": String(user.id) },
        body: JSON.stringify({ transactions: [], goalPlans: [], plannerProfile: null }),
      });
    });
    await page.reload();
    await ready("/");
    await nav("/budget.html");
    await page.locator(".document-import>summary").click();
    await page
      .locator("#budget-document")
      .setInputFiles({ name: "fictional-statement.csv", mimeType: "text/csv", buffer: csv });
    await page.locator("#read-budget-document").click();
    await page.locator("#import-preview").waitFor({ state: "visible" });
    assert.equal(await page.locator("#import-rows tr").count(), 2);
    assert.equal(
      await page.locator('#import-rows select[aria-label="Entry type"]').nth(1).inputValue(),
      "income",
    );
    checks += 2;
    await page.locator("#save-import").click();
    await page.locator("#import-preview").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#transaction-rows tr").count(), 2);
    await page.reload();
    await ready("/budget.html");
    await page.locator("#budget-month").fill("2026-10");
    await page.locator("#budget-month").dispatchEvent("change");
    assert.equal(await page.locator("#transaction-rows tr").count(), 2);
    checks++;
    await page.locator(".document-import>summary").click();
    await page
      .locator("#budget-document")
      .setInputFiles({ name: "again.csv", mimeType: "text/csv", buffer: csv });
    await page.locator("#read-budget-document").click();
    await page.locator("#import-preview").waitFor({ state: "visible" });
    assert.equal(await page.locator('#import-rows input[type="checkbox"]:checked').count(), 0);
    await page.locator("#cancel-import").click();
    checks++;
    const dl = page.waitForEvent("download", { timeout: 10000 }).catch(async (error) => {
      throw new Error(
        error.message + " UI: " + (await page.locator("#download-budget-message").innerText()),
      );
    });
    await page.locator("#download-budget").click();
    const download = await dl;
    const target = path.join(temp, "budget-" + viewport.width + ".xlsx");
    await download.saveAs(target);
    assert.ok((await fs.stat(target)).size > 3000);
    checks++;
    // Exercise the monthly API route too; all-month downloads do not validate a month.
    await page.locator("#download-budget-range").selectOption("month");
    const monthlyDownload = page.waitForEvent("download", { timeout: 10000 });
    const monthlyResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/budget/export?month=2026-10"),
    );
    await page.locator("#download-budget").click();
    assert.equal((await monthlyResponse).status(), 200);
    const monthlyFile = await monthlyDownload;
    assert.equal(monthlyFile.suggestedFilename(), "Finance-AI-budget-2026-10.xlsx");
    const monthlyTarget = path.join(temp, "selected-month-" + viewport.width + ".xlsx");
    await monthlyFile.saveAs(monthlyTarget);
    assert.ok((await fs.stat(monthlyTarget)).size > 3000);
    assert.equal(await page.locator("#download-budget-message").innerText(), "");
    checks++;
    // Supply past and current records; the UI must offer only October's income.
    await page.evaluate(async () => {
      const { user } = await fetch("/api/me").then((r) => r.json());
      const headers = { "Content-Type": "application/json", "X-Finance-Owner": String(user.id) };
      const saved = await fetch("/api/finance-data", { headers }).then((r) => r.json());
      const data = saved.data || saved;
      const records = [
        {
          id: "hint-september",
          date: "2026-09-01",
          type: "income",
          category: "Salary",
          amount: 50000,
          note: "Earlier income",
        },
        {
          id: "hint-november",
          date: "2026-11-01",
          type: "income",
          category: "Salary",
          amount: 100000,
          note: "Current income",
        },
        {
          id: "hint-essential",
          date: "2026-10-04",
          type: "expense",
          category: "Housing and rent",
          amount: 10000,
          note: "Rent",
        },
        {
          id: "hint-personal",
          date: "2026-11-03",
          type: "expense",
          category: "Personal",
          amount: 750.25,
          note: "Current shopping",
        },
      ];
      const response = await fetch("/api/finance-data", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ transactions: [...data.transactions, ...records] }),
      });
      if (!response.ok) throw new Error("Could not seed hint records");
    });
    await page.reload();
    await ready("/budget.html");
    await nav("/planner.html");
    assert.equal(await page.locator('[name="goalType"]').count(), 1);
    assert.equal(await page.locator("#planner-editor").isVisible(), false);
    const addBox = await page.locator("#add-new-goal").boundingBox();
    assert.ok(Math.abs(addBox.x + addBox.width / 2 - viewport.width / 2) < 20);
    await page.locator("#add-new-goal").click();
    await page.locator('[data-goal-choice="car"]').click();
    checks++;
    const fill = async (n, v) => page.locator('[name="' + n + '"]').fill(String(v));
    for (const [n, v] of Object.entries({
      monthlyTakeHomeIncome: 60000,
      monthlyEssentialExpenses: 20000,
      monthlyDiscretionaryExpenses: 5000,
      monthlyDebtPayment: 0,
      householdSize: 3,
      dependents: 1,
      totalSavings: 150000,
      emergencyFund: 60000,
      goalSavings: 50000,
      goalPrice: 400000,
      plannedDownPayment: 100000,
      monthsUntilGoal: 24,
    }))
      await fill(n, v);
    const editor = page.locator('[data-expense-editor="essentialItems"]');
    assert.equal(await editor.locator("summary").count(), 0);
    assert.equal(await editor.locator("[data-add-expense]").isVisible(), true);
    await editor.locator("[data-add-expense]").click();
    await editor.locator('input[type="number"]').fill("12000");
    await editor.locator("[data-add-expense]").click();
    await editor.locator("select").nth(1).selectOption("Other");
    await editor.locator('input[type="text"]').nth(1).fill("Pet care");
    assert.equal(await editor.locator("select").nth(1).isVisible(), false);
    await page.locator('#finance-form button[type="submit"]').click();
    assert.match(await page.locator("#form-errors").innerText(), /Finish or remove/);
    assert.equal(await page.locator("#plan-results").isVisible(), false);
    await editor.locator('input[type="number"]').nth(1).fill("2000");
    checks++;
    assert.equal(await editor.locator("[data-apply-expenses]").count(), 0);
    assert.equal(await page.locator('[name="monthlyEssentialExpenses"]').inputValue(), "14000");
    checks++;
    await page.locator('#finance-form button[type="submit"]').click();
    await page.locator("#plan-results").waitFor({ state: "visible" });
    await page.locator("#goal-plan-name").fill("First car");
    await page.locator("#save-goal-plan").click();
    await page.locator(".saved-goal-card").waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector("#save-goal-plan").disabled);
    checks++;
    await page.locator("#add-new-goal").click();
    await page.locator('[data-goal-choice="wedding"]').click();
    for (const [n, v] of Object.entries({
      goalSavings: 50000,
      goalPrice: 300000,
      plannedDownPayment: 100000,
      monthsUntilGoal: 12,
    }))
      await fill(n, v);
    assert.match(await page.locator('[data-goal-copy="timelineLabel"]').innerText(), /wedding/);
    await page.locator('#finance-form button[type="submit"]').click();
    await page.locator("#goal-plan-name").fill("Family wedding");
    await page.locator("#save-goal-plan").click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".saved-goal-card").length === 2 &&
        !document.querySelector("#save-goal-plan").disabled,
    );
    await page.reload();
    await ready("/planner.html");
    assert.equal(await page.locator(".saved-goal-card").count(), 2);
    checks++;
    const car = page.locator(".saved-goal-card").filter({ hasText: "First car" });
    await car.getByRole("button", { name: "Edit First car", exact: true }).click();
    assert.equal(await page.locator('[name="goalPrice"]').inputValue(), "400000");
    assert.equal(
      await editor.locator('.expense-rows input[type="text"]').nth(1).inputValue(),
      "Pet care",
    );
    await fill("goalPrice", 450000);
    await page.locator('#finance-form button[type="submit"]').click();
    await page.locator("#save-goal-plan").click();
    await page.waitForFunction(() => !document.querySelector("#save-goal-plan").disabled);
    assert.equal(await page.locator(".saved-goal-card").count(), 2);
    assert.match(await car.innerText(), /4,50,000/);
    checks++;
    await page.locator("#continue-draft").click();
    const hint = page.locator("#monthlyTakeHomeIncome-suggestions");
    await page.locator('[name="monthlyTakeHomeIncome"]').click();
    assert.equal(await hint.isVisible(), true);
    assert.equal(await hint.locator("button").count(), 1);
    assert.match(await hint.innerText(), /Oct 2026/);
    assert.match(await hint.innerText(), /60,000/);
    assert.doesNotMatch(
      await hint.innerText(),
      /From your monthly budget|Choose an amount|Sept|Nov/,
    );
    assert.equal(await hint.locator(":scope > small").isVisible(), false);
    const popupBox = await hint.boundingBox();
    assert.ok(
      popupBox.x >= 0 && popupBox.x + popupBox.width <= viewport.width && popupBox.height < 150,
    );
    checks++;
    await page.keyboard.press("Escape");
    assert.equal(await hint.isVisible(), false);
    await page.locator('[name="monthlyTakeHomeIncome"]').click();
    await page.locator("#chosen-goal-name").click();
    assert.equal(await hint.isVisible(), false);
    await page.locator('[name="monthlyTakeHomeIncome"]').click();
    await page.screenshot({ path: path.join(temp, "amount-popup-" + viewport.width + ".png") });
    checks++;
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await hint.isVisible(), false);
    checks++;
    assert.equal(await page.locator('[name="monthlyTakeHomeIncome"]').inputValue(), "60000");
    assert.equal(await page.evaluate(() => document.activeElement.name), "monthlyTakeHomeIncome");
    checks++;
    const personalHint = page.locator("#monthlyDiscretionaryExpenses-suggestions");
    await page.locator('[name="monthlyDiscretionaryExpenses"]').click();
    assert.equal(await personalHint.locator("button").count(), 1);
    assert.match(await personalHint.innerText(), /This month so far/);
    assert.match(await personalHint.innerText(), /750.25/);
    await personalHint.locator("button").click();
    assert.equal(
      await page.locator('[name="monthlyDiscretionaryExpenses"]').inputValue(),
      "750.25",
    );
    checks++;
    await page.locator('[name="monthlyEssentialExpenses"]').click();
    assert.equal(
      await page.locator('[name="monthlyEssentialExpenses"]').evaluate((input) => input.readOnly),
      true,
    );
    assert.equal(
      await page.locator("#monthlyEssentialExpenses-suggestions > small").isVisible(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#monthlyDebtPayment-suggestions").count(), 0);
    checks++;
    await page.locator("#language-toggle").click();
    await page.locator('[name="monthlyTakeHomeIncome"]').click();
    await page.waitForFunction(() =>
      document.querySelector("#monthlyTakeHomeIncome-suggestions").textContent.includes("दर्ज कुल"),
    );
    assert.equal(await hint.locator("button").count(), 1);
    await page.locator("#language-toggle").click();
    await page.locator('[name="monthlyTakeHomeIncome"]').click();
    await page.waitForFunction(() =>
      document
        .querySelector("#monthlyTakeHomeIncome-suggestions")
        .textContent.includes("Recorded total"),
    );
    assert.doesNotMatch(await hint.innerText(), /\p{Script=Devanagari}/u);
    await page.keyboard.press("Escape");
    checks++;
    await nav("/insights.html");
    assert.equal(await page.locator(".estimate-details").first().getAttribute("open"), null);
    assert.equal(await page.locator("#savings-model-note").isVisible(), false);
    await page.locator(".estimate-details > summary").first().click();
    assert.equal(await page.locator("#savings-model-note").isVisible(), true);
    checks++;
    await nav("/profile.html");
    assert.equal(await page.locator("#profile-page-status").count(), 1);
    await nav("/settings.html");
    assert.equal(await page.locator("#setting-theme").isVisible(), true);
    await nav("/planner.html"); // Clicking the same menu route returns to the overview.
    assert.equal(await page.locator("#planner-home").isVisible(), true);
    assert.equal(await page.locator("#planner-editor").isVisible(), false);
    checks++;
    await page.locator("#main-menu-button").click();
    await page.locator('#main-menu a[href="/planner.html#results"]').click();
    await page.waitForFunction(() => !document.querySelector("#planner-editor").hidden);
    assert.equal(await page.locator("#results").isVisible(), true);
    await nav("/planner.html");
    checks++;
    // Verify translation can return to English and new tools fit every theme.
    await page.locator("#language-toggle").click();
    assert.match(await page.locator("#goal-library-title").innerText(), /\p{Script=Devanagari}/u);
    await page.locator("#language-toggle").click();
    assert.equal(await page.locator("#goal-library-title").innerText(), "Your saved goals");
    checks++;
    for (const design of ["bloom", "sunrise", "ocean"])
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          ({ design, theme }) => {
            document.documentElement.dataset.design = design;
            document.documentElement.dataset.theme = theme;
          },
          { design, theme },
        );
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        checks++;
      }
    await page.evaluate(() => {
      document.documentElement.dataset.design = "bloom";
      document.documentElement.dataset.theme = "light";
    });
    await page.locator("#main-content").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(temp, "planner-" + viewport.width + ".png"),
      fullPage: true,
    });
    await nav("/budget.html");
    await page.locator(".document-import>summary").click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: path.join(temp, "budget-" + viewport.width + ".png"),
      fullPage: true,
    });
    checks++;
    // A different account cannot see the first account's plan or transactions.
    await page.locator("#main-menu-button").click();
    await page.locator("#sign-out-button").click();
    await login("other@example.com");
    await nav("/planner.html");
    assert.equal(await page.locator(".saved-goal-card").count(), 0);
    await nav("/budget.html");
    assert.equal(await page.locator("#transaction-rows tr").count(), 0);
    checks++;
    await page.locator("#main-menu-button").click();
    await page.locator("#sign-out-button").click();
    await login("workspace@example.com");
    await nav("/planner.html");
    assert.equal(await page.locator(".saved-goal-card").count(), 2);
    checks++;
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks, pageErrors: errors, artifacts: temp }));
} finally {
  await browser.close();
}
