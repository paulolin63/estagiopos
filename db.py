#!/usr/bin/env python3
"""SQLite access for TechRoute. Creates DB, tables, and the resource catalog."""

import sqlite3
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "techroute.db"
SCHEMA_PATH = ROOT / "sql" / "schema.sql"

INSERT_SQL = """
INSERT OR REPLACE INTO visits (
  id, client_name, client_phone, location, visit_date, visit_time,
  technician_id, technician_name, service_type, notes, created_at,
  status, status_changed_at, status_reason,
  tech_observations, tech_observations_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""

STATUSES = (
    "scheduled",
    "in_progress",
    "completed",
    "rescheduled",
    "cancelled",
)
NEEDS_REASON = ("rescheduled", "cancelled")


def migrate_schema(conn):
    cols = {row[1] for row in conn.execute("PRAGMA table_info(visits)")}
    if "status" not in cols:
        conn.execute(
            "ALTER TABLE visits ADD COLUMN status TEXT NOT NULL DEFAULT 'scheduled'"
        )
    if "status_changed_at" not in cols:
        conn.execute("ALTER TABLE visits ADD COLUMN status_changed_at INTEGER")
    if "status_reason" not in cols:
        conn.execute(
            "ALTER TABLE visits ADD COLUMN status_reason TEXT NOT NULL DEFAULT ''"
        )
    if "tech_observations" not in cols:
        conn.execute(
            "ALTER TABLE visits ADD COLUMN tech_observations TEXT NOT NULL DEFAULT ''"
        )
    if "tech_observations_at" not in cols:
        conn.execute(
            "ALTER TABLE visits ADD COLUMN tech_observations_at INTEGER"
        )
    conn.execute(
        "UPDATE visits SET status_changed_at = created_at "
        "WHERE status_changed_at IS NULL"
    )
    conn.commit()


def init_db(path=None):
    """Create the database file and tables if they do not exist."""
    db_path = Path(path) if path else DB_PATH
    DATA_DIR.mkdir(exist_ok=True)
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(schema)
    migrate_schema(conn)
    return conn


def connect(path=None):
    return init_db(path)


def db_status():
    conn = connect()
    try:
        count = conn.execute("SELECT COUNT(*) AS n FROM visits").fetchone()["n"]
        catalog = conn.execute("SELECT COUNT(*) AS n FROM resources").fetchone()["n"]
        tables = [
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        return {
            "status": "ok",
            "database": str(DB_PATH.relative_to(ROOT)),
            "table": "visits",
            "tables": tables,
            "records": count,
            "resources": catalog,
        }
    finally:
        conn.close()


def row_to_visit(row):
    keys = row.keys()
    created = row["created_at"]
    changed = row["status_changed_at"] if "status_changed_at" in keys else created
    return {
        "id": row["id"],
        "clientName": row["client_name"],
        "clientPhone": row["client_phone"],
        "location": row["location"],
        "date": row["visit_date"],
        "time": row["visit_time"],
        "technicianId": row["technician_id"],
        "technicianName": row["technician_name"],
        "serviceType": row["service_type"],
        "notes": row["notes"],
        "createdAt": created,
        "status": row["status"] if "status" in keys else "scheduled",
        "statusChangedAt": changed or created,
        "statusReason": row["status_reason"] if "status_reason" in keys else "",
        "techObservations": row["tech_observations"]
        if "tech_observations" in keys
        else "",
        "techObservationsAt": row["tech_observations_at"]
        if "tech_observations_at" in keys
        else None,
        "resourceIds": [],
        "resources": [],
        "statusEvents": [],
    }


def visit_to_params(visit):
    vid = visit.get("id") or str(uuid.uuid4())
    created = visit.get("createdAt")
    if created is None:
        created = int(time.time() * 1000)
    notes = visit.get("notes") or ""
    status = visit.get("status") or "scheduled"
    if status not in STATUSES:
        raise ValueError("Unknown status.")
    changed = visit.get("statusChangedAt")
    if changed is None:
        changed = created
    reason = visit.get("statusReason") or ""
    observations = visit.get("techObservations") or ""
    obs_at = visit.get("techObservationsAt")
    required = (
        visit.get("clientName"),
        visit.get("clientPhone"),
        visit.get("location"),
        visit.get("date"),
        visit.get("time"),
        visit.get("technicianId"),
        visit.get("technicianName"),
        visit.get("serviceType"),
    )
    if not all(required):
        raise ValueError("Visit is missing required fields.")
    return (
        vid,
        visit["clientName"],
        visit["clientPhone"],
        visit["location"],
        visit["date"],
        visit["time"],
        visit["technicianId"],
        visit["technicianName"],
        visit["serviceType"],
        notes,
        int(created),
        status,
        int(changed),
        reason,
        observations,
        int(obs_at) if obs_at is not None else None,
    )


def resource_ids_of(visit):
    if visit.get("resourceIds"):
        return list(visit["resourceIds"])
    items = visit.get("resources") or []
    ids = []
    for item in items:
        if isinstance(item, dict):
            ids.append(item.get("id"))
        else:
            ids.append(item)
    return [rid for rid in ids if rid]


def category_order_sql(col):
    return (
        "CASE %s WHEN 'materials' THEN 1 WHEN 'tools' THEN 2 "
        "WHEN 'equipment' THEN 3 ELSE 4 END" % col
    )


def list_resources():
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT id, name, category FROM resources "
            "ORDER BY " + category_order_sql("category") + ", sort_order, name"
        ).fetchall()
        return [
            {"id": row["id"], "name": row["name"], "category": row["category"]}
            for row in rows
        ]
    finally:
        conn.close()


def resources_for_visits(conn, visit_ids):
    by_visit = {vid: [] for vid in visit_ids}
    if not visit_ids:
        return by_visit
    placeholders = ",".join("?" * len(visit_ids))
    rows = conn.execute(
        "SELECT vr.visit_id, r.id, r.name, r.category "
        "FROM visit_resources vr "
        "JOIN resources r ON r.id = vr.resource_id "
        "WHERE vr.visit_id IN (%s) "
        "ORDER BY %s, r.sort_order, r.name"
        % (placeholders, category_order_sql("r.category")),
        visit_ids,
    ).fetchall()
    for row in rows:
        by_visit[row["visit_id"]].append(
            {"id": row["id"], "name": row["name"], "category": row["category"]}
        )
    return by_visit


def attach_resources(conn, visits):
    packed = resources_for_visits(conn, [v["id"] for v in visits])
    for visit in visits:
        items = packed.get(visit["id"]) or []
        visit["resources"] = items
        visit["resourceIds"] = [item["id"] for item in items]
    return attach_status_events(conn, visits)


def events_for_visits(conn, visit_ids):
    by_visit = {vid: [] for vid in visit_ids}
    names = {
        row["name"]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    if "visit_status_events" not in names or not visit_ids:
        return by_visit
    placeholders = ",".join("?" * len(visit_ids))
    rows = conn.execute(
        "SELECT id, visit_id, status, reason, visit_date, visit_time, changed_at "
        "FROM visit_status_events WHERE visit_id IN (%s) "
        "ORDER BY changed_at ASC" % placeholders,
        visit_ids,
    ).fetchall()
    for row in rows:
        by_visit[row["visit_id"]].append(
            {
                "id": row["id"],
                "status": row["status"],
                "reason": row["reason"],
                "date": row["visit_date"],
                "time": row["visit_time"],
                "changedAt": row["changed_at"],
            }
        )
    return by_visit


def attach_status_events(conn, visits):
    packed = events_for_visits(conn, [v["id"] for v in visits])
    for visit in visits:
        visit["statusEvents"] = packed.get(visit["id"]) or []
    return visits


def write_status_events(conn, visit_id, events):
    conn.execute("DELETE FROM visit_status_events WHERE visit_id = ?", (visit_id,))
    for event in events or []:
        conn.execute(
            "INSERT INTO visit_status_events ("
            "id, visit_id, status, reason, visit_date, visit_time, changed_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                event.get("id") or str(uuid.uuid4()),
                visit_id,
                event.get("status") or "scheduled",
                event.get("reason") or "",
                event.get("date"),
                event.get("time"),
                int(event.get("changedAt") or time.time() * 1000),
            ),
        )


def seed_scheduled_event(conn, visit_id, created_at, date, time_value):
    conn.execute(
        "INSERT INTO visit_status_events ("
        "id, visit_id, status, reason, visit_date, visit_time, changed_at"
        ") VALUES (?, ?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), visit_id, "scheduled", "", date, time_value, int(created_at)),
    )


def set_visit_resources(conn, visit_id, resource_ids):
    seen = []
    for rid in resource_ids or []:
        if rid and rid not in seen:
            seen.append(rid)
    if seen:
        placeholders = ",".join("?" * len(seen))
        found = {
            row["id"]
            for row in conn.execute(
                "SELECT id FROM resources WHERE id IN (%s)" % placeholders, seen
            )
        }
        missing = [rid for rid in seen if rid not in found]
        if missing:
            raise ValueError("Unknown resource: %s" % missing[0])
    conn.execute("DELETE FROM visit_resources WHERE visit_id = ?", (visit_id,))
    conn.executemany(
        "INSERT INTO visit_resources (visit_id, resource_id) VALUES (?, ?)",
        [(visit_id, rid) for rid in seen],
    )


def get_visit(conn, visit_id):
    row = conn.execute("SELECT * FROM visits WHERE id = ?", (visit_id,)).fetchone()
    if not row:
        return None
    visits = attach_resources(conn, [row_to_visit(row)])
    return visits[0]


def list_visits():
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT * FROM visits ORDER BY visit_date, visit_time, created_at"
        ).fetchall()
        return attach_resources(conn, [row_to_visit(r) for r in rows])
    finally:
        conn.close()


def upsert_visit(visit):
    params = visit_to_params(visit)
    conn = connect()
    try:
        conn.execute(INSERT_SQL, params)
        set_visit_resources(conn, params[0], resource_ids_of(visit))
        events = visit.get("statusEvents")
        if events:
            write_status_events(conn, params[0], events)
        else:
            seed_scheduled_event(
                conn, params[0], params[10], params[4], params[5]
            )
        conn.commit()
        return get_visit(conn, params[0])
    finally:
        conn.close()


def delete_visit(vid):
    conn = connect()
    try:
        cur = conn.execute("DELETE FROM visits WHERE id = ?", (vid,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def import_visits(visits):
    imported = 0
    errors = 0
    conn = connect()
    try:
        for visit in visits:
            try:
                params = visit_to_params(visit)
                conn.execute(INSERT_SQL, params)
                set_visit_resources(conn, params[0], resource_ids_of(visit))
                events = visit.get("statusEvents")
                if events:
                    write_status_events(conn, params[0], events)
                else:
                    seed_scheduled_event(
                        conn, params[0], params[10], params[4], params[5]
                    )
                imported += 1
            except (ValueError, KeyError, TypeError):
                errors += 1
        conn.commit()
    finally:
        conn.close()
    return {"imported": imported, "errors": errors, "visits": list_visits()}


def update_status(visit_id, payload):
    status = (payload.get("status") or "").strip()
    if status not in STATUSES:
        raise ValueError("Unknown status.")
    reason = (payload.get("reason") or "").strip()
    if status in NEEDS_REASON and len(reason) < 3:
        raise ValueError("Add a reason to reschedule or cancel.")
    now = int(time.time() * 1000)
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM visits WHERE id = ?", (visit_id,)).fetchone()
        if not row:
            return None
        date = row["visit_date"]
        time_value = row["visit_time"]
        if status == "rescheduled":
            date = (payload.get("date") or "").strip()
            time_value = (payload.get("time") or "").strip()
            if not date or not time_value:
                raise ValueError("Pick a new date and time to reschedule.")
        conn.execute(
            "UPDATE visits SET status = ?, status_changed_at = ?, status_reason = ?, "
            "visit_date = ?, visit_time = ? WHERE id = ?",
            (status, now, reason, date, time_value, visit_id),
        )
        conn.execute(
            "INSERT INTO visit_status_events ("
            "id, visit_id, status, reason, visit_date, visit_time, changed_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), visit_id, status, reason, date, time_value, now),
        )
        conn.commit()
        return get_visit(conn, visit_id)
    finally:
        conn.close()


def save_observations(visit_id, payload):
    text = payload.get("observations")
    if text is None:
        text = payload.get("techObservations") or ""
    if not isinstance(text, str):
        raise ValueError("Observations must be text.")
    text = text.strip()
    if len(text) > 2000:
        raise ValueError("Observations must be 2000 characters or fewer.")
    stamp = int(time.time() * 1000) if text else None
    conn = connect()
    try:
        row = conn.execute("SELECT id FROM visits WHERE id = ?", (visit_id,)).fetchone()
        if not row:
            return None
        conn.execute(
            "UPDATE visits SET tech_observations = ?, tech_observations_at = ? "
            "WHERE id = ?",
            (text, stamp, visit_id),
        )
        conn.commit()
        return get_visit(conn, visit_id)
    finally:
        conn.close()
