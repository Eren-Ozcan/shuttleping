/**
 * PATCH endpoint'leri için kısmi UPDATE seti kurar.
 * undefined değerler atlanır — sadece gönderilen alanlar güncellenir.
 *
 * @param {Record<string, unknown>} fields — { kolon_adi: değer }
 * @returns {{ sets: string[], params: unknown[] }}
 */
export function buildUpdate(fields) {
  const sets = []
  const params = []
  for (const [column, value] of Object.entries(fields)) {
    if (value === undefined) continue
    params.push(value)
    sets.push(`${column} = $${params.length}`)
  }

  // Hiçbir alan gelmediyse çağıranın `SET ${sets.join(', ')}, updated_at = now()`
  // kalıbı `SET , updated_at = now()` üretir — sözdizimi hatası, 500. Route
  // şemaları minProperties: 1 ile koruyor ama AJV bunu additionalProperties'ten
  // ÖNCE değerlendirir ve app.js removeAdditional: true kullanır: yalnızca
  // bilinmeyen anahtar içeren bir gövde minProperties'i geçip {} olarak
  // temizlenebilir. Util kendi başına güvenli olmalı.
  if (!sets.length) {
    throw new EmptyUpdateError()
  }
  return { sets, params }
}

/** Güncellenecek alan bulunmadığında atılır; route katmanı 400'e çevirir. */
export class EmptyUpdateError extends Error {
  constructor() {
    super('Güncellenecek alan yok')
    this.name = 'EmptyUpdateError'
    this.statusCode = 400
  }
}
