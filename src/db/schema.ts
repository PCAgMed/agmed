import { pgTable, serial, timestamp } from "drizzle-orm/pg-core";

// Sentinel table — proves the migration chain runs end-to-end.
// Will be removed or replaced once real domain tables land.
export const dbReady = pgTable("_db_ready", {
  id: serial("id").primaryKey(),
  checkedAt: timestamp("checked_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
