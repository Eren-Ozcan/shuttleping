/**
 * Restores a pg_dump backup.
 *
 *   node scripts/restore.js backups/shuttleping-20260827-120000.dump
 *   node scripts/restore.js <dump> --url postgres://.../target_db
 *
 * "An untested backup is not a backup" (docs/PILOT-READINESS.md). The backup
 * script existed but a restore path was never written and never tested.
 *
 * Safety: if the target database is not given explicitly with --url, the
 * DATABASE_URL from .env is used and confirmation is required before
 * overwriting it. Accidentally restoring over the production database can be a
 * bigger loss than the backup itself.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { config } from 'dotenv'

config()

const args = process.argv.slice(2)
const dumpFile = args.find((a) => !a.startsWith('--'))
const urlFlag = args.indexOf('--url')
const force = args.includes('--force')
const targetUrl = urlFlag !== -1 ? args[urlFlag + 1] : process.env.DATABASE_URL

if (!dumpFile) {
  console.error('Kullanım: node scripts/restore.js <dump-dosyasi> [--url <db-url>] [--force]')
  process.exit(1)
}
if (!existsSync(dumpFile)) {
  console.error(`Dump dosyası bulunamadı: ${dumpFile}`)
  process.exit(1)
}
if (!targetUrl) {
  console.error('Hedef veritabanı yok — DATABASE_URL tanımlı değil ve --url verilmedi')
  process.exit(1)
}

const dbName = new URL(targetUrl).pathname.slice(1)

if (!force) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(
    `\n"${dbName}" veritabanındaki MEVCUT VERİ SİLİNECEK ve ${dumpFile} yüklenecek.\n` +
      `Devam etmek için veritabanı adını yaz (${dbName}): `,
  )
  rl.close()
  if (answer.trim() !== dbName) {
    console.error('İptal edildi.')
    process.exit(1)
  }
}

// --clean --if-exists: drops and recreates existing objects, so it can also be
// loaded into a partially populated database
const restoreArgs = ['--clean', '--if-exists', '--no-owner', '--no-privileges']
const hasLocalPgRestore =
  spawnSync('pg_restore', ['--version'], { shell: false }).status === 0

try {
  if (hasLocalPgRestore) {
    execFileSync('pg_restore', [...restoreArgs, '-d', targetUrl, dumpFile], {
      stdio: 'inherit',
    })
  } else {
    // No local pg_restore — load it through the docker container in the dev environment
    const container = process.env.PG_CONTAINER ?? 'servistakip-postgres-1'
    execFileSync(
      'docker',
      ['exec', '-i', container, 'pg_restore', ...restoreArgs, '-U', 'postgres', '-d', dbName],
      { input: readFileSync(dumpFile), maxBuffer: 1024 * 1024 * 512, stdio: ['pipe', 'inherit', 'inherit'] },
    )
  }
  console.log(`\nGeri yükleme tamamlandı: ${dumpFile} → ${dbName}`)
} catch (err) {
  // pg_restore --clean prints "does not exist" warnings on a first load and
  // exits non-zero; show the message so a real error can be told apart
  console.error('Geri yükleme hata verdi:', err.message)
  console.error('Not: boş bir veritabanına yüklerken "does not exist" uyarıları normaldir.')
  process.exit(1)
}
