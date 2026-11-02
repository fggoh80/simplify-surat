/**
 * Enjin cop dalam pelayar: port process_surat.py (bina cop, cari ruang kosong, tampal).
 * pdf.js memaparkan halaman untuk peta dakwat dan mencari perkataan "Tarikh";
 * pdf-lib menulis imej cop ke dalam PDF asal (lapisan teks kekal).
 * Bergantung pada KONFIG (konfig.js), PDFLib (lib/pdf-lib.min.js) dan pdfjsLib (dimuat oleh muatPdfjs).
 */
var Cop = (function () {
  'use strict';

  var AMBANG_DAKWAT = 190;
  var FON = 'CopFon';
  var JENIS_IMEJ = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff' };
  var OCR_DPI = [250, 300];
  // Penutup surat: Cop Minit diletakkan pada halaman tandatangan pengirim.
  var RE_PENUTUP = /menjalankan\s+amanah|BERKHIDMAT\s+UNTUK\s+NEGARA|menurut\s+perintah|^\s*Sekian[\s,.]/im;
  var HAD_HALAMAN_PENUTUP = 6;
  var DPI_PENUTUP = 150;

  function RalatCop(mesej) {
    var e = new Error(mesej);
    e.name = 'RalatCop';
    return e;
  }

  // --- Pustaka ---

  var pdfjsJanji = null;
  var ASAS_PDFJS = '';
  function muatPdfjs() {
    if (!pdfjsJanji) {
      var asas = new URL('lib/pdfjs/', document.baseURI).href;
      ASAS_PDFJS = asas;
      pdfjsJanji = import(asas + 'pdf.min.mjs').then(function (m) {
        m.GlobalWorkerOptions.workerSrc = asas + 'pdf.worker.min.mjs';
        return m;
      });
    }
    return pdfjsJanji;
  }

  var fonJanji = null;
  function muatFon() {
    if (!fonJanji) {
      // Liberation Sans Bold: metrik sama dengan Arial Bold (arialbd.ttf dalam Config.json).
      var f = new FontFace(FON, 'url(' + new URL('fonts/LiberationSans-Bold.ttf', document.baseURI).href + ')');
      fonJanji = f.load().then(function (dimuat) { document.fonts.add(dimuat); });
    }
    return fonJanji;
  }

  function bukaPdf(bait) {
    return muatPdfjs().then(function (pdfjs) {
      // Salinan: pdf.js memindahkan ArrayBuffer ke worker.
      // Imbasan JBIG2/JPEG2000 memerlukan wasm; fon standard dan CMap untuk teks yang tidak terbenam.
      return pdfjs.getDocument({
        data: bait.slice(0), isEvalSupported: false,
        wasmUrl: ASAS_PDFJS + 'wasm/', standardFontDataUrl: ASAS_PDFJS + 'standard_fonts/',
        cMapUrl: ASAS_PDFJS + 'cmaps/', cMapPacked: true, iccUrl: ASAS_PDFJS + 'iccs/',
      }).promise;
    }).catch(function (e) {
      if (e && e.name === 'PasswordException') throw RalatCop('PDF dilindungi kata laluan.');
      if (e && e.name === 'RalatCop') throw e;
      throw RalatCop('Fail PDF rosak atau tidak boleh dibaca.');
    });
  }

  function tutup(dok) {
    // pdf.js 4+: musnahkan melalui loadingTask.
    if (dok.loadingTask) dok.loadingTask.destroy(); else if (dok.destroy) dok.destroy();
  }

  // --- Masa Malaysia ---

  function bahagianMasa(tarikh) {
    var f = new Intl.DateTimeFormat('en-GB', {
      timeZone: KONFIG.zon_masa, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    var p = {};
    f.formatToParts(tarikh || new Date()).forEach(function (x) { p[x.type] = x.value; });
    if (p.hour === '24') p.hour = '00';
    return p;
  }

  function hariIniIso() {
    var p = bahagianMasa();
    return p.year + '-' + p.month + '-' + p.day;
  }

  /** dd.MM.yyyy atau dd/MM/yyyy daripada YYYY-MM-DD. */
  function formatTarikh(iso, corak) {
    var b = iso.split('-');
    return corak.replace('dd', b[2]).replace('MM', b[1]).replace('yyyy', b[0]);
  }

  /** Cap masa sebenar pengecopan (bukan tarikh terima), cth By SJKC PEAY MIN at 02:05:09 PM, 31/10/2026. */
  function teksCapMasa() {
    var p = bahagianMasa();
    var jam = Number(p.hour);
    var masa = ('0' + (jam % 12 || 12)).slice(-2) + ':' + p.minute + ':' + p.second + ' ' + (jam < 12 ? 'AM' : 'PM');
    return KONFIG.cop.terima.cap_masa.teks
      .replace('{sekolah}', KONFIG.sekolah.nama)
      .replace('{masa}', masa)
      .replace('{tarikh}', p.day + '/' + p.month + '/' + p.year);
  }

  // --- Lukis cop ---

  function kanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function rgba(w) {
    return 'rgba(' + w[0] + ',' + w[1] + ',' + w[2] + ',' + (w[3] / 255) + ')';
  }

  function setFon(ctx, saiz) {
    ctx.font = saiz + 'px "' + FON + '"';
  }

  /** Sauh "mm"/"lm" Pillow: tengah antara ascender dan descender fon. */
  function tulis(ctx, x, y, teks, saiz, warna, kiri) {
    setFon(ctx, saiz);
    ctx.fillStyle = rgba(warna);
    ctx.textAlign = kiri ? 'left' : 'center';
    ctx.textBaseline = 'alphabetic';
    var m = ctx.measureText(teks);
    ctx.fillText(teks, x, y + (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2);
  }

  function panjang(ctx, teks, saiz) {
    setFon(ctx, saiz);
    return ctx.measureText(teks).width;
  }

  /** Jadikan latar putih imbasan lutsinar supaya teks surat di bawah cop kekal kelihatan. */
  function buangLatarPutih(ctx, w, h) {
    var data = ctx.getImageData(0, 0, w, h);
    var d = data.data;
    for (var i = 0; i < d.length; i += 4) {
      var v = Math.min(d[i], d[i + 1], d[i + 2]);
      var alfa = v <= 120 ? 255 : v >= 235 ? 0 : Math.round((235 - v) * 255 / 115);
      if (alfa < d[i + 3]) d[i + 3] = alfa;
    }
    ctx.putImageData(data, 0, 0);
  }

  function kanvasTemplat(imej, cfg, W) {
    if (!imej) return null;
    var c = kanvas(W, Math.round(W * imej.height / imej.width));
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imej, 0, 0, c.width, c.height);
    if (cfg.buang_latar_putih) buangLatarPutih(ctx, c.width, c.height);
    return c;
  }

  function garis(ctx, x0, y0, x1, y1, tebal, warna) {
    ctx.strokeStyle = rgba(warna);
    ctx.lineWidth = tebal;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  /** Tulis teks di bawah templat; y=null menambah jalur lutsinar supaya cop tidak ditindih. */
  function tambahCapMasa(c, teks) {
    var cop = KONFIG.cop;
    var cap = cop.terima.cap_masa;
    var W = c.width;
    var ctx = c.getContext('2d');
    var saiz = Math.round(W * cap.saiz);
    while (saiz > 10 && panjang(ctx, teks, saiz) > W * cap.lebar_maks) saiz--;
    var y;
    if (cap.y === null) {
      var jalur = Math.round(saiz * 1.6);
      var baru = kanvas(W, c.height + jalur);
      baru.getContext('2d').drawImage(c, 0, 0);
      y = c.height + jalur / 2;
      c = baru;
      ctx = c.getContext('2d');
    } else {
      y = c.height * cap.y;
    }
    tulis(ctx, W * cap.x, y, teks, saiz, cop.warna);
    return c;
  }

  function binaCopTerima(templat, tarikh, capMasa) {
    var cop = KONFIG.cop;
    var cfg = cop.terima;
    var W = cop.lebar_piksel;
    var warna = cop.warna;
    var c = kanvasTemplat(templat, cfg, W);
    var ctx;
    if (!c) {
      var H = Math.round(W * cfg.tinggi_nisbah_cop);
      c = kanvas(W, H);
      ctx = c.getContext('2d');
      var tebal = Math.max(4, Math.floor(W / 150));
      ctx.strokeStyle = rgba(warna);
      ctx.lineWidth = tebal;
      ctx.beginPath();
      ctx.roundRect(tebal * 1.5, tebal * 1.5, W - tebal * 3, H - tebal * 3, Math.floor(W / 40));
      ctx.stroke();
      var nama = KONFIG.sekolah.nama.toUpperCase();
      if (nama) tulis(ctx, W / 2, H * 0.17, nama, Math.floor(W / 26), warna);
      tulis(ctx, W / 2, H * 0.36, 'DITERIMA', Math.floor(W / 11), warna);
    }
    ctx = c.getContext('2d');
    tulis(ctx, c.width * cfg.tarikh_xy[0], c.height * cfg.tarikh_xy[1], tarikh, Math.round(W * cfg.tarikh_saiz), warna);
    return capMasa ? tambahCapMasa(c, capMasa) : c;
  }

  /** Susun nama ke dalam baris tanpa memecahkan satu nama; null jika tidak muat. */
  function balutNama(ctx, nama, saiz, lebar) {
    var baris = [];
    for (var i = 0; i < nama.length; i++) {
      var n = nama[i];
      var calon = baris.length ? baris[baris.length - 1] + ' / ' + n : n;
      if (baris.length && panjang(ctx, calon, saiz) <= lebar) baris[baris.length - 1] = calon;
      else if (panjang(ctx, n, saiz) <= lebar) baris.push(n);
      else return null;
    }
    return baris;
  }

  /** Tulis nama dalam petak dengan saiz terbesar yang muat; ralat jika tidak muat. */
  function lukisNama(ctx, x, y, nama, W, H) {
    var cfg = KONFIG.cop.minit;
    var sel = cfg.sel_nama;
    var lebar = W * sel.lebar;
    var tinggi = H * sel.tinggi;
    for (var saiz = Math.round(W * sel.saiz_maks); saiz >= Math.round(W * sel.saiz_min); saiz--) {
      var baris = balutNama(ctx, nama, saiz, lebar);
      var jarak = saiz * 1.12;
      if (baris && jarak * baris.length <= tinggi) {
        var mula = y - jarak * (baris.length - 1) / 2;
        baris.forEach(function (teks, i) { tulis(ctx, x, mula + i * jarak, teks, saiz, KONFIG.cop.warna_isi_minit); });
        return;
      }
    }
    throw RalatCop('Nama tidak muat dalam petak Cop Minit: ' + nama.join(' / ') + '. Guna singkatan.');
  }

  function lukisTanda(ctx, x, y, W, warna) {
    var t = W * 0.03;
    garis(ctx, x - t * 0.7, y + t, x + t * 0.7, y - t, Math.max(5, Math.floor(W / 90)), warna);
  }

  function binaCopMinit(templat, tarikh, perhatian, tindakan) {
    var cop = KONFIG.cop;
    var cfg = cop.minit;
    var W = cop.lebar_piksel;
    var warna = cop.warna;
    var kol = cfg.kolum_x;
    var baris = cfg.baris;
    var c = kanvasTemplat(templat, cfg, W);
    var ctx;
    if (!c) {
      var H0 = Math.round(W * cfg.tinggi_nisbah_cop);
      c = kanvas(W, H0);
      ctx = c.getContext('2d');
      var tebal = Math.max(4, Math.floor(W / 150));
      var nipis = Math.max(2, Math.floor(tebal / 2));
      ctx.strokeStyle = rgba(warna);
      ctx.lineWidth = tebal;
      ctx.strokeRect(tebal * 1.5, tebal * 1.5, W - tebal * 3, H0 - tebal * 3);
      var kecil = Math.floor(W / 34);
      var sedang = Math.floor(W / 24);
      tulis(ctx, W * 0.04, H0 * cfg.tarikh_xy[1], 'Tarikh:', sedang, warna, true);
      var langkah = baris[1].y - baris[0].y;
      var atas = baris[0].y - langkah / 2;
      garis(ctx, tebal, H0 * (atas - 0.14), W - tebal, H0 * (atas - 0.14), nipis, warna);
      for (var i = 0; i < baris.length; i++) {
        var yy = H0 * (atas + i * langkah);
        garis(ctx, tebal, yy, W - tebal, yy, nipis, warna);
      }
      var garisX = (kol.perhatian + kol.tindakan) / 2;
      var kiri = 2 * kol.perhatian - garisX;
      [kiri, garisX].forEach(function (x) { garis(ctx, W * x, H0 * (atas - 0.14), W * x, H0 - tebal, nipis, warna); });
      var yKepala = H0 * cfg.pengepala_y;
      tulis(ctx, W * kol.jawatan, yKepala, 'Jawatan', kecil, warna, true);
      tulis(ctx, W * kol.perhatian, yKepala, 'Untuk Perhatian', Math.floor(W / 42), warna);
      tulis(ctx, W * kol.tindakan, yKepala, 'Sila Ambil Tindakan', Math.floor(W / 48), warna);
      baris.forEach(function (b) { tulis(ctx, W * kol.jawatan, H0 * b.y, b.jawatan, sedang, warna, true); });
    }
    ctx = c.getContext('2d');
    var H = c.height;
    var isi = cop.warna_isi_minit;
    tulis(ctx, W * cfg.tarikh_xy[0], H * cfg.tarikh_xy[1], tarikh, Math.round(W * cfg.tarikh_saiz), isi, true);
    [['perhatian', perhatian], ['tindakan', tindakan]].forEach(function (pasangan) {
      var lajur = pasangan[0];
      var senarai = pasangan[1];
      baris.forEach(function (b) {
        if (!Object.prototype.hasOwnProperty.call(senarai, b.jawatan)) return;
        if (senarai[b.jawatan].length) lukisNama(ctx, W * kol[lajur], H * b.y, senarai[b.jawatan], W, H);
        else lukisTanda(ctx, W * kol[lajur], H * b.y, W, isi);
      });
    });
    return c;
  }

  // --- Peta dakwat ---

  /** Jadual jumlah piksel berdakwat untuk semakan ruang kosong O(1), dalam unit halaman. */
  function PetaDakwat(kelabu, w, h, lebar, tinggi) {
    this.lebar = lebar;
    this.tinggi = tinggi;
    this.w = w;
    this.h = h;
    this.fx = w / lebar;
    this.fy = h / tinggi;
    var J = new Int32Array((w + 1) * (h + 1));
    for (var y = 0; y < h; y++) {
      var kiraan = 0;
      var atas = y * (w + 1);
      var kini = (y + 1) * (w + 1);
      for (var x = 0; x < w; x++) {
        kiraan += kelabu[y * w + x] < AMBANG_DAKWAT ? 1 : 0;
        J[kini + x + 1] = J[atas + x + 1] + kiraan;
      }
    }
    this.J = J;
  }

  PetaDakwat.prototype.kiraan = function (x0, y0, x1, y1) {
    var a = Math.max(0, Math.min(this.w, Math.trunc(x0 * this.fx)));
    var b = Math.max(a, Math.min(this.w, Math.trunc(x1 * this.fx + 0.999)));
    var c = Math.max(0, Math.min(this.h, Math.trunc(y0 * this.fy)));
    var d = Math.max(c, Math.min(this.h, Math.trunc(y1 * this.fy + 0.999)));
    var L = this.w + 1;
    var J = this.J;
    return J[d * L + b] - J[c * L + b] - J[d * L + a] + J[c * L + a];
  };

  PetaDakwat.prototype.kosong = function (k) {
    var luas = (k[2] - k[0]) * this.fx * (k[3] - k[1]) * this.fy;
    return this.kiraan(k[0], k[1], k[2], k[3]) <= Math.max(3, luas * 0.001);
  };

  PetaDakwat.prototype.dakwatPertama = function (x0, x1, y) {
    var langkah = 1 / this.fy;
    while (y < this.tinggi) {
      if (this.kiraan(x0, y, x1, y + langkah) > 2) return y;
      y += langkah;
    }
    return this.tinggi;
  };

  PetaDakwat.prototype.kosongPertama = function (x0, x1, y) {
    var langkah = 1 / this.fy;
    while (y < this.tinggi) {
      if (this.kiraan(x0, y, x1, y + langkah) <= 2) return y;
      y += langkah;
    }
    return this.tinggi;
  };

  PetaDakwat.prototype.kiriDakwat = function (x0, x1, y0, y1) {
    var langkah = 1 / this.fx;
    while (x0 < x1) {
      if (this.kiraan(x0, y0, x0 + langkah, y1) > 0) return x0;
      x0 += langkah;
    }
    return null;
  };

  function kelabuDaripada(ctx, w, h) {
    var d = ctx.getImageData(0, 0, w, h).data;
    var k = new Uint8Array(w * h);
    for (var i = 0, j = 0; j < k.length; i += 4, j++) {
      // Luminans ITU-R 601, seperti penukaran kelabu MuPDF/Pillow.
      k[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114 + 500) / 1000;
    }
    return k;
  }

  function lukisHalaman(halaman, skala, anotasi, pdfjs) {
    var vp = halaman.getViewport({ scale: skala });
    var c = kanvas(Math.max(1, Math.round(vp.width)), Math.max(1, Math.round(vp.height)));
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    return halaman.render({
      canvasContext: ctx, canvas: c, viewport: vp, background: '#ffffff',
      annotationMode: anotasi ? pdfjs.AnnotationMode.ENABLE : pdfjs.AnnotationMode.DISABLE,
    }).promise.then(function () { return c; });
  }

  function petaHalaman(halaman, pdfjs) {
    return lukisHalaman(halaman, 1, true, pdfjs).then(function (c) {
      var vp = halaman.getViewport({ scale: 1 });
      return new PetaDakwat(kelabuDaripada(c.getContext('2d'), c.width, c.height), c.width, c.height, vp.width, vp.height);
    });
  }

  function petaImej(c) {
    var lebar = Math.min(800, c.width);
    var tinggi = Math.round(c.height * lebar / c.width);
    var k = kanvas(lebar, tinggi);
    var ctx = k.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, lebar, tinggi);
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(c, 0, 0, lebar, tinggi);
    return new PetaDakwat(kelabuDaripada(ctx, lebar, tinggi), lebar, tinggi, c.width, c.height);
  }

  /** Kotak setiap padanan teks pada halaman (koordinat tampak, atas-kiri). */
  function cariTeks(kandungan, vp, kata) {
    var kotak = [];
    var cari = kata.toLowerCase();
    kandungan.items.forEach(function (it) {
      if (!it.str) return;
      var rendah = it.str.toLowerCase();
      var mula = rendah.indexOf(cari);
      while (mula >= 0) {
        var t = it.transform;
        var saiz = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]);
        var arahX = [t[0], t[1]];
        var n = Math.hypot(arahX[0], arahX[1]) || 1;
        var lebar = it.width || 0;
        var awal = lebar * mula / it.str.length;
        var akhir = lebar * (mula + cari.length) / it.str.length;
        var titik = [];
        [[awal, -0.22 * saiz], [akhir, -0.22 * saiz], [awal, 0.9 * saiz], [akhir, 0.9 * saiz]].forEach(function (p) {
          // Sepanjang garis dasar (arah teks) dan tegak lurus kepadanya.
          var x = t[4] + arahX[0] / n * p[0] - arahX[1] / n * p[1];
          var y = t[5] + arahX[1] / n * p[0] + arahX[0] / n * p[1];
          titik.push(vp.convertToViewportPoint(x, y));
        });
        var xs = titik.map(function (q) { return q[0]; });
        var ys = titik.map(function (q) { return q[1]; });
        kotak.push([Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)]);
        mula = rendah.indexOf(cari, mula + 1);
      }
    });
    return kotak;
  }

  /** Cari perkataan Tarikh rasmi di bahagian atas halaman; imbasan tiada lapisan teks. */
  function cariTarikh(halaman) {
    var vp = halaman.getViewport({ scale: 1 });
    return halaman.getTextContent().then(function (kandungan) {
      var had = vp.height * 0.45;
      var calon = cariTeks(kandungan, vp, 'Tarikh').filter(function (r) { return r[1] < had; })
        .sort(function (a, b) { return a[1] - b[1]; });
      var ruj = cariTeks(kandungan, vp, 'Ruj').filter(function (r) { return r[1] < had; });
      if (ruj.length) {
        var atas = Math.min.apply(null, ruj.map(function (r) { return r[1]; }));
        var selepas = calon.filter(function (r) { return r[1] >= atas; });
        calon = selepas.length ? selepas : calon;
      }
      return calon.length ? calon[0] : null;
    });
  }

  // --- Penempatan ---

  function kotakSaiz(x0, y0, lebar, cop) {
    return [x0, y0, x0 + lebar, y0 + lebar * cop.height / cop.width];
  }

  /** Imbasan tiada teks: baris terakhir blok Ruj/Tarikh sebelum jurang pertama di separuh kanan. */
  function sauhSusunAtur(peta, tinggiMin, margin) {
    var kiri = peta.lebar * 0.5;
    var kanan = peta.lebar - margin;
    var y = peta.dakwatPertama(kiri, kanan, margin);
    while (y < peta.tinggi * 0.5) {
      var kosong = peta.kosongPertama(kiri, kanan, y);
      var seterusnya = peta.dakwatPertama(kiri, kanan, kosong);
      if (seterusnya - kosong >= tinggiMin) {
        var tinggiBaris = peta.tinggi * 0.015;
        var x0 = peta.kiriDakwat(peta.lebar * 0.45, kanan, kosong - tinggiBaris, kosong);
        return x0 === null ? null : [x0, kosong - tinggiBaris, kanan, kosong];
      }
      y = seterusnya;
    }
    return null;
  }

  /** Letak Cop Terima di bawah Tarikh; jika tiada, di ruang kosong pertama lajur kanan. */
  function letakTerima(peta, sauh, cop, cfg, pad) {
    var lebar = peta.lebar * cfg.lebar_nisbah;
    var nisbah = cop.height / cop.width;
    var margin = peta.lebar * cfg.margin_nisbah;
    var kanan = peta.lebar - margin;
    var tinggiMin = lebar * nisbah * cfg.skala_min + 2 * pad;
    var cubaan = [[sauh, 'tarikh'], [sauhSusunAtur(peta, tinggiMin, margin), 'susun_atur']];
    for (var i = 0; i < cubaan.length; i++) {
      var titik = cubaan[i][0];
      if (!titik) continue;
      var x0 = titik[0];
      var skala = Math.min(1, (kanan - x0) / lebar);
      var y0 = titik[3] + pad;
      if (skala >= cfg.skala_min) {
        var akhir = peta.dakwatPertama(x0, x0 + lebar * skala, y0);
        skala = Math.min(skala, (akhir - pad - y0) / (lebar * nisbah));
        if (skala >= cfg.skala_min) return { kotak: kotakSaiz(x0, y0, lebar * skala, cop), skala: skala, kaedah: cubaan[i][1] };
      }
    }
    var y = margin;
    while (y < peta.tinggi - margin) {
      var hujung = Math.min(peta.dakwatPertama(kanan - lebar, kanan, y), peta.tinggi - margin);
      var s = Math.min(1, (hujung - y - 2 * pad) / (lebar * nisbah));
      if (s >= cfg.skala_min) return { kotak: kotakSaiz(kanan - lebar * s, y + pad, lebar * s, cop), skala: s, kaedah: 'ruang_kosong' };
      y = hujung + 1;
    }
    return null;
  }

  /**
   * Halaman tandatangan selain halaman 1: cari dari baris penutup (Sekian/amanah) ke bawah,
   * supaya Cop Minit berada di sebelah tandatangan, bukan di sudut bawah halaman.
   */
  function letakMinitAtas(peta, cop, cfg, pad, terpakai, yMula) {
    var margin = peta.lebar * cfg.margin_nisbah;
    var langkah = peta.lebar / 150;
    var skala = 1.0;
    while (skala >= cfg.skala_min - 1e-9) {
      var lebar = peta.lebar * cfg.lebar_nisbah * skala;
      var tinggi = lebar * cop.height / cop.width;
      var y0 = Math.max(margin, yMula);
      while (y0 + tinggi <= peta.tinggi - margin) {
        var x0 = peta.lebar - margin - lebar;
        while (x0 >= peta.lebar * 0.45) {
          var kotak = kotakSaiz(x0, y0, lebar, cop);
          var longgar = [x0 - pad, y0 - pad, kotak[2] + pad, kotak[3] + pad];
          if (peta.kosong(longgar) && !terpakai.some(function (t) { return bertindih(longgar, t); })) {
            return { kotak: kotak, skala: skala };
          }
          x0 -= langkah;
        }
        y0 += langkah;
      }
      skala -= 0.05;
    }
    return null;
  }

  function bertindih(a, b) {
    return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  }

  /** Cari kotak kosong terbesar, bermula dari sudut kanan bawah halaman. */
  function letakMinit(peta, cop, cfg, pad, terpakai) {
    var margin = peta.lebar * cfg.margin_nisbah;
    var langkah = peta.lebar / 150;
    var skala = 1.0;
    while (skala >= cfg.skala_min - 1e-9) {
      var lebar = peta.lebar * cfg.lebar_nisbah * skala;
      var tinggi = lebar * cop.height / cop.width;
      var y0 = peta.tinggi - margin - tinggi;
      while (y0 >= peta.tinggi * 0.4) {
        var x0 = peta.lebar - margin - lebar;
        while (x0 >= peta.lebar * 0.45) {
          var kotak = kotakSaiz(x0, y0, lebar, cop);
          var longgar = [x0 - pad, y0 - pad, kotak[2] + pad, kotak[3] + pad];
          if (peta.kosong(longgar) && !terpakai.some(function (t) { return bertindih(longgar, t); })) {
            return { kotak: kotak, skala: skala };
          }
          x0 -= langkah;
        }
        y0 -= langkah;
      }
      skala -= 0.05;
    }
    return null;
  }

  function bundar2(n) {
    return Math.round(n * 100) / 100;
  }

  /** Pulangkan senarai {cop, indeks, kotak} dan ringkasan penempatan. */
  function rancangCop(senaraiCop, petaIkutHalaman, sauh, bilHalaman, pad, halamanPenutup) {
    var rancangan = [];
    var ringkasan = {};
    var terpakai = {};
    var p = Promise.resolve();
    senaraiCop.forEach(function (item) {
      p = p.then(function () {
        if (item.jenis === 'terima') {
          return petaIkutHalaman(0).then(function (peta) {
            var h = letakTerima(peta, sauh, item.cop, item.cfg, pad);
            if (!h) throw RalatCop('Tiada ruang kosong untuk Cop Terima pada halaman 1.');
            ringkasan.terima = { halaman: 1, kaedah: h.kaedah, skala: bundar2(h.skala) };
            (terpakai[0] = terpakai[0] || []).push(h.kotak);
            rancangan.push({ cop: item.cop, indeks: 0, kotak: h.kotak });
          });
        }
        // Halaman tandatangan dahulu; jika tiada ruang, susunan asal: pertama, kedua, terakhir.
        var calon = [];
        [halamanPenutup ? halamanPenutup.indeks : null, 0, Math.min(1, bilHalaman - 1), bilHalaman - 1].forEach(function (i) {
          if (i !== null && i !== undefined && i >= 0 && calon.indexOf(i) < 0) calon.push(i);
        });
        var cuba = function (n) {
          if (n >= calon.length) throw RalatCop('Tiada ruang kosong untuk Cop Minit pada halaman pertama, kedua atau terakhir.');
          var indeks = calon[n];
          return petaIkutHalaman(indeks).then(function (peta) {
            var atas = halamanPenutup && indeks === halamanPenutup.indeks && indeks > 0;
            var h = atas ? letakMinitAtas(peta, item.cop, item.cfg, pad, terpakai[indeks] || [], halamanPenutup.y)
              : letakMinit(peta, item.cop, item.cfg, pad, terpakai[indeks] || []);
            if (!h) return cuba(n + 1);
            ringkasan.minit = { halaman: indeks + 1, skala: bundar2(h.skala), tandatangan: Boolean(halamanPenutup) && indeks === halamanPenutup.indeks };
            (terpakai[indeks] = terpakai[indeks] || []).push(h.kotak);
            rancangan.push({ cop: item.cop, indeks: indeks, kotak: h.kotak });
          });
        };
        return cuba(0);
      });
    });
    return p.then(function () { return { rancangan: rancangan, ringkasan: ringkasan }; });
  }

  // --- Tampal ---

  function pngBait(c) {
    return new Promise(function (lulus) { c.toBlob(lulus, 'image/png'); })
      .then(function (b) { return b.arrayBuffer(); });
  }

  /** Imej dilukis tegak pada paparan walaupun halaman mempunyai /Rotate. */
  function tampalSatu(dokLib, halamanLib, vp, kotak, imejPdf) {
    var L = PDFLib;
    var bawahKiri = vp.convertToPdfPoint(kotak[0], kotak[3]);
    var bawahKanan = vp.convertToPdfPoint(kotak[2], kotak[3]);
    var atasKiri = vp.convertToPdfPoint(kotak[0], kotak[1]);
    var nama = halamanLib.node.newXObject('Cop', imejPdf.ref);
    halamanLib.pushOperators(
      L.pushGraphicsState(),
      L.concatTransformationMatrix(
        bawahKanan[0] - bawahKiri[0], bawahKanan[1] - bawahKiri[1],
        atasKiri[0] - bawahKiri[0], atasKiri[1] - bawahKiri[1],
        bawahKiri[0], bawahKiri[1]),
      L.drawObject(nama),
      L.popGraphicsState());
  }

  /**
   * Cari halaman penutup (tandatangan pengirim). Lapisan teks dibaca terus; halaman imbasan
   * dibaca dengan fungsi ocr (PNG -> teks) jika diberi. Pulangkan indeks halaman atau null.
   */
  function cariHalamanPenutup(dok, pdfjs, pilihan) {
    var had = Math.min(dok.numPages, HAD_HALAMAN_PENUTUP);
    var yPenutup = 0;
    var cuba = function (i) {
      if (i >= had) return Promise.resolve(null);
      return dok.getPage(i + 1).then(function (h) {
        return h.getTextContent().then(function (k) {
          var teks = k.items.map(function (it) { return (it.str || '') + (it.hasEOL ? '\n' : ' '); }).join('');
          if (teks.replace(/\s/g, '').length > 40) {
            // Kedudukan baris penutup pertama (lapisan teks sahaja; OCR tiada koordinat).
            var vp = h.getViewport({ scale: 1 });
            var kotak = ['Sekian', 'MALAYSIA MADANI', 'BERKHIDMAT', 'amanah', 'menurut perintah'].reduce(function (a, kata) {
              return a.concat(cariTeks(k, vp, kata));
            }, []);
            yPenutup = kotak.length ? Math.min.apply(null, kotak.map(function (r) { return r[1]; })) : 0;
            return teks;
          }
          yPenutup = 0;
          if (i === 0 && pilihan.teksHalaman1) return pilihan.teksHalaman1;
          if (!pilihan.ocr) return '';
          return lukisHalaman(h, DPI_PENUTUP / 72, false, pdfjs).then(function (c) {
            return new Promise(function (lulus) { c.toBlob(lulus, 'image/png'); });
          }).then(function (png) { return pilihan.ocr(png); }).catch(function () { return ''; });
        });
      }).then(function (teks) {
        return RE_PENUTUP.test(teks || '') ? { indeks: i, y: yPenutup } : cuba(i + 1);
      });
    };
    return cuba(0);
  }

  function tampalPdf(bait, senaraiCop, pad, pilihan) {
    var dok;
    return muatPdfjs().then(function (pdfjs) {
      return bukaPdf(bait).then(function (d) {
        dok = d;
        if (dok.numPages === 0) throw RalatCop('PDF tiada halaman.');
        var simpanan = {};
        var halaman = {};
        function dapatHalaman(i) {
          if (!halaman[i]) halaman[i] = dok.getPage(i + 1);
          return halaman[i];
        }
        function petaIkutHalaman(i) {
          if (!simpanan[i]) simpanan[i] = dapatHalaman(i).then(function (h) { return petaHalaman(h, pdfjs); });
          return simpanan[i];
        }
        var adaMinit = senaraiCop.some(function (x) { return x.jenis === 'minit'; });
        var penutup = adaMinit ? cariHalamanPenutup(dok, pdfjs, pilihan || {}) : Promise.resolve(null);
        return Promise.all([dapatHalaman(0).then(cariTarikh), penutup]).then(function (x) {
          return rancangCop(senaraiCop, petaIkutHalaman, x[0], dok.numPages, pad, x[1]);
        }).then(function (pelan) {
          return tulisPdf(bait, dok, dapatHalaman, pelan, pdfjs);
        });
      });
    }).finally(function () { if (dok) tutup(dok); });
  }

  function tulisPdf(bait, dok, dapatHalaman, pelan, pdfjs) {
    var L = PDFLib;
    return L.PDFDocument.load(bait, { updateMetadata: false }).then(function (dokLib) {
      return pasangCop(dokLib, dapatHalaman, pelan, false);
    }, function (e) {
      // pdf-lib tidak boleh menyahsulit; PDF bersekat dibina semula sebagai imej halaman.
      if (!/encrypt/i.test(String(e && e.message))) throw RalatCop('Fail PDF rosak atau tidak boleh dibaca.');
      return binaSemulaSebagaiImej(dok, pdfjs).then(function (dokLib) {
        return pasangCop(dokLib, dapatHalaman, pelan, true);
      });
    });
  }

  function pasangCop(dokLib, dapatHalaman, pelan, imejSahaja) {
    var p = Promise.resolve();
    pelan.rancangan.forEach(function (r) {
      p = p.then(function () {
        return Promise.all([dapatHalaman(r.indeks), pngBait(r.cop)]).then(function (h) {
          return dokLib.embedPng(h[1]).then(function (imej) {
            var vp = h[0].getViewport({ scale: 1 });
            var halamanLib = dokLib.getPage(r.indeks);
            if (imejSahaja) {
              // Halaman baharu tanpa /Rotate dan bersaiz paparan, jadi koordinat terus digunakan.
              var tinggi = halamanLib.getHeight();
              var k = r.kotak;
              halamanLib.drawImage(imej, { x: k[0], y: tinggi - k[3], width: k[2] - k[0], height: k[3] - k[1] });
            } else {
              tampalSatu(dokLib, halamanLib, vp, r.kotak, imej);
            }
          });
        });
      });
    });
    return p.then(function () { return dokLib.save(); }).then(function (keluar) {
      return { bait: keluar, ringkasan: pelan.ringkasan, bilHalaman: dokLib.getPageCount(), amaran: imejSahaja ? ['PDF bersekat: salinan bercop dibina semula sebagai imej halaman.'] : [] };
    });
  }

  function binaSemulaSebagaiImej(dok, pdfjs) {
    var L = PDFLib;
    return L.PDFDocument.create().then(function (baru) {
      var p = Promise.resolve();
      for (var i = 1; i <= dok.numPages; i++) {
        (function (n) {
          p = p.then(function () { return dok.getPage(n); }).then(function (h) {
            return lukisHalaman(h, 200 / 72, true, pdfjs).then(function (c) {
              return new Promise(function (lulus) { c.toBlob(lulus, 'image/jpeg', 0.9); })
                .then(function (b) { return b.arrayBuffer(); })
                .then(function (jpg) { return baru.embedJpg(jpg); })
                .then(function (imej) {
                  var vp = h.getViewport({ scale: 1 });
                  baru.addPage([vp.width, vp.height]).drawImage(imej, { x: 0, y: 0, width: vp.width, height: vp.height });
                });
            });
          });
        })(i);
      }
      return p.then(function () { return baru; });
    });
  }

  function muatImej(fail) {
    return createImageBitmap(fail, { imageOrientation: 'from-image' }).catch(function () {
      throw RalatCop('Imej ' + fail.name + ' tidak dapat dibaca oleh pelayar ini. Tukar kepada PDF, JPG atau PNG.');
    });
  }

  function tampalImej(fail, senaraiCop, pad, sambungan) {
    return muatImej(fail).then(function (bmp) {
      var c = kanvas(bmp.width, bmp.height);
      var ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      var peta = petaImej(c);
      // Saiz imej dalam piksel, maka pad diskalakan kepada lebar A4.
      return rancangCop(senaraiCop, function () { return Promise.resolve(peta); }, null, 1, pad * c.width / 595).then(function (pelan) {
        pelan.rancangan.forEach(function (r) {
          var k = r.kotak.map(Math.round);
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(r.cop, k[0], k[1], k[2] - k[0], k[3] - k[1]);
        });
        var jenis = sambungan === 'jpg' || sambungan === 'jpeg' ? 'image/jpeg' : sambungan === 'webp' ? 'image/webp' : 'image/png';
        return new Promise(function (lulus) { c.toBlob(lulus, jenis, 0.92); }).then(function (b) {
          return b.arrayBuffer().then(function (bait) {
            return { bait: new Uint8Array(bait), ringkasan: pelan.ringkasan, bilHalaman: 1, jenis: jenis, amaran: [] };
          });
        });
      });
    });
  }

  // --- Minit ---

  /** Jawatan bertanda / pada kedua-dua lajur; nama guru di Perhatian, tanda / di Tindakan baris Guru. */
  function pihakMinit(jawatan, namaGuru) {
    var perhatian = {};
    var tindakan = {};
    jawatan.forEach(function (j) { perhatian[j] = []; tindakan[j] = []; });
    var guru = KONFIG.cop.minit.baris.filter(function (b) { return b.isi_nama; })[0].jawatan;
    if (namaGuru.length) {
      perhatian[guru] = namaGuru.slice();
      tindakan[guru] = [];
    }
    return { perhatian: perhatian, tindakan: tindakan };
  }

  function sambunganFail(nama) {
    var m = /\.([^.]+)$/.exec(nama || '');
    return m ? m[1].toLowerCase() : '';
  }

  /**
   * Cop satu fail. pilihan: { templat: {terima, minit} (ImageBitmap atau null), tarikhTerima (YYYY-MM-DD),
   * jawatan: [...], guru: [...] } -> { bait, jenis, nama, penempatan, halaman, halaman_cop, cap_masa, amaran }.
   */
  function copSurat(fail, pilihan) {
    var sambungan = sambunganFail(fail.name);
    if (sambungan !== 'pdf' && !JENIS_IMEJ[sambungan]) return Promise.reject(RalatCop('Format tidak disokong: .' + sambungan));
    var cop = KONFIG.cop;
    var pihak = pihakMinit(pilihan.jawatan || [], pilihan.guru || []);
    var adaMinit = Object.keys(pihak.perhatian).length > 0;
    return muatFon().then(function () {
      var capMasa = pilihan.templat.terima ? teksCapMasa() : null;
      var senarai = [{
        cop: binaCopTerima(pilihan.templat.terima, formatTarikh(pilihan.tarikhTerima, cop.terima.format_tarikh), capMasa),
        cfg: cop.terima, jenis: 'terima',
      }];
      if (adaMinit) {
        senarai.push({
          cop: binaCopMinit(pilihan.templat.minit, formatTarikh(pilihan.tarikhTerima, cop.minit.format_tarikh), pihak.perhatian, pihak.tindakan),
          cfg: cop.minit, jenis: 'minit',
        });
      }
      return fail.arrayBuffer().then(function (bait) {
        var kerja = sambungan === 'pdf' ? tampalPdf(new Uint8Array(bait), senarai, cop.pad_ruang, pilihan)
          : tampalImej(fail, senarai, cop.pad_ruang, sambungan);
        return kerja.then(function (h) {
          var batang = fail.name.replace(/\.[^.]+$/, '');
          var sambKeluar = sambungan === 'pdf' ? 'pdf' : h.jenis === 'image/jpeg' ? (sambungan === 'jpeg' ? 'jpeg' : 'jpg') : h.jenis === 'image/webp' ? 'webp' : 'png';
          var halamanCop = [];
          Object.keys(h.ringkasan).forEach(function (k) {
            if (halamanCop.indexOf(h.ringkasan[k].halaman) < 0) halamanCop.push(h.ringkasan[k].halaman);
          });
          return {
            bait: h.bait,
            jenis: sambungan === 'pdf' ? 'application/pdf' : h.jenis,
            nama_batang: batang,
            sambungan: sambKeluar,
            penempatan: h.ringkasan,
            halaman: h.bilHalaman,
            halaman_cop: halamanCop.sort(),
            cap_masa: capMasa,
            perhatian: pihak.perhatian,
            tindakan: pihak.tindakan,
            amaran: h.amaran,
          };
        });
      });
    });
  }

  // --- Bacaan teks (untuk Ruj dan butiran) ---

  /** Teks lapisan halaman pertama PDF; '' bagi imbasan. */
  function teksHalamanPertama(bait) {
    return bukaPdf(bait).then(function (dok) {
      return dok.getPage(1).then(function (h) { return h.getTextContent(); }).then(function (k) {
        var teks = '';
        k.items.forEach(function (it) {
          if (it.str !== undefined) teks += it.str;
          if (it.hasEOL) teks += '\n';
        });
        return teks;
      }).finally(function () { tutup(dok); });
    });
  }

  /** PNG kelabu halaman pertama untuk OCR Google; cop sedia ada (anotasi) disembunyikan. */
  function imejOcr(fail, dpi) {
    var sambungan = sambunganFail(fail.name);
    var siap;
    if (sambungan === 'pdf') {
      siap = Promise.all([muatPdfjs(), fail.arrayBuffer()]).then(function (x) {
        return bukaPdf(new Uint8Array(x[1])).then(function (dok) {
          return dok.getPage(1).then(function (h) { return lukisHalaman(h, dpi / 72, false, x[0]); })
            .finally(function () { tutup(dok); });
        });
      });
    } else {
      siap = muatImej(fail).then(function (bmp) {
        // Gambar kecil dibesarkan kepada lebar A4 pada dpi yang diminta.
        var lebar = Math.max(bmp.width, Math.round(8.27 * dpi));
        var c = kanvas(lebar, Math.round(bmp.height * lebar / bmp.width));
        var ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, 0, 0, c.width, c.height);
        return c;
      });
    }
    return siap.then(function (c) {
      var ctx = c.getContext('2d', { willReadFrequently: true });
      var data = ctx.getImageData(0, 0, c.width, c.height);
      var d = data.data;
      for (var i = 0; i < d.length; i += 4) {
        var v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114 + 500) / 1000;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(data, 0, 0);
      return new Promise(function (lulus) { c.toBlob(lulus, 'image/png'); });
    });
  }

  /** Paparkan satu halaman PDF ke kanvas untuk pratonton (110 dpi seperti /pratonton). */
  function pratonton(bait, nombor, kanvasSasaran, lebarCss) {
    return Promise.all([muatPdfjs(), bukaPdf(bait)]).then(function (x) {
      var dok = x[1];
      return dok.getPage(nombor).then(function (h) {
        var vp0 = h.getViewport({ scale: 1 });
        var nisbahPeranti = window.devicePixelRatio || 1;
        var skala = Math.max(110 / 72, (lebarCss || vp0.width) * nisbahPeranti / vp0.width);
        var vp = h.getViewport({ scale: skala });
        kanvasSasaran.width = Math.round(vp.width);
        kanvasSasaran.height = Math.round(vp.height);
        var ctx = kanvasSasaran.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, kanvasSasaran.width, kanvasSasaran.height);
        return h.render({ canvasContext: ctx, canvas: kanvasSasaran, viewport: vp, annotationMode: x[0].AnnotationMode.ENABLE }).promise
          .then(function () { return dok.numPages; });
      }).finally(function () { tutup(dok); });
    });
  }

  return {
    copSurat: copSurat,
    teksHalamanPertama: teksHalamanPertama,
    imejOcr: imejOcr,
    pratonton: pratonton,
    hariIniIso: hariIniIso,
    formatTarikh: formatTarikh,
    sambunganFail: sambunganFail,
    OCR_DPI: OCR_DPI,
    // Untuk ujian.
    _dalaman: { binaCopTerima: binaCopTerima, binaCopMinit: binaCopMinit, muatFon: muatFon, letakMinit: letakMinit },
  };
})();
