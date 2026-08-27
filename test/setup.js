/**
 * Vitest global setup — her test dosyası yüklenmeden önce çalışır.
 *
 * Testler geliştirme veritabanına DEĞİL, ayrı bir test veritabanına yazar.
 * `.env.test` varsa oradan, yoksa DATABASE_URL'in sonuna `_test` eklenerek
 * türetilir. Böylece bir temizlik hatası dev verisini kirletmez.
 *
 * Bu dosya src/config/env.js'ten ÖNCE çalışmalı; vitest setupFiles bunu
 * garanti eder (env modülü ilk import'ta process.env'i okur).
 */
import { config } from 'dotenv'

config({ path: '.env.test', override: true })

if (!process.env.DATABASE_URL) {
  config() // .env
}

// .env.test yoksa dev URL'inden test veritabanı adını türet
if (!process.env.DATABASE_URL?.includes('_test')) {
  const url = new URL(process.env.DATABASE_URL)
  url.pathname = `${url.pathname.replace(/\/$/, '')}_test`
  process.env.DATABASE_URL = url.toString()
}

// Testlerde hiçbir gerçek servise ulaşılamasın: .env'deki canlı kimlik
// bilgileri temizlenir. Kanal testleri gereken değeri kendi içinde env
// nesnesine atayıp fetch'i stub'lar, dolayısıyla bu onları etkilemez.
// (NOTIFICATION_DRY_RUN burada zorlanmaz — dispatcher davranışını değiştirip
// gerçek hata yollarının sınanmasını engellerdi.)
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
