/**
 * PostgreSQL yedeği alır: backups/shuttleping-YYYYMMDD-HHmmss.dump
 * (pg_dump custom format — pg_restore ile geri yüklenir)
 *
 * Kullanım: npm run backup
 * pg_dump PATH'te yoksa (Windows'ta yaygın) docker container'ı üzerinden
 * almayı dener.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { config } from 'dotenv'

config()

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL tanımlı değil — .env dosyanı kontrol et')
  process.exit(1)
}

const stamp = new Date()
  .toISOString()
  .replace(/[-:T]/g, '')
  .slice(0, 14)
  .replace(/^(\d{8})/, '$1-')
const outFile = `backups/shuttleping-${stamp}.dump`

mkdirSync('backups', { recursive: true })

const hasLocalPgDump =
  spawnSync('pg_dump', ['--version'], { shell: false }).status === 0

try {
  if (hasLocalPgDump) {
    execFileSync('pg_dump', ['-Fc', '-d', databaseUrl, '-f', outFile], {
      stdio: 'inherit',
    })
  } else {
    // Yerel pg_dump yok — dev ortamındaki docker container'ından al
    const dbName = new URL(databaseUrl).pathname.slice(1)
    const dump = execFileSync(
      'docker',
      ['exec', 'servistakip-postgres-1', 'pg_dump', '-Fc', '-U', 'postgres', dbName],
      { maxBuffer: 1024 * 1024 * 512 },
    )
    writeFileSync(outFile, dump)
  }
  console.log(`Yedek alındı: ${outFile}`)
} catch (err) {
  console.error('Yedekleme başarısız:', err.message)
  process.exit(1)
}
