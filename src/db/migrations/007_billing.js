/**
 * Phase C — revenue protection.
 *
 * In Phase 8, payment tracking was just a two-state flag (active/overdue) and a
 * login gate: a suspended company's driver kept sending locations, kept
 * triggering ETA computation, and kept getting real SMS/Telegram sent to its
 * passengers. In other words, "suspension" never stopped the spending.
 *
 * Graduated model:
 *   active    — normal
 *   overdue   — company_admin login closes, Google queries stop (falls back to
 *               haversine). Driver and notifications keep working: the passenger
 *               is not a party to the payment relationship.
 *   suspended — all logins close, location ingest is rejected, no notifications sent.
 *
 * Also:
 *   companies.max_passengers — quota for per-passenger pricing
 *   company_payments         — payment ledger; a "Payment Received" click no
 *                              longer overwrites last_payment_date and loses history
 */

export const up = (pgm) => {
  // add 'suspended' to payment_status
  pgm.dropConstraint('companies', 'companies_payment_status_check')
  pgm.addConstraint('companies', 'companies_payment_status_check', {
    check: "payment_status IN ('active', 'overdue', 'suspended')",
  })

  pgm.addColumns('companies', {
    // NULL = unlimited (existing companies are unaffected)
    max_passengers: { type: 'integer' },
  })

  pgm.createTable('company_payments', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    company_id: {
      type: 'uuid',
      notNull: true,
      references: 'companies',
      onDelete: 'RESTRICT',
    },
    amount: { type: 'numeric(12,2)' },
    currency: { type: 'text', notNull: true, default: 'TRY' },
    paid_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    period_start: { type: 'timestamptz' },
    period_end: { type: 'timestamptz' },
    // Who marked it must stay for audit; the row survives even if the user is deleted
    recorded_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    note: { type: 'text' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  })

  pgm.createIndex('company_payments', ['company_id', 'paid_at'], {
    name: 'company_payments_company_paid_idx',
  })

  // The daily job that finds overdue companies uses this index
  pgm.createIndex('companies', 'next_due_date', {
    where: "payment_status = 'active'",
    name: 'companies_active_due_idx',
  })
}

export const down = (pgm) => {
  pgm.dropIndex('companies', 'next_due_date', { name: 'companies_active_due_idx' })
  pgm.dropTable('company_payments')
  pgm.dropColumns('companies', ['max_passengers'])

  // 'suspended' companies cannot be represented after rollback, so pull them to 'overdue' first
  pgm.sql(`UPDATE companies SET payment_status = 'overdue' WHERE payment_status = 'suspended'`)
  pgm.dropConstraint('companies', 'companies_payment_status_check')
  pgm.addConstraint('companies', 'companies_payment_status_check', {
    check: "payment_status IN ('active', 'overdue')",
  })
}
