/**
 * Builds a partial UPDATE set for PATCH endpoints.
 * undefined values are skipped — only the fields that were sent get updated.
 *
 * @param {Record<string, unknown>} fields — { column_name: value }
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

  // If no field arrived, the caller's `SET ${sets.join(', ')}, updated_at = now()`
  // pattern produces `SET , updated_at = now()` — a syntax error, 500. Route
  // schemas guard this with minProperties: 1, but AJV evaluates that BEFORE
  // additionalProperties and app.js uses removeAdditional: true: a body
  // containing only unknown keys can pass minProperties and then be stripped
  // to {}. This util must be safe on its own.
  if (!sets.length) {
    throw new EmptyUpdateError()
  }
  return { sets, params }
}

/** Thrown when there is no field to update; the route layer turns it into a 400. */
export class EmptyUpdateError extends Error {
  constructor() {
    super('Güncellenecek alan yok')
    this.name = 'EmptyUpdateError'
    this.statusCode = 400
  }
}
