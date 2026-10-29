"""Basic tests for the dependency-free account backend."""

import sqlite3
import http.cookiejar
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from functools import partial
from pathlib import Path

from server import (
    _ACCOUNT_ATTEMPTS,
    _RATE_LIMIT_LOCK,
    FinanceHTTPServer,
    FinanceRequestHandler,
    MongoStore,
    account_request_allowed,
    create_user,
    get_finance_data,
    get_user_by_email,
    hash_password,
    hash_session_token,
    initialize_database,
    password_matches,
    update_user_profile,
    validate_finance_data_patch,
    validate_signup,
)


class AccountServerTests(unittest.TestCase):
    def setUp(self):
        # Each test starts with an independent in-memory login-rate window.
        with _RATE_LIMIT_LOCK:
            _ACCOUNT_ATTEMPTS.clear()
        self.temp_folder = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.database_file = Path(self.temp_folder.name) / "accounts.sqlite3"
        initialize_database(self.database_file)
        self.server = FinanceHTTPServer(
            ("127.0.0.1", 0),
            partial(FinanceRequestHandler),
            self.database_file,
        )
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.cookie_jar = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookie_jar))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(timeout=2)
        self.temp_folder.cleanup()

    def request(self, path, method="GET", fields=None, origin=None):
        data = None if fields is None else json.dumps(fields).encode("utf-8")
        headers = {"Origin": origin or self.base_url}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with self.client.open(request, timeout=3) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8"))

    def valid_fields(self, **changes):
        fields, error = validate_signup(
            changes.get("name", "Asha Rao"),
            changes.get("email", "ASHA@example.com"),
            changes.get("region", "Pune, Maharashtra"),
            changes.get("password", "long-enough-example-123"),
        )
        self.assertIsNone(error)
        return fields

    def test_signup_requires_a_valid_email_password_and_region(self):
        fields, error = validate_signup("Asha Rao", "bad-email", "Pune", "long-enough-example-123")
        self.assertEqual(fields, {})
        self.assertIn("email", error.lower())

        fields, error = validate_signup("Asha Rao", "asha@example.com", "", "long-enough-example-123")
        self.assertEqual(fields, {})
        self.assertIn("region", error.lower())

        fields, error = validate_signup("Asha Rao", "asha@example.com", "Pune", "short")
        self.assertEqual(fields, {})
        self.assertIn("password", error.lower())

    def test_password_is_salted_and_checked_as_a_one_way_hash(self):
        salt, saved_hash = hash_password("long-enough-example-123")
        self.assertNotEqual(saved_hash, "long-enough-example-123")
        self.assertTrue(password_matches("long-enough-example-123", salt, saved_hash))
        self.assertFalse(password_matches("another-password", salt, saved_hash))

    def test_profile_is_saved_updated_and_email_is_normalized(self):
        user = create_user(self.database_file, self.valid_fields())
        self.assertEqual(user["email"], "asha@example.com")
        self.assertNotIn("password", user)
        self.assertNotIn("password_hash", user)

        saved_user = get_user_by_email(self.database_file, "ASHA@example.com")
        self.assertEqual(saved_user["region"], "Pune, Maharashtra")
        self.assertTrue(saved_user["password_hash"])

        updated = update_user_profile(self.database_file, user["id"], "Asha Rao", "Jaipur, Rajasthan")
        self.assertEqual(updated["region"], "Jaipur, Rajasthan")

    def test_database_rejects_duplicate_email(self):
        create_user(self.database_file, self.valid_fields())
        with self.assertRaises(sqlite3.IntegrityError):
            create_user(self.database_file, self.valid_fields(email="asha@example.com"))

    def test_account_attempt_limit_and_session_token_hash(self):
        ip = "unit-test-address"
        for attempt in range(10):
            self.assertTrue(account_request_allowed(ip, "/api/login", now=100 + attempt))
        self.assertFalse(account_request_allowed(ip, "/api/login", now=110))
        self.assertTrue(account_request_allowed(ip, "/api/login", now=100 + 15 * 60 + 1))
        self.assertNotEqual(hash_session_token("browser-token"), "browser-token")

    def test_profile_rejects_an_empty_region(self):
        user = create_user(self.database_file, self.valid_fields())
        with self.assertRaises(ValueError):
            update_user_profile(self.database_file, user["id"], "Asha Rao", " ")

    def test_finance_data_validation_rejects_unknown_or_invalid_entries(self):
        valid_entry = {
            "id": "entry-1",
            "type": "expense",
            "category": "Food and groceries",
            "date": "2026-10-29",
            "amount": 250.5,
            "note": "Vegetables",
        }
        clean, error = validate_finance_data_patch({
            "plannerProfile": {"monthlyTakeHomeIncome": 75_000, "includeGoal": False},
            "transactions": [valid_entry],
        })
        self.assertIsNone(error)
        self.assertEqual(clean["transactions"], [valid_entry])

        _, error = validate_finance_data_patch({"userId": 12})
        self.assertIsNotNone(error)
        _, error = validate_finance_data_patch({"transactions": [{**valid_entry, "amount": float("nan")}]})
        self.assertIsNotNone(error)
        _, error = validate_finance_data_patch({"transactions": [{**valid_entry, "date": "2026-02-31"}]})
        self.assertIsNotNone(error)

    def test_mongo_finance_store_returns_only_user_data_fields(self):
        class FakeCollection:
            def __init__(self):
                self.documents = {}

            def find_one(self, query):
                document = self.documents.get(query["_id"])
                return dict(document) if document else None

            def update_one(self, query, update, upsert=False):
                document = self.documents.setdefault(query["_id"], {"_id": query["_id"]})
                for key, value in update.get("$setOnInsert", {}).items():
                    document.setdefault(key, value)
                document.update(update.get("$set", {}))

        store = object.__new__(MongoStore)
        store.finance_data = FakeCollection()
        saved = store.update_finance_data("account-1", {"transactions": []})
        self.assertEqual(saved, {"transactions": []})
        self.assertEqual(store.get_finance_data("account-1"), {"transactions": []})

    def test_finance_data_api_saves_per_signed_in_user(self):
        self.assertEqual(self.request("/api/finance-data")[0], 401)
        self.assertEqual(self.request("/api/signup", "POST", {
            "name": "Asha Rao",
            "email": "asha-finance@example.com",
            "region": "Pune, Maharashtra",
            "password": "long-enough-example-123",
        })[0], 201)

        data = {
            "plannerProfile": {"monthlyTakeHomeIncome": 75_000, "includeGoal": False},
            "transactions": [{
                "id": "entry-1",
                "type": "expense",
                "category": "Food and groceries",
                "date": "2026-10-29",
                "amount": 250.5,
                "note": "Vegetables",
            }],
        }
        status, saved = self.request("/api/finance-data", "PATCH", data)
        self.assertEqual(status, 200)
        self.assertEqual(saved["data"], data)
        self.assertEqual(self.request("/api/finance-data")[1]["data"], data)

        self.assertEqual(self.request("/api/logout", "POST", {})[0], 200)
        other_user = create_user(self.database_file, self.valid_fields(
            name="Ravi Kumar",
            email="ravi-finance@example.com",
        ))
        status, _ = self.request("/api/login", "POST", {
            "email": "ravi-finance@example.com",
            "password": "long-enough-example-123",
        })
        self.assertEqual(status, 200)
        self.assertEqual(self.request("/api/finance-data")[1]["data"], {})
        self.assertEqual(get_finance_data(self.database_file, other_user["id"]), {})

    def test_finance_data_api_rejects_cross_origin_updates(self):
        self.assertEqual(self.request("/api/signup", "POST", {
            "name": "Asha Rao",
            "email": "asha-origin@example.com",
            "region": "Pune, Maharashtra",
            "password": "long-enough-example-123",
        })[0], 201)
        status, _ = self.request(
            "/api/finance-data",
            "PATCH",
            {"transactions": []},
            origin="http://attacker.example",
        )
        self.assertEqual(status, 403)

    def test_signup_profile_session_logout_and_login_end_to_end(self):
        status, created = self.request("/api/signup", "POST", {
            "name": "Asha Rao",
            "email": "ASHA@example.com",
            "region": "Pune, Maharashtra",
            "password": "long-enough-example-123",
        })
        self.assertEqual(status, 201)
        self.assertEqual(created["user"]["region"], "Pune, Maharashtra")
        self.assertNotIn("password", created["user"])

        status, current = self.request("/api/me")
        self.assertEqual(status, 200)
        self.assertEqual(current["user"]["email"], "asha@example.com")

        status, changed = self.request("/api/profile", "PUT", {
            "name": "Asha Rao",
            "region": "Jaipur, Rajasthan",
        })
        self.assertEqual(status, 200)
        self.assertEqual(changed["user"]["region"], "Jaipur, Rajasthan")

        self.assertEqual(self.request("/api/logout", "POST", {})[0], 200)
        self.assertEqual(self.request("/api/me")[0], 401)
        self.assertEqual(self.request("/api/login", "POST", {
            "email": "asha@example.com",
            "password": "wrong-password-123",
        })[0], 401)

        status, logged_in = self.request("/api/login", "POST", {
            "email": "asha@example.com",
            "password": "long-enough-example-123",
        })
        self.assertEqual(status, 200)
        self.assertEqual(logged_in["user"]["region"], "Jaipur, Rajasthan")

    def test_http_api_requires_region_and_rejects_cross_origin_changes(self):
        fields = {
            "name": "Asha Rao",
            "email": "asha@example.com",
            "region": "",
            "password": "long-enough-example-123",
        }
        self.assertEqual(self.request("/api/signup", "POST", fields)[0], 400)

        fields["region"] = "Pune"
        self.assertEqual(self.request("/api/signup", "POST", fields)[0], 201)
        self.assertEqual(self.request("/api/signup", "POST", fields)[0], 409)
        self.assertEqual(self.request(
            "/api/profile",
            "PUT",
            {"name": "Asha Rao", "region": "Delhi"},
            origin="http://attacker.example",
        )[0], 403)


if __name__ == "__main__":
    unittest.main()
