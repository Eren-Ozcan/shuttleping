/**
 * Creates (or resets the password of) the platform's first super_admin.
 *
 * Usage:
 *   node scripts/create-super-admin.js <email> <password> "<Full Name>"
 *
 * Works against whatever DATABASE_URL points to, so it is also the way to
 * bootstrap production. Replaces the manual bcrypt + INSERT steps in
 * docs/SENIN-ADIMLARIN.md.
 */
import bcrypt from 'bcrypt'
import pg from 'pg'
import { config } from 'dotenv'

config()

const [email, password, fullName] = process.argv.slice(2)

if (!email || !password) {
  console.error('Kullanım: node scripts/create-super-admin.js <email> <parola> "<Ad Soyad>"')
  process.exit(1)
}

if (password.length < 8) {
  console.error('Parola en az 8 karakter olmalı')
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL tanımlı değil — .env dosyanı kontrol et')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: databaseUrl })

try {
  const passwordHash = await bcrypt.hash(password, 10)

  // The WHERE guard keeps this from silently resetting the password of an
  // existing company_admin/driver that happens to use the same address
  const { rows } = await pool.query(
    `INSERT INTO users (company_id, email, password_hash, role, full_name, is_active)
     VALUES (NULL, $1, $2, 'super_admin', $3, true)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           is_active = true
     WHERE users.role = 'super_admin'
     RETURNING id, email, role`,
    [email.toLowerCase(), passwordHash, fullName || 'Süper Admin'],
  )

  const user = rows[0]

  if (!user) {
    const { rows: existing } = await pool.query('SELECT role FROM users WHERE email = $1', [
      email.toLowerCase(),
    ])
    console.error(
      `Bu e-posta zaten '${existing[0]?.role}' rolüyle kayıtlı — dokunulmadı. Başka bir e-posta kullan.`,
    )
    process.exit(1)
  }

  console.log(`super_admin hazır: ${user.email} (${user.id})`)
  console.log('Panele /admin/ adresinden bu bilgilerle girebilirsin.')
} catch (err) {
  console.error('super_admin oluşturulamadı:', err.message)
  process.exit(1)
} finally {
  await pool.end()
}
