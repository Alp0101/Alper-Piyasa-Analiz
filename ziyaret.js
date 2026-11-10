// Ziyaretçi ve Kullanım İstatistik Sayacı
'use strict';
const fs = require('fs');
const path = require('path');
const Bulut = require('./bulut');

const SAYAC_DOSYA = path.join(__dirname, 'veri', 'ziyaret_istatistik.json');
const BULUT_ANAHTAR = 'ziyaret_istatistik';

let onbellekSayac = null;

function sayacOku() {
  if (onbellekSayac) return onbellekSayac;
  try {
    onbellekSayac = JSON.parse(fs.readFileSync(SAYAC_DOSYA, 'utf8'));
    return onbellekSayac;
  } catch (_) {
    const baslangic = {
      toplamTiklama: 0,
      tekilZiyaretciler: {},
      gunlukZiyaret: {},
      sonGirisler: []
    };
    sayacKaydet(baslangic);
    return baslangic;
  }
}

function sayacKaydet(v) {
  onbellekSayac = v;
  try {
    fs.mkdirSync(path.dirname(SAYAC_DOSYA), { recursive: true });
    fs.writeFileSync(SAYAC_DOSYA, JSON.stringify(v, null, 2), 'utf8');
  } catch (_) {}
  if (Bulut.aktifMi()) {
    Bulut.kaydet(BULUT_ANAHTAR, v).catch(() => {});
  }
}

// Buluttan başlangıç senkronizasyonu
async function buluttanYukle() {
  if (!Bulut.aktifMi()) return;
  const veri = await Bulut.getir(BULUT_ANAHTAR);
  if (veri && typeof veri === 'object' && typeof veri.toplamTiklama === 'number') {
    onbellekSayac = veri;
    try {
      fs.mkdirSync(path.dirname(SAYAC_DOSYA), { recursive: true });
      fs.writeFileSync(SAYAC_DOSYA, JSON.stringify(veri, null, 2), 'utf8');
      console.log('☁️ Ziyaretçi istatistikleri bulut veritabanından yüklendi.');
    } catch (_) {}
  } else if (onbellekSayac) {
    Bulut.kaydet(BULUT_ANAHTAR, onbellekSayac).catch(() => {});
  }
}
buluttanYukle();

function ziyaretKaydet(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'bilinmiyor';
  const ua = req.headers['user-agent'] || '';
  const cihaz = ua.includes('Mobile') ? '📱 Telefon' : '💻 Bilgisayar';
  const bugun = new Date().toISOString().slice(0, 10);

  const d = sayacOku();
  d.toplamTiklama++;

  if (!d.tekilZiyaretciler[ip]) {
    d.tekilZiyaretciler[ip] = { ilkGiris: new Date().toISOString(), sayi: 1, cihaz };
  } else {
    d.tekilZiyaretciler[ip].sayi++;
    d.tekilZiyaretciler[ip].sonGiris = new Date().toISOString();
  }

  d.gunlukZiyaret[bugun] = (d.gunlukZiyaret[bugun] || 0) + 1;

  d.sonGirisler.unshift({
    tarih: new Date().toISOString(),
    cihaz,
    ip: ip.length > 8 ? ip.slice(0, 7) + '***' : ip // Gizlilik için maskele
  });
  if (d.sonGirisler.length > 25) d.sonGirisler.pop();

  sayacKaydet(d);
}

function istatistikGetir() {
  const d = sayacOku();
  const tekilKisiSayisi = Object.keys(d.tekilZiyaretciler).length;
  const bugun = new Date().toISOString().slice(0, 10);
  const bugunGiris = d.gunlukZiyaret[bugun] || 0;

  return {
    toplamTiklama: d.toplamTiklama,
    tekilKisiSayisi,
    bugunGiris,
    sonGirisler: d.sonGirisler
  };
}

module.exports = { ziyaretKaydet, istatistikGetir };

