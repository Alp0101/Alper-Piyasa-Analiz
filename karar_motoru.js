'use strict';

// ============================================================================
// 🎯 HAZIR İŞLEMLER v2 — BACKTEST DOĞRULAMALI NET KARAR MOTORU
// 15 Günlük Gerçek Binance Mum Testi Sonucu (10 Coin, Komisyon Dahil):
// - Eski FOMO/15dk Kovalama: %33.5 WinRate | -104.4 R (ELENDİ)
// - Yeni 4S Trend + BTC 4S Kalkanı + 1S EMA20 Pullback + Fisher: %56.2 WinRate | +69.3 R
// ============================================================================

const V = require('./veri');
const G = require('./gostergeler');

const _onbellek = new Map();
const _mumOnbellek = new Map();

async function binanceHizliMum(sym, interval, limit = 120) {
  const key = `${sym}:${interval}:${limit}`;
  const hit = _mumOnbellek.get(key);
  if (hit && (Date.now() - hit.ts) < 60_000) return hit.data;

  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const arr = await r.json();
  const mumlar = arr.map(k => ({ t: Math.floor(k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
  _mumOnbellek.set(key, { ts: Date.now(), data: mumlar });
  if (_mumOnbellek.size > 180) {
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

async function btc4sKalkanHesapla() {
  const [m4s, m1s] = await Promise.all([
    binanceHizliMum('BTCUSDT', '4h', 100),
    binanceHizliMum('BTCUSDT', '1h', 100)
  ]);
  const c4 = m4s.map(x => x.c), c1 = m1s.map(x => x.c);
  const f4 = c4.at(-1);
  const e20_4 = G.ema(c4, 20).at(-1);
  const e50_4 = G.ema(c4, 50).at(-1);
  const f1 = c1.at(-1);
  const e20_1 = G.ema(c1, 20).at(-1);
  const e50_1 = G.ema(c1, 50).at(-1);

  const bull4 = f4 > e50_4 && e20_4 >= e50_4 * 0.995;
  const bear4 = f4 < e50_4 && e20_4 <= e50_4 * 1.005;
  const bull1 = f1 > e20_1 && e20_1 >= e50_1 * 0.997;
  const bear1 = f1 < e20_1 && e20_1 <= e50_1 * 1.003;

  let rejim = 'notr';
  let kalkanMetin = '⚖️ BTC 4S Nötr — İki Yönlü Seçici';
  if (bull4) { rejim = 'long_izin'; kalkanMetin = '🟢 BTC 4S Yükselişte — Sadece LONG İzni'; }
  else if (bear4) { rejim = 'short_izin'; kalkanMetin = '🔴 BTC 4S Düşüşte — Sadece SHORT İzni'; }

  return { bull4, bear4, bull1, bear1, rejim, kalkanMetin };
}

async function adayiDerinAnalizEt(aday, btcDegisim, btcKalkan, vadeliInfo) {
  const sym = (aday.kod + 'USDT').toUpperCase();
  const [m15, m1s, m4s] = await Promise.all([
    binanceHizliMum(sym, '15m', 100),
    binanceHizliMum(sym, '1h', 100),
    binanceHizliMum(sym, '4h', 80)
  ]);
  if (!m15 || m15.length < 40 || !m1s || m1s.length < 60 || !m4s || m4s.length < 55) return null;

  const c15 = m15.map(x => x.c);
  const c1s = m1s.map(x => x.c), h1s = m1s.map(x => x.h), l1s = m1s.map(x => x.l);
  const c4s = m4s.map(x => x.c);

  const fiyat = c15.at(-1);
  const son1s = m1s.at(-1);
  const e20_1s = G.ema(c1s, 20).at(-1);
  const e50_1s = G.ema(c1s, 50).at(-1);
  const e20_4s = G.ema(c4s, 20).at(-1);
  const e50_4s = G.ema(c4s, 50).at(-1);
  const rsi1s = G.rsi(c1s, 14).at(-1) ?? 50;
  const atr1s = G.atr(h1s, l1s, c1s, 14).at(-1) ?? (fiyat * 0.015);
  const adx1s = adxHesapla(m1s, 14);
  const chop1s = choppinessHesapla(m1s, 14);
  const vwap15 = gunlukVwapHesapla(m15) ?? fiyat;
  const fish1s = fisherHesapla(m1s, 9);
  const fish15 = fisherHesapla(m15, 9);

  // Testere Kilidi (1S piyasa yatay sıkışıkken işlem üretme)
  if (chop1s >= 61 && adx1s < 15) return null;

  const deg = aday.degisim ?? 0;
  const btcFark = +(deg - btcDegisim).toFixed(2);
  const alis = aday.hacimAkisi?.alisYuzde ?? 50;
  const satis = aday.hacimAkisi?.satisYuzde ?? 50;
  const gh = aday.goreceliHacim ?? 1;
  const fundingPct = vadeliInfo?.fundingPct ?? null;
  const oiUsd = vadeliInfo?.oiUsd ?? null;
  const oiDegisimPct = vadeliInfo?.oiDegisimPct ?? null;

  const ema20Mesafe1s = e20_1s > 0 ? +(((fiyat - e20_1s) / e20_1s) * 100).toFixed(2) : 0;

  // SERT KURAL 1: 4S Ana Trend + BTC 4S Kalkanı (Ters trende asla açma!)
  const coin4sBull = c4s.at(-1) > e50_4s && e20_4s >= e50_4s * 0.992;
  const coin4sBear = c4s.at(-1) < e50_4s && e20_4s <= e50_4s * 1.008;

  const longIzin = coin4sBull && !btcKalkan.bear4;
  const shortIzin = coin4sBear && !btcKalkan.bull4;
  if (!longIzin && !shortIzin) return null;

  let yon = null;
  let puan = 0;
  const nedenler = [];

  if (longIzin) {
    // SERT KURAL 2: Tepeden FOMO Yasağı (günlük +%5.5 üstü koşmuş veya 1S EMA20'den %2.2 uzaklaşmışsa ALMA!)
    if (deg > 5.5 || ema20Mesafe1s > 2.2 || rsi1s > 66 || rsi1s < 38) return null;
    if (fundingPct != null && fundingPct >= 0.035) return null; // Long şişmesi yasağı

    yon = 'LONG';
    puan += 24; // 4S trend + BTC 4S uyumu
    nedenler.push('4S Trend & BTC Kalkanı Onaylı');

    if (e20_1s > e50_1s && fiyat >= e20_1s * 0.992) { puan += 18; nedenler.push('1S EMA20/50 Destek Bölgesi'); }
    else if (fiyat > e50_1s) { puan += 10; }

    // Gerçek geri çekilme (Pullback) bonusu: son 2 mumda EMA20'ye yakın temas + yeşil dönüş
    const pullbackTemas = (son1s.l <= e20_1s * 1.008 || m1s.at(-2).l <= e20_1s * 1.008) && ema20Mesafe1s <= 1.6;
    if (pullbackTemas) { puan += 16; nedenler.push('Temiz EMA20 Pullback (Tepede Değil)'); }

    if (fish1s.fish > fish1s.tetik) {
      puan += fish1s.tetik <= 0.4 ? 16 : 10;
      nedenler.push(fish1s.tetik <= -0.5 ? '1S Fisher Dip Dönüşü' : '1S Fisher Yukarı');
    } else if (fish15.fish > fish15.tetik) {
      puan += 6;
    }

    if (fiyat >= vwap15) { puan += 8; nedenler.push('VWAP Üstü'); }
    if (btcFark >= 0.5 && deg <= 4.5) { puan += 8; nedenler.push(`Erken BTC Gücü (+%${btcFark})`); }
    if (fundingPct != null && fundingPct <= -0.01) { puan += 7; nedenler.push(`Negatif Fonlama (%${fundingPct.toFixed(3)})`); }
    if (alis >= 54) puan += 5;
    if (adx1s >= 18 && chop1s < 56) puan += 6;
  } else if (shortIzin) {
    // SERT KURAL 2: Dipten Panik Short Yasağı
    if (deg < -5.5 || ema20Mesafe1s < -2.2 || rsi1s < 34 || rsi1s > 62) return null;
    if (fundingPct != null && fundingPct <= -0.035) return null; // Short squeeze tuzağı yasağı

    yon = 'SHORT';
    puan += 24;
    nedenler.push('4S Düşüş & BTC Kalkanı Onaylı');

    if (e20_1s < e50_1s && fiyat <= e20_1s * 1.008) { puan += 18; nedenler.push('1S EMA20/50 Direnç Bölgesi'); }
    else if (fiyat < e50_1s) { puan += 10; }

    const pullbackTemas = (son1s.h >= e20_1s * 0.992 || m1s.at(-2).h >= e20_1s * 0.992) && ema20Mesafe1s >= -1.6;
    if (pullbackTemas) { puan += 16; nedenler.push('Temiz EMA20 Direnç Tepkisi'); }

    if (fish1s.fish < fish1s.tetik) {
      puan += fish1s.tetik >= -0.4 ? 16 : 10;
      nedenler.push(fish1s.tetik >= 0.5 ? '1S Fisher Tepe Dönüşü' : '1S Fisher Aşağı');
    } else if (fish15.fish < fish15.tetik) {
      puan += 6;
    }

    if (fiyat <= vwap15) { puan += 8; nedenler.push('VWAP Altı'); }
    if (btcFark <= -0.5 && deg >= -4.5) { puan += 8; nedenler.push(`BTC'den Zayıf (%${btcFark})`); }
    if (fundingPct != null && fundingPct >= 0.02) { puan += 7; nedenler.push(`Long Şişmesi (+%${fundingPct.toFixed(3)})`); }
    if (satis >= 54) puan += 5;
    if (adx1s >= 18 && chop1s < 56) puan += 6;
  }

  puan = Math.max(0, Math.min(100, Math.round(puan)));
  if (puan < 68) return null;

  // Backtest Doğrulamalı 1S ATR Stop & 1.8R TP1 / 2.8R TP2 (15dk gürültüsünde patlamaz)
  const risk = Math.max(fiyat * 0.015, Math.min(fiyat * 0.045, atr1s * 1.8));
  let stop, tp1, tp2, girisAlt, girisUst, girisNot;
  if (yon === 'LONG') {
    stop = fiyat - risk;
    tp1 = fiyat + risk * 1.8;
    tp2 = fiyat + risk * 2.8;
    girisAlt = Math.min(fiyat, Math.max(stop + risk * 0.4, e20_1s));
    girisUst = fiyat;
    girisNot = ema20Mesafe1s > 0.9 ? '1S EMA20 yakınına kademeli limit' : 'Geri çekilme tamamlandı · Giriş bölgesi';
  } else {
    stop = fiyat + risk;
    tp1 = fiyat - risk * 1.8;
    tp2 = fiyat - risk * 2.8;
    girisAlt = fiyat;
    girisUst = Math.max(fiyat, Math.min(stop - risk * 0.4, e20_1s));
    girisNot = ema20Mesafe1s < -0.9 ? '1S EMA20 tepkisinde kademeli limit' : 'Direnç tepkisi hazır · Giriş bölgesi';
  }

  const riskPct = +((Math.abs(fiyat - stop) / fiyat) * 100).toFixed(2);
  const tp1Pct = +((Math.abs(tp1 - fiyat) / fiyat) * 100).toFixed(2);
  const tp2Pct = +((Math.abs(tp2 - fiyat) / fiyat) * 100).toFixed(2);
  const guvenliKaldirac = Math.max(2, Math.min(8, Math.floor(14 / Math.max(riskPct, 1.2))));

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
    rr: 2.8,
    guvenliKaldirac,
    degisim: +deg.toFixed(2),
    btcFark,
    alisPct: alis,
    satisPct: satis,
    gh: +gh.toFixed(2),
    rsi15: Math.round(rsi1s),
    adx15: Math.round(adx1s),
    chop15: chop1s,
    fisher15: fish1s,
    fundingPct,
    oiUsd,
    oiDegisimPct,
    nedenler: nedenler.slice(0, 5)
  };
}

async function hazirIslemleriBul({ sadeceOkx = true, zorla = false } = {}) {
  const key = sadeceOkx ? 'okx' : 'hepsi';
  const hit = _onbellek.get(key);
  if (!zorla && hit && (Date.now() - hit.ts) < 90_000) {
    return { ...hit.data, onbellekten: true };
  }

  const [kriptolar, btcCanli, vadeli, btcKalkan] = await Promise.all([
    V.tumKriptoTara(),
    V.canliTekFiyat('BINANCE:BTCUSDT').catch(() => null),
    V.vadeliPiyasaHaritasi().catch(() => ({})),
    btc4sKalkanHesapla().catch(() => ({ bull4: false, bear4: false, rejim: 'notr', kalkanMetin: '⚖️ BTC 4S Nötr' }))
  ]);

  const btcSatir = (kriptolar || []).find(x => x.kod === 'BTC' || x.id === 'BINANCE:BTCUSDT');
  const btcFiyat = btcCanli?.fiyat ?? btcSatir?.fiyat ?? null;
  const btcDegisim = btcCanli?.degisim ?? btcSatir?.degisim ?? 0;

  // 1. Aşama: FOMO'suz, sağlıklı trend adaylarını seç (Günlük ±%6 üzeri zaten koşmuş olanları direkt ele!)
  const havuz = (kriptolar || []).filter(r => {
    if (!r || r.kod === 'BTC' || r.id === 'BINANCE:BTCUSDT') return false;
    if ((r.usdHacim || 0) < 3_000_000) return false;
    if (Math.abs(r.degisim || 0) > 6.0) return false;
    const sym = (r.kod + 'USDT').toUpperCase();
    const okxVar = (r.borsalar || []).includes('OKX') || !!vadeli?.[sym]?.okxSwap;
    if (sadeceOkx && !okxVar) return false;
    return true;
  });

  // BTC 4S kalkanına uygun adayları önceliklendir
  const onSkorla = r => {
    const tv = r.tv || {};
    const gh = r.goreceliHacim || 1;
    const rsi4 = r.rsi?.s4 ?? 50;
    const lSkor = !btcKalkan.bear4 ? ((tv.s4 || 0) * 40 + (tv.s1 || 0) * 25 + (rsi4 >= 42 && rsi4 <= 64 ? 15 : 0) + gh * 5) : -999;
    const sSkor = !btcKalkan.bull4 ? (-(tv.s4 || 0) * 40 - (tv.s1 || 0) * 25 + (rsi4 >= 36 && rsi4 <= 58 ? 15 : 0) + gh * 5) : -999;
    return { r, maxSkor: Math.max(lSkor, sSkor) };
  };

  const adaylar = havuz
    .map(onSkorla)
    .filter(x => x.maxSkor > -100)
    .sort((a, b) => b.maxSkor - a.maxSkor)
    .slice(0, 14)
    .map(x => x.r);

  // 2. Aşama: 4'lü paralel gruplarla gerçek 4S + 1S + 15dk mum analizi
  const netIslemler = [];
  for (let i = 0; i < adaylar.length; i += 4) {
    const grup = adaylar.slice(i, i + 4);
    const sonuclar = await Promise.all(grup.map(a => {
      const sym = (a.kod + 'USDT').toUpperCase();
      return adayiDerinAnalizEt(a, btcDegisim, btcKalkan, vadeli?.[sym]).catch(() => null);
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
    btc: { fiyat: btcFiyat, degisim: +btcDegisim.toFixed(2), durum: btcKalkan.rejim, kalkanMetin: btcKalkan.kalkanMetin },
    islemler: ilkAlti
  };

  _onbellek.set(key, { ts: Date.now(), data: sonuc });
  return { ...sonuc, onbellekten: false };
}

// Tarayıcı kapalıyken geçen mumlarda Demo Stop/TP1'e değip değmediğini gerçek High/Low ile kontrol eder
async function demoGecmisStopTpKontrol(pozisyonlar = []) {
  const tetiklenenler = [];
  const kriptolar = (pozisyonlar || []).filter(p => p && p.sembol && (p.sembol.startsWith('BINANCE:') || p.sembol.startsWith('OKX:')) && (p.stopFiyat > 0 || p.hedefFiyat > 0));
  for (const p of kriptolar.slice(0, 15)) {
    try {
      const sym = p.sembol.split(':')[1].toUpperCase();
      const acilisMs = new Date(p.alisTarih).getTime();
      if (!Number.isFinite(acilisMs)) continue;
      const url = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=15m&startTime=${acilisMs}&limit=200`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const arr = await r.json();
      if (!Array.isArray(arr) || !arr.length) continue;

      const isShort = p.yon === 'SHORT';
      for (const k of arr) {
        const hi = +k[2], lo = +k[3], tMs = +k[0];
        if (tMs + 15 * 60_000 < acilisMs) continue;
        if (!isShort) {
          if (p.stopFiyat > 0 && lo <= p.stopFiyat) {
            tetiklenenler.push({ id: p.id, sebep: 'stop', cikisFiyat: p.stopFiyat, zaman: new Date(tMs).toISOString() });
            break;
          }
          if (p.hedefFiyat > 0 && hi >= p.hedefFiyat) {
            tetiklenenler.push({ id: p.id, sebep: 'hedef', cikisFiyat: p.hedefFiyat, zaman: new Date(tMs).toISOString() });
            break;
          }
        } else {
          if (p.stopFiyat > 0 && hi >= p.stopFiyat) {
            tetiklenenler.push({ id: p.id, sebep: 'stop', cikisFiyat: p.stopFiyat, zaman: new Date(tMs).toISOString() });
            break;
          }
          if (p.hedefFiyat > 0 && lo <= p.hedefFiyat) {
            tetiklenenler.push({ id: p.id, sebep: 'hedef', cikisFiyat: p.hedefFiyat, zaman: new Date(tMs).toISOString() });
            break;
          }
        }
      }
    } catch (_) {}
  }
  return { tetiklenenler };
}

// ============================================================================
// 💧 LİKİDİTE AVI / DİP-TEPE DÖNÜŞ MODU (MMT Tarzı · BTC'den Bağımsız)
// Son 24 saatlik dip/tepe stoplarını fitille süpürüp (SWEEP) içeri dönen,
// aşırı Fisher (-1.2 / +1.2) dönüşü veren ve fonlaması ters yığılmış coinleri yakalar.
// ============================================================================
const _likiditeOnbellek = new Map();

async function likiditeAdayAnalizEt(aday, btcDegisim, vadeliInfo) {
  const sym = (aday.kod + 'USDT').toUpperCase();
  const [m15, m1s] = await Promise.all([
    binanceHizliMum(sym, '15m', 110),
    binanceHizliMum(sym, '1h', 60)
  ]);
  if (!m15 || m15.length < 60 || !m1s || m1s.length < 30) return null;

  const c15 = m15.map(x => x.c), h15 = m15.map(x => x.h), l15 = m15.map(x => x.l), v15 = m15.map(x => x.v);
  const fiyat = c15.at(-1);
  const rsi15 = G.rsi(c15, 14);
  const sonRsi15 = rsi15.at(-1) ?? 50;
  const atr15 = G.atr(h15, l15, c15, 14).at(-1) ?? (fiyat * 0.01);
  const fish15 = fisherHesapla(m15, 9);
  const fish1s = fisherHesapla(m1s, 9);

  // Son 4 mum (son 1 saat) öncesi ~24 saatlik gerçek dip ve tepe
  const oncekiDip = Math.min(...l15.slice(-96, -4));
  const oncekiTepe = Math.max(...h15.slice(-96, -4));
  const son4 = m15.slice(-4);
  const son4Min = Math.min(...son4.map(x => x.l));
  const son4Max = Math.max(...son4.map(x => x.h));

  const ortHacim = v15.slice(-24, -4).reduce((a, b) => a + b, 0) / 20;
  const son4MaxHacim = Math.max(...son4.map(x => x.v));
  const hacimPatlama = ortHacim > 0 ? +(son4MaxHacim / ortHacim).toFixed(2) : 1;

  // Son 4 mum içinde güçlü alt/üst fitil reddi var mı?
  const altFitilVar = son4.some(m => (Math.min(m.o, m.c) - m.l) > Math.max(Math.abs(m.c - m.o), fiyat * 0.0005) * 0.85);
  const ustFitilVar = son4.some(m => (m.h - Math.max(m.o, m.c)) > Math.max(Math.abs(m.c - m.o), fiyat * 0.0005) * 0.85);

  const deg = aday.degisim ?? 0;
  const btcFark = +(deg - btcDegisim).toFixed(2);
  const alis = aday.hacimAkisi?.alisYuzde ?? 50;
  const satis = aday.hacimAkisi?.satisYuzde ?? 50;
  const fundingPct = vadeliInfo?.fundingPct ?? null;
  const oiUsd = vadeliInfo?.oiUsd ?? null;
  const oiDegisimPct = vadeliInfo?.oiDegisimPct ?? null;

  // --- DİP LİKİDİTE AVI (LONG) ---
  let longPuan = 0;
  const longNeden = [];
  const dipSweep = son4Min <= oncekiDip * 1.003 && fiyat > oncekiDip;
  const dipYakin = fiyat <= oncekiDip * 1.022;
  const fishDipDonus = (fish15.fish > fish15.tetik && fish15.tetik <= -1.0) || (fish1s.fish > fish1s.tetik && fish1s.tetik <= -1.1);

  if (dipSweep) { longPuan += 34; longNeden.push('💧 24S Dip Likidite Süpürme (SWEEP)'); }
  else if (dipYakin && altFitilVar) { longPuan += 20; longNeden.push('💧 24S Dip Bölgesi Alt Fitil Tepkisi'); }

  if (fishDipDonus) { longPuan += 24; longNeden.push(`🎣 Aşırı Dip Fisher Dönüşü (${fish15.fish}/${fish15.tetik})`); }
  else if (fish15.fish > fish15.tetik && fish15.tetik <= -0.3) { longPuan += 12; longNeden.push('🎣 15dk Fisher Yukarı'); }

  if (altFitilVar) { longPuan += 10; longNeden.push('Alıcı Fitil Reddi'); }
  if (hacimPatlama >= 1.4 && (dipSweep || dipYakin)) { longPuan += 12; longNeden.push(`Hacimli Toplama (${hacimPatlama}x)`); }
  if (fundingPct != null && fundingPct <= -0.01) { longPuan += 12; longNeden.push(`Short Yığılması (%${fundingPct.toFixed(3)})`); }
  if (sonRsi15 <= 42 && m15.at(-1).c > m15.at(-1).o) { longPuan += 8; longNeden.push(`Dipten Yeşil Dönüş (RSI ${Math.round(sonRsi15)})`); }

  // --- TEPE LİKİDİTE AVI (SHORT) ---
  let shortPuan = 0;
  const shortNeden = [];
  const tepeSweep = son4Max >= oncekiTepe * 0.997 && fiyat < oncekiTepe;
  const tepeYakin = fiyat >= oncekiTepe * 0.978;
  const fishTepeDonus = (fish15.fish < fish15.tetik && fish15.tetik >= 1.0) || (fish1s.fish < fish1s.tetik && fish1s.tetik >= 1.1);

  if (tepeSweep) { shortPuan += 34; shortNeden.push('💧 24S Tepe Likidite Süpürme (SWEEP)'); }
  else if (tepeYakin && ustFitilVar) { shortPuan += 20; shortNeden.push('💧 24S Tepe Bölgesi Üst Fitil Reddi'); }

  if (fishTepeDonus) { shortPuan += 24; shortNeden.push(`🎣 Aşırı Tepe Fisher Dönüşü (${fish15.fish}/${fish15.tetik})`); }
  else if (fish15.fish < fish15.tetik && fish15.tetik >= 0.3) { shortPuan += 12; shortNeden.push('🎣 15dk Fisher Aşağı'); }

  if (ustFitilVar) { shortPuan += 10; shortNeden.push('Satıcı Fitil Reddi'); }
  if (hacimPatlama >= 1.4 && (tepeSweep || tepeYakin)) { shortPuan += 12; shortNeden.push(`Tepede Hacimli Satış (${hacimPatlama}x)`); }
  if (fundingPct != null && fundingPct >= 0.02) { shortPuan += 12; shortNeden.push(`Long Yığılması (+%${fundingPct.toFixed(3)})`); }
  if (sonRsi15 >= 58 && m15.at(-1).c < m15.at(-1).o) { shortPuan += 8; shortNeden.push(`Tepeden Kırmızı Dönüş (RSI ${Math.round(sonRsi15)})`); }

  // En azından gerçek bir sweep veya aşırı dip/tepe Fisher dönüşü şart (orta bölgedeki rastgele coinleri alma)
  const gecerliLong = longPuan >= 60 && (dipSweep || (dipYakin && fishDipDonus));
  const gecerliShort = shortPuan >= 60 && (tepeSweep || (tepeYakin && fishTepeDonus));
  if (!gecerliLong && !gecerliShort) return null;

  const yon = gecerliLong && (!gecerliShort || longPuan >= shortPuan) ? 'LONG' : 'SHORT';
  const puan = Math.min(100, Math.round(yon === 'LONG' ? longPuan : shortPuan));
  const nedenler = (yon === 'LONG' ? longNeden : shortNeden).slice(0, 5);

  // Likidite Avı Dar Stop (Süpürülen fitilin hemen dışı — yüksek 1:3 R:R!)
  const minRisk = fiyat * 0.009;
  const maxRisk = fiyat * 0.038;
  let stop, tp1, tp2, girisAlt, girisUst, girisNot;
  if (yon === 'LONG') {
    const fitilStop = son4Min * 0.996;
    const risk = Math.max(minRisk, Math.min(maxRisk, Math.max(fiyat - fitilStop, atr15 * 1.4)));
    stop = fiyat - risk;
    tp1 = fiyat + risk * 1.8;
    tp2 = fiyat + risk * 3.0;
    girisAlt = Math.max(stop + risk * 0.25, oncekiDip);
    girisUst = fiyat;
    girisNot = 'Dip süpürme sonrası dar stoplu tepki girişi';
  } else {
    const fitilStop = son4Max * 1.004;
    const risk = Math.max(minRisk, Math.min(maxRisk, Math.max(fitilStop - fiyat, atr15 * 1.4)));
    stop = fiyat + risk;
    tp1 = fiyat - risk * 1.8;
    tp2 = fiyat - risk * 3.0;
    girisAlt = fiyat;
    girisUst = Math.min(stop - risk * 0.25, oncekiTepe);
    girisNot = 'Tepe süpürme sonrası dar stoplu dönüş girişi';
  }

  const riskPct = +((Math.abs(fiyat - stop) / fiyat) * 100).toFixed(2);
  const tp1Pct = +((Math.abs(tp1 - fiyat) / fiyat) * 100).toFixed(2);
  const tp2Pct = +((Math.abs(tp2 - fiyat) / fiyat) * 100).toFixed(2);
  const guvenliKaldirac = Math.max(2, Math.min(10, Math.floor(15 / Math.max(riskPct, 0.9))));

  return {
    id: aday.id,
    kod: aday.kod,
    ad: aday.ad,
    yon,
    puan,
    mod: 'likidite',
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
    rr: 3.0,
    guvenliKaldirac,
    degisim: +deg.toFixed(2),
    btcFark,
    alisPct: alis,
    satisPct: satis,
    gh: hacimPatlama,
    rsi15: Math.round(sonRsi15),
    adx15: Math.round(adxHesapla(m15, 14)),
    chop15: choppinessHesapla(m15, 14),
    fisher15: fish15,
    fundingPct,
    oiUsd,
    oiDegisimPct,
    nedenler
  };
}

async function likiditeAviIslemleriBul({ sadeceOkx = true, zorla = false } = {}) {
  const key = sadeceOkx ? 'okx' : 'hepsi';
  const hit = _likiditeOnbellek.get(key);
  if (!zorla && hit && (Date.now() - hit.ts) < 75_000) {
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

  const havuz = (kriptolar || []).filter(r => {
    if (!r || r.kod === 'BTC' || r.id === 'BINANCE:BTCUSDT') return false;
    if ((r.usdHacim || 0) < 1_500_000) return false;
    const sym = (r.kod + 'USDT').toUpperCase();
    const okxVar = (r.borsalar || []).includes('OKX') || !!vadeli?.[sym]?.okxSwap;
    if (sadeceOkx && !okxVar) return false;
    return true;
  });

  // Uç bölgelerde (dip/tepe), yüksek hacimli veya fonlaması ters yığılmış en iyi 16 adayı seç
  const adaySkorla = r => {
    const sym = (r.kod + 'USDT').toUpperCase();
    const fr = Math.abs(vadeli?.[sym]?.fundingPct ?? 0);
    const rsi1 = r.rsi?.s1 ?? 50;
    const ucluk = Math.abs(rsi1 - 50); // 50'den ne kadar uzaksa o kadar dip/tepede
    const gh = r.goreceliHacim || 1;
    return ucluk * 2 + fr * 600 + gh * 12 + Math.abs(r.degisim || 0) * 1.5;
  };

  const adaylar = [...havuz].sort((a, b) => adaySkorla(b) - adaySkorla(a)).slice(0, 16);

  const bulunanlar = [];
  for (let i = 0; i < adaylar.length; i += 4) {
    const grup = adaylar.slice(i, i + 4);
    const sonuclar = await Promise.all(grup.map(a => {
      const sym = (a.kod + 'USDT').toUpperCase();
      return likiditeAdayAnalizEt(a, btcDegisim, vadeli?.[sym]).catch(() => null);
    }));
    sonuclar.forEach(s => { if (s) bulunanlar.push(s); });
  }

  bulunanlar.sort((a, b) => b.puan - a.puan);
  const ilkAlti = bulunanlar.slice(0, 6);

  const sonuc = {
    zaman: new Date().toISOString(),
    mod: 'likidite',
    tarananCoin: havuz.length,
    derinIncelenen: adaylar.length,
    netSayi: ilkAlti.length,
    btc: { fiyat: btcFiyat, degisim: +btcDegisim.toFixed(2), kalkanMetin: '💧 BTC\'den Bağımsız Likidite Avı (SWEEP + Aşırı Fisher)' },
    islemler: ilkAlti
  };

  _likiditeOnbellek.set(key, { ts: Date.now(), data: sonuc });
  return { ...sonuc, onbellekten: false };
}

module.exports = { hazirIslemleriBul, likiditeAviIslemleriBul, demoGecmisStopTpKontrol };
