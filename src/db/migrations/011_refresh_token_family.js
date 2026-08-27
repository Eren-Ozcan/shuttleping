/**
 * Faz D9 — refresh token ailesi ve yeniden kullanım tespiti.
 *
 * Rotasyon bugüne kadar "eskisini SİL, yenisini yaz" şeklindeydi. Çalınmış
 * bir token yeniden kullanıldığında sadece 401 alıyordu; meşru oturum
 * çalışmaya devam ediyor, hırsızlık ne görülüyor ne de geri alınabiliyordu.
 *
 * Artık token satırı silinmiyor, `revoked_at` ile işaretleniyor ve aynı
 * ailede (`family_id`) kalıyor. İptal edilmiş bir token tekrar sunulursa
 * bu, token'ın kopyalandığı anlamına gelir: tüm aile iptal edilir, yani
 * hem hırsız hem meşru oturum düşer ve kullanıcı yeniden giriş yapar.
 *
 * Ayrıca süresi geçmiş satırlar için temizlik gerekiyordu — tablo bugüne
 * kadar sınırsız büyüyordu.
 */

export const up = (pgm) => {
  pgm.addColumns('refresh_tokens', {
    // Rotasyon zinciri: ilk giriş bir aile açar, her yenileme aynı ailede kalır
    family_id: { type: 'uuid', notNull: true, default: pgm.func('uuid_generate_v4()') },
    revoked_at: { type: 'timestamptz' },
    // Denetim: hangi token'ın yerine geçtiği
    replaced_by: { type: 'uuid', references: 'refresh_tokens', onDelete: 'SET NULL' },
  })

  pgm.createIndex('refresh_tokens', 'family_id', { name: 'refresh_tokens_family_idx' })
  // Temizlik işi bu index'i kullanır
  pgm.createIndex('refresh_tokens', 'expires_at', { name: 'refresh_tokens_expires_idx' })
}

export const down = (pgm) => {
  pgm.dropIndex('refresh_tokens', 'expires_at', { name: 'refresh_tokens_expires_idx' })
  pgm.dropIndex('refresh_tokens', 'family_id', { name: 'refresh_tokens_family_idx' })
  pgm.dropColumns('refresh_tokens', ['family_id', 'revoked_at', 'replaced_by'])
}
