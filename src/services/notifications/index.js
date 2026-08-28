/**
 * Channel-agnostic notification dispatcher.
 *
 * Every channel implements the same interface:
 *   send({ passenger, message }) -> { ok, error?, retryable? }
 * Errors that return retryable: true are retried by BullMQ.
 * Adding a new channel (e.g. mobile push/FCM) = adding an adapter to the CHANNELS map.
 *
 * Dry-run (Phase F3): during a rehearsal, no real message should reach a real
 * passenger. There are two levels — the global `NOTIFICATION_DRY_RUN` env flag
 * and the per-company `companies.dry_run`. If either is on, nothing is sent;
 * the result lands in notification_logs with status `dry_run`, so the
 * rehearsal flow is distinguishable from a live send in the audit log.
 *
 * If NOTIFICATION_TEST_CHAT_ID is set, the message is routed to that single
 * Telegram account instead of being suppressed: the end-to-end flow is really
 * exercised but passengers are not affected.
 */
import { env } from '../../config/env.js'
import { logger } from '../../utils/logger.js'
import * as telegram from './telegram.js'
import * as sms from './sms.js'

const CHANNELS = {
  telegram,
  sms,
  // push: Phase 4+ — wired in here when the passenger mobile app (FCM) is added
}

/**
 * @param {object} passenger — a passengers table row (includes notification_channel)
 * @param {string} message — the text to send
 * @param {{dryRun?: boolean}} [opts] — per-company dry-run override
 */
export async function notify(passenger, message, { dryRun = false } = {}) {
  const channel = CHANNELS[passenger.notification_channel]
  if (!channel) {
    logger.error(
      { passengerId: passenger.id, channel: passenger.notification_channel },
      'Unknown notification channel',
    )
    return { ok: false, error: 'unknown_channel' }
  }

  if (env.NOTIFICATION_DRY_RUN || dryRun) {
    // If a test target is set, route the message there — so the flow really runs
    if (env.NOTIFICATION_TEST_CHAT_ID) {
      const result = await telegram.send({
        passenger: { ...passenger, telegram_chat_id: env.NOTIFICATION_TEST_CHAT_ID },
        message: `[DRY-RUN → ${passenger.full_name ?? passenger.id}] ${message}`,
      })
      return { ...result, dryRun: true }
    }

    logger.info(
      { passengerId: passenger.id, channel: passenger.notification_channel },
      'Dry-run: notification not sent',
    )
    return { ok: true, dryRun: true }
  }

  return channel.send({ passenger, message })
}
