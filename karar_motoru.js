'use strict';

// ============================================================================
// 🎯 HAZIR İŞLEMLER — OTOMATİK NET KARAR MOTORU (2 Aşamalı Süzgeç)
// 1. Aşama: Tüm Kriptolardan BTC Ayrışma + Hacim + Fonlama + MTF ile en iyi 12 adayı seçer
// 2. Aşama: Adayların gerçek 15dk + 1S mumlarını çekip EMA/VWAP/Fisher/Testere(Chop+ADX)/ATR
//           kontrolünden geçirir ve sadece net Giriş / Stop / TP1 / TP2 / Kaldıraç kartları üretir.
// ============================================================================

const V = require('./veri');
const G = require('./gostergeler');

const _onbellek = new Map();
const _mumOnbellek = new Map();

async function binanceHizliMum(sym, interval, limit = 120) {
  const key = `${sym}:${interval}`;
  const hit = _mumOnbellek.get(key);
  if (hit && (Date.now() - hit.ts) < 60_000) return hit.data;

  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const arr = await r.json();
  const mumlar = arr.map(k => ({ t: Math.floor(k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  _mumOnbellek.set(key, { ts: Date.now(), data: mumlar });
  if (_mumOnbellek.size > 120) {
    const ilk = _mumOnbellek.keys().next().value;
    if (ilk) _mumOnbellek.delete(ilk);
  }
  return mumlar;
}

function fisherHesapla(mumlar, len = 9) {
  let val = 0, fish = 0, prevFish = 0;
  for (let i = 0; i < mumlar.length; i++) {
    const bas = Math.max(0, i - len + 1);
    let hi = -Infinity, lo = Infinity;
    for (let j = bas; j <= i; j++) {
      const hl2 = (mumlar[j].h + mumlar[j].l) / 2;
      if (hl2 > hi) hi = hl2;
      if (hl2 < lo) lo = hl2;
    }
    const hl2 = (mumlar[i].h + mumlar[i].l) / 2;
    const raw = 0.66 * ((hl2 - lo) / Math.max(hi - lo, 1e-9) - 0.5) + 0.67 * val;
    val = raw > 0.99 ? 0.999 : (raw < -0.99 ? -0.999 : raw);
    prevFish = fish;
    fish = 0.5 * Math.log((1 + val) / Math.max(1 - val, 1e-4)) + 0.5 * fish;
  }
  return { fish: +fish.toFixed(2), tetik: +prevFish.toFixed(2) };
}

function choppinessHesapla(mumlar, len = 14) {
  if (mumlar.length < len + 2) return 50;
  const son = mumlar.slice(-(len + 1));
  let atrSum = 0, maxH = -Infinity, minL = Infinity;
  for (let i = 1; i < son.length; i++) {
    const m = son[i], p = son[i - 1];
    const tr = Math.max(m.h - m.l, Math.abs(m.h - p.c), Math.abs(m.l - p.c));
    atrSum += tr;
    if (m.h > maxH) maxH = m.h;
    if (m.l < minL) minL = m.l;
  }
  const span = Math.max(maxH - minL, 1e-9);
  const chop = 100 * Math.log10(atrSum / span) / Math.log10(len);
  return Number.isFinite(chop) ? +chop.toFixed(1) : 50;
}

function adxHesapla(mumlar, len = 14) {
  if (mumlar.length < len * 2 + 2) return 18;
  const trs = [], pDms = [], mDms = [];
  for (let i = 1; i < mumlar.length; i++) {
    const m = mumlar[i], p = mumlar[i - 1];
    trs.push(Math.max(m.h - m.l, Math.abs(m.h - p.c), Math.abs(m.l - p.c)));
    const up = m.h - p.h, dn = p.l - m.l;
    pDms.push(up > dn && up > 0 ? up : 0);
    mDms.push(dn > up && dn > 0 ? dn : 0);
  }
  let atrS = 0, pS = 0, mS = 0;
  for (let i = 0; i < len; i++) { atrS += trs[i]; pS += pDms[i]; mS += mDms[i]; }
  const dxs = [];
  for (let i = len; i < trs.length; i++) {
    atrS = atrS - atrS / len + trs[i];
    pS = pS - pS / len + pDms[i];
    mS = mS - mS / len + mDms[i];
    const pDi = atrS > 0 ? (100 * pS / atrS) : 0;
    const mDi = atrS > 0 ? (100 * mS / atrS) : 0;
    const sum = pDi + mDi;
    dxs.push(sum > 0 ? (100 * Math.abs(pDi - mDi) / sum) : 0);
  }
  if (dxs.length < len) return 18;
  let adxVal = dxs.slice(0, len).reduce((a, b) => a + b, 0) / len;
  for (let i = len; i < dxs.length; i++) adxVal = (adxVal * (len - 1) + dxs[i]) / len;
  return Number.isFinite(adxVal) ? +adxVal.toFixed(1) : 18;
}

function gunlukVwapHesapla(mumlar) {
  if (!mumlar.length) return null;
  const sonGun = Math.floor(mumlar[mumlar.length - 1].t / 86400);
  let pv = 0, vv = 0;
  for (let i = mumlar.length - 1; i >= 0; i--) {
    if (Math.floor(mumlar[i].t / 86400) !== sonGun) break;
    const tp = (mumlar[i].h + mumlar[i].l + mumlar[i].c) / 3;
    pv += tp * (mumlar[i].v || 1);
    vv += (mumlar[i].v || 1);
  }
  return vv > 0 ? pv / vv : mumlar[mumlar.length - 1].c;
}

function yuvarlaHassas(fiyat, ref) {
  if (fiyat == null || !Number.isFinite(fiyat)) return null;
  const p = Math.abs(ref || fiyat);
  const d = p >= 1000 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : p >= 0.05 ? 4 : 6;
  return +fiyat.toFixed(d);
}

async function adayiDerinAnalizEt(aday, btcDegisim, btcDurum, vadeliInfo) {
  const sym = (aday.kod + 'USDT').toUpperCase();
  const [m15, m1s] = await Promise.all([
    binanceHizliMum(sym, '15m', 120),
    binanceHizliMum(sym, '1h', 120)
  ]);
  if (!m15 || m15.length < 40 || !m1s || m1s.length < 40) return null;

  const c15 = m15.map(x => x.c), h15 = m15.map(x => x.h), l15 = m15.map(x => x.l);
  const c1s = m1s.map(x => x.c);

  const fiyat = c15[c15.length - 1];
  const e20_15 = G.ema(c15, 20).at(-1);
  const e50_15 = G.ema(c15, 50).at(-1);
  const e20_1s = G.ema(c1s, 20).at(-1);
  const e50_1s = G.ema(c1s, 50).at(-1);
  const rsi15 = G.rsi(c15, 14).at(-1) ?? 50;
  const atr15 = G.atr(h15, l15, c15, 14).at(-1) ?? (fiyat * 0.01);
  const adx15 = adxHesapla(m15, 14);
  const chop15 = choppinessHesapla(m15, 14);
  const vwap15 = gunlukVwapHesapla(m15) ?? fiyat;
  const fish15 = fisherHesapla(m15, 9);
  const fish1s = fisherHesapla(m1s, 9);

  // Testere Kilidi: Yatay sıkışık piyasada işlem üretme
  const testere = chop15 >= 60.5 && adx15 < 15.5;
  if (testere) return null;

  const deg = aday.degisim ?? 0;
  const btcFark = +(deg - btcDegisim).toFixed(2);
  const alis = aday.hacimAkisi?.alisYuzde ?? 50;
  const satis = aday.hacimAkisi?.satisYuzde ?? 50;
  const gh = aday.goreceliHacim ?? 1;
  const tv = aday.tv || {};
  const fundingPct = vadeliInfo?.fundingPct ?? null;
  const oiUsd = vadeliInfo?.oiUsd ?? null;
  const oiDegisimPct = vadeliInfo?.oiDegisimPct ?? null;

  // Son 24 mumun gerçek destek / direnç seviyeleri
  const sonDestek = Math.min(...l15.slice(-24));
  const sonDirenc = Math.max(...h15.slice(-24));

  // LONG ve SHORT puanlarını bağımsız hesapla
  let longPuan = 0, shortPuan = 0;
  const longNeden = [], shortNeden = [];

  // 1. MTF Yön (Max 28)
  if ((tv.s15 ?? 0) > 0.1) { longPuan += 9; }
  if ((tv.s1 ?? 0) > 0.1) { longPuan += 10; }
  if ((tv.s4 ?? 0) > 0.05) { longPuan += 9; }
  if ((tv.s15 ?? 0) > 0.1 && (tv.s1 ?? 0) > 0.1) longNeden.push('15d + 1S Yükseliş Uyumlu');

  if ((tv.s15 ?? 0) < -0.1) { shortPuan += 9; }
  if ((tv.s1 ?? 0) < -0.1) { shortPuan += 10; }
  if ((tv.s4 ?? 0) < -0.05) { shortPuan += 9; }
  if ((tv.s15 ?? 0) < -0.1 && (tv.s1 ?? 0) < -0.1) shortNeden.push('15d + 1S Düşüş Uyumlu');

  // 2. Gerçek Mum EMA & VWAP (Max 22)
  if (fiyat > vwap15) { longPuan += 8; longNeden.push('VWAP Üstü'); }
  if (fiyat > e20_15 && e20_15 >= e50_15 * 0.996) { longPuan += 7; }
  if (fiyat > e50_1s && e20_1s >= e50_1s * 0.995) { longPuan += 7; longNeden.push('1S EMA50 Üstü'); }

  if (fiyat < vwap15) { shortPuan += 8; shortNeden.push('VWAP Altı'); }
  if (fiyat < e20_15 && e20_15 <= e50_15 * 1.004) { shortPuan += 7; }
  if (fiyat < e50_1s && e20_1s <= e50_1s * 1.005) { shortPuan += 7; shortNeden.push('1S EMA50 Altı'); }

  // 3. Fisher Dönüşümü (Max 16)
  if (fish15.fish > fish15.tetik) {
    longPuan += 10;
    if (fish15.tetik <= -0.8) { longPuan += 6; longNeden.push('Fisher Dip Dönüşü'); }
    else longNeden.push('Fisher Yukarı');
  } else if (fish1s.fish > fish1s.tetik) {
    longPuan += 5;
  }

  if (fish15.fish < fish15.tetik) {
    shortPuan += 10;
    if (fish15.tetik >= 0.8) { shortPuan += 6; shortNeden.push('Fisher Tepe Dönüşü'); }
    else shortNeden.push('Fisher Aşağı');
  } else if (fish1s.fish < fish1s.tetik) {
    shortPuan += 5;
  }

  // 4. BTC Ayrışma & Vadeli (Fonlama/OI) Avantajı (Max 18)
  if (btcFark >= 1.2) { longPuan += 9; longNeden.push(`BTC'den +%${btcFark} Güçlü`); }
  else if (btcDurum === 'yukseliyor' && btcFark >= 0) { longPuan += 5; }
  if (fundingPct != null && fundingPct <= -0.015) { longPuan += 9; longNeden.push(`Short Squeeze (%${fundingPct.toFixed(3)})`); }
  else if (fundingPct != null && fundingPct >= 0.04) { longPuan -= 18; } // Aşırı long şişmesi cezası

  if (btcFark <= -1.2) { shortPuan += 9; shortNeden.push(`BTC'den %${btcFark} Zayıf`); }
  else if (btcDurum === 'dusuyor' && btcFark <= 0) { shortPuan += 5; }
  if (fundingPct != null && fundingPct >= 0.025) { shortPuan += 9; shortNeden.push(`Long Şişmesi (+%${fundingPct.toFixed(3)})`); }
  else if (fundingPct != null && fundingPct <= -0.04) { shortPuan -= 18; } // Short squeeze riski cezası

  // 5. Hacim & Baskı & Trend Gücü (Max 16)
  if (alis >= 56) { longPuan += 6; longNeden.push(`Alış Baskısı %${alis}`); }
  if (satis >= 56) { shortPuan += 6; shortNeden.push(`Satış Baskısı %${satis}`); }
  if (gh >= 1.15) { longPuan += 5; shortPuan += 5; }
  if (adx15 >= 19 && chop15 < 55) { longPuan += 5; shortPuan += 5; }

  // 6. Anti-FOMO ve RSI Güvenlik Filtresi
  const ema20Mesafe = e20_15 > 0 ? ((fiyat - e20_15) / e20_15) * 100 : 0;
  if (rsi15 > 73 || ema20Mesafe > 3.2) longPuan -= 22;
  if (rsi15 < 27 || ema20Mesafe < -3.2) shortPuan -= 22;

  const yon = longPuan >= shortPuan ? 'LONG' : 'SHORT';
  const puan = Math.max(0, Math.min(100, yon === 'LONG' ? longPuan : shortPuan));
  if (puan < 64) return null;

  // Stop / TP1 / TP2 / Giriş Bölgesi Hesabı
  const minRisk = fiyat * 0.008;
  const maxRisk = fiyat * 0.042;
  let stop, tp1, tp2, girisAlt, girisUst, girisNot;

  if (yon === 'LONG') {
    const atrStop = fiyat - atr15 * 1.6;
    const destekStop = sonDestek < fiyat ? sonDestek * 0.997 : atrStop;
    const hamStop = (fiyat - destekStop) <= maxRisk && (fiyat - destekStop) >= minRisk ? destekStop : atrStop;
    const risk = Math.max(minRisk, Math.min(maxRisk, fiyat - hamStop));
    stop = fiyat - risk;
    tp1 = fiyat + risk * 1.6;
    tp2 = fiyat + risk * 2.6;
    const idealGiris = Math.min(fiyat, Math.max(stop + risk * 0.35, Math.max(e20_15, vwap15)));
    girisAlt = idealGiris;
    girisUst = fiyat;
    girisNot = ema20Mesafe > 1.2 ? 'Ufak geri çekilmede kademeli limit' : 'Anlık fiyattan / destek bölgesinden giriş uygun';
  } else {
    const atrStop = fiyat + atr15 * 1.6;
    const direncStop = sonDirenc > fiyat ? sonDirenc * 1.003 : atrStop;
    const hamStop = (direncStop - fiyat) <= maxRisk && (direncStop - fiyat) >= minRisk ? direncStop : atrStop;
    const risk = Math.max(minRisk, Math.min(maxRisk, hamStop - fiyat));
    stop = fiyat + risk;
    tp1 = fiyat - risk * 1.6;
    tp2 = fiyat - risk * 2.6;
    const idealGiris = Math.max(fiyat, Math.min(stop - risk * 0.35, Math.min(e20_15, vwap15)));
    girisAlt = fiyat;
    girisUst = idealGiris;
    girisNot = ema20Mesafe < -1.2 ? 'Ufak tepki yükselişinde kademeli limit' : 'Anlık fiyattan / direnç bölgesinden giriş uygun';
  }

  const riskPct = +((Math.abs(fiyat - stop) / fiyat) * 100).toFixed(2);
  const tp1Pct = +((Math.abs(tp1 - fiyat) / fiyat) * 100).toFixed(2);
  const tp2Pct = +((Math.abs(tp2 - fiyat) / fiyat) * 100).toFixed(2);
  const guvenliKaldirac = Math.max(2, Math.min(10, Math.floor(15 / Math.max(riskPct, 0.8))));

  return {
    id: aday.id,
    kod: aday.kod,
    ad: aday.ad,
    yon,
    puan,
    okxVar: (aday.borsalar || []).includes('OKX') || !!vadeliInfo?.okxSwap,
    fiyat: yuvarlaHassas(fiyat, fiyat),
    girisAlt: yuvarlaHassas(girisAlt, fiyat),
    girisUst: yuvarlaHassas(girisUst, fiyat),
    girisNot,
    stop: yuvarlaHassas(stop, fiyat),
    tp1: yuvarlaHassas(tp1, fiyat),
    tp2: yuvarlaHassas(tp2, fiyat),
    riskPct,
    tp1Pct,
    tp2Pct,
    rr: 2.6,
    guvenliKaldirac,
    degisim: +deg.toFixed(2),
    btcFark,
    alisPct: alis,
    satisPct: satis,
    gh: +gh.toFixed(2),
    rsi15: Math.round(rsi15),
    adx15: Math.round(adx15),
    chop15,
    fisher15: fish15,
    fundingPct,
    oiUsd,
    oiDegisimPct,
    nedenler: (yon === 'LONG' ? longNeden : shortNeden).slice(0, 5)
  };
}

async function hazirIslemleriBul({ sadeceOkx = true, zorla = false } = {}) {
  const key = sadeceOkx ? 'okx' : 'hepsi';
  const hit = _onbellek.get(key);
  if (!zorla && hit && (Date.now() - hit.ts) < 90_000) {
    return { ...hit.data, onbellekten: true };
  }

  const [kriptolar, btcCanli, vadeli] = await Promise.all([
    V.tumKriptoTara(),
    V.canliTekFiyat('BINANCE:BTCUSDT').catch(() => null),
    V.vadeliPiyasaHaritasi().catch(() => ({}))
  ]);

  const btcSatir = (kriptolar || []).find(x => x.kod === 'BTC' || x.id === 'BINANCE:BTCUSDT');
  const btcFiyat = btcCanli?.fiyat ?? btcSatir?.fiyat ?? null;
  const btcDegisim = btcCanli?.degisim ?? btcSatir?.degisim ?? 0;
  const btcDurum = btcDegisim <= -0.35 ? 'dusuyor' : (btcDegisim >= 0.35 ? 'yukseliyor' : 'yatay');

  // 1. Aşama: Hızlı aday ön elemesi (en güçlü 12 adayı seç)
  const havuz = (kriptolar || []).filter(r => {
    if (!r || r.kod === 'BTC' || r.id === 'BINANCE:BTCUSDT') return false;
    if ((r.usdHacim || 0) < 2_500_000) return false;
    if (Math.abs(r.degisim || 0) > 15) return false; // Aşırı uçmuş FOMO'yu ele
    const sym = (r.kod + 'USDT').toUpperCase();
    const okxVar = (r.borsalar || []).includes('OKX') || !!vadeli?.[sym]?.okxSwap;
    if (sadeceOkx && !okxVar) return false;
    return true;
  });

  const onSkorla = r => {
    const sym = (r.kod + 'USDT').toUpperCase();
    const vInfo = vadeli?.[sym] || {};
    const deg = r.degisim || 0;
    const btcFark = deg - btcDegisim;
    const alis = r.hacimAkisi?.alisYuzde ?? 50;
    const satis = r.hacimAkisi?.satisYuzde ?? 50;
    const tv = r.tv || {};
    const gh = r.goreceliHacim || 1;
    const fr = vInfo.fundingPct ?? 0;

    const lSkor = (btcFark > 0 ? btcFark * 4 : 0) + (alis - 50) * 1.2 + ((tv.s15 || 0) + (tv.s1 || 0)) * 25 + (fr <= -0.015 ? 20 : 0) + gh * 6;
    const sSkor = (btcFark < 0 ? Math.abs(btcFark) * 4 : 0) + (satis - 50) * 1.2 + (-(tv.s15 || 0) - (tv.s1 || 0)) * 25 + (fr >= 0.025 ? 18 : 0) + gh * 6;
    return { r, lSkor, sSkor, maxSkor: Math.max(lSkor, sSkor) };
  };

  const skorlu = havuz.map(onSkorla);
  const enIyiLong = [...skorlu].sort((a, b) => b.lSkor - a.lSkor).slice(0, 7).map(x => x.r);
  const enIyiShort = [...skorlu].sort((a, b) => b.sSkor - a.sSkor).slice(0, 5).map(x => x.r);
  const benzersiz = new Map();
  [...enIyiLong, ...enIyiShort].forEach(r => benzersiz.set(r.id, r));
  const adaylar = [...benzersiz.values()].slice(0, 12);

  // 2. Aşama: 4'lü paralel gruplarla gerçek 15dk + 1S mum analizi
  const netIslemler = [];
  for (let i = 0; i < adaylar.length; i += 4) {
    const grup = adaylar.slice(i, i + 4);
    const sonuclar = await Promise.all(grup.map(a => {
      const sym = (a.kod + 'USDT').toUpperCase();
      return adayiDerinAnalizEt(a, btcDegisim, btcDurum, vadeli?.[sym]).catch(() => null);
    }));
    sonuclar.forEach(s => { if (s) netIslemler.push(s); });
  }

  netIslemler.sort((a, b) => b.puan - a.puan);
  const ilkAlti = netIslemler.slice(0, 6);

  const sonuc = {
    zaman: new Date().toISOString(),
    tarananCoin: havuz.length,
    derinIncelenen: adaylar.length,
    netSayi: ilkAlti.length,
    btc: { fiyat: btcFiyat, degisim: +btcDegisim.toFixed(2), durum: btcDurum },
    islemler: ilkAlti
  };

  _onbellek.set(key, { ts: Date.now(), data: sonuc });
  return { ...sonuc, onbellekten: false };
}

module.exports = { hazirIslemleriBul };
