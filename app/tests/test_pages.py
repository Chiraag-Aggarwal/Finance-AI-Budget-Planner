"""Check the rendered pages and the static allowlist, without reading any .env."""
from html.parser import HTMLParser
from pathlib import Path
import re
import unittest

from server import APP_FOLDER, APP_PAGES, FinanceRequestHandler, read_static_body


class PageParser(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.ids, self.scripts, self.names = [], [], []
        self.feed(text)

    def handle_starttag(self, tag, attributes):
        attributes = dict(attributes)
        if "id" in attributes: self.ids.append(attributes["id"])
        if "name" in attributes: self.names.append(attributes["name"])
        if tag == "script": self.scripts.append(attributes.get("src", ""))


class MultipageTests(unittest.TestCase):
    def test_each_page_has_one_shared_auth_shell_and_its_own_feature(self):
        features = {"index.html":"dashboard-income", "budget.html":"transaction-form",
                    "planner.html":"finance-form", "insights.html":"savings-chat-form",
                    "profile.html":"export-account-data", "settings.html":"setting-theme"}
        for page, feature in features.items():
            with self.subTest(page=page):
                html = read_static_body(APP_FOLDER / page).decode("utf-8")
                parsed = PageParser(html)
                self.assertIn("<!doctype html>", html.lower())
                self.assertIn('data-design="bloom"', html)
                self.assertIn('data-theme="light"', html)
                self.assertEqual(len(parsed.ids), len(set(parsed.ids)))
                for required in ["login-form", "signup-form", "password-reset-form", "email-verification-request-form", "app-shell", "main-menu", feature]:
                    self.assertIn(required, parsed.ids)
                self.assertNotRegex(html, r"<!-- (PAGE_|AUTH_)")
                for script in parsed.scripts:
                    self.assertTrue((APP_FOLDER / script.lstrip("/")).is_file(), script)

    def test_navigation_separates_features_instead_of_hiding_the_old_long_page(self):
        dashboard = PageParser(read_static_body(APP_FOLDER / "index.html").decode())
        self.assertNotIn("finance-form", dashboard.ids)
        self.assertNotIn("transaction-form", dashboard.ids)
        budget = PageParser(read_static_body(APP_FOLDER / "budget.html").decode())
        self.assertNotIn("savings-chat-form", budget.ids)
        insights = PageParser(read_static_body(APP_FOLDER / "insights.html").decode())
        self.assertIn("spending-forecast-status", insights.ids)
        self.assertNotIn("transaction-form", insights.ids)

    def test_templates_and_private_paths_are_not_public_routes(self):
        for page in APP_PAGES:
            self.assertEqual(FinanceRequestHandler.resolve_static_asset("/" + page), APP_FOLDER / page)
        for path in ["/.env", "/auth.html", "/layout.html", "/data/finance_ai_accounts.sqlite3", "/../server.py", "/js/../server.py", "/unknown.html"]:
            self.assertIsNone(FinanceRequestHandler.resolve_static_asset(path), path)

    def test_planner_retains_goal_assets_loan_and_household_inputs(self):
        page = PageParser(read_static_body(APP_FOLDER / "planner.html").decode())
        for field in ["monthlyTakeHomeIncome", "monthlyEssentialExpenses", "monthlyDiscretionaryExpenses", "monthlyDebtPayment", "householdSize", "dependents", "totalSavings", "emergencyFund", "goalSavings", "includeGoal", "goalType", "goalPrice", "plannedDownPayment", "monthsUntilGoal", "useGoalAssets", "considerLoan", "loanRatePercent"]:
            self.assertIn(field, page.names)


if __name__ == "__main__":
    unittest.main()
