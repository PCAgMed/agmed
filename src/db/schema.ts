import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

// Sentinel table from AGM-5 bootstrap — kept for migration continuity.
export const dbReady = pgTable('_db_ready', {
  id: serial('id').primaryKey(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).defaultNow().notNull(),
})

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  password: text('password'),
  emailVerified: timestamp('emailVerified', { withTimezone: true }),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
