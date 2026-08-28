/**
 * Phase E11 — delegate updated_at to a trigger.
 *
 * updated_at was written by hand in six separate routes (`SET ..., updated_at = now()`).
 * Forgetting it in one place silently corrupts the audit order and is hard to spot.
 * The database now guarantees it; the manual writes in the routes were removed.
 */

const TABLES = ['companies', 'users', 'vehicles', 'routes', 'stops', 'passengers']

export const up = (pgm) => {
  pgm.createFunction(
    'set_updated_at',
    [],
    { returns: 'trigger', language: 'plpgsql', replace: true },
    `BEGIN
       NEW.updated_at = now();
       RETURN NEW;
     END;`,
  )

  for (const table of TABLES) {
    pgm.createTrigger(table, `${table}_set_updated_at`, {
      when: 'BEFORE',
      operation: 'UPDATE',
      level: 'ROW',
      function: 'set_updated_at',
    })
  }
}

export const down = (pgm) => {
  for (const table of TABLES) {
    pgm.dropTrigger(table, `${table}_set_updated_at`)
  }
  pgm.dropFunction('set_updated_at', [])
}
