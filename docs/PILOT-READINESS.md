# ShuttlePing — Pilot Hazırlık ve Test Planı

> **DURUM NOTU (2026-08-27).** Bu doküman 2026-08-27'deki kod incelemesiyle yazıldı ve
> aynı gün mimari düzeltme planı (A–G fazları) uygulandı. Aşağıdaki **K-1..K-3 ve R-1..R-5
> bulgularının tamamı kapatıldı**; T0/T1 backlog kalemlerinin çoğu da hayata geçti.
> Güncel durum için `TODO.md`'ye bak — orada hangi bulgunun nasıl kapatıldığı tek tek yazılı.
>
> Bu dosyanın **hâlâ geçerli** olan kısmı: test matrisi (A/B/C/D/E/F/H/J/K/M suitleri) ve
> go/no-go eşikleri. Onlar pilot günü izlenecek.
>
> **GÜNCELLEME (2026-09-02).** T0.2/T0.3/T0.4 yazıldı ve yerelde uçtan uca
> doğrulandı: `npm run seed:demo`, `npm run demo:drive`, `npm run demo:reset`.
> Ayrıca `npm run create:super-admin` (elle bcrypt + INSERT adımının yerine),
> `npm run telegram:chat-id` (yolcunun chat ID'sini getUpdates ile bulur) ve
> `scripts/drive-phone.js` (`npm run demo:phone`) eklendi.
>
> `drive-phone.js` Katman 1'i sahte konum uygulaması olmadan çözüyor: USB'deki
> telefonun Chrome'una DevTools protokolü ile bağlanıp `Emulation.setGeolocationOverride`
> besliyor, gerçek `driver.html` istemcisini sürüyor. 2026-09-02'de cloudflared
> tüneli üzerinden uçtan uca doğrulandı (11 ping, ETA 5 dk'da tek `sent` bildirim).
> Not: `Browser.grantPermissions` Android Chrome'da desteklenmiyor — site konum
> iznine ilk seferinde telefondan bir kez dokunmak gerekiyor.
>
> Bu dosyada adı geçip **hâlâ var olmayan** dosyalar: `public/debug.html`,
> `public/track.html`, `test/helpers/fake-notify-server.js` (T0.5, T0.6).
> Bunlara ait komut örnekleri çalışmaz.
>
> Var olan ve kullanılabilir olanlar: `npm run backup`, `npm run restore`,
> `NOTIFICATION_DRY_RUN` / `NOTIFICATION_TEST_CHAT_ID` (dry-run modu, T0.1 karşılığı).

Bir şirkete sunum yapmak ve bir haftalık deneme (pilot) koşmak için gereken
hazırlık. Bulguların tamamı `1e9b07f` üzerinde kod okunarak doğrulandı.

Görsel sürüm: https://claude.ai/code/artifact/9593bf5e-791c-41c2-b216-155b89ad93db

Durum özeti: Faz 1–8 kodda tamamlandı, 75/75 test yeşil. Sahaya çıkmayı
engelleyen 3 kritik bulgu, testi engelleyen 3 bulgu var.

---

## 1. Bulgular

### K-1 — Her konum sinyali Google'a fatura yazıyor (kritik)

Sürücü 10 saniyede bir konum gönderiyor (`public/driver.html:64`), her gönderim
bir ETA job'ı kuyruğa atıyor (`src/routes/v1/locations/index.js:62`), her job
Distance Matrix'e **tüm duraklar için** trafikli sorgu atıyor
(`src/services/eta/distance.js:35`). Arada önbellek, kısma veya geçilen durak
elemesi yok.

8 duraklı tek güzergah, trafikli sorgu (~$10 / 1.000 element):

| Kapsam | Sorgu | Element | Tahmini maliyet |
|---|---:|---:|---:|
| 1 saat yayın | 360 | 2.880 | ≈ $29 |
| 1 gün (sabah + akşam) | 720 | 5.760 | ≈ $58 |
| 1 hafta pilot, 1 güzergah | 3.600 | 28.800 | ≈ $288 |
| 1 hafta pilot, 3 güzergah | 10.800 | 86.400 | ≈ $864 |

Trial kredisi (₺13.988) tek haftalık üç güzergahlık pilotta biter.

Çözüm üçlü: güzergah başına ETA'yı en fazla 45–60 sn'de bir hesapla (Redis zaman
damgası), sadece henüz geçilmemiş duraklara sor, kuş uçuşu 10 km'den uzak
durakları haversine ile geç. Element sayısı yaklaşık 20 kat düşer.

### K-2 — Sürücü 15 dakika sonra yayından düşüyor (kritik)

Access token ömrü 15 dakika (`src/config/env.js:28`). `driver.html` token'ı
sadece giriş anında alıyor, `/auth/refresh` çağrısını hiç yapmıyor; 401 gelince
yayını durduruyor (`public/driver.html:143`). Servis hattı 45–60 dakika sürer,
yani her sürücü 15. dakikada sessizce yayından düşer.

Çözüm: `driver.html` içinde token süresi dolmadan (12 dakikada bir, ayrıca 401
alınca bir kez) `POST /api/v1/auth/refresh`. Refresh cookie zaten aynı origin'de
ve `path=/api/v1/auth` ile duruyor. Refresh başarısızsa yayını durdurmadan önce
3 kez denenmeli.

### K-3 — Telefon kilitlenince konum akışı susuyor (kritik)

Sayfa yalnızca `navigator.geolocation.watchPosition` kullanıyor
(`public/driver.html:105`); Wake Lock yok, sekme arka plana düşünce tarayıcı
konum güncellemelerini askıya alıyor. Faz 2 (mobil uygulama) iptal edildiği için
tek konum kaynağı bu sayfa.

Çözüm: `navigator.wakeLock.request('screen')` + sekme geri geldiğinde otomatik
yeniden alma, konum gelmese bile 30 sn'de bir canlılık sinyali, panelde son
sinyal 90 sn'den eskiyse "sürücü bağlantısı koptu" rozeti.

### R-1 — Aynı demo 45 dakika içinde tekrarlanamıyor

Dedup anahtarı 2700 saniye yaşıyor (`ETA_DEDUP_TTL_SECONDS`,
`src/config/env.js:36`; `src/services/eta/index.js:20,83`). Sunumda ilk deneme
çalışır, "bir daha gösterir misin" denince hiçbir şey olmaz. Aynı sebep, bir
güzergah aynı durağa 45 dk içinde iki kez uğradığında ikinci geçişte bildirim
gitmemesine yol açar.

### R-2 — Test yapmak gerçek yolcuya gerçek mesaj atmak demek

Kuru çalıştırma (dry-run) modu yok; bildirim worker'ı doğrudan Telegram/Netgsm'e
gidiyor (`src/workers/notification.worker.js:26`). `NOTIFICATION_DRY_RUN` ve
`NOTIFICATION_TEST_CHAT_ID` eklenmeden saha testi yapılamaz.

### R-3 — Girişte hız sınırı yok

`src/app.js:40-42` helmet ve cors kaydediyor, `@fastify/rate-limit` yok.
`/auth/login` sınırsız denemeye açık.

### R-4 — SSE token'ı adres satırında gidiyor

EventSource başlık gönderemediği için access token `?token=` ile taşınıyor
(`src/routes/v1/locations/index.js:90-103`). Token proxy erişim loglarına ve
tarayıcı geçmişine düşer. Pilot için kabul edilebilir; orta vadede kısa ömürlü,
tek amaçlı ayrı bir akış token'ı gerekir.

### R-5 — Kenar durumlar

- Sürücünün güzergahı `rows[0]` ile seçiliyor, `ORDER BY` yok — bir sürücü iki
  aktif güzergaha atanırsa seçim kararsız (`src/routes/v1/locations/index.js:37`)
- `super_admin` canlı haritayı açamıyor; akış yalnız `company_admin`'e izinli
  (`src/routes/v1/locations/index.js:102`)
- Bildirim metninde şirket adı ve takip linki yok
  (`src/services/notifications/message.js:6`)
- Yolcuya açık canlı takip sayfası yok; ürün kararındaki "SMS + canlı takip
  linki" vaadinin link ucu eksik

---

## 2. Yapılacaklar

Sıra bilinçli: önce ölçebilmek (T0), sonra düzeltmek (T1), sonra göstermek (T2).

### T0 — Test altyapısı (≈ 1,5 gün)

| # | İş | Neden |
|---|---|---|
| T0.1 ✅ | Kuru çalıştırma modu: `NOTIFICATION_DRY_RUN=true` → gerçek gönderim yok, `notification_logs`'a `dry_run` statüsü. `NOTIFICATION_TEST_CHAT_ID` → tüm mesajlar tek test hesabına | R-2'yi kapatır |
| T0.2 ✅ | `scripts/seed-demo.js` — tek komutla şirket + admin + sürücü + araç + gerçek İstanbul koordinatlı 8 duraklı güzergah + 1 Telegram yolcusu (Kozyatağı, 10 dk eşik); sabit UUID'ler, idempotent. Netgsm açılmadığı için SMS kanallı yolcu seed edilmiyor | Her test aynı yerden başlar |
| T0.3 ✅ | `scripts/demo-drive.js` — güzergah üzerinde sanal servis sürer, gerçek sürücü token'ıyla konum basar. Bayraklar: `--base`, `--speed`, `--kmh`, `--stop-at`, `--no-end` (`--jitter`/`--drop` yazılmadı) | Telefonsuz, tekrarlanabilir uçtan uca akış |
| T0.4 ✅ | `scripts/reset-demo.js` — dedup, `loc:`/`eta:` anahtarları ve demo bildirim kayıtlarını siler; `NODE_ENV=production`'da çalışmayı reddeder | R-1'i kapatır |
| T0.5 | `public/debug.html` test kokpiti (dev-only): son konum + yaşı, durak bazlı ETA, aktif dedup anahtarları, kuyruk derinlikleri, son 20 bildirim ve gitmediyse nedeni | "Neden bildirim gelmedi?" sorusunu log kazmadan cevaplar |
| T0.6 | `test/helpers/fake-notify-server.js` — sahte Telegram/Netgsm; 200/403/429/timeout üretir, gönderilen metni yakalar | D ve H serisi testleri otomatikleştirir |

### T1 — Engel kapatma (≈ 1,5 gün)

| # | İş | Kapattığı |
|---|---|---|
| T1.1 | ETA kısma (güzergah başına en fazla 45 sn'de bir) + geçilen durak eleme + 10 km üstü duraklar için haversine | K-1 |
| T1.2 | Sürücü oturumu kendini yeniler: 12 dakikada bir sessiz refresh, 401'de tek seferlik yeniden deneme, 3 başarısızlıkta net uyarı | K-2 |
| T1.3 | Wake Lock + 30 sn'lik kalp atışı + panelde 90 sn sessizlikte "bağlantı koptu" rozeti | K-3 |
| T1.4 | `@fastify/rate-limit` (login: IP başına 5/dk) + güzergah seçiminde `ORDER BY created_at` + `super_admin`'e canlı akış izni | R-3, R-5 |
| T1.5 | Mesaj metnine şirket adı ve kısa takip linki + `public/track.html` (imzalı, salt-okunur, süreli link) | R-5 |

### T2 — Ortam ve saha (≈ 1 gün + hesap adımları)

| # | İş |
|---|---|
| T2.1 | Telefon test ortamı (bölüm 3, Katman 1 ve 2) |
| T2.2 | Railway kurulumu + günlük `pg_dump` zamanlaması + **geri yükleme tatbikatı** |
| T2.3 | Telegram `/start` webhook'u — yolcuya özel davet kodu, chat ID otomatik eşleşir |
| T2.4 | KVKK aydınlatma metni + açık rıza akışı; SMS istenecekse Netgsm başlık başvurusu (onay günler sürer) |

---

## 3. Telefon test ortamı

### Önce iki düzeltme

**VPN işe yaramaz.** VPN yalnızca IP tabanlı konumu değiştirir. Tarayıcının
Geolocation API'si GPS ve çevredeki Wi-Fi ağlarını kullanır — VPN açıkken telefon
hâlâ gerçek konumunu bildirir. Doğru araçlar: DevTools konum geçersiz kılma
(Katman 1) veya Android sahte konum uygulaması (Katman 2).

**HTTPS zorunlu.** Geolocation yalnızca güvenli bağlamda çalışır. Telefondan
`http://192.168.1.x:3000` açılırsa konum sessizce reddedilir. Bu yüzden aşağıdaki
USB port yönlendirme adımı isteğe bağlı değil: telefonun `localhost:3000`
adresini PC'ye bağlar, `localhost` güvenli bağlam sayılır. Alternatif:
`cloudflared tunnel` ile ücretsiz gerçek HTTPS adresi.

### Katman 0 — Telefonsuz, sanal sürücü

`scripts/demo-drive.js` (T0.3) API'ye doğrudan konum basar. Deterministik,
saniyeler sürer, CI'da koşabilir.

```bash
npm run seed:demo
node scripts/demo-drive.js --route sabah-hatti --speed 10x

node scripts/demo-drive.js --jitter 30m       # GPS gürültüsü
node scripts/demo-drive.js --drop 60s         # tünelde sinyal kaybı
node scripts/demo-drive.js --stop-at Kadikoy  # durakta 3 dk bekleme
```

Kanıtlar: ETA doğruluğu, dedup, bildirim akışı, kuyruk davranışı.
Kanıtlamaz: tarayıcı, telefon, GPS, ekran kilidi, pil, şebeke.

### Katman 1 — Telefon USB'de, konum PC'den sürülür

Gerçek telefon, gerçek Chrome, gerçek `driver.html` — konumu sen belirliyorsun.

1. Telefonda: Ayarlar → Telefon hakkında → Yapı numarasına 7 kez dokun →
   Geliştirici seçenekleri → **USB hata ayıklama** açık
2. USB kabloyla PC'ye bağla, telefondaki izin uyarısını onayla
3. PC'de Chrome: `chrome://inspect/#devices` — cihaz listede görünmeli
4. **Port forwarding** (kritik adım): aynı sayfada `3000` → `localhost:3000`,
   "Enable port forwarding" işaretli
5. Telefonun Chrome'unda `http://localhost:3000/driver.html` aç
6. `chrome://inspect`'te o sekmenin **inspect** bağlantısına bas → PC'de DevTools
7. DevTools → `Ctrl+Shift+P` → "Show Sensors" → Location → Custom location:
   enlem/boylam gir. Sayfadaki `watchPosition` bunu gerçek GPS sanar
8. Sürücü hesabıyla giriş yap, "Yayına Başla"

Otomatik hareket için: DevTools'u kapatıp `puppeteer-core` ile aynı hata ayıklama
hedefine bağlan ve `Emulation.setGeolocationOverride`'ı bir çizgi boyunca
2 saniyede bir ilerlet (`scripts/drive-phone.js` olarak yazılacak).

Kanıtlar: tarayıcı davranışı, oturum yenileme (K-2), izin akışı, uçtan uca demo.
Kanıtlamaz: gerçek GPS gürültüsü, pil, şebeke geçişleri, ekran kilidi (USB
bağlıyken ekran açık kalır).

### Katman 2 — Telefon serbest, sahte GPS uygulaması

Kablo yok, DevTools yok. Ekran kilidi, pil, şebeke davranışı gerçek — K-3'ü test
edebileceğin tek katman.

1. Play Store'dan rota kaydı/oynatma özellikli bir sahte konum uygulaması kur
2. Geliştirici seçenekleri → Sahte konum uygulaması seç
3. Uygulamada güzergahı çiz, hızı gerçek servise yakın ver (25–40 km/s)
4. Telefonun Chrome'unda tünel/Railway HTTPS adresini aç (bu katmanda port
   yönlendirme yok, düz HTTP çalışmaz)
5. Yayını başlat, **telefonu kilitle, cebe koy, 45 dakika bekle** — testin amacı
   bu adım

### Katman 3 — Gerçek sürüş

Kendi arabanla, pilot şirketinin gerçek güzergahında, tek gerçek test yolcusuyla.
Bir sabah yeter ve hiçbir simülasyon yerini tutmaz: tünel, viyadük, sinyal
boşluğu, telefonun araç tutucusunda ısınması.

Sürüş sırasında `public/debug.html`'i ikinci telefondan açık tut; dönüşte
`location_history`'den izi çıkarıp gerçek varış saatleriyle ETA tahminlerini
karşılaştır. Ortalama sapma ±3 dakikanın altındaysa sistem satılabilir.

---

## 4. Test matrisi

Nasıl sütunu: OTO = otomatik test, EL = elle, SAHA = telefon/araç.
**Kalın** satırlar geçilmeden pilot başlamaz.

### A — Kimlik ve oturum

| # | Senaryo | Beklenen | Nasıl |
|---|---|---|---|
| A1 | Sürücü olmayan hesapla `driver.html` girişi | "Bu sayfa sadece sürücüler içindir", yayın açılmaz | EL |
| **A2** | `JWT_ACCESS_EXPIRES=30s` ile 10 dakika kesintisiz yayın | Tek konum kaybı olmadan devam | OTO |
| A3 | Aynı refresh cookie ile ikinci kez yenileme | 401 — rotasyon eskisini geçersiz kılmış | OTO |
| A4 | Çıkış sonrası yenileme denemesi | 401 | OTO |
| A5 | Ödemesi gecikmiş şirketin sürücüsü giriş yapar | 402; `super_admin` etkilenmez | OTO |
| A6 | Yanlış şifreyle 20 hızlı deneme | 5. denemeden sonra 429 (T1.4 sonrası) | OTO |
| A7 | Sürücü token'ıyla `GET /passengers` | 403 | OTO |
| A8 | Kurcalanmış imzalı token | 401, gövde sızıntısı yok | OTO |

### B — Konum gönderimi

| # | Senaryo | Beklenen | Nasıl |
|---|---|---|---|
| B1 | Güzergaha atanmamış sürücü yayına başlar | 404, ekranda görünür | EL |
| B2 | Yayın sürerken güzergah `is_active=false` | Sonraki gönderim 404, sürücü bilgilendirilir | EL |
| B3 | Sürücü iki aktif güzergaha atanmış | Deterministik seçim (T1.4 sonrası) | OTO |
| B4 | `lat=91`, `lng=181`, metin değerler | 400 şema hatası | OTO |
| B5 | `heading`/`speed` yok | Kabul, veritabanına `null` | OTO |
| B6 | 10 sn'lik kısma | Ağ panelinde 10 sn'den sık istek yok | EL |
| B7 | Uçak modu 2 dakika, sonra geri | Ekranda hata; şebeke gelince kendiliğinden devam | SAHA |
| B8 | Yayın durdurulur, 5 dakika beklenir | Redis TTL dolar, 404, panelde çevrimdışı | OTO |
| B9 | 1 saatlik yayın | `location_history`'de ≈360 satır | OTO |
| B10 | Aynı noktada 10 dakika duran araç | ETA sabit, tekrar bildirim yok, kuyruk şişmiyor | OTO |

### C — ETA motoru

| # | Senaryo | Beklenen | Nasıl |
|---|---|---|---|
| **C1** | 1 saatlik yayında Distance Matrix çağrı sayımı | ≤ 80 çağrı/saat/güzergah (T1.1 sonrası) | OTO |
| C2 | Anahtar tanımlı, gerçek trafik | Süre trafiği yansıtır | EL |
| C3 | `GOOGLE_MAPS_API_KEY` silinir | Haversine yedeği, çökme yok | OTO |
| C4 | Google 429 / `OVER_QUERY_LIMIT` | Uyarı loglanır, yedeğe düşer, bildirim yine gider | OTO |
| C5 | Google 10 sn'den uzun sürer | `AbortSignal.timeout` devreye girer | OTO |
| C6 | Durağı geçtikten sonra | ETA artar, bildirim tekrarlanmaz | OTO |
| C7 | Durağı olmayan güzergah | `skipped: no_stops` | OTO |
| C8 | 26 duraklı güzergah | Parçalı istek doğru birleşir, sıra korunur | OTO |

### D — Bildirim

| # | Senaryo | Beklenen | Nasıl |
|---|---|---|---|
| **D1** | ETA eşiğin altına iner | Tam bir bildirim; doğru durak ve dakika | OTO |
| **D2** | Sonraki 20 konum sinyali | İkinci bildirim yok (dedup) | OTO |
| D3 | Dedup süresi dolar, araç tekrar yaklaşır | Yeni bildirim gider | OTO |
| D4 | Aynı durakta 5/10/15 dk eşikli üç yolcu | Üçü de kendi eşiğinde, doğru sırayla | OTO |
| D5 | Telegram yolcusunun chat ID'si boş | `failed` + neden, tekrar denenmez | OTO |
| D6 | Yolcu botu engellemiş (403) | `failed`, kalıcı sayılır, kuyruk tıkanmaz | OTO |
| D7 | Telegram 429 | Geri çekilmeli yeniden deneme, sonunda gider | OTO |
| D8 | Netgsm hata kodu | `failed`, kod `notification_logs.error`'da | OTO |
| D9 | Pasif yolcu | Bildirim gitmez, kayıt açılmaz | OTO |
| D10 | Job sırasında yolcu silinir | `passenger_not_found`, çökme yok | OTO |
| **D11** | `NOTIFICATION_DRY_RUN=true` ile tam senaryo | Sıfır gerçek mesaj, kayıtlar `dry_run` | OTO |
| D12 | Türkçe karakterli durak adı | Telegram ve SMS'te bozulmadan görünür | EL |

### E — Canlı harita ve akış

| # | Senaryo | Beklenen | Nasıl |
|---|---|---|---|
| E1 | Panel açık, sürücü yayında | Araç 3 sn'de bir ilerler, ETA güncellenir | EL |
| E2 | Sunucu yeniden başlar | Akış `retry: 5000` ile kendi kendine bağlanır | EL |
| E3 | Sürücü yayını keser | 90 sn içinde "bağlantı koptu" rozeti (T1.3) | EL |
| E4 | Başka şirketin `routeId`'siyle akış | Veri gelmez | OTO |
| E5 | `super_admin` canlı haritayı açar | T1.4 sonrası görebilir | EL |
| E6 | Panel 2 saat açık | Bellek sızıntısı yok, akış canlı | EL |

### F — Çok kiracılı izolasyon

| # | Senaryo | Beklenen | Nasıl |
|---|---|---|---|
| **F1** | A şirketi admini B'nin `passengerId`'siyle okur/yazar | 404, veri sızmaz | OTO |
| **F2** | Aynısı güzergah, durak, araç, kullanıcı için | Hepsinde 404 | OTO |
| F3 | Gövdede sahte `company_id` | Yok sayılır, JWT'deki kazanır | OTO |
| F4 | B'nin güzergahının geçmiş konumları | Boş liste | OTO |
| F5 | Bildirim kayıtları | Yalnız kendi şirketininki | OTO |
| F6 | Sürücü başka şirketin güzergahına konum basar | 404 | OTO |

### H — Kaos ve dayanıklılık

| # | Senaryo | Beklenen | Nasıl |
|---|---|---|---|
| **H1** | Yayın sürerken Redis yeniden başlatılır | Uygulama toparlar. Dikkat: dedup anahtarları uçar — çift bildirim gidiyorsa kalıcı dedup gerekir | EL |
| H2 | PostgreSQL yeniden başlatılır | Havuz yeniden bağlanır, 500 yağmuru yok | EL |
| H3 | Kuyrukta iş varken süreç öldürülür | Yeniden başlayınca işlenir, kayıp yok | EL |
| H4 | Sahte Telegram 5 dakika kapalı | Kuyruk birikir, açılınca gider; ETA'sı geçmiş bildirim gitmemeli | OTO |
| H5 | Sürücü yayındayken dağıtım yapılır | Kayıp sinyal ≤ 2, yeniden giriş gerekmez | SAHA |
| H6 | Telefon saati 10 dakika ileri | Sunucu kendi zamanını kullanır | OTO |
| H7 | Gece yarısını aşan sefer / yaz saati | `TIMESTAMPTZ` doğru, geçmiş sorguları tutarlı | OTO |
| H8 | Disk/kota dolu | Yazma hatası loglanır, sessizce yutulmaz | EL |

### J — Telefon ve saha

| # | Senaryo | Beklenen | Nasıl |
|---|---|---|---|
| **J1** | Ekran kilitli, cepte, 45 dakika | Yayın kesilmez (T1.3 doğrulaması) | SAHA |
| J2 | Yayın sırasında çağrı gelir | Çağrı bitince kendiliğinden devam | SAHA |
| J3 | 1 saatlik yayının pil tüketimi | Ölç ve yaz — sürücüye söylenecek sayı | SAHA |
| J4 | Wi-Fi'dan LTE'ye geçiş | Kesintisiz | SAHA |
| J5 | Tünel / kapalı otopark | Hata ekranda, çıkınca toparlar | SAHA |
| J6 | Konum izni "yalnızca bu sefer" | Sonraki açılışta net yönlendirme | EL |
| J7 | Pil tasarrufu modu açık | Davranışı belgele; sürücü brifingine madde | SAHA |
| J8 | iPhone / Safari | `watchPosition` ve Wake Lock ayrıca doğrulanır | SAHA |
| J9 | Sürücü yayını durdurmayı unutur | 5 dk sonra çevrimdışı, boş veri birikmez | EL |
| J10 | Sekmeyi kapatıp geri açar | Yeniden giriş gerekiyorsa açıkça söyler | EL |

### K — Veri, yedek, KVKK

| # | Senaryo | Beklenen | Nasıl |
|---|---|---|---|
| **K1** | Geri yükleme tatbikatı: yedek al, boş veritabanına yükle, panelden doğrula | Veri eksiksiz. Denenmemiş yedek yedek değildir | EL |
| K2 | Günlük yedeğin zamanlanmış koşusu | Dosya oluşur, boyut makul, başarısızlıkta uyarı | EL |
| K3 | 1 haftalık `location_history` büyümesi | Aylık tahmin + saklama süresi kararı | OTO |
| K4 | "Verilerimi silin" talebi | Yolcu ve izleri için tanımlı adım var | EL |

### M — Yük ve maliyet

| # | Senaryo | Beklenen | Nasıl |
|---|---|---|---|
| M1 | 3 güzergah × 20 yolcu, 1 saat eşzamanlı | Kuyruk sıfıra döner, p95 gecikme < 2 sn | OTO |
| **M2** | Aynı koşuda Google Cloud faturası okunur | Haftalık öngörü < $20; değilse T1.1 yetersiz | EL |
| M3 | Railway bellek/CPU | Hobby sınırlarının altında, sızıntı yok | EL |

---

## 5. Deneme haftası takvimi

| Gün | İş | Kim |
|---|---|---|
| D-10 | Netgsm başlık başvurusu (SMS istenecekse), KVKK metinleri başlar | Sen |
| D-9 | T0 tamam | Kod |
| D-8 | T1 tamam | Kod |
| D-7 | A, B, C, D, E, F matrisleri otomatik koşar ve yeşile döner | Kod |
| D-6 | Katman 1 kurulur, sunum provası uçtan uca üç kez | Sen |
| D-5 | **Şirkete sunum** — sanal sürüş + canlı harita + toplantıda telefona düşen gerçek bildirim | Sen |
| D-4 | Railway kurulumu, göç, ilk `super_admin`, yedek zamanlaması + K1 tatbikatı | Sen + kod |
| D-3 | Katman 2: telefon kilitli 45 dakikalık dayanıklılık testi (J1–J5) | Sen |
| D-2 | Katman 3: gerçek güzergahta gerçek sürüş, ETA sapması ölçülür | Sen |
| D-1 | Yolcu kaydı, sürücü brifingi, KVKK rızaları | Sen |
| D+1..5 | **Pilot koşar.** Her akşam: gönderilen/başarısız bildirim, ETA sapması, kopma sayısı, Google maliyeti | Sen |
| D+6 | Yolcu ve sürücü geri bildirimi, tek sayfalık sonuç raporu | Sen |

---

## 6. Geçiş kriterleri (go / no-go)

| Kriter | Eşik |
|---|---|
| Oturum dayanıklılığı | 60 dk kesintisiz yayın, sıfır kopma |
| Ekran kilidi | 45 dk kilitli, kayıp sinyal ≤ %5 |
| ETA doğruluğu | Gerçek sürüşte ortalama sapma ≤ 3 dk |
| Bildirim başarısı | ≥ %98 `sent`, sıfır çift gönderim |
| Google maliyeti | ≤ $20 / hafta / 3 güzergah |
| Yedek | Geri yükleme tatbikatı bir kez başarılı |
| İzolasyon | F matrisi tamamen yeşil |
| KVKK | Aydınlatma + rıza akışı hazır |

---

## Nereden başlanır

T0.2 ve T0.3 (seed + sanal sürücü). İkisi birlikte yarım gün, ve o andan itibaren
her değişiklik tek komutla uçtan uca doğrulanabilir. Hemen ardından K-1 (ETA
kısma), çünkü test etmeye başladığın an fatura da işlemeye başlar.
