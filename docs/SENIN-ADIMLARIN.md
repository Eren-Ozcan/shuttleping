# Senin Yapman Gereken Adımlar

Kod tarafı hazır — aşağıdakiler hesap açma / anahtar alma / karar gerektirdiği
için sende. Sırayla gidebiliriz; her adımı bitirdiğinde değerleri `.env`
dosyasına (prod'da Railway environment'ına) girmen yeterli.

## 1. Telegram botu oluştur ✅ Tamamlandı (2026-07-09)
Bot oluşturuldu: `@ShuttlePingBot`, token `.env`'e yazıldı ve doğrulandı
(`getMe` ile test edildi). Test yolcusu (Mustafa Erdem) `/start` yazdı,
chat ID alındı, lokal E2E testte gerçek Telegram bildirimi başarıyla
gönderildi (`notification_logs` → `status: sent`).

Kalan iş: her yeni yolcu için chat ID alma süreci hâlâ manuel
(yolcu **/start** yazar → `getUpdates` ile chat ID çekilir → panelde
"Telegram Chat ID" alanına girilir). Otomatikleştiren bir `/start`
webhook'u backlog'da (`TODO.md`), istenirse yazılabilir.

## 2. Netgsm hesabı (SMS) ⏸️ Kullanıcı kararıyla sona bırakıldı
1. netgsm.com.tr'den kurumsal hesap aç
2. **Mesaj başlığı** (gönderici adı, örn. SHUTTLEPING) başvurusu yap — onay birkaç gün sürebilir
3. `.env`'e gir: `NETGSM_USERCODE=...`, `NETGSM_PASSWORD=...`, `NETGSM_MSGHEADER=...`
> Not: Onay süreci günler sürebildiği için başvurunun erkenden yapılması
> öneriliyor — kablolama/test en sona bırakılabilir ama başvuru şimdiden
> başlatılabilir.

## 3. Google Maps API anahtarı (ETA hassasiyeti) ✅ Tamamlandı (2026-07-09)
Google Cloud projesi açıldı (Free Trial, ₺13.988 kredi, Ekim 2026'ya kadar
geçerli), Distance Matrix API etkinleştirildi, key oluşturuldu ve sadece
Distance Matrix API'ye kısıtlandı (Application restrictions: None,
API restrictions: sadece Distance Matrix API). `.env`'e yazıldı, hem
tekil curl testiyle hem lokal E2E testte gerçek trafik verisiyle
(Sultanahmet → Taksim, 19 dk) doğrulandı.

## 4. Prod JWT secret'ları üret ✅ Tamamlandı (2026-07-09)
Üretildi, Railway kurulumunda (Adım 5) environment variable olarak
girilecek — henüz Railway'e girilmedi çünkü o adım bekliyor.
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 5. Railway kurulumu (canlıya alma) ⏸️ Ödeme kararı bekliyor
Trial bitti — devam etmek için Hobby plan ($5/ay) + kart bağlama gerekiyor,
bu kullanıcı kararı, henüz verilmedi. Karar verilince aşağıdaki adımlar
uygulanacak. Not: `build:admin` script'i düzeltildi (`npm --prefix admin ci`
eksikti, build sırasında admin panel bağımlılıkları kurulmuyordu) — Railway
build command'ı artık ek bir nixpacks config'e gerek kalmadan çalışır.
1. railway.app → New Project → **Deploy from GitHub repo** → `Eren-Ozcan/shuttleping`
2. Projeye **PostgreSQL** ve **Redis** ekle (Add Service → Database) —
   `DATABASE_URL` ve `REDIS_URL` otomatik enjekte edilir
3. Environment Variables: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (adım 4),
   `NODE_ENV=production` + adım 1-3'teki anahtarlar (hazır olanlar)
4. Settings → Deploy:
   - Build command: `npm ci && npm run build:admin`
   - Pre-deploy command: `npm run migrate:up`
   - Start command: `npm start`
   - Health check path: `/health`
5. Domain: Railway'in verdiği `*.up.railway.app` domain'i HTTPS'lidir —
   sürücü sayfası (geolocation) HTTPS zorunlu olduğu için bu önemli
6. Staging istiyorsan aynı repo'dan ikinci bir Railway environment aç

## 6. İlk super_admin kullanıcısı (tek seferlik)
Bu akış (super_admin → şirket → admin → route/durak/araç/sürücü/yolcu →
konum → bildirim) 2026-07-09'da lokal veritabanında uçtan uca test edildi
ve çalıştığı doğrulandı — prod'da (Railway) aynı adımları tekrarlaman
yeterli. Lokal test verisi (`test-admin@shuttleping.local` ve bağlı test
şirketi/kullanıcıları) dev veritabanında duruyor, istersen temizlenir.

Panelden oluşturulamaz (yumurta-tavuk). Şifre hash'ini üret:
```bash
node -e "import('bcrypt').then(async b => console.log(await b.default.hash('SIFRENI-BURAYA-YAZ', 10)))"
```
Sonra veritabanında çalıştır (yerelde: `docker exec -it servistakip-postgres-1 psql -U postgres -d servis_takip`, prod'da Railway'in Postgres konsolu):
```sql
INSERT INTO users (company_id, email, password_hash, role, full_name)
VALUES (NULL, 'senin@mailin.com', '<HASH>', 'super_admin', 'Eren Özcan');
```

## 7. İlk şirketi kur (panelden — 2 dk)
1. `http://localhost:3000/admin/` (veya prod URL) → super_admin ile giriş
2. **Şirketler** → şirket ekle
3. Aynı sayfadan **Şirket Yöneticisi Ekle** ile şirketin admin'ini oluştur
4. Şirket admin'i girip güzergah/durak/araç/sürücü/yolcu tanımlar
5. Sürücü telefonunda `https://<domain>/driver.html` açıp giriş yapar → **Yayına Başla**

## 8. Prod yedekleme zamanlaması
Yerelde `npm run backup` çalışıyor. Prod için önerim: Railway cron
(veya GitHub Actions scheduled workflow) ile günlük `pg_dump`.
Karar verirsen workflow dosyasını ben yazarım.

## 9. Faz 8: Faturalama (tamamlandı)
Ödeme elden/IBAN alınacağı için gateway entegrasyonu yapılmadı. Bunun yerine
panelde (Şirketler sayfası) her şirket için "Ödeme Güncel / Gecikmiş" durumu,
son ödeme tarihi ve son vade tarihi tutuluyor. super_admin "Ödeme Alındı"
butonuyla işaretliyor (vade otomatik +30 gün ileri atılıyor). Şirket
"Gecikmiş" olarak işaretlenirse o şirketin company_admin/driver girişleri
(login + refresh) otomatik olarak 402 ile reddedilir — super_admin
kendi girişini her zaman yapabilir.

---
*Bu dosya proje ilerledikçe güncellenir. Bir adımı bitirince işaretleyip bana "adım X tamam" demen yeterli — kalan entegrasyonu ben bağlarım.*
