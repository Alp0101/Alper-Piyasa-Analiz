// Piyasa Asistanı – yerel sunucu (http://localhost:3737)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const V = require('./veri');
const { sembolBilgisi, varsayilanListeler } = require('./semboller');
const { analizEt } = require('./analiz');
const { geriyeTest } = require('./backtest');
const Demo = require('./demo');
const Ziyaret = require('./ziyaret');
const Alarm = require('./alarm');
const Guvenlik = require('./guvenlik');
const Bulut = require('./bulut');
const Kurumsal = require('./kurumsal_analiz');
const GunlukRapor = require('./gunluk_rapor');
const BildirimServisi = require('./bildirim_servisi');

const PORT = process.env.PORT || 3737;
const KOK = __dirname;
const LISTE_DOSYA = path.join(KOK, 'veri', 'listeler.json');
const BULUT_LISTE_ANAHTAR = 'kullanici_listeleri';

let onbellekListeler = null;

// ---------------- Listeler ----------------
function listeleriOku() {
  if (onbellekListeler) return onbellekListeler;
  try {
    const v = JSON.parse(fs.readFileSync(LISTE_DOSYA, 'utf8'));
    let degisti = false;
    if (!v.listeler.some(l => l.id === 'forex')) {
      const varsayilan = varsayilanListeler().listeler.find(l => l.id === 'forex');
      if (varsayilan) {
        v.listeler.splice(1, 0, varsayilan);
        degisti = true;
      }
    }
    const endeksListesi = v.listeler.find(l => l.id === 'endeksler');
    if (endeksListesi && Array.isArray(endeksListesi.semboller) && !endeksListesi.semboller.includes('BIST:XBANK')) {
      endeksListesi.semboller.push('BIST:XBANK');
      degisti = true;
    }
    if (degisti) {
      listeleriYaz(v);
    }
    onbellekListeler = v;
    return onbellekListeler;
  }
  catch (_) { const v = varsayilanListeler(); listeleriYaz(v); return v; }
}
function listeleriYaz(v) {
  onbellekListeler = v;
  try {
    fs.mkdirSync(path.dirname(LISTE_DOSYA), { recursive: true });
    const gecici = LISTE_DOSYA + '.tmp';
    fs.writeFileSync(gecici, JSON.stringify(v, null, 2), 'utf8');
    fs.renameSync(gecici, LISTE_DOSYA);
  } catch (_) {}
  if (Bulut.aktifMi()) {
    Bulut.kaydet(BULUT_LISTE_ANAHTAR, v).catch(() => {});
  }
}

// Buluttan listeleri yükle
async function buluttanListeleriYukle() {
  if (!Bulut.aktifMi()) return;
  const veri = await Bulut.getir(BULUT_LISTE_ANAHTAR);
  if (veri && Array.isArray(veri.listeler)) {
    let degisti = false;
    if (!veri.listeler.some(l => l.id === 'forex')) {
      const varsayilan = varsayilanListeler().listeler.find(l => l.id === 'forex');
      if (varsayilan) {
        veri.listeler.splice(1, 0, varsayilan);
        degisti = true;
      }
    }
    const endeksListesi = veri.listeler.find(l => l.id === 'endeksler');
    if (endeksListesi && Array.isArray(endeksListesi.semboller) && !endeksListesi.semboller.includes('BIST:XBANK')) {
      endeksListesi.semboller.push('BIST:XBANK');
      degisti = true;
    }
    if (degisti) {
      Bulut.kaydet(BULUT_LISTE_ANAHTAR, veri).catch(() => {});
    }
    onbellekListeler = veri;
    try {
      fs.mkdirSync(path.dirname(LISTE_DOSYA), { recursive: true });
      fs.writeFileSync(LISTE_DOSYA, JSON.stringify(veri, null, 2), 'utf8');
      console.log('☁️ Listeler bulut veritabanından yüklendi.');
    } catch (_) {}
  } else if (onbellekListeler) {
    Bulut.kaydet(BULUT_LISTE_ANAHTAR, onbellekListeler).catch(() => {});
  }
}
buluttanListeleriYukle();
function listeDogrula(v) {
  if (!v || !Array.isArray(v.listeler)) throw new Error('Geçersiz liste verisi');
  v.listeler.forEach(l => {
    if (typeof l.id !== 'string' || typeof l.ad !== 'string') throw new Error('Liste adı/kimliği eksik');
    if (!l.dinamik && !Array.isArray(l.semboller)) throw new Error(`"${l.ad}" listesinde sembol dizisi yok`);
  });
  return v;
}

// ---------------- Hızlı değerlendirme (tarama tablosu) ----------------
const tvEtiket = x => (x == null ? null : x > 0.5 ? 2 : x > 0.1 ? 1 : x < -0.5 ? -2 : x < -0.1 ? -1 : 0);
function hizliDegerlendir(r, benchmarkDegisim = 0) {
  const t = r.tv || {}, rs = r.rsi || {};
  const isaretler = [];
  const ozelTaktikler = [];
  const gh = r.goreceliHacim || 0;
  const deg = r.degisim || 0;

  // Standart analiz işaretleri
  if (t.s2 > 0.1 && t.s4 > 0.1 && t.g1 > 0.1 && rs.s4 >= 45 && rs.s4 <= 65 && gh >= 1.2) isaretler.push({ tip: 'firsat', metin: 'Kısa vade alım adayı' });
  if (rs.g1 != null && rs.g1 < 32 && t.s2 > 0.3 && t.s4 > -0.1) isaretler.push({ tip: 'firsat', metin: 'Dipten dönüş adayı' });
  if (r.degisim > 3 && r.goreceliHacim != null && r.goreceliHacim < 0.8) isaretler.push({ tip: 'tuzak', metin: 'Hacimsiz yükseliş' });
  if (rs.s4 > 75 || rs.g1 > 78) isaretler.push({ tip: 'tuzak', metin: 'Aşırı alım' });
  if (rs.g1 != null && rs.g1 < 25) isaretler.push({ tip: 'bilgi', metin: 'Aşırı satım' });

  const ayKonum = r.ayYuksek > r.ayDusuk ? Math.round(((r.fiyat - r.ayDusuk) / (r.ayYuksek - r.ayDusuk)) * 100) : null;

  // 1. Taktik: 🛡️ Endekse Direnç / Alfa Gücü (Hacim ve 4S pozitif trend şartlı)
  if (gh >= 1.3 && t.s4 > 0.1 && (
    (benchmarkDegisim <= -0.2 && (deg >= 0.5 || (deg - benchmarkDegisim) >= 2.0)) ||
    (benchmarkDegisim > -0.2 && deg >= 3.0 && gh >= 1.4 && t.s4 > 0.2)
  )) {
    ozelTaktikler.push('alfa');
    isaretler.push({ tip: 'ozel_alfa', metin: '🛡️ Alfa' });
  }

  // 2. Taktik: 📦 Gizli Toplama (Balina Hacim Anomalisi)
  if (Math.abs(deg) <= 2.2 && gh >= 1.8) {
    ozelTaktikler.push('toplama');
    isaretler.push({ tip: 'ozel_toplama', metin: '📦 Gizli Toplama' });
  }

  // 3. Taktik: 🌀 Volatilite Sıkışması (Bahar Yayı)
  if (Math.abs(deg) <= 1.2 && gh >= 0.8 && rs.s4 >= 42 && rs.s4 <= 58 && (t.s4 >= 0 || t.s2 >= 0)) {
    ozelTaktikler.push('sikisma');
    isaretler.push({ tip: 'ozel_sikisma', metin: '🌀 Sıkışma' });
  }

  // 4. Taktik: 🧲 Stop Avı & Silkeleme Dönüşü
  if (ayKonum != null && ayKonum <= 22 && (t.s2 > 0.1 || deg > 0.3) && (rs.s4 < 48 || rs.g1 < 42)) {
    ozelTaktikler.push('stop_avi');
    isaretler.push({ tip: 'ozel_stop_avi', metin: '🧲 Stop Avı' });
  }

  // 5. Taktik: 📈 Pozitif Uyumsuzluk
  if (ayKonum != null && ayKonum <= 40 && (rs.s4 > (rs.g1 || 50) + 4 || (rs.s4 > 35 && t.s2 > 0.2 && (t.g1 || 0) <= 0))) {
    ozelTaktikler.push('uyumsuzluk');
    isaretler.push({ tip: 'ozel_uyumsuzluk', metin: '📈 Uyumsuzluk' });
  }

  // Kombo Rozeti: 2 veya daha fazla taktik aynı anda tetiklendiyse en başa altın rozet koy
  if (ozelTaktikler.length >= 2) {
    isaretler.unshift({ tip: 'kombo', metin: `⭐ ${ozelTaktikler.length}x Özel Taktik` });
  }

  const agirlikli = [t.s2, t.s4, t.g1].some(x => x == null) ? null : Math.round((t.s2 * 0.25 + t.s4 * 0.35 + t.g1 * 0.4) * 100);
  return {
    ...r,
    yon: { s2: tvEtiket(t.s2), s4: tvEtiket(t.s4), g1: tvEtiket(t.g1) },
    hizliPuan: agirlikli, ayKonum, isaretler, ozelTaktikler,
    benchDegisim: benchmarkDegisim,
    tlHacim: r.tlHacim || (r.hacim && r.fiyat ? r.hacim * r.fiyat : null),
    usdHacim: r.usdHacim || (r.id?.includes('USDT') && r.hacim && r.fiyat ? r.hacim * r.fiyat : null),
  };
}

async function listeTara(listeId) {
  const v = listeleriOku();
  const liste = v.listeler.find(l => l.id === listeId);
  if (!liste) throw new Error('Liste bulunamadı');
  let satirlar;
  if (liste.dinamik === 'bist') {
    const cik = new Set(liste.cikarilanlar || []);
    satirlar = (await V.tumBistTara()).filter(r => !cik.has(r.id));
  } else if (liste.dinamik === 'kripto' || liste.id === 'kripto') {
    const cik = new Set(liste.cikarilanlar || []);
    let kriptolar = await V.tumKriptoTara();
    const ozelSemboller = (liste.semboller || []).filter(id => !kriptolar.some(k => k.id === id));
    if (ozelSemboller.length > 0) {
      try {
        const ekstra = await V.sembolleriTara(ozelSemboller);
        const formatliEkstra = (ekstra || []).map(r => {
          const kod = r.kod ? r.kod.replace(/USDT$/, '') : (r.id ? r.id.split(':')[1].replace(/USDT$/, '') : '');
          const usdHacim = r.usdHacim || (r.hacim && r.fiyat ? r.hacim * r.fiyat : null);
          return {
            ...r,
            kod: kod || r.kod,
            ad: r.ad || (kod + ' / USDT'),
            usdHacim,
            tlHacim: usdHacim ? +(usdHacim * 50).toFixed(0) : null
          };
        });
        kriptolar = [...kriptolar, ...formatliEkstra];
      } catch (_) {}
    }
    satirlar = kriptolar.filter(r => !cik.has(r.id));
  } else {
    const gelen = await V.sembolleriTara(liste.semboller);
    const m = new Map(gelen.map(r => [r.id, r]));
    satirlar = liste.semboller.map(id => m.get(id) || { id, kod: id.split(':')[1], ad: (sembolBilgisi(id) || {}).ad || id, fiyat: null, tv: {}, rsi: {}, veriYok: true });
  }
  const adlar = {};
  satirlar.forEach(r => { const b = sembolBilgisi(r.id); if (b && b.tur !== 'bist' && b.ad) adlar[r.id] = b.ad; });
  
let xu100Onbellek = { degisim: 0, zaman: 0 };
async function xu100DegisimAl() {
  if (Date.now() - xu100Onbellek.zaman < 60000) return xu100Onbellek.degisim;
  try {
    const v = await V.canliTekFiyat('BIST:XU100');
    if (v && typeof v.degisim === 'number') {
      xu100Onbellek = { degisim: v.degisim, zaman: Date.now() };
    }
  } catch (_) {}
  return xu100Onbellek.degisim;
}

  // Benchmark (BIST için XU100, Kripto için BTC) günlük değişimini tespit et
  let benchDeg = 0;
  const bSatir = satirlar.find(x => x.id === 'BIST:XU100' || x.id === 'BINANCE:BTCUSDT' || x.kod === 'BTC');
  if (bSatir && bSatir.degisim != null) {
    benchDeg = bSatir.degisim;
  } else if (liste.dinamik === 'bist') {
    benchDeg = await xu100DegisimAl();
  }

  return satirlar.map(r => hizliDegerlendir({ ...r, ad: adlar[r.id] || r.ad }, benchDeg));
}

async function sembolAnaliz(id, tf = 's4') {
  let adlar = {};
  if (id.startsWith('BIST:')) { try { adlar = await V.bistAdlari(); } catch (_) { /* ad olmadan devam */ } }
  const bilgi = sembolBilgisi(id, adlar);
  if (!bilgi) throw new Error('Bu sembol için veri kaynağı tanımlı değil');
  
  // Canlı scanner fiyatı ve mum verilerini paralel çek
  const [canliTarama, setler, bench] = await Promise.all([
    V.sembolleriTara([id]).catch(() => []),
    V.mumSetleri(bilgi),
    bilgi.bench ? V.benchSetleri(bilgi.bench).catch(() => null) : null
  ]);

  const canliSonFiyat = canliTarama?.[0]?.fiyat;
  const canliDegisim = canliTarama?.[0]?.degisim;

  // Mumların en son fiyatını canlı scanner fiyatıyla %100 senkronize et
  if (canliSonFiyat && canliSonFiyat > 0) {
    for (const key of ['m15', 's1', 's2', 's4', 'g1', 'h1', 'ay1']) {
      const arr = setler[key];
      if (arr && arr.length > 0) {
        const sonMum = arr[arr.length - 1];
        sonMum.c = canliSonFiyat;
        sonMum.h = Math.max(sonMum.h, canliSonFiyat);
        sonMum.l = Math.min(sonMum.l, canliSonFiyat);
      }
    }
  }

  const analizSonucu = analizEt(setler, bench, bilgi);

  // Backtest / Geçmiş test hesaplaması
  const hedefMumlar = setler[tf] || setler.s4 || setler.g1;
  const backtestSonucu = geriyeTest(hedefMumlar, tf, null);

  return { ...analizSonucu, backtest: backtestSonucu, canliFiyat: canliSonFiyat, canliDegisim };
}

// ---------------- HTTP ----------------
const TIPLER = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

function gonder(res, kod, veri) {
  res.writeHead(kod, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(veri));
}
function govdeOku(req) {
  return new Promise((ok, red) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 2e6) { red(new Error('Veri çok büyük')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { red(new Error('Geçersiz JSON')); } });
  });
}

const sunucu = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    // Yönetici şifresi koruması: veri değiştiren işlemler şifre ister
    if (Guvenlik.korunanMi(req.method, p) && !Guvenlik.yetkiKontrol(req, res)) return;
    if (p === '/api/yonetici/dogrula') return gonder(res, 200, { yetki: true });

    if (p === '/api/listeler' && req.method === 'GET') return gonder(res, 200, listeleriOku());
    if (p === '/api/listeler' && req.method === 'POST') { const v = listeDogrula(await govdeOku(req)); listeleriYaz(v); return gonder(res, 200, v); }
    if (p === '/api/listeler/varsayilan' && req.method === 'POST') { const v = varsayilanListeler(); listeleriYaz(v); return gonder(res, 200, v); }
    if (p === '/api/tarama') {
      const satirlar = await taramaVeSinyalIsle(url.searchParams.get('liste'));
      return gonder(res, 200, { zaman: new Date().toISOString(), satirlar });
    }
    if (p === '/api/analiz') return gonder(res, 200, await sembolAnaliz(url.searchParams.get('sembol') || '', url.searchParams.get('tf') || 's4'));
    if (p === '/api/fiyat') {
      const sem = url.searchParams.get('sembol') || '';
      const veri = await V.canliTekFiyat(sem).catch(() => null);
      return gonder(res, 200, veri || { sembol: sem, fiyat: null, degisim: null });
    }
    if (p === '/api/ara') return gonder(res, 200, await V.ara(url.searchParams.get('q') || ''));

    // Demo Al-Sat Uç Noktaları (Canlı Piyasa Fiyat Beslemesi)
    if (p === '/api/demo/portfoy' && req.method === 'GET') {
      const qSembol = url.searchParams.get('semboller');
      const gelenSemboller = qSembol ? qSembol.split(',').filter(Boolean) : [];
      const semboller = [...new Set(gelenSemboller)];
      const fiyatHaritasi = {};
      if (semboller.length > 0) {
        try {
          const satirlar = await V.sembolleriTara(semboller);
          (satirlar || []).forEach(r => { if (r && r.id && r.fiyat) fiyatHaritasi[r.id] = r.fiyat; });
        } catch (_) {}
      }
      return gonder(res, 200, { fiyatHaritasi });
    }
    if (p === '/api/demo/al' && req.method === 'POST') {
      const g = await govdeOku(req);
      const sonuc = Demo.demoAl(g.sembol, g.ad, g.fiyat, g.adet, g.stopFiyat, g.hedefFiyat, g.yon, g.kaldirac);
      return gonder(res, 200, sonuc);
    }
    if (p === '/api/demo/sat' && req.method === 'POST') {
      const g = await govdeOku(req);
      const sonuc = Demo.demoSat(g.pozId, g.satisFiyat, g.sebep || 'manuel');
      return gonder(res, 200, sonuc);
    }
    if (p === '/api/demo/sifirla' && req.method === 'POST') {
      return gonder(res, 200, Demo.demoSifirla());
    }

    // Ziyaretçi İstatistikleri
    if (p === '/api/ziyaret/istatistik') {
      return gonder(res, 200, Ziyaret.istatistikGetir());
    }

    // Toplu Balina Radarı Taraması (Mevcut seçili listeye veya piyasaya göre dinamik)
    if (p === '/api/balina/tara') {
      const seciliListeId = url.searchParams.get('liste') || 'tum-bist';
      let satirlar = [];
      try {
        satirlar = await listeTara(seciliListeId);
      } catch (_) {
        satirlar = await V.tumBistTara();
      }

      const bulunanlar = [];
      satirlar.forEach(r => {
        const gh = r.goreceliHacim || 0;
        const deg = r.degisim || 0;
        const tv = r.tv || {};
        const rsi4h = r.rsi?.s4 || 50;

        // 1. Agresif Giriş / Hacimli Patlama: Sert yükseliş ve güçlü hacim (RSI aşırı şişmemişken)
        if (deg >= 2.8 && (gh >= 1.4 || tv.s4 > 0.3) && rsi4h <= 74) {
          bulunanlar.push({
            id: r.id, kod: r.kod, ad: r.ad, fiyat: r.fiyat, degisim: deg, gh: gh || 1.4,
            tlHacim: r.tlHacim, usdHacim: r.usdHacim,
            tur: 'patlama', seviye: 'Agresif Para Girişi', ikon: '🚀', renk: '#38bdf8',
            aciklama: `Günü %${deg.toFixed(1)} artıda götürüyor ve hacim ${gh.toFixed(1)} katı; güçlü alım baskısı var!`
          });
        }
        // 2. Mal Dağıtımı: RSI aşırı alımda (>= 75) iken yüksek hacimle tepede zorlanma
        else if (rsi4h >= 75 && (gh >= 1.35 || deg >= 2.5)) {
          bulunanlar.push({
            id: r.id, kod: r.kod, ad: r.ad, fiyat: r.fiyat, degisim: deg, gh: gh || 1.35,
            tlHacim: r.tlHacim, usdHacim: r.usdHacim,
            tur: 'dagitim', seviye: 'Mal Dağıtımı Riski', ikon: '⚠️', renk: '#ef4444',
            aciklama: `Hacim yüksek ancak RSI aşırı şişti (${rsi4h.toFixed(0)}). Tepede mal devri ve düzeltme riski!`
          });
        }
        // 3. Sessiz Toplama: Fiyat yatay (% -2.2 ile +2.2) ve hacim en az 1.35 kat artışta
        else if (Math.abs(deg) <= 2.2 && gh >= 1.35 && (r.fiyat > 0) && ((r.tlHacim || 0) > 8e6 || (r.usdHacim || 0) > 100e3)) {
          bulunanlar.push({
            id: r.id, kod: r.kod, ad: r.ad, fiyat: r.fiyat, degisim: deg, gh: gh,
            tlHacim: r.tlHacim, usdHacim: r.usdHacim,
            tur: 'toplama', seviye: 'Sessiz Toplama', ikon: '🧲', renk: '#10b981',
            aciklama: `Fiyat yatay (%${deg.toFixed(1)}) seyrederken hacim ortalamanın ${gh.toFixed(1)} katına fırladı; balinalar sessizce topluyor!`
          });
        }
        // 4. Dip Karşılama / Panik Alımı: Düşüş varken güçlü hacimle satışların emilmesi
        else if (deg <= -2.0 && gh >= 1.35 && (rsi4h < 42 || (r.rsi?.s2 || 50) < 38)) {
          bulunanlar.push({
            id: r.id, kod: r.kod, ad: r.ad, fiyat: r.fiyat, degisim: deg, gh: gh || 1.35,
            tlHacim: r.tlHacim, usdHacim: r.usdHacim,
            tur: 'toplama', seviye: 'Dip Karşılama (Panik Alımı)', ikon: '💎', renk: '#a855f7',
            aciklama: `Düşüşe rağmen hacim ${gh.toFixed(1)} katına çıktı; dip seviyeden satışlar balinalarca karşılanıyor!`
          });
        }
      });
      // En güçlü balina hareketlerini bildirim servisine ilet
      bulunanlar.slice(0, 3).forEach(b => {
        if (b.tur === 'toplama' || b.tur === 'patlama') {
          BildirimServisi.bildirimEkle({
            baslik: b.tur === 'toplama' ? '🧲 SESSİZ BALİNA TOPLAMASI' : '🚀 AGRESİF BALİNA GİRİŞİ',
            mesaj: `${b.kod} (${b.ad || ''}) ${b.seviye}: Hacim ${b.gh.toFixed(1)} katı! Fiyat: ${b.fiyat} ₺`,
            tur: 'balina',
            sembolId: b.id,
            kod: b.kod,
            ad: b.ad,
            fiyat: b.fiyat
          });
        }
      });
      return gonder(res, 200, { zaman: new Date().toISOString(), liste: bulunanlar });
    }

    // 👑 Kurumsal VIP / %80+ Elit Fırsatlar Taraması (Öncelik: BIST ve Altın, tam uyumlu Kripto)
    if (p === '/api/kurumsal/tara') {
      const piyasa = url.searchParams.get('piyasa') || 'hepsi';
      // Öncelikli A+ takip havuzu (BIST, Altın/Emtia ve Genişletilmiş Popüler Kripto Havuzu)
      const elitHavuz = [
        // BIST Yıldızları (G1 periyot odaklı)
        'BIST:THYAO', 'BIST:ASELS', 'BIST:TUPRS', 'BIST:KCHOL', 'BIST:BIMAS',
        'BIST:AKBNK', 'BIST:GARAN', 'BIST:ISCTR', 'BIST:YKBNK', 'BIST:EREGL',
        'BIST:SAHOL', 'BIST:SISE', 'BIST:FROTO', 'BIST:PETKM', 'BIST:ENKAI',
        // Altın ve Değerli Madenler
        'OANDA:XAUUSD', 'BIST:ALTIN', 'TVC:SILVER',
        // Genişletilmiş Kripto Havuzu (20 Hacimli Popüler Varlık)
        'BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT', 'BINANCE:BNBUSDT',
        'BINANCE:XRPUSDT', 'BINANCE:DOGEUSDT', 'BINANCE:ADAUSDT', 'BINANCE:AVAXUSDT',
        'BINANCE:SUIUSDT', 'BINANCE:LINKUSDT', 'BINANCE:NEARUSDT', 'BINANCE:APTUSDT',
        'BINANCE:PEPEUSDT', 'BINANCE:SHIBUSDT', 'BINANCE:RENDERUSDT', 'BINANCE:INJUSDT',
        'BINANCE:TAOUSDT', 'BINANCE:ARBUSDT', 'BINANCE:OPUSDT', 'BINANCE:TIAUSDT'
      ];

      const filtrelenmis = elitHavuz.filter(s => {
        if (piyasa === 'bist') return s.startsWith('BIST:') && s !== 'BIST:ALTIN';
        if (piyasa === 'altin') return s.includes('XAU') || s.includes('ALTIN') || s.includes('SILVER');
        if (piyasa === 'kripto') return s.startsWith('BINANCE:');
        return true;
      });

      const sonuclar = [];
      let bMum = null;
      try {
        const bBilgi = sembolBilgisi('BIST:XU100');
        if (bBilgi) {
          const bSet = await V.mumSetleri(bBilgi);
          bMum = bSet ? (bSet.g1 || bSet.s4) : null;
        }
      } catch (_) {}

      for (const sembolId of filtrelenmis) {
        const b = sembolBilgisi(sembolId);
        if (!b) continue;
        try {
          const set = await V.mumSetleri(b);
          if (!set) continue;

          // Kripto için hem 4 saatlik (s4) hem de günlük (g1) periyot taranır, en güçlü kurumsal sinyali veren dahil edilir
          if (b.tur === 'kripto') {
            const analizS4 = set.s4 && set.s4.length >= 30 ? Kurumsal.kurumsalAnalizEt(sembolId, b.ad, b.tur, set.s4, null, 's4') : null;
            const analizG1 = set.g1 && set.g1.length >= 30 ? Kurumsal.kurumsalAnalizEt(sembolId, b.ad, b.tur, set.g1, null, 'g1') : null;
            const enIyi = (analizG1 && (analizG1.puan || 0) > (analizS4?.puan || 0)) ? analizG1 : (analizS4 || analizG1);
            if (enIyi) {
              sonuclar.push(enIyi);
              if (enIyi.onay && enIyi.puan >= 80) {
                const isShort = enIyi.yon === 'SAT';
                const giris = enIyi.seviyeler?.giris || enIyi.fiyat;
                GunlukRapor.sinyalKaydet({
                  sembol: sembolId,
                  ad: b.ad,
                  tur: b.tur,
                  yon: isShort ? 'SAT' : 'AL',
                  sinyalTipi: isShort ? '👑 Kurumsal VIP Short' : '👑 Kurumsal VIP A+',
                  fiyat: giris,
                  hedefFiyat: enIyi.seviyeler?.tp1,
                  stopFiyat: enIyi.seviyeler?.stop
                });
                BildirimServisi.bildirimEkle({
                  baslik: isShort ? '👑 ⬇️ KURUMSAL VIP SHORT (%80+)' : '👑 KURUMSAL VIP SİNYALİ (%80+)',
                  mesaj: `${b.kod || sembolId} (${b.ad || ''}) A+ Elit ${isShort ? 'Ayı FVG & POC reddi' : 'FVG & POC'} onayı aldı! Giriş: ${giris} $ | TP1: ${enIyi.seviyeler?.tp1 || '—'}`,
                  tur: 'kurumsal',
                  yon: isShort ? 'SHORT' : 'LONG',
                  sembolId,
                  kod: b.kod || sembolId.split(':')[1],
                  ad: b.ad,
                  fiyat: giris
                });
              }
            }
            continue;
          }

          const mumlar = set.g1 || set.s4;
          if (!mumlar || mumlar.length < 35) continue;

          const analiz = Kurumsal.kurumsalAnalizEt(sembolId, b.ad, b.tur, mumlar, bMum, set.g1 ? 'g1' : 's4');
          if (analiz) {
            sonuclar.push(analiz);
            if (analiz.onay && analiz.puan >= 80) {
              GunlukRapor.sinyalKaydet({
                sembol: sembolId,
                ad: b.ad,
                tur: b.tur,
                yon: 'AL',
                sinyalTipi: '👑 Kurumsal VIP A+',
                fiyat: analiz.seviyeler?.giris || analiz.fiyat,
                hedefFiyat: analiz.seviyeler?.tp1,
                stopFiyat: analiz.seviyeler?.stop
              });
              BildirimServisi.bildirimEkle({
                baslik: '👑 KURUMSAL VIP SİNYALİ (%80+)',
                mesaj: `${b.kod || sembolId} (${b.ad || ''}) A+ Elit FVG & POC onayı aldı! Giriş: ${analiz.seviyeler?.giris || analiz.fiyat} ₺ | TP1: ${analiz.seviyeler?.tp1 || '—'}`,
                tur: 'kurumsal',
                yon: 'LONG',
                sembolId,
                kod: b.kod || sembolId.split(':')[1],
                ad: b.ad,
                fiyat: analiz.seviyeler?.giris || analiz.fiyat
              });
            }
          }
        } catch (_) {}
      }

      // Puana göre sırala (En yüksek A+ adayları en başta)
      sonuclar.sort((a, b) => b.puan - a.puan);
      return gonder(res, 200, { zaman: new Date().toISOString(), liste: sonuclar });
    }

    // 🔒 Günlük Sinyal ve Başarı Raporu Uç Noktaları (Şifre: sea01)
    if (p === '/api/rapor/dogrula' && req.method === 'POST') {
      const g = await govdeOku(req);
      const yetkili = GunlukRapor.sifreDogrula(g.sifre);
      if (yetkili) {
        return gonder(res, 200, { yetkili: true });
      } else {
        return gonder(res, 401, { yetkili: false, hata: 'Hatalı şifre' });
      }
    }

    if (p === '/api/rapor/veri' && req.method === 'GET') {
      const gelenSifre = req.headers['x-rapor-sifre'] || url.searchParams.get('sifre');
      if (!GunlukRapor.sifreDogrula(gelenSifre)) {
        return gonder(res, 401, { hata: 'Yetkisiz erişim. Lütfen rapor şifresini girin.', yetkili: false });
      }
      const tarih = url.searchParams.get('tarih');
      return gonder(res, 200, GunlukRapor.gunlukRaporAl(tarih));
    }

    if (p === '/api/rapor/guncelle' && req.method === 'POST') {
      const g = await govdeOku(req);
      const sifre = g.sifre || req.headers['x-rapor-sifre'];
      if (!GunlukRapor.sifreDogrula(sifre)) {
        return gonder(res, 401, { hata: 'Yetkisiz erişim.', yetkili: false });
      }
      const rapor = GunlukRapor.gunlukRaporAl(g.tarih);
      const semboller = [...new Set((rapor.sinyaller || []).map(s => s.sembol))];
      if (semboller.length > 0) {
        try {
          const satirlar = await V.sembolleriTara(semboller);
          const fiyatHaritasi = {};
          (satirlar || []).forEach(r => { if (r && r.id && r.fiyat) fiyatHaritasi[r.id] = r.fiyat; });
          GunlukRapor.fiyatlariGuncelle(fiyatHaritasi);
        } catch (_) {}
      }
      return gonder(res, 200, GunlukRapor.gunlukRaporAl(g.tarih));
    }

    // Fiyat Alarmları Uç Noktaları
    if (p === '/api/alarm/liste' && req.method === 'GET') {
      return gonder(res, 200, Alarm.alarmlariOku());
    }
    if (p === '/api/alarm/ekle' && req.method === 'POST') {
      const g = await govdeOku(req);
      return gonder(res, 200, Alarm.alarmEkle(g.sembol, g.ad, g.hedefFiyat, g.yon, g.not));
    }
    if (p === '/api/alarm/sil' && req.method === 'POST') {
      const g = await govdeOku(req);
      return gonder(res, 200, Alarm.alarmSil(g.id));
    }
    if (p === '/api/alarm/kontrol' && req.method === 'POST') {
      const g = await govdeOku(req);
      return gonder(res, 200, Alarm.kontrolEt(g.fiyatHaritasi || {}));
    }

    // 📬 Bildirim Merkezi Uç Noktaları (Tüm Cihazlarla Canlı Senkronize)
    if (p === '/api/bildirimler' && req.method === 'GET') {
      const piyasa = url.searchParams.get('piyasa') || 'hepsi';
      return gonder(res, 200, { bildirimler: BildirimServisi.bildirimleriGetir(piyasa) });
    }
    if (p === '/api/bildirimler/ekle' && req.method === 'POST') {
      const g = await govdeOku(req);
      return gonder(res, 200, BildirimServisi.bildirimEkle(g));
    }
    if (p === '/api/bildirimler/sil' && req.method === 'POST') {
      const g = await govdeOku(req);
      return gonder(res, 200, BildirimServisi.tekBildirimSil(g.id));
    }
    if (p === '/api/bildirimler/temizle' && req.method === 'POST') {
      return gonder(res, 200, BildirimServisi.tumunuTemizle());
    }
    if (p === '/api/bildirimler/okundu' && req.method === 'POST') {
      const g = await govdeOku(req);
      return gonder(res, 200, BildirimServisi.okunduYap(g?.piyasa || 'hepsi'));
    }

    if (p.startsWith('/api/')) return gonder(res, 404, { hata: 'Bilinmeyen istek' });

    // Sayfa ana girişi ise ziyaretçiyi kaydet
    if (p === '/' || p === '/index.html') {
      Ziyaret.ziyaretKaydet(req);
    }

    // Statik dosyalar (panel klasörü)
    const dosya = path.normalize(path.join(KOK, 'panel', p === '/' ? 'index.html' : p));
    if (!dosya.startsWith(path.join(KOK, 'panel'))) { res.writeHead(403); return res.end(); }
    fs.readFile(dosya, (err, icerik) => {
      if (err) { res.writeHead(404); return res.end('Bulunamadı'); }
      res.writeHead(200, { 'Content-Type': TIPLER[path.extname(dosya)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(icerik);
    });
  } catch (e) {
    console.error('Hata:', p, e.message);
    gonder(res, 500, { hata: e.message });
  }
});

const tarayiciAc = () => exec(`start "" http://localhost:${PORT}`);

sunucu.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log('Sistem zaten çalışıyor, panel açılıyor...'); tarayiciAc(); setTimeout(() => process.exit(0), 500); }
  else { console.error(e); process.exit(1); }
});

sunucu.listen(PORT, '0.0.0.0', () => {
  console.log('==============================================');
  console.log("  🛡️  ALPER'İN PİYASA ASİSTANI ÇALIŞIYOR");
  console.log(`  Bilgisayardan Adres : http://localhost:${PORT}`);
  console.log('  Kapatmak için bu pencereyi kapatın.');
  console.log('==============================================');
  if (!process.argv.includes('--tarayicisiz')) tarayiciAc();
  arkaPlanTakipBaslat();
});

// ---------------- Otomatik Arka Plan Tarama & TP/SL Takip Döngüsü ----------------
function dinamikTpSl(r, isShort) {
  const f = r.fiyat;
  const basamak = f >= 100 ? 2 : f >= 1 ? 3 : 5;
  const yuvarla = x => +Number(x).toFixed(basamak);
  const atrYuzde = (r.atr && f > 0) ? (r.atr / f) * 100 : 2.6;
  const stopYuzde = Math.min(5.5, Math.max(1.8, atrYuzde * 1.15));
  const hedefYuzde = Math.min(8.8, Math.max(2.8, stopYuzde * 1.6));
  return isShort
    ? { hedefFiyat: yuvarla(f * (1 - hedefYuzde / 100)), stopFiyat: yuvarla(f * (1 + stopYuzde / 100)) }
    : { hedefFiyat: yuvarla(f * (1 + hedefYuzde / 100)), stopFiyat: yuvarla(f * (1 - stopYuzde / 100)) };
}

async function taramaVeSinyalIsle(listeId) {
  const satirlar = await listeTara(listeId);
  try {
    const fiyatHaritasi = {};
    (satirlar || []).forEach(r => {
      if (r && r.id && r.fiyat) fiyatHaritasi[r.id] = r.fiyat;
      const t = r.tv || {};
      const gh = r.goreceliHacim || 0;
      const tuzakVar = r.isaretler?.some(i => i.tip === 'tuzak');
      const isBist = r.id?.startsWith('BIST:');
      const birim = isBist ? '₺' : '$';
      const benchDeg = r.benchDegisim ?? 0;

      // Piyasa Rejimi Kalkanı: Endeks/BTC sert satışta (-%2+) iken Long sinyalleri durdur
      const sertSatis = benchDeg <= -2.0;
      const zayifPiyasa = benchDeg <= -1.3;
      const longIzin = !sertSatis && (!zayifPiyasa || ((r.hizliPuan || 0) >= 80 && gh >= 1.5));

      const isSniper = longIzin && !tuzakVar && t.s2 > 0.15 && t.s4 > 0.15 && t.g1 > 0.1 &&
        (r.rsi?.s4 || 50) >= 48 && (r.rsi?.s4 || 50) <= 65 &&
        (r.hizliPuan || 0) >= 70 && gh >= 1.2;
      const isSniperShort = !isBist && !tuzakVar && t.s2 < -0.15 && t.s4 < -0.15 && t.g1 < -0.1 &&
        (r.rsi?.s4 || 50) <= 52 && (r.rsi?.s4 || 50) >= 32 &&
        (r.hizliPuan || 0) <= -70 && gh >= 1.2;
      const isKombo = longIzin && !tuzakVar && r.isaretler?.some(i => i.tip === 'kombo') &&
        t.s4 > 0.1 && t.g1 > 0 && gh >= 1.1 && (r.rsi?.s4 || 50) <= 68;
      const uygunFiyat = (r.fiyat >= 4.0 || r.id?.startsWith('BINANCE:') || r.id?.startsWith('OKX:') || r.id?.startsWith('GATE:'));

      if ((isSniper || isKombo) && uygunFiyat) {
        const sTipi = isSniper ? '🎯 Sniper Long' : '⭐ Özel Kombo';
        const { hedefFiyat, stopFiyat } = dinamikTpSl(r, false);
        GunlukRapor.sinyalKaydet({
          sembol: r.id,
          ad: r.ad,
          tur: r.id.startsWith('BINANCE:') ? 'kripto' : (r.id.includes('XAU') || r.id.includes('SILVER') || r.id === 'BIST:ALTIN' ? 'emtia' : 'bist'),
          yon: 'AL',
          sinyalTipi: sTipi,
          fiyat: r.fiyat,
          hedefFiyat,
          stopFiyat
        });
        BildirimServisi.bildirimEkle({
          baslik: isSniper ? '🎯 YENİ SNIPER FIRSATI' : '⭐ ÖZEL KOMBO SİNYALİ',
          mesaj: `${r.kod} (${r.ad || ''}) ${isSniper ? 'tüm periyotlarda hacimli AL yakarak Sniper Avcısına girdi!' : 'trend ve hacim destekli kombo onayı aldı!'} Fiyat: ${r.fiyat} ${birim}`,
          tur: isSniper ? 'sniper' : 'firsat',
          yon: 'LONG',
          sembolId: r.id,
          kod: r.kod,
          ad: r.ad,
          fiyat: r.fiyat
        });
      } else if (isSniperShort && uygunFiyat) {
        const { hedefFiyat, stopFiyat } = dinamikTpSl(r, true);
        GunlukRapor.sinyalKaydet({
          sembol: r.id,
          ad: r.ad,
          tur: r.id.startsWith('BINANCE:') ? 'kripto' : (r.id.includes('XAU') || r.id.includes('SILVER') ? 'emtia' : 'forex'),
          yon: 'SAT',
          sinyalTipi: '🎯 Sniper Short',
          fiyat: r.fiyat,
          hedefFiyat,
          stopFiyat
        });
        BildirimServisi.bildirimEkle({
          baslik: '🎯 ⬇️ YENİ SNIPER SHORT FIRSATI',
          mesaj: `${r.kod} (${r.ad || ''}) tüm periyotlarda SAT yakarak Sniper Short radarına girdi! Fiyat: ${r.fiyat} ${birim}`,
          tur: 'sniper',
          yon: 'SHORT',
          sembolId: r.id,
          kod: r.kod,
          ad: r.ad,
          fiyat: r.fiyat
        });
      }
    });
    GunlukRapor.fiyatlariGuncelle(fiyatHaritasi);
    Alarm.kontrolEt(fiyatHaritasi);
  } catch (_) {}
  return satirlar;
}

function bistSeansAcikMi() {
  const tr = new Date(Date.now() + 3 * 3600 * 1000);
  const gun = tr.getUTCDay(); // 1-5 hafta içi
  if (gun === 0 || gun === 6) return false;
  const dk = tr.getUTCHours() * 60 + tr.getUTCMinutes();
  return dk >= 10 * 60 && dk <= 18 * 60 + 15;
}

function arkaPlanTakipBaslat() {
  const turCalistir = async () => {
    try {
      // 1. Günlük rapordaki açık sinyallerin fiyatlarını güncelle
      const rapor = GunlukRapor.gunlukRaporAl();
      const semboller = [...new Set((rapor.sinyaller || []).map(s => s.sembol))];
      if (semboller.length > 0) {
        const satirlar = await V.sembolleriTara(semboller).catch(() => []);
        const harita = {};
        (satirlar || []).forEach(r => { if (r && r.id && r.fiyat) harita[r.id] = r.fiyat; });
        if (Object.keys(harita).length > 0) {
          GunlukRapor.fiyatlariGuncelle(harita);
          Alarm.kontrolEt(harita);
        }
      }
      // 2. Kripto 7/24, BIST ise seans saatlerinde otomatik taranır
      await taramaVeSinyalIsle('kripto').catch(() => {});
      if (bistSeansAcikMi()) {
        await taramaVeSinyalIsle('tum-bist').catch(() => {});
      }
    } catch (_) {}
  };
  setTimeout(turCalistir, 20 * 1000);
  setInterval(turCalistir, 5 * 60 * 1000);
}
