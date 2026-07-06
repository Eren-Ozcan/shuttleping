/**
 * Netgsm SMS adapter'ı — Faz 4'te gerçek entegrasyon yapılacak.
 * Arayüz: send({ passenger, message }) → { ok, error? }
 */
import { logger } from '../../utils/logger.js'

export async function send({ passenger, message }) {
  if (!passenger.phone) {
    return { ok: false, error: 'missing_phone' }
  }

  // TODO(Faz 4): Netgsm REST API çağrısı
  logger.info(
    { passengerId: passenger.id, phone: passenger.phone, message },
    'SMS bildirimi (stub)',
  )
  return { ok: true }
}
