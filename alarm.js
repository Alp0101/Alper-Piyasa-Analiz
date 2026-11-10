// Sesli Fiyat Alarmı & Demo Pozisyon Tetikleme Motoru
'use strict';
const fs = require('fs');
const path = require('path');
const Demo = require('./demo');
const Bulut = require('./bulut');

const ALARMLAR_DOSYA = path.join(__dirname, 'veri', 'fiyat_alarmlari.json');
const BULUT_ANAHTAR = 'fiyat_alarmlari';

let onbellekAlarmlar = null;

function alarmlariOku() {
  if (onbellekAlarmlar) return onbellekAlarmlar;
  try {
    onbellekAlarmlar = JSON.parse(fs.readFileSync(ALARMLAR_DOSYA, 'utf8'));
    return onbellekAlarmlar;
  } catch (_) {
    const baslangic = [];
    alarmlariKaydet(baslangic);
    return baslangic;
  }
}

function alarmlariKaydet(v) {
  onbellekAlarmlar = v;
  try {
    fs.mkdirSync(path.dirname(ALARMLAR_DOSYA), { recursive: true });
    fs.writeFileSync(ALARMLAR_DOSYA, JSON.stringify(v, null, 2), 'utf8');
  } catch (_) {}
  if (Bulut.aktifMi()) {
    Bulut.kaydet(BULUT_ANAHTAR, v).catch(() => {});
  }
}

// Buluttan başlangıç senkronizasyonu
async function buluttanYukle() {
  if (!Bulut.aktifMi()) return;
  const veri = await Bulut.getir(BULUT_ANAHTAR);
  if (Array.isArray(veri)) {
    onbellekAlarmlar = veri;
    try {
      fs.mkdirSync(path.dirname(ALARMLAR_DOSYA), { recursive: true });
      fs.writeFileSync(ALARMLAR_DOSYA, JSON.stringify(veri, null, 2), 'utf8');
      console.log('☁️ Fiyat alarmları bulut veritabanından yüklendi.');
    } catch (_) {}
  } else if (onbellekAlarmlar) {
    Bulut.kaydet(BULUT_ANAHTAR, onbellekAlarmlar).catch(() => {});
  }
}
buluttanYukle();

// Yeni Alarm Ekle
function alarmEkle(sembol, ad, hedefFiyat, yon = 'otomatik', not = '') {
  const alarmlar = alarmlariOku();
  const id = 'alarm-' + Date.now();
  const yeni = {
    id,
    sembol,
    ad: ad || sembol.split(':')[1],
    hedefFiyat: +hedefFiyat,
    yon, // 'yukari' | 'asagi' | 'otomatik'
    not,
    tarih: new Date().toISOString(),
    tetiklendi: false,
    tetiklenmeTarihi: null
  };
  alarmlar.push(yeni);
  alarmlariKaydet(alarmlar);
  return yeni;
}

// Alarm Sil
function alarmSil(id) {
  let alarmlar = alarmlariOku();
  alarmlar = alarmlar.filter(x => x.id !== id);
  alarmlariKaydet(alarmlar);
  return { basarili: true };
}

// Canlı Fiyatlar Geldiğinde Alarmları ve Demo Stop/Hedefleri Kontrol Et
function kontrolEt(fiyatHaritasi = {}) {
  const alarmlar = alarmlariOku();
  const calacakAlarmlar = [];

  // 1. Manuel Fiyat Alarmlarını Kontrol Et
  alarmlar.forEach(alarm => {
    if (alarm.tetiklendi) return;
    const guncelFiyat = fiyatHaritasi[alarm.sembol];
    if (!guncelFiyat) return;

    let tetikle = false;
    if (alarm.yon === 'yukari' && guncelFiyat >= alarm.hedefFiyat) tetikle = true;
    else if (alarm.yon === 'asagi' && guncelFiyat <= alarm.hedefFiyat) tetikle = true;
    else if (alarm.yon === 'otomatik' && Math.abs(guncelFiyat - alarm.hedefFiyat) / alarm.hedefFiyat < 0.003) tetikle = true;

    if (tetikle) {
      alarm.tetiklendi = true;
      alarm.tetiklenmeTarihi = new Date().toISOString();
      calacakAlarmlar.push({
        id: alarm.id,
        tip: 'alarm',
        sembol: alarm.sembol,
        ad: alarm.ad,
        fiyat: guncelFiyat,
        hedef: alarm.hedefFiyat,
        mesaj: `🔔 ALARM: ${alarm.ad} hedef fiyatına ulaştı! (${guncelFiyat})`
      });
    }
  });

  if (calacakAlarmlar.some(x => x.tip === 'alarm')) {
    alarmlariKaydet(alarmlar);
  }

  // 2. Demo Portföyündeki Stop-Loss ve Hedef Kontrolü (Otomatik Pozisyon Kapatma)
  const portfoy = Demo.portfoyOzet(fiyatHaritasi);
  portfoy.acikPozisyonlar.forEach(poz => {
    const f = fiyatHaritasi[poz.sembol];
    if (!f) return;

    // Hedef vurdu mu? (Kâr Al)
    if (poz.hedefFiyat && f >= poz.hedefFiyat) {
      Demo.demoSat(poz.id, f, 'otomatik_hedef');
      calacakAlarmlar.push({
        tip: 'demo_hedef',
        sembol: poz.sembol,
        ad: poz.ad,
        fiyat: f,
        mesaj: `🎉 DEMO HEDEF VURDU! ${poz.ad} ${f} seviyesinden KÂRLA otomatik kapatıldı!`
      });
    }
    // Stop oldu mu? (Zarar Kes)
    else if (poz.stopFiyat && f <= poz.stopFiyat) {
      Demo.demoSat(poz.id, f, 'otomatik_stop');
      calacakAlarmlar.push({
        tip: 'demo_stop',
        sembol: poz.sembol,
        ad: poz.ad,
        fiyat: f,
        mesaj: `🛑 DEMO STOP ÇALIŞTI! ${poz.ad} ${f} seviyesinden zararı kesmek için kapatıldı.`
      });
    }
  });

  return { calacakAlarmlar, aktifAlarmlar: alarmlar.filter(x => !x.tetiklendi) };
}

module.exports = { alarmEkle, alarmSil, alarmlariOku, kontrolEt };

