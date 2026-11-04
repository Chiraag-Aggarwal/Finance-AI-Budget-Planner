"""Public-file preview for browser tests: no .env, email, or database access."""
import mimetypes
import sys
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import FinanceRequestHandler, read_static_body


class PreviewHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        path = FinanceRequestHandler.resolve_static_asset(urlsplit(self.path).path)
        if path is None or not path.is_file():
            self.send_error(404)
            return
        body = read_static_body(path)
        kind = "text/javascript" if path.suffix == ".mjs" else mimetypes.guess_type(path)[0]
        self.send_response(200)
        self.send_header("Content-Type", kind or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 0), PreviewHandler)
    print(f"http://127.0.0.1:{server.server_port}", flush=True)
    server.serve_forever()
