# TechRoute

Technical visit scheduling form (internship deliverable). English UI. Python 3 stdlib + SQLite. No pip packages.

## Run

```bash
python3 init_db.py
python3 server.py
```

Open http://127.0.0.1:8765

`init_db.py` creates `data/techroute.db` and the tables from `sql/schema.sql`. Visit rows stay empty. The resource catalog is seeded so the checklist works.

## What to evaluate

- `index.html` - scheduling form, resource checklist, status, observations, 2-week calendar
- `sql/schema.sql` - `visits`, `resources`, `visit_resources`, `visit_status_events`
- `db.py` / `init_db.py` - database + table creation
- `server.py` - API + static files
  - `GET /api/health`
  - `GET /api/resources`
  - `GET|POST /api/visits` (body includes `resourceIds`)
  - `POST /api/visits/{id}/status` (timestamped; reason required to reschedule or cancel)
  - `POST /api/visits/{id}/observations` (technician post-visit notes)
  - `DELETE /api/visits/{id}`
  - export/import JSON and SQLite

## Layout

```
sql/schema.sql      CREATE TABLE + resource catalog
init_db.py          create empty visits DB
db.py               SQLite access
server.py           HTTP server
index.html          form + dispatch board
css/styles.css
js/app.js
data/techroute.db   generated locally, not in git
```
