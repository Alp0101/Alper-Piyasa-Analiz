// Veri toplayıcı: TradingView tarayıcı (hızlı tarama), Yahoo ve Binance (mum verisi)
'use strict';
const { EKSTRA, sembolBilgisi } = require('./semboller');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const onbellek = new Map();

async function onbellekli(anahtar, sureMs, fn) {
  const k = onbellek.get(anahtar);
  if (k && Date.now() - k.t < sureMs) return k.v;
  if (k && k.bekleyen) return k.bekleyen;
  const bekleyen = fn().then(v => { onbellek.set(anahtar, { t: Date.now(), v }); return v; })
    .catch(e => { onbellek.delete(anahtar); throw e; });
  onbellek.set(anahtar, { ...(k || {}), t: k ? k.t : 0, bekleyen });
  return bekleyen;
}

async function getJson(url, opts = {}) {
  const ctrl = new AbortController();
  const zam = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} – ${url.split('?')[0]}`);
    return await r.json();
  } finally { clearTimeout(zam); }
}

// ---------------- TradingView tarayıcı ----------------
const TARAMA_KOLONLARI = [
  'name', 'description', 'close', 'change', 'volume', 'relative_volume_10d_calc',
  'Recommend.All|120', 'Recommend.All|240', 'Recommend.All',
  'RSI|120', 'RSI|240', 'RSI', 'High.1M', 'Low.1M', 'ATR', 'EMA50', 'EMA200', 'market_cap_basic',
];

function satirCoz(item) {
  const d = {};
  TARAMA_KOLONLARI.forEach((k, i) => { d[k] = item.d[i]; });
  return {
    id: item.s,
    kod: d.name,
    ad: d.description,
    fiyat: d.close,
    degisim: d.change,
    hacim: d.volume,
    goreceliHacim: d.relative_volume_10d_calc,
    tv: { s2: d['Recommend.All|120'], s4: d['Recommend.All|240'], g1: d['Recommend.All'] },
    rsi: { s2: d['RSI|120'], s4: d['RSI|240'], g1: d.RSI },
    ayYuksek: d['High.1M'], ayDusuk: d['Low.1M'],
    atr: d.ATR, ema50: d.EMA50, ema200: d.EMA200,
    piyasaDegeri: d.market_cap_basic,
  };
}

async function tumBistTara() {
  return onbellekli('tarama:bist', 60_000, async () => {
    const body = {
      markets: ['turkey'], symbols: { query: { types: [] } },
      filter: [{ left: 'type', operation: 'equal', right: 'stock' }],
      columns: TARAMA_KOLONLARI, sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' }, range: [0, 2000],
    };
    const j = await getJson('https://scanner.tradingview.com/turkey/scan', {
      method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' },
    });
    return j.data.map(satirCoz);
  });
}

async function sembolleriTara(idler) {
  const tvIdler = idler.filter(id => !id.startsWith('YAHOO:'));
  if (!tvIdler.length) return [];
  const anahtar = 'tarama:' + [...tvIdler].sort().join(',');
  // Önceden 45 saniye önbellekte bekliyordu (oynaklık bu yüzden kaçıyordu), şimdi 3 saniyeye çekildi!
  return onbellekli(anahtar, 3_000, async () => {
    const body = { symbols: { tickers: tvIdler, query: { types: [] } }, columns: TARAMA_KOLONLARI };
    const j = await getJson('https://scanner.tradingview.com/global/scan', {
      method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' },
    });
    return j.data.map(satirCoz);
  });
}

async function bistAdlari() {
  const liste = await tumBistTara();
  const m = {};
  liste.forEach(r => { m[r.id] = r.ad; });
  return m;
}

// ---------------- Mum verisi ----------------
// Mum: { t (saniye, UTC), o, h, l, c, v }
async function yahooMum(kod, interval, range) {
  return onbellekli(`yahoo:${kod}:${interval}:${range}`, interval === '1d' ? 10 * 60_000 : 4 * 60_000, async () => {
    const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(kod)}?interval=${interval}&range=${range}`);
    const r = j.chart && j.chart.result && j.chart.result[0];
    if (!r || !r.timestamp) throw new Error(`${kod} için veri bulunamadı`);
    const q = r.indicators.quote[0];
    const out = [];
    r.timestamp.forEach((t, i) => {
      if (q.close[i] == null || q.open[i] == null) return;
      out.push({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 });
    });
    return out;
  });
}

async function binanceMum(kod, interval) {
  // api.binance.com ABD sunucularında (Render) 451 engeli verir.
  // Bu yüzden sırasıyla Binance.US -> Global Binance -> Yahoo Crypto yedekli çalışır.
  const intervalMap = { '15m': '15m', '1h': '1h', '2h': '2h', '4h': '4h', '1d': '1d', '1w': '1w', '1M': '1M' };
  const intv = intervalMap[interval] || interval;

  return onbellekli(`kripto:${kod}:${intv}`, 2 * 60_000, async () => {
    // 1. Kaynak: Binance.US (Render ve ABD sunucularında %100 açık ve engelsiz)
    try {
      const url = `https://api.binance.us/api/v3/klines?symbol=${kod}&interval=${intv}&limit=300`;
      const j = await getJson(url);
      if (Array.isArray(j) && j.length > 0) {
        return j.map(k => ({ t: Math.floor(k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
      }
    } catch (_) {}

    // 2. Kaynak: Global Binance (Türkiye veya yerel bilgisayarda çalışırken)
    try {
      const url = `https://api.binance.com/api/v3/klines?symbol=${kod}&interval=${intv}&limit=300`;
      const j = await getJson(url);
      if (Array.isArray(j) && j.length > 0) {
        return j.map(k => ({ t: Math.floor(k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
      }
    } catch (_) {}

    // 3. Kaynak: Yahoo Finance Crypto (Asla engellenmeyen evrensel yedek, örn: BTC-USD)
    try {
      const coin = kod.replace(/USDT$/, '');
      const yahooInterval = (interval === '15m') ? '15m' : (interval === '1d') ? '1d' : (interval === '1w') ? '1wk' : (interval === '1M') ? '1mo' : '60m';
      const yahooRange = (interval === '15m') ? '5d' : (interval === '1d' || interval === '1w' || interval === '1M') ? '2y' : '60d';
      const ym = await yahooMum(`${coin}-USD`, yahooInterval, yahooRange);
      if (ym && ym.length > 0) return ym;
    } catch (_) {}

    throw new Error(`${kod} için kripto veri kaynağına ulaşılamadı.`);
  });
}

// Saatlik mumları N saatlik mumlara birleştirir (İstanbul saatine göre, seans başına hizalı)
function birlestir(mumlar, N, seansBaslangic = 0, seansBitisSaat = 24) {
  const out = [];
  let aktif = null, aktifAnahtar = null;
  const sonKova = Math.max(0, Math.ceil((seansBitisSaat - seansBaslangic) / N) - 1);
  for (const m of mumlar) {
    const tr = new Date((m.t + 3 * 3600) * 1000);
    const gun = tr.toISOString().slice(0, 10);
    const saat = tr.getUTCHours() + tr.getUTCMinutes() / 60;
    let kova = Math.floor((saat - seansBaslangic) / N);
    kova = Math.min(Math.max(kova, 0), sonKova);
    const anahtar = gun + '#' + kova;
    if (anahtar !== aktifAnahtar) {
      if (aktif) out.push(aktif);
      aktif = { ...m }; aktifAnahtar = anahtar;
    } else {
      aktif.h = Math.max(aktif.h, m.h); aktif.l = Math.min(aktif.l, m.l);
      aktif.c = m.c; aktif.v += m.v;
    }
  }
  if (aktif) out.push(aktif);
  return out;
}

// Günlük mumları haftalık mumlara birleştirir
function haftalik(gunluk) {
  const out = [];
  let aktif = null, hafta = null;
  for (const m of gunluk) {
    const d = new Date(m.t * 1000);
    const pzt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
    const k = pzt.toISOString().slice(0, 10);
    if (k !== hafta) { if (aktif) out.push(aktif); aktif = { ...m }; hafta = k; }
    else { aktif.h = Math.max(aktif.h, m.h); aktif.l = Math.min(aktif.l, m.l); aktif.c = m.c; aktif.v += m.v; }
  }
  if (aktif) out.push(aktif);
  return out;
}

// Yahoo günlük verisi bazen bugünün mumunu geç ekler: saatlik veriden tamamla
function gunlukTamamla(gunluk, saatlik) {
  const trGun = t => new Date((t + 3 * 3600) * 1000).toISOString().slice(0, 10);
  const out = gunluk.slice();
  const sonGun = out.length ? trGun(out[out.length - 1].t) : '';
  const yeniGunler = new Map();
  for (const m of saatlik) {
    const g = trGun(m.t);
    if (g < sonGun) continue;
    const a = yeniGunler.get(g);
    if (!a) yeniGunler.set(g, { ...m });
    else { a.h = Math.max(a.h, m.h); a.l = Math.min(a.l, m.l); a.c = m.c; a.v += m.v; }
  }
  for (const [g, m] of yeniGunler) {
    if (g === sonGun) {
      const s = out[out.length - 1];
      out[out.length - 1] = { ...s, h: Math.max(s.h, m.h), l: Math.min(s.l, m.l), c: m.c };
    } else out.push(m);
  }
  return out;
}

// Yahoo kaynağı için 15dk / 1s / 2s / 4s / 1g / 1h / 1ay mumları
async function yahooSetleri(kod, bist) {
  // Paralel hızlı çekim: 15m, saatlik, günlük ve 5 yıllık aylık (toplam sadece 60 mum, çok hafiftir)
  const [m15, saatlik, gunluk, aylik] = await Promise.all([
    yahooMum(kod, '15m', '5d').catch(() => []),
    yahooMum(kod, '60m', '90d'),
    yahooMum(kod, '1d', '2y'),
    yahooMum(kod, '1mo', '5y').catch(() => [])
  ]);
  const bas = bist ? 10 : 0, bit = bist ? 18 : 24;
  const g1 = gunlukTamamla(gunluk, saatlik);
  return {
    m15: m15.length ? m15 : null,
    s1: saatlik,
    s2: birlestir(saatlik, 2, bas, bit),
    s4: birlestir(saatlik, 4, bas, bit),
    g1,
    h1: haftalik(g1),
    ay1: aylik.length ? aylik : null
  };
}

// Gram altın (TL) = Ons altın (USD) × Dolar/TL ÷ 31,1035 – zamanları eşleştirerek
function carpSetleri(a, b, olcek) {
  const bMap = new Map(b.map(m => [m.t, m]));
  let sonB = null;
  const bSirali = b;
  let j = 0;
  const out = [];
  for (const m of a) {
    while (j < bSirali.length && bSirali[j].t <= m.t) { sonB = bSirali[j]; j++; }
    const e = bMap.get(m.t) || sonB;
    if (!e) continue;
    out.push({ t: m.t, o: m.o * e.o * olcek, h: m.h * e.h * olcek, l: m.l * e.l * olcek, c: m.c * e.c * olcek, v: 0 });
  }
  return out;
}

async function mumSetleri(bilgi) {
  const k = bilgi.kaynak;
  if (k.tip === 'pi') {
    // Pi Network için Gate.io / Bitget / OKX veri beslemesi
    const mapIntv = { '15m': '15m', '1h': '1h', '2h': '1h', '4h': '4h', '1d': '1d', '1w': '7d' };
    const intv = mapIntv[arguments[1]] || '1h';
    const j = await getJson(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=PI_USDT&interval=1h&limit=250`);
    const saatlik = j.map(x => ({ t: +x[0], o: +x[5], h: +x[3], l: +x[4], c: +x[2], v: +x[1] }));
    const s2 = birlestir(saatlik, 2, 0, 24);
    const s4 = birlestir(saatlik, 4, 0, 24);
    const g1 = birlestir(saatlik, 24, 0, 24);
    return { m15: saatlik, s1: saatlik, s2, s4, g1, h1: haftalik(g1), ay1: null, not: 'Pi Network IOU verisi Gate.io borsasından canlı çekilmektedir.' };
  }
  if (k.tip === 'binance') {
    const [m15, s1, s2, s4, g1, h1, ay1] = await Promise.all([
      '15m', '1h', '2h', '4h', '1d', '1w', '1M'
    ].map(i => binanceMum(k.kod, i)));
    return { m15, s1, s2, s4, g1, h1, ay1, not: null };
  }
  if (k.tip === 'yahoo') {
    const set = await yahooSetleri(k.kod, bilgi.tur === 'bist' || k.kod.endsWith('.IS'));
    return { ...set, not: bilgi.tur === 'bist' ? 'BIST verileri yaklaşık 15 dakika gecikmeli olabilir.' : null };
  }
  if (k.tip === 'gram') {
    const [altin, dolar] = await Promise.all([yahooSetleri('GC=F', false), yahooSetleri('USDTRY=X', false)]);
    const olcek = 1 / 31.1035;
    const set = {};
    for (const tf of ['m15', 's1', 's2', 's4', 'g1', 'h1', 'ay1']) {
      if (altin[tf] && dolar[tf]) set[tf] = carpSetleri(altin[tf], dolar[tf], olcek);
    }
    // Sertifika fiyatına ölçekle (TradingView'deki son fiyata göre)
    try {
      const [satir] = await sembolleriTara([bilgi.id]);
      if (satir && satir.fiyat) {
        const oran = satir.fiyat / set.s2[set.s2.length - 1].c;
        for (const tf of ['m15', 's1', 's2', 's4', 'g1', 'h1', 'ay1']) {
          if (set[tf]) set[tf] = set[tf].map(m => ({ ...m, o: m.o * oran, h: m.h * oran, l: m.l * oran, c: m.c * oran }));
        }
      }
    } catch (_) { /* ölçek yapılamazsa gram altın TL değerleri kalır */ }
    return { ...set, not: 'Mum verisi gram altından (ons × dolar/TL) türetilmiştir; hacim analizi yapılamaz.' };
  }
  throw new Error('Bilinmeyen veri kaynağı');
}

const BENCH = {
  XU100: { id: 'BIST:XU100', ters: false },
  BTC: { id: 'BINANCE:BTCUSDT', ters: false },
  DXY_TERS: { id: 'TVC:DXY', ters: true },
};

async function benchSetleri(benchKodu) {
  const b = BENCH[benchKodu];
  if (!b) return null;
  const bilgi = sembolBilgisi(b.id);
  try { return { ...(await mumSetleri(bilgi)), ters: b.ters, ad: bilgi.ad }; } catch (_) { return null; }
}

// ---------------- Sembol arama ----------------
async function kriptoVarMi(taban) {
  try {
    const j = await getJson(`https://api.binance.com/api/v3/ticker/price?symbol=${taban}USDT`);
    return !!j.price;
  } catch (_) { return false; }
}

const norm = s => String(s || '').toLocaleUpperCase('tr-TR')
  .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C');
const ESANLAMLI = { DOLAR: 'USD', EURO: 'EUR', AVRO: 'EUR', ONS: 'XAU', BITCOIN: 'BTC', ETHEREUM: 'ETH' };

async function ara(q) {
  const s = norm(q.trim());
  if (!s) return [];
  const sonuc = [];
  for (const [id, b] of Object.entries(EKSTRA)) {
    if (norm(id).includes(s) || norm(b.ad).includes(s) || (ESANLAMLI[s] && id.includes(ESANLAMLI[s]))) sonuc.push({ id, ad: b.ad, tur: b.tur });
  }
  try {
    const bist = await tumBistTara();
    bist.filter(r => norm(r.kod).startsWith(s) || norm(r.ad).includes(s))
      .slice(0, 25).forEach(r => { if (!sonuc.find(x => x.id === r.id)) sonuc.push({ id: r.id, ad: r.ad, tur: 'bist' }); });
  } catch (_) { /* tarayıcıya ulaşılamazsa sadece diğer sonuçlar */ }
  const kripto = ESANLAMLI[s] && ['BTC', 'ETH'].includes(ESANLAMLI[s]) ? ESANLAMLI[s] : s;
  if (/^[A-Z0-9]{2,10}$/.test(kripto) && await kriptoVarMi(kripto)) {
    sonuc.push({ id: `BINANCE:${kripto}USDT`, ad: `${kripto} / USDT (Kripto)`, tur: 'kripto' });
  }
  return sonuc.slice(0, 40);
}

module.exports = { tumBistTara, sembolleriTara, bistAdlari, mumSetleri, benchSetleri, ara };
