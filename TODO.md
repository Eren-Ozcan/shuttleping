# ShuttlePing — TODO / Proje Durumu

Son güncelleme: 2026-08-27

## Yapılanlar ✅

Tüm geliştirme fazları kod tarafında tamamlandı — detaylı faz listesi için `CLAUDE.md`'ye bak.

- Faz 1 — Backend temeli: Fastify + JWT auth, migration'lar, multi-tenant CRUD (companies/users/vehicles/routes/stops/passengers)
- Faz 2 — Android sürücü uygulaması: **iptal**, mobil app yapılmayacak (`public/driver.html` web istemcisi yeterli)
- Faz 3 — ETA motoru: BullMQ worker, Routes API + haversine fallback, dedup
- Faz 4 — Bildirim servisi: Telegram Bot API + Netgsm SMS entegrasyonu (gerçek adapter'lar, stub değil)
- Faz 5 — Admin panel: React (Türkçe UI)
- Faz 6 — Canlı harita + SSE takip sayfası
- Faz 7 — Sefer geçmişi + health endpoint'leri + pg_dump yedekleme
- Faz 8 — Faturalama: manuel ödeme takibi (elden/IBAN, gateway yok)

144/144 test yeşil, lint temiz, CI kurulu.

## Bu oturumda tamamlanan kurulum adımları (2026-07-09)
- [x] Lokal dev ortamı: Docker kuruldu, `docker-compose up -d` + `npm run migrate:up` + `npm test` sorunsuz
- [x] `.env` dosyası `.env.example` ile senkronize edildi (Faz 3/4 değişkenleri eksikti)
- [x] Telegram bot oluşturuldu (`@ShuttlePingBot`), token doğrulandı ve `.env`'e yazıldı
- [x] Google Maps Distance Matrix API key alındı, sadece bu API'ye kısıtlandı, `.env`'e yazıldı
- [x] Prod JWT secret'ları üretildi (Railway kurulumunda kullanılacak, henüz oraya girilmedi)
- [x] `build:admin` script'i düzeltildi — Railway build'inde admin bağımlılıklarını (`npm --prefix admin ci`) atlıyordu, artık build komutuna dahil
- [x] Lokal uçtan uca test: super_admin → şirket → route/durak/araç/sürücü/yolcu → konum ingest → ETA hesaplama → **gerçek Telegram bildirimi başarıyla gönderildi** (`notification_logs`: `status: sent`)

## Pilot öncesi kritik bulgular ✅ (2026-08-27 kod incelemesi — plan: mimari düzeltme A–G)

Tamamı kapatıldı. Detaylı gerekçe için `docs/PILOT-READINESS.md` ve git geçmişi.

- [x] **K-1: Her konum sinyali Google'a fatura yazıyordu** → Routes API'ye geçildi;
      yalnızca geçilmemiş duraklar sorulur, rota başına adaptif throttle (45 sn yakın /
      300 sn uzak), hareket eşiği, 10 km üstü haversine, günlük element bütçesi.
      Beklenen düşüş ~%95. Kalan aksiyon **sende**: Cloud Console'da "Routes API"yi
      etkinleştir (bkz. `docs/SENIN-ADIMLARIN.md` Adım 3)
- [x] **K-2: Sürücü 15 dakika sonra yayından düşüyordu** → 12 dk'da bir sessiz
      `/auth/refresh`, 401'de tek retry
- [x] **K-3: Telefon kilitlenince konum akışı susuyordu** → Wake Lock, 30 sn heartbeat,
      90 sn'de "bağlantı koptu" rozeti, localStorage offline buffer
- [x] R-1: 45 dk dedup → sefer modeli. Dedup artık `trip_notifications` (trip_id,
      passenger_id); aynı gün ikinci sefer normal bildirir, Redis flush'a dayanıklı
- [x] R-2: Dry-run modu → `NOTIFICATION_DRY_RUN` + şirket bazında `companies.dry_run`;
      `NOTIFICATION_TEST_CHAT_ID` ile tek hesaba yönlendirme
- [x] R-3: Hız sınırı → `@fastify/rate-limit`, kullanıcı bazlı anahtar, Redis sayaç
- [x] R-4: SSE token'ı URL'de → tek kullanımlık 60 sn'lik bilet; access token URL'e girmez
- [x] R-5: Kararsız güzergah seçimi → sefer başlatmada deterministik.
      `super_admin` artık kiracı verisini salt-okunur görebiliyor (`?companyId=`)

### Kapatılan ek bulgular (kod incelemesinde çıkan, dokümanda olmayanlar)
- [x] Askıya alma harcamayı durdurmuyordu — `overdue`/`suspended` artık ETA sorgusunu,
      bildirimi ve konum ingest'i gerçekten kesiyor; refresh token'lar iptal ediliyor
- [x] `deleteAllUserTokens` ölü koddu — şifre değişimi/pasifleştirme oturumları düşürüyor
- [x] `next_due_date` hiç okunmuyordu — saatlik iş vadesi geçeni `overdue` yapıyor
- [x] Ödeme geçmişi yoktu — `company_payments` defteri (tutar, dönem, kaydeden, not)
- [x] `companies.is_active` girişte kontrol edilmiyordu
- [x] Canlı harita 15 dk sonra sessizce ölüyordu — biletle yeniden abone oluyor
- [x] Tenant tutarlılığını hiçbir şey zorlamıyordu — bileşik FK'lar eklendi
- [x] `location_history` hiç temizlenmiyordu — 90 gün saklama + günlük temizlik
- [x] CSP kapalıydı, admin token `localStorage`'daydı — CSP açıldı, token belleğe alındı
- [x] Refresh token rotasyonunda hırsızlık tespit edilemiyordu — token ailesi + reuse detection
- [x] Netgsm şifresi query string'de gidiyordu — POST gövdesine taşındı
- [x] Çok kiracılılık izolasyonu için **hiç test yoktu** — 19 testlik matris eklendi
- [x] Testler dev veritabanına yazıyordu — ayrı `servis_takip_test`
- [x] CI yoktu, deploy config repoda yoktu, restore script'i yoktu — üçü de eklendi
      (restore yerelde tatbik edildi, tüm tablo sayıları eşleşti)

## Bekleyen adımlar 📋 (`docs/SENIN-ADIMLARIN.md`'de detaylı anlatım var)
- [ ] **Netgsm SMS hesabı** — kullanıcı kararıyla en sona bırakıldı; başvuru onayı günler sürebileceği için erkenden başlatılması öneriliyor
- [ ] **Railway kurulumu** — trial bitti, devam etmek için Hobby plan ($5/ay) + kart bağlama kararı kullanıcıda; karar verilince proje + Postgres + Redis + env değişkenleri + build/deploy ayarları yapılacak
- [ ] **Google Cloud'da "Routes API"yi etkinleştir** — kod legacy Distance Matrix'ten
      Routes API'ye geçti; etkinleştirilmezse sistem sessizce haversine'e düşer
      (canlı haritada "kaba tahmin" uyarısı ve `/health/deep` ile görülebilir)
- [ ] Railway'e bağlı: ilk prod super_admin, ilk gerçek şirket kurulumu, prod yedekleme zamanlaması (Railway cron / GitHub Actions kararı)
- [x] Telegram `/start` webhook'u (T2.3) — davet kodu akışı eklendi: her yolcuya
      `invite_code` üretiliyor, panelde gösteriliyor, yolcu bota "/start KOD"
      yazınca `telegram_chat_id` otomatik bağlanıyor. Prod'da tek seferlik
      `npm run telegram:set-webhook -- https://<domain>` çalıştırılması gerekiyor
      (HTTPS domain'e bağlı — Railway kurulumunu bekliyor)
- [x] KVKK aydınlatma metni + açık rıza akışı (T2.4, taslak) —
      `docs/KVKK-AYDINLATMA-METNI.md` / `public/kvkk-aydinlatma-metni.html`
      taslağı yazıldı; yolcu API'si artık `consentGiven:true` olmadan kayıt
      kabul etmiyor (`passengers.consent_given_at`/`consent_version`).
      Kalan: metindeki [ŞİRKET ADI] vb. alanların doldurulması ve hukuki onay
      — bu kullanıcıda. Netgsm SMS başlık başvurusu kurumsal hesap/imza
      gerektirdiği için yapılamadı, kullanıcıda kalıyor

## Ürün / satış kararları 💡 (mutabık kalınan)
- MVP: **SMS varsayılan + canlı takip linki + Telegram opsiyonu** — yolcuya app indirtme yok
- Fiyatlama: yolcu başına aylık; SMS maliyeti fiyata gömülür (200 yolcu ≈ 8.800 SMS/ay)
- Yolcu mobil app'i: ilk 3-5 müşteriden sonra, push adapter'ı olarak (bkz. Faz 8 notu, `notifications` dispatcher'a eklenecek)
- Kurumsal satış öncesi KVKK dosyası (DPA + aydınlatma metni) hazırlanacak
