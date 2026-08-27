/**
 * Faz E11 — updated_at'i trigger'a devret.
 *
 * updated_at altı ayrı route'ta elle yazılıyordu (`SET ..., updated_at = now()`).
 * Bir yerde unutulması sessizce denetim sırasını bozar ve fark edilmesi zordur.
 * Artık veritabanı garanti ediyor; route'lardaki elle yazım kaldırıldı.
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
