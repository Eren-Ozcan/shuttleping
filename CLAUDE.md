# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ShuttlePing** (Servis Takip & Bildirim Sistemi) — Multi-tenant SaaS platform that sends automatic notifications (Telegram / SMS) to passengers when their company shuttle approaches. Companies subscribe independently; all data is isolated by `company_id`.

## Commands

### Development
```bash
npm install                          # Bağımlılıkları kur

docker-compose up -d                 # PostgreSQL + Redis başlat (yerel geliştirme)

npm run migrate:up                   # Tüm migration'ları çalıştır
npm run migrate:down                 # Son migration'ı geri al
npm run migrate:create -- --name foo # Yeni migration oluştur

npm run dev                          # Dev server (--watch ile auto-restart)

cd admin && npm install && npm run dev  # Admin panel dev (5173, /api proxy'li)
npm run build:admin                  # Paneli public/admin'e derle (Fastify servis eder)
npm run backup                       # pg_dump yedeği (backups/, docker fallback'li)
npm run restore -- <dump> [--url X]  # Yedeği geri yükle (onay ister; --force ile atlanır)
```

### Testing (commit öncesi zorunlu)
```bash
npm test                             # Tüm testleri çalıştır (servis_takip_test DB)
npm run test:watch                   # Watch modu
npm run test:coverage                # Kapsam raporu
npx vitest run test/v1/auth.test.js  # Tek dosya
```

### Linting
```bash
npm run lint
```

## Architecture

### Tech Stack
| Katman | Teknoloji |
|--------|-----------|
| HTTP | Fastify v4, JSON Schema validation (Ajv) |
| Veritabanı | PostgreSQL + pg-pool, node-pg-migrate |
| Kuyruk | BullMQ + Redis (AOF persistence) |
| Auth | JWT access token (15dk) + opaque refresh token (7g, HttpOnly cookie) |
| Logger | Pino — structured JSON, no `console.log` |
| ETA | Google Routes API `computeRouteMatrix` (anahtar yoksa haversine fallback) |
| Bildirim | Telegram Bot API + Netgsm SMS |
| Admin UI | React (Türkçe) |
| Hosting | Railway (`railway.json`) — **henüz deploy edilmedi** |

### Klasör Yapısı
```
src/
  config/env.js          — Zorunlu env var'ları doğrular; eksik/geçersiz → crash
  db/
    pool.js              — pg-pool singleton
    migrations/          — node-pg-migrate dosyaları (001_, 002_, ... prefix)
  plugins/
    db.js                — fastify.db (pool) decoration
    redis.js             — fastify.redis (ioredis) decoration
    auth.js              — JWT plugin, fastify.authenticate, fastify.requireRole(roles)
  routes/v1/             — Her klasör: index.js (handler) + schema.js (JSON Schema)
  services/              — İş mantığı; route handler'lardan çağrılır
    eta/                 — ETA hesaplama (Routes API + haversine fallback)
    notifications/       — Kanal adapter'ları (telegram, sms) + dispatcher
    billing.service.js   — Şirket erişim/kota durumu (Redis cache'li)
  queues/                — BullMQ kuyrukları (eta, notifications), lazy singleton
  workers/               — Kuyruk worker'ları + periyodik bakım (terkedilmiş
                           sefer, vade, saklama süresi); server process'i içinde
  utils/logger.js        — Pino instance
admin/                   — React yönetim paneli (Vite; build → public/admin)
public/
  driver.html            — Sürücü web istemcisi (sefer başlat/bitir → konum ingest)
  driver.js              — Sürücü istemci kodu (CSP: satır içi script yok)
  admin/                 — Panel build çıktısı (gitignore'da; npm run build:admin)
test/
  helpers/app.js         — Test için buildApp() wrapper
  v1/                    — Route testleri (src/routes/v1/ yapısını yansıtır)
```

### Multi-Tenancy Kuralı
`company_id` izolasyonu **her istekte zorunlu**. `company_id` sadece JWT payload'undan (`request.user.companyId`) okunur — request body veya params'tan gelen `company_id` JWT ile eşleştirilmeden güvenilmez.

### Roller
| Rol | Kapsam |
|-----|--------|
| `super_admin` | Platform sahibi; şirket yönetimi + kiracı verisine salt-okunur destek erişimi (`?companyId=`) |
| `company_admin` | Kendi şirketi dahilinde tam yetki |
| `driver` | Konum gönderen sürücü istemcisi; kısıtlı kapsam |

## Geliştirme Kuralları
- **Soft delete:** Hiçbir kayıt fiziksel olarak silinmez → `is_active = false`
- **Timestamp:** Tüm alanlar `TIMESTAMPTZ`, default `now()` (Europe/Istanbul)
- **Primary key:** UUID v4
- **API prefix:** Her endpoint `/api/v1/` ile başlar
- **Validation:** Her route'un `schema: { body?, querystring?, params? }` olmalı
- **Logger:** Pino — `console.log` bırakma
- **Test:** Commit öncesi `npm test` yeşil olmalı. Testler ayrı bir
  veritabanına (`servis_takip_test`) yazar — dev verisine dokunmaz.
- **Sefer zorunluluğu:** Konum yalnızca aktif sefer varken kabul edilir
  (`POST /api/v1/trips/start`). Bildirim dedup'ı `trip_notifications` ile.
- **Faturalama kapısı:** Harcama üreten her yol (`eta/index.js`,
  `notification.worker.js`, konum ingest) şirket durumunu kontrol etmeli.

## Geliştirme Fazları
| Faz | İçerik | Durum |
|-----|--------|-------|
| 1 | Backend temeli — Fastify + PostgreSQL + Redis + JWT auth | ✅ Tamamlandı |
| 2 | Android sürücü uygulaması | ❌ İptal — mobil app yapılmayacak |
| 3 | ETA motoru — BullMQ + Google Maps Distance Matrix | ✅ Tamamlandı |
| 4 | Bildirim servisi — Telegram Bot + Netgsm SMS | ✅ Tamamlandı |
| 5 | Admin panel — React (Türkçe UI) | ✅ Tamamlandı |
| 6 | Canlı harita + SSE takip sayfası | ✅ Tamamlandı |
| 7 | Sefer geçmişi + health endpoint'leri + pg_dump yedekleme | ✅ Tamamlandı — gerçek monitoring/alerting yok, sadece `/health` ve `/health/deep` |
| 8 | Faturalama — manuel ödeme takibi (elden/IBAN, gateway yok) | ✅ Tamamlandı (Faz C ile genişletildi: kademeli askı, ödeme defteri, kota) |

## Pilot Öncesi Sertleştirme (Mimari Düzeltme Planı)
| Faz | İçerik | Durum |
|-----|--------|-------|
| A | Sefer (trip) modeli — trips/trip_stops/trip_notifications, sürücü start/end, geçilen durak elemesi, terkedilmiş sefer toplayıcı | ✅ Tamamlandı |
| B | ETA maliyeti — Routes API, hibrit trafik tier, throttle, günlük bütçe | ✅ Tamamlandı |
| C | Gelir koruması — kademeli askı, ödeme defteri, kota, oturum iptali | ✅ Tamamlandı |
| D | Güvenlik — rate limit, SSE ticket, CSP, token ailesi, bellek içi oturum | ✅ Tamamlandı |
| E | Veri bütünlüğü — bileşik FK, pool, retention, SSE shutdown, index bakımı | ✅ Tamamlandı |
| F | Test/ops — izolasyon testleri, ayrı test DB, dry-run, CI, deploy, restore | ✅ Tamamlandı |
| G | Dokümantasyon dürüstlüğü | ✅ Tamamlandı |

Kullanıcının (Eren) kendisinin yapacağı kurulum adımları: `docs/SENIN-ADIMLARIN.md`

## Environment Variables
`.env.example` dosyasına bak. `src/config/env.js` başlangıçta zorunlu değişkenleri kontrol eder; eksik olan varsa uygulama başlamaz. Üretimde ek kontroller var: `CORS_ORIGIN` zorunlu ve localhost/`*` olamaz, `JWT_ACCESS_SECRET` en az 32 karakter ve örnek değer içeremez. Railway'de `DATABASE_URL` ve `REDIS_URL` otomatik enjekte edilir.

`JWT_REFRESH_SECRET` **yoktur** — refresh token'lar JWT değil, opak rastgele değerlerdir ve DB'de SHA-256 hash'i saklanır.
