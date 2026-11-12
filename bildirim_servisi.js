// Bildirim Merkezi Servisi (Server-side Notification Engine)
// Sniper, Balina, Kurumsal VIP ve Fırsat Radarı bildirimlerini tüm cihazlarla senkronize tutar.
'use strict';

const fs = require('fs');
const path = require('path');
const Bulut = require('./bulut');

const BILDIRIM_DOSYA = path.join(__dirname, 'veri', 'bildirimler.json');
const BULUT_ANAHTAR = 'bildirim_merkezi';

let onbellekBildirimler = null;

function piyasaBelirle(sembolId, tur) {
  if (!sembolId) return 'diger';
  const s = String(sembolId).toUpperCase();
  if (s.startsWith('BINANCE:') || s.startsWith('OKX:') || s.startsWith('GATE:') || s.includes('USDT') || tur === 'kripto') {
    return 'kripto';
  }
  if (s === 'BIST:ALTIN' || s.includes('XAU') || s.includes('SILVER') || s.startsWith('FX:') || s.startsWith('OANDA:') || s.startsWith('TVC:') || tur === 'emtia' || tur === 'forex') {
    return 'diger';
  }
  return 'bist';
}

function bildirimleriOku() {
  if (onbellekBildirimler) return onbellekBildirimler;
  try {
    const raw = fs.readFileSync(BILDIRIM_DOSYA, 'utf8');
    onbellekBildirimler = JSON.parse(raw);
    if (!Array.isArray(onbellekBildirimler)) onbellekBildirimler = [];
    return onbellekBildirimler;
  } catch (_) {
    onbellekBildirimler = [];
    bildirimleriKaydet(onbellekBildirimler);
    return onbellekBildirimler;
  }
}

function bildirimleriKaydet(liste) {
  onbellekBildirimler = liste;
  try {
    fs.mkdirSync(path.dirname(BILDIRIM_DOSYA), { recursive: true });
    fs.writeFileSync(BILDIRIM_DOSYA, JSON.stringify(liste, null, 2), 'utf8');
  } catch (_) {}
  if (Bulut.aktifMi()) {
    Bulut.kaydet(BULUT_ANAHTAR, liste).catch(() => {});
  }
}

// Buluttan yükleme
async function buluttanYukle() {
  if (!Bulut.aktifMi()) return;
  const veri = await Bulut.getir(BULUT_ANAHTAR);
  if (Array.isArray(veri) && veri.length > 0) {
    onbellekBildirimler = veri;
    try {
      fs.mkdirSync(path.dirname(BILDIRIM_DOSYA), { recursive: true });
      fs.writeFileSync(BILDIRIM_DOSYA, JSON.stringify(veri, null, 2), 'utf8');
    } catch (_) {}
  }
}
buluttanYukle();

// Başlangıçta bugünkü günlük rapor sinyallerini bildirim olarak ekle
function baslangicSenkronizasyonu() {
  const mevcut = bildirimleriOku();
  const mevcutIdler = new Set(mevcut.map(b => b.kaynakId || b.id));

  try {
    const GunlukRapor = require('./gunluk_rapor');
    const rapor = GunlukRapor.gunlukRaporAl();
    const sinyaller = (rapor && rapor.sinyaller) || [];

    sinyaller.forEach(s => {
      const kaynakId = s.id || `sig-${s.tarih}-${s.sembol}`;
      if (mevcutIdler.has(kaynakId)) return;

      const sembol = s.sembol || '';
      const kod = sembol.split(':')[1] || sembol;
      const piyasa = piyasaBelirle(sembol, s.tur);

      let baslik = '🎯 YENİ SİNYAL';
      let tur = 'firsat';

      if (s.sinyalTipi && s.sinyalTipi.includes('Sniper')) {
        baslik = '🎯 YENİ SNIPER FIRSATI';
        tur = 'sniper';
      } else if (s.sinyalTipi && s.sinyalTipi.includes('Kurumsal VIP')) {
        baslik = '👑 KURUMSAL VIP SİNYALİ (%80+)';
        tur = 'kurumsal';
      } else if (s.sinyalTipi && s.sinyalTipi.includes('Alfa')) {
        baslik = '🛡️ ALFA GÜCÜ ONAYI';
        tur = 'alfa';
      } else if (s.sinyalTipi && s.sinyalTipi.includes('Kombo')) {
        baslik = '⭐ ÖZEL KOMBO SİNYALİ';
        tur = 'firsat';
      }

      const d = s.tarih ? new Date(s.tarih + (s.saat ? 'T' + s.saat + ':00' : 'T12:00:00')) : new Date();

      mevcut.push({
        id: 'bld-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        kaynakId,
        baslik,
        mesaj: `${kod} (${s.ad || ''}) ${s.sinyalTipi || 'Sinyali'} onaylandı! Giriş: ${s.girisFiyat} ₺ | Hedef: ${s.hedefFiyat || '—'}`,
        tur,
        sembolId: sembol,
        kod,
        ad: s.ad || '',
        fiyat: s.girisFiyat,
        piyasa,
        tarih: isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString(),
        okundu: false
      });
      mevcutIdler.add(kaynakId);
    });

    // Tarihe göre yeniden eskiye sırala
    mevcut.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
    bildirimleriKaydet(mevcut.slice(0, 150));
  } catch (_) {}
}

setTimeout(baslangicSenkronizasyonu, 1000);

/**
 * Yeni Bildirim Ekle (Tekilleştirme Korumalı)
 */
function bildirimEkle(veri) {
  const {
    baslik,
    mesaj,
    tur = 'firsat',
    sembolId = '',
    kod = '',
    ad = '',
    fiyat = 0,
    piyasa = null,
    kaynakId = null
  } = veri;

  if (!baslik || !mesaj) return null;

  const liste = bildirimleriOku();
  const son45Dakika = Date.now() - 45 * 60 * 1000;

  // Aynı sembol ve tür için son 45 dakikada bildirim atılmışsa atlama
  const sonAyni = liste.find(b => 
    b.sembolId === sembolId && 
    b.tur === tur && 
    new Date(b.tarih).getTime() > son45Dakika
  );
  if (sonAyni) return sonAyni;

  const netPiyasa = piyasa || piyasaBelirle(sembolId, tur);
  const netKod = kod || (sembolId.includes(':') ? sembolId.split(':')[1] : sembolId);

  const yeni = {
    id: 'bld-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
    kaynakId,
    baslik,
    mesaj,
    tur,
    sembolId,
    kod: netKod,
    ad,
    fiyat,
    piyasa: netPiyasa,
    tarih: new Date().toISOString(),
    okundu: false
  };

  liste.unshift(yeni);
  bildirimleriKaydet(liste.slice(0, 150));
  return yeni;
}

/**
 * Bildirimleri Getir
 */
function bildirimleriGetir(piyasa = 'hepsi') {
  const liste = bildirimleriOku();
  if (!piyasa || piyasa === 'hepsi') return liste;
  return liste.filter(b => (b.piyasa || piyasaBelirle(b.sembolId)) === piyasa);
}

/**
 * Tek Bildirim Sil
 */
function tekBildirimSil(id) {
  let liste = bildirimleriOku();
  liste = liste.filter(b => b.id !== id);
  bildirimleriKaydet(liste);
  return { basarili: true, kalan: liste.length };
}

/**
 * Tümünü Temizle
 */
function tumunuTemizle() {
  bildirimleriKaydet([]);
  return { basarili: true };
}

/**
 * Okundu Olarak İşaretle
 */
function okunduYap(piyasa = 'hepsi') {
  const liste = bildirimleriOku();
  liste.forEach(b => {
    if (!piyasa || piyasa === 'hepsi' || (b.piyasa || piyasaBelirle(b.sembolId)) === piyasa) {
      b.okundu = true;
    }
  });
  bildirimleriKaydet(liste);
  return { basarili: true };
}

module.exports = {
  bildirimEkle,
  bildirimleriGetir,
  tekBildirimSil,
  tumunuTemizle,
  okunduYap,
  baslangicSenkronizasyonu
};
