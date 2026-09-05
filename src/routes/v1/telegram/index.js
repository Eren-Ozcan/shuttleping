import { webhookSchema } from './schema.js'
import { env } from '../../../config/env.js'
import { sendRaw } from '../../../services/notifications/telegram.js'
import { logger } from '../../../utils/logger.js'

/**
 * T2.3 — Telegram /start webhook.
 *
 * Before this, a passenger's telegram_chat_id was picked up by hand:
 * passenger sends /start, admin runs `npm run telegram:chat-id`, copies the
 * chat id into the panel. Now the admin instead shares the passenger's
 * invite code (panel/SMS); the passenger sends "/start <code>" to the bot
 * and this webhook links telegram_chat_id itself.
 *
 * Not company-scoped and not behind fastify.authenticate — Telegram calls
 * this directly, it carries no session. The webhook secret is the only guard
 * (see scripts/telegram-set-webhook.js).
 */
export default async function telegramRoutes(fastify) {
  fastify.post('/webhook', { schema: webhookSchema }, async (request, reply) => {
    if (env.TELEGRAM_WEBHOOK_SECRET) {
      const provided = request.headers['x-telegram-bot-api-secret-token']
      if (provided !== env.TELEGRAM_WEBHOOK_SECRET) {
        return reply.unauthorized()
      }
    } else {
      logger.warn('TELEGRAM_WEBHOOK_SECRET is not set — webhook accepts unverified requests')
    }

    // Telegram expects 200 quickly regardless of outcome, or it retries the
    // same update — every branch below returns { ok: true } and does its
    // messaging as a side effect
    const chatId = request.body?.message?.chat?.id
    const text = request.body?.message?.text?.trim()
    if (!chatId || !text?.startsWith('/start')) {
      return { ok: true }
    }

    const code = text.slice('/start'.length).trim().toUpperCase()
    if (!code) {
      await sendRaw(
        chatId,
        'Merhaba! Bildirim almak için şirketinizin size verdiği davet kodunu ' +
          '"/start KOD" şeklinde gönderin.',
      )
      return { ok: true }
    }

    const { rows } = await fastify.db.query(
      `UPDATE passengers
       SET telegram_chat_id = $1
       WHERE invite_code = $2 AND is_active = true
       RETURNING id, full_name AS "fullName"`,
      [String(chatId), code],
    )

    if (!rows[0]) {
      await sendRaw(chatId, `"${code}" kodu tanınmadı. Kodu kontrol edip tekrar deneyin.`)
      return { ok: true }
    }

    logger.info({ passengerId: rows[0].id }, 'Telegram chat id linked via /start webhook')
    await sendRaw(
      chatId,
      `Merhaba ${rows[0].fullName}! Servis bildirimleri artık bu sohbete gelecek.`,
    )
    return { ok: true }
  })
}
