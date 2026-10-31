"""Small, dependency-free Python server for the Finance AI account pages."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import threading
import urllib.request
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit


APP_FOLDER = Path(__file__).resolve().parent


def load_local_environment():
    """Read simple KEY=VALUE settings from app/.env for local development."""
    env_file = APP_FOLDER / ".env"
    if not env_file.is_file():
        return

    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip()
        if value[:1] in {"\"", "'"} and value[-1:] == value[:1]:
            value = value[1:-1]
        # A Windows environment setting takes precedence over the local file.
        if name and not os.environ.get(name):
            os.environ[name] = value


DATABASE_FILE = Path(os.environ.get(
    "FINANCE_AI_DATABASE",
    str(APP_FOLDER / "data" / "finance_ai_accounts.sqlite3"),
))
SESSION_COOKIE = "finance_ai_session"
SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7
PASSWORD_HASH_ROUNDS = 310_000
PASSWORD_RESET_LIFETIME_SECONDS = 30 * 60
EMAIL_VERIFICATION_LIFETIME_SECONDS = 24 * 60 * 60
EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = 60
EMAIL_VERIFICATION_WINDOW_SECONDS = 60 * 60
EMAIL_VERIFICATION_MAX_PER_HOUR = 5
MAX_REQUEST_BYTES = 16_384
MAX_FINANCE_DATA_BYTES = 1_000_000
COOKIE_SECURE = os.environ.get(
    "FINANCE_AI_COOKIE_SECURE",
    "1" if os.environ.get("FINANCE_AI_ENV", "development").lower() == "production" else "0",
) == "1"
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
RATE_LIMIT_WINDOW_SECONDS = 15 * 60
_RATE_LIMIT_LOCK = threading.Lock()
_ACCOUNT_ATTEMPTS: dict[tuple[str, str], list[float]] = {}


@contextmanager
def open_database(database_file: Path = DATABASE_FILE):
    """Open a short-lived SQLite connection with foreign keys enabled."""
    database_file.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_file, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database(database_file: Path = DATABASE_FILE) -> None:
    """Create the account and session tables if this is the first run."""
    with open_database(database_file) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                email_verified INTEGER NOT NULL DEFAULT 1,
                region TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS sessions_by_user
                ON sessions(user_id);

            CREATE TABLE IF NOT EXISTS user_finance_data (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                payload TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS password_reset_tokens_by_user
                ON password_reset_tokens(user_id);

            CREATE TABLE IF NOT EXISTS email_verification_tokens (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL,
                window_started_at INTEGER NOT NULL,
                send_count INTEGER NOT NULL,
                last_sent_at INTEGER NOT NULL
            );
            """
        )

        # Old SQLite accounts become verified; new accounts explicitly use 0.
        user_columns = {row["name"] for row in connection.execute("PRAGMA table_info(users)")}
        if "email_verified" not in user_columns:
            connection.execute(
                "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1"
            )
        # Treat any incomplete legacy migration as an existing, trusted account.
        connection.execute("UPDATE users SET email_verified = 1 WHERE email_verified IS NULL")


class DuplicateEmailError(Exception):
    """Raised when MongoDB already contains an account with this email."""


class MongoStore:
    """MongoDB collections for accounts, sessions, and private finance data."""

    def __init__(self, uri: str, database_name: str):
        try:
            from pymongo import ASCENDING, MongoClient
        except ImportError as error:
            raise RuntimeError(
                "MongoDB is configured, but PyMongo is missing. Install app/requirements.txt."
            ) from error

        self.client = MongoClient(uri, serverSelectionTimeoutMS=8_000, tz_aware=True)
        self.client.admin.command("ping")
        database = self.client[database_name]
        self.users = database["users"]
        self.sessions = database["sessions"]
        self.finance_data = database["finance_data"]
        self.password_resets = database["password_resets"]
        self.email_verifications = database["email_verifications"]
        self.users.create_index([("email", ASCENDING)], unique=True)
        self.sessions.create_index("expires_at", expireAfterSeconds=0)
        self.finance_data.create_index("updated_at")
        self.password_resets.create_index("expires_at", expireAfterSeconds=0)
        self.email_verifications.create_index("expires_at", expireAfterSeconds=0)

    def create_user(self, fields: dict, email_verified: bool = False) -> dict:
        from pymongo.errors import DuplicateKeyError

        salt, password_hash_value = hash_password(fields["password"])
        # New account IDs are strings; imported SQLite IDs remain integers.
        user_id = secrets.token_hex(12)
        try:
            self.users.insert_one({
                "_id": user_id,
                "name": fields["name"],
                "email": fields["email"],
                "email_verified": bool(email_verified),
                "region": fields["region"],
                "password_salt": salt,
                "password_hash": password_hash_value,
                "created_at": int(time.time()),
            })
        except DuplicateKeyError as error:
            raise DuplicateEmailError from error
        return {
            "id": user_id,
            "name": fields["name"],
            "email": fields["email"],
            "region": fields["region"],
        }

    def get_user_by_email(self, email: str):
        user = self.users.find_one({"email": email.strip().lower()})
        if not user:
            return None
        # Existing MongoDB documents without this field remain trusted.
        if user.get("email_verified") is None:
            user["email_verified"] = True
        user["id"] = user.pop("_id")
        return user

    def create_email_verification(self, user_id: int | str, token_hash: str, expires_at: int, now: int) -> bool:
        from pymongo.errors import DuplicateKeyError

        current = self.email_verifications.find_one({"_id": user_id})
        expires = datetime.fromtimestamp(expires_at, timezone.utc)
        if current:
            last_sent = int(current["last_sent_at"])
            if now - last_sent < EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS:
                return False
            window_started = int(current["window_started_at"])
            send_count = int(current["send_count"])
            if now - window_started >= EMAIL_VERIFICATION_WINDOW_SECONDS:
                window_started, send_count = now, 1
            elif send_count >= EMAIL_VERIFICATION_MAX_PER_HOUR:
                return False
            else:
                send_count += 1
            changed = self.email_verifications.update_one(
                {
                    "_id": user_id,
                    "token_hash": current["token_hash"],
                    "last_sent_at": last_sent,
                    "send_count": int(current["send_count"]),
                },
                {"$set": {
                    "token_hash": token_hash,
                    "expires_at": expires,
                    "window_started_at": window_started,
                    "send_count": send_count,
                    "last_sent_at": now,
                }},
            )
            return changed.matched_count == 1

        try:
            self.email_verifications.insert_one({
                "_id": user_id,
                "user_id": user_id,
                "token_hash": token_hash,
                "expires_at": expires,
                "window_started_at": now,
                "send_count": 1,
                "last_sent_at": now,
            })
        except DuplicateKeyError:
            return False
        return True

    def verify_email(self, token_hash: str, now: int) -> bool:
        token = self.email_verifications.find_one_and_delete({
            "token_hash": token_hash,
            "expires_at": {"$gt": datetime.fromtimestamp(now, timezone.utc)},
        })
        if not token:
            return False
        changed = self.users.update_one(
            {"_id": token["user_id"], "email_verified": {"$ne": True}},
            {"$set": {"email_verified": True}},
        )
        return changed.matched_count == 1

    def create_password_reset(self, user_id: int | str, token_hash: str, expires_at: int) -> None:
        # Keep only the newest reset link for each account.
        self.password_resets.delete_many({"user_id": user_id})
        self.password_resets.insert_one({
            "_id": token_hash,
            "user_id": user_id,
            "expires_at": datetime.fromtimestamp(expires_at, timezone.utc),
        })

    def use_password_reset(self, token_hash: str, password_salt: str, password_hash_value: str, now: int) -> bool:
        reset = self.password_resets.find_one_and_delete({
            "_id": token_hash,
            "expires_at": {"$gt": datetime.fromtimestamp(now, timezone.utc)},
        })
        if not reset:
            return False

        changed = self.users.update_one(
            {"_id": reset["user_id"]},
            {"$set": {"password_salt": password_salt, "password_hash": password_hash_value}},
        )
        if changed.matched_count != 1:
            return False
        self.sessions.delete_many({"user_id": reset["user_id"]})
        self.password_resets.delete_many({"user_id": reset["user_id"]})
        return True

    def update_user_profile(self, user_id: int | str, name: str, region: str) -> dict | None:
        self.users.update_one(
            {"_id": user_id},
            {"$set": {"name": name, "region": region}},
        )
        user = self.users.find_one({"_id": user_id}, {"name": 1, "email": 1, "region": 1})
        if not user:
            return None
        return {
            "id": user["_id"],
            "name": user["name"],
            "email": user["email"],
            "region": user["region"],
        }

    def find_session_user(self, token_hash: str, now: int) -> dict | None:
        session = self.sessions.find_one({
            "_id": token_hash,
            "expires_at": {"$gt": datetime.fromtimestamp(now, timezone.utc)},
        })
        if not session:
            self.sessions.delete_one({"_id": token_hash})
            return None
        user = self.users.find_one(
            {"_id": session["user_id"]},
            {"name": 1, "email": 1, "region": 1},
        )
        if not user:
            return None
        return {
            "id": user["_id"],
            "name": user["name"],
            "email": user["email"],
            "region": user["region"],
            "expires_at": int(session["expires_at"].timestamp()),
        }

    def create_session(self, token_hash: str, user_id: int | str, expires_at: int) -> None:
        self.sessions.insert_one({
            "_id": token_hash,
            "user_id": user_id,
            "expires_at": datetime.fromtimestamp(expires_at, timezone.utc),
        })

    def delete_session(self, token_hash: str) -> None:
        self.sessions.delete_one({"_id": token_hash})

    def get_finance_data(self, user_id: int | str) -> dict:
        document = self.finance_data.find_one({"_id": user_id})
        if not document:
            return {}
        return {
            key: value
            for key, value in document.items()
            if key in FINANCE_DATA_FIELDS
        }

    def export_account_data(self, user_id: int | str) -> dict | None:
        user = self.users.find_one({"_id": user_id})
        if not user:
            return None
        return build_account_export(user, self.get_finance_data(user_id))

    def delete_account_data(self, user_id: int | str) -> bool:
        # MongoDB transactions keep every collection change together.
        with self.client.start_session() as session:
            with session.start_transaction():
                if not self.users.find_one({"_id": user_id}, session=session):
                    return False
                self.sessions.delete_many({"user_id": user_id}, session=session)
                self.finance_data.delete_one({"_id": user_id}, session=session)
                self.password_resets.delete_many({"user_id": user_id}, session=session)
                self.email_verifications.delete_many({"user_id": user_id}, session=session)
                result = self.users.delete_one({"_id": user_id}, session=session)
        return result.deleted_count == 1

    def update_finance_data(self, user_id: int | str, changes: dict) -> dict:
        self.finance_data.update_one(
            {"_id": user_id},
            {
                "$set": {**changes, "updated_at": datetime.now(timezone.utc)},
                "$setOnInsert": {"created_at": datetime.now(timezone.utc)},
            },
            upsert=True,
        )
        return self.get_finance_data(user_id)


def clean_profile_fields(name: str, region: str) -> tuple[str, str, str | None]:
    """Return cleaned name and region with a short validation error, if any."""
    clean_name = str(name or "").strip()
    clean_region = str(region or "").strip()

    if len(clean_name) < 2 or len(clean_name) > 80:
        return clean_name, clean_region, "Enter a name between 2 and 80 characters."
    if any(ord(character) < 32 for character in clean_name):
        return clean_name, clean_region, "The name contains an invalid character."
    if len(clean_region) < 2 or len(clean_region) > 100:
        return clean_name, clean_region, "Enter a city, district, or region between 2 and 100 characters."
    if any(ord(character) < 32 for character in clean_region):
        return clean_name, clean_region, "The region contains an invalid character."
    return clean_name, clean_region, None


def validate_signup(name: str, email: str, region: str, password: str) -> tuple[dict, str | None]:
    """Check account fields before storing them."""
    clean_name, clean_region, error = clean_profile_fields(name, region)
    clean_email = str(email or "").strip().lower()
    clean_password = str(password or "")

    if error:
        return {}, error
    if len(clean_email) > 254 or not EMAIL_PATTERN.fullmatch(clean_email):
        return {}, "Enter a valid email address."
    if len(clean_password) < 10 or len(clean_password) > 128:
        return {}, "Use a password between 10 and 128 characters."
    return {
        "name": clean_name,
        "email": clean_email,
        "region": clean_region,
        "password": clean_password,
    }, None


def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    """Hash a password with a random salt; never store the original password."""
    password_salt = salt or secrets.token_bytes(16)
    hashed = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        password_salt,
        PASSWORD_HASH_ROUNDS,
    )
    return password_salt.hex(), hashed.hex()


def password_matches(password: str, salt_hex: str, expected_hash: str) -> bool:
    """Compare a submitted password with its stored one-way hash."""
    try:
        _, submitted_hash = hash_password(password, bytes.fromhex(salt_hex))
    except (TypeError, ValueError):
        return False
    return secrets.compare_digest(submitted_hash, expected_hash)


def hash_one_time_token(token: str) -> str:
    """Store only a hash of a random one-time token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_email_verification(
    database_file: Path | MongoStore, user_id: int | str, token_hash: str, expires_at: int, now: int | None = None
) -> bool:
    current_time = int(time.time()) if now is None else int(now)
    if isinstance(database_file, MongoStore):
        return database_file.create_email_verification(user_id, token_hash, expires_at, current_time)
    with open_database(database_file) as connection:
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            "SELECT * FROM email_verification_tokens WHERE user_id = ?", (user_id,)
        ).fetchone()
        window_started, send_count = current_time, 1
        if existing:
            if current_time - existing["last_sent_at"] < EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS:
                return False
            window_started = existing["window_started_at"]
            if current_time - window_started >= EMAIL_VERIFICATION_WINDOW_SECONDS:
                window_started, send_count = current_time, 1
            elif existing["send_count"] >= EMAIL_VERIFICATION_MAX_PER_HOUR:
                return False
            else:
                send_count = existing["send_count"] + 1
            connection.execute("DELETE FROM email_verification_tokens WHERE user_id = ?", (user_id,))
        connection.execute(
            "INSERT INTO email_verification_tokens "
            "(token_hash, user_id, expires_at, window_started_at, send_count, last_sent_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (token_hash, user_id, expires_at, window_started, send_count, current_time),
        )
    return True


def verify_email_token(database_file: Path | MongoStore, token_hash: str, now: int | None = None) -> bool:
    current_time = int(time.time()) if now is None else int(now)
    if isinstance(database_file, MongoStore):
        return database_file.verify_email(token_hash, current_time)
    with open_database(database_file) as connection:
        connection.execute("BEGIN IMMEDIATE")
        token = connection.execute(
            "SELECT user_id FROM email_verification_tokens "
            "WHERE token_hash = ? AND expires_at > ?", (token_hash, current_time)
        ).fetchone()
        if not token:
            return False
        deleted = connection.execute(
            "DELETE FROM email_verification_tokens WHERE token_hash = ? AND expires_at > ?",
            (token_hash, current_time),
        )
        if deleted.rowcount != 1:
            return False
        changed = connection.execute(
            "UPDATE users SET email_verified = 1 WHERE id = ? AND email_verified = 0",
            (token["user_id"],),
        )
    return changed.rowcount == 1


def create_password_reset(database_file: Path | MongoStore, user_id: int | str, token_hash: str, expires_at: int) -> None:
    if isinstance(database_file, MongoStore):
        database_file.create_password_reset(user_id, token_hash, expires_at)
        return

    with open_database(database_file) as connection:
        connection.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", (user_id,))
        connection.execute(
            "INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (token_hash, user_id, expires_at, int(time.time())),
        )


def use_password_reset(
    database_file: Path | MongoStore,
    token_hash: str,
    new_password: str,
    now: int | None = None,
) -> bool:
    """Use one valid reset link, change the password, and end old sessions."""
    current_time = int(time.time()) if now is None else int(now)
    password_salt, password_hash_value = hash_password(new_password)
    if isinstance(database_file, MongoStore):
        return database_file.use_password_reset(
            token_hash, password_salt, password_hash_value, current_time
        )

    with open_database(database_file) as connection:
        connection.execute("BEGIN IMMEDIATE")
        reset = connection.execute(
            "SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?",
            (token_hash, current_time),
        ).fetchone()
        if not reset:
            return False
        deleted = connection.execute(
            "DELETE FROM password_reset_tokens WHERE token_hash = ? AND expires_at > ?",
            (token_hash, current_time),
        )
        if deleted.rowcount != 1:
            return False
        changed = connection.execute(
            "UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?",
            (password_salt, password_hash_value, reset["user_id"]),
        )
        if changed.rowcount != 1:
            return False
        connection.execute("DELETE FROM sessions WHERE user_id = ?", (reset["user_id"],))
        connection.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", (reset["user_id"],))
    return True


def email_smtp_settings() -> dict | None:
    """Return SMTP settings only when the app owner has configured email delivery."""
    host = os.environ.get("FINANCE_AI_SMTP_HOST", "").strip()
    username = os.environ.get("FINANCE_AI_SMTP_USERNAME", "").strip()
    password = os.environ.get("FINANCE_AI_SMTP_PASSWORD", "")
    sender = os.environ.get("FINANCE_AI_SMTP_FROM", username).strip()
    try:
        port = int(os.environ.get("FINANCE_AI_SMTP_PORT", "587"))
    except ValueError:
        return None
    if not host or not username or not password or not sender or not 1 <= port <= 65535:
        return None
    return {"host": host, "port": port, "username": username, "password": password, "sender": sender}


def email_delivery_settings() -> dict | None:
    """Choose SMTP locally or the Brevo HTTPS API on Render."""
    provider = os.environ.get("FINANCE_AI_EMAIL_PROVIDER", "smtp").strip().lower()

    if provider == "smtp":
        settings = email_smtp_settings()
        if settings:
            return {"provider": "smtp", **settings}
        return None

    if provider == "brevo":
        api_key = os.environ.get("FINANCE_AI_BREVO_API_KEY", "").strip()
        sender = os.environ.get("FINANCE_AI_BREVO_SENDER", "").strip()
        if api_key and sender:
            return {"provider": "brevo", "api_key": api_key, "sender": sender}

    return None


def send_email_message(recipient: str, subject: str, body: str) -> None:
    """Send through the configured provider without logging credentials."""
    settings = email_delivery_settings()
    if not settings:
        raise RuntimeError("Email delivery settings are incomplete.")

    if settings["provider"] == "brevo":
        payload = json.dumps(
            {
                "sender": {"name": "Finance AI", "email": settings["sender"]},
                "to": [{"email": recipient}],
                "subject": subject,
                "textContent": body,
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            "https://api.brevo.com/v3/smtp/email",
            data=payload,
            headers={
                "accept": "application/json",
                "api-key": settings["api_key"],
                "content-type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status < 200 or response.status >= 300:
                raise RuntimeError("The email provider rejected the message.")
        return

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings["sender"]
    message["To"] = recipient
    message.set_content(body)

    with smtplib.SMTP(settings["host"], settings["port"], timeout=15) as mail_server:
        mail_server.ehlo()
        mail_server.starttls(context=ssl.create_default_context())
        mail_server.ehlo()
        mail_server.login(settings["username"], settings["password"])
        mail_server.send_message(message)
    return


def send_password_reset_email(recipient: str, reset_url: str) -> None:
    """Send a one-time password-reset link through the configured email provider."""
    send_email_message(
        recipient,
        "Reset your Finance AI password",
        "We received a request to reset your Finance AI password.\n\n"
        f"Use this one-time link within 30 minutes:\n{reset_url}\n\n"
        "If you did not request this, you can ignore this email.",
    )


def send_email_verification(recipient: str, verification_url: str) -> None:
    """Send a one-time verification link through the configured email provider."""
    send_email_message(
        recipient,
        "Verify your Finance AI email | ईमेल सत्यापित करें",
        "Welcome to Finance AI. Verify that you own this email address.\n"
        "इस ईमेल पते की पुष्टि करके अपना Finance AI खाता सत्यापित करें।\n\n"
        "Use this one-time link within 24 hours / इस एक बार इस्तेमाल होने वाले लिंक का उपयोग 24 घंटे के भीतर करें:\n"
        f"{verification_url}\n\n"
        "If you did not create this account, you can ignore this email.\n"
        "यदि आपने यह खाता नहीं बनाया है, तो इस ईमेल को अनदेखा कर सकते हैं।",
    )



def get_password_reset_base_url(port: int) -> str | None:
    """Use a configured public URL in production and localhost during development."""
    base_url = os.environ.get("FINANCE_AI_PUBLIC_URL", "").strip().rstrip("/")
    if not base_url:
        if os.environ.get("FINANCE_AI_ENV", "development").lower() == "production":
            base_url = os.environ.get("RENDER_EXTERNAL_URL", "").strip().rstrip("/")
            if not base_url:
                return None
        else:
            base_url = f"http://127.0.0.1:{port}"

    parsed = urlsplit(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        return None
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        return None
    return base_url


def create_user(database_file: Path | MongoStore, fields: dict, email_verified: bool = False) -> dict:
    """Insert an account and return its non-secret profile fields."""
    if isinstance(database_file, MongoStore):
        return database_file.create_user(fields, email_verified=email_verified)

    salt, password_hash_value = hash_password(fields["password"])
    with open_database(database_file) as connection:
        cursor = connection.execute(
            """INSERT INTO users (name, email, region, password_salt, password_hash, created_at, email_verified)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                fields["name"],
                fields["email"],
                fields["region"],
                salt,
                password_hash_value,
                int(time.time()),
                int(bool(email_verified)),
            ),
        )
        return {
            "id": cursor.lastrowid,
            "name": fields["name"],
            "email": fields["email"],
            "region": fields["region"],
        }


def get_user_by_email(database_file: Path | MongoStore, email: str):
    if isinstance(database_file, MongoStore):
        return database_file.get_user_by_email(email)

    with open_database(database_file) as connection:
        return connection.execute(
            "SELECT * FROM users WHERE email = ? COLLATE NOCASE",
            (email.strip().lower(),),
        ).fetchone()


def update_user_profile(database_file: Path | MongoStore, user_id: int, name: str, region: str) -> dict | None:
    clean_name, clean_region, error = clean_profile_fields(name, region)
    if error:
        raise ValueError(error)

    if isinstance(database_file, MongoStore):
        return database_file.update_user_profile(user_id, clean_name, clean_region)

    with open_database(database_file) as connection:
        connection.execute(
            "UPDATE users SET name = ?, region = ? WHERE id = ?",
            (clean_name, clean_region, user_id),
        )
        row = connection.execute(
            "SELECT id, name, email, region FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        return dict(row) if row else None


FINANCE_DATA_FIELDS = {"plannerProfile", "transactions", "settings", "completedMonths"}
TRANSACTION_FIELDS = {"id", "type", "category", "date", "amount", "note"}
PLANNER_PROFILE_FIELDS = {
    "includeGoal", "monthlyTakeHomeIncome", "monthlyEssentialExpenses",
    "monthlyDiscretionaryExpenses", "monthlyDebtPayment", "householdSize",
    "dependents", "totalSavings", "emergencyFund", "goalSavings",
    "useGoalAssets", "goalAssetContribution", "emergencyFundMonths",
    "goalComfortPercent", "region", "goalType", "goalLabel", "goalPrice",
    "plannedDownPayment", "monthsUntilGoal", "considerLoan", "loanRatePercent",
    "preferredLoanTermMonths", "maxComfortableNewEmi",
}


def validate_finance_data_patch(payload: dict) -> tuple[dict, str | None]:
    """Allow only the signed-in user's known finance fields and safe value types."""
    if not payload or set(payload) - FINANCE_DATA_FIELDS:
        return {}, "The saved finance details contain an unsupported field."

    clean = {}
    for field, value in payload.items():
        if field == "plannerProfile":
            if value is not None and (
                not isinstance(value, dict)
                or len(value) > 80
                or set(value) - PLANNER_PROFILE_FIELDS
                or any(
                    not isinstance(key, str)
                    or len(key) > 80
                    or not isinstance(item, (str, int, float, bool, type(None)))
                    or isinstance(item, float) and not math.isfinite(item)
                    or isinstance(item, str) and len(item) > 500
                    for key, item in value.items()
                )
            ):
                return {}, "The saved planner details are invalid."
        elif field == "transactions":
            if not isinstance(value, list) or len(value) > 5_000:
                return {}, "The income and expense list is invalid or too large."
            for entry in value:
                if not isinstance(entry, dict) or set(entry) - TRANSACTION_FIELDS:
                    return {}, "An income or expense entry has unsupported fields."
                amount = entry.get("amount")
                if (
                    not isinstance(entry.get("id"), str)
                    or not 1 <= len(entry["id"]) <= 100
                    or entry.get("type") not in {"income", "expense"}
                    or not isinstance(entry.get("category"), str)
                    or not 1 <= len(entry["category"]) <= 80
                    or not isinstance(entry.get("date"), str)
                    or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", entry["date"])
                    or not isinstance(amount, (int, float))
                    or isinstance(amount, bool)
                    or not math.isfinite(amount)
                    or amount <= 0
                    or amount > 1_000_000_000
                    or not isinstance(entry.get("note", ""), str)
                    or len(entry.get("note", "")) > 80
                ):
                    return {}, "An income or expense entry is invalid."
                try:
                    datetime.strptime(entry["date"], "%Y-%m-%d")
                except ValueError:
                    return {}, "An income or expense date is invalid."
        elif field == "completedMonths":
            if not isinstance(value, list) or len(value) > 120:
                return {}, "The completed-month list is invalid or too large."
            seen_months = set()
            for month in value:
                if (
                    not isinstance(month, str)
                    or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month)
                    or month in seen_months
                ):
                    return {}, "A completed month is invalid or repeated."
                try:
                    datetime.strptime(month + "-01", "%Y-%m-%d")
                except ValueError:
                    return {}, "A completed month is invalid or repeated."
                seen_months.add(month)
        elif field == "settings":
            if not isinstance(value, dict) or set(value) - {
                "theme", "accent", "textSize", "reduceMotion"
            }:
                return {}, "The saved display settings are invalid."
            allowed = {
                "theme": {"system", "light", "dark"},
                "accent": {"mint", "ocean", "violet"},
                "textSize": {"standard", "large"},
                "reduceMotion": {True, False},
            }
            if any(
                not isinstance(item, bool) if key == "reduceMotion"
                else not isinstance(item, str) or item not in allowed[key]
                for key, item in value.items()
            ):
                return {}, "The saved display settings are invalid."
        clean[field] = value
    return clean, None


def build_account_export(user: dict, finance_data: dict) -> dict:
    """Return user-owned data without credentials or active authentication tokens."""
    created_at = user.get("created_at")
    created_at_text = (
        datetime.fromtimestamp(int(created_at), timezone.utc).isoformat().replace("+00:00", "Z")
        if created_at is not None else None
    )
    email_verified = user.get("email_verified")
    return {
        "format": "finance-ai-account-export-v1",
        "exportedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "account": {
            "name": user["name"],
            "email": user["email"],
            "region": user["region"],
            "emailVerified": True if email_verified is None else bool(email_verified),
            "createdAt": created_at_text,
        },
        "financeData": finance_data,
    }


def export_account_data(database_file: Path | MongoStore, user_id: int | str) -> dict | None:
    """Export only the profile and finance records belonging to this account ID."""
    if isinstance(database_file, MongoStore):
        return database_file.export_account_data(user_id)
    with open_database(database_file) as connection:
        user = connection.execute(
            "SELECT name, email, region, email_verified, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not user:
            return None
        finance_row = connection.execute(
            "SELECT payload FROM user_finance_data WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    finance_data = json.loads(finance_row["payload"]) if finance_row else {}
    return build_account_export(dict(user), finance_data)


def delete_account_data(database_file: Path | MongoStore, user_id: int | str) -> bool:
    """Permanently delete an account and every stored record linked to its ID."""
    if isinstance(database_file, MongoStore):
        return database_file.delete_account_data(user_id)
    with open_database(database_file) as connection:
        deleted_count = connection.execute(
            "DELETE FROM users WHERE id = ?", (user_id,)
        ).rowcount
    # SQLite's enabled foreign keys cascade to sessions, finance data, and tokens.
    return deleted_count == 1


def get_finance_data(database_file: Path | MongoStore, user_id: int | str) -> dict:
    if isinstance(database_file, MongoStore):
        return database_file.get_finance_data(user_id)
    with open_database(database_file) as connection:
        row = connection.execute(
            "SELECT payload FROM user_finance_data WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    return json.loads(row["payload"]) if row else {}


def update_finance_data(database_file: Path | MongoStore, user_id: int | str, changes: dict) -> dict:
    if isinstance(database_file, MongoStore):
        return database_file.update_finance_data(user_id, changes)
    with open_database(database_file) as connection:
        row = connection.execute(
            "SELECT payload FROM user_finance_data WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        saved = json.loads(row["payload"]) if row else {}
        saved.update(changes)
        connection.execute(
            """INSERT INTO user_finance_data (user_id, payload, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload,
                   updated_at = excluded.updated_at""",
            (user_id, json.dumps(saved, allow_nan=False), int(time.time())),
        )
    return saved


def hash_session_token(token: str) -> str:
    """Only a hash of the browser's random session token is stored on disk."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def account_request_allowed(client_ip: str, route: str, now: float | None = None) -> bool:
    """Slow repeated sign-in and account-creation attempts from one address."""
    current_time = time.monotonic() if now is None else now
    if route == "/api/login":
        maximum_attempts = 10
    elif route in {"/api/password-reset/request", "/api/email-verification/resend"}:
        maximum_attempts = 3
    elif route in {"/api/password-reset/complete", "/api/email-verification/complete"}:
        maximum_attempts = 8
    else:
        maximum_attempts = 5
    key = (client_ip, route)
    with _RATE_LIMIT_LOCK:
        attempts = [
            started_at
            for started_at in _ACCOUNT_ATTEMPTS.get(key, [])
            if current_time - started_at < RATE_LIMIT_WINDOW_SECONDS
        ]
        if len(attempts) >= maximum_attempts:
            _ACCOUNT_ATTEMPTS[key] = attempts
            return False
        attempts.append(current_time)
        _ACCOUNT_ATTEMPTS[key] = attempts
        return True


def is_database_error(error: Exception) -> bool:
    """Recognize database outages without making MongoDB mandatory for local mode."""
    if isinstance(error, sqlite3.Error):
        return True
    try:
        from pymongo.errors import PyMongoError
    except ImportError:
        return False
    return isinstance(error, PyMongoError)


class FinanceRequestHandler(BaseHTTPRequestHandler):
    """Serve the static app and its same-origin account API."""

    server_version = "FinanceAI"

    def log_message(self, format_string, *args):
        # Keep routine requests quiet; server errors still appear in the terminal.
        return

    @property
    def database_file(self) -> Path | MongoStore:
        return self.server.database_file

    def send_security_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "connect-src 'self'; img-src 'self' data:; base-uri 'self'; "
            "form-action 'self'; frame-ancestors 'none'",
        )

    def send_json(self, status: int, payload: dict, extra_headers: dict | None = None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_security_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status: int, message: str):
        self.send_json(status, {"error": message})

    def send_database_unavailable(self):
        self.send_error_json(
            HTTPStatus.SERVICE_UNAVAILABLE,
            "The database is temporarily unavailable. Please try again shortly.",
        )

    def read_json_body(self):
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self.send_error_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Send account details as JSON.")
            return None

        try:
            body_size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "The request size is invalid.")
            return None
        maximum_size = (
            MAX_FINANCE_DATA_BYTES
            if urlsplit(self.path).path == "/api/finance-data"
            else MAX_REQUEST_BYTES
        )
        if body_size <= 0 or body_size > maximum_size:
            self.send_error_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "The request is too large or empty.")
            return None

        try:
            payload = json.loads(self.rfile.read(body_size))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "The request could not be read.")
            return None
        if not isinstance(payload, dict):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "The request fields are invalid.")
            return None
        return payload

    def request_is_same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return False
        try:
            return urlsplit(origin).netloc.lower() == self.headers.get("Host", "").lower()
        except ValueError:
            return False

    def read_session_token(self) -> str | None:
        cookie_header = self.headers.get("Cookie", "")
        cookie = SimpleCookie()
        try:
            cookie.load(cookie_header)
            morsel = cookie.get(SESSION_COOKIE)
            return morsel.value if morsel else None
        except Exception:
            return None

    def current_user(self):
        token = self.read_session_token()
        if not token:
            return None

        now = int(time.time())
        token_hash = hash_session_token(token)
        if isinstance(self.database_file, MongoStore):
            return self.database_file.find_session_user(token_hash, now)
        with open_database(self.database_file) as connection:
            row = connection.execute(
                """SELECT users.id, users.name, users.email, users.region, sessions.expires_at
                   FROM sessions JOIN users ON users.id = sessions.user_id
                   WHERE sessions.token_hash = ?""",
                (token_hash,),
            ).fetchone()
            if row and row["expires_at"] <= now:
                connection.execute(
                    "DELETE FROM sessions WHERE token_hash = ?",
                    (token_hash,),
                )
                return None
            return dict(row) if row else None

    def make_session(self, user_id: int | str) -> tuple[str, str]:
        token = secrets.token_urlsafe(32)
        expires_at = int(time.time()) + SESSION_LIFETIME_SECONDS
        token_hash = hash_session_token(token)
        if isinstance(self.database_file, MongoStore):
            self.database_file.create_session(token_hash, user_id, expires_at)
        else:
            with open_database(self.database_file) as connection:
                connection.execute(
                    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                    (token_hash, user_id, expires_at),
                )
        flags = ["Path=/", f"Max-Age={SESSION_LIFETIME_SECONDS}", "HttpOnly", "SameSite=Strict"]
        if COOKIE_SECURE:
            flags.append("Secure")
        return token, f"{SESSION_COOKIE}={token}; " + "; ".join(flags)

    def clear_session_cookie(self) -> str:
        flags = ["Path=/", "Max-Age=0", "HttpOnly", "SameSite=Strict"]
        if COOKIE_SECURE:
            flags.append("Secure")
        return f"{SESSION_COOKIE}=; " + "; ".join(flags)

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == "/api/me":
            try:
                user = self.current_user()
            except Exception as error:
                if is_database_error(error):
                    self.send_database_unavailable()
                    return
                raise
            if not user:
                self.send_error_json(HTTPStatus.UNAUTHORIZED, "Please sign in.")
                return
            user.pop("expires_at", None)
            self.send_json(HTTPStatus.OK, {"user": user})
            return
        if path == "/api/account/export":
            try:
                user = self.current_user()
                if not user:
                    self.send_error_json(HTTPStatus.UNAUTHORIZED, "Please sign in.")
                    return
                export = export_account_data(self.database_file, user["id"])
            except Exception as error:
                if is_database_error(error):
                    self.send_database_unavailable()
                    return
                raise
            if not export:
                self.send_error_json(HTTPStatus.UNAUTHORIZED, "Please sign in again.")
                return
            self.send_json(
                HTTPStatus.OK,
                export,
                {"Content-Disposition": 'attachment; filename="finance-ai-account-export.json"'},
            )
            return
        if path == "/api/finance-data":
            try:
                user = self.current_user()
            except Exception as error:
                if is_database_error(error):
                    self.send_database_unavailable()
                    return
                raise
            if not user:
                self.send_error_json(HTTPStatus.UNAUTHORIZED, "Please sign in.")
                return
            try:
                data = get_finance_data(self.database_file, user["id"])
            except Exception as error:
                if is_database_error(error):
                    self.send_database_unavailable()
                    return
                raise
            self.send_json(HTTPStatus.OK, {"data": data})
            return

        asset = self.resolve_static_asset(path)
        if asset is None:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Page not found.")
            return
        self.send_static_file(asset)

    def do_POST(self):
        path = urlsplit(self.path).path
        if not self.request_is_same_origin():
            self.send_error_json(HTTPStatus.FORBIDDEN, "This account request was blocked.")
            return
        account_paths = {
            "/api/login",
            "/api/signup",
            "/api/password-reset/request",
            "/api/password-reset/complete",
            "/api/email-verification/resend",
            "/api/email-verification/complete",
            "/api/account/delete",
        }
        if path in account_paths:
            client_ip = self.client_address[0]
            if not account_request_allowed(client_ip, path):
                self.send_error_json(HTTPStatus.TOO_MANY_REQUESTS, "Too many attempts. Wait a little and try again.")
                return

        payload = self.read_json_body()
        if payload is None:
            return

        try:
            if path == "/api/signup":
                self.handle_signup(payload)
            elif path == "/api/login":
                self.handle_login(payload)
            elif path == "/api/logout":
                self.handle_logout()
            elif path == "/api/password-reset/request":
                self.handle_password_reset_request(payload)
            elif path == "/api/password-reset/complete":
                self.handle_password_reset_complete(payload)
            elif path == "/api/email-verification/resend":
                self.handle_email_verification_resend(payload)
            elif path == "/api/email-verification/complete":
                self.handle_email_verification_complete(payload)
            elif path == "/api/account/delete":
                self.handle_account_delete(payload)
            else:
                self.send_error_json(HTTPStatus.NOT_FOUND, "Account action not found.")
        except Exception as error:
            if is_database_error(error):
                self.send_database_unavailable()
                return
            raise

    def do_PUT(self):
        if urlsplit(self.path).path != "/api/profile":
            self.send_error_json(HTTPStatus.NOT_FOUND, "Profile action not found.")
            return
        if not self.request_is_same_origin():
            self.send_error_json(HTTPStatus.FORBIDDEN, "This profile request was blocked.")
            return
        try:
            user = self.current_user()
        except Exception as error:
            if is_database_error(error):
                self.send_database_unavailable()
                return
            raise
        if not user:
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "Please sign in again.")
            return
        payload = self.read_json_body()
        if payload is None:
            return

        name, region, error = clean_profile_fields(payload.get("name"), payload.get("region"))
        if error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, error)
            return
        try:
            updated = update_user_profile(self.database_file, user["id"], name, region)
        except Exception as error:
            if is_database_error(error):
                self.send_database_unavailable()
                return
            raise
        self.send_json(HTTPStatus.OK, {"user": updated})

    def do_PATCH(self):
        if urlsplit(self.path).path != "/api/finance-data":
            self.send_error_json(HTTPStatus.NOT_FOUND, "Saved finance data was not found.")
            return
        if not self.request_is_same_origin():
            self.send_error_json(HTTPStatus.FORBIDDEN, "This finance data request was blocked.")
            return
        try:
            user = self.current_user()
        except Exception as error:
            if is_database_error(error):
                self.send_database_unavailable()
                return
            raise
        if not user:
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "Please sign in again.")
            return
        payload = self.read_json_body()
        if payload is None:
            return
        changes, error = validate_finance_data_patch(payload)
        if error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, error)
            return
        try:
            data = update_finance_data(self.database_file, user["id"], changes)
        except Exception as error:
            if is_database_error(error):
                self.send_database_unavailable()
                return
            raise
        self.send_json(HTTPStatus.OK, {"data": data})

    def handle_password_reset_request(self, payload: dict):
        email = str(payload.get("email") or "").strip().lower()
        if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Enter a valid email address.")
            return

        if not email_delivery_settings():
            self.send_error_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "Password recovery email is not configured. Ask the app owner to set it up.",
            )
            return

        base_url = get_password_reset_base_url(self.server.server_port)
        if not base_url:
            self.send_error_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "The app's public address is not configured for password recovery.",
            )
            return

        # Always show the same result so someone cannot check which emails have accounts.
        user = get_user_by_email(self.database_file, email)
        if user:
            token = secrets.token_urlsafe(32)
            expires_at = int(time.time()) + PASSWORD_RESET_LIFETIME_SECONDS
            create_password_reset(
                self.database_file,
                user["id"],
                hash_one_time_token(token),
                expires_at,
            )
            reset_url = f"{base_url}/#reset_token={quote(token, safe='')}"
            try:
                send_password_reset_email(email, reset_url)
            except Exception as error:
                # Never include the address, reset link, or SMTP details in server logs.
                print(f"Password reset email delivery failed: {type(error).__name__}")

        self.send_json(HTTPStatus.OK, {
            "message": "If this email belongs to an account, a password reset link will be sent shortly."
        })

    def handle_password_reset_complete(self, payload: dict):
        token = str(payload.get("token") or "").strip()
        new_password = str(payload.get("password") or "")
        if not 32 <= len(token) <= 128:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "This reset link is invalid or expired. Request a new one.")
            return
        if not 10 <= len(new_password) <= 128:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Use a password between 10 and 128 characters.")
            return

        changed = use_password_reset(
            self.database_file,
            hash_one_time_token(token),
            new_password,
        )
        if not changed:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "This reset link is invalid or expired. Request a new one.")
            return
        self.send_json(HTTPStatus.OK, {
            "message": "Your password was changed. Sign in using your new password."
        })

    def send_email_verification_link(self, user: dict, base_url: str) -> str:
        """Create and send a one-time link, respecting stored resend limits."""
        now = int(time.time())
        token = secrets.token_urlsafe(32)
        allowed = create_email_verification(
            self.database_file, user["id"], hash_one_time_token(token),
            now + EMAIL_VERIFICATION_LIFETIME_SECONDS, now,
        )
        if not allowed:
            return "limited"
        verification_url = f"{base_url}/#verify_email={quote(token)}"
        try:
            send_email_verification(user["email"], verification_url)
        except Exception as error:
            # Do not log addresses, links, or SMTP settings.
            print(f"Email verification delivery failed: {type(error).__name__}")
            return "failed"
        return "sent"

    def handle_email_verification_resend(self, payload: dict):
        email = str(payload.get("email") or "").strip().lower()
        if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Enter a valid email address.")
            return
        if not email_delivery_settings():
            self.send_error_json(HTTPStatus.SERVICE_UNAVAILABLE, "Email verification is not configured. Ask the app owner to set it up.")
            return
        base_url = get_password_reset_base_url(self.server.server_port)
        if not base_url:
            self.send_error_json(HTTPStatus.SERVICE_UNAVAILABLE, "The app public address is not configured for email verification.")
            return
        user = get_user_by_email(self.database_file, email)
        if user and not user["email_verified"]:
            self.send_email_verification_link(user, base_url)
        self.send_json(HTTPStatus.OK, {
            "message": "If this email needs verification, a link will be sent. If you requested one recently, wait one minute before trying again."
        })

    def handle_email_verification_complete(self, payload: dict):
        token = str(payload.get("token") or "").strip()
        if not 32 <= len(token) <= 128:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "This verification link is invalid or expired. Request a new one.")
            return
        if not verify_email_token(self.database_file, hash_one_time_token(token)):
            self.send_error_json(HTTPStatus.BAD_REQUEST, "This verification link is invalid or expired. Request a new one.")
            return
        self.send_json(HTTPStatus.OK, {"message": "Your email is verified. Sign in to continue."})

    def handle_account_delete(self, payload: dict):
        user = self.current_user()
        if not user:
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "Please sign in again.")
            return
        if payload.get("confirmation") != "DELETE":
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Type DELETE exactly to confirm permanent removal.")
            return
        password = str(payload.get("password") or "")
        if not 10 <= len(password) <= 128:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Enter your current password to confirm deletion.")
            return
        account = get_user_by_email(self.database_file, user["email"])
        if not account or account["id"] != user["id"]:
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "Please sign in again.")
            return
        if not password_matches(password, account["password_salt"], account["password_hash"]):
            self.send_error_json(HTTPStatus.FORBIDDEN, "Your password did not match. No data was deleted.")
            return
        if not delete_account_data(self.database_file, user["id"]):
            self.send_error_json(HTTPStatus.NOT_FOUND, "Your account could not be found.")
            return
        self.send_json(
            HTTPStatus.OK,
            {"message": "Your account and saved data were permanently deleted."},
            {"Set-Cookie": self.clear_session_cookie()},
        )

    def handle_signup(self, payload: dict):
        fields, error = validate_signup(
            payload.get("name"),
            payload.get("email"),
            payload.get("region"),
            payload.get("password"),
        )
        if error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, error)
            return
        if not email_delivery_settings():
            self.send_error_json(HTTPStatus.SERVICE_UNAVAILABLE, "Email verification is not configured. Ask the app owner to set it up.")
            return
        base_url = get_password_reset_base_url(self.server.server_port)
        if not base_url:
            self.send_error_json(HTTPStatus.SERVICE_UNAVAILABLE, "The app public address is not configured for email verification.")
            return
        try:
            user = create_user(self.database_file, fields)
        except (sqlite3.IntegrityError, DuplicateEmailError):
            self.send_error_json(HTTPStatus.CONFLICT, "An account with that email already exists.")
            return

        delivery = self.send_email_verification_link(user, base_url)
        if delivery == "limited":
            self.send_error_json(HTTPStatus.TOO_MANY_REQUESTS, "Too many verification emails were requested. Wait before trying again.")
            return
        if delivery == "failed":
            self.send_error_json(HTTPStatus.SERVICE_UNAVAILABLE, "Your account was created, but we could not send the verification email. Wait one minute, then resend it.")
            return
        self.send_json(HTTPStatus.CREATED, {"message": "Account created. Check your email for a verification link. The link expires in 24 hours."})

    def handle_login(self, payload: dict):
        email = str(payload.get("email") or "").strip().lower()
        password = str(payload.get("password") or "")
        if not password or len(password) > 128:
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "Email or password is incorrect.")
            return
        user = get_user_by_email(self.database_file, email) if EMAIL_PATTERN.fullmatch(email) else None

        if user:
            valid_password = password_matches(password, user["password_salt"], user["password_hash"])
        else:
            # Do similar password work for unknown email addresses to reduce timing leaks.
            password_matches(password, "00112233445566778899aabbccddeeff", "0" * 64)
            valid_password = False

        if not valid_password:
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "Email or password is incorrect.")
            return
        if not bool(user["email_verified"]):
            self.send_error_json(HTTPStatus.FORBIDDEN, "Verify your email address before signing in. Use Resend verification email if you need a new link.")
            return

        profile = {key: user[key] for key in ("id", "name", "email", "region")}
        _, cookie = self.make_session(user["id"])
        self.send_json(HTTPStatus.OK, {"user": profile}, {"Set-Cookie": cookie})

    def handle_logout(self):
        token = self.read_session_token()
        if token:
            token_hash = hash_session_token(token)
            if isinstance(self.database_file, MongoStore):
                self.database_file.delete_session(token_hash)
            else:
                with open_database(self.database_file) as connection:
                    connection.execute(
                        "DELETE FROM sessions WHERE token_hash = ?",
                        (token_hash,),
                    )
        self.send_json(
            HTTPStatus.OK,
            {"message": "Signed out."},
            {"Set-Cookie": self.clear_session_cookie()},
        )

    @staticmethod
    def resolve_static_asset(path: str) -> Path | None:
        """Expose only the app shell, browser modules, and approved PNG assets."""
        if path in ("/", "/index.html"):
            return APP_FOLDER / "index.html"
        if path == "/profile.html":
            return APP_FOLDER / "profile.html"
        if path == "/styles.css":
            return APP_FOLDER / "styles.css"
        if path.startswith("/assets/") and Path(path).suffix.lower() == ".png":
            candidate = (APP_FOLDER / path.lstrip("/")).resolve()
            assets_folder = (APP_FOLDER / "assets").resolve()
            if candidate.is_relative_to(assets_folder) and candidate.is_file():
                return candidate
        if path.startswith("/js/") and path.endswith(".mjs"):
            candidate = (APP_FOLDER / path.lstrip("/")).resolve()
            js_folder = (APP_FOLDER / "js").resolve()
            if candidate.is_relative_to(js_folder) and candidate.is_file():
                return candidate
        return None

    def send_static_file(self, path: Path):
        try:
            body = path.read_bytes()
        except OSError:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Page not found.")
            return

        content_types = {
            ".mjs": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".html": "text/html; charset=utf-8",
            ".png": "image/png",
        }
        content_type = content_types.get(path.suffix.lower(), "application/octet-stream")

        self.send_response(HTTPStatus.OK)
        self.send_security_headers()
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        path = unquote(urlsplit(self.path).path)
        asset = self.resolve_static_asset(path)
        if asset is None or not asset.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content_types = {
            ".mjs": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".html": "text/html; charset=utf-8",
            ".png": "image/png",
        }
        content_type = content_types.get(asset.suffix.lower(), "application/octet-stream")
        self.send_response(HTTPStatus.OK)
        self.send_security_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(asset.stat().st_size))
        self.end_headers()


class FinanceHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, server_address, handler_class, database_file: Path | MongoStore):
        super().__init__(server_address, handler_class)
        self.database_file = database_file


def main():
    global DATABASE_FILE, COOKIE_SECURE

    # Read local settings only when actually starting the server, never on import.
    load_local_environment()
    production = os.environ.get("FINANCE_AI_ENV", "development").lower() == "production"
    DATABASE_FILE = Path(os.environ.get(
        "FINANCE_AI_DATABASE",
        str(APP_FOLDER / "data" / "finance_ai_accounts.sqlite3"),
    ))
    COOKIE_SECURE = os.environ.get(
        "FINANCE_AI_COOKIE_SECURE",
        "1" if production else "0",
    ) == "1"
    mongo_uri = os.environ.get("MONGODB_URI", "").strip()
    if production and not mongo_uri:
        raise RuntimeError("Set MONGODB_URI before starting Finance AI in production.")
    if production and not COOKIE_SECURE:
        raise RuntimeError("Set FINANCE_AI_COOKIE_SECURE=1 when running the app over HTTPS.")

    # Do not launch a public app that cannot send verification and recovery emails.
    if production:
        if not email_delivery_settings():
            raise RuntimeError(
                "Configure a complete email provider before starting in production: "
                "SMTP settings or FINANCE_AI_BREVO_API_KEY and FINANCE_AI_BREVO_SENDER."
            )
        public_url = get_password_reset_base_url(
            int(os.environ.get("FINANCE_AI_PORT", os.environ.get("PORT", "8000")))
        )
        if not public_url or urlsplit(public_url).scheme != "https":
            raise RuntimeError(
                "Set FINANCE_AI_PUBLIC_URL to the app's full HTTPS address in production."
            )

    if mongo_uri:
        database_file = MongoStore(
            mongo_uri,
            os.environ.get("MONGODB_DATABASE", "finance_ai"),
        )
        print(f"Account and finance data are stored in MongoDB database '{os.environ.get('MONGODB_DATABASE', 'finance_ai')}'.")
    else:
        database_file = DATABASE_FILE
        initialize_database(database_file)
        print(f"Local development data is stored in {database_file}")

    host = os.environ.get("FINANCE_AI_HOST", "0.0.0.0" if production else "127.0.0.1")
    port = int(os.environ.get("FINANCE_AI_PORT", os.environ.get("PORT", "8000")))
    server = FinanceHTTPServer((host, port), FinanceRequestHandler, database_file)
    print(f"Finance AI is running at http://{host}:{port}")
    print("Press Ctrl+C to stop the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Finance AI server.")
    finally:
        server.server_close()
        if isinstance(database_file, MongoStore):
            database_file.client.close()


if __name__ == "__main__":
    main()
