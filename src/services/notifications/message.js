/**
 * Bildirim metinleri — tek yerde dursun ki kanal adapter'ları
 * ve testler aynı formatı kullansın.
 */
export function buildApproachMessage({ stopName, etaMinutes }) {
  return `🚌 Servisiniz yaklaşıyor! "${stopName}" durağına tahmini varış: ${etaMinutes} dk.`
}
