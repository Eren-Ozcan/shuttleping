/**
 * Lists the chat ids that have written to the bot, so a passenger's
 * telegram_chat_id can be picked up without hand-rolling a getUpdates call.
 *
 * Usage:
 *   1. The passenger opens the bot in Telegram and sends /start
 *   2. npm run telegram:chat-id
 *
 * getUpdates only returns the last ~24 hours of unconsumed updates, and it
 * conflicts with a running webhook — the bot has none today.
 */
import { config } from 'dotenv'

config()

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN tanımlı değil — .env dosyanı kontrol et')
  process.exit(1)
}

try {
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
    signal: AbortSignal.timeout(10_000),
  })
  const data = await res.json()

  if (!data.ok) {
    console.error(`Telegram hatası: ${data.description || res.status}`)
    process.exit(1)
  }

  const chats = new Map()
  for (const update of data.result) {
    const chat = update.message?.chat || update.edited_message?.chat
    if (chat) {
      chats.set(chat.id, [chat.first_name, chat.last_name, chat.username && `@${chat.username}`]
        .filter(Boolean)
        .join(' '))
    }
  }

  if (chats.size === 0) {
    console.log('Hiç mesaj yok. Bota Telegram\'dan /start yaz, sonra bu komutu tekrar çalıştır.')
    process.exit(0)
  }

  console.log('Chat ID          Kim')
  for (const [id, name] of chats) {
    console.log(`${String(id).padEnd(16)} ${name}`)
  }
  console.log('\n.env dosyasına ekle: TELEGRAM_TEST_CHAT_ID=<yukarıdaki id>')
} catch (err) {
  console.error('getUpdates başarısız:', err.message)
  process.exit(1)
}
