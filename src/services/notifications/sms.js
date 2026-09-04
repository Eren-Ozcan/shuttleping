/**
 * Netgsm SMS adapter (POST /sms/send/get).
 * Interface: send({ passenger, message }) -> { ok, error?, retryable? }
 *
 * The Netgsm response is plain text: "00 <jobid>" on success; 20/30/40/50/51/70/85
 * are error codes (30: invalid credentials, 40: undefined header, 70: parameter
 * error, 85: system error — the only transient one).
 *
 * Credentials are carried in the body (D11): when sent in the query string they
 * ended up as plain-text passwords in the outbound proxy and access logs.
 */
import { env } from '../../config/env.js'
import { logger } from '../../utils/logger.js'

/** '0532 111 22 33' / '+90 532 ...' -> '5321112233' (Netgsm format) */
export function normalizeGsm(phone) {
  let digits = String(phone).replace(/\D/g, '')
  if (digits.startsWith('90') && digits.length > 10) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)
  return digits
}

const RETRYABLE_CODES = new Set(['85'])

export async function send({ passenger, message }) {
  if (!passenger.phone) {
    return { ok: false, error: 'missing_phone' }
  }
  if (!env.NETGSM_USERCODE || !env.NETGSM_PASSWORD || !env.NETGSM_MSGHEADER) {
    logger.warn('Netgsm credentials are not set — SMS not sent')
    return { ok: false, error: 'sms_not_configured' }
  }

  const gsmno = normalizeGsm(passenger.phone)
  if (!/^5\d{9}$/.test(gsmno)) {
    return { ok: false, error: 'invalid_phone' }
  }

  const params = new URLSearchParams({
    usercode: env.NETGSM_USERCODE,
    password: env.NETGSM_PASSWORD,
    gsmno,
    message,
    msgheader: env.NETGSM_MSGHEADER,
    dil: 'TR',
  })

  let res
  try {
    res = await fetch(`${env.NETGSM_API_BASE}/sms/send/get`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    logger.error({ err, passengerId: passenger.id }, 'Netgsm request could not be sent')
    return { ok: false, error: 'sms_network', retryable: true }
  }

  const text = (await res.text()).trim()
  const code = text.split(/\s+/)[0]
  if (!res.ok || code !== '00') {
    logger.error(
      { status: res.status, response: text, passengerId: passenger.id },
      'Netgsm send failed',
    )
    return {
      ok: false,
      error: `netgsm_${code || res.status}`,
      retryable: res.status >= 500 || RETRYABLE_CODES.has(code),
    }
  }

  return { ok: true }
}
