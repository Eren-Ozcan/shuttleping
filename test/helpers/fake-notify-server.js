/**
 * Fake Telegram/Netgsm HTTP server (T0.6).
 *
 * Unlike stubbing global fetch (test/services/notifications.test.js), this is
 * a real HTTP server on localhost — it lets a test run the actual adapters
 * (src/services/notifications/telegram.js, sms.js) and even the real BullMQ
 * worker end to end, exercising real timeouts and retry/backoff instead of a
 * mocked promise. Point the adapters at it via env.TELEGRAM_API_BASE /
 * env.NETGSM_API_BASE.
 *
 * Behavior is scripted per recipient (chat_id for Telegram, gsmno for
 * Netgsm): 'ok' | 403 | 429 | 'timeout' | a Netgsm error code string. Every
 * request actually received is recorded so a test can assert on the sent text.
 */
import { createServer } from 'node:http'

export function createFakeNotifyServer() {
  const behaviors = new Map() // recipient -> 'ok' | number | 'timeout' | netgsm code string
  const requests = []

  function setBehavior(recipient, behavior) {
    behaviors.set(recipient, behavior)
  }

  function getRequests() {
    return requests
  }

  function reset() {
    behaviors.clear()
    requests.length = 0
  }

  async function readBody(req) {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    return Buffer.concat(chunks).toString('utf8')
  }

  const server = createServer(async (req, res) => {
    const body = await readBody(req)

    if (req.url.startsWith('/bot')) {
      // Telegram: POST /bot<token>/sendMessage, JSON body { chat_id, text }
      const payload = JSON.parse(body || '{}')
      requests.push({ channel: 'telegram', url: req.url, ...payload })

      const behavior = behaviors.get(String(payload.chat_id)) ?? 'ok'
      if (behavior === 'timeout') return // never respond — the client's AbortSignal fires
      if (behavior === 'ok') {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ ok: true }))
      }
      const status = Number(behavior)
      res.writeHead(status, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ ok: false, description: `fake_${status}` }))
    }

    if (req.url.startsWith('/sms/send/get')) {
      // Netgsm: POST, application/x-www-form-urlencoded, plain-text "<code> <id>" response
      const params = new URLSearchParams(body)
      const gsmno = params.get('gsmno')
      requests.push({
        channel: 'sms',
        gsmno,
        message: params.get('message'),
        url: req.url,
      })

      const behavior = behaviors.get(gsmno) ?? 'ok'
      if (behavior === 'timeout') return
      res.writeHead(200, { 'content-type': 'text/plain' })
      if (behavior === 'ok') return res.end('00 12345')
      return res.end(`${behavior} 0`)
    }

    res.writeHead(404)
    res.end()
  })

  return {
    server,
    setBehavior,
    getRequests,
    reset,
    async start() {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address()
      return {
        telegramBase: `http://127.0.0.1:${port}`,
        netgsmBase: `http://127.0.0.1:${port}`,
      }
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
