/**
 * Notification texts — kept in one place so the channel adapters and the
 * tests use the same format.
 */
export function buildApproachMessage({ stopName, etaMinutes, companyName, trackUrl }) {
  const prefix = companyName ? `🚌 ${companyName} servisiniz yaklaşıyor!` : '🚌 Servisiniz yaklaşıyor!'
  const base = `${prefix} "${stopName}" durağına tahmini varış: ${etaMinutes} dk.`
  return trackUrl ? `${base}\nCanlı takip: ${trackUrl}` : base
}
