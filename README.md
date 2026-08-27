# ShuttlePing 🚌

**Servis Takip & Bildirim Sistemi** — a multi-tenant SaaS platform that automatically notifies passengers (via Telegram or SMS) when their company shuttle is approaching their stop. Each company subscribes independently and all data is isolated per tenant.

## How it works

1. A driver opens the lightweight web driver page (`public/driver.html`) and shares live location.
2. The backend computes each passenger's ETA — Google Maps Distance Matrix when an API key is configured, with a haversine fallback otherwise.
3. When the shuttle gets close, a notification job is queued and delivered over Telegram Bot API or Netgsm SMS.
4. Company staff manage routes, vehicles, drivers and passengers from a React admin panel with a live map.

## Tech stack

| Layer | Technology |
|-------|------------|
| HTTP API | Fastify v4 + JSON Schema (Ajv) validation |
| Database | PostgreSQL (pg-pool, node-pg-migrate) |
| Job queue | BullMQ + Redis (AOF persistence) |
| Auth | JWT access tokens (15 min) + opaque refresh tokens (7 days, HttpOnly cookie) |
| Notifications | Telegram Bot API, Netgsm SMS |
| Admin UI | React + Vite (live map, companies, routes, vehicles, passengers) |
| Logging | Pino structured JSON |
| Hosting | Railway (staging + production, zero-downtime deploys) |

## Development

```bash
npm install
docker-compose up -d          # PostgreSQL + Redis for local development
cp .env.example .env          # fill in the required variables
npm run migrate:up
npm run dev                   # API with auto-restart

cd admin && npm install && npm run dev   # admin panel on :5173, proxied to /api
```

## Testing & linting

```bash
npm test         # Vitest suite
npm run lint
```
