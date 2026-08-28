/**
 * Notification texts — kept in one place so the channel adapters and the
 * tests use the same format.
 */
export function buildApproachMessage({ stopName, etaMinutes }) {
  return `🚌 Servisiniz yaklaşıyor! "${stopName}" durağına tahmini varış: ${etaMinutes} dk.`
}
