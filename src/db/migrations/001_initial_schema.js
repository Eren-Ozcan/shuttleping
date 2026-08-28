/**
 * Phase 1 initial schema:
 *   companies  — multi-tenant root
 *   users      — super_admin / company_admin / driver
 *   refresh_tokens — opaque refresh token store
 *
 * Rules:
 *   - No physical delete: is_active = false
 *   - All timestamps are TIMESTAMPTZ
 *   - PK: uuid_generate_v4()
 */

export const up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

  // ── companies ──────────────────────────────────────────────────────────────
  pgm.createTable('companies', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    name: { type: 'text', notNull: true },
    slug: { type: 'text', notNull: true, unique: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  })

  // ── users ──────────────────────────────────────────────────────────────────
  pgm.createTable('users', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    // may be NULL for super_admin
    company_id: {
      type: 'uuid',
      references: 'companies',
      onDelete: 'RESTRICT',
    },
    email: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    role: {
      type: 'text',
      notNull: true,
      check: "role IN ('super_admin', 'company_admin', 'driver')",
    },
    full_name: { type: 'text', notNull: true },
    phone: { type: 'text' },
    is_active: { type: 'boolean', notNull: true, default: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  })

  pgm.createIndex('users', 'company_id')
  pgm.createIndex('users', 'email')

  // ── refresh_tokens ─────────────────────────────────────────────────────────
  pgm.createTable('refresh_tokens', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    // SHA-256 hash of the raw opaque token
    token_hash: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  })

  pgm.createIndex('refresh_tokens', 'user_id')
  pgm.createIndex('refresh_tokens', 'token_hash')
}

export const down = (pgm) => {
  pgm.dropTable('refresh_tokens')
  pgm.dropTable('users')
  pgm.dropTable('companies')
}
