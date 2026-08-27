# ShuttlePing — TODO / Proje Durumu

Son güncelleme: 2026-07-09

## Yapılanlar ✅

Tüm geliştirme fazları kod tarafında tamamlandı — detaylı faz listesi için `CLAUDE.md`'ye bak.

- Faz 1 — Backend temeli: Fastify + JWT auth, migration'lar, multi-tenant CRUD (companies/users/vehicles/routes/stops/passengers)
- Faz 2 — Android sürücü uygulaması: **iptal**, mobil app yapılmayacak (`public/driver.html` web istemcisi yeterli)
- Faz 3 — ETA motoru: BullMQ worker, Distance Matrix + haversine fallback, dedup
- Faz 4 — Bildirim servisi: Telegram Bot API + Netgsm SMS entegrasyonu (gerçek adapter'lar, stub değil)
- Faz 5 — Admin panel: React (Türkçe UI)
- Faz 6 — Canlı harita + SSE takip sayfası
- Faz 7 — Sefer geçmişi + monitoring + pg_dump yedekleme
- Faz 8 — Faturalama: manuel ödeme takibi (elden/IBAN, gateway yok)

75/75 test yeşil, lint temiz.

## Bu oturumda tamamlanan kurulum adımları (2026-07-09)
- [x] Lokal dev ortamı: Docker kuruldu, `docker-compose up -d` + `npm run migrate:up` + `npm test` sorunsuz
- [x] `.env` dosyası `.env.example` ile senkronize edildi (Faz 3/4 değişkenleri eksikti)
- [x] Telegram bot oluşturuldu (`@ShuttlePingBot`), token doğrulandı ve `.env`'e yazıldı
- [x] Google Maps Distance Matrix API key alındı, sadece bu API'ye kısıtlandı, `.env`'e yazıldı
- [x] Prod JWT secret'ları üretildi (Railway kurulumunda kullanılacak, henüz oraya girilmedi)
- [x] `build:admin` script'i düzeltildi — Railway build'inde admin bağımlılıklarını (`npm --prefix admin ci`) atlıyordu, artık build komutuna dahil
- [x] Lokal uçtan uca test: super_admin → şirket → route/durak/araç/sürücü/yolcu → konum ingest → ETA hesaplama → **gerçek Telegram bildirimi başarıyla gönderildi** (`notification_logs`: `status: sent`)

## Pilot öncesi kritik bulgular 🔴 (2026-08-27 kod incelemesi — detay: `docs/PILOT-READINESS.md`)
- [ ] **K-1: Her konum sinyali Google'a fatura yazıyor** — 10 sn'lik ping başına tüm duraklara trafikli Distance Matrix sorgusu; kısma/önbellek/geçilen durak elemesi yok. 3 güzergahlık 1 haftalık pilot ≈ $864, trial kredisini bitirir
- [ ] **K-2: Sürücü 15 dakika sonra yayından düşüyor** — `driver.html` `/auth/refresh` çağırmıyor, 401'de yayını durduruyor; servis hattı 45-60 dk sürüyor
- [ ] **K-3: Telefon kilitlenince konum akışı susuyor** — Wake Lock yok, sekme arka plana düşünce `watchPosition` askıya alınıyor
- [ ] R-1: Dedup 45 dk — aynı demo/sefer ikinci kez bildirim üretmiyor, test ve sunum tekrarını engelliyor
- [ ] R-2: Dry-run modu yok — test yapmak gerçek yolcuya gerçek mesaj göndermek demek
- [ ] R-3: `/auth/login`'de hız sınırı yok (`@fastify/rate-limit` kayıtlı değil)
- [ ] R-4: SSE access token'ı `?token=` ile taşınıyor, erişim loglarına düşüyor
- [ ] R-5: Sürücü güzergahı `rows[0]` ile kararsız seçiliyor; `super_admin` canlı haritayı açamıyor; bildirim metninde şirket adı/takip linki yok; yolcuya açık takip sayfası hiç yok

## Bekleyen adımlar 📋 (`docs/SENIN-ADIMLARIN.md`'de detaylı anlatım var)
- [ ] **Netgsm SMS hesabı** — kullanıcı kararıyla en sona bırakıldı; başvuru onayı günler sürebileceği için erkenden başlatılması öneriliyor
- [ ] **Railway kurulumu** — trial bitti, devam etmek için Hobby plan ($5/ay) + kart bağlama kararı kullanıcıda; karar verilince proje + Postgres + Redis + env değişkenleri + build/deploy ayarları yapılacak
- [ ] Railway'e bağlı: ilk prod super_admin, ilk gerçek şirket kurulumu, prod yedekleme zamanlaması (Railway cron / GitHub Actions kararı)
- [ ] (Opsiyonel iyileştirme fikri, henüz backlog'da) Telegram `/start` webhook'u — yolcu chat ID'sini `getUpdates` ile manuel çekmek yerine otomatik panele düşürmek

## Ürün / satış kararları 💡 (mutabık kalınan)
- MVP: **SMS varsayılan + canlı takip linki + Telegram opsiyonu** — yolcuya app indirtme yok
- Fiyatlama: yolcu başına aylık; SMS maliyeti fiyata gömülür (200 yolcu ≈ 8.800 SMS/ay)
- Yolcu mobil app'i: ilk 3-5 müşteriden sonra, push adapter'ı olarak (bkz. Faz 8 notu, `notifications` dispatcher'a eklenecek)
- Kurumsal satış öncesi KVKK dosyası (DPA + aydınlatma metni) hazırlanacak
