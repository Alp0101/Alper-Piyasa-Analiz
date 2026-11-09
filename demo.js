// Demo (Paper Trading) Al-Sat ve Portföy Takip Motoru
'use strict';
const fs = require('fs');
const path = require('path');

const PORTFOY_DOSYA = path.join(__dirname, 'veri', 'demo_portfoy.json');

const VARSAYILAN_BAKIYE = 100000; // 100.000 TL başlangıç sanal kasa

function portfoyOku() {
  try {
    return JSON.parse(fs.readFileSync(PORTFOY_DOSYA, 'utf8'));
  } catch (_) {
    const baslangic = {
      bakiye: VARSAYILAN_BAKIYE,
      baslangicBakiye: VARSAYILAN_BAKIYE,
      acikPozisyonlar: [], // { id, sembol, ad, adet, alisFiyat, alisTarih, stopFiyat, hedefFiyat, tutar }
      kapananIslemler: []  // { id, sembol, ad, adet, alisFiyat, satisFiyat, alisTarih, satisTarih, karZararTL, karZararYuzde, sebep }
    };
    portfoyKaydet(baslangic);
    return baslangic;
  }
}

function portfoyKaydet(p) {
  fs.mkdirSync(path.dirname(PORTFOY_DOSYA), { recursive: true });
  fs.writeFileSync(PORTFOY_DOSYA, JSON.stringify(p, null, 2), 'utf8');
}

// Demo Alım İşlemi
function demoAl(sembolId, ad, fiyat, adet, stopFiyat = null, hedefFiyat = null) {
  if (!fiyat || fiyat <= 0 || !adet || adet <= 0) throw new Error('Geçersiz fiyat veya adet.');
  const tutar = fiyat * adet;
  const p = portfoyOku();

  if (p.bakiye < tutar) {
    throw new Error(`Yetersiz sanal bakiye! Gerekli: ${tutar.toLocaleString('tr-TR')} TL, Mevcut Bakiye: ${p.bakiye.toLocaleString('tr-TR')} TL`);
  }

  p.bakiye -= tutar;
  const poz = {
    id: 'poz-' + Date.now(),
    sembol: sembolId,
    ad: ad || sembolId.split(':')[1],
    adet: +adet,
    alisFiyat: +fiyat,
    alisTarih: new Date().toISOString(),
    stopFiyat: stopFiyat ? +stopFiyat : null,
    hedefFiyat: hedefFiyat ? +hedefFiyat : null,
    tutar: +tutar.toFixed(2)
  };

  p.acikPozisyonlar.push(poz);
  portfoyKaydet(p);
  return { basarili: true, poz, bakiye: p.bakiye };
}

// Demo Satım (Pozisyon Kapatma)
function demoSat(pozId, satisFiyat, sebep = 'manuel') {
  if (!satisFiyat || satisFiyat <= 0) throw new Error('Geçersiz satış fiyatı.');
  const p = portfoyOku();
  const idx = p.acikPozisyonlar.findIndex(x => x.id === pozId);
  if (idx === -1) throw new Error('Kapatılacak pozisyon bulunamadı.');

  const poz = p.acikPozisyonlar[idx];
  const satisTutar = poz.adet * satisFiyat;
  const alisTutar = poz.adet * poz.alisFiyat;
  const karZararTL = satisTutar - alisTutar;
  const karZararYuzde = ((satisFiyat - poz.alisFiyat) / poz.alisFiyat) * 100;

  p.bakiye += satisTutar;
  p.acikPozisyonlar.splice(idx, 1);

  const kapandi = {
    id: poz.id,
    sembol: poz.sembol,
    ad: poz.ad,
    adet: poz.adet,
    alisFiyat: poz.alisFiyat,
    satisFiyat: +satisFiyat,
    alisTarih: poz.alisTarih,
    satisTarih: new Date().toISOString(),
    karZararTL: +karZararTL.toFixed(2),
    karZararYuzde: +karZararYuzde.toFixed(2),
    sebep
  };

  p.kapananIslemler.unshift(kapandi);
  portfoyKaydet(p);
  return { basarili: true, kapandi, bakiye: p.bakiye };
}

// Kasayı Sıfırla
function demoSifirla() {
  const baslangic = {
    bakiye: VARSAYILAN_BAKIYE,
    baslangicBakiye: VARSAYILAN_BAKIYE,
    acikPozisyonlar: [],
    kapananIslemler: []
  };
  portfoyKaydet(baslangic);
  return baslangic;
}

// Açık Pozisyonların Güncel Durumu & Kâr/Zarar Özeti
function portfoyOzet(fiyatHaritasi = {}) {
  const p = portfoyOku();
  let toplamHisseDegeri = 0;

  const pozisyonlar = p.acikPozisyonlar.map(poz => {
    const anlikFiyat = fiyatHaritasi[poz.sembol] || poz.alisFiyat;
    const anlikTutar = poz.adet * anlikFiyat;
    const karZararTL = anlikTutar - poz.tutar;
    const karZararYuzde = ((anlikFiyat - poz.alisFiyat) / poz.alisFiyat) * 100;
    toplamHisseDegeri += anlikTutar;

    return {
      ...poz,
      anlikFiyat: +anlikFiyat,
      anlikTutar: +anlikTutar.toFixed(2),
      karZararTL: +karZararTL.toFixed(2),
      karZararYuzde: +karZararYuzde.toFixed(2)
    };
  });

  const toplamVarlik = p.bakiye + toplamHisseDegeri;
  const toplamNetKarTL = toplamVarlik - p.baslangicBakiye;
  const toplamNetKarYuzde = ((toplamVarlik - p.baslangicBakiye) / p.baslangicBakiye) * 100;

  const basarili = p.kapananIslemler.filter(x => x.karZararTL > 0).length;
  const basarisiz = p.kapananIslemler.filter(x => x.karZararTL <= 0).length;
  const toplamKapali = p.kapananIslemler.length;
  const basariOrani = toplamKapali > 0 ? +((basarili / toplamKapali) * 100).toFixed(1) : 0;

  return {
    bakiye: +p.bakiye.toFixed(2),
    toplamHisseDegeri: +toplamHisseDegeri.toFixed(2),
    toplamVarlik: +toplamVarlik.toFixed(2),
    toplamNetKarTL: +toplamNetKarTL.toFixed(2),
    toplamNetKarYuzde: +toplamNetKarYuzde.toFixed(2),
    istatistik: {
      toplamKapali,
      basarili,
      basarisiz,
      basariOrani
    },
    acikPozisyonlar: pozisyonlar,
    kapananIslemler: p.kapananIslemler.slice(0, 30)
  };
}

module.exports = { demoAl, demoSat, demoSifirla, portfoyOzet };
