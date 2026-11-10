'use strict';
// ================= Durum =================
const D = {
  listeler: null, aktifId: localStorage.getItem('aktifListe') || 'favoriler',
  satirlar: [], filtre: 'hepsi', arama: '', sirala: { alan: null, artan: false },
  gosterilen: 150, detaySembol: null, detayTf: 's4', detayVeri: null,
};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ================= Yönetici Şifresi =================
// Okuma herkese açık; sunucuda veri değiştiren işlemler yönetici şifresi ister.
const YONETICI_ANAHTAR = 'alper_yonetici_sifre';
const yoneticiSifre = () => localStorage.getItem(YONETICI_ANAHTAR) || '';

function yoneticiDurumCiz() {
  const b = document.getElementById('yoneticiBtn');
  if (!b) return;
  const girisli = !!yoneticiSifre();
  b.textContent = girisli ? '🔓 Yönetici' : '🔒 Giriş';
  b.title = girisli ? 'Yönetici olarak giriş yapıldı (çıkış için tıklayın)' : 'Liste, alarm ve demo kayıtlarını değiştirmek için yönetici girişi';
  b.classList.toggle('girisli', girisli);
}

async function yoneticiGiris(mesaj) {
  const s = prompt(`🔐 ${mesaj || 'Bu işlem için yönetici şifresi gerekli.'}\n\nYönetici şifresini girin:`);
  if (!s) return false;
  try {
    const r = await fetch('/api/yonetici/dogrula', { method: 'POST', headers: { 'X-Yonetici-Sifre': encodeURIComponent(s) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { bildir('⛔ ' + (j.hata || 'Şifre doğrulanamadı.'), 4000); return false; }
    localStorage.setItem(YONETICI_ANAHTAR, s);
    yoneticiDurumCiz();
    bildir('🔓 Yönetici girişi başarılı.');
    return true;
  } catch (e) { bildir('⛔ ' + e.message); return false; }
}

async function api(yol, ayar = {}, tekrar = true) {
  const { sessiz, ...fetchAyar } = ayar;
  const basliklar = { ...(fetchAyar.headers || {}) };
  const s = yoneticiSifre();
  if (s) basliklar['X-Yonetici-Sifre'] = encodeURIComponent(s);
  const r = await fetch(yol, { ...fetchAyar, headers: basliklar });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) {
    if (s) { localStorage.removeItem(YONETICI_ANAHTAR); yoneticiDurumCiz(); }
    return { hata: 'Yetkisiz işlem' };
  }
  if (!r.ok) throw new Error(j.hata || ('Sunucu hatası ' + r.status));
  return j;
}
function bildir(m, sure = 2600) {
  const b = $('#bildirim'); b.textContent = m; b.classList.remove('gizli');
  clearTimeout(bildir.t); bildir.t = setTimeout(() => b.classList.add('gizli'), sure);
}
const sayi = (v, b) => {
  if (v == null || !isFinite(v)) return '—';
  if (b == null) {
    const av = Math.abs(v);
    b = av >= 1 ? 2 : av >= 0.01 ? 4 : 8;
  }
  return v.toLocaleString('tr-TR', { minimumFractionDigits: b, maximumFractionDigits: b });
};
const ROZET = { 2: '▲▲', 1: '▲', 0: '●', '-1': '▼', '-2': '▼▼' };
const rozet = k => k == null ? '<span class="rozet r0">—</span>' : `<span class="rozet r${k}">${ROZET[k]}</span>`;

function hacimFormat(r) {
  if (!r) return '';
  const isKripto = r.id?.startsWith('BINANCE:') || r.id?.startsWith('OKX:') || r.id?.startsWith('GATE:') || r.id?.startsWith('BYBIT:');
  const isBist = r.id?.startsWith('BIST:');
  
  let tutar = null;
  let birim = '₺';

  if (isKripto) {
    tutar = r.usdHacim || (r.hacim && r.fiyat ? r.hacim * r.fiyat : null);
    birim = '$';
  } else if (isBist) {
    tutar = r.tlHacim || (r.hacim && r.fiyat ? r.hacim * r.fiyat : null);
    birim = '₺';
  } else {
    tutar = r.tlHacim || r.usdHacim || (r.hacim && r.fiyat ? r.hacim * r.fiyat : null);
    birim = r.id?.includes('TRY') ? '₺' : '$';
  }

  if (tutar == null || !isFinite(tutar) || tutar <= 0) return '';

  if (tutar >= 1e9) {
    return (tutar / 1e9).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' Mr ' + birim;
  }
  if (tutar >= 1e6) {
    return (tutar / 1e6).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' Mn ' + birim;
  }
  if (tutar >= 1e3) {
    return (tutar / 1e3).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' B ' + birim;
  }
  return Math.round(tutar) + ' ' + birim;
}

// ================= Listeler =================
async function listeleriYukle() {
  D.listeler = await api('/api/listeler');
  if (!D.listeler.listeler.find(l => l.id === D.aktifId)) D.aktifId = D.listeler.listeler[0]?.id;
  listeMenuCiz();
}
async function listeleriKaydet() {
  try {
    D.listeler = await api('/api/listeler', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(D.listeler) });
    listeMenuCiz();
  } catch (e) {
    // Kaydedilemediyse ekrandaki listeyi sunucudaki gerçek haline geri döndür
    try { D.listeler = await api('/api/listeler'); listeMenuCiz(); tara(); } catch (_) {}
    bildir('⚠️ Liste kaydedilemedi: ' + e.message, 4000);
    throw e;
  }
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
    if ((l.cikarilanlar || []).includes(id)) {
      l.cikarilanlar = l.cikarilanlar.filter(x => x !== id);
      await listeleriKaydet();
      bildir('Tekrar listeye alındı.');
      tara();
    } else if (l.dinamik === 'kripto' || l.id === 'kripto') {
      l.semboller = l.semboller || [];
      if (l.semboller.includes(id)) return bildir('Bu sembol zaten kripto listesinde.');
      l.semboller.push(id);
      await listeleriKaydet();
      bildir(`${id.split(':')[1]} → Kripto listesine eklendi.`);
      tara();
    } else {
      bildir('Bu liste zaten tüm BIST hisselerini kapsıyor. Başka bir listeye ekleyin.');
    }
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

    // 1. Yeni Radar ve Sniper Girişlerini Denetle (Bildirim fırlat)
    radarVeSniperDegisimKontrol(D.satirlar);

    // 2. Demo Portföy Açıksa veya Açık Pozisyon Varsa Fiyatları ve Kâr/Zararı Anlık Güncelle!
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
      <td class="sag">
        <div style="font-weight:600; color:${r.goreceliHacim >= 2.0 ? '#38bdf8' : r.goreceliHacim >= 1.3 ? '#10b981' : 'inherit'};">${r.goreceliHacim == null ? '—' : sayi(r.goreceliHacim, 1) + 'x'}</div>
        ${hacimFormat(r) ? `<div class="kucuk" style="color:#94a3b8; font-size:11px; white-space:nowrap;">${hacimFormat(r)}</div>` : ''}
      </td>
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
setInterval(() => {
  if ($('#otoYenile').checked && !document.hidden) {
    tara();
    demoPortfoyYukle();
  }
}, 5000);

// ================= Ayrıntılı analiz =================
function detayAc(id) {
  D.detaySembol = id;
  $('#perde').classList.remove('gizli'); $('#detay').classList.remove('gizli');
  const r = D.satirlar.find(x => x.id === id);
  $('#dAd').textContent = (r ? r.kod + ' · ' + (r.ad || '') : id);
  $('#dAlt').textContent = 'Analiz ediliyor...';
  $('#dTv').href = 'https://tr.tradingview.com/chart/?symbol=' + encodeURIComponent(id.startsWith('YAHOO:') ? id.split(':')[1] : id);
  if (!demoPortfoyVerisi) demoPortfoyYukle();
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

// ================= 3. Özellik: Sniper Matrisi (3 Boyutlu Zaman Hizalaması) =================
function sniperMatrisiHesapla(zamanDilimleri) {
  if (!zamanDilimleri) return null;
  const p15m = zamanDilimleri.m15?.yonKod ?? 0;
  const p1h  = zamanDilimleri.s1?.yonKod ?? 0;
  const p4h  = zamanDilimleri.s4?.yonKod ?? 0;
  const p1d  = zamanDilimleri.g1?.yonKod ?? 0;

  const tumuPozitif = p15m > 0 && p1h > 0 && p4h > 0 && p1d > 0;
  const tumuNegatif = p15m < 0 && p1h < 0 && p4h < 0 && p1d < 0;

  let durumMetni = 'Kısmi / Kararsız Uyum';
  let renk = '#94a3b8';
  let sinyalKodu = 'normal';

  if (tumuPozitif) {
    durumMetni = '🎯 MÜKEMMEL ALIM HİZALANMASI (SNIPER LONG)';
    renk = '#10b981';
    sinyalKodu = 'sniper_long';
  } else if (tumuNegatif) {
    durumMetni = '🛑 MÜKEMMEL DÜŞÜŞ HİZALANMASI (SNIPER SHORT)';
    renk = '#ef4444';
    sinyalKodu = 'sniper_short';
  } else if (p1h > 0 && p4h > 0 && p1d > 0) {
    durumMetni = '⚡ Güçlü Trend Uyumu (Ana Periyotlar Yükselişte)';
    renk = '#38bdf8';
    sinyalKodu = 'guclu_trend';
  }

  const kutuHtml = (baslik, kod) => {
    const kRenk = kod > 0 ? '#10b981' : kod < 0 ? '#ef4444' : '#64748b';
    const kIkon = kod > 0 ? '▲' : kod < 0 ? '▼' : '●';
    return `
      <div style="background:#090d16; border:1px solid #232b3d; border-radius:8px; padding:8px 10px; text-align:center;">
        <div style="font-size:11px; color:#94a3b8;">${baslik}</div>
        <div style="font-size:15px; font-weight:800; color:${kRenk}; margin-top:2px;">${kIkon} ${kod > 0 ? 'AL' : kod < 0 ? 'SAT' : 'NÖTR'}</div>
      </div>`;
  };

  return `
  <div class="kutu" style="border: 2px solid ${renk}; box-shadow: 0 0 15px ${renk}33; background: linear-gradient(180deg, #131824 0%, #0a0e17 100%);">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
      <h4 style="margin:0; font-size:15px;">🎯 Sniper Matrisi (3 Boyutlu Zaman Hizalaması)</h4>
      <span style="background:${renk}22; color:${renk}; border:1px solid ${renk}66; border-radius:6px; padding:4px 10px; font-size:11.5px; font-weight:800;">
        ${durumMetni}
      </span>
    </div>
    <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; margin-bottom:10px;">
      ${kutuHtml('15 DAKİKA', p15m)}
      ${kutuHtml('1 SAAT', p1h)}
      ${kutuHtml('4 SAAT', p4h)}
      ${kutuHtml('GÜNLÜK (24S)', p1d)}
    </div>
    <div class="uyari" style="margin:0; line-height:1.5;">
      ${tumuPozitif 
        ? '🔥 <b>Efsane Fırsat:</b> En küçük zaman diliminden en büyüğüne kadar tüm periyotlar aynı anda AL pozisyonunda! Dalgalara karşı değil, tüm piyasanın rüzgarıyla aynı yöndesiniz.' 
        : tumuNegatif 
        ? '⚠️ <b>Yüksek Risk:</b> Tüm periyotlar aynı anda SAT yönünde. Asla tepki alımı için acele etmeyin.' 
        : 'Küçük ve büyük periyotlar arasında kısmi uyum var. Sniper Long için 4 periyodun da aynı anda yeşil yanmasını bekleyin.'}
    </div>
  </div>`;
}

// ================= Canlı Açık Pozisyon Risk Değerlendirmesi =================
function pozisyonRiskKarti(poz, z, v) {
  if (!poz || !z || !z.seviyeler) return '';
  const s = z.seviyeler;
  const t = z.tuzak || {};
  const b = z.balina || {};
  const birim = poz.paraBirimi || '₺';
  const isShort = poz.yon === 'SHORT';
  const anlikFiyat = s.fiyat || poz.alisFiyat;
  const teminat = poz.teminat || +(poz.adet * poz.alisFiyat).toFixed(2);
  const fiyatFarki = isShort ? (poz.alisFiyat - anlikFiyat) : (anlikFiyat - poz.alisFiyat);
  const karZarar = +(fiyatFarki * poz.adet).toFixed(2);
  const karZararYuzde = teminat > 0 ? +((karZarar / teminat) * 100).toFixed(2) : 0;
  const karRenk = karZarar >= 0 ? '#10b981' : '#ef4444';
  const kStr = poz.kaldirac > 1 ? ` ${poz.kaldirac}x` : '';

  // 1. Stop Mesafesi Analizi
  let stopHtml = '';
  if (poz.stopFiyat && poz.stopFiyat > 0) {
    if (isShort) {
      const stopFark = poz.stopFiyat - anlikFiyat;
      const stopYuzde = +((stopFark / anlikFiyat) * 100).toFixed(1);
      if (anlikFiyat >= poz.stopFiyat) {
        stopHtml = `<span style="color:#ef4444; font-weight:bold;">🛑 FİYAT SHORT STOPUNU AŞTI (${sayi(poz.stopFiyat)} ${birim})! Zarar-kes seviyesi ihlal edildi.</span>`;
      } else if (stopYuzde <= 1.2) {
        stopHtml = `<span style="color:#ef4444; font-weight:bold;">⚠️ TEHLİKE: Stop seviyesine sadece %${stopYuzde} kaldı (${sayi(poz.stopFiyat)} ${birim})!</span>`;
      } else {
        stopHtml = `<span style="color:#10b981;">Stopa %${stopYuzde} güvenli mesafe var (${sayi(poz.stopFiyat)} ${birim}).</span>`;
      }
    } else {
      const stopFark = anlikFiyat - poz.stopFiyat;
      const stopYuzde = +((stopFark / anlikFiyat) * 100).toFixed(1);
      if (anlikFiyat <= poz.stopFiyat) {
        stopHtml = `<span style="color:#ef4444; font-weight:bold;">🛑 FİYAT STOP SEVİYESİNİN ALTINDA (${sayi(poz.stopFiyat)} ${birim})! Zarar-kes seviyesi ihlal edildi.</span>`;
      } else if (stopYuzde <= 1.2) {
        stopHtml = `<span style="color:#ef4444; font-weight:bold;">⚠️ TEHLİKE: Stop seviyesine sadece %${stopYuzde} kaldı (${sayi(poz.stopFiyat)} ${birim})!</span>`;
      } else {
        stopHtml = `<span style="color:#10b981;">Stopa %${stopYuzde} güvenli mesafe var (${sayi(poz.stopFiyat)} ${birim}).</span>`;
      }
    }
  } else {
    stopHtml = `<span style="color:#f59e0b;">⚠️ Stop-Loss tanımlanmamış! Ani dalgalanmada risk yüksek.</span>`;
  }

  // 2. Hedef Mesafesi Analizi
  let hedefHtml = '';
  if (poz.hedefFiyat && poz.hedefFiyat > 0) {
    if (isShort) {
      const hedefFark = anlikFiyat - poz.hedefFiyat;
      const hedefYuzde = +((hedefFark / anlikFiyat) * 100).toFixed(1);
      if (anlikFiyat <= poz.hedefFiyat) {
        hedefHtml = `<span style="color:#10b981; font-weight:bold;">🎯 DÜŞÜŞ HEDEFİNE ULAŞILDI (${sayi(poz.hedefFiyat)} ${birim})! Kârı alabilirsiniz.</span>`;
      } else {
        hedefHtml = `<span style="color:#38bdf8;">Hedefe %${hedefYuzde} kaldı (${sayi(poz.hedefFiyat)} ${birim}).</span>`;
      }
    } else {
      const hedefFark = poz.hedefFiyat - anlikFiyat;
      const hedefYuzde = +((hedefFark / anlikFiyat) * 100).toFixed(1);
      if (anlikFiyat >= poz.hedefFiyat) {
        hedefHtml = `<span style="color:#10b981; font-weight:bold;">🎯 KÂR HEDEFİNE ULAŞILDI (${sayi(poz.hedefFiyat)} ${birim})! Kârı alabilirsiniz.</span>`;
      } else {
        hedefHtml = `<span style="color:#38bdf8;">Hedefe %${hedefYuzde} kaldı (${sayi(poz.hedefFiyat)} ${birim}).</span>`;
      }
    }
  } else {
    hedefHtml = `<span style="color:#94a3b8;">Hedef tanımlanmamış.</span>`;
  }

  // 3. Yapay Zeka & Trend Yönü ile Pozisyon Uyumu Değerlendirmesi
  let riskSeviye = 'DÜŞÜK';
  let riskRenk = '#10b981';
  let riskYorum = '';

  if (!isShort) {
    if (z.yonKod >= 1) {
      if (t.seviye === 'Yüksek' && t.tip === 'boga') {
        riskSeviye = 'YÜKSEK (TUZAK)';
        riskRenk = '#ef4444';
        riskYorum = '⚠️ <b>Boğa Tuzağı Uyarısı:</b> Yükseliş görünümüne rağmen sahte kırılım / gel-gel riski yüksek. Fiyat sert düşebilir, kârınızı korumak için stopunuzu yukarı çekin veya kâr almayı değerlendirin.';
      } else if (b.durum === 'dagitim') {
        riskSeviye = 'ORTA-YÜKSEK';
        riskRenk = '#f59e0b';
        riskYorum = '⚠️ <b>Balina Dağıtımı:</b> Büyük yatırımcılar satış yapıyor. Yükseliş gücünü kaybedebilir, temkinli olun.';
      } else {
        riskSeviye = 'DÜŞÜK (TREND LEHİNİZE)';
        riskRenk = '#10b981';
        riskYorum = '🟢 <b>Mükemmel Uyum:</b> Analiz ve göstergeler yükseliş trendinde sizi destekliyor. Pozisyon güvende.';
      }
    } else if (z.yonKod <= -1) {
      riskSeviye = 'YÜKSEK (TREND ALEYHİNİZE)';
      riskRenk = '#ef4444';
      riskYorum = '🔴 <b>DİKKAT:</b> Göstergeler SAT / DÜŞÜŞ moduna geçmiş durumda! Long pozisyonunuz ters rüzgarda kalmış. Zarar büyümeden pozisyonu kapatmayı veya stopu daraltmayı düşünün.';
    } else {
      riskSeviye = 'ORTA (KARARSIZ)';
      riskRenk = '#94a3b8';
      riskYorum = '⚪ Piyasa kararsız / yatay bantta. Seviye kırılımlarını ve stopunuzu takip edin.';
    }
  } else {
    if (z.yonKod <= -1) {
      if (t.seviye === 'Yüksek' && t.tip === 'ayi') {
        riskSeviye = 'YÜKSEK (TUZAK)';
        riskRenk = '#ef4444';
        riskYorum = '⚠️ <b>Ayı Tuzağı Uyarısı:</b> Düşüş görünümüne rağmen sert yukarı tepki gelebilir! Short pozisyonunuz ani yükselişle stop olabilir.';
      } else if (b.durum === 'toplama' || b.durum === 'patlama') {
        riskSeviye = 'ORTA-YÜKSEK';
        riskRenk = '#f59e0b';
        riskYorum = '⚠️ <b>Akıllı Para Alımı:</b> Kurumsal alıcılar dipten topluyor. Short pozisyona karşı yukarı baskı riski var.';
      } else {
        riskSeviye = 'DÜŞÜK (DÜŞÜŞ LEHİNİZE)';
        riskRenk = '#10b981';
        riskYorum = '🟢 <b>Mükemmel Uyum:</b> Düşüş baskısı ve göstergeler short pozisyonunuzu teyit ediyor. Kârlılığı koruyabilirsiniz.';
      }
    } else if (z.yonKod >= 1) {
      riskSeviye = 'YÜKSEK (YÜKSELİŞ BAŞLADI)';
      riskRenk = '#ef4444';
      riskYorum = '🔴 <b>DİKKAT:</b> Göstergeler AL / YÜKSELİŞ moduna döndü! Short pozisyonunuz aleyhine alım baskısı var. Pozisyonu kapatmayı değerlendirin.';
    } else {
      riskSeviye = 'ORTA (KARARSIZ)';
      riskRenk = '#94a3b8';
      riskYorum = '⚪ Piyasa yatay yönsüz seyrediyor. Destek/direnç kırılımlarını izleyin.';
    }
  }

  const yonRozet = isShort 
    ? `<span style="background:#ef4444; color:#fff; padding:2px 8px; border-radius:4px; font-size:12px; font-weight:bold;">🔴 SHORT${kStr}</span>` 
    : `<span style="background:#10b981; color:#fff; padding:2px 8px; border-radius:4px; font-size:12px; font-weight:bold;">🟢 LONG${kStr}</span>`;

  return `
  <div class="kutu" style="background: linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.92)); border: 2px solid ${riskRenk}; box-shadow: 0 4px 25px ${riskRenk}44; margin-bottom: 20px; border-radius: 12px; padding: 16px 20px;">
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px; margin-bottom: 12px;">
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:24px;">🛡️</span>
        <div>
          <div style="font-size:16px; font-weight:bold; color:#f1f5f9;">Canlı Pozisyon Risk Değerlendirmesi</div>
          <div style="font-size:12px; color:#94a3b8;">Açık sanal işleminizin anlık sağlık durumu ve yapay zeka analiz uyumu</div>
        </div>
      </div>
      <div>
        ${yonRozet}
        <span style="background:${riskRenk}22; color:${riskRenk}; border: 1px solid ${riskRenk}66; padding:3px 10px; border-radius:20px; font-size:11.5px; font-weight:bold; margin-left:6px;">
          Risk: ${riskSeviye}
        </span>
      </div>
    </div>

    <!-- Pozisyon Metrikleri -->
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap:10px; margin-bottom: 12px;">
      <div style="background:rgba(0,0,0,0.3); padding:8px 12px; border-radius:8px;">
        <div class="kucuk">Giriş Maliyeti</div>
        <div style="font-size:15px; font-weight:bold; color:#f8fafc; margin-top:2px;">${sayi(poz.alisFiyat)} ${birim}</div>
      </div>
      <div style="background:rgba(0,0,0,0.3); padding:8px 12px; border-radius:8px;">
        <div class="kucuk">Anlık Fiyat</div>
        <div style="font-size:15px; font-weight:bold; color:#38bdf8; margin-top:2px;">${sayi(anlikFiyat)} ${birim}</div>
      </div>
      <div style="background:rgba(0,0,0,0.3); padding:8px 12px; border-radius:8px;">
        <div class="kucuk">Miktar</div>
        <div style="font-size:15px; font-weight:bold; color:#e2e8f0; margin-top:2px;">${poz.adet} Adet</div>
      </div>
      <div style="background:rgba(0,0,0,0.3); padding:8px 12px; border-radius:8px; border:1px solid ${karRenk}55;">
        <div class="kucuk">Net Kâr / Zarar</div>
        <div style="font-size:15px; font-weight:bold; color:${karRenk}; margin-top:2px;">${karZarar >= 0 ? '+' : ''}${sayi(karZarar, 2)} ${birim} (%${sayi(karZararYuzde, 2)})</div>
      </div>
    </div>

    <!-- Seviye Mesafeleri -->
    <div style="background:rgba(0,0,0,0.25); border-radius:8px; padding:10px 14px; margin-bottom:12px; font-size:13px; line-height:1.6;">
      <div>🎯 <b>Hedef Durumu:</b> ${hedefHtml}</div>
      <div style="margin-top:4px;">🛑 <b>Stop Durumu:</b> ${stopHtml}</div>
    </div>

    <!-- AI & Trend Uyarı Mesajı -->
    <div style="background:${riskRenk}15; border-left: 4px solid ${riskRenk}; padding:10px 14px; border-radius:6px; font-size:13px; color:#f1f5f9; line-height:1.5; margin-bottom: 14px;">
      ${riskYorum}
    </div>

    <!-- Hızlı Aksiyon Butonları -->
    <div style="display:flex; flex-wrap:wrap; gap:8px;">
      <button class="btn" style="background:#0284c7; font-size:12px; padding:6px 12px; font-weight:bold;" onclick="demoStopuMaliyeteCek('${esc(poz.id)}')">
        🛡️ Stop'u Giriş Fiyatına Çek (Breakeven - Sıfır Risk)
      </button>
      <button class="btn ikincil" style="font-size:12px; padding:6px 12px;" onclick="demoSeviyeDuzenle('${esc(poz.id)}', 'stop', ${poz.stopFiyat || 0})">
        ✏️ Stop Düzenle
      </button>
      <button class="btn ikincil" style="font-size:12px; padding:6px 12px;" onclick="demoSeviyeDuzenle('${esc(poz.id)}', 'hedef', ${poz.hedefFiyat || 0})">
        ✏️ Hedef Düzenle
      </button>
      <button class="btn tehlike" style="font-size:12px; padding:6px 12px; margin-left:auto; font-weight:bold;" onclick="demoPozisyonKapatVeYenile('${esc(poz.id)}', ${anlikFiyat})">
        💰 Pozisyonu Kapat (Kâr/Zararı Al)
      </button>
    </div>
  </div>`;
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
  const sniperHtml = sniperMatrisiHesapla(v.zamanDilimleri);
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
          <h4>🎯 Long & Short Örnek Planları</h4>
          <div style="font-weight:bold; color:#10b981; font-size:12px; margin-top:4px;">🟢 Long (Alış) Planı:</div>
          <div class="seviye-satir"><span>Zarar-kes (stop)</span><b class="eks">${sayi(s.alimStop)}</b></div>
          <div class="seviye-satir"><span>1. Hedef</span><b class="art">${sayi(s.alimHedef)}</b></div>
          <div class="seviye-satir"><span>Risk / Kazanç</span><b>1 : ${sayi(s.riskOdul, 2)}</b></div>

          <div style="font-weight:bold; color:#ef4444; font-size:12px; margin-top:10px;">🔴 Short (Açığa Satış) Planı:</div>
          <div class="seviye-satir"><span>Zarar-kes (stop)</span><b class="eks">${sayi(s.satisStop || '—')}</b></div>
          <div class="seviye-satir"><span>1. Hedef</span><b class="art">${sayi(s.satisHedef || '—')}</b></div>
          <div class="seviye-satir"><span>Risk / Kazanç</span><b>1 : ${sayi(s.satisRiskOdul || '—', 2)}</b></div>
          <div class="uyari">Seviyeler oynaklık (ATR), destek ve dirençlere göre otomatik türetilir.</div>
        </div>
        ${fibHtml}
        ${btHtml}
      </div>
    </div>
    <div class="uyari">Son mum: ${new Date(z.sonMum).toLocaleString('tr-TR')} · ${z.mumSayisi} mum incelendi. Bu analiz bir karar destek aracıdır, yatırım tavsiyesi değildir. Son karar her zaman sizindir.</div>`;
  }
  const poz = (demoPortfoyVerisi?.acikPozisyonlar || []).find(x => x.sembol === v.sembol);
  const riskKartiHtml = poz ? pozisyonRiskKarti(poz, z, v) : '';
  $('#dIcerik').innerHTML = `${riskKartiHtml}<div class="tf-ozet">${ozet}</div>${sniperHtml || ''}${alt}`;
}
$('#dIcerik').addEventListener('click', e => {
  const k = e.target.closest('.tf-kart[data-tf]'); if (!k) return;
  D.detayTf = k.dataset.tf;
  detayYukle();
});

// ================= Yapay Zeka Başarı Karnesi & Koçluk Motoru =================
function karneHesapla(p) {
  const kapali = p.kapananIslemler || [];
  if (!kapali.length) {
    $('#karneSeviyeRozet').textContent = 'Seviye: Başlangıç (İşlem Bekleniyor)';
    $('#karneIcerik').innerHTML = `
      <div style="background:#131520; padding:12px; border-radius:8px; border:1px dashed #383152;">
        💡 <b>Alper Bey</b>, yapay zekanın işlem alışkanlıklarınızı analiz edip size özel stratejik tavsiyeler üretebilmesi için 
        en az 1 adet demo işleminizi kapatmanız gerekmektedir. İşlemlerinizi kapattıkça kazanma oranınız, en karlı olduğunuz piyasa türü (BIST, Altın, Kripto) ve risk disiplininiz burada karneye dökülecek.
      </div>`;
    return;
  }

  const toplam = kapali.length;
  const karli = kapali.filter(x => x.karZararTL > 0);
  const zararli = kapali.filter(x => x.karZararTL <= 0);
  const winrate = +((karli.length / toplam) * 100).toFixed(1);

  const toplamKarTL = karli.reduce((a, b) => a + b.karZararTL, 0);
  const toplamZararTL = Math.abs(zararli.reduce((a, b) => a + b.karZararTL, 0));
  const karFaktoru = toplamZararTL > 0 ? +(toplamKarTL / toplamZararTL).toFixed(2) : (toplamKarTL > 0 ? 99 : 0);

  // Varlık türlerine göre performans
  const turPerf = { bist: { kar: 0, sayi: 0 }, kripto: { kar: 0, sayi: 0 }, emtia: { kar: 0, sayi: 0 } };
  kapali.forEach(k => {
    const s = k.sembol || '';
    let tur = 'bist';
    if (s.includes('BTC') || s.includes('ETH') || s.includes('GATE') || s.includes('BINANCE')) tur = 'kripto';
    else if (s.includes('XAU') || s.includes('SILVER') || s.includes('OIL') || s.includes('ALTIN')) tur = 'emtia';
    turPerf[tur].sayi++;
    turPerf[tur].kar += k.karZararTL;
  });

  // Seviye unvanı
  let unvan = 'Strateji Geliştirici';
  let unvanRenk = '#94a3b8';
  if (winrate >= 70 && karFaktoru >= 1.8) {
    unvan = '🏆 Usta Fon Yöneticisi (Pro Trader)';
    unvanRenk = '#34d399';
  } else if (winrate >= 50 && karFaktoru >= 1.2) {
    unvan = '⚖️ Dengeli & Disiplinli Yatırımcı';
    unvanRenk = '#38bdf8';
  } else if (zararli.length > karli.length) {
    unvan = '⚠️ Risk Yönetimi Geliştirilmeli';
    unvanRenk = '#f87171';
  }

  $('#karneSeviyeRozet').innerHTML = `<span style="color:${unvanRenk};">${unvan}</span>`;

  // Koçluk tavsiyeleri
  const tavsiyeler = [];
  if (winrate >= 60) {
    tavsiyeler.push(`🎯 <b>Yüksek İsabet:</b> %${winrate} kazanma oranıyla piyasa ortalamasının oldukça üzerindesiniz. Stratejinizi bozmadan aynı disiplinle devam edin.`);
  } else {
    tavsiyeler.push(`🛡️ <b>Zarar Kes Disiplini:</b> Kazanma oranınız %${winrate}. Zarar eden pozisyonlarda inatlaşmayıp stop seviyelerine sadık kalmak kasanızı koruyacaktır.`);
  }

  if (turPerf.emtia.sayi > 0 && turPerf.emtia.kar > 0) {
    tavsiyeler.push(`⭐ <b>En Güçlü Alanınız (Altın/Emtia):</b> Emtia işlemlerinizde toplam +${sayi(turPerf.emtia.kar, 0)} TL net kâr ile en verimli sonuçları bu alanda alıyorsunuz.`);
  }
  if (turPerf.kripto.sayi > 0 && turPerf.kripto.kar < 0) {
    tavsiyeler.push(`⚡ <b>Kripto Uyarısı:</b> Kripto para işlemlerinde oynaklık yüksek olduğu için pozisyon büyüklüğünüzü biraz daha küçük tutmanız önerilir.`);
  }

  $('#karneIcerik').innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:10px; margin-bottom:12px;">
      <div style="background:#111422; border:1px solid #2d264a; border-radius:8px; padding:8px 10px;">
        <span class="kucuk">Toplam İşlem</span>
        <div style="font-size:16px; font-weight:bold; color:#fff;">${toplam} Adet</div>
      </div>
      <div style="background:#111422; border:1px solid #2d264a; border-radius:8px; padding:8px 10px;">
        <span class="kucuk">Kazanma Oranı</span>
        <div style="font-size:16px; font-weight:bold; color:${winrate>=50 ? '#34d399' : '#f87171'};">%${winrate}</div>
      </div>
      <div style="background:#111422; border:1px solid #2d264a; border-radius:8px; padding:8px 10px;">
        <span class="kucuk">Kâr Faktörü</span>
        <div style="font-size:16px; font-weight:bold; color:#a78bfa;">${karFaktoru}</div>
      </div>
      <div style="background:#111422; border:1px solid #2d264a; border-radius:8px; padding:8px 10px;">
        <span class="kucuk">Ort. Kazanç / Kayıp</span>
        <div style="font-size:14px; font-weight:bold; color:#cbd5e1;">+${sayi(karli.length ? toplamKarTL/karli.length : 0, 0)} / -${sayi(zararli.length ? toplamZararTL/zararli.length : 0, 0)} TL</div>
      </div>
    </div>
    <div style="background:#131520; padding:12px; border-radius:8px; border:1px solid #383152;">
      <b style="color:#c4b5fd; font-size:13.5px;">🤖 Yapay Zeka Koçluk Analizi:</b>
      <ul style="margin:6px 0 0; padding-left:18px; line-height:1.6;">
        ${tavsiyeler.map(t => `<li style="margin-bottom:4px;">${t}</li>`).join('')}
      </ul>
    </div>`;
}
const VARSAYILAN_TL_KASA = 1000000;
const VARSAYILAN_USD_KASA = 100000;
let demoPortfoyVerisi = null;

function paraBirimiAl(sembolId) {
  if (!sembolId) return '₺';
  if (sembolId.startsWith('BINANCE:') || sembolId.startsWith('OKX:') || sembolId.startsWith('GATE:') || sembolId.startsWith('BYBIT:')) return '$';
  if (sembolId.includes('XAUUSD') || sembolId.includes('SILVER') || sembolId.includes('OIL') || sembolId.includes('DXY') || sembolId.includes('EURUSD')) return '$';
  return '₺';
}

function demoYerelOku() {
  try {
    const raw = localStorage.getItem('alper_demo_portfoy');
    if (raw) {
      const p = JSON.parse(raw);
      if (p.bakiyeTL == null) {
        p.bakiyeTL = p.bakiye ?? VARSAYILAN_TL_KASA;
        p.baslangicTL = p.baslangicBakiye ?? VARSAYILAN_TL_KASA;
        p.bakiyeUSD = VARSAYILAN_USD_KASA;
        p.baslangicUSD = VARSAYILAN_USD_KASA;
      }
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
      return p;
    }
  } catch (_) {}
  return {
    bakiyeTL: VARSAYILAN_TL_KASA,
    baslangicTL: VARSAYILAN_TL_KASA,
    bakiyeUSD: VARSAYILAN_USD_KASA,
    baslangicUSD: VARSAYILAN_USD_KASA,
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
    let yerel = demoYerelOku();
    const yerelSemboller = (yerel.acikPozisyonlar || []).map(x => x.sembol).filter(Boolean);

    const fiyatHaritasi = {};
    if (D.satirlar && D.satirlar.length) {
      D.satirlar.forEach(r => { if (r.fiyat) fiyatHaritasi[r.id] = r.fiyat; });
    }

    try {
      const q = yerelSemboller.length > 0 ? `?semboller=${encodeURIComponent(yerelSemboller.join(','))}` : '';
      const sunucu = await api(`/api/demo/portfoy${q}`);
      if (sunucu) {
        if (sunucu.fiyatHaritasi) {
          Object.assign(fiyatHaritasi, sunucu.fiyatHaritasi);
        }
        (sunucu.acikPozisyonlar || []).forEach(p => {
          if (p.sembol && p.anlikFiyat) fiyatHaritasi[p.sembol] = p.anlikFiyat;
        });
        if (sunucu.acikPozisyonlar && sunucu.acikPozisyonlar.length > 0 && (!yerel.acikPozisyonlar || yerel.acikPozisyonlar.length === 0)) {
          yerel = sunucu;
          demoYerelKaydet(yerel);
        }
      }
    } catch (_) {}

    let hisseDegeriTL = 0;
    let hisseDegeriUSD = 0;

    const pozisyonlar = (yerel.acikPozisyonlar || []).map(poz => {
      const birim = poz.paraBirimi || paraBirimiAl(poz.sembol);
      const isShort = poz.yon === 'SHORT';
      const anlikFiyat = fiyatHaritasi[poz.sembol] || poz.alisFiyat;
      const teminat = poz.teminat || +(poz.adet * poz.alisFiyat).toFixed(2);
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

    const bakiyeTL = +(yerel.bakiyeTL ?? yerel.bakiye ?? VARSAYILAN_TL_KASA).toFixed(2);
    const bakiyeUSD = +(yerel.bakiyeUSD ?? VARSAYILAN_USD_KASA).toFixed(2);
    const baslangicTL = +(yerel.baslangicTL ?? yerel.baslangicBakiye ?? VARSAYILAN_TL_KASA).toFixed(2);
    const baslangicUSD = +(yerel.baslangicUSD ?? VARSAYILAN_USD_KASA).toFixed(2);

    const toplamVarlikTL = +(bakiyeTL + hisseDegeriTL).toFixed(2);
    const toplamVarlikUSD = +(bakiyeUSD + hisseDegeriUSD).toFixed(2);

    const netKarTL = +(toplamVarlikTL - baslangicTL).toFixed(2);
    const netKarYuzdeTL = baslangicTL > 0 ? +((netKarTL / baslangicTL) * 100).toFixed(2) : 0;

    const netKarUSD = +(toplamVarlikUSD - baslangicUSD).toFixed(2);
    const netKarYuzdeUSD = baslangicUSD > 0 ? +((netKarUSD / baslangicUSD) * 100).toFixed(2) : 0;

    const kapanan = yerel.kapananIslemler || [];
    const basarili = kapanan.filter(x => (x.karZarar ?? x.karZararTL) > 0).length;
    const basarisiz = kapanan.filter(x => (x.karZarar ?? x.karZararTL) <= 0).length;
    const basariOrani = kapanan.length > 0 ? +((basarili / kapanan.length) * 100).toFixed(1) : 0;

    demoPortfoyVerisi = {
      bakiyeTL,
      bakiyeUSD,
      hisseDegeriTL,
      hisseDegeriUSD,
      toplamVarlikTL,
      toplamVarlikUSD,
      netKarTL,
      netKarYuzdeTL,
      netKarUSD,
      netKarYuzdeUSD,
      istatistik: { toplamKapali: kapanan.length, basarili, basarisiz, basariOrani },
      acikPozisyonlar: pozisyonlar,
      kapananIslemler: kapanan
    };

    $('#ustKasaBakiye').textContent = `${sayi(toplamVarlikTL, 0)} ₺ | ${sayi(toplamVarlikUSD, 0)} $`;
    if ($('#demoNakitTL')) $('#demoNakitTL').textContent = sayi(bakiyeTL, 0) + ' ₺';
    if ($('#demoVarlikTL')) $('#demoVarlikTL').textContent = 'Varlık: ' + sayi(toplamVarlikTL, 0) + ' ₺';
    if ($('#demoNakitUSD')) $('#demoNakitUSD').textContent = sayi(bakiyeUSD, 0) + ' $';
    if ($('#demoVarlikUSD')) $('#demoVarlikUSD').textContent = 'Varlık: ' + sayi(toplamVarlikUSD, 0) + ' $';

    const netRenkTL = netKarTL >= 0 ? '#10b981' : '#ef4444';
    const netRenkUSD = netKarUSD >= 0 ? '#10b981' : '#ef4444';
    $('#demoNetKar').innerHTML = `
      <div style="font-size:13.5px;"><span style="color:${netRenkTL}">${netKarTL >= 0 ? '+' : ''}${sayi(netKarTL, 0)} ₺ (%${sayi(netKarYuzdeTL, 1)})</span></div>
      <div style="font-size:13.5px;"><span style="color:${netRenkUSD}">${netKarUSD >= 0 ? '+' : ''}${sayi(netKarUSD, 0)} $ (%${sayi(netKarYuzdeUSD, 1)})</span></div>
    `;
    $('#demoBasariOrani').textContent = `%${basariOrani} (${basarili}K / ${basarisiz}Z)`;

    demoPortfoyCiz();
    karneHesapla(demoPortfoyVerisi);
  } catch (_) {}
}

function demoPortfoyCiz() {
  const p = demoPortfoyVerisi; if (!p) return;
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
            <th class="sag" style="color:#ef4444;">🛑 Stop</th>
            <th class="sag" style="color:#10b981;">🎯 Hedef</th>
            <th class="sag">Kâr / Zarar</th>
            <th class="orta">İşlem</th>
          </tr>
        </thead>
        <tbody>
          ${aciklar.map(poz => {
            const birim = poz.paraBirimi || '₺';
            const karRenk = poz.karZarar >= 0 ? 'art' : 'eks';
            const isShort = poz.yon === 'SHORT';
            const kStr = poz.kaldirac > 1 ? ` ${poz.kaldirac}x` : '';
            const yonRozet = isShort 
              ? `<span style="background:#ef444422; color:#ef4444; border:1px solid #ef444466; padding:2px 6px; border-radius:4px; font-size:10.5px; font-weight:bold; margin-left:4px;">🔴 SHORT${kStr}</span>` 
              : `<span style="background:#10b98122; color:#10b981; border:1px solid #10b98166; padding:2px 6px; border-radius:4px; font-size:10.5px; font-weight:bold; margin-left:4px;">🟢 LONG${kStr}</span>`;
            return `
            <tr>
              <td style="cursor:pointer;" title="Canlı analizi ve risk durumunu görmek için tıklayın" onclick="demoPozisyonAnalizAc('${esc(poz.sembol)}')">
                <b>${esc(poz.sembol.split(':')[1])}</b>${yonRozet} <small class="kucuk">${esc(poz.ad)}</small>
                <span style="font-size:11px; color:#38bdf8; margin-left:3px;" title="Canlı Analize Git">🔍</span>
              </td>
              <td class="sag">${poz.adet}</td>
              <td class="sag">${sayi(poz.alisFiyat)} ${birim}</td>
              <td class="sag">${sayi(poz.anlikFiyat)} ${birim}</td>
              <td class="sag">
                <span style="color:#f87171; font-weight:bold; cursor:pointer;" title="Değiştirmek için tıkla" onclick="demoSeviyeDuzenle('${esc(poz.id)}', 'stop', ${poz.stopFiyat || 0})">
                  ${poz.stopFiyat ? sayi(poz.stopFiyat) + ' ' + birim : '—'} ✏️
                </span>
              </td>
              <td class="sag">
                <span style="color:#34d399; font-weight:bold; cursor:pointer;" title="Değiştirmek için tıkla" onclick="demoSeviyeDuzenle('${esc(poz.id)}', 'hedef', ${poz.hedefFiyat || 0})">
                  ${poz.hedefFiyat ? sayi(poz.hedefFiyat) + ' ' + birim : '—'} ✏️
                </span>
              </td>
              <td class="sag ${karRenk}"><b>${poz.karZarar >= 0 ? '+' : ''}${sayi(poz.karZarar, 2)} ${birim}</b> (%${sayi(poz.karZararYuzde, 2)})</td>
              <td class="orta" style="white-space:nowrap;">
                <button class="btn ikincil" style="padding:3px 7px; font-size:11px; margin-right:4px;" title="Pozisyonun risk durumunu ve analizini gör" onclick="demoPozisyonAnalizAc('${esc(poz.sembol)}')">🔍 Analiz</button>
                <button class="btn tehlike" style="padding:3px 7px; font-size:11px;" onclick="demoPozisyonKapat('${esc(poz.id)}', ${poz.anlikFiyat})">Kapat</button>
              </td>
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
            <th>Sembol & Yön</th>
            <th class="sag">Adet</th>
            <th class="sag">Giriş ➔ Çıkış</th>
            <th class="sag">Net Sonuç</th>
            <th class="sag">Tarih</th>
          </tr>
        </thead>
        <tbody>
          ${kapali.map(k => {
            const birim = k.paraBirimi || '₺';
            const netSonuc = k.karZarar ?? k.karZararTL ?? 0;
            const karRenk = netSonuc >= 0 ? 'art' : 'eks';
            const isShort = k.yon === 'SHORT';
            const kStr = k.kaldirac > 1 ? ` ${k.kaldirac}x` : '';
            const yonRozet = isShort 
              ? `<span style="background:#ef444422; color:#ef4444; border:1px solid #ef444466; padding:1px 5px; border-radius:4px; font-size:10px; font-weight:bold; margin-left:3px;">🔴 SHORT${kStr}</span>` 
              : `<span style="background:#10b98122; color:#10b981; border:1px solid #10b98166; padding:1px 5px; border-radius:4px; font-size:10px; font-weight:bold; margin-left:3px;">🟢 LONG${kStr}</span>`;
            return `
            <tr>
              <td><b>${esc(k.sembol.split(':')[1])}</b>${yonRozet}</td>
              <td class="sag">${k.adet}</td>
              <td class="sag">${sayi(k.alisFiyat)} ${birim} ➔ ${sayi(k.satisFiyat)} ${birim}</td>
              <td class="sag ${karRenk}"><b>${netSonuc >= 0 ? '+' : ''}${sayi(netSonuc, 2)} ${birim}</b> (%${sayi(k.karZararYuzde, 2)})</td>
              <td class="sag kucuk">${new Date(k.satisTarih).toLocaleDateString('tr-TR')} ${new Date(k.satisTarih).toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'})}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }
}

window.demoSeviyeDuzenle = (pozId, tur, mevcutDeger) => {
  const turAd = tur === 'stop' ? '🛑 Zarar-Kes (Stop-Loss)' : '🎯 Kâr Al (Hedef)';
  const girdi = prompt(`${turAd} Seviyesini Güncelle\n(İptal etmek için boş bırakıp onaylayabilirsiniz)`, mevcutDeger > 0 ? mevcutDeger : '');
  if (girdi === null) return;

  const p = demoYerelOku();
  const idx = p.acikPozisyonlar.findIndex(x => x.id === pozId);
  if (idx === -1) return;

  const yeniDeger = (girdi.trim() === '' || isNaN(+girdi) || +girdi <= 0) ? null : +girdi;

  if (tur === 'stop') p.acikPozisyonlar[idx].stopFiyat = yeniDeger;
  else p.acikPozisyonlar[idx].hedefFiyat = yeniDeger;

  demoYerelKaydet(p);
  bildir(`✅ ${turAd} güncellendi: ${yeniDeger ? sayi(yeniDeger) : 'Kaldırıldı'}`);
  demoPortfoyYukle();
};

window.demoPozisyonKapat = async (pozId, guncelFiyat) => {
  if (!confirm('Bu pozisyonu güncel fiyattan kapatmak istediğinize emin misiniz?')) return;
  try {
    const p = demoYerelOku();
    const idx = p.acikPozisyonlar.findIndex(x => x.id === pozId);
    if (idx !== -1) {
      const poz = p.acikPozisyonlar[idx];
      const birim = poz.paraBirimi || paraBirimiAl(poz.sembol);
      const isShort = poz.yon === 'SHORT';
      const teminat = poz.teminat || +(poz.adet * poz.alisFiyat).toFixed(2);

      // LONG: Fiyat artınca kâr | SHORT: Fiyat düşünce kâr
      const fiyatFarki = isShort ? (poz.alisFiyat - guncelFiyat) : (guncelFiyat - poz.alisFiyat);
      const karZarar = +(fiyatFarki * poz.adet).toFixed(2);
      const karZararYuzde = teminat > 0 ? +((karZarar / teminat) * 100).toFixed(2) : 0;
      const iadeTutar = Math.max(0, +(teminat + karZarar).toFixed(2));

      if (birim === '$') {
        p.bakiyeUSD = +( (p.bakiyeUSD || VARSAYILAN_USD_KASA) + iadeTutar ).toFixed(2);
      } else {
        p.bakiyeTL = +( (p.bakiyeTL || VARSAYILAN_TL_KASA) + iadeTutar ).toFixed(2);
      }

      p.acikPozisyonlar.splice(idx, 1);
      p.kapananIslemler = p.kapananIslemler || [];
      p.kapananIslemler.unshift({
        id: poz.id,
        sembol: poz.sembol,
        ad: poz.ad,
        yon: poz.yon || 'LONG',
        kaldirac: poz.kaldirac || 1,
        adet: poz.adet,
        alisFiyat: poz.alisFiyat,
        satisFiyat: +guncelFiyat,
        paraBirimi: birim,
        satisTarih: new Date().toISOString(),
        teminat,
        karZarar,
        karZararYuzde,
        sebep: 'manuel'
      });
      demoYerelKaydet(p);
      bildir(`✅ Pozisyon kapatıldı! Sonuç: ${karZarar >= 0 ? '+' : ''}${sayi(karZarar, 2)} ${birim}`);
    }

    api('/api/demo/sat', {
      method: 'POST',
      sessiz: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pozId, satisFiyat: guncelFiyat })
    }).catch(() => {});

    await demoPortfoyYukle();
  } catch (e) {
    bildir('Hata: ' + e.message);
  }
};

window.demoPozisyonAnalizAc = (sembol) => {
  $('#demoModal').classList.add('gizli');
  detayAc(sembol);
};

window.demoStopuMaliyeteCek = (pozId) => {
  const p = demoYerelOku();
  const idx = p.acikPozisyonlar.findIndex(x => x.id === pozId);
  if (idx === -1) return;
  const poz = p.acikPozisyonlar[idx];
  poz.stopFiyat = poz.alisFiyat;
  demoYerelKaydet(p);
  bildir(`🛡️ Harika! Stop seviyesi maliyetinize (${sayi(poz.alisFiyat)}) çekildi. Bu işlemde artık zarar riski kalmadı.`);
  demoPortfoyYukle();
  detayYukle();
};

window.demoPozisyonKapatVeYenile = async (pozId, guncelFiyat) => {
  await demoPozisyonKapat(pozId, guncelFiyat);
  detayYukle();
};

let demoCanliSayac = null;

$('#demoPortfoyBtn').onclick = () => {
  $('#perde').classList.remove('gizli');
  $('#demoModal').classList.remove('gizli');
  demoPortfoyYukle();
  if (demoCanliSayac) clearInterval(demoCanliSayac);
  demoCanliSayac = setInterval(() => {
    if (!$('#demoModal').classList.contains('gizli')) {
      demoPortfoyYukle();
    } else {
      clearInterval(demoCanliSayac);
      demoCanliSayac = null;
    }
  }, 4000);
};
$('#demoKapatBtn').onclick = () => {
  if (demoCanliSayac) { clearInterval(demoCanliSayac); demoCanliSayac = null; }
  $('#perde').classList.add('gizli');
  $('#demoModal').classList.add('gizli');
};
$('#demoSifirlaBtn').onclick = async () => {
  if (!confirm('Tüm sanal kasalarınız sıfırlanacak (1.000.000 TL ve 100.000 USD nakit bakiye). Tüm işlemler silinecek. Onaylıyor musunuz?')) return;
  const p = {
    bakiyeTL: VARSAYILAN_TL_KASA,
    baslangicTL: VARSAYILAN_TL_KASA,
    bakiyeUSD: VARSAYILAN_USD_KASA,
    baslangicUSD: VARSAYILAN_USD_KASA,
    acikPozisyonlar: [],
    kapananIslemler: []
  };
  demoYerelKaydet(p);
  api('/api/demo/sifirla', { method: 'POST', sessiz: true }).catch(() => {});
  bildir('Demo kasalar sıfırlandı: 1.000.000 TL | 100.000 $');
  await demoPortfoyYukle();
};

let aktifEmirYonu = 'LONG';

function emirYonAyarla(yon) {
  aktifEmirYonu = (yon === 'SHORT') ? 'SHORT' : 'LONG';
  const v = D.detayVeri;
  const birim = v ? paraBirimiAl(v.sembol) : '₺';
  const z = v ? (v.zamanDilimleri[D.detayTf] || v.zamanDilimleri.s4 || v.zamanDilimleri.g1) : null;

  if (aktifEmirYonu === 'LONG') {
    $('#emirYonLongBtn').style.background = '#10b981';
    $('#emirYonLongBtn').style.color = '#ffffff';
    $('#emirYonLongBtn').classList.remove('ikincil');
    $('#emirYonShortBtn').style.background = 'transparent';
    $('#emirYonShortBtn').style.color = '#94a3b8';
    $('#emirYonShortBtn').classList.add('ikincil');

    $('#emirBaslik').textContent = `🟢 Demo Long (Alış) Emri (${birim})`;
    $('#emirFiyatEtiket').textContent = `Alış Fiyatı (${birim})`;
    $('#emirStopEtiket').innerHTML = `🛑 Zarar-Kes (Stop) <small style="color:#94a3b8;">[Fiyatın Altı]</small>`;
    $('#emirHedefEtiket').innerHTML = `🎯 Kâr Al (Hedef) <small style="color:#94a3b8;">[Fiyatın Üstü]</small>`;
    $('#emirOnaylaBtn').style.background = '#10b981';
    $('#emirOnaylaBtn').textContent = `🟢 LONG Pozisyon Aç (Yükseliş)`;

    if (z?.seviyeler?.alimStop) $('#emirStopFiyat').value = z.seviyeler.alimStop;
    if (z?.seviyeler?.alimHedef) $('#emirHedefFiyat').value = z.seviyeler.alimHedef;
  } else {
    $('#emirYonShortBtn').style.background = '#ef4444';
    $('#emirYonShortBtn').style.color = '#ffffff';
    $('#emirYonShortBtn').classList.remove('ikincil');
    $('#emirYonLongBtn').style.background = 'transparent';
    $('#emirYonLongBtn').style.color = '#94a3b8';
    $('#emirYonLongBtn').classList.add('ikincil');

    $('#emirBaslik').textContent = `🔴 Demo Short (Satış / Düşüş) Emri (${birim})`;
    $('#emirFiyatEtiket').textContent = `Satış (Giriş) Fiyatı (${birim})`;
    $('#emirStopEtiket').innerHTML = `🛑 Zarar-Kes (Stop) <small style="color:#94a3b8;">[Fiyatın Üstü]</small>`;
    $('#emirHedefEtiket').innerHTML = `🎯 Kâr Al (Hedef) <small style="color:#94a3b8;">[Fiyatın Altı]</small>`;
    $('#emirOnaylaBtn').style.background = '#ef4444';
    $('#emirOnaylaBtn').textContent = `🔴 SHORT (Açığa Satış) Aç (Düşüş)`;

    if (z?.seviyeler?.satisStop) $('#emirStopFiyat').value = z.seviyeler.satisStop;
    if (z?.seviyeler?.satisHedef) $('#emirHedefFiyat').value = z.seviyeler.satisHedef;
  }
  emirHesapla();
}

function emirModaliAc(yon = 'LONG') {
  const v = D.detayVeri;
  if (!v) return;
  const z = v.zamanDilimleri[D.detayTf] || v.zamanDilimleri.s4 || v.zamanDilimleri.g1;

  const anaSatir = D.satirlar.find(x => x.id === v.sembol);
  const f = anaSatir?.fiyat || z?.seviyeler?.fiyat;
  if (!f) return bildir('Fiyat verisi alınamadı.');

  const birim = paraBirimiAl(v.sembol);
  const nakit = birim === '$' ? (demoPortfoyVerisi?.bakiyeUSD ?? VARSAYILAN_USD_KASA) : (demoPortfoyVerisi?.bakiyeTL ?? VARSAYILAN_TL_KASA);
  
  let varsayilanAdet = (nakit * 0.05) / f;
  if (birim === '$') {
    if (f >= 1000) varsayilanAdet = Math.max(0.01, +varsayilanAdet.toFixed(3));
    else if (f >= 10) varsayilanAdet = Math.max(0.1, +varsayilanAdet.toFixed(2));
    else if (f >= 0.01) varsayilanAdet = Math.max(1, Math.round(varsayilanAdet));
    else varsayilanAdet = Math.max(100, Math.round(varsayilanAdet));
  } else {
    varsayilanAdet = Math.max(1, Math.round(varsayilanAdet));
  }

  $('#emirSembolAd').textContent = `${v.sembol.split(':')[1]} · ${v.ad} (Para Birimi: ${birim})`;
  $('#emirAlisFiyat').value = f;
  $('#emirAdet').value = varsayilanAdet;
  if ($('#emirKaldirac')) $('#emirKaldirac').value = '1';

  emirYonAyarla(yon);

  $('#perde').classList.remove('gizli');
  $('#demoEmirModal').classList.remove('gizli');
}

$('#dDemoAlBtn').onclick = () => emirModaliAc('LONG');
$('#dDemoSatBtn').onclick = () => emirModaliAc('SHORT');

$('#emirYonLongBtn').onclick = () => emirYonAyarla('LONG');
$('#emirYonShortBtn').onclick = () => emirYonAyarla('SHORT');
if ($('#emirKaldirac')) $('#emirKaldirac').onchange = emirHesapla;

function emirHesapla() {
  const v = D.detayVeri;
  const birim = v ? paraBirimiAl(v.sembol) : '₺';
  const f = parseFloat($('#emirAlisFiyat').value) || 0;
  const adet = parseFloat($('#emirAdet').value) || 0;
  const stop = parseFloat($('#emirStopFiyat').value) || 0;
  const hedef = parseFloat($('#emirHedefFiyat').value) || 0;
  const kOran = parseInt($('#emirKaldirac')?.value) || 1;

  const tutar = +(f * adet).toFixed(2);
  const teminat = +(tutar / kOran).toFixed(2);
  $('#emirToplamTutar').textContent = `${sayi(tutar, 2)} ${birim}`;
  if ($('#emirTeminatTutar')) {
    $('#emirTeminatTutar').textContent = `${sayi(teminat, 2)} ${birim} (${kOran}x)`;
  }

  const isShort = aktifEmirYonu === 'SHORT';
  let risk = 0, kazanc = 0, rr = 0, gecerli = false;

  if (isShort) {
    if (f > 0 && stop > 0 && hedef > 0 && stop > f && f > hedef) {
      risk = +( (stop - f) * adet ).toFixed(2);
      kazanc = +( (f - hedef) * adet ).toFixed(2);
      rr = (f - hedef) / (stop - f);
      gecerli = true;
    }
  } else {
    if (f > 0 && stop > 0 && hedef > 0 && f > stop && hedef > f) {
      risk = +( (f - stop) * adet ).toFixed(2);
      kazanc = +( (hedef - f) * adet ).toFixed(2);
      rr = (hedef - f) / (f - stop);
      gecerli = true;
    }
  }

  if (gecerli) {
    $('#emirRiskOdul').textContent = `1 : ${sayi(rr, 2)}`;
    $('#emirOlasiKarZarar').innerHTML = `<span class="art">+${sayi(kazanc, 2)} ${birim}</span> / <span class="eks">-${sayi(risk, 2)} ${birim}</span>`;
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
  const kaldirac = parseInt($('#emirKaldirac')?.value) || 1;
  const yon = aktifEmirYonu;

  if (!f || f <= 0 || !adet || adet <= 0) return bildir('Lütfen geçerli bir fiyat ve adet girin.');

  const birim = paraBirimiAl(v.sembol);
  const tutar = +(f * adet).toFixed(2);
  const teminat = +(tutar / kaldirac).toFixed(2);
  const p = demoYerelOku();

  if (birim === '$') {
    const mevcut = p.bakiyeUSD ?? VARSAYILAN_USD_KASA;
    if (mevcut < teminat) {
      return bildir(`Yetersiz USD bakiye! Gereken Teminat: ${sayi(teminat, 2)} $, Nakit: ${sayi(mevcut, 2)} $`);
    }
    p.bakiyeUSD = +(mevcut - teminat).toFixed(2);
  } else {
    const mevcut = p.bakiyeTL ?? VARSAYILAN_TL_KASA;
    if (mevcut < teminat) {
      return bildir(`Yetersiz TL bakiye! Gereken Teminat: ${sayi(teminat, 2)} TL, Nakit: ${sayi(mevcut, 2)} TL`);
    }
    p.bakiyeTL = +(mevcut - teminat).toFixed(2);
  }

  p.acikPozisyonlar = p.acikPozisyonlar || [];
  p.acikPozisyonlar.push({
    id: 'poz-' + Date.now(),
    sembol: v.sembol,
    ad: v.ad,
    yon,
    kaldirac,
    adet: adet,
    alisFiyat: f,
    paraBirimi: birim,
    alisTarih: new Date().toISOString(),
    stopFiyat: stop,
    hedefFiyat: hedef,
    teminat,
    tutar
  });
  demoYerelKaydet(p);

  api('/api/demo/al', {
    method: 'POST',
    sessiz: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sembol: v.sembol,
      ad: v.ad,
      fiyat: f,
      adet: adet,
      stopFiyat: stop,
      hedefFiyat: hedef,
      yon,
      kaldirac
    })
  }).catch(() => {});

  const yonIsim = yon === 'SHORT' ? '🔴 SHORT (Açığa Satış)' : '🟢 LONG';
  bildir(`✅ ${adet} adet ${v.sembol.split(':')[1]} ${yonIsim} pozisyonu ${sayi(f)} ${birim} seviyesinden açıldı!`);
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

// ================= Bildirim Merkezi (Radar & Sniper Takipçisi) =================
let oncekiSniperKumesi = new Set();
let oncekiRadarKumesi = new Set();
let bildirimIlkYukleme = true;

function bildirimleriOku() {
  try {
    const raw = localStorage.getItem('alper_bildirimler');
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

function bildirimleriKaydet(arr) {
  try {
    localStorage.setItem('alper_bildirimler', JSON.stringify(arr.slice(0, 50)));
  } catch (_) {}
}

function yeniBildirimEkle(baslik, mesaj, tur, sembolId) {
  const liste = bildirimleriOku();
  const yeni = {
    id: 'bld-' + Date.now() + Math.random().toString(36).substring(2, 5),
    baslik,
    mesaj,
    tur, // 'sniper' | 'balina' | 'firsat'
    sembolId,
    tarih: new Date().toISOString(),
    okundu: false
  };
  liste.unshift(yeni);
  bildirimleriKaydet(liste);

  // Ekrana canlı bildirim fırlat ve ses çal
  sesCal('kar');
  bildir(`🔔 ${baslik}: ${mesaj}`, 7000);
  $('#bildirimRozetNokta').classList.remove('gizli');
  bildirimSayisiGuncelle();
}

function bildirimSayisiGuncelle() {
  const liste = bildirimleriOku();
  const okunmamis = liste.filter(x => !x.okundu).length;
  $('#ustBildirimSayisi').textContent = okunmamis;
  if (okunmamis > 0) {
    $('#bildirimRozetNokta').classList.remove('gizli');
  } else {
    $('#bildirimRozetNokta').classList.add('gizli');
  }
}

function radarVeSniperDegisimKontrol(satirlar) {
  if (!satirlar || !satirlar.length) return;

  const suankiSniper = new Set();
  const suankiRadar = new Set();

  satirlar.forEach(r => {
    if (!r.fiyat) return;
    const y = r.yon || {};
    const t2 = y.s2 || 0;
    const t4 = y.s4 || 0;
    const tg = y.g1 || 0;
    const rsi4h = r.rsi?.s4 || 50;

    // Sniper Kriteri: 2s, 4s, 1g yeşil ve RSI dengeli
    if (t2 > 0 && t4 > 0 && tg > 0 && rsi4h >= 45 && rsi4h <= 68) {
      suankiSniper.add(r.id);
      if (!bildirimIlkYukleme && !oncekiSniperKumesi.has(r.id)) {
        yeniBildirimEkle(
          `🎯 YENİ SNIPER FIRSATI`,
          `${r.kod} (${r.ad || ''}) tüm periyotlarda AL yakarak Sniper Avcısına girdi! Fiyat: ${sayi(r.fiyat)}`,
          'sniper',
          r.id
        );
      }
    }

    // Fırsat Radarı Kriteri
    if (r.isaretler?.some(i => i.tip === 'firsat')) {
      suankiRadar.add(r.id);
      if (!bildirimIlkYukleme && !oncekiRadarKumesi.has(r.id)) {
        yeniBildirimEkle(
          `🟢 RADARA YENİ GİRİŞ`,
          `${r.kod} hacim ve periyot onayı alarak Fırsat Radarına girdi! Fiyat: ${sayi(r.fiyat)}`,
          'firsat',
          r.id
        );
      }
    }
  });

  oncekiSniperKumesi = suankiSniper;
  oncekiRadarKumesi = suankiRadar;
  bildirimIlkYukleme = false;
}

function bildirimMerkeziCiz() {
  const liste = bildirimleriOku();
  if (!liste.length) {
    $('#bildirimKutusuListesi').innerHTML = '<div class="bos" style="padding:25px;">Henüz yeni bir fırsat bildirimi gelmedi. Radara yeni bir hisse girdiğinde buraya düşecek.</div>';
    return;
  }

  $('#bildirimKutusuListesi').innerHTML = `
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${liste.map(b => {
        const renk = b.tur === 'sniper' ? '#38bdf8' : '#10b981';
        return `
        <div class="kutu" style="margin:0; border-left:3px solid ${renk}; cursor:pointer;" 
             onclick="detayAc('${esc(b.sembolId)}'); $('#bildirimModal').classList.add('gizli');">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <b style="color:${renk}; font-size:13px;">${esc(b.baslik)}</b>
            <span class="kucuk">${new Date(b.tarih).toLocaleDateString('tr-TR')} ${new Date(b.tarih).toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'})}</span>
          </div>
          <div style="font-size:13px; color:#f1f5f9; margin-top:4px;">${esc(b.mesaj)}</div>
        </div>`;
      }).join('')}
    </div>`;
}

$('#bildirimMerkeziBtn').onclick = () => {
  const liste = bildirimleriOku();
  liste.forEach(x => x.okundu = true);
  bildirimleriKaydet(liste);
  bildirimSayisiGuncelle();

  $('#perde').classList.remove('gizli');
  $('#bildirimModal').classList.remove('gizli');
  bildirimMerkeziCiz();
};
$('#bildirimKapatBtn').onclick = () => {
  $('#perde').classList.add('gizli');
  $('#bildirimModal').classList.add('gizli');
};
$('#bildirimTemizleBtn').onclick = () => {
  if (!confirm('Tüm bildirim geçmişi temizlensin mi?')) return;
  bildirimleriKaydet([]);
  bildirimSayisiGuncelle();
  bildirimMerkeziCiz();
};

// ================= Sniper Avcısı (Hızlı Alım Menüsü) =================
function sniperAvcisiYukle() {
  const l = aktifListe();
  const listeAdi = l ? l.ad : 'Seçili Piyasa';
  $('#sniperModal .d-alt').textContent = `[${listeAdi}] listesinde 15dk, 1s, 4s ve Günlük periyotları tam AL veren varlıklar`;

  const satirlar = D.satirlar || [];
  if (!satirlar.length) {
    $('#sniperRadarListesi').innerHTML = `<div class="bos">${listeAdi} listesinde taranmış veri yok.</div>`;
    return;
  }

  // Tarama verisinde 2s, 4s, 1g ve rsi verileri tam uyumlu olanları yakala
  const tamUyumlu = [];
  const trendUyumlu = [];

  satirlar.forEach(r => {
    if (!r.fiyat) return;
    const y = r.yon || {};
    const tKisa = (y.s2 != null ? y.s2 : y.s1) || 0;
    const t4 = y.s4 || 0;
    const tg = y.g1 || 0;
    const rsi4h = r.rsi?.s4 || 50;

    // 4 periyotta (Kısa Vade, 4S, 1G ve RSI dengeli) tam alım
    if (tKisa > 0 && t4 > 0 && tg > 0 && rsi4h >= 45 && rsi4h <= 70) {
      tamUyumlu.push({
        ...r,
        derece: 'tam',
        etiket: '🎯 KUSURSUZ SNIPER AL',
        renk: '#10b981',
        aciklama: 'Kısa, orta ve uzun periyotların tümü aynı anda yükselişte. Sağlıklı momentum.'
      });
    } else if (t4 > 0 && tg > 0 && rsi4h >= 40 && rsi4h <= 74) {
      trendUyumlu.push({
        ...r,
        derece: 'trend',
        etiket: '⚡ Güçlü Trend Uyumu',
        renk: '#38bdf8',
        aciklama: 'Ana trendler yükselişte, düzeltme sonrası hızlı alım için elverişli.'
      });
    }
  });

  $('#sniperLongSayi').textContent = tamUyumlu.length + ' Varlık';
  $('#sniperTrendSayi').textContent = trendUyumlu.length + ' Varlık';

  const birlesik = [...tamUyumlu, ...trendUyumlu];

  if (!birlesik.length) {
    $('#sniperRadarListesi').innerHTML = '<div class="bos" style="padding:20px;">Şu an tüm periyotlarda aynı anda uzlaşan kusursuz varlık yok. Piyasada genel bir kararsızlık hakim.</div>';
    return;
  }

  $('#sniperRadarListesi').innerHTML = `
    <table style="width:100%;">
      <thead>
        <tr>
          <th>Sembol</th>
          <th class="sag">Fiyat</th>
          <th class="sag">Günlük %</th>
          <th class="orta">2 Saat</th>
          <th class="orta">4 Saat</th>
          <th class="orta">Günlük</th>
          <th class="sag">RSI (4S)</th>
          <th>Sinyal Derecesi</th>
          <th class="orta">Hızlı İşlem</th>
        </tr>
      </thead>
      <tbody>
        ${birlesik.map(x => `
          <tr onclick="detayAc('${esc(x.id)}'); $('#sniperModal').classList.add('gizli');">
            <td><b>${esc(x.kod)}</b> <small class="kucuk">${esc(x.ad)}</small></td>
            <td class="sag">${sayi(x.fiyat)}</td>
            <td class="sag ${x.degisim > 0 ? 'art' : 'eks'}">${x.degisim > 0 ? '+' : ''}${sayi(x.degisim, 2)}%</td>
            <td class="orta">${rozet(x.yon?.s2)}</td>
            <td class="orta">${rozet(x.yon?.s4)}</td>
            <td class="orta">${rozet(x.yon?.g1)}</td>
            <td class="sag">${sayi(x.rsi?.s4, 0)}</td>
            <td><span style="color:${x.renk}; font-weight:bold;">${esc(x.etiket)}</span></td>
            <td class="orta">
              <button class="btn" style="padding:3px 10px; font-size:11px; background:#10b981;" 
                      onclick="event.stopPropagation(); $('#sniperModal').classList.add('gizli'); detayAc('${esc(x.id)}'); setTimeout(()=>$('#dDemoAlBtn').click(), 400);">
                🛒 Al
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

$('#sniperRadarBtn').onclick = () => {
  $('#perde').classList.remove('gizli');
  $('#sniperModal').classList.remove('gizli');
  sniperAvcisiYukle();
};
$('#sniperKapatBtn').onclick = () => {
  $('#perde').classList.add('gizli');
  $('#sniperModal').classList.add('gizli');
};

// ================= Balina Radarı Menüsü =================
async function balinaRadariYukle() {
  const l = aktifListe();
  const listeAdi = l ? l.ad : 'Seçili Piyasa';
  $('#balinaModal .d-alt').textContent = `[${listeAdi}] kapsamındaki akıllı para ve balina hareketleri taranıyor...`;
  $('#balinaRadarListesi').innerHTML = `<div class="yukleniyor">⏳ ${listeAdi} için balina ve akıllı para hareketleri taranıyor...</div>`;
  
  try {
    const res = await api(`/api/balina/tara?liste=${encodeURIComponent(D.aktifId)}`);
    const liste = res.liste || [];

    const toplama = liste.filter(x => x.tur === 'toplama');
    const dagitim = liste.filter(x => x.tur === 'dagitim');
    const patlama = liste.filter(x => x.tur === 'patlama');

    $('#balinaToplamaSayi').textContent = toplama.length + ' Varlık';
    $('#balinaDagitimSayi').textContent = dagitim.length + ' Varlık';
    $('#balinaPatlamaSayi').textContent = patlama.length + ' Varlık';

    if (!liste.length) {
      $('#balinaRadarListesi').innerHTML = '<div class="bos" style="padding:20px;">Şu an olağandışı bir balina hareketi saptanmadı. Piyasa doğal akışında.</div>';
      return;
    }

    $('#balinaRadarListesi').innerHTML = `
      <table style="width:100%;">
        <thead>
          <tr>
            <th>Sembol</th>
            <th class="sag">Fiyat</th>
            <th class="sag">Günlük %</th>
            <th class="sag">Hacim Katı / Tutar</th>
            <th>Durum / Sinyal</th>
            <th>Açıklama</th>
          </tr>
        </thead>
        <tbody>
          ${liste.map(x => `
            <tr onclick="detayAc('${esc(x.id)}'); $('#balinaModal').classList.add('gizli');">
              <td><b>${esc(x.kod)}</b> <small class="kucuk">${esc(x.ad)}</small></td>
              <td class="sag">${sayi(x.fiyat)}</td>
              <td class="sag ${x.degisim > 0 ? 'art' : 'eks'}">${x.degisim > 0 ? '+' : ''}${sayi(x.degisim, 2)}%</td>
              <td class="sag">
                <div style="color:#fbbf24; font-weight:bold;">${sayi(x.gh, 1)}x</div>
                ${hacimFormat(x) ? `<div class="kucuk" style="color:#94a3b8; font-size:11px;">${hacimFormat(x)}</div>` : ''}
              </td>
              <td><span style="color:${x.renk}; font-weight:bold;">${x.ikon} ${esc(x.seviye)}</span></td>
              <td class="kucuk" style="color:#cbd5e1;">${esc(x.aciklama)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  } catch (e) {
    $('#balinaRadarListesi').innerHTML = `<div class="yukleniyor">⚠️ ${esc(e.message)}</div>`;
  }
}

$('#balinaRadarBtn').onclick = () => {
  $('#perde').classList.remove('gizli');
  $('#balinaModal').classList.remove('gizli');
  balinaRadariYukle();
};
$('#balinaKapatBtn').onclick = () => {
  $('#perde').classList.add('gizli');
  $('#balinaModal').classList.add('gizli');
};
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
      sessiz: true,
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
$('#yoneticiBtn').onclick = async () => {
  if (yoneticiSifre()) {
    if (confirm('Yönetici oturumu kapatılsın mı?\n(Bu cihazda kayıtlı şifre silinir.)')) {
      localStorage.removeItem(YONETICI_ANAHTAR);
      yoneticiDurumCiz();
      bildir('🔒 Yönetici oturumu kapatıldı.');
    }
  } else {
    await yoneticiGiris('Yönetici girişi');
  }
};
yoneticiDurumCiz();

(async () => {
  try { 
    await listeleriYukle(); 
    await tara(); 
    await demoPortfoyYukle(); 
    await ziyaretciYukle(); 
    alarmlariListele();
    bildirimSayisiGuncelle();
    setInterval(alarmlariKontrolEt, 15000); // 15 saniyede bir fiyatları ve alarmları denetle
  } catch (e) { $('#durum').textContent = '⚠️ Sunucuya bağlanılamadı: ' + e.message; }
})();
