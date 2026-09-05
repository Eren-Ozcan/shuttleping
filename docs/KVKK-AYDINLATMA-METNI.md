# KVKK Aydınlatma Metni — ŞuttlePing Servis Bildirimi (TASLAK)

> **Bu metin bir taslaktır, hukuki onay gerektirir.** Köşeli parantez içindeki
> alanları ([ŞİRKET ADI] vb.) her müşteri kendi bilgileriyle doldurmalı; ayrıca
> bir hukuk danışmanının gözden geçirmesi öneriliyor. Onaylanınca bu satır
> kaldırılıp sürüm tarihi `docs/KVKK-AYDINLATMA-METNI.md` içinde güncellenmeli
> — `passengers.consent_version` alanı hangi sürüme rıza verildiğini tutuyor.

**Sürüm:** taslak-1 · **Tarih:** 2026-09-03

## 1. Veri Sorumlusu

[ŞİRKET ADI] ("Şirket"), 6698 sayılı Kişisel Verilerin Korunması Kanunu
("KVKK") uyarınca veri sorumlusudur.

- Adres: [ADRES]
- E-posta: [İLETİŞİM E-POSTASI]
- Telefon: [İLETİŞİM TELEFONU]

## 2. İşlenen Kişisel Veriler

Servis takip ve bildirim hizmeti kapsamında aşağıdaki kişisel verileriniz
işlenir:

| Veri | Kaynak | Neden gerekli |
|---|---|---|
| Ad soyad | Şirket (kayıt sırasında) | Bildirim metninde hitap, kayıt eşleştirme |
| Telefon numarası | Şirket | SMS bildirimi gönderimi |
| Telegram sohbet kimliği | Siz (bota `/start` yazınca) | Telegram bildirimi gönderimi |
| Bindiğiniz durak | Şirket | Servisin durağa yaklaştığını hesaplamak |
| Bildirim gönderim kaydı (zaman, kanal, durum) | Sistem | Hizmetin çalıştığını doğrulama, hata ayıklama |

**İşlenmeyen veri:** Sürekli/anlık konumunuz **tutulmaz**. Yalnızca servis
aracının konumu işlenir — yolcunun kendi konumu sistem tarafından hiçbir
şekilde toplanmaz.

## 3. İşleme Amaçları ve Hukuki Sebep

Kişisel verileriniz, servis aracı durağınıza yaklaştığında size otomatik
bildirim (SMS/Telegram) gönderilmesi amacıyla, **KVKK m.5/1 uyarınca açık
rızanıza dayanılarak** işlenir. Rızanızı istediğiniz zaman geri
çekebilirsiniz (bkz. Bölüm 6); geri çektiğinizde bildirim hizmeti sizin için
durur.

## 4. Kişisel Verilerin Aktarılması

- **Telegram** (Telegram FZ-LLC, Birleşik Arap Emirlikleri) — yalnızca
  Telegram bildirim kanalını seçtiyseniz, sohbet kimliğiniz ve mesaj metni
  Telegram'ın sunucularına iletilir.
- **Netgsm A.Ş.** (Türkiye) — yalnızca SMS bildirim kanalını seçtiyseniz,
  telefon numaranız ve mesaj metni Netgsm'e iletilir.
- Başka hiçbir üçüncü tarafa veri satılmaz veya paylaşılmaz.

## 5. Saklama Süresi

- Bildirim gönderim kayıtları: en fazla **365 gün**, sonra otomatik silinir.
- Araç konum geçmişi (sizin verinize değil, servis aracına ait): en fazla
  **90 gün**, sonra otomatik silinir.
- Yolcu kaydınız (ad, telefon, Telegram kimliği): hizmet süresince veya rıza
  geri çekilene kadar tutulur; hesap kapatıldığında fiziksel silinmez,
  pasif (`is_active=false`) işaretlenip erişilemez hale getirilir.

## 6. Haklarınız (KVKK m.11)

Şirkete başvurarak; verinizin işlenip işlenmediğini öğrenme, işlenmişse
bilgi talep etme, amacına uygun kullanılıp kullanılmadığını öğrenme,
düzeltilmesini/silinmesini isteme ve **rızanızı geri çekme** haklarına
sahipsiniz. Başvuru için: [İLETİŞİM E-POSTASI]

---

# Açık Rıza Beyanı

> Bu kısa metin, yolcu kaydı oluşturulmadan önce yolcuya okunur/gösterilir;
> panelde "Yolcunun aydınlatma metnini okuduğunu ve açık rızasını aldım"
> onay kutusu (`passengers.consent_given_at`) bu beyanın alındığını temsil
> eder.

"Yukarıdaki KVKK Aydınlatma Metni'ni okudum. Ad-soyad, telefon numaram
ve/veya Telegram sohbet kimliğimin, servis aracı durağıma yaklaştığında bana
otomatik bildirim gönderilmesi amacıyla [ŞİRKET ADI] tarafından işlenmesine
açık rıza veriyorum."
