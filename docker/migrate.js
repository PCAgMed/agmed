'use strict'
// Runs Drizzle migrations using the runtime node_modules present in the standalone image.
const path = require('path')
const { drizzle } = require('drizzle-orm/postgres-js')
const { migrate } = require('drizzle-orm/postgres-js/migrator')
const postgres = require('postgres')

async function run() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  const client = postgres(url, { max: 1 })
  const db = drizzle(client)

  const migrationsFolder = path.join(__dirname, '..', 'src', 'db', 'migrations')
  await migrate(db, { migrationsFolder })

  await client.end()
  console.log('[migrate] all migrations applied')
}

run().catch((err) => {
  console.error('[migrate] FAILED:', err)
  process.exit(1)
})
