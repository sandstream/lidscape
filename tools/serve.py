# Development server: like `python3 -m http.server`, but tells the browser not to
# cache, so an edited module is used on the next reload.
#   python3 tools/serve.py [port]
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    # The page loads many modules at once; the default backlog of 5 resets some.
    request_queue_size = 64


print(f"Lidscape on http://localhost:{PORT}")
Server(("127.0.0.1", PORT), functools.partial(NoCache, directory=ROOT)).serve_forever()
