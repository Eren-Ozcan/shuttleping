/**
 * Faz C — gelir koruması.
 *
 * Faz 8'de ödeme takibi iki durumlu bir bayraktan (active/overdue) ve bir
 * login kapısından ibaretti: askıya alınan şirketin sürücüsü konum
 * göndermeye, ETA hesaplatmaya ve yolcularına gerçek SMS/Telegram
 * göndertmeye devam ediyordu. Yani "askıya alma" harcamayı hiç durdurmuyordu.
 *
 * Kademeli model:
 *   active    — normal
 *   overdue   — company_admin girişi kapanır, Google sorgusu durur (haversine'e
 *               düşülür). Sürücü ve bildirimler çalışmaya devam eder: yolcu
 *               ödeme ilişkisinin tarafı değil.
 *   suspended — tüm girişler kapanır, konum ingest reddedilir, bildirim gitmez.
 *
 * Ayrıca:
 *   companies.max_passengers — yolcu başına fiyatlandırma için kota
 *   company_payments         — ödeme defteri; "Ödeme Alındı" tıklaması artık
 *                              last_payment_date'i üzerine yazıp geçmişi
 *                              kaybetmiyor
 */

export const up = (pgm) => {
  // payment_status'e 'suspended' eklenir
  pgm.dropConstraint('companies', 'companies_payment_status_check')
  pgm.addConstraint('companies', 'companies_payment_status_check', {
    check: "payment_status IN ('active', 'overdue', 'suspended')",
  })

  pgm.addColumns('companies', {
    // NULL = sınırsız (mevcut şirketler etkilenmesin)
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
    // Kimin işaretlediği denetim için kalmalı; kullanıcı silinse de kayıt durur
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

  // Vadesi geçmiş şirketleri bulan günlük iş bu index'i kullanır
  pgm.createIndex('companies', 'next_due_date', {
    where: "payment_status = 'active'",
    name: 'companies_active_due_idx',
  })
}

export const down = (pgm) => {
  pgm.dropIndex('companies', 'next_due_date', { name: 'companies_active_due_idx' })
  pgm.dropTable('company_payments')
  pgm.dropColumns('companies', ['max_passengers'])

  // 'suspended' şirketler geri alınamayacağı için önce 'overdue'ya çekilir
  pgm.sql(`UPDATE companies SET payment_status = 'overdue' WHERE payment_status = 'suspended'`)
  pgm.dropConstraint('companies', 'companies_payment_status_check')
  pgm.addConstraint('companies', 'companies_payment_status_check', {
    check: "payment_status IN ('active', 'overdue')",
  })
}
