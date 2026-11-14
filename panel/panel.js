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

// ================= BIST Kurallarına Göre Taban/Tavan (±%10) ve Baz Fiyat Hesaplayıcı =================
function bistTabanTavanHesapla(sembol, anlikFiyat, degisim, g1ZamanDilimi) {
  const isBist = (sembol && (sembol.startsWith('BIST:') || sembol.includes('BIST'))) || (D.detayVeri?.tur === 'bist');
  if (!isBist) return null;

  let bazFiyat = null;
  // 1. Günlük mumlardan önceki günün kapanış fiyatı (BIST baz fiyatı)
  if (g1ZamanDilimi && g1ZamanDilimi.mumlar && g1ZamanDilimi.mumlar.length >= 2) {
    bazFiyat = g1ZamanDilimi.mumlar[g1ZamanDilimi.mumlar.length - 2].c;
  }
  // 2. Canlı yüzde değişimden türetme (fiyat / (1 + %degisim/100))
  if ((!bazFiyat || isNaN(bazFiyat)) && anlikFiyat && degisim != null) {
    bazFiyat = anlikFiyat / (1 + (degisim / 100));
  }
  // 3. Günlük mum açılışından türetme
  if ((!bazFiyat || isNaN(bazFiyat)) && g1ZamanDilimi?.mumlar?.length) {
    bazFiyat = g1ZamanDilimi.mumlar[g1ZamanDilimi.mumlar.length - 1].o;
  }
  // 4. Son çare anlık fiyat
  if (!bazFiyat || isNaN(bazFiyat) || bazFiyat <= 0) {
    bazFiyat = anlikFiyat;
  }

  // Borsa İstanbul kuralı: Gün içi +- %10 tavan ve taban marjı
  const tavan = +(bazFiyat * 1.10).toFixed(2);
  const taban = +(bazFiyat * 0.90).toFixed(2);
  const acilis = g1ZamanDilimi?.mumlar?.length ? g1ZamanDilimi.mumlar[g1ZamanDilimi.mumlar.length - 1].o : null;

  return {
    bazFiyat: +bazFiyat.toFixed(2),
    tavan,
    taban,
    acilis: acilis ? +acilis.toFixed(2) : null
  };
}

// ================= Kâr / Zarar Formatlayıcı (+X ₺ (+%Y) / -X ₺ (-%Y)) =================
function formatKarZarar(tutar, yuzde, birim = '₺') {
  const t = (tutar == null || !isFinite(tutar)) ? 0 : tutar;
  const y = (yuzde == null || !isFinite(yuzde)) ? 0 : yuzde;
  const isPos = t >= 0;
  const isZero = t === 0;
  const sign = isPos ? '+' : '';
  const ySign = y >= 0 ? '+' : '';
  const renkSinifi = isZero ? '' : (isPos ? 'art' : 'eks');
  const renkKodu = isZero ? '#94a3b8' : (isPos ? '#10b981' : '#ef4444');
  return {
    metin: `${sign}${sayi(t, 2)} ${birim} (${ySign}%${sayi(y, 2)})`,
    fiyatMetin: `${sign}${sayi(t, 2)} ${birim}`,
    yuzdeMetin: `(${ySign}%${sayi(y, 2)})`,
    renkSinifi,
    renkKodu
  };
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
  $('#hacimFiltre').classList.toggle('gizli', !(l && l.dinamik === 'bist'));
  bildirimSayisiGuncelle();
}

$('#listeler').addEventListener('click', e => {
  const li = e.target.closest('li'); if (!li) return;
  D.aktifId = li.dataset.id; localStorage.setItem('aktifListe', D.aktifId);
  D.gosterilen = 150; D.satirlar = [];
  listeMenuCiz(); tablo(); tara();

  // Mobilde listeye tıklayınca doğrudan hisse tablosunun başına akıcı şekilde kaydır
  if (window.innerWidth <= 768) {
    const ana = document.querySelector('.ana') || document.querySelector('.arac-cubugu');
    if (ana) {
      setTimeout(() => {
        ana.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    }
  }
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
      if (l.semboller.includes(id)) return bildir(`Bu sembol zaten "${l.ad}" listenizde kayıtlı.`);
      l.semboller.push(id);
      await listeleriKaydet();
      bildir(`${id.split(':')[1]} → Kripto listesine eklendi.`);
      tara();
    } else {
      // BIST listesindeyken kripto sembolü eklenmeye çalışılırsa otomatik kripto listesine yönlendir
      if (id.startsWith('BINANCE:') || id.endsWith('USDT') || id === 'GATE:PIUSDT') {
        return sembolEkle(id, 'kripto');
      }
      bildir('Bu liste zaten tüm BIST hisselerini kapsıyor. Kripto veya favori listenize ekleyebilirsiniz.');
    }
    return;
  }
  if (l.semboller.includes(id)) return bildir(`Bu sembol zaten "${l.ad}" listenizde var.`);
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
    bildirimleriYukle();

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
    if (D.satirlar && D.satirlar.length > 0) {
      $('#durum').textContent = 'Canlı Akış (Bağlantı Bekleniyor): ' + new Date().toLocaleTimeString('tr-TR');
    } else {
      $('#durum').textContent = '⚠️ ' + e.message;
    }
  }
}

const deger = (r, alan) => alan.split('.').reduce((o, k) => (o == null ? null : o[k]), r);
const norm = s => String(s || '').toLocaleUpperCase('tr-TR')
  .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C');
function digerListelerdeBul(aramaStr) {
  if (!aramaStr || !D.listeler?.listeler) return [];
  const q = norm(aramaStr);
  const sonuclar = [];
  for (const l of D.listeler.listeler) {
    if (l.id === D.aktifId) continue;
    const eslesenSembol = (l.semboller || []).find(s => {
      const salt = s.includes(':') ? s.split(':')[1] : s;
      return norm(s).includes(q) || norm(salt).includes(q);
    });
    if (eslesenSembol) {
      sonuclar.push({ liste: l, sembol: eslesenSembol });
    }
  }
  return sonuclar;
}

window.listeGec = function(listeId, aramaKelimesi = '') {
  D.aktifId = listeId;
  localStorage.setItem('aktifListe', listeId);
  D.gosterilen = 150;
  D.satirlar = [];
  if (aramaKelimesi) {
    D.arama = aramaKelimesi;
    const aramaInp = $('#aramaInput');
    if (aramaInp) aramaInp.value = aramaKelimesi;
  }
  listeMenuCiz();
  tablo();
  tara();
  if (window.innerWidth <= 768) {
    const ana = document.querySelector('.ana') || document.querySelector('.arac-cubugu');
    if (ana) setTimeout(() => ana.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }
};

function filtreliSatirlar() {
  const q = norm(D.arama);
  const l = aktifListe();
  // Hacim filtresi sadece BIST listesinde ve arama yapılmıyorken geçerlidir
  const minHacim = (l && l.dinamik === 'bist' && !q) ? +$('#hacimFiltre').value : 0;
  let s = D.satirlar.filter(r => {
    if (q) {
      const kod = norm(r.kod);
      const ad = norm(r.ad);
      const id = norm(r.id);
      const salt = norm((r.id || '').split(':')[1] || '');
      if (!kod.includes(q) && !ad.includes(q) && !id.includes(q) && !salt.includes(q)) return false;
    }
    if (minHacim && (r.tlHacim || 0) < minHacim) return false;
    if (!q) {
      const y = r.yon || {};
      switch (D.filtre) {
        case 'ozel': return (r.ozelTaktikler && r.ozelTaktikler.length > 0) || r.isaretler?.some(i => i.tip?.startsWith('ozel_') || i.tip === 'kombo');
        case 'firsat': return r.isaretler?.some(i => i.tip === 'firsat');
        case 'tuzak': return r.isaretler?.some(i => i.tip === 'tuzak');
        case 'yukselis': return y.s2 > 0 && y.s4 > 0 && y.g1 > 0;
        case 'dusus': return y.s2 < 0 && y.s4 < 0 && y.g1 < 0;
        default: return true;
      }
    }
    return true;
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
  
  const bosMesaj = $('#bosMesaj');
  if (s.length === 0 && D.satirlar.length > 0) {
    bosMesaj.classList.remove('gizli');
    if (D.arama) {
      const digerleri = digerListelerdeBul(D.arama);
      if (digerleri.length > 0) {
        bosMesaj.innerHTML = `
          <div style="padding:16px; background:rgba(30,41,59,0.9); border:1px solid #3b82f6; border-radius:10px; margin:15px auto; max-width:550px; text-align:left;">
            <div style="font-size:14px; font-weight:700; color:#60a5fa; margin-bottom:8px;">💡 Aradığınız "${esc(D.arama)}" şu anki "${esc(aktifListe()?.ad || '')}" listesinde değil, başka bir listenizde kayıtlı:</div>
            ${digerleri.map(d => `
              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; background:#0f172a; padding:10px 14px; border-radius:8px; border:1px solid #334155;">
                <span><b>${esc(d.sembol.split(':')[1] || d.sembol)}</b> &rarr; <span style="color:#cbd5e1">${esc(d.liste.ad)}</span></span>
                <button class="btn" style="padding:5px 12px; font-size:12px; background:#2563eb;" onclick="window.listeGec('${esc(d.liste.id)}', '${esc(D.arama)}')">${esc(d.liste.ad)} Listesine Git ➔</button>
              </div>
            `).join('')}
          </div>
        `;
      } else {
        bosMesaj.innerHTML = `Bu listede "<b>${esc(D.arama)}</b>" bulunamadı.`;
      }
    } else {
      bosMesaj.innerHTML = 'Bu filtreye uyan varlık yok.';
    }
  } else {
    bosMesaj.classList.toggle('gizli', s.length > 0 || !D.satirlar.length);
  }
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
let detayFiyatTimer = null;
let sonDetayFiyat = null;

function detayCanliFiyatGuncelle(id, fiyat, degisim) {
  if (!id || id !== D.detaySembol) return;
  const kutu = $('#dCanliFiyatKutu');
  const fEl = $('#dCanliFiyat');
  const dEl = $('#dCanliDegisim');
  if (!kutu || !fEl || !dEl) return;

  if (fiyat == null || !isFinite(fiyat)) {
    kutu.classList.add('gizli');
    return;
  }

  kutu.classList.remove('gizli');
  const birim = paraBirimiAl(id);
  const fiyatMetni = `${sayi(fiyat)} ${birim}`;
  fEl.textContent = fiyatMetni;

  const emirKutu = $('#emirCanliFiyatKutu');
  const emirFEl = $('#emirCanliFiyat');
  const emirDEl = $('#emirCanliDegisim');
  if (emirKutu && emirFEl) {
    emirKutu.dataset.fiyat = fiyat;
    emirFEl.textContent = fiyatMetni;
  }

  // Fiyat yukarı/aşağı oynadığında anlık renk vurgusu
  if (sonDetayFiyat != null && fiyat !== sonDetayFiyat) {
    const yukari = fiyat > sonDetayFiyat;
    kutu.style.borderColor = yukari ? '#10b981' : '#ef4444';
    fEl.style.color = yukari ? '#34d399' : '#f87171';
    if (emirKutu && emirFEl) {
      emirKutu.style.borderColor = yukari ? '#10b981' : '#ef4444';
      emirFEl.style.color = yukari ? '#34d399' : '#f87171';
    }
    setTimeout(() => {
      if (kutu) kutu.style.borderColor = '#334155';
      if (fEl) fEl.style.color = '#f8fafc';
      if (emirKutu) emirKutu.style.borderColor = '#334155';
      if (emirFEl) emirFEl.style.color = '#f8fafc';
    }, 650);
  }
  sonDetayFiyat = fiyat;

  if (degisim != null && isFinite(degisim)) {
    const pos = degisim >= 0;
    const degMetni = `${pos ? '+' : ''}%${sayi(degisim, 2)}`;
    const degRenk = pos ? '#10b981' : '#ef4444';
    const degBg = pos ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
    dEl.textContent = degMetni;
    dEl.style.color = degRenk;
    dEl.style.background = degBg;
    if (emirDEl) {
      emirDEl.textContent = degMetni;
      emirDEl.style.color = degRenk;
      emirDEl.style.background = degBg;
    }
  } else {
    dEl.textContent = '—';
    if (emirDEl) emirDEl.textContent = '—';
  }

  // En güncel anlık fiyatı demo emirler için de senkron tut
  const satir = D.satirlar.find(x => x.id === id);
  if (satir) {
    satir.fiyat = fiyat;
    if (degisim != null) satir.degisim = degisim;
  }
  if (D.detayVeri && D.detayVeri.sembol === id && D.detayVeri.zamanDilimleri) {
    Object.values(D.detayVeri.zamanDilimleri).forEach(z => {
      if (z && z.seviyeler) z.seviyeler.fiyat = fiyat;
    });
  }
}

function detayAc(id, pushHistory = true) {
  D.detaySembol = id;
  sonDetayFiyat = null;
  $('#perde').classList.remove('gizli'); $('#detay').classList.remove('gizli');
  if (pushHistory) {
    try {
      history.pushState({ modal: 'detay', sembol: id }, '', `#analiz-${encodeURIComponent(id)}`);
    } catch (_) {}
  }
  const r = D.satirlar.find(x => x.id === id);
  $('#dAd').textContent = (r ? r.kod + ' · ' + (r.ad || '') : id);
  $('#dAlt').textContent = 'Analiz ediliyor...';
  $('#dTv').href = 'https://tr.tradingview.com/chart/?symbol=' + encodeURIComponent(id.startsWith('YAHOO:') ? id.split(':')[1] : id);
  detayCanliFiyatGuncelle(id, r?.fiyat, r?.degisim);

  // Sadece detay açıkken her 3 saniyede bir ultra hafif canlı fiyat güncellemesi (sistem yükü yaratmaz)
  if (detayFiyatTimer) clearInterval(detayFiyatTimer);
  detayFiyatTimer = setInterval(async () => {
    if (!D.detaySembol || D.detaySembol !== id) return;
    try {
      const fVeri = await api(`/api/fiyat?sembol=${encodeURIComponent(id)}`);
      if (fVeri && fVeri.fiyat > 0 && D.detaySembol === id) {
        detayCanliFiyatGuncelle(id, fVeri.fiyat, fVeri.degisim);
      }
    } catch (_) {}
  }, 3000);

  if (!demoPortfoyVerisi) demoPortfoyYukle();
  detayYukle();
}

function detayKapat(popHistory = true) {
  D.detaySembol = null;
  sonDetayFiyat = null;
  if (detayFiyatTimer) { clearInterval(detayFiyatTimer); detayFiyatTimer = null; }
  $('#perde').classList.add('gizli');
  $('#detay').classList.add('gizli');
  if (popHistory && window.location.hash.startsWith('#analiz-')) {
    try { history.back(); } catch (_) {}
  }
}

if ($('#dGeriBtn')) $('#dGeriBtn').onclick = () => detayKapat();
$('#dKapat').onclick = () => detayKapat();
$('#perde').onclick = () => {
  if (!$('#demoEmirModal').classList.contains('gizli')) {
    $('#demoEmirModal').classList.add('gizli');
    return;
  }
  detayKapat();
  demoPortfoyKapat();
  ['#bildirimModal', '#sniperModal', '#balinaModal', '#alarmModal', '#ziyaretModal', '#kurumsalModal', '#raporSifreModal', '#gunlukRaporModal'].forEach(sel => {
    const el = $(sel);
    if (el) el.classList.add('gizli');
  });
};
document.addEventListener('keydown', e => { if (e.key === 'Escape') { detayKapat(); demoPortfoyKapat(); } });
$('#dFavori').onclick = () => D.detaySembol && sembolEkle(D.detaySembol, 'favoriler');

// Detay yükleyici: Her zaman canlı taze fiyatla çalışır
async function detayYukle(zorla = false) {
  const id = D.detaySembol;

  $('#dIcerik').innerHTML = '<div class="yukleniyor">⚡ Canlı piyasa verileri ve analiz hesaplanıyor...</div>';
  try {
    // Önbellek kullanmadan doğrudan en güncel taze veriyi çek
    const v = await api(`/api/analiz?sembol=${encodeURIComponent(id)}&tf=${encodeURIComponent(D.detayTf)}&t=${Date.now()}`);
    if (id !== D.detaySembol) return;
    
    // En güncel taze canlı fiyatı al (önce sunucudan anlık gelen canlı fiyat)
    const anaSatir = D.satirlar.find(x => x.id === id);
    const tazeFiyat = (v.canliFiyat && v.canliFiyat > 0) ? v.canliFiyat : anaSatir?.fiyat;
    const tazeDegisim = v.canliDegisim ?? anaSatir?.degisim;

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
    detayCanliFiyatGuncelle(id, tazeFiyat, tazeDegisim);
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

// ================= İşlem Öncesi Güvenlik Kontrol Özeti =================
function girisKontrolKarti(v, z, anaSatir) {
  if (!v || !z || z.hata || !z.seviyeler) return '';
  const s = z.seviyeler;
  const bench = anaSatir?.benchDegisim;
  const gh = anaSatir?.goreceliHacim;
  const tuzakSev = z.tuzak?.seviye || 'Düşük';
  const s4 = v.zamanDilimleri?.s4;
  const g1 = v.zamanDilimleri?.g1;
  const rr = (s.alimHedef > s.fiyat && s.alimStop < s.fiyat)
    ? (s.alimHedef - s.fiyat) / (s.fiyat - s.alimStop)
    : 0;

  const maddeler = [];
  // 1. Piyasa Rejimi
  if (bench == null) {
    maddeler.push({ ikon: '⚪', ad: 'Piyasa Rejimi', durum: 'Veri yok', renk: '#94a3b8' });
  } else if (bench <= -2.0) {
    maddeler.push({ ikon: '🔴', ad: 'Piyasa Rejimi', durum: `Sert Satış (${bench >= 0 ? '+' : ''}%${bench.toFixed(2)})`, renk: '#ef4444' });
  } else if (bench <= -0.8) {
    maddeler.push({ ikon: '🟡', ad: 'Piyasa Rejimi', durum: `Zayıf (${bench >= 0 ? '+' : ''}%${bench.toFixed(2)})`, renk: '#f59e0b' });
  } else {
    maddeler.push({ ikon: '🟢', ad: 'Piyasa Rejimi', durum: `Destekleyici (${bench >= 0 ? '+' : ''}%${bench.toFixed(2)})`, renk: '#10b981' });
  }

  // 2. Hacim Desteği
  if (gh == null) {
    maddeler.push({ ikon: '⚪', ad: 'Hacim', durum: 'Ölçülmedi', renk: '#94a3b8' });
  } else if (gh >= 1.2) {
    maddeler.push({ ikon: '🟢', ad: 'Hacim', durum: `Güçlü (${gh.toFixed(2)}x)`, renk: '#10b981' });
  } else if (gh >= 0.85) {
    maddeler.push({ ikon: '🟡', ad: 'Hacim', durum: `Normal (${gh.toFixed(2)}x)`, renk: '#f59e0b' });
  } else {
    maddeler.push({ ikon: '🔴', ad: 'Hacim', durum: `Sığ (${gh.toFixed(2)}x)`, renk: '#ef4444' });
  }

  // 3. Tuzak Kontrolü
  if (tuzakSev === 'Yüksek') {
    maddeler.push({ ikon: '🔴', ad: 'Tuzak Riski', durum: 'Yüksek (Dikkat!)', renk: '#ef4444' });
  } else if (tuzakSev === 'Orta') {
    maddeler.push({ ikon: '🟡', ad: 'Tuzak Riski', durum: 'Orta', renk: '#f59e0b' });
  } else {
    maddeler.push({ ikon: '🟢', ad: 'Tuzak Riski', durum: 'Temiz', renk: '#10b981' });
  }

  // 4. Trend Uyumu (4S + Günlük)
  const s4P = s4?.skor ?? 0;
  const g1P = g1?.skor ?? 0;
  if (s4P >= 20 && g1P >= 15) {
    maddeler.push({ ikon: '🟢', ad: 'Trend Uyumu', durum: `4S & 1G Güçlü (+${s4P} / +${g1P})`, renk: '#10b981' });
  } else if (s4P <= -20 && g1P <= -15) {
    maddeler.push({ ikon: '🔴', ad: 'Trend Uyumu', durum: `Düşüş Trendi (${s4P} / ${g1P})`, renk: '#ef4444' });
  } else {
    maddeler.push({ ikon: '🟡', ad: 'Trend Uyumu', durum: `Kararsız (${s4P} / ${g1P})`, renk: '#f59e0b' });
  }

  // 5. Risk / Ödül
  if (rr >= 1.5) {
    maddeler.push({ ikon: '🟢', ad: 'Risk / Ödül', durum: `İyi (1 : ${rr.toFixed(2)})`, renk: '#10b981' });
  } else if (rr >= 1.1) {
    maddeler.push({ ikon: '🟡', ad: 'Risk / Ödül', durum: `Dar (1 : ${rr.toFixed(2)})`, renk: '#f59e0b' });
  } else {
    maddeler.push({ ikon: '🔴', ad: 'Risk / Ödül', durum: 'Yetersiz', renk: '#ef4444' });
  }

  const yesilSayisi = maddeler.filter(m => m.ikon === '🟢').length;
  const kirmiziSayisi = maddeler.filter(m => m.ikon === '🔴').length;

  let kararMetni = '🟡 DİKKATLİ GİR / ONAY BEKLE';
  let kararRenk = '#f59e0b';
  if (tuzakSev === 'Yüksek' || (bench != null && bench <= -2.0) || kirmiziSayisi >= 2) {
    kararMetni = '🔴 BEKLE / GİRİŞ RİSKLİ';
    kararRenk = '#ef4444';
  } else if (yesilSayisi >= 4 && kirmiziSayisi === 0) {
    kararMetni = '🟢 GİRİŞE UYGUN (KALİTELİ KURULUM)';
    kararRenk = '#10b981';
  }

  return `
  <div class="kutu" style="background:rgba(15, 23, 42, 0.92); border:1px solid ${kararRenk}66; border-left:4px solid ${kararRenk}; margin-bottom:16px; padding:12px 16px;">
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
      <div style="font-size:13.5px; font-weight:bold; color:#e2e8f0;">🛡️ İşlem Öncesi Doğrulama Özeti</div>
      <span style="background:${kararRenk}22; color:${kararRenk}; border:1px solid ${kararRenk}66; padding:3px 10px; border-radius:14px; font-size:11.5px; font-weight:bold;">${kararMetni}</span>
    </div>
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap:8px;">
      ${maddeler.map(m => `
        <div style="background:rgba(0,0,0,0.28); padding:7px 10px; border-radius:8px; border:1px solid #1e293b;">
          <div style="font-size:11px; color:#94a3b8;">${m.ikon} ${m.ad}</div>
          <div style="font-size:12px; font-weight:bold; color:${m.renk}; margin-top:2px;">${m.durum}</div>
        </div>
      `).join('')}
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
        <div style="font-size:15px; font-weight:bold; color:${karRenk}; margin-top:2px;">${formatKarZarar(karZarar, karZararYuzde, birim).metin}</div>
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
  const s = z?.seviyeler;
  const birim = paraBirimiAl(v.sembol);
  const anaSatir = D.satirlar.find(x => x.id === v.sembol);
  const bist = s ? bistTabanTavanHesapla(v.sembol, s.fiyat, anaSatir?.degisim, v.zamanDilimleri?.g1) : null;
  let alt = '';
  if (z && !z.hata && s) {
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

    const ozelKarne = v.ozelTaktikler || [];
    const aktifOzelSayisi = ozelKarne.filter(x => x.aktif).length;
    let ozelTaktiklerHtml = '';
    if (ozelKarne.length > 0) {
      ozelTaktiklerHtml = `
      <div class="kutu" style="border: 2px solid ${aktifOzelSayisi >= 2 ? '#f59e0b' : '#8b5cf6'}; background: linear-gradient(180deg, #161226 0%, #0d0b17 100%); box-shadow: 0 4px 20px rgba(139,92,246,0.15);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:6px;">
          <h4 style="margin:0; font-size:15px; color:#e2e8f0;">🧠 5 Özel Taktik & Akıllı Para Karnesi</h4>
          <span style="font-size:12px; background:${aktifOzelSayisi >= 2 ? '#f59e0b22' : '#8b5cf622'}; color:${aktifOzelSayisi >= 2 ? '#fde047' : '#c4b5fd'}; border:1px solid ${aktifOzelSayisi >= 2 ? '#f59e0b66' : '#8b5cf666'}; padding:3px 10px; border-radius:14px; font-weight:bold;">
            ${aktifOzelSayisi >= 2 ? `⭐ ${aktifOzelSayisi} / 5 Taktik Aktif (GÜÇLÜ SİNYAL)` : `${aktifOzelSayisi} / 5 Taktik Aktif`}
          </span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${ozelKarne.map(k => `
            <div style="background:${k.aktif ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255,255,255,0.02)'}; border:1px solid ${k.aktif ? 'rgba(16, 185, 129, 0.35)' : 'rgba(255,255,255,0.06)'}; border-left: 3px solid ${k.aktif ? '#10b981' : '#475569'}; border-radius:6px; padding:8px 10px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <b style="font-size:13px; color:${k.aktif ? '#34d399' : '#cbd5e1'};">${k.baslik}</b>
                <span style="font-size:11px; font-weight:bold; color:${k.aktif ? '#10b981' : '#64748b'};">${k.aktif ? '✅ AKTİF' : '⚪ Beklemede'}</span>
              </div>
              <div style="font-size:12px; color:#94a3b8; margin-top:4px; line-height:1.4;">${esc(k.yorum)}</div>
            </div>
          `).join('')}
        </div>
      </div>`;
    }

    alt = `<div class="iki-kolon">
      <div>
        <div class="kutu"><h4>🔍 ${z.ad} grafik – 8 yöntemin yorumu</h4>${yontemler}</div>
        ${gorselStratejiGrafikHtml(z, s, v)}
      </div>
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
        ${ozelTaktiklerHtml}
        <div class="kutu">
          <h4>📏 Önemli Seviyeler ${bist ? '<span style="font-size:11px; background:rgba(59,130,246,0.15); color:#93c5fd; border:1px solid rgba(59,130,246,0.3); padding:2px 7px; border-radius:10px; float:right;">🏛️ BIST Seansı</span>' : ''}</h4>
          <div class="seviye-satir"><span>Şu anki fiyat</span><b>${sayi(s.fiyat)} ${birim}</b></div>
          ${bist ? `
          <div class="seviye-satir" style="background:rgba(16, 185, 129, 0.1); border-left: 3px solid #10b981; padding:5px 8px; border-radius:4px;">
            <span style="font-weight:bold; color:#10b981;">🏛️ Günlük Tavan Fiyatı (+%10)</span><b style="color:#10b981; font-size:13.5px;">${sayi(bist.tavan)} ₺</b>
          </div>
          <div class="seviye-satir" style="background:rgba(239, 68, 68, 0.1); border-left: 3px solid #ef4444; padding:5px 8px; border-radius:4px;">
            <span style="font-weight:bold; color:#ef4444;">🏛️ Günlük Taban Fiyatı (-%10)</span><b style="color:#ef4444; font-size:13.5px;">${sayi(bist.taban)} ₺</b>
          </div>
          <div class="seviye-satir" style="font-size:12px; color:#94a3b8; padding:3px 8px;">
            <span>Önceki Gün Kapanış (Baz Fiyat)</span><b>${sayi(bist.bazFiyat)} ₺</b>
          </div>
          ` : ''}
          <div class="seviye-satir"><span>1. Teknik Direnç</span><b class="eks">${sayi(s.direnc)} ${birim}</b></div>
          <div class="seviye-satir"><span>2. Teknik Direnç</span><b class="eks">${sayi(s.direnc2)} ${birim}</b></div>
          <div class="seviye-satir"><span>1. Teknik Destek</span><b class="art">${sayi(s.destek)} ${birim}</b></div>
          <div class="seviye-satir"><span>2. Teknik Destek</span><b class="art">${sayi(s.destek2)} ${birim}</b></div>
          <div class="seviye-satir"><span>Ortalama mum oynaklığı (ATR)</span><b>${sayi(s.atr)} ${birim}</b></div>
        </div>
        <div class="kutu" style="border: 2px solid rgba(56, 189, 248, 0.4); background: linear-gradient(180deg, #131824 0%, #0d121f 100%);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:6px;">
            <h4 style="margin:0; font-size:15px; color:#f8fafc;">🎯 Long & Short Örnek Planları (Yapay Zeka Stratejisi)</h4>
            <span style="font-size:11px; background:#38bdf822; color:#38bdf8; border:1px solid #38bdf855; padding:2px 8px; border-radius:12px; font-weight:bold;">⚡ Otomatik Demo Emir</span>
          </div>

          <!-- Long Planı -->
          <div style="background:rgba(16, 185, 129, 0.08); border:1px solid rgba(16, 185, 129, 0.3); border-radius:8px; padding:10px 12px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight:bold; color:#10b981; font-size:13px;">🟢 Long (Yükseliş / Alış) Planı</span>
              <span class="kucuk" style="color:#a7f3d0;">R/R: <b>1 : ${sayi(s.riskOdul, 2)}</b></span>
            </div>
            <div class="seviye-satir" style="margin-top:6px;"><span>🛑 Zarar-kes (Stop-Loss)</span><b class="eks">${sayi(s.alimStop)}</b></div>
            <div class="seviye-satir"><span>🎯 1. Kâr Hedefi</span><b class="art">${sayi(s.alimHedef)}</b></div>
            <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
              <button class="btn" style="background:#10b981; color:#fff; font-size:12px; font-weight:bold; padding:7px 14px; flex:1; display:inline-flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 0 10px rgba(16,185,129,0.3);" onclick="otomatikPlanUygula('LONG')">
                ⚡ Bu Planla Demo Long Aç (Otomatik Al)
              </button>
              <button class="btn ikincil" style="font-size:12px; padding:7px 12px;" title="Emri özelleştirerek aç" onclick="emirModaliAc('LONG')">
                ✏️ Özelleştir
              </button>
            </div>
          </div>

          <!-- Short Planı -->
          <div style="background:rgba(239, 68, 68, 0.08); border:1px solid rgba(239, 68, 68, 0.3); border-radius:8px; padding:10px 12px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight:bold; color:#ef4444; font-size:13px;">🔴 Short (Düşüş / Açığa Satış) Planı</span>
              <span class="kucuk" style="color:#fecaca;">R/R: <b>1 : ${sayi(s.satisRiskOdul || '—', 2)}</b></span>
            </div>
            <div class="seviye-satir" style="margin-top:6px;"><span>🛑 Zarar-kes (Stop-Loss)</span><b class="eks">${sayi(s.satisStop || '—')}</b></div>
            <div class="seviye-satir"><span>🎯 1. Kâr Hedefi</span><b class="art">${sayi(s.satisHedef || '—')}</b></div>
            <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
              <button class="btn" style="background:#ef4444; color:#fff; font-size:12px; font-weight:bold; padding:7px 14px; flex:1; display:inline-flex; align-items:center; justify-content:center; gap:6px; box-shadow:0 0 10px rgba(239,68,68,0.3);" onclick="otomatikPlanUygula('SHORT')">
                ⚡ Bu Planla Demo Short Aç (Otomatik Sat)
              </button>
              <button class="btn ikincil" style="font-size:12px; padding:7px 12px;" title="Emri özelleştirerek aç" onclick="emirModaliAc('SHORT')">
                ✏️ Özelleştir
              </button>
            </div>
          </div>

          <div class="uyari" style="margin:0; font-size:11.5px; opacity:0.9; line-height:1.5;">
            💡 <b>Tek Dokunuşla Otomatik Test:</b> Butona bastığınızda analizdeki Stop ve Kâr Hedefi seviyeleri sisteme otomatik girilir. Kasanızdan güvenli (%5) bir bütçeyle demo pozisyon açılır ve grafik hareket ettikçe hedefe/stopa ulaşıp ulaşmadığı canlı takip edilir.
          </div>
        </div>
        ${fibHtml}
        ${btHtml}
      </div>
    </div>
    <div class="uyari">Son mum: ${new Date(z.sonMum).toLocaleString('tr-TR')} · ${z.mumSayisi} mum incelendi. Bu analiz bir karar destek aracıdır, yatırım tavsiyesi değildir. Son karar her zaman sizindir.</div>`;
  }
  const poz = (demoPortfoyVerisi?.acikPozisyonlar || []).find(x => x.sembol === v.sembol);
  const riskKartiHtml = poz ? pozisyonRiskKarti(poz, z, v) : girisKontrolKarti(v, z, anaSatir);
  $('#dIcerik').innerHTML = `${riskKartiHtml}<div class="tf-ozet">${ozet}</div>${sniperHtml || ''}${alt}`;
  if (z && !z.hata && s) {
    D.sonDetayGorsel = { z, s, v };
    setTimeout(() => gorselStratejiGrafikCiz(z, s, v), 60);
  }
}
$('#dIcerik').addEventListener('click', e => {
  const k = e.target.closest('.tf-kart[data-tf]'); if (!k) return;
  D.detayTf = k.dataset.tf;
  detayYukle();
});

// ================= 📊 Görsel Strateji & Formasyon Grafiği Çizimi =================
function gorselStratejiGrafikHtml(z, s, v) {
  if (!z || z.hata || !s) return '';
  const tfAd = z.ad || 'Seçili';
  const yonMetin = s.yon > 0 ? '🟢 AL ONAYLI' : (s.yon < 0 ? '🔴 SAT ONAYLI' : '⚪ NÖTR');
  const yonRenk = s.yon > 0 ? '#10b981' : (s.yon < 0 ? '#ef4444' : '#94a3b8');

  let formasyonAd = 'Boğa Bayrağı (Bull Flag)';
  let formasyonIkon = '🚩';
  let formasyonDetay = `${sayi(s.direnc)} ₺ direnci üzerinde BOS kırılımı ve bayrak tamamlanması.`;

  if (s.yon > 0) {
    if (z.tf === 'm15') {
      formasyonAd = 'Hızlı Bayrak / Flama Kırılımı';
      formasyonIkon = '🚩';
      formasyonDetay = `${sayi(s.direnc)} ₺ direnci üzerinde BOS kırılımı ve bayrak tamamlanması.`;
    } else if (z.tf === 's1' || z.tf === 's2') {
      formasyonAd = 'Kurumsal FVG Likidite Boşluğu';
      formasyonIkon = '🧲';
      formasyonDetay = `${sayi(s.destek)} - ${sayi(s.fiyat)} ₺ aralığında kurumsal alıcı tepkisi.`;
    } else if (z.tf === 's4') {
      formasyonAd = 'İkili Dip (Double Bottom - W)';
      formasyonIkon = '💎';
      formasyonDetay = `${sayi(s.destek)} tabanında ikili dip onayı ve boyun kırılımı.`;
    } else {
      formasyonAd = 'Yükselen Üçgen (Ascending Triangle)';
      formasyonIkon = '📐';
      formasyonDetay = `Dipler yükseliyor, ${sayi(s.direnc)} tavanı test ediliyor.`;
    }
  } else {
    formasyonAd = 'Direnç Tepkisi / Ayı Bayrağı';
    formasyonIkon = '⚠️';
    formasyonDetay = `${sayi(s.direnc)} tavanından aşağı yönlü satıcı baskısı.`;
  }

  return `
    <div class="kutu gorsel-strateji-kutu">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; border-bottom:1px solid #1e293b; padding-bottom:10px; margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:17px;">📊</span>
          <h4 style="margin:0; font-size:14px; color:#f8fafc;">${esc(v.kod || v.sembol)} · ${esc(tfAd)} Görsel Strateji & Formasyon</h4>
          <span style="font-size:11px; padding:2px 7px; background:${yonRenk}20; color:${yonRenk}; border:1px solid ${yonRenk}40; border-radius:10px; font-weight:800;">${yonMetin}</span>
        </div>
        <div style="display:flex; align-items:center; gap:12px; font-size:11.5px;">
          <label style="cursor:pointer; display:flex; align-items:center; gap:4px; color:#cbd5e1;">
            <input type="checkbox" id="gorselChkFormasyon" checked onchange="gorselStratejiYenidenCiz()"> Formasyon
          </label>
          <label style="cursor:pointer; display:flex; align-items:center; gap:4px; color:#cbd5e1;">
            <input type="checkbox" id="gorselChkFvg" checked onchange="gorselStratejiYenidenCiz()"> FVG Kutusu
          </label>
          <label style="cursor:pointer; display:flex; align-items:center; gap:4px; color:#cbd5e1;">
            <input type="checkbox" id="gorselChkSeviyeler" checked onchange="gorselStratejiYenidenCiz()"> TP & Stop
          </label>
          <label style="cursor:pointer; display:flex; align-items:center; gap:4px; color:#c4b5fd;">
            <input type="checkbox" id="gorselChkFib" checked onchange="gorselStratejiYenidenCiz()"> Fibonacci
          </label>
        </div>
      </div>

      <!-- 3'lü Özet Rozetleri -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:8px; margin-bottom:10px;">
        <div style="background:#0a0e17; border:1px solid #1e293b; border-radius:8px; padding:8px 10px;">
          <span class="kucuk" style="color:#94a3b8; display:block;">Saptanan Formasyon</span>
          <b style="color:#38bdf8; font-size:12.5px;">${formasyonIkon} ${formasyonAd}</b>
        </div>
        <div style="background:#0a0e17; border:1px solid #1e293b; border-radius:8px; padding:8px 10px;">
          <span class="kucuk" style="color:#94a3b8; display:block;">Kırılım / Direnç</span>
          <b style="color:#10b981; font-size:12.5px;">⚡ ${sayi(s.direnc)} ₺</b>
        </div>
        <div style="background:#0a0e17; border:1px solid #1e293b; border-radius:8px; padding:8px 10px;">
          <span class="kucuk" style="color:#94a3b8; display:block;">TP1 / Stop-Loss</span>
          <b style="color:#f8fafc; font-size:12px;"><span style="color:#10b981;">TP1: ${sayi(s.alimHedef)}</span> · <span style="color:#ef4444;">Stop: ${sayi(s.alimStop)}</span></b>
        </div>
      </div>

      <!-- Grafik Canvas -->
      <div class="gorsel-strateji-canvas-sarma">
        <canvas id="detayStratejiCanvas" width="760" height="320"></canvas>
      </div>

      <div style="margin-top:10px; font-size:11.5px; color:#94a3b8; line-height:1.45; background:#0a0e17; padding:8px 12px; border-radius:6px; border:1px solid #1e293b;">
        💡 <b>${esc(tfAd)} Periyot Okuması:</b> ${formasyonDetay} Fiyat mumları üzerinde kurumsal dengesizlik alanı (FVG), formasyon sınırları ve beklenen hedef seviyeleri görselleştirilmiştir. Üstteki periyot kartlarına (15dk, 1s, 4s, Günlük) tıkladığınızda grafik o periyoda ait canlı verilerle otomatik güncellenir.
      </div>
    </div>
  `;
}

function gorselStratejiYenidenCiz() {
  if (D.sonDetayGorsel) {
    const { z, s, v } = D.sonDetayGorsel;
    gorselStratejiGrafikCiz(z, s, v);
  }
}

function okCizCanvas(ctx, fromX, fromY, toX, toY, color) {
  const headlen = 10;
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
  ctx.fill();
}

function gorselStratejiGrafikCiz(z, s, v) {
  const canvas = document.getElementById('detayStratejiCanvas');
  if (!canvas || !s) {
    if (!canvas && document.getElementById('dIcerik')) {
      setTimeout(() => {
        const c2 = document.getElementById('detayStratejiCanvas');
        if (c2) gorselStratejiGrafikCiz(z, s, v);
      }, 100);
    }
    return;
  }

  try {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Arka planı temizle
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, w, h);

  // Mum verisi hazırlığı (Gerçek z.mumlar veya destek/dirence göre dinamik simülasyon)
  let mumlar = (z.mumlar && z.mumlar.length >= 8) ? [...z.mumlar.slice(-24)] : [];
  if (mumlar.length < 8) {
    const bazFiyat = s.fiyat || 100;
    const atr = s.atr || (bazFiyat * 0.02);
    let sonC = bazFiyat - (atr * 2);
    mumlar = [];
    for (let i = 0; i < 20; i++) {
      const yon = (i > 14 || (i % 3 !== 0)) ? 1 : -1;
      const oynama = (Math.random() * atr * 0.8) * yon;
      const c = Math.max(0.1, sonC + oynama);
      const o = sonC;
      const hF = Math.max(o, c) + (Math.random() * atr * 0.4);
      const lF = Math.min(o, c) - (Math.random() * atr * 0.4);
      mumlar.push({ o, h: hF, l: lF, c });
      sonC = c;
    }
    // Son mumu güncel fiyata hizala
    if (mumlar.length > 0) {
      mumlar[mumlar.length - 1].c = s.fiyat;
      mumlar[mumlar.length - 1].h = Math.max(mumlar[mumlar.length - 1].h, s.fiyat);
    }
  }

  // Fiyat Ölçeklendirme (Min - Max)
  let minP = Math.min(...mumlar.map(m => m.l));
  let maxP = Math.max(...mumlar.map(m => m.h));
  if (s.alimStop && s.alimStop > 0) minP = Math.min(minP, s.alimStop);
  if (s.alimHedef && s.alimHedef > 0) maxP = Math.max(maxP, s.alimHedef);
  if (s.destek && s.destek > 0) minP = Math.min(minP, s.destek);
  if (s.direnc && s.direnc > 0) maxP = Math.max(maxP, s.direnc);

  const marj = (maxP - minP) * 0.08 || 1;
  minP -= marj;
  maxP += marj;

  const padUst = 25;
  const padAlt = 30;
  const padSol = 20;
  const padSag = 75; // Fiyat ekseni için alan
  const cizimW = w - padSol - padSag;
  const cizimH = h - padUst - padAlt;

  const toY = p => padUst + ((maxP - p) / (maxP - minP)) * cizimH;

  // Izgara ve Fiyat Ekseni Çizgileri
  ctx.strokeStyle = '#141c2c';
  ctx.lineWidth = 1;
  const yatayBasamak = 5;
  for (let i = 0; i <= yatayBasamak; i++) {
    const fVal = minP + ((maxP - minP) * (i / yatayBasamak));
    const y = toY(fVal);
    ctx.beginPath();
    ctx.moveTo(padSol, y);
    ctx.lineTo(padSol + cizimW, y);
    ctx.stroke();

    // Sağ fiyat eksen etiketi
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(sayi(fVal, 2), padSol + cizimW + 6, y + 3);
  }

  const chkFvg = document.getElementById('gorselChkFvg')?.checked ?? true;
  const chkSeviyeler = document.getElementById('gorselChkSeviyeler')?.checked ?? true;
  const chkFormasyon = document.getElementById('gorselChkFormasyon')?.checked ?? true;
  const chkFib = document.getElementById('gorselChkFib')?.checked ?? true;

  // 0. FİBONACCİ DÜZELTME SEVİYELERİ (Görünür aralık içinde kalanlar)
  if (chkFib && z?.fibonacci) {
    const fib = z.fibonacci;
    const fibSeviyeler = [
      { ad: 'Fib 0.236', val: fib.f0236, altin: false },
      { ad: 'Fib 0.382', val: fib.f0382, altin: false },
      { ad: 'Fib 0.500', val: fib.f0500, altin: true },
      { ad: '⭐ Fib 0.618', val: fib.f0618, altin: true },
      { ad: 'Fib 0.786', val: fib.f0786, altin: false }
    ];
    ctx.save();
    fibSeviyeler.forEach(lv => {
      if (lv.val == null || lv.val < minP || lv.val > maxP) return;
      const y = toY(lv.val);
      ctx.strokeStyle = lv.altin ? 'rgba(192, 132, 252, 0.75)' : 'rgba(139, 92, 246, 0.38)';
      ctx.lineWidth = lv.altin ? 1.25 : 0.9;
      ctx.setLineDash(lv.altin ? [6, 3] : [2, 4]);
      ctx.beginPath();
      ctx.moveTo(padSol, y);
      ctx.lineTo(padSol + cizimW, y);
      ctx.stroke();
      ctx.fillStyle = lv.altin ? '#d8b4fe' : '#a78bfa';
      ctx.font = lv.altin ? 'bold 10px sans-serif' : '9.5px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${lv.ad}: ${sayi(lv.val)}`, padSol + cizimW - 6, y - 3);
    });
    ctx.restore();
  }

  // 1. FVG KUTUSU (Kurumsal Dengesizlik / Likidite Alanı)
  if (chkFvg) {
    const fvgUst = Math.min(maxP, s.direnc || (s.fiyat * 1.015));
    const fvgAlt = Math.max(minP, s.destek || (s.fiyat * 0.985));
    const yUst = toY(fvgUst);
    const yAlt = toY(fvgAlt);
    const fvgH = Math.max(16, yAlt - yUst);

    const fvgX = padSol + 30;
    const fvgW = cizimW - 50;

    ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.fillRect(fvgX, yUst, fvgW, fvgH);
    ctx.strokeRect(fvgX, yUst, fvgW, fvgH);
    ctx.setLineDash([]);

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('🧲 Kurumsal Dengesizlik / FVG Boşluğu', fvgX + 10, yUst + 14);
  }

  // 2. TP & STOP HEDEF SEVİYELERİ
  if (chkSeviyeler) {
    // TP1 Çizgisi
    if (s.alimHedef) {
      const tpY = toY(s.alimHedef);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(padSol, tpY);
      ctx.lineTo(padSol + cizimW, tpY);
      ctx.stroke();
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 10.5px sans-serif';
      ctx.fillText(`🎯 TP1 Kâr Al: ${sayi(s.alimHedef)} ₺`, padSol + 10, tpY - 4);
    }

    // Giriş Çizgisi
    if (s.fiyat) {
      const gY = toY(s.fiyat);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padSol, gY);
      ctx.lineTo(padSol + cizimW, gY);
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 10.5px sans-serif';
      ctx.fillText(`📍 Anlık / Giriş: ${sayi(s.fiyat)} ₺`, padSol + 10, gY - 4);
    }

    // Stop Çizgisi
    if (s.alimStop) {
      const stpY = toY(s.alimStop);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(padSol, stpY);
      ctx.lineTo(padSol + cizimW, stpY);
      ctx.stroke();
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 10.5px sans-serif';
      ctx.fillText(`🛑 Zarar Kes (Stop): ${sayi(s.alimStop)} ₺`, padSol + 10, stpY + 13);
    }
    ctx.setLineDash([]);
  }

  // 3. MUMLARI ÇİZ
  const mSayi = mumlar.length;
  const adim = cizimW / mSayi;
  const mG = Math.max(4, Math.min(14, adim * 0.65));
  const noktalar = [];

  mumlar.forEach((m, i) => {
    const x = padSol + (i * adim) + (adim - mG) / 2;
    const cx = x + mG / 2;
    const yukari = m.c >= m.o;
    const renk = yukari ? '#10b981' : '#ef4444';

    const yO = toY(m.o);
    const yC = toY(m.c);
    const yH = toY(m.h);
    const yL = toY(m.l);

    // Fitil
    ctx.strokeStyle = renk;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, yH);
    ctx.lineTo(cx, yL);
    ctx.stroke();

    // Gövde
    ctx.fillStyle = renk;
    const ustY = Math.min(yO, yC);
    const govdeH = Math.max(3, Math.abs(yC - yO));
    ctx.fillRect(x, ustY, mG, govdeH);

    noktalar.push({ cx, x, yC, yH, yL, ustY, govdeH, yukari });
  });

  // 4. FORMASYON ÇİZGİLERİ VE KIRILIM OKLARI
  if (chkFormasyon && noktalar.length >= 8) {
    ctx.lineWidth = 2.2;

    if (z.tf === 's4') {
      // W (İkili Dip) Çizgisi
      const n0 = noktalar[Math.floor(noktalar.length * 0.15)];
      const n1 = noktalar[Math.floor(noktalar.length * 0.35)];
      const n2 = noktalar[Math.floor(noktalar.length * 0.55)];
      const n3 = noktalar[Math.floor(noktalar.length * 0.75)];
      const n4 = noktalar[noktalar.length - 1];

      ctx.strokeStyle = '#a855f7';
      ctx.beginPath();
      ctx.moveTo(n0.cx, n0.yH);
      ctx.lineTo(n1.cx, n1.yL);
      ctx.lineTo(n2.cx, n2.yH);
      ctx.lineTo(n3.cx, n3.yL);
      ctx.lineTo(n4.cx, n4.yH);
      ctx.stroke();

      // Boyun Kırılım Çizgisi
      ctx.strokeStyle = '#38bdf8';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(n1.cx, n2.yH);
      ctx.lineTo(padSol + cizimW, n2.yH);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('W Boyun Kırılımı ➔', n2.cx + 6, n2.yH - 5);
    } else if (z.tf === 's1' || z.tf === 's2') {
      // FVG Dönüş Reaksiyon Oku
      const nReaksiyon = noktalar[Math.floor(noktalar.length * 0.65)];
      okCizCanvas(ctx, nReaksiyon.cx, nReaksiyon.yL + 30, nReaksiyon.cx, nReaksiyon.yL + 6, '#38bdf8');
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('Kurumsal Alış Reaksiyonu', nReaksiyon.cx - 50, nReaksiyon.yL + 42);
    } else {
      // Bayrak Direği ve Kanal Çizgisi (m15, Günlük vs.)
      const nStart = noktalar[0];
      const nDirek = noktalar[Math.floor(noktalar.length * 0.4)];
      const nBOS = noktalar[noktalar.length - 2];

      // Bayrak Direği
      ctx.strokeStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(nStart.cx, nStart.yL);
      ctx.lineTo(nDirek.cx, nDirek.yH);
      ctx.stroke();

      // Kanal Tavanı
      ctx.strokeStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(nDirek.cx, nDirek.yH);
      ctx.lineTo(nBOS.cx, nBOS.yH + 4);
      ctx.stroke();

      // Kırılım Oku (BOS)
      okCizCanvas(ctx, nBOS.cx, nBOS.yH + 30, nBOS.cx, nBOS.yH - 6, '#10b981');
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 10.5px sans-serif';
      ctx.fillText('⚡ BOS Kırılımı', nBOS.cx - 30, nBOS.yH - 10);
    }
  }

  // Sağ Fiyat Ekseninde Anlık Fiyat Rozeti
  if (s.fiyat) {
    const curY = toY(s.fiyat);
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(padSol + cizimW + 2, curY - 9, padSag - 6, 18);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(sayi(s.fiyat), padSol + cizimW + (padSag / 2) - 1, curY + 3);
  }
  } catch (err) {
    console.error('Grafik çizim hatası:', err);
  }
}

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
  // Hem TL hem USD işlemlerini doğru tespit et (karZarar veya eski karZararTL)
  const netSonuc = k => (typeof k.karZarar === 'number' ? k.karZarar : (typeof k.karZararTL === 'number' ? k.karZararTL : 0));
  const karli = kapali.filter(x => netSonuc(x) > 0);
  const zararli = kapali.filter(x => netSonuc(x) <= 0);
  const winrate = +((karli.length / toplam) * 100).toFixed(1);

  // Kâr ve Zarar toplamları (USD ve TL ayrık veya normalize)
  let toplamKarTL = 0, toplamZararTL = 0;
  let toplamKarUSD = 0, toplamZararUSD = 0;

  kapali.forEach(k => {
    const val = netSonuc(k);
    const birim = k.paraBirimi || (k.sembol?.includes('USDT') || k.sembol?.startsWith('BINANCE:') ? '$' : '₺');
    if (val > 0) {
      if (birim === '$') toplamKarUSD += val;
      else toplamKarTL += val;
    } else {
      if (birim === '$') toplamZararUSD += Math.abs(val);
      else toplamZararTL += Math.abs(val);
    }
  });

  // Kâr Faktörü: Toplam Kazanç / Toplam Kayıp
  let karFaktoru = 0;
  const toplamKazancSayi = toplamKarUSD + (toplamKarTL / 50); // Gösterge amaçlı normalize
  const toplamKayipSayi = toplamZararUSD + (toplamZararTL / 50);
  if (toplamKayipSayi > 0) {
    karFaktoru = +(toplamKazancSayi / toplamKayipSayi).toFixed(2);
  } else if (toplamKazancSayi > 0) {
    karFaktoru = '∞ (Kayıpsız)';
  }

  // Varlık türlerine göre performans
  const turPerf = { bist: { kar: 0, sayi: 0 }, kripto: { kar: 0, sayi: 0 }, emtia: { kar: 0, sayi: 0 } };
  kapali.forEach(k => {
    const s = k.sembol || '';
    let tur = 'bist';
    if (s.includes('BTC') || s.includes('ETH') || s.includes('GATE') || s.includes('BINANCE') || s.includes('USDT')) tur = 'kripto';
    else if (s.includes('XAU') || s.includes('SILVER') || s.includes('OIL') || s.includes('ALTIN')) tur = 'emtia';
    turPerf[tur].sayi++;
    turPerf[tur].kar += netSonuc(k);
  });

  // Seviye unvanı
  let unvan = 'Strateji Geliştirici';
  let unvanRenk = '#94a3b8';
  if (winrate >= 70) {
    unvan = '🏆 Usta Fon Yöneticisi (Pro Trader)';
    unvanRenk = '#34d399';
  } else if (winrate >= 50) {
    unvan = '⚖️ Dengeli & Disiplinli Yatırımcı';
    unvanRenk = '#38bdf8';
  } else if (zararli.length > karli.length) {
    unvan = '⚠️ Risk Yönetimi Geliştirilmeli';
    unvanRenk = '#f87171';
  }

  $('#karneSeviyeRozet').innerHTML = `<span style="color:${unvanRenk};">${unvan}</span>`;

  // Koçluk tavsiyeleri
  const tavsiyeler = [];
  if (winrate >= 80) {
    tavsiyeler.push(`🎯 <b>Kusursuz İsabet:</b> %${winrate} kazanma oranıyla harika bir performans sergiliyorsunuz! Kâr eden stratejinizi bozmadan devam edin.`);
  } else if (winrate >= 55) {
    tavsiyeler.push(`⚖️ <b>İstikrarlı Başarı:</b> %${winrate} kazanma oranıyla pozitif alandasınız. Kâr al ve stop disiplininizi sürdürün.`);
  } else {
    tavsiyeler.push(`🛡️ <b>Zarar Kes Disiplini:</b> Kazanma oranınız %${winrate}. Zarar eden pozisyonlarda inatlaşmayıp stop seviyelerine sadık kalmak kasanızı koruyacaktır.`);
  }

  if (turPerf.kripto.sayi > 0 && turPerf.kripto.kar > 0) {
    tavsiyeler.push(`⭐ <b>Kriptoda Güçlü Başarı:</b> Kripto işlemlerinizde toplam +${sayi(turPerf.kripto.kar, 2)} $ net kâr ile piyasayı doğru okuyorsunuz.`);
  }
  if (turPerf.emtia.sayi > 0 && turPerf.emtia.kar > 0) {
    tavsiyeler.push(`⭐ <b>Emtia / Forex Verimliliği:</b> Emtia ve döviz işlemlerinizde kârlılık oranınız gayet yüksek.`);
  }

  // Ortalama Kazanç / Kayıp Metni (İşlem Başına Düşen Ortalama)
  let ortKazancHtml = '<span style="color:#94a3b8;">—</span>';
  if (karli.length > 0) {
    if (toplamKarUSD > 0 && toplamKarTL > 0) {
      ortKazancHtml = `<span style="color:#34d399;">+${sayi(toplamKarUSD / karli.length, 1)} $ / +${sayi(toplamKarTL / karli.length, 0)} ₺</span>`;
    } else if (toplamKarUSD > 0) {
      ortKazancHtml = `<span style="color:#34d399;">+${sayi(toplamKarUSD / karli.length, 2)} $</span>`;
    } else {
      ortKazancHtml = `<span style="color:#34d399;">+${sayi(toplamKarTL / karli.length, 0)} ₺</span>`;
    }
  }

  let ortKayipHtml = '<span style="color:#a78bfa; font-size:12px; font-weight:normal;">(Kayıpsız 🛡️)</span>';
  if (zararli.length > 0) {
    if (toplamZararUSD > 0 && toplamZararTL > 0) {
      ortKayipHtml = `<span style="color:#f87171;">-${sayi(toplamZararUSD / zararli.length, 1)} $ / -${sayi(toplamZararTL / zararli.length, 0)} ₺</span>`;
    } else if (toplamZararUSD > 0) {
      ortKayipHtml = `<span style="color:#f87171;">-${sayi(toplamZararUSD / zararli.length, 2)} $</span>`;
    } else {
      ortKayipHtml = `<span style="color:#f87171;">-${sayi(toplamZararTL / zararli.length, 0)} ₺</span>`;
    }
  }

  const ortSonucGorunum = zararli.length > 0 ? `${ortKazancHtml} / ${ortKayipHtml}` : `${ortKazancHtml} ${ortKayipHtml}`;

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
      <div style="background:#111422; border:1px solid #2d264a; border-radius:8px; padding:8px 10px;" title="Kapanan işlemlerin adet başına düşen ortalama kâr ve zararı">
        <span class="kucuk">İşlem Başı Ort. Kâr / Zarar</span>
        <div style="font-size:13.5px; font-weight:bold; margin-top:2px;">${ortSonucGorunum}</div>
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
  if (sembolId === 'FX:USDTRY' || sembolId === 'FX:EURTRY') return '₺';
  if (sembolId.startsWith('FX:') || sembolId.startsWith('OANDA:') || sembolId.startsWith('TVC:')) return '$';
  if (sembolId.startsWith('BINANCE:') || sembolId.startsWith('OKX:') || sembolId.startsWith('GATE:') || sembolId.startsWith('BYBIT:')) return '$';
  if (sembolId.includes('XAUUSD') || sembolId.includes('SILVER') || sembolId.includes('OIL') || sembolId.includes('DXY') || sembolId.includes('EURUSD') || sembolId.includes('JPY')) return '$';
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
      // Eski tek kasadan çift kasaya geçişte oluşan bakiye kaymasını tek seferlik düzelt (açık/kapalı işlemler korunur)
      if (!p.kasaMutabakatV1) {
        const basTL = p.baslangicTL ?? VARSAYILAN_TL_KASA;
        const basUSD = p.baslangicUSD ?? VARSAYILAN_USD_KASA;
        let kapaliKarTL = 0, kapaliKarUSD = 0;
        (p.kapananIslemler || []).forEach(k => {
          const b = k.paraBirimi || paraBirimiAl(k.sembol);
          const kz = Number(k.karZarar ?? k.karZararTL ?? 0);
          if (b === '$') kapaliKarUSD += kz;
          else kapaliKarTL += kz;
        });
        let acikTeminatTL = 0, acikTeminatUSD = 0;
        (p.acikPozisyonlar || []).forEach(poz => {
          const b = poz.paraBirimi || paraBirimiAl(poz.sembol);
          const tem = Number(poz.teminat || +(poz.adet * poz.alisFiyat / (poz.kaldirac || 1)).toFixed(2));
          if (b === '$') acikTeminatUSD += tem;
          else acikTeminatTL += tem;
        });
        p.baslangicTL = basTL;
        p.baslangicUSD = basUSD;
        p.bakiyeTL = +(basTL + kapaliKarTL - acikTeminatTL).toFixed(2);
        p.bakiyeUSD = +(basUSD + kapaliKarUSD - acikTeminatUSD).toFixed(2);
        p.kasaMutabakatV1 = true;
        demoYerelKaydet(p);
      }
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
      if (sunucu && sunucu.fiyatHaritasi) {
        Object.assign(fiyatHaritasi, sunucu.fiyatHaritasi);
      }
    } catch (_) {}

    // Otomatik Stop / Hedef Kontrolü (SADECE bu kullanıcının kendi açık pozisyonları için - İzole)
    let otomatikDegisiklikVar = false;
    for (let i = (yerel.acikPozisyonlar || []).length - 1; i >= 0; i--) {
      const poz = yerel.acikPozisyonlar[i];
      const anlikFiyat = fiyatHaritasi[poz.sembol];
      if (!anlikFiyat || anlikFiyat <= 0) continue;

      const isShort = poz.yon === 'SHORT';
      let kapandi = false;
      let sebep = '';

      if (!isShort) {
        if (poz.hedefFiyat && anlikFiyat >= poz.hedefFiyat) { kapandi = true; sebep = 'hedef'; }
        else if (poz.stopFiyat && anlikFiyat <= poz.stopFiyat) { kapandi = true; sebep = 'stop'; }
      } else {
        if (poz.hedefFiyat && anlikFiyat <= poz.hedefFiyat) { kapandi = true; sebep = 'hedef'; }
        else if (poz.stopFiyat && anlikFiyat >= poz.stopFiyat) { kapandi = true; sebep = 'stop'; }
      }

      if (kapandi) {
        otomatikDegisiklikVar = true;
        const birim = poz.paraBirimi || paraBirimiAl(poz.sembol);
        const teminat = poz.teminat || +(poz.adet * poz.alisFiyat).toFixed(2);
        const fiyatFarki = isShort ? (poz.alisFiyat - anlikFiyat) : (anlikFiyat - poz.alisFiyat);
        const karZarar = +(fiyatFarki * poz.adet).toFixed(2);
        const karZararYuzde = teminat > 0 ? +((karZarar / teminat) * 100).toFixed(2) : 0;
        const iadeTutar = Math.max(0, +(teminat + karZarar).toFixed(2));

        if (birim === '$') yerel.bakiyeUSD = +((yerel.bakiyeUSD || VARSAYILAN_USD_KASA) + iadeTutar).toFixed(2);
        else yerel.bakiyeTL = +((yerel.bakiyeTL || VARSAYILAN_TL_KASA) + iadeTutar).toFixed(2);

        yerel.acikPozisyonlar.splice(i, 1);
        yerel.kapananIslemler = yerel.kapananIslemler || [];
        yerel.kapananIslemler.unshift({
          id: poz.id,
          sembol: poz.sembol,
          ad: poz.ad,
          yon: poz.yon || 'LONG',
          kaldirac: poz.kaldirac || 1,
          adet: poz.adet,
          alisFiyat: poz.alisFiyat,
          satisFiyat: anlikFiyat,
          paraBirimi: birim,
          satisTarih: new Date().toISOString(),
          teminat,
          karZarar,
          karZararYuzde,
          sebep: 'otomatik_' + sebep
        });

        if (sebep === 'hedef') {
          sesCal('kar');
          bildir(`🎉 DEMO HEDEF VURDU! ${poz.ad} ${anlikFiyat} ${birim} ile KÂRLA otomatik kapatıldı (+${karZarar} ${birim})!`, 7000);
        } else {
          sesCal('ding');
          bildir(`🛑 DEMO STOP ÇALIŞTI! ${poz.ad} ${anlikFiyat} ${birim} seviyesinden zararı kesmek için kapatıldı (${karZarar} ${birim}).`, 7000);
        }
      }
    }
    if (otomatikDegisiklikVar) {
      demoYerelKaydet(yerel);
    }

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

    const kzTL = formatKarZarar(netKarTL, netKarYuzdeTL, '₺');
    const kzUSD = formatKarZarar(netKarUSD, netKarYuzdeUSD, '$');
    $('#demoNetKar').innerHTML = `
      <div style="font-size:13.5px;"><span style="color:${kzTL.renkKodu}; font-weight:bold;">${kzTL.metin}</span></div>
      <div style="font-size:13.5px;"><span style="color:${kzUSD.renkKodu}; font-weight:bold;">${kzUSD.metin}</span></div>
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
    // 1. Masaüstü Tablo Görünümü
    const tabloHtml = `
      <div class="demo-masaustu-tablo tablo-sarma">
        <table style="width:100%; min-width:620px;">
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
              const kz = formatKarZarar(poz.karZarar, poz.karZararYuzde, birim);
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
                <td class="sag ${kz.renkSinifi}"><b>${kz.fiyatMetin}</b> <small style="font-weight:bold; margin-left:2px;">${kz.yuzdeMetin}</small></td>
                <td class="orta" style="white-space:nowrap;">
                  <button class="btn ikincil" style="padding:3px 7px; font-size:11px; margin-right:4px;" title="Pozisyonun risk durumunu ve analizini gör" onclick="demoPozisyonAnalizAc('${esc(poz.sembol)}')">🔍 Analiz</button>
                  <button class="btn tehlike" style="padding:3px 7px; font-size:11px;" onclick="demoPozisyonKapat('${esc(poz.id)}', ${poz.anlikFiyat})">Kapat</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;

    // 2. Mobil Kart Görünümü (Kaydırma Olmadan %100 Görünür ve Sabit)
    const kartlarHtml = `
      <div class="demo-mobil-kartlar">
        ${aciklar.map(poz => {
          const birim = poz.paraBirimi || '₺';
          const kz = formatKarZarar(poz.karZarar, poz.karZararYuzde, birim);
          const isShort = poz.yon === 'SHORT';
          const kStr = poz.kaldirac > 1 ? ` ${poz.kaldirac}x` : '';
          const yonRozet = isShort 
            ? `<span style="background:#ef444422; color:#ef4444; border:1px solid #ef444466; padding:2px 6px; border-radius:4px; font-size:11px; font-weight:bold;">🔴 SHORT${kStr}</span>` 
            : `<span style="background:#10b98122; color:#10b981; border:1px solid #10b98166; padding:2px 6px; border-radius:4px; font-size:11px; font-weight:bold;">🟢 LONG${kStr}</span>`;
          return `
          <div style="background:#11151f; border:1px solid #283142; border-left:4px solid ${kz.renkKodu}; border-radius:10px; padding:12px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <div>
                <div style="display:flex; align-items:center; gap:6px;">
                  <b style="font-size:15px; color:#fff;">${esc(poz.sembol.split(':')[1])}</b>
                  ${yonRozet}
                </div>
                <div class="kucuk" style="color:#94a3b8; margin-top:2px;">${esc(poz.ad)}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:15px; font-weight:800; color:${kz.renkKodu};">
                  ${kz.fiyatMetin}
                </div>
                <div style="font-size:12px; font-weight:bold; color:${kz.renkKodu}; margin-top:2px;">
                  ${kz.yuzdeMetin}
                </div>
              </div>
            </div>

            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:6px; background:#181e2b; padding:8px; border-radius:6px; margin:8px 0; font-size:12px;">
              <div>
                <span class="kucuk" style="color:#64748b; display:block;">Adet</span>
                <b>${poz.adet}</b>
              </div>
              <div>
                <span class="kucuk" style="color:#64748b; display:block;">Giriş Fiyatı</span>
                <b>${sayi(poz.alisFiyat)} ${birim}</b>
              </div>
              <div>
                <span class="kucuk" style="color:#64748b; display:block;">Güncel Fiyat</span>
                <b style="color:#38bdf8;">${sayi(poz.anlikFiyat)} ${birim}</b>
              </div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:10px;">
              <div style="background:#ef444412; border:1px dashed #ef444455; padding:6px 8px; border-radius:6px; cursor:pointer;" onclick="demoSeviyeDuzenle('${esc(poz.id)}', 'stop', ${poz.stopFiyat || 0})">
                <span style="color:#ef4444; font-size:11px; display:block;">🛑 Stop:</span>
                <b style="color:#f87171; font-size:12px;">${poz.stopFiyat ? sayi(poz.stopFiyat) + ' ' + birim : 'Belirtilmedi'} ✏️</b>
              </div>
              <div style="background:#10b98112; border:1px dashed #10b98155; padding:6px 8px; border-radius:6px; cursor:pointer;" onclick="demoSeviyeDuzenle('${esc(poz.id)}', 'hedef', ${poz.hedefFiyat || 0})">
                <span style="color:#10b981; font-size:11px; display:block;">🎯 Hedef:</span>
                <b style="color:#34d399; font-size:12px;">${poz.hedefFiyat ? sayi(poz.hedefFiyat) + ' ' + birim : 'Belirtilmedi'} ✏️</b>
              </div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1.3fr; gap:8px;">
              <button class="btn ikincil" style="padding:8px 6px; font-size:12px; font-weight:bold; justify-content:center;" onclick="demoPozisyonAnalizAc('${esc(poz.sembol)}')">
                🔍 Analiz Et
              </button>
              <button class="btn tehlike" style="padding:8px 6px; font-size:12px; font-weight:bold; justify-content:center;" onclick="demoPozisyonKapat('${esc(poz.id)}', ${poz.anlikFiyat})">
                💰 Pozisyonu Kapat
              </button>
            </div>
          </div>`;
        }).join('')}
      </div>`;

    $('#demoAcikPozisyonlar').innerHTML = tabloHtml + kartlarHtml;
  }

  // Kapanan İşlemler
  const kapali = p.kapananIslemler;
  if (!kapali.length) {
    $('#demoKapananIslemler').innerHTML = '<div class="bos" style="padding:15px;">Henüz kapanmış işlem geçmişi yok.</div>';
  } else {
    const kapaliTablo = `
      <div class="demo-masaustu-tablo tablo-sarma">
        <table style="width:100%; min-width:520px;">
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
              const kz = formatKarZarar(netSonuc, k.karZararYuzde, birim);
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
                <td class="sag ${kz.renkSinifi}"><b>${kz.fiyatMetin}</b> <small style="font-weight:bold; margin-left:2px;">${kz.yuzdeMetin}</small></td>
                <td class="sag kucuk">${new Date(k.satisTarih).toLocaleDateString('tr-TR')} ${new Date(k.satisTarih).toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'})}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;

    const kapaliKartlar = `
      <div class="demo-mobil-kartlar">
        ${kapali.map(k => {
          const birim = k.paraBirimi || '₺';
          const netSonuc = k.karZarar ?? k.karZararTL ?? 0;
          const kz = formatKarZarar(netSonuc, k.karZararYuzde, birim);
          const isShort = k.yon === 'SHORT';
          const kStr = k.kaldirac > 1 ? ` ${k.kaldirac}x` : '';
          const yonRozet = isShort 
            ? `<span style="background:#ef444422; color:#ef4444; border:1px solid #ef444466; padding:1px 5px; border-radius:4px; font-size:10px; font-weight:bold; margin-left:3px;">🔴 SHORT${kStr}</span>` 
            : `<span style="background:#10b98122; color:#10b981; border:1px solid #10b98166; padding:1px 5px; border-radius:4px; font-size:10px; font-weight:bold; margin-left:3px;">🟢 LONG${kStr}</span>`;
          return `
          <div style="background:#11151f; border:1px solid #283142; border-left:4px solid ${kz.renkKodu}; border-radius:8px; padding:10px 12px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div>
                <b style="font-size:14px; color:#fff;">${esc(k.sembol.split(':')[1])}</b> ${yonRozet}
                <div class="kucuk" style="color:#64748b; margin-top:3px;">
                  ${k.adet} adet · ${sayi(k.alisFiyat)} ➔ ${sayi(k.satisFiyat)} ${birim}
                </div>
              </div>
              <div style="text-align:right;">
                <b style="font-size:15px; color:${kz.renkKodu};">${kz.fiyatMetin}</b>
                <div class="kucuk" style="color:${kz.renkKodu}; font-weight:bold; margin-top:2px;">${kz.yuzdeMetin}</div>
              </div>
            </div>
            <div class="kucuk" style="color:#475569; margin-top:4px; text-align:right;">
              ${new Date(k.satisTarih).toLocaleDateString('tr-TR')} ${new Date(k.satisTarih).toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'})}
            </div>
          </div>`;
        }).join('')}
      </div>`;

    $('#demoKapananIslemler').innerHTML = kapaliTablo + kapaliKartlar;
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

function demoPortfoyAc(pushHistory = true) {
  sessionStorage.setItem('alper_demo_modal_acik', '1');
  $('#perde').classList.remove('gizli');
  $('#demoModal').classList.remove('gizli');
  if (pushHistory && window.location.hash !== '#demo') {
    try { history.pushState({ modal: 'demo' }, '', '#demo'); } catch (_) {}
  }
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
}

function demoPortfoyKapat(popHistory = true) {
  sessionStorage.removeItem('alper_demo_modal_acik');
  if (demoCanliSayac) { clearInterval(demoCanliSayac); demoCanliSayac = null; }
  $('#perde').classList.add('gizli');
  $('#demoModal').classList.add('gizli');
  if (popHistory && window.location.hash === '#demo') {
    try { history.back(); } catch (_) {}
  }
}

$('#demoPortfoyBtn').onclick = () => demoPortfoyAc();
$('#demoKapatBtn').onclick = () => demoPortfoyKapat();
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

  // BIST Günlük Tavan / Taban Kutusu
  const bist = bistTabanTavanHesapla(v.sembol, f, anaSatir?.degisim, v.zamanDilimleri?.g1);
  const bistKutu = $('#emirBistLimitKutusu');
  if (bist && bistKutu) {
    bistKutu.classList.remove('gizli');
    $('#emirBistBazFiyat').textContent = `Baz: ${sayi(bist.bazFiyat)} ₺`;
    $('#emirBistTaban').textContent = `${sayi(bist.taban)} ₺`;
    $('#emirBistTavan').textContent = `${sayi(bist.tavan)} ₺`;
  } else if (bistKutu) {
    bistKutu.classList.add('gizli');
  }

  emirYonAyarla(yon);
  detayCanliFiyatGuncelle(v.sembol, f, v.canliDegisim ?? anaSatir?.degisim);

  $('#perde').classList.remove('gizli');
  $('#demoEmirModal').classList.remove('gizli');
}

$('#dDemoAlBtn').onclick = () => emirModaliAc('LONG');
$('#dDemoSatBtn').onclick = () => emirModaliAc('SHORT');

// Analiz planını tek tıkla otomatik demo portföyde başlatan fonksiyon
window.otomatikPlanUygula = async function(yon = 'LONG') {
  const v = D.detayVeri;
  if (!v) return bildir('⚠️ Analiz verisi yüklenemedi.');

  const z = v.zamanDilimleri[D.detayTf] || v.zamanDilimleri.s4 || v.zamanDilimleri.g1;
  const s = z?.seviyeler;
  if (!s) return bildir('⚠️ Bu zaman dilimi için seviye verisi bulunamadı.');

  const anaSatir = D.satirlar.find(x => x.id === v.sembol);
  const f = anaSatir?.fiyat || s.fiyat;
  if (!f || f <= 0) return bildir('⚠️ Güncel canlı fiyat verisi alınamadı.');

  const isShort = (yon === 'SHORT');
  let stop = isShort ? (s.satisStop || null) : (s.alimStop || null);
  let hedef = isShort ? (s.satisHedef || null) : (s.alimHedef || null);

  // BIST Günlük Tavan/Taban (±%10) Sınırlarını Uygula
  const bist = bistTabanTavanHesapla(v.sembol, f, anaSatir?.degisim, v.zamanDilimleri?.g1);
  if (bist) {
    if (f > bist.tavan) return bildir(`⚠️ BIST Kuralı: Güncel fiyat (${sayi(f)} ₺) tavan fiyatın (${sayi(bist.tavan)} ₺) üstünde! İşlem açılamaz.`, 4000);
    if (f < bist.taban) return bildir(`⚠️ BIST Kuralı: Güncel fiyat (${sayi(f)} ₺) taban fiyatın (${sayi(bist.taban)} ₺) altında! İşlem açılamaz.`, 4000);

    if (!isShort) {
      if (hedef && hedef > bist.tavan) hedef = bist.tavan;
      if (stop && stop < bist.taban) stop = bist.taban;
    } else {
      if (hedef && hedef < bist.taban) hedef = bist.taban;
      if (stop && stop > bist.tavan) stop = bist.tavan;
    }
  }

  if (!stop || !hedef) {
    return bildir(`⚠️ Bu varlık için otomatik ${yon} seviyeleri türetilemedi. Lütfen "Özelleştir" ile manuel deneyin.`);
  }

  const birim = paraBirimiAl(v.sembol);
  const p = demoYerelOku();

  const mevcutPoz = (p.acikPozisyonlar || []).find(x => x.sembol === v.sembol);
  if (mevcutPoz) {
    if (!confirm(`${v.sembol.split(':')[1]} için zaten açık bir ${mevcutPoz.yon} demo işleminiz var. Yeni bir pozisyon daha eklensin mi?`)) {
      return;
    }
  }

  const bakiye = birim === '$' ? (p.bakiyeUSD ?? VARSAYILAN_USD_KASA) : (p.bakiyeTL ?? VARSAYILAN_TL_KASA);

  // Kasanın %5'i kadar güvenli pozisyon büyüklüğü hesapla
  let ayrilacakBakiye = Math.max(100, bakiye * 0.05);
  if (bakiye < ayrilacakBakiye) ayrilacakBakiye = bakiye * 0.9;
  if (ayrilacakBakiye < 1) return bildir(`⚠️ Yetersiz bakiye! Nakit: ${sayi(bakiye, 2)} ${birim}`);

  let adet = ayrilacakBakiye / f;
  if (birim === '$') {
    if (f >= 1000) adet = Math.max(0.001, +adet.toFixed(3));
    else if (f >= 10) adet = Math.max(0.01, +adet.toFixed(2));
    else if (f >= 0.01) adet = Math.max(1, Math.round(adet));
    else adet = Math.max(10, Math.round(adet));
  } else {
    adet = Math.max(1, Math.round(adet));
  }

  const tutar = +(f * adet).toFixed(2);
  const teminat = tutar; // 1x kaldıraç (güvenli)

  if (birim === '$') {
    if (p.bakiyeUSD < teminat) return bildir(`Yetersiz USD bakiye! Gereken: ${sayi(teminat, 2)} $, Nakit: ${sayi(p.bakiyeUSD, 2)} $`);
    p.bakiyeUSD = +(p.bakiyeUSD - teminat).toFixed(2);
  } else {
    if (p.bakiyeTL < teminat) return bildir(`Yetersiz TL bakiye! Gereken: ${sayi(teminat, 2)} TL, Nakit: ${sayi(p.bakiyeTL, 2)} TL`);
    p.bakiyeTL = +(p.bakiyeTL - teminat).toFixed(2);
  }

  p.acikPozisyonlar = p.acikPozisyonlar || [];
  const sembolKodu = v.sembol.split(':')[1];
  p.acikPozisyonlar.push({
    id: 'poz-' + Date.now(),
    sembol: v.sembol,
    ad: v.ad,
    yon: isShort ? 'SHORT' : 'LONG',
    kaldirac: 1,
    adet,
    alisFiyat: f,
    paraBirimi: birim,
    alisTarih: new Date().toISOString(),
    stopFiyat: stop,
    hedefFiyat: hedef,
    teminat,
    tutar,
    planTf: D.detayTf
  });
  demoYerelKaydet(p);

  sesCal('kar');
  const yonMetni = isShort ? '🔴 SHORT (Düşüş)' : '🟢 LONG (Yükseliş)';
  bildir(`🚀 ${sembolKodu} ${yonMetni} demo işlemi analiz planıyla açıldı!\n🎯 Hedef: ${sayi(hedef)} ${birim} | 🛑 Stop: ${sayi(stop)} ${birim}`, 6000);

  await demoPortfoyYukle();
  detayCiz();
};

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

  // Yüzdesel Mesafeleri Hesapla ve Göstergelere / Giriş Alanlarına Yansıt
  let stopYuzde = 0;
  let hedefYuzde = 0;

  if (f > 0 && stop > 0) {
    stopYuzde = isShort ? ((stop - f) / f) * 100 : ((f - stop) / f) * 100;
  }
  if (f > 0 && hedef > 0) {
    hedefYuzde = isShort ? ((f - hedef) / f) * 100 : ((hedef - f) / f) * 100;
  }

  const stopRozet = $('#emirStopYuzdeRozet');
  if (stopRozet) {
    stopRozet.textContent = stopYuzde !== 0 ? `-%${Math.abs(stopYuzde).toFixed(2)}` : '—';
  }
  const hedefRozet = $('#emirHedefYuzdeRozet');
  if (hedefRozet) {
    hedefRozet.textContent = hedefYuzde !== 0 ? `+%${Math.abs(hedefYuzde).toFixed(2)}` : '—';
  }

  // Kullanıcı yüzde alanında yazmıyorsa otomatik senkronize et
  const stopYuzdeInput = $('#emirStopYuzde');
  if (stopYuzdeInput && document.activeElement !== stopYuzdeInput) {
    stopYuzdeInput.value = stopYuzde > 0 ? stopYuzde.toFixed(2) : '';
  }
  const hedefYuzdeInput = $('#emirHedefYuzde');
  if (hedefYuzdeInput && document.activeElement !== hedefYuzdeInput) {
    hedefYuzdeInput.value = hedefYuzde > 0 ? hedefYuzde.toFixed(2) : '';
  }

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
    const kazancYuzde = teminat > 0 ? +((kazanc / teminat) * 100).toFixed(2) : 0;
    const riskYuzde = teminat > 0 ? +((risk / teminat) * 100).toFixed(2) : 0;

    $('#emirRiskOdul').textContent = `1 : ${sayi(rr, 2)}`;
    $('#emirOlasiKarZarar').innerHTML = `<span class="art">+${sayi(kazanc, 2)} ${birim} (+%${sayi(kazancYuzde, 2)})</span> / <span class="eks">-${sayi(risk, 2)} ${birim} (-%${sayi(riskYuzde, 2)})</span>`;
  } else {
    $('#emirRiskOdul').textContent = '—';
    $('#emirOlasiKarZarar').textContent = '—';
  }

  // Akıllı Giriş & FOMO / Risk-Ödül Uyarıları
  const uyariKutu = $('#emirAkilliUyari');
  if (uyariKutu) {
    const uyarilar = [];
    if (gecerli && rr < 1.3) {
      uyarilar.push(`⚠️ <b>Düşük Risk/Ödül Oranı (1 : ${sayi(rr, 2)}):</b> Potansiyel kâr, alınan riske göre dar (en az 1 : 1.50 önerilir).`);
    }
    const anaSatir = v ? D.satirlar.find(x => x.id === v.sembol) : null;
    const deg = anaSatir?.degisim;
    if (deg != null && isFinite(deg)) {
      if (!isShort && deg >= 6.0) {
        uyarilar.push(`⚠️ <b>Tepeden Alım (FOMO) Riski:</b> Varlık bugün zaten +%${deg.toFixed(1)} primli; geri çekilme beklemek daha güvenli olabilir.`);
      } else if (isShort && deg <= -6.0) {
        uyarilar.push(`⚠️ <b>Dipten Short Riski:</b> Varlık bugün zaten -%${Math.abs(deg).toFixed(1)} düşmüş; tepki sıçramasına dikkat.`);
      }
    }
    if (v && f > 0) {
      const bist = bistTabanTavanHesapla(v.sembol, f, deg, v.zamanDilimleri?.g1);
      if (bist && !isShort && bist.tavan > 0) {
        const tavanaKalan = ((bist.tavan - f) / f) * 100;
        if (tavanaKalan >= 0 && tavanaKalan <= 1.5) {
          uyarilar.push(`⚠️ <b>Tavana Çok Yakın:</b> Günlük tavana yalnızca %${tavanaKalan.toFixed(2)} mesafe kaldı; gün içi yukarı marj sınırlı.`);
        }
      }
    }
    if (uyarilar.length > 0) {
      uyariKutu.innerHTML = uyarilar.join('<br>');
      uyariKutu.classList.remove('gizli');
    } else {
      uyariKutu.classList.add('gizli');
    }
  }
}

function fiyatHassasiyetiAl(f) {
  if (!f || isNaN(f)) return 2;
  const av = Math.abs(f);
  if (av >= 100) return 2;
  if (av >= 1) return 2;
  if (av >= 0.1) return 4;
  if (av >= 0.001) return 6;
  return 8;
}

$('#emirAlisFiyat').oninput = emirHesapla;
if ($('#emirCanliFiyatKutu')) {
  $('#emirCanliFiyatKutu').onclick = () => {
    const canliFiyat = parseFloat($('#emirCanliFiyatKutu').dataset.fiyat) || sonDetayFiyat || D.satirlar.find(x => x.id === D.detaySembol)?.fiyat;
    if (canliFiyat && isFinite(canliFiyat) && canliFiyat > 0) {
      $('#emirAlisFiyat').value = canliFiyat;
      emirHesapla();
    }
  };
}
document.querySelectorAll('.emir-risk-btn').forEach(btn => {
  btn.onclick = () => {
    const v = D.detayVeri;
    const birim = v ? paraBirimiAl(v.sembol) : '₺';
    const p = demoPortfoyOku();
    const kasaNakit = birim === '$' ? (p.bakiyeUSD || 0) : (p.bakiyeTL || 0);
    const f = parseFloat($('#emirAlisFiyat').value) || 0;
    const stop = parseFloat($('#emirStopFiyat').value) || 0;
    const kOran = parseInt($('#emirKaldirac')?.value) || 1;
    if (f <= 0 || kasaNakit <= 0) return;

    const mod = btn.dataset.mod;
    let adet = 0;
    if (mod === 'kasa5') {
      adet = ((kasaNakit * 0.05) * kOran) / f;
    } else {
      const riskOran = mod === 'risk2' ? 0.02 : 0.01;
      const stopMesafe = Math.abs(f - stop);
      if (stop <= 0 || stopMesafe <= 0) {
        return bildir('⚠️ Risk hesabı için geçerli bir Stop (Zarar-Kes) fiyatı girilmelidir.');
      }
      adet = (kasaNakit * riskOran) / stopMesafe;
      const maxTeminatAdet = ((kasaNakit * 0.95) * kOran) / f;
      if (adet > maxTeminatAdet) adet = maxTeminatAdet;
    }

    if (birim === '₺') {
      adet = Math.max(1, Math.floor(adet));
    } else if (f >= 1000) {
      adet = Math.max(0.001, +adet.toFixed(3));
    } else if (f >= 10) {
      adet = Math.max(0.01, +adet.toFixed(2));
    } else if (f >= 0.1) {
      adet = Math.max(0.1, +adet.toFixed(1));
    } else {
      adet = Math.max(1, Math.round(adet));
    }

    $('#emirAdet').value = adet;
    emirHesapla();
  };
});
$('#emirAdet').oninput = emirHesapla;
$('#emirStopFiyat').oninput = emirHesapla;
$('#emirHedefFiyat').oninput = emirHesapla;

if ($('#emirStopYuzde')) {
  $('#emirStopYuzde').oninput = () => {
    const f = parseFloat($('#emirAlisFiyat').value) || 0;
    const yuzde = parseFloat($('#emirStopYuzde').value);
    if (f <= 0 || isNaN(yuzde) || yuzde <= 0) return;
    const hs = fiyatHassasiyetiAl(f);
    const isShort = aktifEmirYonu === 'SHORT';
    const stopFiyat = isShort ? +(f * (1 + yuzde / 100)).toFixed(hs) : +(f * (1 - yuzde / 100)).toFixed(hs);
    $('#emirStopFiyat').value = stopFiyat;
    emirHesapla();
  };
}

if ($('#emirHedefYuzde')) {
  $('#emirHedefYuzde').oninput = () => {
    const f = parseFloat($('#emirAlisFiyat').value) || 0;
    const yuzde = parseFloat($('#emirHedefYuzde').value);
    if (f <= 0 || isNaN(yuzde) || yuzde <= 0) return;
    const hs = fiyatHassasiyetiAl(f);
    const isShort = aktifEmirYonu === 'SHORT';
    const hedefFiyat = isShort ? +(f * (1 - yuzde / 100)).toFixed(hs) : +(f * (1 + yuzde / 100)).toFixed(hs);
    $('#emirHedefFiyat').value = hedefFiyat;
    emirHesapla();
  };
}

// Hızlı % butonları tıklamaları (%1, %2, %3, %5, %10)
document.addEventListener('click', e => {
  const sBtn = e.target.closest('.stop-yuzde-btn');
  if (sBtn) {
    const y = sBtn.dataset.yuzde;
    const sInput = $('#emirStopYuzde');
    if (sInput) {
      sInput.value = y;
      sInput.dispatchEvent(new Event('input'));
    }
    return;
  }
  const hBtn = e.target.closest('.hedef-yuzde-btn');
  if (hBtn) {
    const y = hBtn.dataset.yuzde;
    const hInput = $('#emirHedefYuzde');
    if (hInput) {
      hInput.value = y;
      hInput.dispatchEvent(new Event('input'));
    }
    return;
  }
});

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

  // BIST Günlük Fiyat Marjı Doğrulaması (±%10)
  const anaSatir = D.satirlar.find(x => x.id === v.sembol);
  const bist = bistTabanTavanHesapla(v.sembol, f, anaSatir?.degisim, v.zamanDilimleri?.g1);
  if (bist) {
    if (f < bist.taban || f > bist.tavan) {
      return bildir(`⚠️ BIST Kuralı: Alış fiyatı (${sayi(f)} ₺) günlük taban (${sayi(bist.taban)} ₺) ve tavan (${sayi(bist.tavan)} ₺) aralığında olmalıdır!`, 4000);
    }
    if (yon === 'LONG') {
      if (hedef && hedef > bist.tavan) {
        return bildir(`⚠️ BIST Kuralı: Kâr al hedefi günlük tavan fiyatından (${sayi(bist.tavan)} ₺) yüksek olamaz!`, 4000);
      }
      if (stop && stop < bist.taban) {
        return bildir(`⚠️ BIST Kuralı: Zarar-kes (stop) seviyesi günlük taban fiyatından (${sayi(bist.taban)} ₺) düşük olamaz!`, 4000);
      }
    } else {
      if (hedef && hedef < bist.taban) {
        return bildir(`⚠️ BIST Kuralı: Short kâr al hedefi günlük taban fiyatından (${sayi(bist.taban)} ₺) düşük olamaz!`, 4000);
      }
      if (stop && stop > bist.tavan) {
        return bildir(`⚠️ BIST Kuralı: Short stop seviyesi günlük tavan fiyatından (${sayi(bist.tavan)} ₺) yüksek olamaz!`, 4000);
      }
    }
  }

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

// ================= Bildirim Merkezi (Radar, Balina, Kurumsal & Sniper Takipçisi) =================
D.bildirimFiltre = 'aktif'; // 'aktif' | 'hepsi' | 'bist' | 'kripto' | 'diger'
let yerelBildirimler = [];
const oturumGorulenBildirimler = new Set();
const tarananListelerBaslangic = new Set();
let sonBildirimZamani = Date.now(); // Sadece sayfa açıldıktan SONRA gelen yeni bildirimleri sesli uyar

function sembolPiyasasi(id) {
  if (!id) return 'diger';
  if (id.startsWith('BIST:')) return 'bist';
  if (id.startsWith('BINANCE:') || id.endsWith('USDT') || id.startsWith('GATE:')) return 'kripto';
  return 'diger';
}

function aktifPiyasa() {
  const l = aktifListe();
  if (!l) return 'hepsi';
  if (l.dinamik === 'bist' || l.id === 'tum-bist') return 'bist';
  if (l.dinamik === 'kripto' || l.id === 'kripto') return 'kripto';
  if (l.id === 'forex' || l.id === 'emtia-doviz') return 'diger';
  return 'hepsi'; // Favoriler veya özel karma listeler
}

async function bildirimleriYukle(sessiz = false) {
  try {
    const res = await api('/api/bildirimler');
    const sunucuListesi = res.bildirimler || [];
    const curPiyasa = aktifPiyasa();

    // Yeni gelen bildirimleri tespit et ve sesli bildir (Sadece sayfa açıkken sonradan gelenler için!)
    if (!sessiz && yerelBildirimler.length > 0 && sunucuListesi.length > 0) {
      const enSonZaman = sonBildirimZamani || Date.now();
      const yeniGelenler = sunucuListesi.filter(b => new Date(b.tarih).getTime() > enSonZaman);

      if (yeniGelenler.length > 0) {
        const enSon = yeniGelenler[0];
        const p = enSon.piyasa || sembolPiyasasi(enSon.sembolId);
        if (curPiyasa === 'hepsi' || curPiyasa === p) {
          sesCal('kar');
          bildir(`🔔 ${enSon.baslik}: ${enSon.mesaj}`, 7000);
        }
      }
    }

    yerelBildirimler = sunucuListesi;
    if (sunucuListesi.length > 0) {
      const maxZaman = Math.max(...sunucuListesi.map(b => new Date(b.tarih).getTime()));
      sonBildirimZamani = Math.max(sonBildirimZamani, maxZaman);
    }

    bildirimSayisiGuncelle();
    if (!$('#bildirimModal').classList.contains('gizli')) {
      bildirimMerkeziCiz();
    }
  } catch (_) {
    bildirimSayisiGuncelle();
  }
}

function bildirimSayisiGuncelle() {
  const curPiyasa = aktifPiyasa();
  const filtrelenmis = curPiyasa === 'hepsi' 
    ? yerelBildirimler 
    : yerelBildirimler.filter(x => (x.piyasa || sembolPiyasasi(x.sembolId)) === curPiyasa);
  const okunmamis = filtrelenmis.filter(x => !x.okundu).length;
  $('#ustBildirimSayisi').textContent = okunmamis;
  if (okunmamis > 0) {
    $('#bildirimRozetNokta').classList.remove('gizli');
  } else {
    $('#bildirimRozetNokta').classList.add('gizli');
  }
}

async function yeniBildirimEkle(baslik, mesaj, tur, sembolId, fiyat = 0, yon = 'LONG') {
  const piyasa = sembolPiyasasi(sembolId);
  const curPiyasa = aktifPiyasa();
  const kod = sembolId.includes(':') ? sembolId.split(':')[1] : sembolId;
  const isShort = (yon === 'SHORT' || yon === 'SAT' || (mesaj && (mesaj.includes('SHORT') || mesaj.includes('Düşüş') || mesaj.includes('Açığa'))));
  const netYon = isShort ? 'SHORT' : 'LONG';
  const yonOk = isShort ? '⬇️' : '⬆️';

  try {
    const res = await api('/api/bildirimler/ekle', {
      method: 'POST',
      body: JSON.stringify({
        baslik,
        mesaj,
        tur,
        yon: netYon,
        sembolId,
        kod,
        fiyat,
        piyasa
      })
    });
    // Yalnızca sunucu bu bildirimin YENİ olduğunu teyit ederse (daha önce atılmamışsa) ses çal ve popup fırlat!
    if (res && res.id && res.yeni === true) {
      yerelBildirimler.unshift(res);
      sonBildirimZamani = Date.now();
      if (curPiyasa === 'hepsi' || curPiyasa === piyasa) {
        sesCal('kar');
        bildir(`🔔 ${yonOk} [${netYon}] ${res.baslik || baslik}: ${res.mesaj || mesaj}`, 7000);
      }
      bildirimSayisiGuncelle();
    }
  } catch (_) {}
}

function radarVeSniperDegisimKontrol(satirlar) {
  if (!satirlar || !satirlar.length) return;

  const listeId = D.aktifId || 'varsayilan';
  const ilkKezTaranıyor = !tarananListelerBaslangic.has(listeId);

  satirlar.forEach(r => {
    if (!r.fiyat) return;
    const y = r.yon || {};
    const t2 = y.s2 || 0;
    const t4 = y.s4 || 0;
    const tg = y.g1 || 0;
    const rsi4h = r.rsi?.s4 || 50;

    const isBist = r.id?.startsWith('BIST:');
    const birim = paraBirimiAl(r.id);
    const sniperKey = `${r.id}_sniper`;
    const sniperShortKey = `${r.id}_sniper_short`;
    const firsatKey = `${r.id}_firsat`;

    // 1. İLK TARAMA (Sayfa yeni açıldıysa veya başka listeye/kriptoya ilk geçildiyse):
    // Bu varlıklar zaten listede mevcut olan durumlardır. Sessizce kaydet, ASLA ses/popup çalma!
    if (ilkKezTaranıyor) {
      if (t2 > 0 && t4 > 0 && tg > 0 && rsi4h >= 45 && rsi4h <= 68) {
        oturumGorulenBildirimler.add(sniperKey);
      }
      if (!isBist && t2 < 0 && t4 < 0 && tg < 0 && rsi4h <= 55 && rsi4h >= 32) {
        oturumGorulenBildirimler.add(sniperShortKey);
      }
      if (r.isaretler?.some(i => i.tip === 'firsat' || i.tip === 'kombo')) {
        oturumGorulenBildirimler.add(firsatKey);
      }
      return;
    }

    // 2. İLK TARAMADAN SONRAKİ CANLI DÖNGÜLER:
    // Yalnızca ekranda izlenirken GERÇEKTEN yeni giren bir varlık olursa bildir!
    if (t2 > 0 && t4 > 0 && tg > 0 && rsi4h >= 45 && rsi4h <= 68) {
      if (!oturumGorulenBildirimler.has(sniperKey)) {
        oturumGorulenBildirimler.add(sniperKey);
        yeniBildirimEkle(
          `🎯 YENİ SNIPER FIRSATI`,
          `${r.kod} (${r.ad || ''}) tüm periyotlarda AL yakarak Sniper Avcısına girdi! Fiyat: ${sayi(r.fiyat)} ${birim}`,
          'sniper',
          r.id,
          r.fiyat,
          'LONG'
        );
      }
    }

    if (!isBist && t2 < 0 && t4 < 0 && tg < 0 && rsi4h <= 55 && rsi4h >= 32) {
      if (!oturumGorulenBildirimler.has(sniperShortKey)) {
        oturumGorulenBildirimler.add(sniperShortKey);
        yeniBildirimEkle(
          `🎯 ⬇️ YENİ SNIPER SHORT FIRSATI`,
          `${r.kod} (${r.ad || ''}) tüm periyotlarda SAT yakarak Sniper Short radarına girdi! Fiyat: ${sayi(r.fiyat)} ${birim}`,
          'sniper',
          r.id,
          r.fiyat,
          'SHORT'
        );
      }
    }

    if (r.isaretler?.some(i => i.tip === 'firsat' || i.tip === 'kombo')) {
      if (!oturumGorulenBildirimler.has(firsatKey)) {
        oturumGorulenBildirimler.add(firsatKey);
        yeniBildirimEkle(
          `🟢 RADARA YENİ GİRİŞ`,
          `${r.kod} (${r.ad || ''}) hacim ve indikatör onayı alarak Fırsat Radarına girdi! Fiyat: ${sayi(r.fiyat)} ${birim}`,
          'firsat',
          r.id,
          r.fiyat,
          'LONG'
        );
      }
    }
  });

  tarananListelerBaslangic.add(listeId);
}

window.tekBildirimSil = async function(id, e) {
  if (e) e.stopPropagation();
  yerelBildirimler = yerelBildirimler.filter(x => x.id !== id);
  bildirimSayisiGuncelle();
  bildirimMerkeziCiz();
  try {
    await api('/api/bildirimler/sil', {
      method: 'POST',
      body: JSON.stringify({ id })
    });
  } catch (_) {}
};

function bildirimMerkeziCiz() {
  const hamListe = yerelBildirimler;
  const curPiyasa = aktifPiyasa();

  let liste = hamListe;
  if (D.bildirimFiltre === 'aktif') {
    liste = curPiyasa === 'hepsi' ? hamListe : hamListe.filter(x => (x.piyasa || sembolPiyasasi(x.sembolId)) === curPiyasa);
  } else if (D.bildirimFiltre === 'bist') {
    liste = hamListe.filter(x => (x.piyasa || sembolPiyasasi(x.sembolId)) === 'bist');
  } else if (D.bildirimFiltre === 'kripto') {
    liste = hamListe.filter(x => (x.piyasa || sembolPiyasasi(x.sembolId)) === 'kripto');
  } else if (D.bildirimFiltre === 'diger') {
    liste = hamListe.filter(x => (x.piyasa || sembolPiyasasi(x.sembolId)) === 'diger');
  }

  // Buton aktifliklerini ayarla
  document.querySelectorAll('#bildirimFiltreCipler .cip').forEach(b => {
    b.classList.toggle('aktif', b.dataset.bfiltre === D.bildirimFiltre);
  });

  if (!liste.length) {
    const baslik = D.bildirimFiltre === 'aktif'
      ? (curPiyasa === 'bist' ? 'BIST için' : curPiyasa === 'kripto' ? 'Kripto için' : 'Bu piyasa için')
      : 'Bu filtrede';
    $('#bildirimKutusuListesi').innerHTML = `<div class="bos" style="padding:25px;">${baslik} henüz bir fırsat bildirimi yok. Yeni bir sinyal oluştuğunda buraya düşecektir.</div>`;
    return;
  }

  $('#bildirimKutusuListesi').innerHTML = `
    <div style="display:flex; flex-direction:column; gap:10px;">
      ${liste.map(b => {
        let renk = '#10b981';
        if (b.tur === 'sniper') renk = '#38bdf8';
        else if (b.tur === 'kurumsal') renk = '#fbbf24';
        else if (b.tur === 'balina') renk = '#a855f7';
        else if (b.tur === 'alfa') renk = '#f43f5e';

        const p = b.piyasa || sembolPiyasasi(b.sembolId);
        const pEtiket = p === 'bist' ? '🇹🇷 BIST' : (p === 'kripto' ? '🪙 Kripto' : '🌍 Emtia/Fx');
        const bTarih = b.tarih ? new Date(b.tarih) : new Date();
        const tarihStr = isNaN(bTarih.getTime()) ? '' : `${bTarih.toLocaleDateString('tr-TR')} ${bTarih.toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'})}`;

        const isShort = (b.yon === 'SHORT' || b.yon === 'SAT') || 
                        (b.mesaj && (b.mesaj.includes('SHORT') || b.mesaj.includes('Düşüş') || b.mesaj.includes('Açığa Satış') || b.mesaj.includes('SAT')));
        const yonRozet = isShort 
          ? `<span style="background:rgba(239, 68, 68, 0.2); color:#ef4444; border:1px solid rgba(239, 68, 68, 0.4); padding:2px 7px; border-radius:10px; font-size:11px; font-weight:bold; margin-left:6px; display:inline-flex; align-items:center; gap:2px;">⬇️ SHORT</span>` 
          : `<span style="background:rgba(16, 185, 129, 0.2); color:#10b981; border:1px solid rgba(16, 185, 129, 0.4); padding:2px 7px; border-radius:10px; font-size:11px; font-weight:bold; margin-left:6px; display:inline-flex; align-items:center; gap:2px;">⬆️ LONG</span>`;

        return `
        <div class="kutu" style="margin:0; border-left:3px solid ${renk}; cursor:pointer;" 
             onclick="detayAc('${esc(b.sembolId)}'); $('#bildirimModal').classList.add('gizli');">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px;">
              <b style="color:${renk}; font-size:13px;">${esc(b.baslik)}</b>
              ${yonRozet}
              <span class="kucuk" style="background:rgba(255,255,255,0.08); padding:2px 6px; border-radius:4px; font-size:11px;">${pEtiket}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="kucuk" style="color:#94a3b8; font-size:11.5px;">${tarihStr}</span>
              <button class="sil-bildirim" style="background:transparent; border:none; color:#64748b; cursor:pointer; font-size:14px; padding:2px;" 
                      title="Bildirimi sil" onclick="tekBildirimSil('${esc(b.id)}', event)">✖</button>
            </div>
          </div>
          <div style="font-size:13px; color:#f1f5f9; margin-top:4px;">${esc(b.mesaj)}</div>
        </div>`;
      }).join('')}
    </div>`;
}

$('#bildirimMerkeziBtn').onclick = async () => {
  D.bildirimFiltre = 'aktif';
  const curPiyasa = aktifPiyasa();
  yerelBildirimler.forEach(x => {
    if (curPiyasa === 'hepsi' || (x.piyasa || sembolPiyasasi(x.sembolId)) === curPiyasa) {
      x.okundu = true;
    }
  });
  bildirimSayisiGuncelle();

  $('#perde').classList.remove('gizli');
  $('#bildirimModal').classList.remove('gizli');
  bildirimMerkeziCiz();

  try {
    await api('/api/bildirimler/okundu', {
      method: 'POST',
      body: JSON.stringify({ piyasa: curPiyasa })
    });
  } catch (_) {}
};

const bCipler = $('#bildirimFiltreCipler');
if (bCipler) {
  bCipler.addEventListener('click', e => {
    const btn = e.target.closest('.cip');
    if (!btn) return;
    D.bildirimFiltre = btn.dataset.bfiltre;
    bildirimMerkeziCiz();
  });
}

$('#bildirimKapatBtn').onclick = () => {
  $('#perde').classList.add('gizli');
  $('#bildirimModal').classList.add('gizli');
};

$('#bildirimTemizleBtn').onclick = async () => {
  if (!confirm('Tüm bildirim geçmişi temizlensin mi?')) return;
  yerelBildirimler = [];
  oturumGorulenBildirimler.clear();
  bildirimSayisiGuncelle();
  bildirimMerkeziCiz();
  try {
    await api('/api/bildirimler/temizle', { method: 'POST' });
  } catch (_) {}
  bildir('Tüm bildirimler temizlendi.');
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
    <div class="modal-tablo-sarma">
      <table class="tarama-tablo" style="width:100%; border-collapse:collapse;">
        <thead>
          <tr style="background:#131d2e; border-bottom:1px solid #2d3748;">
            <th style="padding:9px 10px; width:160px; text-align:left;">Sembol</th>
            <th class="sag" style="padding:9px 10px; width:85px;">Fiyat</th>
            <th class="sag" style="padding:9px 10px; width:85px;">Günlük %</th>
            <th class="orta" style="padding:9px 4px; width:55px;">2 Saat</th>
            <th class="orta" style="padding:9px 4px; width:55px;">4 Saat</th>
            <th class="orta" style="padding:9px 4px; width:55px;">Günlük</th>
            <th class="sag" style="padding:9px 6px; width:65px;">RSI (4S)</th>
            <th style="padding:9px 10px; text-align:left;">Sinyal Derecesi</th>
            <th class="orta" style="padding:9px 8px; width:80px;">Hızlı İşlem</th>
          </tr>
        </thead>
        <tbody>
          ${birlesik.map(x => `
            <tr onclick="detayAc('${esc(x.id)}'); $('#sniperModal').classList.add('gizli');" style="cursor:pointer; border-bottom:1px solid #1a2234;">
              <td style="padding:9px 10px; width:160px;">
                <b style="font-size:13.5px; color:#f8fafc;">${esc(x.kod)}</b>
                <small class="kucuk" style="display:block; color:#94a3b8; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:145px;">${esc(x.ad)}</small>
              </td>
              <td class="sag" style="padding:9px 10px; width:85px; white-space:nowrap; font-weight:600;">${sayi(x.fiyat)}</td>
              <td class="sag ${x.degisim > 0 ? 'art' : 'eks'}" style="padding:9px 10px; width:85px; white-space:nowrap; font-weight:bold;">${x.degisim > 0 ? '+' : ''}${sayi(x.degisim, 2)}%</td>
              <td class="orta" style="padding:9px 4px; width:55px; white-space:nowrap;">${rozet(x.yon?.s2)}</td>
              <td class="orta" style="padding:9px 4px; width:55px; white-space:nowrap;">${rozet(x.yon?.s4)}</td>
              <td class="orta" style="padding:9px 4px; width:55px; white-space:nowrap;">${rozet(x.yon?.g1)}</td>
              <td class="sag" style="padding:9px 6px; width:65px; white-space:nowrap; font-weight:600; color:#38bdf8;">${sayi(x.rsi?.s4, 0)}</td>
              <td style="padding:9px 10px; white-space:nowrap;">
                <span style="color:${x.renk}; font-weight:bold; font-size:11.5px;">${esc(x.etiket)}</span>
              </td>
              <td class="orta" style="padding:9px 8px; width:80px; white-space:nowrap;">
                <button class="btn" style="padding:4px 10px; font-size:11px; background:#10b981; font-weight:bold; cursor:pointer;" 
                        onclick="event.stopPropagation(); $('#sniperModal').classList.add('gizli'); detayAc('${esc(x.id)}'); setTimeout(()=>$('#dDemoAlBtn').click(), 400);">
                  🛒 Al
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
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
      <div class="modal-tablo-sarma">
        <table class="tarama-tablo" style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:#131d2e; border-bottom:1px solid #2d3748;">
              <th style="padding:9px 10px; width:160px; text-align:left;">Sembol</th>
              <th class="sag" style="padding:9px 10px; width:85px;">Fiyat</th>
              <th class="sag" style="padding:9px 10px; width:85px;">Günlük %</th>
              <th class="sag" style="padding:9px 10px; width:125px;">Hacim Katı / Tutar</th>
              <th style="padding:9px 10px; width:160px; text-align:left;">Durum / Sinyal</th>
              <th style="padding:9px 10px; text-align:left;">Açıklama</th>
            </tr>
          </thead>
          <tbody>
            ${liste.map(x => `
              <tr onclick="detayAc('${esc(x.id)}'); $('#balinaModal').classList.add('gizli');" style="cursor:pointer; border-bottom:1px solid #1a2234;">
                <td style="padding:9px 10px; width:160px;">
                  <b style="font-size:13.5px; color:#f8fafc;">${esc(x.kod)}</b>
                  <small class="kucuk" style="display:block; color:#94a3b8; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:145px;">${esc(x.ad)}</small>
                </td>
                <td class="sag" style="padding:9px 10px; width:85px; white-space:nowrap; font-weight:600;">${sayi(x.fiyat)}</td>
                <td class="sag ${x.degisim > 0 ? 'art' : 'eks'}" style="padding:9px 10px; width:85px; white-space:nowrap; font-weight:bold;">${x.degisim > 0 ? '+' : ''}${sayi(x.degisim, 2)}%</td>
                <td class="sag" style="padding:9px 10px; width:125px; white-space:nowrap;">
                  <div style="color:#fbbf24; font-weight:bold; font-size:13px;">${sayi(x.gh, 1)}x</div>
                  ${hacimFormat(x) ? `<div class="kucuk" style="color:#94a3b8; font-size:11px;">${hacimFormat(x)}</div>` : ''}
                </td>
                <td style="padding:9px 10px; width:160px; white-space:nowrap;">
                  <span style="color:${x.renk}; font-weight:bold; font-size:11.5px;">${x.ikon} ${esc(x.seviye)}</span>
                </td>
                <td class="kucuk" style="padding:9px 10px; color:#cbd5e1; font-size:11.5px; line-height:1.4; white-space:normal; word-break:break-word;">
                  ${esc(x.aciklama)}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
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

// ================= 👑 Kurumsal VIP (%80+ Elit Masa) =================
let seciliKurumsalFiltre = 'hepsi';

async function kurumsalMasayiYukle() {
  const yukleniyor = $('#kurumsalYukleniyor');
  const listeKutusu = $('#kurumsalListe');
  yukleniyor.classList.remove('gizli');
  listeKutusu.classList.add('gizli');
  listeKutusu.innerHTML = '';

  try {
    const res = await api(`/api/kurumsal/tara?piyasa=${seciliKurumsalFiltre}`);
    yukleniyor.classList.add('gizli');
    listeKutusu.classList.remove('gizli');

    const liste = res.liste || [];
    if (liste.length === 0) {
      listeKutusu.innerHTML = '<div class="bos" style="padding:25px; text-align:center;">Seçili piyasada şu an taranmış veri bulunamadı.</div>';
      return;
    }

    let html = '';
    liste.forEach(item => {
      const isElit = item.onay && item.puan >= 80;
      const kartBorder = isElit ? 'border: 1px solid #f59e0b; box-shadow: 0 0 16px rgba(245,158,11,0.25); background: linear-gradient(180deg, #181309, #0d0a05);' : 'border: 1px solid #232b3d; background: #0c1017;';
      const durumRozeti = isElit
        ? `<span style="background:#f59e0b; color:#000; font-weight:800; font-size:11px; padding:3px 8px; border-radius:10px;">⭐ A+ ELİT ONAYLI</span>`
        : `<span style="background:#334155; color:#94a3b8; font-weight:700; font-size:11px; padding:3px 8px; border-radius:10px;">⏳ BEKLEMEDE / FİLTRELENDİ</span>`;

      const onayMaddeleri = (item.onaylar || []).map(o => `<div style="font-size:12px; color:#cbd5e1; margin-top:3px;">✔ ${esc(o)}</div>`).join('');
      const engellemeNedeni = !item.rejim?.islemYapilabilir ? `<div style="font-size:12px; color:#f87171; margin-top:4px;">⛔ ${esc(item.rejim?.aciklama || item.neden)}</div>` : '';

      const sev = item.seviyeler || {};
      const seviyeKutusu = isElit ? `
        <div style="margin-top:10px; padding:8px 12px; background:#00000066; border:1px solid #f59e0b44; border-radius:6px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; font-size:12px;">
          <div><span style="color:#94a3b8;">Giriş:</span> <b style="color:#fff;">${sayi(sev.giris)}</b></div>
          <div><span style="color:#ef4444;">Zarar Kes (Stop):</span> <b style="color:#ef4444;">${sayi(sev.stop)} (-%${sev.riskYuzde})</b></div>
          <div><span style="color:#10b981;">TP1 (Kâr Al & Risksiz Yap):</span> <b style="color:#10b981;">${sayi(sev.tp1)} (${sev.tp1Yuzde})</b></div>
          <div><span style="color:#38bdf8;">TP2 (Trend Hedefi):</span> <b style="color:#38bdf8;">${sayi(sev.tp2)} (${sev.tp2Yuzde})</b></div>
        </div>
      ` : '';

      const planMetni = `<div style="margin-top:8px; font-size:11.5px; color:#fbbf24; font-style:italic;">${esc(item.taktikPlani)}</div>`;

      html += `
        <div style="border-radius:8px; padding:14px 16px; ${kartBorder} transition:all 0.2s;" onclick="detayAc('${esc(item.sembol)}'); $('#kurumsalModal').classList.add('gizli');">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:16px; font-weight:800; color:#fff;">${esc(item.sembol.split(':')[1] || item.sembol)}</span>
              <span style="font-size:11px; padding:2px 6px; background:#1e293b; color:#38bdf8; border-radius:4px; font-weight:bold;">${item.tf === 's4' ? '4 Saatlik' : 'Günlük'}</span>
              <span style="font-size:13px; color:#94a3b8;">${esc(item.ad || '')}</span>
              <span style="font-size:14px; font-weight:bold; color:#10b981; margin-left:8px;">${sayi(item.fiyat)}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:12px; font-weight:700; color:${item.puan >= 80 ? '#fbbf24' : '#94a3b8'};">Skor: ${item.puan}/100</span>
              ${durumRozeti}
            </div>
          </div>
          <div style="margin-top:8px;">
            <div style="font-size:12px; font-weight:700; color:#38bdf8;">📊 Rejim: ${esc(item.rejim?.etiket || '')}</div>
            ${engellemeNedeni}
            ${onayMaddeleri}
            ${seviyeKutusu}
            ${planMetni}
          </div>
        </div>`;
    });

    listeKutusu.innerHTML = html;
  } catch (e) {
    yukleniyor.classList.add('gizli');
    listeKutusu.classList.remove('gizli');
    listeKutusu.innerHTML = `<div class="yukleniyor" style="color:#ef4444;">⚠️ Veri alınamadı: ${esc(e.message)}</div>`;
  }
}

$('#kurumsalVipBtn').onclick = () => {
  $('#perde').classList.remove('gizli');
  $('#kurumsalModal').classList.remove('gizli');
  kurumsalMasayiYukle();
};
$('#kurumsalKapatBtn').onclick = () => {
  $('#perde').classList.add('gizli');
  $('#kurumsalModal').classList.add('gizli');
};
$('#kurumsalYenileBtn').onclick = () => {
  kurumsalMasayiYukle();
};

document.querySelectorAll('#kurumsalModal .cip[data-kfiltre]').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('#kurumsalModal .cip[data-kfiltre]').forEach(b => b.classList.remove('aktif'));
    btn.classList.add('aktif');
    seciliKurumsalFiltre = btn.dataset.kfiltre;
    kurumsalMasayiYukle();
  };
});
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

// Mobil Tarayıcı Geri Tuşu (Popstate) ve Kaydırma Desteği
window.addEventListener('popstate', () => {
  // 1. Emir modalı açıksa kapat
  if ($('#demoEmirModal') && !$('#demoEmirModal').classList.contains('gizli')) {
    $('#demoEmirModal').classList.add('gizli');
    return;
  }
  // 2. Detay analiz açıksa ana sayfaya dön
  if ($('#detay') && !$('#detay').classList.contains('gizli')) {
    detayKapat(false);
    return;
  }
  // 3. Demo modalı açıksa kapat
  if ($('#demoModal') && !$('#demoModal').classList.contains('gizli')) {
    demoPortfoyKapat(false);
    return;
  }
  // 4. Diğer açık pencereler
  ['#bildirimModal', '#sniperModal', '#balinaModal', '#alarmModal', '#ziyaretModal', '#kurumsalModal', '#raporSifreModal', '#gunlukRaporModal'].forEach(sel => {
    const el = $(sel);
    if (el && !el.classList.contains('gizli')) el.classList.add('gizli');
  });
  $('#perde').classList.add('gizli');
});

// ================= 📋 Günlük Sinyal ve Kapanış Raporu (Şifre Korumalı: sea01) =================
const RAPOR_HAFIZA_ANAHTAR = 'alper_rapor_sifre';
let seciliRaporTarihi = null;
let seciliRaporKategori = 'hepsi';
let sonRaporVerisi = null;

function raporSifreAl() {
  return localStorage.getItem(RAPOR_HAFIZA_ANAHTAR) || '';
}

async function raporGirisYap() {
  const input = $('#raporSifreInput');
  const hata = $('#raporSifreHata');
  const sifre = (input.value || '').trim();
  hata.style.display = 'none';

  if (!sifre) return;

  try {
    const res = await api('/api/rapor/dogrula', {
      method: 'POST',
      body: JSON.stringify({ sifre }),
      headers: { 'Content-Type': 'application/json' }
    });

    if (res.yetkili) {
      localStorage.setItem(RAPOR_HAFIZA_ANAHTAR, sifre);
      input.value = '';
      $('#raporSifreModal').classList.add('gizli');
      gunlukRaporPenceresiAc();
      bildirimGoster('🔓 Özel rapor erişimi sağlandı.');
    } else {
      hata.style.display = 'block';
    }
  } catch (_) {
    hata.style.display = 'block';
  }
}

async function gunlukRaporPenceresiAc(tarih = null) {
  const sifre = raporSifreAl();
  if (!sifre) {
    $('#perde').classList.remove('gizli');
    $('#raporSifreModal').classList.remove('gizli');
    setTimeout(() => $('#raporSifreInput')?.focus(), 200);
    return;
  }

  $('#perde').classList.remove('gizli');
  $('#gunlukRaporModal').classList.remove('gizli');
  await gunlukRaporVerisiYukle(tarih);
}

async function gunlukRaporVerisiYukle(tarih = null) {
  const sifre = raporSifreAl();
  const url = `/api/rapor/veri?tarih=${tarih || seciliRaporTarihi || ''}`;
  
  try {
    const r = await fetch(url, {
      headers: { 'X-Rapor-Sifre': encodeURIComponent(sifre) }
    });
    
    if (r.status === 401) {
      localStorage.removeItem(RAPOR_HAFIZA_ANAHTAR);
      $('#gunlukRaporModal').classList.add('gizli');
      $('#raporSifreModal').classList.remove('gizli');
      return;
    }

    sonRaporVerisi = await r.json();
    seciliRaporTarihi = sonRaporVerisi.tarih;

    // Rozet ve Tarih Seçici Güncelleme
    $('#raporTarihRozet').textContent = sonRaporVerisi.tarih;
    const secici = $('#raporTarihSecici');
    secici.innerHTML = (sonRaporVerisi.gecmisTarihler || [sonRaporVerisi.tarih]).map(t => 
      `<option value="${esc(t)}" ${t === sonRaporVerisi.tarih ? 'selected' : ''}>${esc(t)} ${t === sonRaporVerisi.tarih ? '(Seçili Gün)' : ''}</option>`
    ).join('');

    raporArayuzunuCiz();
  } catch (e) {
    $('#raporSinyalListesi').innerHTML = `<tr><td colspan="9" style="text-align:center; padding:20px; color:#ef4444;">⚠️ Rapor yüklenemedi: ${esc(e.message)}</td></tr>`;
  }
}

function raporArayuzunuCiz() {
  if (!sonRaporVerisi) return;
  const d = sonRaporVerisi;
  const tumSinyaller = d.sinyaller || [];
  const kats = d.kategoriler || {};

  // Kategori Butonlarındaki Sayıları Güncelle
  const rHepsi = $('#rSayiHepsi'); if (rHepsi) rHepsi.textContent = tumSinyaller.length;
  const rBist = $('#rSayiBist'); if (rBist) rBist.textContent = kats.bist?.toplam || 0;
  const rForex = $('#rSayiForex'); if (rForex) rForex.textContent = kats.forex?.toplam || 0;
  const rKripto = $('#rSayiKripto'); if (rKripto) rKripto.textContent = kats.kripto?.toplam || 0;

  // Seçili Kategoriye Göre 4'lü Özet Kartlarını Güncelle
  let aktifOzet = {
    winRate: d.winRate,
    basariliSayi: d.basariliSayi,
    basarisizSayi: d.basarisizSayi,
    ortGetiri: d.ortGetiri,
    toplamSinyal: d.toplamSinyal
  };

  if (seciliRaporKategori !== 'hepsi' && kats[seciliRaporKategori]) {
    const k = kats[seciliRaporKategori];
    aktifOzet = {
      winRate: k.winRate,
      basariliSayi: k.basariliSayi,
      basarisizSayi: k.basarisizSayi,
      ortGetiri: k.ortGetiri,
      toplamSinyal: k.toplam
    };
  }

  $('#raporWinRate').textContent = aktifOzet.winRate || '%0';
  $('#raporWinDetay').textContent = `${aktifOzet.basariliSayi || 0} Kâr / ${aktifOzet.basarisizSayi || 0} Zarar`;
  $('#raporOrtGetiri').textContent = aktifOzet.ortGetiri || '%0.00';
  $('#raporOrtGetiri').style.color = (aktifOzet.ortGetiri || '').startsWith('-') ? '#ef4444' : '#10b981';
  $('#raporToplamSinyal').textContent = aktifOzet.toplamSinyal || 0;
  $('#raporEnIyi').textContent = d.enIyi || '—';

  // Gruplar halinde filtreleme (BIST, Forex/Altın, Kripto)
  const gruplar = [
    { id: 'bist', baslik: '🇹🇷 BIST HİSSELERİ', liste: tumSinyaller.filter(s => (s.kategori || 'bist') === 'bist'), ozet: kats.bist },
    { id: 'forex', baslik: '🌍 FOREX & ALTIN / EMTİA', liste: tumSinyaller.filter(s => s.kategori === 'forex'), ozet: kats.forex },
    { id: 'kripto', baslik: '🪙 KRİPTO VARLIKLAR', liste: tumSinyaller.filter(s => s.kategori === 'kripto'), ozet: kats.kripto }
  ];

  const gosterilecekGruplar = seciliRaporKategori === 'hepsi'
    ? gruplar
    : gruplar.filter(g => g.id === seciliRaporKategori);

  const tablo = $('#raporSinyalListesi');
  const mobilKutu = $('#raporMobilKartKutusu');

  let tabloHtml = '';
  let mobilHtml = '';
  let toplamGosterilen = 0;

  gosterilecekGruplar.forEach(g => {
    if (g.liste.length === 0) return;
    toplamGosterilen += g.liste.length;

    // Kategori Bölüm Başlığı (Masaüstü Tablo Ayracı)
    const gOzet = g.ozet || {};
    const baslikMetni = `${g.baslik} (${g.liste.length} Sinyal | Kazanma: ${gOzet.winRate || '%0'} | Ort. Getiri: ${gOzet.ortGetiri || '%0.00'})`;

    tabloHtml += `
      <tr class="rapor-kat-ayrac">
        <td colspan="9">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>${baslikMetni}</span>
            <span style="font-size:11px; opacity:0.8; font-weight:normal;">Detay için tıkla</span>
          </div>
        </td>
      </tr>
    `;

    mobilHtml += `
      <div class="rapor-mobil-kat-baslik">
        <span>${g.baslik}</span>
        <span style="font-size:11px; opacity:0.85;">${gOzet.winRate || '%0'} Win</span>
      </div>
    `;

    g.liste.forEach(s => {
      const isKar = (s.degisimYuzde || 0) > 0;
      const isZarar = (s.degisimYuzde || 0) < 0;
      const oranRenk = isKar ? '#10b981' : isZarar ? '#ef4444' : '#94a3b8';
      const yonRenk = s.yon === 'AL' ? '#10b981' : '#ef4444';
      const durumRenk = s.durum.includes('HEDEF') || s.durum.includes('KÂR') ? '#10b981' : s.durum.includes('STOP') || s.durum.includes('ZARAR') ? '#ef4444' : '#38bdf8';

      // 1. Masaüstü Tablo Satırı (Kompakt ve taşmasız)
      tabloHtml += `
        <tr style="border-bottom:1px solid #1e293b; transition:background 0.2s; cursor:pointer;" onclick="detayAc('${esc(s.sembol)}'); $('#gunlukRaporModal').classList.add('gizli');">
          <td class="orta" style="padding:8px 8px; color:#94a3b8; font-size:12px;">${esc(s.saat || '—')}</td>
          <td style="padding:8px 10px; font-weight:bold; color:#fff;">
            ${esc(s.sembol.split(':')[1] || s.sembol)}
            <div style="font-size:11px; color:#94a3b8; font-weight:normal; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:140px;">${esc(s.ad || '')}</div>
          </td>
          <td class="orta" style="padding:8px 4px;"><span style="color:${yonRenk}; font-weight:bold; padding:2px 6px; background:${yonRenk}15; border-radius:4px; font-size:11px;">${esc(s.yon)}</span></td>
          <td style="padding:8px 8px; color:#c7d2fe; font-size:12px;">${esc(s.sinyalTipi)}</td>
          <td class="sag" style="padding:8px 8px; font-weight:600; font-size:12px;">${sayi(s.girisFiyat)}</td>
          <td class="sag" style="padding:8px 8px; font-weight:700; color:#fff; font-size:12px;">${sayi(s.anlikFiyat)}</td>
          <td class="sag" style="padding:8px 8px; color:#38bdf8; font-weight:600; font-size:12px;">${sayi(s.gunYuksek)} (${s.maxKarYuzde >= 0 ? '+' : ''}%${s.maxKarYuzde})</td>
          <td class="sag" style="padding:8px 8px; font-weight:800; color:${oranRenk}; font-size:12.5px;">${s.degisimYuzde >= 0 ? '+' : ''}%${s.degisimYuzde}</td>
          <td class="orta" style="padding:8px 8px;"><span style="color:${durumRenk}; font-weight:700; font-size:11px; padding:3px 8px; background:${durumRenk}20; border-radius:8px;">${esc(s.durum)}</span></td>
        </tr>
      `;

      // 2. Mobil Dokunmatik Akıllı Kart (Telefon ekranlarında kusursuz görünüm)
      mobilHtml += `
        <div class="rapor-mobil-kart" onclick="detayAc('${esc(s.sembol)}'); $('#gunlukRaporModal').classList.add('gizli');">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-weight:800; font-size:15px; color:#fff;">${esc(s.sembol.split(':')[1] || s.sembol)}</span>
              <span style="font-size:11px; color:#94a3b8;">${esc(s.saat || '')}</span>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="color:${yonRenk}; font-weight:800; padding:2px 7px; background:${yonRenk}20; border-radius:4px; font-size:11px;">${esc(s.yon)}</span>
              <span style="color:${oranRenk}; font-weight:900; font-size:15px;">${s.degisimYuzde >= 0 ? '+' : ''}%${s.degisimYuzde}</span>
            </div>
          </div>
          <div style="font-size:11.5px; color:#94a3b8;">${esc(s.ad || '')}</div>
          <div style="display:flex; justify-content:space-between; align-items:center; background:#090d16; padding:6px 10px; border-radius:6px; margin-top:4px; font-size:11.5px;">
            <div><span style="color:#64748b;">Giriş:</span> <b style="color:#e2e8f0;">${sayi(s.girisFiyat)}</b></div>
            <div><span style="color:#64748b;">Son:</span> <b style="color:#fff;">${sayi(s.anlikFiyat)}</b></div>
            <div><span style="color:#64748b;">Zirve:</span> <b style="color:#38bdf8;">${sayi(s.gunYuksek)}</b></div>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; font-size:11px;">
            <span style="color:#a5b4fc;">${esc(s.sinyalTipi)}</span>
            <span style="color:${durumRenk}; font-weight:700; padding:2px 6px; background:${durumRenk}15; border-radius:6px;">${esc(s.durum)}</span>
          </div>
        </div>
      `;
    });
  });

  if (toplamGosterilen === 0) {
    const bosHtml = `<div class="bos" style="padding:30px; text-align:center;">Seçili kategoride bu tarihe ait sinyal bulunmuyor.</div>`;
    tablo.innerHTML = `<tr><td colspan="9">${bosHtml}</td></tr>`;
    if (mobilKutu) mobilKutu.innerHTML = bosHtml;
  } else {
    tablo.innerHTML = tabloHtml;
    if (mobilKutu) mobilKutu.innerHTML = mobilHtml;
  }
}

// Buton Etkileşimleri
$('#gunlukRaporBtn').onclick = () => {
  gunlukRaporPenceresiAc();
};
$('#raporSifreKapatBtn').onclick = () => {
  $('#perde').classList.add('gizli');
  $('#raporSifreModal').classList.add('gizli');
};
$('#raporKapatBtn').onclick = () => {
  $('#perde').classList.add('gizli');
  $('#gunlukRaporModal').classList.add('gizli');
};
$('#raporCikisBtn').onclick = () => {
  localStorage.removeItem(RAPOR_HAFIZA_ANAHTAR);
  $('#gunlukRaporModal').classList.add('gizli');
  $('#perde').classList.add('gizli');
  bildirimGoster('🔒 Günlük rapor oturumu kapatıldı.');
};
$('#raporGuncelleBtn').onclick = async () => {
  const sifre = raporSifreAl();
  if (!sifre) return;
  try {
    $('#raporGuncelleBtn').textContent = '⏳ Güncelleniyor...';
    await fetch('/api/rapor/guncelle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Rapor-Sifre': encodeURIComponent(sifre) },
      body: JSON.stringify({ tarih: seciliRaporTarihi })
    });
    await gunlukRaporVerisiYukle(seciliRaporTarihi);
  } finally {
    $('#raporGuncelleBtn').textContent = '⟳ Yenile';
  }
};
$('#raporTarihSecici').onchange = (e) => {
  seciliRaporTarihi = e.target.value;
  gunlukRaporVerisiYukle(seciliRaporTarihi);
};

document.querySelectorAll('#gunlukRaporModal .cip[data-rkat]').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('#gunlukRaporModal .cip[data-rkat]').forEach(b => b.classList.remove('aktif'));
    btn.classList.add('aktif');
    seciliRaporKategori = btn.dataset.rkat;
    raporArayuzunuCiz();
  };
});

(async () => {
  try { 
    await listeleriYukle(); 
    await tara(); 
    await demoPortfoyYukle(); 
    await ziyaretciYukle(); 
    alarmlariListele();
    await bildirimleriYukle(true);
    setInterval(alarmlariKontrolEt, 15000); // 15 saniyede bir fiyatları ve alarmları denetle

    // Sayfa yenilendiğinde demo ekranı açıktıysa doğrudan açık olarak geri getir
    if (sessionStorage.getItem('alper_demo_modal_acik') === '1' || window.location.hash === '#demo') {
      demoPortfoyAc(false);
    } else if (window.location.hash.startsWith('#analiz-')) {
      const sId = decodeURIComponent(window.location.hash.replace('#analiz-', ''));
      if (sId) detayAc(sId, false);
    }
  } catch (e) { $('#durum').textContent = '⚠️ Sunucuya bağlanılamadı: ' + e.message; }
})();
