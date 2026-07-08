/**
 * Faz 8 (basit sürüm): ödeme elden/IBAN alınıyor, gateway entegrasyonu yok.
 * super_admin panelden manuel işaretler; gecikmiş şirketlerin
 * company_admin/driver girişleri auth katmanında bloklanır.
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
