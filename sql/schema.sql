-- TechRoute schema
-- Applied automatically by init_db.py / server.py
-- Visit rows stay empty until a visit is filed.
-- Resource catalog is reference data for the allocation checklist.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS visits (
  id               TEXT    PRIMARY KEY,
  client_name      TEXT    NOT NULL,
  client_phone     TEXT    NOT NULL,
  location         TEXT    NOT NULL,
  visit_date       TEXT    NOT NULL,
  visit_time       TEXT    NOT NULL,
  technician_id    TEXT    NOT NULL,
  technician_name  TEXT    NOT NULL,
  service_type     TEXT    NOT NULL,
  notes            TEXT    NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'scheduled',
  status_changed_at INTEGER,
  status_reason    TEXT    NOT NULL DEFAULT '',
  tech_observations TEXT   NOT NULL DEFAULT '',
  tech_observations_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_visits_schedule
  ON visits (visit_date, visit_time);

CREATE TABLE IF NOT EXISTS resources (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  category   TEXT    NOT NULL CHECK (category IN ('materials', 'tools', 'equipment')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS visit_resources (
  visit_id    TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  PRIMARY KEY (visit_id, resource_id),
  FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES resources(id)
);

CREATE INDEX IF NOT EXISTS idx_visit_resources_visit
  ON visit_resources (visit_id);

CREATE TABLE IF NOT EXISTS visit_status_events (
  id          TEXT    PRIMARY KEY,
  visit_id    TEXT    NOT NULL,
  status      TEXT    NOT NULL,
  reason      TEXT    NOT NULL DEFAULT '',
  visit_date  TEXT,
  visit_time  TEXT,
  changed_at  INTEGER NOT NULL,
  FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_status_events_visit
  ON visit_status_events (visit_id, changed_at);

INSERT OR IGNORE INTO resources (id, name, category, sort_order) VALUES
  ('mat-cable-ties',     'Cable ties',              'materials', 1),
  ('mat-electrical-tape','Electrical tape',         'materials', 2),
  ('mat-sealant',        'Silicone sealant',        'materials', 3),
  ('mat-filters',        'Replacement filters',     'materials', 4),
  ('mat-fasteners',      'Fasteners kit',           'materials', 5),
  ('mat-wire-nuts',      'Wire nuts',               'materials', 6),
  ('tool-multimeter',    'Multimeter',              'tools', 1),
  ('tool-screwdrivers',  'Insulated screwdriver set','tools', 2),
  ('tool-wrench',        'Adjustable wrench',       'tools', 3),
  ('tool-torque',        'Torque wrench',           'tools', 4),
  ('tool-stripper',      'Wire stripper',           'tools', 5),
  ('tool-mirror',        'Inspection mirror',       'tools', 6),
  ('eq-tablet',          'Diagnostic tablet',       'equipment', 1),
  ('eq-thermal',         'Thermal camera',          'equipment', 2),
  ('eq-ppe',             'PPE kit',                 'equipment', 3),
  ('eq-ladder',          'Ladder',                  'equipment', 4),
  ('eq-vacuum',          'Vacuum pump',             'equipment', 5),
  ('eq-generator',       'Portable generator',      'equipment', 6);
