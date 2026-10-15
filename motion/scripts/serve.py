#!/usr/bin/env python3
"""Threaded no-cache static server for motion/ (ES fetches and fonts need http://, not file://)."""
import functools, http.server, socketserver, sys, threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def start(port=8777):
    srv = Server(("127.0.0.1", port), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    start(port)
    print(f"serving {ROOT} on http://127.0.0.1:{port}/index.html  (Ctrl+C to stop)")
    threading.Event().wait()
