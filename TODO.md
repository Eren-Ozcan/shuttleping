# ShuttlePing — TODO / Proje Durumu

Son güncelleme: 2026-07-06

## Yapılanlar ✅

### Faz 1 — Backend temeli (tamamlandı, DB doğrulaması bekliyor)
- [x] Fastify + JWT auth (login / refresh rotation / logout)
- [x] Migration 001 — companies, users, refresh_tokens
- [x] Migration 002 — vehicles, routes, stops (sıralı, lat/lng), passengers (bildirim kanalı tercihi)
- [x] Companies CRUD (super_admin)
- [x] Users CRUD — company_admin kendi şirketinde driver/admin yönetir
- [x] Vehicles CRUD (plaka unique, soft delete)
- [x] Routes CRUD + nested stops + sürücü/araç ataması
- [x] Passengers CRUD (durağa bağlı, telegram/sms kanal tercihi, notify_before_minutes)
- [x] POST /api/v1/locations — sürücü konum gönderir → Redis (TTL 5 dk); GET ile admin son konumu okur
- [x] Bildirim kanal soyutlaması — `src/services/notifications/` dispatcher + telegram/sms adapter (stub)
- [x] 32 test (30 yeşil), lint temiz
- [x] Bug fix: companies response'unda isActive/createdAt dönmüyordu; coerceTypes querystring filtrelerini bozuyordu; ESLint node globals eksikti
- [x] `.env` oluşturuldu (dev secrets)

## Engel 🔴
- [ ] **Docker Desktop kur** (Windows 11 Home → WSL2 backend zorunlu; gerekirse `wsl --update`)
- [ ] Sonra: `docker-compose up -d` → `npm run migrate:up` → `npm test` (kalan 2 kırmızı test DB olmadığı için 500 dönüyor, kod hatası değil)

## Yapılacaklar 📋 (öncelik sırasıyla)

### Faz 3 — ETA motoru
- [ ] BullMQ worker: konum güncellemesi → Haversine ön filtre → durak yakınında tek Distance Matrix çağrısı + Redis cache (Google maliyetini 10-50x düşürür)
- [ ] Yolcunun `notify_before_minutes` eşiği geçilince bildirim job'ı kuyruğa at
- [ ] Aynı sefer içinde tekrar bildirim göndermeme (dedup) mantığı

### Faz 4 — Bildirim entegrasyonları
- [ ] Telegram Bot API gerçek entegrasyonu (`src/services/notifications/telegram.js` stub'ını doldur)
- [ ] Netgsm SMS gerçek entegrasyonu (`sms.js` stub'ını doldur)
- [ ] SMS içine canlı takip linki ekle

### Faz 6 — Canlı harita (öne çekildi; satış stratejisinin parçası)
- [ ] SSE endpoint — Redis'teki konumu yayınla (app de aynı endpoint'i kullanacak)
- [ ] Tarayıcıda açılan takip sayfası (yolcu app kurmadan haritayı görür)

### Sonrası
- [ ] Faz 5 — React admin panel (Türkçe)
- [ ] Faz 2 — Android sürücü uygulaması (foreground service + pil muafiyeti kritik)
- [ ] Faz 7 — Sefer geçmişi + monitoring + pg_dump yedekleme
- [ ] Faz 8 — Faturalama + Play Store; yolcu mobil app'i = notifications dispatcher'a `push` adapter'ı eklemek

## Ürün / satış kararları 💡 (mutabık kalınan)
- MVP: **SMS varsayılan + canlı takip linki + Telegram opsiyonu** — yolcuya app indirtme yok
- Fiyatlama: yolcu başına aylık; SMS maliyeti fiyata gömülür (200 yolcu ≈ 8.800 SMS/ay)
- Yolcu mobil app'i: ilk 3-5 müşteriden sonra, push adapter'ı olarak
- Kurumsal satış öncesi KVKK dosyası (DPA + aydınlatma metni) hazırlanacak
