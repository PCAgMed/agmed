import 'dotenv/config'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import path from 'node:path'

async function runMigrations() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  const client = postgres(url, { max: 1 })
  const db = drizzle(client)

  const migrationsFolder = path.join(process.cwd(), 'src/db/migrations')
  await migrate(db, { migrationsFolder })

  await client.end()
  console.log('Migrations complete')
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
