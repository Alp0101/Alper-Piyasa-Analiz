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

let isiHaritasiAktif = false;

$('#isiHaritasiGecisBtn').onclick = () => {
  isiHaritasiAktif = !isiHaritasiAktif;
  if (isiHaritasiAktif) {
    $('#tablo').classList.add('gizli');
    $('#isiHaritasiKap').classList.remove('gizli');
    $('#isiHaritasiGecisBtn').textContent = '📋 Liste Görünümüne Dön';
    $('#isiHaritasiGecisBtn').classList.remove('ikincil');
    isiHaritasiCiz();
  } else {
    $('#isiHaritasiKap').classList.add('gizli');
    $('#tablo').classList.remove('gizli');
    $('#isiHaritasiGecisBtn').textContent = '📊 Piyasa Röntgeni (Isı Haritası)';
    $('#isiHaritasiGecisBtn').classList.add('ikincil');
    tablo();
    if (isiHaritasiAktif) isiHaritasiCiz();
  }
};

function isiHaritasiCiz() {
  const satirlar = filtreliSatirlar();
  if (!satirlar || !satirlar.length) {
    $('#isiKutulari').innerHTML = '<div class="bos">Görüntülenecek veri yok.</div>';
    return;
  }

  // En yüksek hacimli varlıkları belirle (büyük kutular için)
  const siraliHacim = [...satirlar].filter(x => x.fiyat && x.hacim).sort((a,b) => (b.hacim * b.fiyat) - (a.hacim * a.fiyat));
  const enBuyukler = new Set(siraliHacim.slice(0, 6).map(x => x.id));

  $('#isiKutulari').innerHTML = satirlar.map(r => {
    if (!r.fiyat) return '';
    const d = r.degisim || 0;
    const buyukMu = enBuyukler.has(r.id);

    // Renk skalası: Değişim yüzdesine göre metalik ışımalı renkler
    let arkaPlan = '#151922';
    let sinirRenk = '#2d3545';
    let degisimRenk = '#cbd5e1';

    if (d >= 4) {
      arkaPlan = 'linear-gradient(135deg, rgba(16, 185, 129, 0.45), rgba(5, 150, 105, 0.2))';
      sinirRenk = '#10b981';
      degisimRenk = '#34d399';
    } else if (d > 0.5) {
      arkaPlan = 'linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(20, 30, 45, 0.8))';
      sinirRenk = '#059669';
      degisimRenk = '#6ee7b7';
    } else if (d <= -4) {
      arkaPlan = 'linear-gradient(135deg, rgba(239, 68, 68, 0.45), rgba(185, 28, 28, 0.2))';
      sinirRenk = '#ef4444';
      degisimRenk = '#fca5a5';
    } else if (d < -0.5) {
      arkaPlan = 'linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(30, 20, 25, 0.8))';
      sinirRenk = '#dc2626';
      degisimRenk = '#f87171';
    }

    const hacimStr = (r.tlHacim && r.tlHacim > 1e6) ? (sayi(r.tlHacim / 1e6, 1) + 'M TL') : (r.hacim ? sayi(r.hacim, 0) : '');

    return `
    <div class="isi-kutu ${buyukMu ? 'buyuk' : 'orta'}" 
         style="background:${arkaPlan}; border-color:${sinirRenk};" 
         onclick="detayAc('${esc(r.id)}')">
      <div>
        <div class="sembol-baslik">
          <span class="sembol-ad">${esc(r.kod)}</span>
          <span class="kucuk" style="color:#94a3b8;">${rozet(r.yon?.s4)}</span>
        </div>
        <div class="fiyat-yazi">${sayi(r.fiyat)}</div>
      </div>
      <div>
        <div class="degisim-yazi" style="color:${degisimRenk};">${d > 0 ? '+' : ''}${sayi(d, 2)}%</div>
        ${hacimStr ? `<div class="hacim-alt">Hacim: ${hacimStr}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}
let taramaSayaci = 0;
async function tara() {
  const benim = ++taramaSayaci;
  try {
    const r = await api('/api/tarama?liste=' + encodeURIComponent(D.aktifId));
    if (benim !== taramaSayaci) return;
    D.satirlar = r.satirlar;
    $('#durum').textContent = 'Canlı Akış: ' + new Date().toLocaleTimeString('tr-TR') + ` · ${r.satirlar.length} varlık`;
    tablo();
    if (isiHaritasiAktif) isiHaritasiCiz();

    // 1. Demo Portföy Açıksa veya Açık Pozisyon Varsa Fiyatları ve Kâr/Zararı Anlık Güncelle!
    demoPortfoyYukle();

    // 2. Detay Analiz Penceresi Açıksa Oradaki Fiyatı da Tabloyla Birebir Eşitle!
    if (D.detaySembol && D.detayVeri) {
      const aktifSatir = D.satirlar.find(x => x.id === D.detaySembol);
      if (aktifSatir && aktifSatir.fiyat) {
        const fElem = document.querySelector('.seviye-satir b'); // Şu anki fiyat alanı
        if (fElem) fElem.textContent = sayi(aktifSatir.fiyat);
      }
    }
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
    if (isiHaritasiAktif) isiHaritasiCiz();
    bildir('🎯 Fırsat Radarı Aktif: Çoklu periyot ve hacim onayı almış varlıklar listelendi.');
  }
};
$('#aramaInput').addEventListener('input', e => { D.arama = e.target.value.trim(); D.gosterilen = 150; tablo(); });
$('#hacimFiltre').addEventListener('change', tablo);
$('#dahaBtn').onclick = () => { D.gosterilen += 150; tablo(); };
$('#yenileBtn').onclick = () => { tara(); if (D.detaySembol) detayYukle(true); };
// Canlı Piyasa Akışı: 5 saniyede bir otomatik yenile (TradingView gibi akıcı)
setInterval(() => { if ($('#otoYenile').checked && !document.hidden) tara(); }, 5000);

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

// Detay yükleyici: Her zaman canlı taze fiyatla çalışır
async function detayYukle(zorla = false) {
  const id = D.detaySembol;

  $('#dIcerik').innerHTML = '<div class="yukleniyor">⚡ Canlı piyasa verileri ve analiz hesaplanıyor...</div>';
  try {
    // Önbellek kullanmadan doğrudan en güncel taze veriyi çek
    const v = await api(`/api/analiz?sembol=${encodeURIComponent(id)}&tf=${encodeURIComponent(D.detayTf)}&t=${Date.now()}`);
    if (id !== D.detaySembol) return;
    
    // Ana tablodan gelen en son canlı taze fiyatı al
    const anaSatir = D.satirlar.find(x => x.id === id);
    const tazeFiyat = anaSatir?.fiyat || v.canliFiyat;

    // Tüm zaman dilimlerindeki fiyat seviyesini bu anlık canlı fiyatla zorla eşitle
    if (tazeFiyat && tazeFiyat > 0) {
      Object.keys(v.zamanDilimleri).forEach(k => {
        const z = v.zamanDilimleri[k];
        if (z && z.seviyeler) {
          z.seviyeler.fiyat = tazeFiyat;
        }
      });
    }

    D.detayVeri = v;
    $('#dAd').textContent = `${id.split(':')[1]} · ${v.ad}`;
    $('#dAlt').textContent = `Analiz zamanı: ${new Date().toLocaleTimeString('tr-TR')}` + (v.not ? ' · ' + v.not : '');
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
    const b = z.balina || { seviye: 'Doğal Akış', renk: '#94a3b8', ikon: '🌊', mesaj: 'Normal piyasa hareketi.' };
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
        <div class="kutu" style="border-left: 3px solid ${b.renk};">
          <h4>${b.ikon} Balina & Akıllı Para Dedektörü: <span style="color:${b.renk}">${esc(b.seviye)}</span></h4>
          <div style="font-size:13px; line-height:1.5;">${esc(b.mesaj)}</div>
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

// ================= Demo Al-Sat & Portföy (Kalıcı LocalStorage Korumalı) =================
const VARSAYILAN_DEMO_KASA = 1000000;
let demoPortfoyVerisi = null;

function demoYerelOku() {
  try {
    const raw = localStorage.getItem('alper_demo_portfoy');
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {
    bakiye: VARSAYILAN_DEMO_KASA,
    baslangicBakiye: VARSAYILAN_DEMO_KASA,
    acikPozisyonlar: [],
    kapananIslemler: []
  };
}

function demoYerelKaydet(p) {
  try {
    localStorage.setItem('alper_demo_portfoy', JSON.stringify(p));
  } catch (_) {}
}

async function demoPortfoyYukle() {
  try {
    // 1. Önce cihazdaki (telefondaki/tarayıcıdaki) kalıcı veriyi oku
    let yerel = demoYerelOku();

    // 2. Sunucuya da gönder veya senkronize et
    try {
      const sunucu = await api('/api/demo/portfoy');
      // Eğer sunucuda daha güncel işlem varsa veya yerel boşsa birleştir
      if (sunucu && sunucu.acikPozisyonlar && sunucu.acikPozisyonlar.length > 0 && yerel.acikPozisyonlar.length === 0) {
        yerel = sunucu;
        demoYerelKaydet(yerel);
      }
    } catch (_) {}

    // Canlı fiyatlara göre portföyü hesapla
    const fiyatHaritasi = {};
    if (D.satirlar && D.satirlar.length) {
      D.satirlar.forEach(r => { if (r.fiyat) fiyatHaritasi[r.id] = r.fiyat; });
    }

    let toplamHisseDegeri = 0;
    const pozisyonlar = (yerel.acikPozisyonlar || []).map(poz => {
      const anlikFiyat = fiyatHaritasi[poz.sembol] || poz.alisFiyat;
      const anlikTutar = poz.adet * anlikFiyat;
      const karZararTL = anlikTutar - (poz.adet * poz.alisFiyat);
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

    const bakiye = yerel.bakiye ?? VARSAYILAN_DEMO_KASA;
    const baslangic = yerel.baslangicBakiye ?? VARSAYILAN_DEMO_KASA;
    const toplamVarlik = bakiye + toplamHisseDegeri;
    const toplamNetKarTL = toplamVarlik - baslangic;
    const toplamNetKarYuzde = baslangic > 0 ? ((toplamVarlik - baslangic) / baslangic) * 100 : 0;

    const kapanan = yerel.kapananIslemler || [];
    const basarili = kapanan.filter(x => x.karZararTL > 0).length;
    const basarisiz = kapanan.filter(x => x.karZararTL <= 0).length;
    const basariOrani = kapanan.length > 0 ? +((basarili / kapanan.length) * 100).toFixed(1) : 0;

    demoPortfoyVerisi = {
      bakiye: +bakiye.toFixed(2),
      toplamHisseDegeri: +toplamHisseDegeri.toFixed(2),
      toplamVarlik: +toplamVarlik.toFixed(2),
      toplamNetKarTL: +toplamNetKarTL.toFixed(2),
      toplamNetKarYuzde: +toplamNetKarYuzde.toFixed(2),
      istatistik: { toplamKapali: kapanan.length, basarili, basarisiz, basariOrani },
      acikPozisyonlar: pozisyonlar,
      kapananIslemler: kapanan
    };

    $('#ustKasaBakiye').textContent = sayi(toplamVarlik, 0) + ' TL';
    $('#demoNakitBakiye').textContent = sayi(bakiye, 2) + ' TL';
    $('#demoToplamVarlik').textContent = sayi(toplamVarlik, 2) + ' TL';

    const netRenk = toplamNetKarTL >= 0 ? '#10b981' : '#ef4444';
    $('#demoNetKar').innerHTML = `<span style="color:${netRenk}">${toplamNetKarTL >= 0 ? '+' : ''}${sayi(toplamNetKarTL, 2)} TL (%${sayi(toplamNetKarYuzde, 2)})</span>`;
    $('#demoBasariOrani').textContent = `%${basariOrani} (${basarili}K / ${basarisiz}Z)`;

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
    const p = demoYerelOku();
    const idx = p.acikPozisyonlar.findIndex(x => x.id === pozId);
    if (idx !== -1) {
      const poz = p.acikPozisyonlar[idx];
      const satisTutar = poz.adet * guncelFiyat;
      const alisTutar = poz.adet * poz.alisFiyat;
      const karZararTL = satisTutar - alisTutar;
      const karZararYuzde = ((guncelFiyat - poz.alisFiyat) / poz.alisFiyat) * 100;

      p.bakiye += satisTutar;
      p.acikPozisyonlar.splice(idx, 1);
      p.kapananIslemler = p.kapananIslemler || [];
      p.kapananIslemler.unshift({
        id: poz.id,
        sembol: poz.sembol,
        ad: poz.ad,
        adet: poz.adet,
        alisFiyat: poz.alisFiyat,
        satisFiyat: +guncelFiyat,
        satisTarih: new Date().toISOString(),
        karZararTL: +karZararTL.toFixed(2),
        karZararYuzde: +karZararYuzde.toFixed(2),
        sebep: 'manuel'
      });
      demoYerelKaydet(p);
      bildir(`Pozisyon kapatıldı! Sonuç: ${karZararTL >= 0 ? '+' : ''}${sayi(karZararTL, 2)} TL`);
    }

    // Sunucuya da bildir
    api('/api/demo/sat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pozId, satisFiyat: guncelFiyat })
    }).catch(() => {});

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
  const p = {
    bakiye: VARSAYILAN_DEMO_KASA,
    baslangicBakiye: VARSAYILAN_DEMO_KASA,
    acikPozisyonlar: [],
    kapananIslemler: []
  };
  demoYerelKaydet(p);
  api('/api/demo/sifirla', { method: 'POST' }).catch(() => {});
  bildir('Demo kasa sıfırlandı: 1.000.000 TL');
  await demoPortfoyYukle();
};

$('#dDemoAlBtn').onclick = () => {
  const v = D.detayVeri;
  if (!v) return;
  const z = v.zamanDilimleri[D.detayTf] || v.zamanDilimleri.s4 || v.zamanDilimleri.g1;

  // En son taze fiyatı al: Önce ana tablodan, yoksa analizden
  const anaSatir = D.satirlar.find(x => x.id === v.sembol);
  const f = anaSatir?.fiyat || z?.seviyeler?.fiyat;
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

  const tutar = f * adet;
  const p = demoYerelOku();
  if (p.bakiye < tutar) {
    return bildir(`Yetersiz bakiye! Gereken: ${sayi(tutar, 2)} TL, Nakit: ${sayi(p.bakiye, 2)} TL`);
  }

  // 1. Cihaza (telefona) ANINDA kalıcı kaydet (Asla kaybolmaz)
  p.bakiye -= tutar;
  p.acikPozisyonlar = p.acikPozisyonlar || [];
  p.acikPozisyonlar.push({
    id: 'poz-' + Date.now(),
    sembol: v.sembol,
    ad: v.ad,
    adet: adet,
    alisFiyat: f,
    alisTarih: new Date().toISOString(),
    stopFiyat: stop,
    hedefFiyat: hedef,
    tutar: +tutar.toFixed(2)
  });
  demoYerelKaydet(p);

  // 2. Arka planda sunucuya da gönder
  api('/api/demo/al', {
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
  }).catch(() => {});

  bildir(`✅ ${adet} adet ${v.sembol.split(':')[1]} ${sayi(f)} seviyesinden alındı!`);
  $('#demoEmirModal').classList.add('gizli');
  await demoPortfoyYukle();
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

// ================= Sesli Alarm & Bildirim Motoru =================
function sesCal(tur = 'ding') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (tur === 'ding') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } else { // Başarı / Kâr sesi
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12);
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.24);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.start();
      osc.stop(ctx.currentTime + 0.8);
    }
  } catch (_) {}
}

async function alarmlariKontrolEt() {
  if (!D.satirlar || !D.satirlar.length) return;
  const fiyatHaritasi = {};
  D.satirlar.forEach(r => { if (r.fiyat) fiyatHaritasi[r.id] = r.fiyat; });

  try {
    const res = await api('/api/alarm/kontrol', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fiyatHaritasi })
    });

    const aktifler = res.aktifAlarmlar || [];
    $('#ustAlarmSayisi').textContent = aktifler.length;

    if (res.calacakAlarmlar && res.calacakAlarmlar.length > 0) {
      res.calacakAlarmlar.forEach(a => {
        sesCal(a.tip === 'demo_hedef' ? 'kar' : 'ding');
        alert(a.mesaj); // Ekrana net uyarı bas
        bildir(a.mesaj, 6000);
      });
      demoPortfoyYukle();
    }
  } catch (_) {}
}

$('#dAlarmBtn').onclick = async () => {
  const v = D.detayVeri;
  if (!v) return;
  const z = v.zamanDilimleri[D.detayTf] || v.zamanDilimleri.s4;
  const anlik = z?.seviyeler?.fiyat || 0;

  const girdi = prompt(`🔔 ${v.sembol.split(':')[1]} için Fiyat Alarmı Kur\nŞu Anki Fiyat: ${sayi(anlik)}\n\nHangi fiyata geldiğinde SESLİ uyarı çalsın?`, anlik);
  if (!girdi || isNaN(+girdi) || +girdi <= 0) return;

  const hedefFiyat = +girdi;
  const yon = hedefFiyat > anlik ? 'yukari' : 'asagi';

  try {
    await api('/api/alarm/ekle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sembol: v.sembol,
        ad: v.ad,
        hedefFiyat,
        yon,
        not: `${sayi(hedefFiyat)} seviyesine ulaşıldı.`
      })
    });
    sesCal('ding');
    bildir(`🔔 Alarm kuruldu: ${v.sembol.split(':')[1]} ➔ ${sayi(hedefFiyat)}`);
    alarmlariListele();
  } catch (e) {
    bildir('Hata: ' + e.message);
  }
};

async function alarmlariListele() {
  try {
    const list = await api('/api/alarm/liste');
    const aktifler = list.filter(x => !x.tetiklendi);
    $('#ustAlarmSayisi').textContent = aktifler.length;

    if (!aktifler.length) {
      $('#aktifAlarmlarListesi').innerHTML = '<div class="bos" style="padding:15px;">Henüz aktif fiyat alarmınız yok. Bir hissenin detayından "🔔 Alarm Kur" diyebilirsiniz.</div>';
    } else {
      $('#aktifAlarmlarListesi').innerHTML = `
        <table style="width:100%;">
          <thead>
            <tr>
              <th>Sembol</th>
              <th class="sag">Hedef Fiyat</th>
              <th class="orta">Yön</th>
              <th class="orta">Sil</th>
            </tr>
          </thead>
          <tbody>
            ${aktifler.map(a => `
              <tr>
                <td><b>${esc(a.sembol.split(':')[1])}</b> <small class="kucuk">${esc(a.ad)}</small></td>
                <td class="sag" style="color:#38bdf8; font-weight:bold;">${sayi(a.hedefFiyat)}</td>
                <td class="orta">${a.yon === 'yukari' ? '▲ Yukarı Kırarsa' : '▼ Aşağı İnerse'}</td>
                <td class="orta"><button class="sil" onclick="alarmSil('${esc(a.id)}')">✖</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
    }
  } catch (_) {}
}

window.alarmSil = async id => {
  await api('/api/alarm/sil', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  bildir('Alarm silindi.');
  alarmlariListele();
};

$('#alarmListesiBtn').onclick = () => {
  $('#perde').classList.remove('gizli');
  $('#alarmModal').classList.remove('gizli');
  alarmlariListele();
};
$('#alarmKapatBtn').onclick = () => {
  $('#perde').classList.add('gizli');
  $('#alarmModal').classList.add('gizli');
};

// ================= Başlangıç =================
(async () => {
  try { 
    await listeleriYukle(); 
    await tara(); 
    await demoPortfoyYukle(); 
    await ziyaretciYukle(); 
    alarmlariListele();
    setInterval(alarmlariKontrolEt, 15000); // 15 saniyede bir fiyatları ve alarmları denetle
  } catch (e) { $('#durum').textContent = '⚠️ Sunucuya bağlanılamadı: ' + e.message; }
})();
