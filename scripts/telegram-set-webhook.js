/**
 * One-time setup: tells Telegram where to POST updates (T2.3).
 *
 * Run once after the app has a public HTTPS URL (Railway domain or a
 * cloudflared tunnel). Telegram will echo TELEGRAM_WEBHOOK_SECRET back on
 * every call as X-Telegram-Bot-Api-Secret-Token — that's what the webhook
 * route checks.
 *
 * Usage:
 *   node scripts/telegram-set-webhook.js https://<domain>
 *   node scripts/telegram-set-webhook.js --delete   (switch back to getUpdates)
 */
import { config } from 'dotenv'

config()

const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN tanımlı değil')
  process.exit(1)
}

const arg = process.argv[2]

if (arg === '--delete') {
  const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`)
  const data = await res.json()
  console.log(data.ok ? 'Webhook kaldırıldı.' : `Hata: ${data.description}`)
  process.exit(data.ok ? 0 : 1)
}

if (!arg || !arg.startsWith('https://')) {
  console.error('Kullanım: node scripts/telegram-set-webhook.js https://<domain>')
  process.exit(1)
}

if (!secret) {
  console.warn(
    'Uyarı: TELEGRAM_WEBHOOK_SECRET boş — webhook doğrulamasız çalışacak. ' +
      'Prod\'da bunu ayarlamadan devam etmeyin.',
  )
}

const url = `${arg.replace(/\/$/, '')}/api/v1/telegram/webhook`
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url, secret_token: secret || undefined }),
})
const data = await res.json()
if (!data.ok) {
  console.error(`Hata: ${data.description}`)
  process.exit(1)
}
console.log(`Webhook ayarlandı: ${url}`)

const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`).then((r) =>
  r.json(),
)
console.log(info.result)
