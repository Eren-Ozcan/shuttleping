/**
 * Vitest global setup — runs before every test file is loaded.
 *
 * Tests write to a separate test database, NOT the development one. It is read
 * from `.env.test` if present, otherwise derived by appending `_test` to
 * DATABASE_URL. This way a cleanup bug cannot pollute dev data.
 *
 * This file must run BEFORE src/config/env.js; vitest setupFiles guarantees
 * that (the env module reads process.env on first import).
 */
import { config } from 'dotenv'

config({ path: '.env.test', override: true })

if (!process.env.DATABASE_URL) {
  config() // .env
}

// Without .env.test, derive the test database name from the dev URL
if (!process.env.DATABASE_URL?.includes('_test')) {
  const url = new URL(process.env.DATABASE_URL)
  url.pathname = `${url.pathname.replace(/\/$/, '')}_test`
  process.env.DATABASE_URL = url.toString()
}

// No real service must be reachable in tests: live credentials from .env are
// cleared. Channel tests set the value they need on the env object themselves
// and stub fetch, so this does not affect them.
// (NOTIFICATION_DRY_RUN is not forced here — it would change dispatcher
// behavior and prevent the real error paths from being tested.)
for (const key of [
  'TELEGRAM_BOT_TOKEN',
  'NETGSM_USERCODE',
  'NETGSM_PASSWORD',
  'NETGSM_MSGHEADER',
  'GOOGLE_MAPS_API_KEY',
  'NOTIFICATION_TEST_CHAT_ID',
]) {
  delete process.env[key]
}
process.env.NOTIFICATION_DRY_RUN = 'false'
