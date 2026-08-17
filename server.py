#!/usr/bin/env python3
"""TechRoute HTTP server. Creates the SQLite database on first run.

    python3 init_db.py
    python3 server.py
    # open http://127.0.0.1:8765
"""

import json
import os
import re
import sqlite3
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from db import (
    DB_PATH,
    ROOT,
    attach_resources,
    connect,
    db_status,
    delete_visit,
    import_visits,
    init_db,
    list_resources,
    list_visits,
    resource_ids_of,
    row_to_visit,
    update_status,
    upsert_visit,
    save_observations,
)

PORT = int(os.environ.get("PORT", "8765"))
HOST = os.environ.get("HOST", "0.0.0.0")
VISIT_PATH = re.compile(r"^/api/visits/([0-9a-fA-F-]{8,36})$")
STATUS_PATH = re.compile(r"^/api/visits/([0-9a-fA-F-]{8,36})/status$")
OBS_PATH = re.compile(r"^/api/visits/([0-9a-fA-F-]{8,36})/observations$")


def import_sqlite_bytes(blob):
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
    try:
        tmp.write(blob)
        tmp.close()
        src = connect(tmp.name)
        try:
            names = {
                row["name"]
                for row in src.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            if "visits" not in names:
                raise ValueError("SQLite file has no visits table.")
            visits = [row_to_visit(r) for r in src.execute("SELECT * FROM visits")]
            if "visit_resources" in names and "resources" in names:
                attach_resources(src, visits)
            else:
                for visit in visits:
                    visit["resourceIds"] = resource_ids_of(visit)
        finally:
            src.close()
        return import_visits(visits)
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def export_sqlite_bytes():
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
    tmp.close()
    try:
        src = connect()
        dst = sqlite3.connect(tmp.name)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        with open(tmp.name, "rb") as fh:
            return fh.read()
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            return self._json(200, db_status())
        if path == "/api/resources":
            return self._json(200, list_resources())
        if path == "/api/visits":
            return self._json(200, list_visits())
        if path == "/api/export.json":
            body = json.dumps({"visits": list_visits()}, indent=2).encode("utf-8")
            return self._bytes(
                200, body, "application/json; charset=utf-8", "techroute-visits.json"
            )
        if path in ("/api/export.sqlite", "/api/export.db"):
            return self._bytes(
                200,
                export_sqlite_bytes(),
                "application/vnd.sqlite3",
                "techroute.sqlite",
            )
        if path.startswith("/api/"):
            return self._json(404, {"error": "Not found"})
        return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        raw = self._read()
        try:
            if path == "/api/visits":
                visit = json.loads(raw.decode("utf-8") or "{}")
                saved = upsert_visit(visit)
                return self._json(201, saved)
            match = STATUS_PATH.match(path)
            if match:
                payload = json.loads(raw.decode("utf-8") or "{}")
                saved = update_status(match.group(1), payload)
                if not saved:
                    return self._json(404, {"error": "Visit not found"})
                return self._json(200, saved)
            match = OBS_PATH.match(path)
            if match:
                payload = json.loads(raw.decode("utf-8") or "{}")
                saved = save_observations(match.group(1), payload)
                if not saved:
                    return self._json(404, {"error": "Visit not found"})
                return self._json(200, saved)
            if path == "/api/import":
                ctype = (self.headers.get("Content-Type") or "").lower()
                if "json" in ctype or raw[:1] in (b"{", b"["):
                    payload = json.loads(raw.decode("utf-8") or "{}")
                    visits = (
                        payload if isinstance(payload, list) else payload.get("visits") or []
                    )
                    if not isinstance(visits, list):
                        raise ValueError("JSON must be an array or {visits: [...]}.")
                    return self._json(200, import_visits(visits))
                return self._json(200, import_sqlite_bytes(raw))
        except ValueError as exc:
            return self._json(400, {"error": str(exc)})
        except (json.JSONDecodeError, KeyError, TypeError):
            return self._json(400, {"error": "Invalid payload."})
        return self._json(404, {"error": "Not found"})

    def do_DELETE(self):
        path = self.path.split("?", 1)[0]
        match = VISIT_PATH.match(path)
        if not match:
            return self._json(404, {"error": "Not found"})
        if not delete_visit(match.group(1)):
            return self._json(404, {"error": "Visit not found"})
        return self._json(200, {"ok": True})

    def _read(self):
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, status, body, content_type, filename):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header(
            "Content-Disposition", 'attachment; filename="%s"' % filename
        )
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    init_db().close()
    info = db_status()
    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print("Database : %s" % DB_PATH)
    print("Tables   : %s" % ", ".join(info.get("tables") or [info["table"]]))
    print("Visits   : %s" % info["records"])
    print("Catalog  : %s resources" % info.get("resources", 0))
    print("Open     : http://%s:%s" % (HOST, PORT))
    httpd.serve_forever()


if __name__ == "__main__":
    main()
