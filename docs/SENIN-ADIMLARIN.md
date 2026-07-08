# Senin Yapman Gereken Adımlar

Kod tarafı hazır — aşağıdakiler hesap açma / anahtar alma / karar gerektirdiği
için sende. Sırayla gidebiliriz; her adımı bitirdiğinde değerleri `.env`
dosyasına (prod'da Railway environment'ına) girmen yeterli.

## 1. Telegram botu oluştur
1. Telegram'da **@BotFather**'a yaz → `/newbot` → bota isim ve kullanıcı adı ver
2. BotFather'ın verdiği token'ı `.env` içine yaz: `TELEGRAM_BOT_TOKEN=...`
3. Yolcuların chat ID'sini almak için: yolcu botu bulup **/start** yazar,
   sonra tarayıcıda `https://api.telegram.org/bot<TOKEN>/getUpdates` açılır —
   `message.chat.id` değeri panelde yolcunun "Telegram Chat ID" alanına girilir.
   (İleride bunu otomatikleştiren bir /start webhook'u yazabilirim — istersen söyle.)

## 2. Netgsm hesabı (SMS)
1. netgsm.com.tr'den kurumsal hesap aç
2. **Mesaj başlığı** (gönderici adı, örn. SHUTTLEPING) başvurusu yap — onay birkaç gün sürebilir
3. `.env`'e gir: `NETGSM_USERCODE=...`, `NETGSM_PASSWORD=...`, `NETGSM_MSGHEADER=...`

## 3. Google Maps API anahtarı (ETA hassasiyeti)
1. console.cloud.google.com → proje aç → **Distance Matrix API**'yi etkinleştir
2. Faturalandırmayı aç (aylık $200 ücretsiz kredi var) ve API key oluştur
3. Key'i sadece Distance Matrix API ile sınırla (güvenlik)
4. `.env`'e gir: `GOOGLE_MAPS_API_KEY=...`
> Anahtar girilmezse sistem kuş uçuşu mesafe + ortalama hızla tahmin etmeye devam eder — çalışır ama trafik bilgisi olmaz.

## 4. Prod JWT secret'ları üret
Aşağıdaki komutu **iki kez** çalıştır, çıktıları Railway'de
`JWT_ACCESS_SECRET` ve `JWT_REFRESH_SECRET` olarak ayarla:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 5. Railway kurulumu (canlıya alma)
1. railway.app → New Project → **Deploy from GitHub repo** → `Eren-Ozcan/shuttleping`
2. Projeye **PostgreSQL** ve **Redis** ekle (Add Service → Database) —
   `DATABASE_URL` ve `REDIS_URL` otomatik enjekte edilir
3. Environment Variables: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (adım 4),
   `NODE_ENV=production` + adım 1-3'teki anahtarlar (hazır olanlar)
4. Settings → Deploy:
   - Build command: `npm ci && npm run build:admin` (admin panel de derlensin diye `admin/` bağımlılıkları için `npm --prefix admin ci` gerekebilir — deploy'da hata görürsen bana söyle, nixpacks config'i yazarım)
   - Pre-deploy command: `npm run migrate:up`
   - Start command: `npm start`
   - Health check path: `/health`
5. Domain: Railway'in verdiği `*.up.railway.app` domain'i HTTPS'lidir —
   sürücü sayfası (geolocation) HTTPS zorunlu olduğu için bu önemli
6. Staging istiyorsan aynı repo'dan ikinci bir Railway environment aç

## 6. İlk super_admin kullanıcısı (tek seferlik)
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
