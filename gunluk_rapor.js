// Günlük Sinyal ve Başarı Raporu Motoru (Özel Şifreli: sea01)
// Gün içinde verilen kaliteli AL/SAT sinyallerini (Kurumsal VIP A+, Sniper, Fırsat Radarı) kaydeder.
// Gün içi en yüksek, güncel/kapanış fiyatı ve net yüzde getirisini hesaplayıp günlük karne çıkarır.
'use strict';

const fs = require('fs');
const path = require('path');
const Bulut = require('./bulut');

const RAPOR_DOSYA = path.join(__dirname, 'veri', 'gunluk_raporlar.json');
const BULUT_ANAHTAR = 'gunluk_raporlar';
const RAPOR_SIFRE = process.env.RAPOR_SIFRE || 'sea01';

let onbellekRapor = null;

// Türkiye saatine göre günün tarihi (YYYY-MM-DD)
function bugunTarih() {
  const d = new Date();
  // UTC+3 offset
  const tr = new Date(d.getTime() + 3 * 3600 * 1000);
  return tr.toISOString().slice(0, 10);
}

function suAnSaat() {
  const d = new Date();
  const tr = new Date(d.getTime() + 3 * 3600 * 1000);
  return tr.toISOString().slice(11, 16);
}

function raporlariOku() {
  if (onbellekRapor) return onbellekRapor;
  try {
    const raw = fs.readFileSync(RAPOR_DOSYA, 'utf8');
    onbellekRapor = JSON.parse(raw);
    return onbellekRapor;
  } catch (_) {
    const baslangic = {
      gunler: {} // '2026-11-13': { tarih, sinyaller: [] }
    };
    raporlariKaydet(baslangic);
    return baslangic;
  }
}

function raporlariKaydet(veri) {
  onbellekRapor = veri;
  try {
    fs.mkdirSync(path.dirname(RAPOR_DOSYA), { recursive: true });
    fs.writeFileSync(RAPOR_DOSYA, JSON.stringify(veri, null, 2), 'utf8');
  } catch (_) {}
  if (Bulut.aktifMi()) {
    Bulut.kaydet(BULUT_ANAHTAR, veri).catch(() => {});
  }
}

// Başlangıçta buluttan yükleme
async function buluttanYukle() {
  if (!Bulut.aktifMi()) return;
  const veri = await Bulut.getir(BULUT_ANAHTAR);
  if (veri && typeof veri === 'object' && veri.gunler) {
    onbellekRapor = veri;
    try {
      fs.mkdirSync(path.dirname(RAPOR_DOSYA), { recursive: true });
      fs.writeFileSync(RAPOR_DOSYA, JSON.stringify(veri, null, 2), 'utf8');
    } catch (_) {}
  } else if (onbellekRapor) {
    Bulut.kaydet(BULUT_ANAHTAR, onbellekRapor).catch(() => {});
  }
}
buluttanYukle();

/**
 * Şifre Doğrulama (sea01)
 */
function sifreDogrula(sifre) {
  if (!sifre || typeof sifre !== 'string') return false;
  return sifre.trim() === RAPOR_SIFRE.trim();
}

/**
 * Yeni Sinyal Kaydı Ekle
 */
function sinyalKaydet(sinyal) {
  const {
    sembol,
    ad,
    tur = 'bist',
    yon = 'AL',
    sinyalTipi = '👑 Kurumsal VIP A+',
    fiyat,
    hedefFiyat = null,
    stopFiyat = null
  } = sinyal;

  if (!sembol || !fiyat || fiyat <= 0) return null;

  const tarih = bugunTarih();
  const veri = raporlariOku();
  if (!veri.gunler[tarih]) {
    veri.gunler[tarih] = {
      tarih,
      sinyaller: []
    };
  }

  const gunluk = veri.gunler[tarih];

  // Aynı sembol için aynı gün içinde son 2 saatte mükerrer aynı sinyali açma
  const sonAyni = gunluk.sinyaller.find(s => s.sembol === sembol && s.yon === yon && s.sinyalTipi === sinyalTipi);
  if (sonAyni) {
    return sonAyni; // Zaten kayıtlı
  }

  const yeniSinyal = {
    id: `sig-${tarih.replace(/-/g, '')}-${sembol.replace(/[^a-zA-Z0-9]/g, '')}-${Date.now().toString().slice(-4)}`,
    tarih,
    saat: suAnSaat(),
    sembol,
    ad: ad || sembol.split(':')[1] || sembol,
    tur,
    yon: String(yon).toUpperCase() === 'SAT' ? 'SAT' : 'AL',
    sinyalTipi,
    girisFiyat: +fiyat,
    anlikFiyat: +fiyat,
    gunYuksek: +fiyat,
    gunDusuk: +fiyat,
    hedefFiyat: hedefFiyat ? +hedefFiyat : null,
    stopFiyat: stopFiyat ? +stopFiyat : null,
    degisimYuzde: 0,
    maxKarYuzde: 0,
    durum: '⏳ YENİ SİNYAL',
    kapanisSonucu: null // Gün kapandığında kilitlenir
  };

  gunluk.sinyaller.push(yeniSinyal);
  raporlariKaydet(veri);
  return yeniSinyal;
}

/**
 * Fiyatları ve Günlük Sonuçları Güncelle
 */
function fiyatlariGuncelle(fiyatHaritasi = {}) {
  const tarih = bugunTarih();
  const veri = raporlariOku();
  const gunluk = veri.gunler[tarih];
  if (!gunluk || !gunluk.sinyaller || gunluk.sinyaller.length === 0) return;

  let degisti = false;

  gunluk.sinyaller.forEach(s => {
    const yeniFiyat = fiyatHaritasi[s.sembol];
    if (yeniFiyat && yeniFiyat > 0) {
      s.anlikFiyat = +yeniFiyat;
      if (yeniFiyat > s.gunYuksek) s.gunYuksek = +yeniFiyat;
      if (yeniFiyat < s.gunDusuk) s.gunDusuk = +yeniFiyat;

      // Kâr/Zarar Yüzdesi
      if (s.yon === 'AL') {
        s.degisimYuzde = +(((s.anlikFiyat - s.girisFiyat) / s.girisFiyat) * 100).toFixed(2);
        s.maxKarYuzde = +(((s.gunYuksek - s.girisFiyat) / s.girisFiyat) * 100).toFixed(2);
      } else {
        // SAT (Short)
        s.degisimYuzde = +(((s.girisFiyat - s.anlikFiyat) / s.girisFiyat) * 100).toFixed(2);
        s.maxKarYuzde = +(((s.girisFiyat - s.gunDusuk) / s.girisFiyat) * 100).toFixed(2);
      }

      // Durum Etiketi
      if (s.hedefFiyat && ((s.yon === 'AL' && s.gunYuksek >= s.hedefFiyat) || (s.yon === 'SAT' && s.gunDusuk <= s.hedefFiyat))) {
        s.durum = '🎯 HEDEFE ULAŞTI';
      } else if (s.stopFiyat && ((s.yon === 'AL' && s.gunDusuk <= s.stopFiyat) || (s.yon === 'SAT' && s.gunYuksek >= s.stopFiyat))) {
        s.durum = '🛑 STOP OLDU';
      } else if (s.degisimYuzde >= 1.5) {
        s.durum = '🎯 KÂRDA';
      } else if (s.degisimYuzde <= -1.5) {
        s.durum = '🛑 ZARARDA';
      } else {
        s.durum = '⏳ BAŞABAŞ / NÖTR';
      }

      degisti = true;
    }
  });

  if (degisti) {
    raporlariKaydet(veri);
  }
}

/**
 * Belirli bir tarihin veya bugünün özet karnesini getir
 */
function gunlukRaporAl(seciliTarih = null) {
  const veri = raporlariOku();
  const tarih = seciliTarih || bugunTarih();
  const gunVerisi = veri.gunler[tarih] || { tarih, sinyaller: [] };

  const sinyaller = gunVerisi.sinyaller || [];
  const toplam = sinyaller.length;

  const basarili = sinyaller.filter(s => s.degisimYuzde > 0 || s.durum.includes('HEDEF') || s.durum.includes('KÂR'));
  const basarisiz = sinyaller.filter(s => s.degisimYuzde < 0 || s.durum.includes('STOP'));

  const winRate = toplam > 0 ? +((basarili.length / toplam) * 100).toFixed(1) : 0;
  const toplamGetiri = sinyaller.reduce((a, b) => a + (b.degisimYuzde || 0), 0);
  const ortGetiri = toplam > 0 ? +(toplamGetiri / toplam).toFixed(2) : 0;

  // En çok kazandıran sinyal
  let enIyi = null;
  sinyaller.forEach(s => {
    if (!enIyi || (s.degisimYuzde > enIyi.degisimYuzde)) {
      enIyi = s;
    }
  });

  const tumTarihler = Object.keys(veri.gunler).sort().reverse();

  return {
    tarih,
    toplamSinyal: toplam,
    basariliSayi: basarili.length,
    basarisizSayi: basarisiz.length,
    winRate: `%${winRate}`,
    ortGetiri: `${ortGetiri >= 0 ? '+' : ''}%${ortGetiri}`,
    toplamNetGetiri: `${toplamGetiri >= 0 ? '+' : ''}%${toplamGetiri.toFixed(2)}`,
    enIyi: enIyi ? `${enIyi.sembol.split(':')[1] || enIyi.sembol} (%+${enIyi.degisimYuzde})` : '—',
    sinyaller: [...sinyaller].reverse(),
    gecmisTarihler: tumTarihler
  };
}

module.exports = {
  sifreDogrula,
  sinyalKaydet,
  fiyatlariGuncelle,
  gunlukRaporAl,
  bugunTarih
};
