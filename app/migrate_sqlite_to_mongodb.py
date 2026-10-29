"""Move existing local accounts and saved server data into MongoDB."""

from __future__ import annotations

import os
import sys
import json
from datetime import datetime, timezone
from pathlib import Path

from server import DATABASE_FILE, MongoStore, initialize_database, open_database


def migrate(sqlite_file: Path, mongo_uri: str, database_name: str) -> int:
    """Copy account records without moving active browser sessions."""
    if not sqlite_file.is_file():
        raise FileNotFoundError(f"Local account database was not found: {sqlite_file}")

    initialize_database(sqlite_file)
    with open_database(sqlite_file) as connection:
        users = [dict(row) for row in connection.execute("SELECT * FROM users")]
        saved_data = {
            row["user_id"]: row["payload"]
            for row in connection.execute("SELECT user_id, payload FROM user_finance_data")
        }

    mongo = MongoStore(mongo_uri, database_name)
    try:
        # Detect conflicts before copying anything, so the user can resolve them safely.
        for user in users:
            existing_id = mongo.users.find_one({"_id": user["id"]})
            existing_email = mongo.users.find_one({"email": user["email"].lower()})
            if existing_id and existing_id.get("email") != user["email"].lower():
                raise RuntimeError(f"MongoDB already uses account ID {user['id']} for another user.")
            if existing_email and existing_email.get("_id") != user["id"]:
                raise RuntimeError(f"MongoDB already contains {user['email']}. No accounts were copied.")

        for user in users:
            mongo.users.update_one(
                {"_id": user["id"]},
                {
                    "$setOnInsert": {
                        "name": user["name"],
                        "email": user["email"].lower(),
                        "region": user["region"],
                        "password_salt": user["password_salt"],
                        "password_hash": user["password_hash"],
                        "created_at": user["created_at"],
                    }
                },
                upsert=True,
            )

        for user_id, payload in saved_data.items():
            mongo.finance_data.update_one(
                {"_id": user_id},
                {
                    "$setOnInsert": {
                        **json.loads(payload),
                        "created_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
                upsert=True,
            )

        return len(users)
    finally:
        mongo.client.close()


def main() -> int:
    mongo_uri = os.environ.get("MONGODB_URI", "").strip()
    if not mongo_uri:
        print("Set MONGODB_URI before running this migration.", file=sys.stderr)
        return 2

    sqlite_file = Path(os.environ.get("FINANCE_AI_DATABASE", str(DATABASE_FILE)))
    database_name = os.environ.get("MONGODB_DATABASE", "finance_ai")
    try:
        count = migrate(sqlite_file, mongo_uri, database_name)
    except Exception as error:
        print(f"Migration stopped: {error}", file=sys.stderr)
        return 1

    print(f"Copied {count} local account(s) to MongoDB. Sign in again to create a new session.")
    print("Any saved planner or budget data in the browser will be imported when that account opens the app.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
