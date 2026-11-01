/**
 * S.I.M.P.L.I.F.Y-Surat: klasifikasi Ruj dan pengekstrakan butiran surat.
 * Port terus process_surat.py. Fail yang SAMA digunakan oleh pelayar dan Apps Script (Baca.gs),
 * jadi jangan guna DOM, Utilities atau API khusus persekitaran di sini.
 */

var SEMUA_GURU = 'Semua Guru';
var FOLDER_BELUM_KLASIFIKASI = '_Belum_Diklasifikasi';

// 100-6/2/1: tiga digit fungsi, aktiviti, kemudian paling banyak dua peringkat lagi.
var RE_KOD = /(?<![\d/-])([1-9]\d{2}-\d{1,3}(?:\/\d{1,3}){0,2})(?!\d)/;
var RE_LABEL_RUJ = /Ruj(?:ukan)?\.?\s*(Kami|Tuan)\b\s*[.:;•]*\s*(.*)/i;
var RE_ORGANISASI = /[A-Z]{2,}/;
var RE_LEBAR_SIFAR = /[​‌‍﻿]/g;
var TAJUK_MIN = 12;
var BULAN_SURAT = {
  januari: 1, jan: 1, februari: 2, feb: 2, mac: 3, mar: 3, april: 4, apr: 4, mei: 5, jun: 6, julai: 7, jul: 7,
  ogos: 8, ogo: 8, september: 9, sep: 9, oktober: 10, okt: 10, november: 11, nov: 11, disember: 12, dis: 12,
};
var RE_TARIKH = new RegExp('(\\d{1,2})(?:\\s*[-–]\\s*\\d{1,2})?\\s+(' + Object.keys(BULAN_SURAT).join('|') + ')\\s+(\\d{4})', 'i');
var RE_MASA_SUMBER = '(\\d{1,2})[.:](\\d{2})\\s*(pagi|petang|ptg|malam|t(?:en)?ga?h\\s*hari)?';
var RE_SAPAAN = /^(Tuan|Puan|YBhg|Y\.Bhg|Dato|Yang Berbahagia)\b/i;
var RE_LABEL = { Tarikh: /^Tarikh\b/i, Masa: /^Masa\b/i, Tempat: /^Tempat\b/i };
var RE_PERENGGAN = /^\d+\.(\s|$)/;
// Baris cop pada surat yang sudah bercop, dan baris Ruj yang kodnya tersalah baca oleh OCR.
var RE_BUKAN_TAJUK = /^(?:TERIMA$|By\s|Ruj)/i;
var RE_AWALAN = /^[\s:;.,•·]+/;
// Fail terperingkat ditanda selepas kod agensi, cth SMSL.S.100-1/1/8.
var RE_TERPERINGKAT = /\.(TD|S|R|T)\.\s*\d{3}-/i;

function potongHujung_(teks, aksara) {
  var mula = 0;
  var akhir = teks.length;
  while (mula < akhir && aksara.indexOf(teks[mula]) >= 0) mula++;
  while (akhir > mula && aksara.indexOf(teks[akhir - 1]) >= 0) akhir--;
  return teks.slice(mula, akhir);
}

function bersihNama_(teks) {
  return potongHujung_(String(teks).replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' '), ' .');
}

/** Pulangkan kod klasifikasi teras daripada Ruj. Kami, atau null. */
function huraikanRuj_(ruj) {
  var teks = String(ruj || '').replace(/[‐-―]/g, '-').replace(/\s*([-/])\s*/g, '$1');
  var padanan = teks.match(RE_KOD);
  return padanan ? padanan[1] : null;
}

function bersihRuj_(teks, ocr) {
  var bersih = potongHujung_(String(teks).replace(RE_LEBAR_SIFAR, '').replace(/\s+/g, ' '), ' .:;');
  // Bilangan surat ditulis tangan dan tidak boleh dipercayai daripada OCR.
  if (ocr) return bersih.replace(/\s*\(.*$/, '').replace(/\bJid\b/g, 'Jld').trim();
  return bersih.replace(/\(\s*(\d+)\s*\)/g, '($1)');
}

function barisTeks_(teks) {
  return String(teks || '').split(/\r\n|\r|\n/).map(function (b) { return b.trim(); }).filter(Boolean);
}

/** Pulangkan Ruj. Kami, kemudian Ruj. Tuan, daripada teks halaman pertama. */
function cariRuj_(teks, ocr) {
  var baris = barisTeks_(teks);
  var jumpa = {};
  baris.forEach(function (b) {
    var padanan = b.match(RE_LABEL_RUJ);
    if (padanan && huraikanRuj_(padanan[2])) {
      var kunci = padanan[1].toLowerCase();
      if (!jumpa[kunci]) jumpa[kunci] = padanan[2];
    }
  });
  var nilai = jumpa.kami || jumpa.tuan;
  if (nilai) return bersihRuj_(nilai, ocr);
  // OCR membaca mengikut lajur, jadi nilai mungkin terpisah daripada label dan muncul selepas
  // "Tuan,". Perkataan pertama mesti kod berorganisasi supaya rujukan dalam ayat diabaikan.
  for (var i = 0; i < baris.length; i++) {
    var pertama = baris[i].split(/\s+/)[0];
    if (huraikanRuj_(pertama) && RE_ORGANISASI.test(pertama)) return bersihRuj_(baris[i], ocr);
  }
  return null;
}

function banyakHurufBesar_(baris) {
  var huruf = Array.from(baris).filter(function (c) { return /\p{L}/u.test(c); });
  return huruf.length >= 2 && huruf.filter(function (c) { return /\p{Lu}/u.test(c); }).length / huruf.length >= 0.7;
}

/** Pulangkan [tajuk, indeks selepas tajuk]: blok huruf besar pertama selepas sapaan. */
function cariTajuk_(baris) {
  var mula = -1;
  for (var m = 0; m < baris.length; m++) if (RE_SAPAAN.test(baris[m])) { mula = m; break; }
  if (mula < 0) return [null, 0];
  var tajuk = [];
  for (var i = mula + 1; i < baris.length; i++) {
    var b = baris[i];
    if (banyakHurufBesar_(b) && !huraikanRuj_(b) && !RE_BUKAN_TAJUK.test(b)) {
      tajuk.push(b);
    } else if (tajuk.join(' ').length >= TAJUK_MIN) {
      return [tajuk.join(' '), i];
    } else {
      // Blok pendek bukan tajuk, contohnya perkataan TERIMA pada surat yang sudah bercop.
      tajuk = [];
    }
  }
  var teks = tajuk.join(' ');
  return teks.length >= TAJUK_MIN ? [teks, baris.length] : [null, mula + 1];
}

function tukarMasa_(jam, minit, tempoh) {
  var j = Number(jam);
  var t = String(tempoh || '').toLowerCase();
  if (t.indexOf('pagi') === 0) j %= 12;
  else if (t.indexOf('petang') === 0 || t.indexOf('ptg') === 0 || t.indexOf('malam') === 0) j = j % 12 + 12;
  else if (t && j < 11) j += 12;
  return ('0' + j).slice(-2) + ':' + minit;
}

function tarikhIso_(hari, bulan, tahun) {
  var d = new Date(Date.UTC(tahun, bulan - 1, hari));
  if (d.getUTCFullYear() !== tahun || d.getUTCMonth() !== bulan - 1 || d.getUTCDate() !== hari) return null;
  return d.toISOString().slice(0, 10);
}

/** Ekstrak tajuk dan butiran acara; OCR mungkin memisahkan label daripada nilainya. */
function huraikanMaklumat_(teks) {
  var baris = barisTeks_(String(teks || '').replace(RE_LEBAR_SIFAR, ''));
  var hasil = { tajuk: null, tarikh: null, tarikh_teks: null, masa: null, masa_mula: null, masa_tamat: null, tempat: null };
  var t = cariTajuk_(baris);
  hasil.tajuk = t[0];
  var badan = baris.slice(t[1]);
  function selepasLabel(nama) {
    for (var k = 0; k < badan.length; k++) if (RE_LABEL[nama].test(badan[k])) return k;
    return -1;
  }

  var i = selepasLabel('Tarikh');
  if (i >= 0) {
    for (var a = i; a < badan.length; a++) {
      var p = badan[a].match(RE_TARIKH);
      if (!p) continue;
      var iso = tarikhIso_(Number(p[1]), BULAN_SURAT[p[2].toLowerCase()], Number(p[3]));
      if (iso) {
        hasil.tarikh = iso;
        hasil.tarikh_teks = p[0].replace(/\s+/g, ' ');
      }
      break;
    }
  }
  i = selepasLabel('Masa');
  if (i >= 0) {
    for (var c = i; c < badan.length; c++) {
      var waktu = Array.from(badan[c].matchAll(new RegExp(RE_MASA_SUMBER, 'gi')));
      if (!waktu.length) continue;
      hasil.masa_mula = tukarMasa_(waktu[0][1], waktu[0][2], waktu[0][3]);
      hasil.masa_tamat = waktu.length > 1 ? tukarMasa_(waktu[1][1], waktu[1][2], waktu[1][3]) : null;
      hasil.masa = [hasil.masa_mula, hasil.masa_tamat].filter(Boolean).join(' - ');
      break;
    }
  }
  i = selepasLabel('Tempat');
  if (i >= 0) {
    var calon = [badan[i].replace(/Tempat\b/i, '')].concat(badan.slice(i + 1));
    for (var e = 0; e < calon.length; e++) {
      if (RE_PERENGGAN.test(calon[e])) break;
      var nilai = calon[e].replace(RE_AWALAN, '').trim();
      if (nilai.length > 2 && !RE_TARIKH.test(nilai) && !new RegExp(RE_MASA_SUMBER, 'i').test(nilai)
        && nilai.toUpperCase() !== 'SCAN HERE') {
        hasil.tempat = nilai;
        break;
      }
    }
  }
  return hasil;
}

/** Pulangkan { tajuk tepat, kod induk terdekat, tajuk induk } daripada master. */
function cariMaster_(kod, master) {
  function tajukKod(k) { return (master[k] && master[k].tajuk) || null; }
  var induk = kod;
  for (;;) {
    if (induk.indexOf('/') >= 0) induk = induk.slice(0, induk.lastIndexOf('/'));
    else if (induk.indexOf('-') >= 0) induk = induk.slice(0, induk.indexOf('-'));
    else return { tajuk: tajukKod(kod), induk: null, tajuk_induk: null };
    if (tajukKod(induk)) return { tajuk: tajukKod(kod), induk: induk, tajuk_induk: tajukKod(induk) };
  }
}

function klasifikasi_(ruj, master) {
  var kod = huraikanRuj_(ruj);
  var hasil = { ruj: ruj, kod: kod, tajuk: null, induk: null, tajuk_induk: null, amaran: [] };
  if (!kod) {
    hasil.amaran.push('Kod klasifikasi tidak ditemui dalam Ruj. Kami.');
    return hasil;
  }
  var m = cariMaster_(kod, master);
  hasil.tajuk = m.tajuk; hasil.induk = m.induk; hasil.tajuk_induk = m.tajuk_induk;
  if (!master[kod]) hasil.amaran.push('Kod ' + kod + ' tiada dalam Fail_Classification_Master.json.');
  else if (!master[kod].disahkan) hasil.amaran.push('Kod ' + kod + ' belum disahkan dalam master.');
  return hasil;
}

/** Nama folder kod di Drive: 100-6_2_1, atau 100-6_2_1 - Tajuk jika master ada tajuk tepat. */
function namaFolderKod_(kod, tajuk) {
  if (!kod) return FOLDER_BELUM_KLASIFIKASI;
  var kunci = kod.replace(/\//g, '_');
  return tajuk ? kunci + ' - ' + bersihNama_(tajuk) : kunci;
}

function bersihKunci_(teks) {
  return String(teks || '').replace(/[^\p{L}\p{N}_]+/gu, '').toLowerCase();
}

/**
 * Identiti satu surat untuk Drive. OCR membuang bilangan (12), jadi surat berlainan dalam fail yang
 * sama boleh berkongsi Ruj; tanpa bilangan, tajuk turut dibandingkan.
 */
function kunciSurat_(rekod) {
  var ruj = rekod.ruj || '';
  var bersih = bersihKunci_(ruj);
  if (/\(\s*\d+\s*\)/.test(ruj)) return JSON.stringify([bersih]);
  return JSON.stringify([bersih, bersihKunci_(rekod.tajuk), bersih ? '' : (rekod.tarikh || '')]);
}

/** Surat yang dicop dua kali ialah acara yang sama. */
function kunciAcara_(rekod) {
  return rekod.tarikh + '|' + bersihKunci_(rekod.tajuk);
}

function terperingkat_(ruj) {
  return RE_TERPERINGKAT.test(String(ruj || ''));
}

/** Senarai Tindakan untuk paparan dan notifikasi; rekod lama tiada medan tindakan. */
function pihak_(rekod) {
  return rekod.tindakan && rekod.tindakan.length ? rekod.tindakan : (rekod.guru || []).concat(rekod.jawatan || []);
}

/** Tahun arkib mengikut tarikh terima, sama untuk papan pemuka dan folder Drive. */
function tahunSurat_(rekod) {
  return String(rekod.tarikh_terima || '').slice(0, 4);
}

/** Tarikh acara jika ada; surat tanpa acara mengikut tarikh terima. */
function tarikhPaparan_(rekod) {
  return rekod.tarikh || rekod.tarikh_terima;
}

function padanKod_(kod, nod) {
  return Boolean(kod) && (kod === nod || kod.indexOf(nod + '-') === 0 || kod.indexOf(nod + '/') === 0);
}

/** 100-6/2/1 menjadi 100, 100-6, 100-6/2, 100-6/2/1. */
function nenekMoyang_(kod) {
  var tanda = kod.indexOf('-');
  if (tanda < 0) return [kod];
  var siri = kod.slice(0, tanda);
  var bahagian = kod.slice(tanda + 1).split('/');
  return [siri].concat(bahagian.map(function (_, i) { return siri + '-' + bahagian.slice(0, i + 1).join('/'); }));
}

function bandingKod_(a, b) {
  var x = a.split(/[-/]/).map(Number);
  var y = b.split(/[-/]/).map(Number);
  for (var i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

/** Bina pokok kod: siri utama sentiasa ada, cabang muncul apabila kod didaftarkan. */
function pokokKod_(master, kodDb, surat) {
  var nod = {};
  Object.keys(master).forEach(function (k) { if (/^\d+$/.test(k)) nod[k] = true; });
  Object.keys(kodDb).concat(surat.map(function (r) { return r.kod; }).filter(Boolean)).forEach(function (k) {
    nenekMoyang_(k).forEach(function (n) { nod[n] = true; });
  });
  var anak = {};
  Object.keys(nod).forEach(function (k) {
    var rantai = nenekMoyang_(k);
    if (rantai.length > 1) {
      var induk = rantai[rantai.length - 2];
      (anak[induk] = anak[induk] || []).push(k);
    }
  });
  function tajuk(k) {
    return (master[k] && master[k].tajuk) || (kodDb[k] && kodDb[k].tajuk) || null;
  }
  function bina(k) {
    return {
      kod: k,
      tajuk: tajuk(k),
      bil: surat.filter(function (r) { return padanKod_(r.kod, k); }).length,
      anak: (anak[k] || []).sort(bandingKod_).map(bina),
    };
  }
  return Object.keys(nod).filter(function (k) { return /^\d+$/.test(k); }).sort(bandingKod_).map(bina);
}

/** Surat Semua Guru muncul di bawah setiap guru, termasuk guru yang didaftarkan kemudian. */
function untukGuru_(rekod, nama) {
  if (nama === SEMUA_GURU) return Boolean(rekod.semua_guru);
  return (rekod.guru || []).indexOf(nama) >= 0 || Boolean(rekod.semua_guru);
}

if (typeof module !== 'undefined') {
  module.exports = {
    huraikanRuj_: huraikanRuj_, cariRuj_: cariRuj_, huraikanMaklumat_: huraikanMaklumat_, klasifikasi_: klasifikasi_,
    pokokKod_: pokokKod_, kunciSurat_: kunciSurat_, kunciAcara_: kunciAcara_, terperingkat_: terperingkat_,
    namaFolderKod_: namaFolderKod_, bersihNama_: bersihNama_,
  };
}
