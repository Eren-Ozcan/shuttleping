/**
 * T2.3 — Telegram /start webhook.
 *
 * A chat id is currently picked up by hand: passenger sends /start, admin
 * runs `npm run telegram:chat-id`, copies the id into the panel. This adds a
 * per-passenger invite code the admin shares (panel/SMS/WhatsApp); the
 * passenger sends "/start <code>" to the bot and the webhook links
 * telegram_chat_id automatically — no manual getUpdates step.
 */

export const up = (pgm) => {
  pgm.addColumns('passengers', {
    invite_code: { type: 'text' },
  })

  // Global uniqueness: the webhook looks a passenger up by code alone, it
  // has no company context until after the match.
  pgm.createIndex('passengers', 'invite_code', {
    unique: true,
    where: 'invite_code IS NOT NULL',
    name: 'passengers_invite_code_unique',
  })
}

export const down = (pgm) => {
  pgm.dropIndex('passengers', 'invite_code', { name: 'passengers_invite_code_unique' })
  pgm.dropColumns('passengers', ['invite_code'])
}
