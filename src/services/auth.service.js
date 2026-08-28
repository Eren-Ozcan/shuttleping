import bcrypt from 'bcrypt'
import crypto from 'crypto'
import { pool } from '../db/pool.js'

const SALT_ROUNDS = 12

/**
 * Fake hash to compare against for an unregistered email. The bcrypt cost is
 * paid even when the user is not found; otherwise the response-time difference
 * leaks whether the email exists. This value matches no password (a valid
 * bcrypt hash with a random salt).
 */
export const DUMMY_PASSWORD_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEe.9L/3pJ0zfMPPZ0/9x3nqgWDXBcQfhvi'

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

/**
 * Writes a new refresh token row.
 * Without familyId a new family is opened (first login); with it, the rotation
 * chain continues in the same family (D9).
 * @returns {Promise<{id: string, family_id: string}>}
 */
export async function createRefreshToken(userId, tokenHash, expiresAt, familyId) {
  const { rows } = await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, family_id)
     VALUES ($1, $2, $3, COALESCE($4, uuid_generate_v4()))
     RETURNING id, family_id`,
    [userId, tokenHash, expiresAt, familyId ?? null],
  )
  return rows[0]
}

/**
 * Looks a token up by its hash. Revoked rows are returned too — so the caller
 * can detect reuse (D9).
 */
export async function findRefreshToken(tokenHash) {
  const { rows } = await pool.query(
    `SELECT rt.*, u.role, u.company_id, u.email, u.full_name,
            u.is_active AS user_active,
            c.payment_status AS company_payment_status,
            c.is_active AS company_active
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     LEFT JOIN companies c ON c.id = u.company_id
     WHERE rt.token_hash = $1 AND rt.expires_at > now()`,
    [tokenHash],
  )
  return rows[0] ?? null
}

/**
 * Revokes a token and marks its replacement (rotation).
 * Revoke instead of delete: the row must stay so a re-submitted stolen copy
 * can be spotted.
 */
export async function rotateRefreshToken(tokenId, replacedById) {
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1',
    [tokenId, replacedById],
  )
}

/**
 * Revokes every token in a family.
 * Called when a revoked token is presented again: the token has been copied,
 * so both the thief's and the legitimate user's sessions must drop.
 */
export async function revokeTokenFamily(familyId) {
  const { rowCount } = await pool.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
    [familyId],
  )
  return rowCount
}

/** Deletes rows that are expired, or were revoked long ago. */
export async function purgeExpiredRefreshTokens() {
  const { rowCount } = await pool.query(
    `DELETE FROM refresh_tokens
     WHERE expires_at < now() - interval '7 days'
        OR revoked_at < now() - interval '30 days'`,
  )
  return rowCount
}

/**
 * Access gate for roles other than super_admin: login is blocked if the
 * company is inactive or its payment is overdue.
 */
export async function findCompanyAccess(companyId) {
  if (!companyId) return null
  const { rows } = await pool.query(
    'SELECT payment_status, is_active FROM companies WHERE id = $1',
    [companyId],
  )
  return rows[0] ?? null
}

/** Logout: revokes the token and its whole family. */
export async function deleteRefreshToken(tokenHash) {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)
       AND revoked_at IS NULL`,
    [tokenHash],
  )
}

export async function deleteAllUserTokens(userId) {
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  )
}

/** Hash a raw token with SHA-256 (raw tokens are never stored in the DB). */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Generate a 40-byte cryptographically secure random token. */
export function generateToken() {
  return crypto.randomBytes(40).toString('hex')
}
