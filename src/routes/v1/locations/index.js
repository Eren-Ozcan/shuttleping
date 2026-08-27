import { randomBytes } from 'node:crypto'
import {
  ingestLocationSchema,
  getLocationSchema,
  getEtaSchema,
  streamSchema,
  streamTicketSchema,
} from './schema.js'
import { locationKey, etaKey } from '../../../services/eta/index.js'
import { enqueueEtaJob } from '../../../queues/index.js'
import { env } from '../../../config/env.js'

// Son konum Redis'te tutulur; araç yayın kesilirse 5 dk sonra "çevrimdışı" sayılır
const LOCATION_TTL_SECONDS = 300
// SSE bileti kısa ömürlü olmalı — sadece EventSource'un açılmasına yetecek kadar
const STREAM_TICKET_TTL_SECONDS = 60
const streamTicketKey = (ticket) => `streamticket:${ticket}`

export default async function locationRoutes(fastify) {
  // Açık SSE akışlarının kapatıcıları; kapanışta hepsi sonlandırılır (E8)
  const openStreams = new Set()
  fastify.addHook('onClose', async () => {
    for (const close of [...openStreams]) close()
  })

  /**
   * POST /api/v1/locations
   * Sürücü anlık konum gönderir. Konum yalnızca AKTİF SEFER varken kabul edilir
   * (POST /api/v1/trips/start ile açılır); son konum Redis'e yazılır, sefer
   * geçmişine iz düşülür ve ETA worker'ı için kuyruğa job atılır.
   */
  fastify.post(
    '/',
    {
      schema: ingestLocationSchema,
      onRequest: [fastify.requireRole(['driver'])],
      // İstemci 10 sn'de bir gönderiyor; sürücü başına dakikada 12 makul üst
      // sınır. Her ping DB yazısı + potansiyel faturalı Google çağrısı (D1)
      config: {
        rateLimit: { max: env.RATE_LIMIT_LOCATION_MAX, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const { lat, lng, heading, speed, recordedAt } = request.body
      const companyId = request.user.companyId
      const driverId = request.user.sub

      const { rows } = await fastify.db.query(
        `SELECT id, route_id FROM trips
         WHERE driver_id = $1 AND company_id = $2 AND status = 'active'`,
        [driverId, companyId],
      )
      if (!rows[0]) {
        return reply.conflict('Önce seferi başlatın (POST /api/v1/trips/start)')
      }

      const tripId = rows[0].id
      const routeId = rows[0].route_id
      // Offline buffer flush'ı: eski bir fix canlı konumu ve ETA'yı tetiklemesin,
      // sadece geçmişe işlenir. Bağlantının döndüğünü kanıtladığı için last_ping
      // yine tazelenir (yanlış "abandoned" işaretlemesini önler).
      const isBackfill = recordedAt !== undefined

      await Promise.all([
        isBackfill
          ? null
          : fastify.redis.set(
              locationKey(companyId, routeId),
              JSON.stringify({
                lat,
                lng,
                heading: heading ?? null,
                speed: speed ?? null,
                driverId,
                tripId,
                ts: Date.now(),
              }),
              'EX',
              LOCATION_TTL_SECONDS,
            ),
        // Sefer geçmişi (Faz 7) — append-only iz kaydı
        fastify.db.query(
          `INSERT INTO location_history
             (company_id, route_id, trip_id, driver_id, lat, lng, speed, heading, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()))`,
          [
            companyId,
            routeId,
            tripId,
            driverId,
            lat,
            lng,
            speed ?? null,
            heading ?? null,
            recordedAt ?? null,
          ],
        ),
        fastify.db.query('UPDATE trips SET last_ping_at = now() WHERE id = $1', [tripId]),
      ])

      if (!isBackfill) await enqueueEtaJob({ companyId, routeId, tripId })

      return { ok: true, routeId, tripId }
    },
  )

  /**
   * GET /api/v1/locations/:routeId
   * Güzergahtaki aracın son bilinen konumu (admin panel harita).
   */
  fastify.get(
    '/:routeId',
    { schema: getLocationSchema, onRequest: [fastify.requireRole(['company_admin'])] },
    async (request, reply) => {
      const raw = await fastify.redis.get(
        locationKey(request.user.companyId, request.params.routeId),
      )
      if (!raw) return reply.notFound('Bu güzergah için güncel konum yok')
      return JSON.parse(raw)
    },
  )

  /**
   * POST /api/v1/locations/:routeId/stream-ticket
   * SSE için tek kullanımlık, 60 sn ömürlü bilet üretir. EventSource
   * Authorization header taşıyamadığı için akış bu biletle açılır —
   * access token URL'e hiç girmez (D2).
   */
  fastify.post(
    '/:routeId/stream-ticket',
    { schema: streamTicketSchema, onRequest: [fastify.requireRole(['company_admin'])] },
    async (request, reply) => {
      const { routeId } = request.params
      const companyId = request.user.companyId

      // Güzergah sahipliği burada, DB'den doğrulanır — akışın izolasyonu
      // artık yalnızca Redis anahtar isim alanına dayanmıyor (D4)
      const { rows } = await fastify.db.query(
        'SELECT id FROM routes WHERE id = $1 AND company_id = $2',
        [routeId, companyId],
      )
      if (!rows[0]) return reply.notFound('Güzergah bulunamadı')

      const ticket = randomBytes(32).toString('hex')
      await fastify.redis.set(
        streamTicketKey(ticket),
        JSON.stringify({ companyId, routeId, sub: request.user.sub }),
        'EX',
        STREAM_TICKET_TTL_SECONDS,
      )
      return { ticket, expiresIn: STREAM_TICKET_TTL_SECONDS }
    },
  )

  /**
   * GET /api/v1/locations/:routeId/stream
   * SSE: konum + ETA'yı 3 sn'de bir yayınlar (canlı harita).
   * Kimlik doğrulama stream-ticket ile; bilet tek kullanımlıktır.
   */
  fastify.get('/:routeId/stream', { schema: streamSchema }, async (request, reply) => {
    const { routeId } = request.params

    // Tek kullanımlık: okunduğu anda silinir, tekrar kullanılamaz
    const key = streamTicketKey(request.query.ticket)
    const raw = await fastify.redis.get(key)
    if (!raw) return reply.unauthorized('Geçersiz veya süresi dolmuş bilet')
    await fastify.redis.del(key)

    const granted = JSON.parse(raw)
    if (granted.routeId !== routeId) {
      return reply.forbidden('Bilet bu güzergah için geçerli değil')
    }
    const { companyId } = granted

    // CORS: gelen Origin'i yansıtmak yerine global politikayla aynı kaynağa
    // izin ver — hijack edilen yanıt @fastify/cors'u atladığı için elle (D3)
    const origin = request.headers.origin
    const corsHeaders =
      origin && origin === env.CORS_ORIGIN
        ? {
            'access-control-allow-origin': origin,
            'access-control-allow-credentials': 'true',
            vary: 'Origin',
          }
        : {}

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      ...corsHeaders,
      // Nginx/proxy buffering'i kapat — SSE anında akmalı
      'x-accel-buffering': 'no',
    })
    reply.raw.write('retry: 5000\n\n')

    const push = async () => {
      const [rawLocation, rawEta] = await fastify.redis.mget(
        locationKey(companyId, routeId),
        etaKey(companyId, routeId),
      )
      const payload = {
        location: rawLocation ? JSON.parse(rawLocation) : null,
        eta: rawEta ? JSON.parse(rawEta) : null,
        ts: Date.now(),
      }
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    await push()

    // Kapanış kaydı: shutdown sırasında açık akışlar sonlandırılmazsa
    // fastify.close() asılı kalır ve platform process'i SIGKILL eder (E8)
    let interval = null
    const close = () => {
      if (interval) clearInterval(interval)
      openStreams.delete(close)
      reply.raw.end()
    }

    interval = setInterval(() => {
      push().catch(close)
    }, 3_000)

    openStreams.add(close)
    request.raw.on('close', () => {
      clearInterval(interval)
      openStreams.delete(close)
    })
  })

  /**
   * GET /api/v1/locations/:routeId/eta
   * ETA worker'ının son hesapladığı durak bazlı varış süreleri.
   */
  fastify.get(
    '/:routeId/eta',
    { schema: getEtaSchema, onRequest: [fastify.requireRole(['company_admin'])] },
    async (request, reply) => {
      const raw = await fastify.redis.get(
        etaKey(request.user.companyId, request.params.routeId),
      )
      if (!raw) return reply.notFound('Bu güzergah için güncel ETA yok')
      return JSON.parse(raw)
    },
  )
}
