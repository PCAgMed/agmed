-- Auth schema for Auth.js v5 (credentials + JWT sessions)
-- Run this once against the Postgres database before starting the app.
-- Migrations workflow will be formalized in AGM-5.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT        PRIMARY KEY,
  name        TEXT,
  email       TEXT        UNIQUE NOT NULL,
  password    TEXT,                         -- bcrypt hash; NULL for OAuth users added later
  "emailVerified" TIMESTAMPTZ,
  image       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
