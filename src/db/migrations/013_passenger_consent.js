/**
 * T2.4 — KVKK açık rıza kaydı.
 *
 * A passenger record holds personal data (name, phone, Telegram chat id)
 * processed on the basis of explicit consent (KVKK m.5/1) — see
 * docs/KVKK-AYDINLATMA-METNI.md. Nothing tracked whether that consent was
 * actually obtained before this; the passenger route now requires it.
 */

export const up = (pgm) => {
  pgm.addColumns('passengers', {
    consent_given_at: { type: 'timestamptz' },
    // Which version of docs/KVKK-AYDINLATMA-METNI.md the consent covers —
    // if the text materially changes, existing passengers can be told apart
    // from ones who consented to an older version
    consent_version: { type: 'text' },
  })
}

export const down = (pgm) => {
  pgm.dropColumns('passengers', ['consent_given_at', 'consent_version'])
}
