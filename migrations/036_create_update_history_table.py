"""Peewee migrations -- 036_create_update_history_table.py."""

import peewee as pw

SQL = pw.SQL


def migrate(migrator, database, fake=False, **kwargs):
    migrator.sql(
        """
        CREATE TABLE IF NOT EXISTS "updatehistory" (
            "id"         INTEGER NOT NULL PRIMARY KEY,
            "version"    VARCHAR(50) NOT NULL,
            "applied_at" DATETIME NOT NULL,
            "status"     VARCHAR(20) NOT NULL,
            "image_id"   VARCHAR(100),
            "notes"      TEXT
        )
        """
    )


def rollback(migrator, database, fake=False, **kwargs):
    migrator.sql('DROP TABLE IF EXISTS "updatehistory"')
