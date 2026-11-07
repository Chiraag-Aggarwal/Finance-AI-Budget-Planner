"""Real local HTTP flow with a disposable database and fictional verified accounts.
Never loads .env and never sends email. Used only by workspace.browser.mjs.
"""
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import FinanceHTTPServer, FinanceRequestHandler, initialize_database, create_user, validate_signup

with tempfile.TemporaryDirectory(prefix="finance-ai-browser-") as folder:
    database=Path(folder)/"test.sqlite3"
    initialize_database(database)
    for name,email in [("Workspace Test","workspace@example.com"),("Other Test","other@example.com")]:
        fields,error=validate_signup(name,email,"Pune","Browser-test-password-123")
        assert not error
        create_user(database,fields,email_verified=True)
    server=FinanceHTTPServer(("127.0.0.1",0),FinanceRequestHandler,database)
    print(f"http://127.0.0.1:{server.server_port}",flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
