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
  return { sets, params }
}
