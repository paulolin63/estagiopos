#!/usr/bin/env python3
"""Create data/techroute.db and tables. Does not insert visit rows."""

from db import DB_PATH, db_status, init_db


def main():
    init_db().close()
    info = db_status()
    print("Database : %s" % DB_PATH)
    print("Tables   : %s" % ", ".join(info.get("tables") or [info["table"]]))
    print("Visits   : %s" % info["records"])
    print("Catalog  : %s resources" % info.get("resources", 0))


if __name__ == "__main__":
    main()
