// Demo (Paper Trading) Al-Sat ve Portföy Takip Motoru (Çift Kasa: BIST için TL, Kripto/Emtia için USD)
'use strict';
const fs = require('fs');
const path = require('path');
const Bulut = require('./bulut');

const PORTFOY_DOSYA = path.join(__dirname, 'veri', 'demo_portfoy.json');
const BULUT_ANAHTAR = 'demo_portfoy';

const VARSAYILAN_TL_KASA = 1000000;  // 1.000.000 TL
const VARSAYILAN_USD_KASA = 100000;  // 100.000 USD
let onbellekPortfoy = null;

function paraBirimiAl(sembolId) {
  if (!sembolId) return '₺';
  if (sembolId.startsWith('BINANCE:') || sembolId.startsWith('OKX:') || sembolId.startsWith('GATE:') || sembolId.startsWith('BYBIT:')) return '$';
  if (sembolId.includes('XAUUSD') || sembolId.includes('SILVER') || sembolId.includes('OIL') || sembolId.includes('DXY') || sembolId.includes('EURUSD')) return '$';
  return '₺';
}

function portfoyOku() {
  if (onbellekPortfoy) return onbellekPortfoy;
  try {
    const p = JSON.parse(fs.readFileSync(PORTFOY_DOSYA, 'utf8'));
    // Geriye dönük uyumluluk: eski tekil bakiye varsa TL ve USD kasasına geçir
    if (p.bakiyeTL == null) {
      p.bakiyeTL = typeof p.bakiye === 'number' ? p.bakiye : VARSAYILAN_TL_KASA;
      p.baslangicTL = typeof p.baslangicBakiye === 'number' ? p.baslangicBakiye : VARSAYILAN_TL_KASA;
      p.bakiyeUSD = VARSAYILAN_USD_KASA;
      p.baslangicUSD = VARSAYILAN_USD_KASA;
    }
    // Pozisyonlarda para birimi ve yön eksikse tamamla
    (p.acikPozisyonlar || []).forEach(poz => {
      if (!poz.paraBirimi) poz.paraBirimi = paraBirimiAl(poz.sembol);
      if (!poz.yon) poz.yon = 'LONG';
      if (!poz.kaldirac) poz.kaldirac = 1;
      if (!poz.teminat) poz.teminat = poz.tutar || +(poz.adet * poz.alisFiyat).toFixed(2);
    });
    (p.kapananIslemler || []).forEach(k => {
      if (!k.paraBirimi) k.paraBirimi = paraBirimiAl(k.sembol);
      if (!k.yon) k.yon = 'LONG';
      if (!k.kaldirac) k.kaldirac = 1;
      if (k.karZarar == null) k.karZarar = k.karZararTL || 0;
    });
    onbellekPortfoy = p;
    return onbellekPortfoy;
  } catch (_) {
    const baslangic = {
      bakiyeTL: VARSAYILAN_TL_KASA,
      baslangicTL: VARSAYILAN_TL_KASA,
      bakiyeUSD: VARSAYILAN_USD_KASA,
      baslangicUSD: VARSAYILAN_USD_KASA,
      acikPozisyonlar: [],
      kapananIslemler: []
    };
    portfoyKaydet(baslangic);
    return baslangic;
  }
}

function portfoyKaydet(p) {
  onbellekPortfoy = p;
  try {
    fs.mkdirSync(path.dirname(PORTFOY_DOSYA), { recursive: true });
    fs.writeFileSync(PORTFOY_DOSYA, JSON.stringify(p, null, 2), 'utf8');
  } catch (_) {}
  if (Bulut.aktifMi()) {
    Bulut.kaydet(BULUT_ANAHTAR, p).catch(() => {});
  }
}

// Buluttan başlangıç senkronizasyonu
async function buluttanYukle() {
  if (!Bulut.aktifMi()) return;
  const veri = await Bulut.getir(BULUT_ANAHTAR);
  if (veri && typeof veri === 'object' && (typeof veri.bakiyeTL === 'number' || typeof veri.bakiye === 'number')) {
    if (veri.bakiyeTL == null) {
      veri.bakiyeTL = veri.bakiye ?? VARSAYILAN_TL_KASA;
      veri.baslangicTL = veri.baslangicBakiye ?? VARSAYILAN_TL_KASA;
      veri.bakiyeUSD = VARSAYILAN_USD_KASA;
      veri.baslangicUSD = VARSAYILAN_USD_KASA;
    }
    onbellekPortfoy = veri;
    try {
      fs.mkdirSync(path.dirname(PORTFOY_DOSYA), { recursive: true });
      fs.writeFileSync(PORTFOY_DOSYA, JSON.stringify(veri, null, 2), 'utf8');
      console.log('☁️ Demo çift para kasalı portföy bulut veritabanından yüklendi.');
    } catch (_) {}
  } else if (onbellekPortfoy) {
    Bulut.kaydet(BULUT_ANAHTAR, onbellekPortfoy).catch(() => {});
  }
}
buluttanYukle();

// Demo Alım / Satım (LONG / SHORT) İşlemi
// - Varlığın para birimine göre TL veya USD kasasından teminat düşer.
// - Kripto ve Emtia/Forex için SHORT (düşüşten kazanma) ve kaldıraç (1x-20x) tam desteklenir.
function demoAl(sembolId, ad, fiyat, adet, stopFiyat = null, hedefFiyat = null, yon = 'LONG', kaldirac = 1) {
  if (!fiyat || fiyat <= 0 || !adet || adet <= 0) throw new Error('Geçersiz fiyat veya adet.');
  
  const isShort = String(yon).toUpperCase() === 'SHORT';
  const yonStr = isShort ? 'SHORT' : 'LONG';
  const kOran = Math.max(1, Math.min(20, Math.floor(Number(kaldirac) || 1)));

  const tutar = +(fiyat * adet).toFixed(2);
  const teminat = +(tutar / kOran).toFixed(2);
  const p = portfoyOku();
  const birim = paraBirimiAl(sembolId);

  if (birim === '$') {
    if ((p.bakiyeUSD || 0) < teminat) {
      throw new Error(`Yetersiz USD sanal bakiye! Gerekli Teminat: ${teminat.toLocaleString('tr-TR')} $, Mevcut Bakiye: ${(p.bakiyeUSD || 0).toLocaleString('tr-TR')} $`);
    }
    p.bakiyeUSD = +(p.bakiyeUSD - teminat).toFixed(2);
  } else {
    if ((p.bakiyeTL || 0) < teminat) {
      throw new Error(`Yetersiz TL sanal bakiye! Gerekli Teminat: ${teminat.toLocaleString('tr-TR')} TL, Mevcut Bakiye: ${(p.bakiyeTL || 0).toLocaleString('tr-TR')} TL`);
    }
    p.bakiyeTL = +(p.bakiyeTL - teminat).toFixed(2);
  }

  const poz = {
    id: 'poz-' + Date.now(),
    sembol: sembolId,
    ad: ad || sembolId.split(':')[1],
    yon: yonStr,
    kaldirac: kOran,
    adet: +adet,
    alisFiyat: +fiyat,
    paraBirimi: birim,
    alisTarih: new Date().toISOString(),
    stopFiyat: stopFiyat ? +stopFiyat : null,
    hedefFiyat: hedefFiyat ? +hedefFiyat : null,
    teminat,
    tutar
  };

  p.acikPozisyonlar.push(poz);
  portfoyKaydet(p);
  return { basarili: true, poz, bakiyeTL: p.bakiyeTL, bakiyeUSD: p.bakiyeUSD };
}

// Demo Pozisyon Kapatma (LONG veya SHORT pozisyonu sonlandırır ve kâr/zararı hesaba yansıtır)
function demoSat(pozId, satisFiyat, sebep = 'manuel') {
  if (!satisFiyat || satisFiyat <= 0) throw new Error('Geçersiz satış fiyatı.');
  const p = portfoyOku();
  const idx = p.acikPozisyonlar.findIndex(x => x.id === pozId);
  if (idx === -1) throw new Error('Kapatılacak pozisyon bulunamadı.');

  const poz = p.acikPozisyonlar[idx];
  const birim = poz.paraBirimi || paraBirimiAl(poz.sembol);
  const isShort = poz.yon === 'SHORT';
  const teminat = poz.teminat || +(poz.adet * poz.alisFiyat).toFixed(2);

  // LONG: Fiyat artınca kâr | SHORT: Fiyat düşünce kâr
  const fiyatFarki = isShort ? (poz.alisFiyat - satisFiyat) : (satisFiyat - poz.alisFiyat);
  const karZarar = +(fiyatFarki * poz.adet).toFixed(2);
  const karZararYuzde = teminat > 0 ? +((karZarar / teminat) * 100).toFixed(2) : 0;

  // İade edilen teminat + net kâr/zarar (en az 0, bakiye eksiye inemez)
  const iadeTutar = Math.max(0, +(teminat + karZarar).toFixed(2));

  if (birim === '$') {
    p.bakiyeUSD = +( (p.bakiyeUSD || 0) + iadeTutar ).toFixed(2);
  } else {
    p.bakiyeTL = +( (p.bakiyeTL || 0) + iadeTutar ).toFixed(2);
  }
  p.acikPozisyonlar.splice(idx, 1);

  const kapandi = {
    id: poz.id,
    sembol: poz.sembol,
    ad: poz.ad,
    yon: poz.yon || 'LONG',
    kaldirac: poz.kaldirac || 1,
    adet: poz.adet,
    alisFiyat: poz.alisFiyat,
    satisFiyat: +satisFiyat,
    paraBirimi: birim,
    alisTarih: poz.alisTarih,
    satisTarih: new Date().toISOString(),
    teminat,
    karZarar,
    karZararYuzde,
    sebep
  };

  p.kapananIslemler.unshift(kapandi);
  portfoyKaydet(p);
  return { basarili: true, kapandi, bakiyeTL: p.bakiyeTL, bakiyeUSD: p.bakiyeUSD };
}

// Kasaları Sıfırla (TL ve USD başlangıç değerlerine döner)
function demoSifirla() {
  const baslangic = {
    bakiyeTL: VARSAYILAN_TL_KASA,
    baslangicTL: VARSAYILAN_TL_KASA,
    bakiyeUSD: VARSAYILAN_USD_KASA,
    baslangicUSD: VARSAYILAN_USD_KASA,
    acikPozisyonlar: [],
    kapananIslemler: []
  };
  portfoyKaydet(baslangic);
  return baslangic;
}

// Açık Pozisyonların Güncel Durumu & Kâr/Zarar Özeti
function portfoyOzet(fiyatHaritasi = {}) {
  const p = portfoyOku();
  let hisseDegeriTL = 0;
  let hisseDegeriUSD = 0;

  const pozisyonlar = p.acikPozisyonlar.map(poz => {
    const birim = poz.paraBirimi || paraBirimiAl(poz.sembol);
    const isShort = poz.yon === 'SHORT';
    const anlikFiyat = fiyatHaritasi[poz.sembol] || poz.alisFiyat;
    const teminat = poz.teminat || +(poz.adet * poz.alisFiyat).toFixed(2);

    // LONG: Fiyat artarsa kâr | SHORT: Fiyat düşerse kâr
    const fiyatFarki = isShort ? (poz.alisFiyat - anlikFiyat) : (anlikFiyat - poz.alisFiyat);
    const karZarar = +(fiyatFarki * poz.adet).toFixed(2);
    const karZararYuzde = teminat > 0 ? +((karZarar / teminat) * 100).toFixed(2) : 0;
    const anlikTutar = Math.max(0, +(teminat + karZarar).toFixed(2));

    if (birim === '$') hisseDegeriUSD += anlikTutar;
    else hisseDegeriTL += anlikTutar;

    return {
      ...poz,
      yon: poz.yon || 'LONG',
      kaldirac: poz.kaldirac || 1,
      teminat,
      paraBirimi: birim,
      anlikFiyat: +anlikFiyat,
      anlikTutar,
      karZarar,
      karZararYuzde
    };
  });

  const bakiyeTL = +(p.bakiyeTL ?? p.bakiye ?? VARSAYILAN_TL_KASA).toFixed(2);
  const bakiyeUSD = +(p.bakiyeUSD ?? VARSAYILAN_USD_KASA).toFixed(2);
  const baslangicTL = +(p.baslangicTL ?? p.baslangicBakiye ?? VARSAYILAN_TL_KASA).toFixed(2);
  const baslangicUSD = +(p.baslangicUSD ?? VARSAYILAN_USD_KASA).toFixed(2);

  const toplamVarlikTL = +(bakiyeTL + hisseDegeriTL).toFixed(2);
  const toplamVarlikUSD = +(bakiyeUSD + hisseDegeriUSD).toFixed(2);

  const netKarTL = +(toplamVarlikTL - baslangicTL).toFixed(2);
  const netKarYuzdeTL = baslangicTL > 0 ? +((netKarTL / baslangicTL) * 100).toFixed(2) : 0;

  const netKarUSD = +(toplamVarlikUSD - baslangicUSD).toFixed(2);
  const netKarYuzdeUSD = baslangicUSD > 0 ? +((netKarUSD / baslangicUSD) * 100).toFixed(2) : 0;

  const kapanan = p.kapananIslemler || [];
  const basarili = kapanan.filter(x => (x.karZarar ?? x.karZararTL) > 0).length;
  const basarisiz = kapanan.filter(x => (x.karZarar ?? x.karZararTL) <= 0).length;
  const toplamKapali = kapanan.length;
  const basariOrani = toplamKapali > 0 ? +((basarili / toplamKapali) * 100).toFixed(1) : 0;

  return {
    bakiyeTL,
    bakiyeUSD,
    hisseDegeriTL: +hisseDegeriTL.toFixed(2),
    hisseDegeriUSD: +hisseDegeriUSD.toFixed(2),
    toplamVarlikTL,
    toplamVarlikUSD,
    netKarTL,
    netKarYuzdeTL,
    netKarUSD,
    netKarYuzdeUSD,
    istatistik: { toplamKapali, basarili, basarisiz, basariOrani },
    acikPozisyonlar: pozisyonlar,
    kapananIslemler: kapanan.slice(0, 40)
  };
}

module.exports = { demoAl, demoSat, demoSifirla, portfoyOzet, paraBirimiAl };
