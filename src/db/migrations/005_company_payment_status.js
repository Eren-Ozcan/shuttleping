/**
 * Phase 8 (simple version): payment is taken in cash / by bank transfer, no
 * gateway integration. super_admin marks it manually from the panel; for
 * overdue companies, company_admin/driver logins are blocked in the auth layer.
 */

export const up = (pgm) => {
  pgm.addColumns('companies', {
    payment_status: {
      type: 'text',
      notNull: true,
      default: 'active',
      check: "payment_status IN ('active', 'overdue')",
    },
    last_payment_date: { type: 'timestamptz' },
    next_due_date: { type: 'timestamptz' },
  })
}

export const down = (pgm) => {
  pgm.dropColumns('companies', ['payment_status', 'last_payment_date', 'next_due_date'])
}
