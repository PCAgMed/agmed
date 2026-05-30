CREATE TABLE IF NOT EXISTS "_db_ready" (
	"id" serial PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
