/**
 * Passenger tracking links (T1.5 / R-5).
 *
 * A track token is opaque and Redis-backed, the same pattern as the SSE
 * stream ticket — but longer-lived (TRACK_TOKEN_TTL_SECONDS, a full shift)
 * and multi-use, since a passenger reopens the link to check the ETA again.
 * It only ever exposes one stop's ETA, never the full route or vehicle position.
 */
export const trackTokenKey = (token) => `track:${token}`
