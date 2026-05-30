/**
 * Rolls back the last applied Drizzle migration by running its paired .down.sql file.
 *
 * Drizzle tracks applied migrations in drizzle.__drizzle_migrations.
 * The journal maps `when` (epoch ms) to the migration `tag`.
 * This script matches the latest DB entry to its tag, runs the .down.sql, then
 * removes the journal entry so `db:migrate` will re-apply it.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = path.join(process.cwd(), "src/db/migrations");

async function rollback() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url);

  try {
    const rows = await sql<{ hash: string; created_at: bigint }[]>`
      SELECT hash, created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      console.log("Nothing to roll back — no migrations have been applied.");
      return;
    }

    const { hash, created_at } = rows[0];
    const appliedAt = Number(created_at);

    const journalPath = path.join(MIGRATIONS_DIR, "meta", "_journal.json");
    const journal: {
      entries: { idx: number; when: number; tag: string }[];
    } = JSON.parse(fs.readFileSync(journalPath, "utf8"));

    // Match by `when` timestamp — same epoch ms stored in both the journal and the DB.
    const entry = journal.entries.find((e) => e.when === appliedAt);
    if (!entry) {
      throw new Error(
        `Cannot find journal entry for migration applied at ${appliedAt} (hash: ${hash.slice(0, 12)}…). ` +
          `Is the journal in sync with the database?`,
      );
    }

    const downFile = path.join(MIGRATIONS_DIR, `${entry.tag}.down.sql`);
    if (!fs.existsSync(downFile)) {
      throw new Error(
        `Down migration not found: ${downFile}\n` +
          `Add a ${entry.tag}.down.sql file next to the up migration to enable rollback.`,
      );
    }

    const downSql = fs.readFileSync(downFile, "utf8");
    console.log(`Rolling back: ${entry.tag}`);
    await sql.unsafe(downSql);

    await sql`
      DELETE FROM drizzle.__drizzle_migrations
      WHERE hash = ${hash}
    `;

    console.log(`✓ Rolled back: ${entry.tag}`);
  } finally {
    await sql.end();
  }
}

rollback().catch((err) => {
  console.error(err);
  process.exit(1);
});
