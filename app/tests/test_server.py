"""Basic tests for the dependency-free account backend."""

import sqlite3
import http.cookiejar
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch
from functools import partial
from pathlib import Path

from server import (
    _ACCOUNT_ATTEMPTS,
    _RATE_LIMIT_LOCK,
    FinanceHTTPServer,
    FinanceRequestHandler,
    MongoStore,
    account_request_allowed,
    create_email_verification,
    create_password_reset,
    create_user,
    delete_account_data,
    export_account_data,
    get_finance_data,
    get_user_by_email,
    hash_password,
    hash_one_time_token,
    hash_session_token,
    initialize_database,
    open_database,
    password_matches,
    update_user_profile,
    validate_finance_data_patch,
    verify_email_token,
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

    def smtp_settings(self):
        return {
            "FINANCE_AI_ENV": "development",
            "FINANCE_AI_SMTP_HOST": "smtp.example.com",
            "FINANCE_AI_SMTP_PORT": "587",
            "FINANCE_AI_SMTP_USERNAME": "sender@example.com",
            "FINANCE_AI_SMTP_PASSWORD": "test-only-secret",
            "FINANCE_AI_SMTP_FROM": "sender@example.com",
        }

    def signup_and_verify(self, fields=None, **changes):
        details = fields or {
            "name": "Asha Rao",
            "email": "asha@example.com",
            "region": "Pune, Maharashtra",
            "password": "long-enough-example-123",
        }
        details = {**details, **changes}
        with patch.dict(os.environ, self.smtp_settings()), patch("server.send_email_verification") as send_email:
            status, result = self.request("/api/signup", "POST", details)
        self.assertEqual(status, 201, result)
        self.assertEqual(send_email.call_count, 1)
        verify_url = send_email.call_args.args[1]
        token = parse_qs(urlsplit(verify_url).fragment)["verify_email"][0]
        status, _ = self.request("/api/email-verification/complete", "POST", {"token": token})
        self.assertEqual(status, 200)
        status, _ = self.request("/api/login", "POST", {
            "email": details["email"],
            "password": details["password"],
        })
        self.assertEqual(status, 200)
        return result

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
        self.signup_and_verify(email="asha-finance@example.com")

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
        ), email_verified=True)
        status, _ = self.request("/api/login", "POST", {
            "email": "ravi-finance@example.com",
            "password": "long-enough-example-123",
        })
        self.assertEqual(status, 200)
        self.assertEqual(self.request("/api/finance-data")[1]["data"], {})
        self.assertEqual(get_finance_data(self.database_file, other_user["id"]), {})

    def test_account_export_is_authenticated_and_uses_only_the_signed_in_user(self):
        self.assertEqual(self.request("/api/account/export")[0], 401)
        self.signup_and_verify(email="export-owner@example.com")
        owner_id = self.request("/api/me")[1]["user"]["id"]
        owner_data = {
            "plannerProfile": {"monthlyTakeHomeIncome": 80_000, "includeGoal": False},
            "settings": {"theme": "dark", "accent": "mint", "textSize": "large", "reduceMotion": False},
            "transactions": [{
                "id": "owner-entry", "type": "expense", "category": "Food and groceries",
                "date": "2026-10-29", "amount": 1_250, "note": "Owner only",
            }],
        }
        self.assertEqual(self.request("/api/finance-data", "PATCH", owner_data)[0], 200)
        self.request("/api/logout", "POST", {})

        self.signup_and_verify(email="other-owner@example.com", name="Ravi Kumar")
        other_data = {
            "plannerProfile": {"monthlyTakeHomeIncome": 45_000, "includeGoal": False},
            "settings": {"theme": "light", "accent": "ocean", "textSize": "standard", "reduceMotion": True},
            "transactions": [{
                "id": "other-entry", "type": "expense", "category": "Transport",
                "date": "2026-10-29", "amount": 700, "note": "Other account",
            }],
        }
        self.assertEqual(self.request("/api/finance-data", "PATCH", other_data)[0], 200)
        status, exported = self.request(f"/api/account/export?user_id={owner_id}")

        self.assertEqual(status, 200)
        self.assertEqual(exported["account"]["email"], "other-owner@example.com")
        self.assertEqual(exported["financeData"], other_data)
        self.assertNotIn("owner-entry", json.dumps(exported))
        self.assertNotIn("password_hash", json.dumps(exported))
        self.assertNotIn("password_salt", json.dumps(exported))

    def test_account_deletion_requires_confirmation_and_removes_only_its_data(self):
        self.signup_and_verify(email="delete-owner@example.com")
        owner_id = self.request("/api/me")[1]["user"]["id"]
        owner_data = {
            "plannerProfile": {"monthlyTakeHomeIncome": 90_000, "includeGoal": False},
            "transactions": [{
                "id": "delete-entry", "type": "expense", "category": "Personal",
                "date": "2026-10-29", "amount": 1_000, "note": "To remove",
            }],
        }
        self.assertEqual(self.request("/api/finance-data", "PATCH", owner_data)[0], 200)
        create_password_reset(self.database_file, owner_id, hash_one_time_token("owner-reset-token"), 9_999_999_999)
        self.assertTrue(create_email_verification(
            self.database_file, owner_id, hash_one_time_token("owner-verification-token"), 9_999_999_999, 1_000,
        ))
        with open_database(self.database_file) as connection:
            connection.execute(
                "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (hash_session_token("another-owner-session"), owner_id, 9_999_999_999),
            )

        self.request("/api/logout", "POST", {})
        self.signup_and_verify(email="keep-owner@example.com", name="Ravi Kumar")
        keep_id = self.request("/api/me")[1]["user"]["id"]
        keep_data = {
            "plannerProfile": {"monthlyTakeHomeIncome": 35_000, "includeGoal": False},
            "transactions": [{
                "id": "keep-entry", "type": "expense", "category": "Food and groceries",
                "date": "2026-10-29", "amount": 450, "note": "Keep this",
            }],
        }
        self.assertEqual(self.request("/api/finance-data", "PATCH", keep_data)[0], 200)
        self.request("/api/logout", "POST", {})
        self.assertEqual(self.request("/api/login", "POST", {
            "email": "delete-owner@example.com", "password": "long-enough-example-123",
        })[0], 200)

        fields = {"password": "long-enough-example-123", "confirmation": "DELETE"}
        self.assertEqual(self.request("/api/account/delete", "POST", fields, origin="http://attacker.example")[0], 403)
        status, bad_confirmation = self.request("/api/account/delete", "POST", {**fields, "confirmation": "delete"})
        self.assertEqual(status, 400)
        self.assertIn("Type DELETE", bad_confirmation["error"])
        status, bad_password = self.request("/api/account/delete", "POST", {**fields, "password": "wrong-password-123"})
        self.assertEqual(status, 403)
        self.assertIn("No data was deleted", bad_password["error"])
        self.assertEqual(self.request("/api/finance-data")[1]["data"], owner_data)

        status, deleted = self.request("/api/account/delete", "POST", fields)
        self.assertEqual(status, 200)
        self.assertIn("permanently deleted", deleted["message"])
        self.assertEqual(self.request("/api/me")[0], 401)
        with open_database(self.database_file) as connection:
            for table, owner_column in (
                ("users", "id"),
                ("sessions", "user_id"),
                ("user_finance_data", "user_id"),
                ("password_reset_tokens", "user_id"),
                ("email_verification_tokens", "user_id"),
            ):
                self.assertEqual(
                    connection.execute(f"SELECT COUNT(*) FROM {table} WHERE {owner_column} = ?", (owner_id,)).fetchone()[0],
                    0,
                    table,
                )
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM users WHERE id = ?", (keep_id,)).fetchone()[0], 1)
        self.assertEqual(self.request("/api/login", "POST", {
            "email": "keep-owner@example.com", "password": "long-enough-example-123",
        })[0], 200)
        self.assertEqual(self.request("/api/finance-data")[1]["data"], keep_data)

    def test_mongo_export_and_delete_use_one_account_id_for_every_collection(self):
        class FakeCollection:
            def __init__(self, documents):
                self.documents = [dict(document) for document in documents]

            def find_one(self, query, projection=None, session=None):
                return next((dict(document) for document in self.documents
                             if all(document.get(key) == value for key, value in query.items())), None)

            def delete_many(self, query, session=None):
                before = len(self.documents)
                self.documents = [document for document in self.documents
                                  if not all(document.get(key) == value for key, value in query.items())]
                return type("DeleteResult", (), {"deleted_count": before - len(self.documents)})()

            def delete_one(self, query, session=None):
                for index, document in enumerate(self.documents):
                    if all(document.get(key) == value for key, value in query.items()):
                        self.documents.pop(index)
                        return type("DeleteResult", (), {"deleted_count": 1})()
                return type("DeleteResult", (), {"deleted_count": 0})()

        class FakeSession:
            def __enter__(self): return self
            def __exit__(self, *_args): return False
            def start_transaction(self): return self

        class FakeClient:
            def start_session(self): return FakeSession()

        users = [
            {"_id": "user-a", "name": "Asha", "email": "a@example.com", "region": "Pune", "password_salt": "salt", "password_hash": "hash", "created_at": 100, "email_verified": True},
            {"_id": "user-b", "name": "Ravi", "email": "b@example.com", "region": "Delhi", "password_salt": "salt", "password_hash": "hash", "created_at": 200, "email_verified": True},
        ]
        store = object.__new__(MongoStore)
        store.client = FakeClient()
        store.users = FakeCollection(users)
        store.finance_data = FakeCollection([
            {"_id": "user-a", "plannerProfile": {"monthlyTakeHomeIncome": 10_000}, "transactions": [{"id": "a-entry"}], "settings": {"theme": "dark"}, "updated_at": "private"},
            {"_id": "user-b", "plannerProfile": {"monthlyTakeHomeIncome": 20_000}, "transactions": [{"id": "b-entry"}], "settings": {"theme": "light"}},
        ])
        store.sessions = FakeCollection([{"_id": "session-a", "user_id": "user-a"}, {"_id": "session-b", "user_id": "user-b"}])
        store.password_resets = FakeCollection([{"_id": "reset-a", "user_id": "user-a"}, {"_id": "reset-b", "user_id": "user-b"}])
        store.email_verifications = FakeCollection([{"_id": "user-a", "user_id": "user-a"}, {"_id": "user-b", "user_id": "user-b"}])

        exported = export_account_data(store, "user-a")
        self.assertEqual(exported["account"]["email"], "a@example.com")
        self.assertEqual(exported["financeData"]["transactions"], [{"id": "a-entry"}])
        self.assertEqual(exported["financeData"]["settings"], {"theme": "dark"})
        self.assertNotIn("password_hash", json.dumps(exported))
        self.assertNotIn("updated_at", exported["financeData"])

        self.assertTrue(delete_account_data(store, "user-a"))
        self.assertEqual([item["_id"] for item in store.users.documents], ["user-b"])
        self.assertEqual([item["_id"] for item in store.finance_data.documents], ["user-b"])
        self.assertEqual([item["user_id"] for item in store.sessions.documents], ["user-b"])
        self.assertEqual([item["user_id"] for item in store.password_resets.documents], ["user-b"])
        self.assertEqual([item["user_id"] for item in store.email_verifications.documents], ["user-b"])

    def test_finance_data_api_rejects_cross_origin_updates(self):
        self.signup_and_verify(email="asha-origin@example.com")
        status, _ = self.request(
            "/api/finance-data",
            "PATCH",
            {"transactions": []},
            origin="http://attacker.example",
        )
        self.assertEqual(status, 403)

    def test_signup_profile_session_logout_and_login_end_to_end(self):
        with patch.dict(os.environ, self.smtp_settings()), patch("server.send_email_verification") as send_email:
            status, created = self.request("/api/signup", "POST", {
                "name": "Asha Rao",
                "email": "ASHA@example.com",
                "region": "Pune, Maharashtra",
                "password": "long-enough-example-123",
            })
        self.assertEqual(status, 201)
        self.assertIn("Check your email", created["message"])
        self.assertEqual(self.request("/api/me")[0], 401)
        token = parse_qs(urlsplit(send_email.call_args.args[1]).fragment)["verify_email"][0]
        self.assertEqual(self.request("/api/email-verification/complete", "POST", {"token": token})[0], 200)
        status, logged_in = self.request("/api/login", "POST", {
            "email": "asha@example.com",
            "password": "long-enough-example-123",
        })
        self.assertEqual(status, 200)
        self.assertEqual(logged_in["user"]["region"], "Pune, Maharashtra")

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
        self.signup_and_verify(fields)
        with patch.dict(os.environ, self.smtp_settings()), patch("server.send_email_verification"):
            self.assertEqual(self.request("/api/signup", "POST", fields)[0], 409)
            self.assertEqual(self.request("/api/signup", "POST", {**fields, "email": "ASHA@EXAMPLE.COM"})[0], 409)
        self.assertEqual(self.request(
            "/api/profile",
            "PUT",
            {"name": "Asha Rao", "region": "Delhi"},
            origin="http://attacker.example",
        )[0], 403)


    def test_email_verification_link_is_hashed_one_time_and_allows_login(self):
        with patch.dict(os.environ, self.smtp_settings()), patch("server.send_email_verification") as send_email:
            status, result = self.request("/api/signup", "POST", {
                "name": "Asha Rao",
                "email": "verify@example.com",
                "region": "Pune",
                "password": "long-enough-example-123",
            })
        self.assertEqual(status, 201)
        token = parse_qs(urlsplit(send_email.call_args.args[1]).fragment)["verify_email"][0]
        self.assertNotIn(token, send_email.call_args.args[1].split("#", 1)[0])
        with open_database(self.database_file) as connection:
            stored = connection.execute("SELECT token_hash FROM email_verification_tokens").fetchone()
        self.assertEqual(stored["token_hash"], hash_one_time_token(token))
        self.assertNotEqual(stored["token_hash"], token)

        status, blocked = self.request("/api/login", "POST", {
            "email": "verify@example.com",
            "password": "long-enough-example-123",
        })
        self.assertEqual(status, 403)
        self.assertIn("Verify your email", blocked["error"])

        self.assertEqual(self.request("/api/email-verification/complete", "POST", {"token": token})[0], 200)
        status, reused = self.request("/api/email-verification/complete", "POST", {"token": token})
        self.assertEqual(status, 400)
        self.assertIn("invalid or expired", reused["error"])
        self.assertEqual(self.request("/api/login", "POST", {
            "email": "verify@example.com",
            "password": "long-enough-example-123",
        })[0], 200)

    def test_expired_and_unknown_verification_links_are_rejected(self):
        user = create_user(self.database_file, self.valid_fields(email="expired@example.com"))
        token = "expired-verification-token-0123456789"
        now = int(__import__("time").time())
        self.assertTrue(create_email_verification(
            self.database_file,
            user["id"],
            hash_one_time_token(token),
            now + 10,
            now,
        ))
        with patch("server.time.time", return_value=now + 11):
            status, expired = self.request("/api/email-verification/complete", "POST", {"token": token})
        self.assertEqual(status, 400)
        self.assertIn("invalid or expired", expired["error"])

        status, unknown = self.request("/api/email-verification/complete", "POST", {
            "token": "unknown-verification-token-0123456789",
        })
        self.assertEqual(status, 400)
        self.assertEqual(unknown["error"], expired["error"])

    def test_unknown_email_resend_does_not_reveal_accounts(self):
        create_user(self.database_file, self.valid_fields(email="pending@example.com"))
        with patch.dict(os.environ, self.smtp_settings()), patch("server.send_email_verification") as send_email:
            unknown_status, unknown = self.request("/api/email-verification/resend", "POST", {
                "email": "nobody@example.com",
            })
            known_status, known = self.request("/api/email-verification/resend", "POST", {
                "email": "pending@example.com",
            })
        self.assertEqual((unknown_status, known_status), (200, 200))
        self.assertEqual(unknown["message"], known["message"])
        self.assertEqual(send_email.call_count, 1)

    def test_verification_resend_has_cooldown_hourly_limit_and_rotates_token(self):
        user = create_user(self.database_file, self.valid_fields(email="resend@example.com"))
        hashes = [hash_one_time_token(f"verification-token-number-{number}-012345") for number in range(7)]
        self.assertTrue(create_email_verification(self.database_file, user["id"], hashes[0], 90000, 1000))
        self.assertFalse(create_email_verification(self.database_file, user["id"], hashes[1], 90000, 1059))
        self.assertTrue(create_email_verification(self.database_file, user["id"], hashes[1], 90000, 1060))
        self.assertFalse(verify_email_token(self.database_file, hashes[0], 1060))
        for index, timestamp in enumerate((1120, 1180, 1240), start=2):
            self.assertTrue(create_email_verification(self.database_file, user["id"], hashes[index], 90000, timestamp))
        self.assertFalse(create_email_verification(self.database_file, user["id"], hashes[5], 90000, 1300))
        self.assertTrue(create_email_verification(self.database_file, user["id"], hashes[6], 100000, 4600))

    def test_legacy_sqlite_users_are_migrated_as_verified(self):
        legacy_file = Path(self.temp_folder.name) / "legacy.sqlite3"
        with sqlite3.connect(legacy_file) as connection:
            connection.execute("""CREATE TABLE users (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                region TEXT NOT NULL, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )""")
            legacy_salt, legacy_hash = hash_password("legacy-account-password-123")
            connection.execute(
                "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)",
                (12, "Legacy User", "legacy@example.com", "Pune", legacy_salt, legacy_hash, 100),
            )
        connection.close()
        initialize_database(legacy_file)
        with open_database(legacy_file) as connection:
            old_user = connection.execute("SELECT email_verified FROM users WHERE id = 12").fetchone()
        self.assertEqual(old_user["email_verified"], 1)
        legacy_user = get_user_by_email(legacy_file, "legacy@example.com")
        self.assertTrue(password_matches("legacy-account-password-123", legacy_user["password_salt"], legacy_user["password_hash"]))
        fresh_user = create_user(legacy_file, self.valid_fields(email="new@example.com"))
        self.assertEqual(get_user_by_email(legacy_file, fresh_user["email"])["email_verified"], 0)

    def test_legacy_mongodb_user_without_verification_field_remains_verified(self):
        class FakeUsers:
            def __init__(self, verified_value="missing"):
                self.verified_value = verified_value

            def find_one(self, query):
                user = {"_id": 17, "email": query["email"], "name": "Legacy", "region": "Pune"}
                if self.verified_value != "missing":
                    user["email_verified"] = self.verified_value
                return user

        store = object.__new__(MongoStore)
        for old_value in ("missing", None):
            store.users = FakeUsers(old_value)
            user = store.get_user_by_email("legacy@example.com")
            self.assertTrue(user["email_verified"])
            self.assertEqual(user["id"], 17)

    def test_signup_requires_email_configuration_before_creating_account(self):
        smtp_keys = tuple(self.smtp_settings())
        with patch.dict(os.environ, {key: "" for key in smtp_keys}):
            status, result = self.request("/api/signup", "POST", {
                "name": "Asha Rao",
                "email": "no-smtp@example.com",
                "region": "Pune",
                "password": "long-enough-example-123",
            })
        self.assertEqual(status, 503)
        self.assertIsNone(get_user_by_email(self.database_file, "no-smtp@example.com"))
        self.assertIn("not configured", result["error"])

    def test_password_reset_changes_password_once_and_ends_old_sessions(self):
        self.signup_and_verify(email="asha-reset@example.com")
        smtp_settings = {
            "FINANCE_AI_ENV": "development",
            "FINANCE_AI_SMTP_HOST": "smtp.example.com",
            "FINANCE_AI_SMTP_PORT": "587",
            "FINANCE_AI_SMTP_USERNAME": "sender@example.com",
            "FINANCE_AI_SMTP_PASSWORD": "test-only-secret",
            "FINANCE_AI_SMTP_FROM": "sender@example.com",
        }
        with patch.dict(os.environ, smtp_settings), patch("server.send_password_reset_email") as send_email:
            status, requested = self.request("/api/password-reset/request", "POST", {
                "email": "ASHA-RESET@example.com",
            })
        self.assertEqual(status, 200)
        self.assertIn("If this email belongs to an account", requested["message"])
        self.assertEqual(send_email.call_count, 1)

        reset_url = send_email.call_args.args[1]
        parsed_url = urlsplit(reset_url)
        self.assertEqual(parsed_url.query, "")
        token = parse_qs(parsed_url.fragment)["reset_token"][0]
        status, changed = self.request("/api/password-reset/complete", "POST", {
            "token": token,
            "password": "new-safe-password-456",
        })
        self.assertEqual(status, 200)
        self.assertIn("password was changed", changed["message"])
        self.assertEqual(self.request("/api/me")[0], 401)
        self.assertEqual(self.request("/api/login", "POST", {
            "email": "asha-reset@example.com",
            "password": "long-enough-example-123",
        })[0], 401)
        self.assertEqual(self.request("/api/login", "POST", {
            "email": "asha-reset@example.com",
            "password": "new-safe-password-456",
        })[0], 200)
        self.assertEqual(self.request("/api/password-reset/complete", "POST", {
            "token": token,
            "password": "another-safe-password-789",
        })[0], 400)

    def test_password_reset_request_does_not_reveal_unknown_email(self):
        smtp_settings = {
            "FINANCE_AI_ENV": "development",
            "FINANCE_AI_SMTP_HOST": "smtp.example.com",
            "FINANCE_AI_SMTP_PORT": "587",
            "FINANCE_AI_SMTP_USERNAME": "sender@example.com",
            "FINANCE_AI_SMTP_PASSWORD": "test-only-secret",
            "FINANCE_AI_SMTP_FROM": "sender@example.com",
        }
        with patch.dict(os.environ, smtp_settings), patch("server.send_password_reset_email") as send_email:
            unknown_status, unknown = self.request("/api/password-reset/request", "POST", {
                "email": "nobody@example.com",
            })
            create_user(self.database_file, self.valid_fields(email="known@example.com"), email_verified=True)
            known_status, known = self.request("/api/password-reset/request", "POST", {
                "email": "known@example.com",
            })

        self.assertEqual(unknown_status, 200)
        self.assertEqual(known_status, 200)
        self.assertEqual(unknown["message"], known["message"])
        self.assertEqual(send_email.call_count, 1)

    def test_password_reset_requires_configured_email_settings(self):
        smtp_keys = (
            "FINANCE_AI_SMTP_HOST",
            "FINANCE_AI_SMTP_PORT",
            "FINANCE_AI_SMTP_USERNAME",
            "FINANCE_AI_SMTP_PASSWORD",
            "FINANCE_AI_SMTP_FROM",
        )
        with patch.dict(os.environ, {key: "" for key in smtp_keys}):
            status, result = self.request("/api/password-reset/request", "POST", {
                "email": "nobody@example.com",
            })
        self.assertEqual(status, 503)
        self.assertIn("not configured", result["error"])


if __name__ == "__main__":
    unittest.main()
