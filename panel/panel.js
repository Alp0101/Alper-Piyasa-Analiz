'use strict';
// ================= Durum =================
const D = {
  listeler: null, aktifId: localStorage.getItem('aktifListe') || 'favoriler',
  satirlar: [], filtre: 'hepsi', arama: '', sirala: { alan: null, artan: false },
  gosterilen: 150, detaySembol: null, detayTf: 's4', detayVeri: null,
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(yol, ayar) {
  const r = await fetch(yol, ayar);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.hata || ('Sunucu hatası ' + r.status));
  return j;
}
function bildir(m, sure = 2600) {
  const b = $('#bildirim'); b.textContent = m; b.classList.remove('gizli');
  clearTimeout(bildir.t); bildir.t = setTimeout(() => b.classList.add('gizli'), sure);
}
const sayi = (v, b) => {
  if (v == null || !isFinite(v)) return '—';
  if (b == null) b = Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 2 : 5;
  return v.toLocaleString('tr-TR', { minimumFractionDigits: b, maximumFractionDigits: b });
};
const ROZET = { 2: '▲▲', 1: '▲', 0: '●', '-1': '▼', '-2': '▼▼' };
const rozet = k => k == null ? '<span class="rozet r0">—</span>' : `<span class="rozet r${k}">${ROZET[k]}</span>`;

// ================= Listeler =================
async function listeleriYukle() {
  D.listeler = await api('/api/listeler');
  if (!D.listeler.listeler.find(l => l.id === D.aktifId)) D.aktifId = D.listeler.listeler[0]?.id;
  listeMenuCiz();
}
async function listeleriKaydet() {
  D.listeler = await api('/api/listeler', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(D.listeler) });
  listeMenuCiz();
}
const aktifListe = () => D.listeler.listeler.find(l => l.id === D.aktifId);

function listeMenuCiz() {
  $('#listeler').innerHTML = D.listeler.listeler.map(l => `
    <li data-id="${esc(l.id)}" class="${l.id === D.aktifId ? 'aktif' : ''}">
      <span>${esc(l.ad)}</span><span class="say">${l.dinamik ? 'tümü' : l.semboller.length}</span>
    </li>`).join('');
  const l = aktifListe();
  $('#listeBaslik').textContent = l ? l.ad : '—';
  $('#hacimFiltre').classList.toggle('gizli', !(l && l.dinamik));
}

$('#listeler').addEventListener('click', e => {
  const li = e.target.closest('li'); if (!li) return;
  D.aktifId = li.dataset.id; localStorage.setItem('aktifListe', D.aktifId);
  D.gosterilen = 150; D.satirlar = [];
  listeMenuCiz(); tablo(); tara();
});

$('#yeniListeBtn').onclick = async () => {
  const ad = prompt('Yeni listenin adı:', 'Yeni Listem');
  if (!ad || !ad.trim()) return;
  const id = 'liste-' + Date.now();
  D.listeler.listeler.push({ id, ad: ad.trim(), semboller: [] });
  await listeleriKaydet();
  D.aktifId = id; localStorage.setItem('aktifListe', id);
  listeMenuCiz(); tara();
  bildir('Liste oluşturuldu. Üstteki kutudan sembol ekleyebilirsiniz.');
  $('#ekleInput').focus();
};
$('#adDegistirBtn').onclick = async () => {
  const l = aktifListe(); if (!l) return;
  const ad = prompt('Listenin yeni adı:', l.ad);
  if (!ad || !ad.trim()) return;
  l.ad = ad.trim(); await listeleriKaydet(); bildir('Liste adı değiştirildi.');
};
$('#listeSilBtn').onclick = async () => {
  const l = aktifListe(); if (!l) return;
  if (D.listeler.listeler.length <= 1) return bildir('Son liste silinemez.');
  if (!confirm(`"${l.ad}" listesi silinsin mi?`)) return;
  D.listeler.listeler = D.listeler.listeler.filter(x => x.id !== l.id);
  D.aktifId = D.listeler.listeler[0].id;
  await listeleriKaydet(); tara(); bildir('Liste silindi.');
};
$('#varsayilanBtn').onclick = async () => {
  if (!confirm('Tüm listeler başlangıçtaki hâline dönecek. Kendi eklediğiniz listeler silinecek. Emin misiniz?')) return;
  D.listeler = await api('/api/listeler/varsayilan', { method: 'POST' });
  D.aktifId = 'favoriler'; listeMenuCiz(); tara(); bildir('Varsayılan listeler yüklendi.');
};

async function sembolEkle(id, listeId = D.aktifId) {
  const l = D.listeler.listeler.find(x => x.id === listeId);
  if (!l) return;
  if (l.dinamik) {
    if ((l.cikarilanlar || []).includes(id)) { l.cikarilanlar = l.cikarilanlar.filter(x => x !== id); await listeleriKaydet(); bildir('Tekrar listeye alındı.'); tara(); }
    else bildir('Bu liste zaten tüm BIST hisselerini kapsıyor. Başka bir listeye ekleyin.');
    return;
  }
  if (l.semboller.includes(id)) return bildir('Bu sembol listede zaten var.');
  l.semboller.push(id); await listeleriKaydet();
  bildir(`${id.split(':')[1]} → "${l.ad}" listesine eklendi.`);
  if (listeId === D.aktifId) tara();
}
async function sembolKaldir(id) {
  const l = aktifListe(); if (!l) return;
  if (l.dinamik) { l.cikarilanlar = [...new Set([...(l.cikarilanlar || []), id])]; }
  else l.semboller = l.semboller.filter(x => x !== id);
  await listeleriKaydet();
  D.satirlar = D.satirlar.filter(r => r.id !== id); tablo();
  bildir(`${id.split(':')[1]} listeden kaldırıldı.`);
}

// Sembol arama / ekleme kutusu
let araZamanlayici;
$('#ekleInput').addEventListener('input', e => {
  clearTimeout(araZamanlayici);
  const q = e.target.value.trim();
  if (q.length < 2) return $('#ekleSonuc').classList.add('gizli');
  araZamanlayici = setTimeout(async () => {
    const kutu = $('#ekleSonuc');
    kutu.innerHTML = '<div><small>Aranıyor...</small></div>'; kutu.classList.remove('gizli');
    try {
      const s = await api('/api/ara?q=' + encodeURIComponent(q));
      const TUR = { bist: 'BIST', emtia: 'Emtia', doviz: 'Döviz', endeks: 'Endeks', kripto: 'Kripto' };
      kutu.innerHTML = s.length ? s.map(x => `<div data-id="${esc(x.id)}"><span><b>${esc(x.id.split(':')[1])}</b> ${esc(x.ad)}</span><small>${TUR[x.tur] || ''}</small></div>`).join('')
        : '<div><small>Sonuç bulunamadı</small></div>';
    } catch (err) { kutu.innerHTML = `<div><small>Hata: ${esc(err.message)}</small></div>`; }
  }, 300);
});
$('#ekleSonuc').addEventListener('click', e => {
  const d = e.target.closest('[data-id]'); if (!d) return;
  sembolEkle(d.dataset.id);
  $('#ekleInput').value = ''; $('#ekleSonuc').classList.add('gizli');
});
document.addEventListener('click', e => { if (!e.target.closest('.ekle-kutu')) $('#ekleSonuc').classList.add('gizli'); });

// ================= Tarama tablosu =================
let taramaSayaci = 0;
async function tara() {
  const benim = ++taramaSayaci;
  $('#durum').textContent = 'Veriler alınıyor...';
  try {
    const r = await api('/api/tarama?liste=' + encodeURIComponent(D.aktifId));
    if (benim !== taramaSayaci) return;
    D.satirlar = r.satirlar;
    $('#durum').textContent = 'Son güncelleme: ' + new Date(r.zaman).toLocaleTimeString('tr-TR') + ` · ${r.satirlar.length} varlık`;
    tablo();
  } catch (e) {
    $('#durum').textContent = '⚠️ ' + e.message;
  }
}

const deger = (r, alan) => alan.split('.').reduce((o, k) => (o == null ? null : o[k]), r);
const norm = s => String(s || '').toLocaleUpperCase('tr-TR')
  .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C');
function filtreliSatirlar() {
  const q = norm(D.arama);
  const l = aktifListe();
  const minHacim = l && l.dinamik ? +$('#hacimFiltre').value : 0;
  let s = D.satirlar.filter(r => {
    if (q && !(norm(r.kod).includes(q) || norm(r.ad).includes(q))) return false;
    if (minHacim && (r.tlHacim || 0) < minHacim) return false;
    const y = r.yon || {};
    switch (D.filtre) {
      case 'firsat': return r.isaretler?.some(i => i.tip === 'firsat');
      case 'tuzak': return r.isaretler?.some(i => i.tip === 'tuzak');
      case 'yukselis': return y.s2 > 0 && y.s4 > 0 && y.g1 > 0;
      case 'dusus': return y.s2 < 0 && y.s4 < 0 && y.g1 < 0;
      default: return true;
    }
  });
  if (D.sirala.alan) {
    const a = D.sirala.alan, k = D.sirala.artan ? 1 : -1;
    s = [...s].sort((x, y) => {
      const vx = deger(x, a), vy = deger(y, a);
      if (vx == null) return 1; if (vy == null) return -1;
      return typeof vx === 'string' ? vx.localeCompare(vy, 'tr') * k : (vx - vy) * k;
    });
  }
  return s;
}

function tablo() {
  const s = filtreliSatirlar();
  const goster = s.slice(0, D.gosterilen);
  $('#tabloGovde').innerHTML = goster.map(r => {
    const deg = r.degisim;
    const konum = r.ayKonum == null ? '—' : `<span class="konum" title="%${r.ayKonum}"><i style="left:calc(${Math.max(0, Math.min(100, r.ayKonum))}% - 2px)"></i></span>`;
    const puanRenk = r.hizliPuan == null ? '' : r.hizliPuan > 15 ? 'art' : r.hizliPuan < -15 ? 'eks' : '';
    return `<tr data-id="${esc(r.id)}">
      <td><span class="kod">${esc(r.kod)}</span><span class="ad">${esc(r.ad)}</span></td>
      <td class="sag">${r.veriYok ? '<small class="kucuk">veri yok</small>' : sayi(r.fiyat)}</td>
      <td class="sag ${deg > 0 ? 'art' : deg < 0 ? 'eks' : ''}">${deg == null ? '—' : (deg > 0 ? '+' : '') + sayi(deg, 2) + '%'}</td>
      <td class="orta">${rozet(r.yon?.s2)}</td><td class="orta">${rozet(r.yon?.s4)}</td><td class="orta">${rozet(r.yon?.g1)}</td>
      <td class="sag ${r.rsi?.s4 > 70 ? 'eks' : r.rsi?.s4 < 30 ? 'art' : ''}">${sayi(r.rsi?.s4, 0)}</td>
      <td class="sag">${r.goreceliHacim == null ? '—' : sayi(r.goreceliHacim, 1) + 'x'}</td>
      <td>${konum}</td>
      <td class="sag ${puanRenk}"><b>${r.hizliPuan ?? '—'}</b></td>
      <td>${(r.isaretler || []).map(i => `<span class="isaret ${i.tip}">${esc(i.metin)}</span>`).join('')}</td>
      <td><button class="sil" data-sil="${esc(r.id)}" title="Listeden kaldır">✖</button></td>
    </tr>`;
  }).join('');
  $('#dahaFazla').classList.toggle('gizli', s.length <= D.gosterilen);
  $('#bosMesaj').classList.toggle('gizli', s.length > 0 || !D.satirlar.length);
  document.querySelectorAll('th[data-s]').forEach(th => {
    th.classList.toggle('sirali', th.dataset.s === D.sirala.alan);
    th.classList.toggle('artan', th.dataset.s === D.sirala.alan && D.sirala.artan);
  });
}

$('#tabloGovde').addEventListener('click', e => {
  const sil = e.target.closest('[data-sil]');
  if (sil) { e.stopPropagation(); return sembolKaldir(sil.dataset.sil); }
  const tr = e.target.closest('tr[data-id]');
  if (tr) detayAc(tr.dataset.id);
});
document.querySelectorAll('th[data-s]').forEach(th => th.addEventListener('click', () => {
  const a = th.dataset.s;
  D.sirala = D.sirala.alan === a ? { alan: a, artan: !D.sirala.artan } : { alan: a, artan: a === 'kod' };
  tablo();
}));
$('#filtreCipler').addEventListener('click', e => {
  const b = e.target.closest('.cip'); if (!b) return;
  document.querySelectorAll('.cip').forEach(x => x.classList.toggle('aktif', x === b));
  D.filtre = b.dataset.f; D.gosterilen = 150; tablo();
});

// Fırsat Radarı: En temiz, çoklu periyotta onaylı varlıkları öne çıkarır
$('#firsatRadarBtn').onclick = () => {
  const fCip = document.querySelector('.cip[data-f="firsat"]');
  if (fCip) {
    document.querySelectorAll('.cip').forEach(x => x.classList.remove('aktif'));
    fCip.classList.add('aktif');
    D.filtre = 'firsat';
    D.gosterilen = 150;
    tablo();
    bildir('🎯 Fırsat Radarı Aktif: Çoklu periyot ve hacim onayı almış varlıklar listelendi.');
  }
};
$('#aramaInput').addEventListener('input', e => { D.arama = e.target.value.trim(); D.gosterilen = 150; tablo(); });
$('#hacimFiltre').addEventListener('change', tablo);
$('#dahaBtn').onclick = () => { D.gosterilen += 150; tablo(); };
$('#yenileBtn').onclick = () => { tara(); if (D.detaySembol) detayYukle(true); };
setInterval(() => { if ($('#otoYenile').checked && !document.hidden) tara(); }, 60_000);

// ================= Ayrıntılı analiz =================
function detayAc(id) {
  D.detaySembol = id;
  $('#perde').classList.remove('gizli'); $('#detay').classList.remove('gizli');
  const r = D.satirlar.find(x => x.id === id);
  $('#dAd').textContent = (r ? r.kod + ' · ' + (r.ad || '') : id);
  $('#dAlt').textContent = 'Analiz ediliyor...';
  $('#dTv').href = 'https://tr.tradingview.com/chart/?symbol=' + encodeURIComponent(id.startsWith('YAHOO:') ? id.split(':')[1] : id);
  detayYukle();
}
function detayKapat() { D.detaySembol = null; $('#perde').classList.add('gizli'); $('#detay').classList.add('gizli'); }
$('#dKapat').onclick = detayKapat; $('#perde').onclick = detayKapat;
document.addEventListener('keydown', e => { if (e.key === 'Escape') detayKapat(); });
$('#dFavori').onclick = () => D.detaySembol && sembolEkle(D.detaySembol, 'favoriler');

// Detay önbelleği (Tekrar tıklanan hisseyi anında salisesinde açar)
const analizOnbellek = new Map();

async function detayYukle(zorla = false) {
  const id = D.detaySembol;
  const onbellekKey = `${id}:${D.detayTf}`;
  
  if (!zorla && analizOnbellek.has(onbellekKey)) {
    D.detayVeri = analizOnbellek.get(onbellekKey);
    $('#dAd').textContent = `${id.split(':')[1]} · ${D.detayVeri.ad}`;
    $('#dAlt').textContent = `Analiz zamanı: ${new Date(D.detayVeri.zaman).toLocaleString('tr-TR')}`;
    detayCiz();
    return;
  }

  $('#dIcerik').innerHTML = '<div class="yukleniyor">⚡ Analiz ve seviyeler hesaplanıyor...</div>';
  try {
    const v = await api(`/api/analiz?sembol=${encodeURIComponent(id)}&tf=${encodeURIComponent(D.detayTf)}`);
    if (id !== D.detaySembol) return;
    analizOnbellek.set(onbellekKey, v);
    D.detayVeri = v;
    $('#dAd').textContent = `${id.split(':')[1]} · ${v.ad}`;
    $('#dAlt').textContent = `Analiz zamanı: ${new Date(v.zaman).toLocaleString('tr-TR')}` + (v.not ? ' · ' + v.not : '');
    detayCiz();
  } catch (e) {
    $('#dIcerik').innerHTML = `<div class="yukleniyor">⚠️ ${esc(e.message)}</div>`;
  }
}

const yonRenk = k => k >= 2 ? '#34d399' : k === 1 ? '#6ee7b7' : k === 0 ? '#cbd5e1' : k === -1 ? '#f87171' : '#ef4444';
const ikon = k => k >= 1 ? '🟢' : k <= -1 ? '🔴' : '🟠';
const TF_ADI_HARITA = { m15: '15 Dakika', s1: '1 Saat', s2: '2 Saat', s4: '4 Saat', g1: 'Günlük (24S)', h1: 'Haftalık', ay1: 'Aylık' };

function kisaOzet(z) {
  if (z.hata) return z.hata;
  const t = z.tuzak;
  if (z.yonKod >= 1 && (t.seviye === 'Yüksek' || (t.seviye === 'Orta' && t.tip === 'boga'))) return 'Yükseliş var ama tuzak işaretleri mevcut, yeni alım için acele etmeyin.';
  if (z.yonKod === 2) return 'Yöntemlerin çoğu yükselişte uzlaşıyor.';
  if (z.yonKod === 1) return 'Hafif olumlu, teyit beklenebilir.';
  if (z.yonKod === 0) return 'Net yön yok, beklemek daha güvenli.';
  if (z.yonKod === -1) return 'Hafif olumsuz, alım için erken.';
  return 'Yöntemlerin çoğu düşüşte uzlaşıyor, alım yapılmamalı.';
}

function detayCiz() {
  const v = D.detayVeri; if (!v) return;
  const tfler = ['m15', 's1', 's2', 's4', 'g1', 'h1', 'ay1'];
  const ozet = tfler.map(tf => {
    const z = v.zamanDilimleri[tf];
    if (!z || z.hata) {
      return `<div class="tf-kart ${tf === D.detayTf ? 'secili' : ''}" data-tf="${tf}">
        <h3>${TF_ADI_HARITA[tf] || tf}</h3>
        <div class="kucuk" style="margin-top:6px; opacity:0.6;">${esc(z?.hata || 'Veri yok')}</div>
      </div>`;
    }
    const sol = (z.skor + 100) / 2;
    return `<div class="tf-kart ${tf === D.detayTf ? 'secili' : ''}" data-tf="${tf}">
      <h3>${z.ad}</h3>
      <div class="tf-yon" style="color:${yonRenk(z.yonKod)}">${ikon(z.yonKod)} ${esc(z.yon)}</div>
      <div class="skor-cubuk"><i style="left:calc(${sol}% - 2px)"></i></div>
      <div class="kucuk">Puan: <b>${z.skor > 0 ? '+' : ''}${z.skor}</b></div>
      <div class="kucuk" style="margin-top:4px">Tuzak: <b style="color:${z.tuzak.seviye === 'Yüksek' ? '#ef4444' : z.tuzak.seviye === 'Orta' ? '#f97316' : '#94a3b8'}">${z.tuzak.seviye}</b></div>
    </div>`;
  }).join('');

  const z = v.zamanDilimleri[D.detayTf];
  const bt = v.backtest;
  let alt = '';
  if (z && !z.hata) {
    const yontemler = z.yontemler.map(m => {
      const p = m.puan || 0, gen = Math.abs(p) / 2 * 50;
      const renk = p > 0 ? '#10b981' : p < 0 ? '#ef4444' : '#64748b';
      const konum = p >= 0 ? `left:50%;width:${gen}%` : `left:${50 - gen}%;width:${gen}%`;
      return `<div class="yontem ${m.veriYok ? 'veriyok' : ''}">
        <b>${esc(m.ad)}</b>
        <div title="Puan: ${p} (-2 ile +2 arası)"><div class="puan-cubuk"><span class="orta-cizgi"></span><span class="dolu" style="${konum};background:${renk}"></span></div><div class="kucuk" style="text-align:center;margin-top:3px">${p > 0 ? '+' : ''}${p}</div></div>
        <div class="yorum">${esc(m.yorum)}</div>
      </div>`;
    }).join('');
    const s = z.seviyeler;
    const t = z.tuzak;
    const fib = z.fibonacci;

    let fibHtml = '';
    if (fib) {
      fibHtml = `
      <div class="kutu" style="border-left: 3px solid #8b5cf6;">
        <h4>🌀 Fibonacci Düzeltme Seviyeleri (${fib.yon === 'yukalis' ? 'Yükseliş Dalgası' : 'Son Dalga'})</h4>
        <div class="seviye-satir"><span>Referans Tepe / Dip</span><b>${sayi(fib.tepe)} / ${sayi(fib.dip)}</b></div>
        <div class="seviye-satir"><span>Fib 0.236 (İlk Destek/Direnç)</span><b>${sayi(fib.f0236)}</b></div>
        <div class="seviye-satir"><span>Fib 0.382 (Sığ Düzeltme)</span><b>${sayi(fib.f0382)}</b></div>
        <div class="seviye-satir" style="background:#8b5cf622; padding:4px 6px; border-radius:4px;"><span>⭐ Fib 0.500 (Denge / Tepki Seviyesi)</span><b style="color:#a78bfa">${sayi(fib.f0500)}</b></div>
        <div class="seviye-satir" style="background:#10b98122; padding:4px 6px; border-radius:4px;"><span>🎯 Fib 0.618 (Altın Oran / Güçlü Tepki)</span><b style="color:#34d399">${sayi(fib.f0618)}</b></div>
        <div class="seviye-satir"><span>Fib 0.786 (Son Savunma Hattı)</span><b>${sayi(fib.f0786)}</b></div>
        <div class="uyari">0.50 ve 0.618 (Altın Oran) seviyeleri kurumsal yatırımcıların dönüş ve tepki alımı için en çok izlediği seviyelerdir.</div>
      </div>`;
    }

    let btHtml = '';
    if (bt && !bt.hata && bt.toplamIslem > 0) {
      const btRenk = bt.basariOrani >= 60 ? '#10b981' : bt.basariOrani >= 45 ? '#f59e0b' : '#ef4444';
      btHtml = `
      <div class="kutu" style="border-left: 3px solid ${btRenk};">
        <h4>🧪 Geçmiş Test Sonucu (${z.ad})</h4>
        <div class="seviye-satir"><span>Geçmiş Sinyal Sayısı</span><b>${bt.toplamIslem} işlem</b></div>
        <div class="seviye-satir"><span>Hedefe Ulaşma Oranı</span><b style="color:${btRenk}">%${bt.basariOrani} (${bt.basariliSayi} Başarılı / ${bt.basarisizSayi} Stop)</b></div>
        <div class="seviye-satir"><span>Ortalama Kazanç / Kayıp</span><b>+${bt.ortKazanc}% / -${bt.ortKayip}%</b></div>
        <div class="seviye-satir"><span>Kâr Faktörü</span><b>${bt.karFaktoru}</b></div>
        <div class="uyari">Bu sonuç, bu varlığın geçmiş mumlarında benzer puan ve kurallarla üretilmiş alım sinyallerinin gerçek sonucudur.</div>
      </div>`;
    }

    alt = `<div class="iki-kolon">
      <div class="kutu"><h4>🔍 ${z.ad} grafik – 8 yöntemin yorumu</h4>${yontemler}</div>
      <div>
        <div class="kutu tuzak-kutu ${t.seviye}">
          <h4>⚠️ Tuzak Kontrolü: ${t.seviye}</h4>
          <div style="font-size:13px">${esc(t.aciklama)}</div>
          ${t.nedenler.length ? '<ul style="margin:8px 0 0;padding-left:18px;font-size:12.5px">' + t.nedenler.map(n => `<li>${esc(n)}</li>`).join('') + '</ul>' : ''}
        </div>
        <div class="kutu">
          <h4>📏 Önemli Seviyeler</h4>
          <div class="seviye-satir"><span>Şu anki fiyat</span><b>${sayi(s.fiyat)}</b></div>
          <div class="seviye-satir"><span>1. Direnç (tavan)</span><b class="eks">${sayi(s.direnc)}</b></div>
          <div class="seviye-satir"><span>2. Direnç</span><b class="eks">${sayi(s.direnc2)}</b></div>
          <div class="seviye-satir"><span>1. Destek (taban)</span><b class="art">${sayi(s.destek)}</b></div>
          <div class="seviye-satir"><span>2. Destek</span><b class="art">${sayi(s.destek2)}</b></div>
          <div class="seviye-satir"><span>Ortalama mum oynaklığı (ATR)</span><b>${sayi(s.atr)}</b></div>
        </div>
        <div class="kutu">
          <h4>🎯 Alım yapılırsa örnek plan</h4>
          <div class="seviye-satir"><span>Zarar-kes (stop)</span><b class="eks">${sayi(s.alimStop)}</b></div>
          <div class="seviye-satir"><span>1. Hedef</span><b class="art">${sayi(s.alimHedef)}</b></div>
          <div class="seviye-satir"><span>2. Hedef</span><b class="art">${sayi(s.alimHedef2)}</b></div>
          <div class="seviye-satir"><span>Risk / Kazanç oranı</span><b>1 : ${sayi(s.riskOdul, 2)}</b></div>
          <div class="uyari">Zarar-kes seviyesi piyasanın oynaklığına (ATR) ve en yakın desteğe göre hesaplanır. ${z.yonKod <= 0 ? '<b style="color:#f97316">Bu zaman diliminde yön olumlu değil, plan sadece bilgi amaçlıdır.</b>' : ''}</div>
        </div>
        ${fibHtml}
        ${btHtml}
      </div>
    </div>
    <div class="uyari">Son mum: ${new Date(z.sonMum).toLocaleString('tr-TR')} · ${z.mumSayisi} mum incelendi. Bu analiz bir karar destek aracıdır, yatırım tavsiyesi değildir. Son karar her zaman sizindir.</div>`;
  }
  $('#dIcerik').innerHTML = `<div class="tf-ozet">${ozet}</div>${alt}`;
}
$('#dIcerik').addEventListener('click', e => {
  const k = e.target.closest('.tf-kart[data-tf]'); if (!k) return;
  D.detayTf = k.dataset.tf;
  detayYukle();
});

// ================= Demo Al-Sat & Portföy =================
let demoPortfoyVerisi = null;

async function demoPortfoyYukle() {
  try {
    demoPortfoyVerisi = await api('/api/demo/portfoy');
    const p = demoPortfoyVerisi;
    $('#ustKasaBakiye').textContent = sayi(p.toplamVarlik, 0) + ' TL';
    $('#demoNakitBakiye').textContent = sayi(p.bakiye, 2) + ' TL';
    $('#demoToplamVarlik').textContent = sayi(p.toplamVarlik, 2) + ' TL';

    const netRenk = p.toplamNetKarTL >= 0 ? '#10b981' : '#ef4444';
    $('#demoNetKar').innerHTML = `<span style="color:${netRenk}">${p.toplamNetKarTL >= 0 ? '+' : ''}${sayi(p.toplamNetKarTL, 2)} TL (%${sayi(p.toplamNetKarYuzde, 2)})</span>`;
    $('#demoBasariOrani').textContent = `%${p.istatistik.basariOrani} (${p.istatistik.basarili}K / ${p.istatistik.basarisiz}Z)`;

    demoPortfoyCiz();
  } catch (_) {}
}

function demoPortfoyCiz() {
  const p = demoPortfoyVerisi; if (!p) return;
  // Açık Pozisyonlar
  const aciklar = p.acikPozisyonlar;
  if (!aciklar.length) {
    $('#demoAcikPozisyonlar').innerHTML = '<div class="bos" style="padding:15px;">Henüz açık demo pozisyonunuz yok. Detay penceresinden "🛒 Demo Al" butonunu kullanabilirsiniz.</div>';
  } else {
    $('#demoAcikPozisyonlar').innerHTML = `
      <table style="width:100%;">
        <thead>
          <tr>
            <th>Sembol</th>
            <th class="sag">Adet</th>
            <th class="sag">Alış Fiyatı</th>
            <th class="sag">Güncel Fiyat</th>
            <th class="sag">Kâr/Zarar</th>
            <th class="orta">İşlem</th>
          </tr>
        </thead>
        <tbody>
          ${aciklar.map(poz => {
            const karRenk = poz.karZararTL >= 0 ? 'art' : 'eks';
            return `
            <tr>
              <td><b>${esc(poz.sembol.split(':')[1])}</b> <small class="kucuk">${esc(poz.ad)}</small></td>
              <td class="sag">${poz.adet}</td>
              <td class="sag">${sayi(poz.alisFiyat)}</td>
              <td class="sag">${sayi(poz.anlikFiyat)}</td>
              <td class="sag ${karRenk}"><b>${poz.karZararTL >= 0 ? '+' : ''}${sayi(poz.karZararTL, 2)} TL</b> (%${sayi(poz.karZararYuzde, 2)})</td>
              <td class="orta"><button class="btn tehlike" style="padding:3px 8px; font-size:11px;" onclick="demoPozisyonKapat('${esc(poz.id)}', ${poz.anlikFiyat})">Kapat (Sat)</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  // Kapanan İşlemler
  const kapali = p.kapananIslemler;
  if (!kapali.length) {
    $('#demoKapananIslemler').innerHTML = '<div class="bos" style="padding:15px;">Henüz kapanmış işlem geçmişi yok.</div>';
  } else {
    $('#demoKapananIslemler').innerHTML = `
      <table style="width:100%;">
        <thead>
          <tr>
            <th>Sembol</th>
            <th class="sag">Adet</th>
            <th class="sag">Alış / Satış</th>
            <th class="sag">Net Sonuç</th>
            <th class="sag">Tarih</th>
          </tr>
        </thead>
        <tbody>
          ${kapali.map(k => {
            const karRenk = k.karZararTL >= 0 ? 'art' : 'eks';
            return `
            <tr>
              <td><b>${esc(k.sembol.split(':')[1])}</b></td>
              <td class="sag">${k.adet}</td>
              <td class="sag">${sayi(k.alisFiyat)} ➔ ${sayi(k.satisFiyat)}</td>
              <td class="sag ${karRenk}"><b>${k.karZararTL >= 0 ? '+' : ''}${sayi(k.karZararTL, 2)} TL</b> (%${sayi(k.karZararYuzde, 2)})</td>
              <td class="sag kucuk">${new Date(k.satisTarih).toLocaleDateString('tr-TR')} ${new Date(k.satisTarih).toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'})}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }
}

window.demoPozisyonKapat = async (pozId, guncelFiyat) => {
  if (!confirm('Bu pozisyonu güncel fiyattan kapatmak (satmak) istediğinize emin misiniz?')) return;
  try {
    const res = await api('/api/demo/sat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pozId, satisFiyat: guncelFiyat })
    });
    bildir(`Pozisyon kapatıldı! Sonuç: ${res.kapandi.karZararTL >= 0 ? '+' : ''}${res.kapandi.karZararTL} TL`);
    await demoPortfoyYukle();
  } catch (e) {
    bildir('Hata: ' + e.message);
  }
};

$('#demoPortfoyBtn').onclick = () => {
  $('#perde').classList.remove('gizli');
  $('#demoModal').classList.remove('gizli');
  demoPortfoyYukle();
};
$('#demoKapatBtn').onclick = () => {
  $('#perde').classList.add('gizli');
  $('#demoModal').classList.add('gizli');
};
$('#demoSifirlaBtn').onclick = async () => {
  if (!confirm('Sanal kasanız sıfırlanacak ve 1.000.000 TL nakit bakiyeye dönecek. Tüm demo işlemler silinecek. Onaylıyor musunuz?')) return;
  await api('/api/demo/sifirla', { method: 'POST' });
  bildir('Demo kasa sıfırlandı: 1.000.000 TL');
  await demoPortfoyYukle();
};

$('#dDemoAlBtn').onclick = () => {
  const v = D.detayVeri;
  if (!v) return;
  const z = v.zamanDilimleri[D.detayTf] || v.zamanDilimleri.s4 || v.zamanDilimleri.g1;
  const f = z?.seviyeler?.fiyat;
  if (!f) return bildir('Fiyat verisi alınamadı.');

  const bakiye = demoPortfoyVerisi?.bakiye || 1000000;
  const varsayilanAdet = Math.max(1, Math.floor((bakiye * 0.05) / f)); // %5 öneri

  $('#emirSembolAd').textContent = `${v.sembol.split(':')[1]} · ${v.ad}`;
  $('#emirAlisFiyat').value = f;
  $('#emirAdet').value = varsayilanAdet;
  $('#emirStopFiyat').value = z.seviyeler.alimStop || '';
  $('#emirHedefFiyat').value = z.seviyeler.alimHedef || '';

  emirHesapla();
  $('#perde').classList.remove('gizli');
  $('#demoEmirModal').classList.remove('gizli');
};

function emirHesapla() {
  const f = parseFloat($('#emirAlisFiyat').value) || 0;
  const adet = parseFloat($('#emirAdet').value) || 0;
  const stop = parseFloat($('#emirStopFiyat').value) || 0;
  const hedef = parseFloat($('#emirHedefFiyat').value) || 0;

  const tutar = f * adet;
  $('#emirToplamTutar').textContent = sayi(tutar, 2) + ' TL';

  if (f > 0 && stop > 0 && hedef > 0 && f > stop && hedef > f) {
    const risk = (f - stop) * adet;
    const kazanc = (hedef - f) * adet;
    const rr = (hedef - f) / (f - stop);
    $('#emirRiskOdul').textContent = `1 : ${sayi(rr, 2)}`;
    $('#emirOlasiKarZarar').innerHTML = `<span class="art">+${sayi(kazanc, 0)} TL</span> / <span class="eks">-${sayi(risk, 0)} TL</span>`;
  } else {
    $('#emirRiskOdul').textContent = '—';
    $('#emirOlasiKarZarar').textContent = '—';
  }
}

$('#emirAlisFiyat').oninput = emirHesapla;
$('#emirAdet').oninput = emirHesapla;
$('#emirStopFiyat').oninput = emirHesapla;
$('#emirHedefFiyat').oninput = emirHesapla;

$('#emirKapatBtn').onclick = () => {
  $('#demoEmirModal').classList.add('gizli');
  if (!D.detaySembol) $('#perde').classList.add('gizli');
};

$('#emirOnaylaBtn').onclick = async () => {
  const v = D.detayVeri; if (!v) return;
  const f = parseFloat($('#emirAlisFiyat').value);
  const adet = parseFloat($('#emirAdet').value);
  const stop = parseFloat($('#emirStopFiyat').value) || null;
  const hedef = parseFloat($('#emirHedefFiyat').value) || null;

  if (!f || f <= 0 || !adet || adet <= 0) return bildir('Lütfen geçerli bir fiyat ve adet girin.');

  try {
    const res = await api('/api/demo/al', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sembol: v.sembol,
        ad: v.ad,
        fiyat: f,
        adet: adet,
        stopFiyat: stop,
        hedefFiyat: hedef
      })
    });
    bildir(`✅ ${adet} adet ${v.sembol.split(':')[1]} ${sayi(f)} seviyesinden alındı!`);
    $('#demoEmirModal').classList.add('gizli');
    await demoPortfoyYukle();
  } catch (e) {
    bildir('⚠️ ' + e.message);
  }
};

// ================= Ziyaretçi İstatistikleri =================
async function ziyaretciYukle() {
  try {
    const d = await api('/api/ziyaret/istatistik');
    $('#ustTekilKisi').textContent = d.tekilKisiSayisi + ' kişi';
    $('#zTekilKisi').textContent = d.tekilKisiSayisi + ' Kişi';
    $('#zBugunGiris').textContent = d.bugunGiris + ' Kez';
    $('#zToplamTiklama').textContent = d.toplamTiklama;

    const sonlar = d.sonGirisler || [];
    if (!sonlar.length) {
      $('#zSonGirisler').innerHTML = '<div class="bos">Henüz kayıtlı ziyaretçi yok.</div>';
    } else {
      $('#zSonGirisler').innerHTML = `
        <table style="width:100%;">
          <thead>
            <tr>
              <th>Cihaz</th>
              <th>IP / Konum</th>
              <th class="sag">Giriş Zamanı</th>
            </tr>
          </thead>
          <tbody>
            ${sonlar.map(z => `
              <tr>
                <td><b>${esc(z.cihaz)}</b></td>
                <td><small class="kucuk">${esc(z.ip)}</small></td>
                <td class="sag kucuk">${new Date(z.tarih).toLocaleDateString('tr-TR')} ${new Date(z.tarih).toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'})}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
    }
  } catch (_) {}
}

$('#ziyaretciSayacBtn').onclick = () => {
  $('#perde').classList.remove('gizli');
  $('#ziyaretModal').classList.remove('gizli');
  ziyaretciYukle();
};
$('#ziyaretKapatBtn').onclick = () => {
  $('#perde').classList.add('gizli');
  $('#ziyaretModal').classList.add('gizli');
};

// ================= Başlangıç =================
(async () => {
  try { await listeleriYukle(); await tara(); await demoPortfoyYukle(); await ziyaretciYukle(); }
  catch (e) { $('#durum').textContent = '⚠️ Sunucuya bağlanılamadı: ' + e.message; }
})();
