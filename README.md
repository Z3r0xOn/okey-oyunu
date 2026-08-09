# 🁢 Okey Masası

Arkadaşlarınla tarayıcıdan (mobil + PC) oynayabileceğin, oda kodlu, sesli sohbetli online Okey.

## ⚠️ Önemli: GitHub Pages TEK BAŞINA yeterli değil

Bu proje gerçek zamanlı oda/eşleşme (Socket.io) ve sesli sohbet sinyalleşmesi (WebRTC) için
**çalışan bir Node.js sunucusuna** ihtiyaç duyar. GitHub Pages sadece statik dosya (HTML/CSS/JS)
sunar, arka planda kod çalıştırmaz — bu yüzden oda/kod sistemi Pages üzerinde çalışmaz.

**Kodu GitHub'da barındırmaya devam edebilirsin**, ama oyunu ayakta tutmak için sunucuyu
**ücretsiz bir Node.js barındırma servisine** deploy etmen gerekiyor. En kolay seçenekler:

- **Render.com** (Free Web Service) — önerilen, GitHub reposunu otomatik deploy eder.
- **Railway.app**
- **Fly.io**
- **Glitch.com** (küçük gruplar için en hızlı kurulum)

### Render.com ile 5 dakikada yayına alma
1. Bu klasörü GitHub'a bir repo olarak yükle (`git push`).
2. [render.com](https://render.com) → **New +** → **Web Service** → GitHub reponu seç.
3. Ayarlar:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Free instance type** seç.
4. Deploy bitince sana `https://okey-masasi.onrender.com` gibi bir link verir.
5. Bu linki arkadaşlarınla paylaş — herkes aynı adrese girip oda kodu ile oynar.

> Not: Render'ın ücretsiz planında sunucu birkaç dakika kullanılmazsa uykuya geçer, ilk girişte
> 30-60 saniye "uyanma" süresi olabilir. Bu normaldir.

## 💻 Yerelde çalıştırma

```bash
npm install
npm start
```

Sonra tarayıcıda `http://localhost:3000` adresini aç. Aynı ağdaki (Wi-Fi) arkadaşların
bilgisayarının yerel IP'siyle (örn. `http://192.168.1.5:3000`) katılabilir.

## 🎮 Nasıl oynanır

1. Ana ekranda adını yaz, **"Yeni Oda Aç"** ile bir oda kodu üret.
2. Kodu arkadaşlarına gönder; onlar **"Odaya Katıl"** ile aynı kodu girer.
3. Oda ekranında 4 koltuktan birini seçerek masaya otur (kalan kişiler izleyici olarak kalır,
   toplamda oda 8 kişiye kadar dolabilir).
4. Oda kurucusu 4 koltuk dolunca **"Oyunu Başlat"** der.
5. Sırası gelen kupadan ya da ortadan taş çeker, sonra elinden bir taş atar.
6. Elini bitirdiğini düşünüyorsan **"Elimi Bitirdim"** ile otomatik kontrolü dene; sistem
   kabul etmezse (nadir kural varyasyonları için) **"Elimi Açıyorum"** ile masaya danışabilirsin,
   oda kurucusu kabul/red oyu verir.
7. Sağ üstten mikrofonu açarak (🎤) sesli konuşabilirsiniz — tarayıcı mikrofon izni isteyecektir.

## 🧩 Kapsam ve sınırlamalar (dürüst not)

- Okey'in resmi turnuva kurallarının tamamı (gösterme, çifte kağıt/açık atma, farklı bitiş
  puanlama biçimleri vb.) çok detaylıdır. Bu sürüm **çekirdek oyun akışını** (dağıtım, gösterge/okey
  taşı, sırayla çekme-atma, seri/set ve 7 çift bitiş kontrolü) uygular. Nadir bitiş varyasyonları
  için "Elimi Açıyorum" ile manuel masa onayı eklenmiştir.
- Sesli sohbet basit bir WebRTC mesh (P2P) yapısıdır; 8 kişide bazı ağlarda (kurumsal/okul Wi-Fi
  gibi kısıtlı NAT'larda) bağlantı sorunu yaşanabilir — ev/mobil interneti için sorunsuz çalışır.
- Oyun durumu sunucu belleğinde tutulur; sunucu yeniden başlarsa aktif odalar sıfırlanır (ücretsiz
  hosting planlarında bu bazen olur).

## 📁 Proje yapısı

```
okey/
├── server.js       # Express + Socket.io sunucusu (oda, koltuk, tur, sesli sinyalleşme)
├── gameLogic.js     # Taş destesi, dağıtım, gösterge/okey, bitiş kontrolü
├── package.json
└── public/
    ├── index.html   # Lobi / bekleme odası / oyun masası ekranları
    ├── style.css    # Yeşil çuha masa teması
    └── client.js     # Socket, render, WebRTC sesli sohbet mantığı
```
