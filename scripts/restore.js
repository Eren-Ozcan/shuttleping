/**
 * Bir pg_dump yedeğini geri yükler.
 *
 *   node scripts/restore.js backups/shuttleping-20260827-120000.dump
 *   node scripts/restore.js <dump> --url postgres://.../hedef_db
 *
 * "Denenmemiş yedek yedek değildir" (docs/PILOT-READINESS.md). Yedek alma
 * betiği vardı ama geri yükleme yolu hiç yazılmamış ve hiç denenmemişti.
 *
 * Güvenlik: hedef veritabanı --url ile açıkça verilmediyse .env'deki
 * DATABASE_URL kullanılır ve üzerine yazmadan önce onay istenir. Üretim
 * veritabanına yanlışlıkla geri yükleme yapmak, yedeğin kendisinden daha
 * büyük bir kayıp olabilir.
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

// --clean --if-exists: mevcut nesneleri düşürüp yeniden kurar, böylece
// kısmen dolu bir veritabanına da yüklenebilir
const restoreArgs = ['--clean', '--if-exists', '--no-owner', '--no-privileges']
const hasLocalPgRestore =
  spawnSync('pg_restore', ['--version'], { shell: false }).status === 0

try {
  if (hasLocalPgRestore) {
    execFileSync('pg_restore', [...restoreArgs, '-d', targetUrl, dumpFile], {
      stdio: 'inherit',
    })
  } else {
    // Yerel pg_restore yok — dev ortamındaki docker container'ı üzerinden yükle
    const container = process.env.PG_CONTAINER ?? 'servistakip-postgres-1'
    execFileSync(
      'docker',
      ['exec', '-i', container, 'pg_restore', ...restoreArgs, '-U', 'postgres', '-d', dbName],
      { input: readFileSync(dumpFile), maxBuffer: 1024 * 1024 * 512, stdio: ['pipe', 'inherit', 'inherit'] },
    )
  }
  console.log(`\nGeri yükleme tamamlandı: ${dumpFile} → ${dbName}`)
} catch (err) {
  // pg_restore --clean ilk yüklemede "does not exist" uyarıları verir ve
  // sıfırdan çıkar; gerçek hatayı ayırt etmek için mesajı göster
  console.error('Geri yükleme hata verdi:', err.message)
  console.error('Not: boş bir veritabanına yüklerken "does not exist" uyarıları normaldir.')
  process.exit(1)
}
