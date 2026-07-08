import bcrypt from 'bcrypt'
import crypto from 'crypto'
import { pool } from '../db/pool.js'

const SALT_ROUNDS = 12

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}

export async function findUserByEmail(email) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE email = $1 AND is_active = true',
    [email],
  )
  return rows[0] ?? null
}

export async function createRefreshToken(userId, tokenHash, expiresAt) {
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, tokenHash, expiresAt],
  )
}

export async function findRefreshToken(tokenHash) {
  const { rows } = await pool.query(
    `SELECT rt.*, u.role, u.company_id, u.is_active AS user_active,
            c.payment_status AS company_payment_status
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     LEFT JOIN companies c ON c.id = u.company_id
     WHERE rt.token_hash = $1 AND rt.expires_at > now()`,
    [tokenHash],
  )
  return rows[0] ?? null
}

/** super_admin dışındaki roller için: şirketin ödemesi gecikmişse erişim bloklanır */
export async function findCompanyPaymentStatus(companyId) {
  const { rows } = await pool.query(
    'SELECT payment_status FROM companies WHERE id = $1',
    [companyId],
  )
  return rows[0]?.payment_status ?? null
}

export async function deleteRefreshToken(tokenHash) {
  await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash])
}

export async function deleteAllUserTokens(userId) {
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId])
}

/** Raw token'ı SHA-256 ile hash'le (DB'de raw token saklanmaz) */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** 40-byte kriptografik olarak güvenli rastgele token üret */
export function generateToken() {
  return crypto.randomBytes(40).toString('hex')
}
