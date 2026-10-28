"""Small, dependency-free Python server for the Finance AI account pages."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


APP_FOLDER = Path(__file__).resolve().parent
DATABASE_FILE = Path(os.environ.get(
    "FINANCE_AI_DATABASE",
    str(APP_FOLDER / "data" / "finance_ai_accounts.sqlite3"),
))
SESSION_COOKIE = "finance_ai_session"
SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7
PASSWORD_HASH_ROUNDS = 310_000
MAX_REQUEST_BYTES = 16_384
COOKIE_SECURE = os.environ.get("FINANCE_AI_COOKIE_SECURE", "0") == "1"
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
            """
        )


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


def create_user(database_file: Path, fields: dict) -> dict:
    """Insert an account and return its non-secret profile fields."""
    salt, password_hash_value = hash_password(fields["password"])
    with open_database(database_file) as connection:
        cursor = connection.execute(
            """INSERT INTO users (name, email, region, password_salt, password_hash, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                fields["name"],
                fields["email"],
                fields["region"],
                salt,
                password_hash_value,
                int(time.time()),
            ),
        )
        return {
            "id": cursor.lastrowid,
            "name": fields["name"],
            "email": fields["email"],
            "region": fields["region"],
        }


def get_user_by_email(database_file: Path, email: str):
    with open_database(database_file) as connection:
        return connection.execute(
            "SELECT * FROM users WHERE email = ? COLLATE NOCASE",
            (email.strip().lower(),),
        ).fetchone()


def update_user_profile(database_file: Path, user_id: int, name: str, region: str) -> dict | None:
    clean_name, clean_region, error = clean_profile_fields(name, region)
    if error:
        raise ValueError(error)

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


def hash_session_token(token: str) -> str:
    """Only a hash of the browser's random session token is stored on disk."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def account_request_allowed(client_ip: str, route: str, now: float | None = None) -> bool:
    """Slow repeated sign-in and account-creation attempts from one address."""
    current_time = time.monotonic() if now is None else now
    maximum_attempts = 10 if route == "/api/login" else 5
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


class FinanceRequestHandler(BaseHTTPRequestHandler):
    """Serve the static app and its same-origin account API."""

    server_version = "FinanceAI"

    def log_message(self, format_string, *args):
        # Keep routine requests quiet; server errors still appear in the terminal.
        return

    @property
    def database_file(self) -> Path:
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
        if body_size <= 0 or body_size > MAX_REQUEST_BYTES:
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
        with open_database(self.database_file) as connection:
            row = connection.execute(
                """SELECT users.id, users.name, users.email, users.region, sessions.expires_at
                   FROM sessions JOIN users ON users.id = sessions.user_id
                   WHERE sessions.token_hash = ?""",
                (hash_session_token(token),),
            ).fetchone()
            if row and row["expires_at"] <= now:
                connection.execute(
                    "DELETE FROM sessions WHERE token_hash = ?",
                    (hash_session_token(token),),
                )
                return None
            return dict(row) if row else None

    def make_session(self, user_id: int) -> tuple[str, str]:
        token = secrets.token_urlsafe(32)
        expires_at = int(time.time()) + SESSION_LIFETIME_SECONDS
        with open_database(self.database_file) as connection:
            connection.execute(
                "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (hash_session_token(token), user_id, expires_at),
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
            user = self.current_user()
            if not user:
                self.send_error_json(HTTPStatus.UNAUTHORIZED, "Please sign in.")
                return
            user.pop("expires_at", None)
            self.send_json(HTTPStatus.OK, {"user": user})
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
        if path in ("/api/login", "/api/signup"):
            client_ip = self.client_address[0]
            if not account_request_allowed(client_ip, path):
                self.send_error_json(HTTPStatus.TOO_MANY_REQUESTS, "Too many attempts. Wait a little and try again.")
                return

        payload = self.read_json_body()
        if payload is None:
            return

        if path == "/api/signup":
            self.handle_signup(payload)
        elif path == "/api/login":
            self.handle_login(payload)
        elif path == "/api/logout":
            self.handle_logout()
        else:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Account action not found.")

    def do_PUT(self):
        if urlsplit(self.path).path != "/api/profile":
            self.send_error_json(HTTPStatus.NOT_FOUND, "Profile action not found.")
            return
        if not self.request_is_same_origin():
            self.send_error_json(HTTPStatus.FORBIDDEN, "This profile request was blocked.")
            return
        user = self.current_user()
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
        updated = update_user_profile(self.database_file, user["id"], name, region)
        self.send_json(HTTPStatus.OK, {"user": updated})

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
        try:
            user = create_user(self.database_file, fields)
        except sqlite3.IntegrityError:
            self.send_error_json(HTTPStatus.CONFLICT, "An account with that email already exists.")
            return

        _, cookie = self.make_session(user["id"])
        self.send_json(HTTPStatus.CREATED, {"user": user}, {"Set-Cookie": cookie})

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

        profile = {key: user[key] for key in ("id", "name", "email", "region")}
        _, cookie = self.make_session(user["id"])
        self.send_json(HTTPStatus.OK, {"user": profile}, {"Set-Cookie": cookie})

    def handle_logout(self):
        token = self.read_session_token()
        if token:
            with open_database(self.database_file) as connection:
                connection.execute(
                    "DELETE FROM sessions WHERE token_hash = ?",
                    (hash_session_token(token),),
                )
        self.send_json(
            HTTPStatus.OK,
            {"message": "Signed out."},
            {"Set-Cookie": self.clear_session_cookie()},
        )

    @staticmethod
    def resolve_static_asset(path: str) -> Path | None:
        """Only expose app HTML, styles, and browser modules, never server or database files."""
        if path in ("/", "/index.html"):
            return APP_FOLDER / "index.html"
        if path == "/styles.css":
            return APP_FOLDER / "styles.css"
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

        content_type = "text/javascript; charset=utf-8" if path.suffix == ".mjs" else None
        if path.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        elif path.suffix == ".html":
            content_type = "text/html; charset=utf-8"

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
        content_type = "text/javascript; charset=utf-8" if asset.suffix == ".mjs" else "text/html; charset=utf-8"
        if asset.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_security_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(asset.stat().st_size))
        self.end_headers()


class FinanceHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, server_address, handler_class, database_file: Path):
        super().__init__(server_address, handler_class)
        self.database_file = database_file


def main():
    database_file = DATABASE_FILE
    initialize_database(database_file)
    host = os.environ.get("FINANCE_AI_HOST", "127.0.0.1")
    port = int(os.environ.get("FINANCE_AI_PORT", "8000"))
    server = FinanceHTTPServer((host, port), FinanceRequestHandler, database_file)
    print(f"Finance AI is running at http://{host}:{port}")
    print(f"Account data is stored in {database_file}")
    print("Press Ctrl+C to stop the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Finance AI server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
