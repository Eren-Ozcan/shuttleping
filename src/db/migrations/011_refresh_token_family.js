/**
 * Phase D9 — refresh token family and reuse detection.
 *
 * Rotation used to be "DELETE the old one, write the new one". When a stolen
 * token was reused it just got a 401; the legitimate session kept working, and
 * the theft was neither visible nor revocable.
 *
 * Now the token row is not deleted, it is marked with `revoked_at` and stays in
 * the same family (`family_id`). If a revoked token is presented again, the
 * token has been copied: the whole family is revoked, so both the thief's and
 * the legitimate session drop and the user logs in again.
 *
 * Cleanup for expired rows was also needed — the table was growing without bound.
 */

export const up = (pgm) => {
  pgm.addColumns('refresh_tokens', {
    // Rotation chain: the first login opens a family, every refresh stays in it
    family_id: { type: 'uuid', notNull: true, default: pgm.func('uuid_generate_v4()') },
    revoked_at: { type: 'timestamptz' },
    // Audit: which token this one replaced
    replaced_by: { type: 'uuid', references: 'refresh_tokens', onDelete: 'SET NULL' },
  })

  pgm.createIndex('refresh_tokens', 'family_id', { name: 'refresh_tokens_family_idx' })
  // The cleanup job uses this index
  pgm.createIndex('refresh_tokens', 'expires_at', { name: 'refresh_tokens_expires_idx' })
}

export const down = (pgm) => {
  pgm.dropIndex('refresh_tokens', 'expires_at', { name: 'refresh_tokens_expires_idx' })
  pgm.dropIndex('refresh_tokens', 'family_id', { name: 'refresh_tokens_family_idx' })
  pgm.dropColumns('refresh_tokens', ['family_id', 'revoked_at', 'replaced_by'])
}
