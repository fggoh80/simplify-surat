/* S.I.M.P.L.I.F.Y-Surat versi telefon: muat naik surat baharu sahaja (pentadbir/kerani). Backend sama dengan papan pemuka. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const KUNCI_SESI = 'simplify-surat-sesi';
  const PEJABAT = ['admin', 'kerani'];
  const LEBAR_GAMBAR = 1700; // piksel sisi panjang; cukup untuk cop dan OCR, saiz PDF kecil

  let sesi = null;
  let k = null;
  let templatCop = null;
  let gambar = []; // halaman yang diambil dengan kamera
  let failPilih = null;
  let analisisSemasa = null;
  let giliran = 0;
  let urlHasil = '';

  // --- Sesi dan API (sama dengan app.js) ---
  function bacaSesi() {
    try {
      const s = JSON.parse(localStorage.getItem(KUNCI_SESI) || 'null');
      return s && s.tamat > Date.now() ? s : null;
    } catch (e) { return null; }
  }
  function simpanSesi(s) {
    try { if (s) localStorage.setItem(KUNCI_SESI, JSON.stringify(s)); else localStorage.removeItem(KUNCI_SESI); } catch (e) { /* abaikan */ }
  }
  class RalatApi extends Error { constructor(kod, m) { super(m); this.kod = kod; } }
  async function api(tindakan, data) {
    let j;
    try {
      j = await fetch(KONFIG.API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ tindakan, data: data || {}, sesi: sesi && sesi.sesi }),
      });
    } catch (e) {
      throw new RalatApi('RANGKAIAN', 'Tiada sambungan internet. Cuba lagi.');
    }
    let h;
    try { h = await j.json(); } catch (e) { throw new RalatApi('RALAT_DALAMAN', 'Pelayan memberi jawapan tidak sah.'); }
    if (!h.ok) {
      if (h.kod === 'SESI_TAMAT') tamatSesi();
      throw new RalatApi(h.kod, h.ralat || 'Permintaan gagal.');
    }
    return h.data;
  }
  function el(tag, kelas, teks) {
    const e = document.createElement(tag);
    if (kelas) e.className = kelas;
    if (teks !== undefined) e.textContent = teks;
    return e;
  }
  function keBase64(b) {
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function dariBase64(b64) {
    const s = atob(b64); const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  // --- Log masuk ---
  function ralatMasuk(t) { $('ralatMasuk').textContent = t || ''; $('ralatMasuk').hidden = !t; }
  async function terimaIdToken(idToken) {
    ralatMasuk('');
    $('teksMasuk').textContent = 'Menyemak akaun...';
    try {
      const h = await api('auth.google', { id_token: idToken });
      sesi = { sesi: h.sesi, tamat: Date.now() + (h.tamat_saat - 120) * 1000, pengguna: h.pengguna };
      simpanSesi(sesi);
      await mula();
    } catch (e) {
      $('teksMasuk').textContent = 'Log masuk dengan akaun Google pentadbir.';
      ralatMasuk(e.message);
    }
  }
  function muatGis() {
    return new Promise((lulus, gagal) => {
      if (window.google && google.accounts && google.accounts.id) return lulus();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = lulus; s.onerror = () => gagal(new Error('Log masuk Google tidak dapat dimuatkan.'));
      document.head.append(s);
    });
  }
  async function tunjukLogMasuk() {
    $('rangka').hidden = true;
    $('layarMasuk').hidden = false;
    if (window.UJI_ID_TOKEN) return terimaIdToken(window.UJI_ID_TOKEN);
    try {
      await muatGis();
      google.accounts.id.initialize({
        client_id: KONFIG.GOOGLE_CLIENT_ID, callback: (r) => terimaIdToken(r.credential),
        auto_select: true, cancel_on_tap_outside: false, use_fedcm_for_prompt: true,
      });
      google.accounts.id.renderButton($('butangGoogle'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'ms' });
      google.accounts.id.prompt();
    } catch (e) { ralatMasuk(e.message); }
  }
  function tamatSesi() { sesi = null; simpanSesi(null); tunjukLogMasuk(); }
  $('logKeluar').addEventListener('click', async () => {
    try { await api('auth.keluar'); } catch (e) { /* abaikan */ }
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    tamatSesi();
  });

  // --- Borang ---
  function setRalat(t) { $('ralatUtama').textContent = t || ''; $('ralatUtama').hidden = !t; }
  function setKemajuan(t) { $('kemajuan').textContent = t || ''; }
  function setRuj(teks, amaran, betul, butiran) {
    $('kotakRuj').hidden = !teks;
    $('kotakRuj').classList.toggle('amaran', amaran);
    $('teksRuj').textContent = teks || '';
    $('teksButiran').textContent = butiran || '';
    $('butangBetul').hidden = !betul;
  }
  function isiButiran(r) {
    $('isiTajuk').value = r.tajuk || '';
    $('isiTarikh').value = r.tarikh || '';
    $('isiTempat').value = r.tempat || '';
    $('isiMula').value = r.masa_mula || '';
    $('isiTamat').value = r.masa_tamat || '';
  }

  function binaJawatan(senarai, semuaGuru) {
    $('jawatan').replaceChildren(...senarai.map((nama) => {
      const label = el('label');
      const kotak = el('input');
      kotak.type = 'checkbox'; kotak.name = 'jawatan'; kotak.value = nama;
      if (nama === semuaGuru) {
        kotak.name = 'semua_guru'; kotak.id = 'semuaGuru';
        kotak.addEventListener('change', () => {
          $('guruNama').disabled = kotak.checked;
          if (kotak.checked) $('guruNama').value = '';
        });
      }
      label.append(kotak, el('span', '', nama));
      return label;
    }));
  }

  function binaCadangan(guru) {
    $('cadanganGuru').replaceChildren(...guru.map((nama) => {
      const b = el('button', '', nama);
      b.type = 'button';
      b.addEventListener('click', () => {
        if ($('guruNama').disabled) return;
        const ada = $('guruNama').value.split(',').map((x) => x.trim()).filter(Boolean);
        if (!ada.some((x) => x.toLowerCase() === nama.toLowerCase())) ada.push(nama);
        $('guruNama').value = ada.join(', ');
      });
      return b;
    }));
  }

  function namaMasa() {
    const p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: KONFIG.zon_masa, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
    return 'Surat_' + p.year + p.month + p.day + '-' + p.hour + p.minute;
  }

  /** Kecilkan foto telefon (12 MP) kepada JPEG yang munasabah sebelum dicantum menjadi PDF. */
  async function sediakanGambar(fail) {
    const bmp = await createImageBitmap(fail, { imageOrientation: 'from-image' });
    const skala = Math.min(1, LEBAR_GAMBAR / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * skala);
    c.height = Math.round(bmp.height * skala);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return { blob, lebar: c.width, tinggi: c.height, url: URL.createObjectURL(blob) };
  }

  /** Halaman foto -> satu PDF (lebar A4, ketinggian ikut nisbah foto). */
  async function pdfDaripadaGambar() {
    const dok = await PDFLib.PDFDocument.create();
    for (const g of gambar) {
      const jpg = await dok.embedJpg(await g.blob.arrayBuffer());
      const w = 595.28;
      const h = w * g.tinggi / g.lebar;
      dok.addPage([w, h]).drawImage(jpg, { x: 0, y: 0, width: w, height: h });
    }
    const bait = await dok.save();
    return new File([bait], namaMasa() + '.pdf', { type: 'application/pdf' });
  }

  function failSemasa() {
    return failPilih;
  }

  function paparFail() {
    const ada = gambar.length || failPilih;
    $('pilihSumber').hidden = Boolean(ada);
    $('failDipilih').hidden = !ada;
    $('tambahHalaman').hidden = !gambar.length;
    if (gambar.length) {
      $('namaFail').textContent = 'Gambar surat';
      $('saizFail').textContent = gambar.length + ' halaman';
      $('gambarKecil').replaceChildren(...gambar.map((g) => { const i = el('img'); i.src = g.url; i.alt = 'Halaman'; return i; }));
    } else if (failPilih) {
      $('namaFail').textContent = failPilih.name;
      $('saizFail').textContent = (failPilih.size / 1048576).toFixed(1) + ' MB';
      $('gambarKecil').replaceChildren();
    }
  }

  /** Port baca_surat: lapisan teks PDF dahulu; imbasan/foto dibaca oleh OCR Google. */
  async function bacaSurat(fail) {
    let teks = '';
    if (Cop.sambunganFail(fail.name) === 'pdf') {
      teks = await Cop.teksHalamanPertama(new Uint8Array(await fail.arrayBuffer()));
      const ruj = cariRuj_(teks, false);
      if (ruj) return Object.assign({ ruj, sumber: 'teks', teks }, huraikanMaklumat_(teks));
    }
    for (const dpi of Cop.OCR_DPI) {
      setRuj('Membaca surat dengan OCR Google...', false, false);
      const png = await Cop.imejOcr(fail, dpi);
      const { teks: t } = await api('surat.ocr', { png_b64: keBase64(new Uint8Array(await png.arrayBuffer())) });
      const ruj = cariRuj_(t, true);
      if (ruj) return Object.assign({ ruj, sumber: 'ocr', teks: t }, huraikanMaklumat_(t));
      teks = t || teks;
    }
    return Object.assign({ ruj: null, sumber: null, teks }, huraikanMaklumat_(teks));
  }

  async function analisis(fail) {
    const g = ++giliran;
    analisisSemasa = null;
    $('ruj').value = ''; $('ruj').disabled = true; $('medanRuj').hidden = true;
    isiButiran({});
    setRalat('');
    setRuj('Membaca surat...', false, false);
    $('butangProses').disabled = true;
    try {
      const r = await bacaSurat(fail);
      if (g !== giliran) return;
      analisisSemasa = r;
      isiButiran(r);
      const butiran = [r.tajuk, r.tarikh_teks, r.masa, r.tempat].filter(Boolean).join(' · ');
      if (r.ruj) {
        $('ruj').value = r.ruj;
        const klas = klasifikasi_(r.ruj, MASTER_KOD);
        const namaKod = klas.tajuk || klas.tajuk_induk;
        setRuj(r.ruj + (namaKod ? ' · ' + namaKod : ''), false, true, butiran);
      } else {
        setRuj('Ruj. Kami tidak dikesan. Surat akan disimpan dalam Belum Diklasifikasi.', true, true, butiran);
      }
    } catch (e) {
      if (g !== giliran) return;
      analisisSemasa = Object.assign({ ruj: null, sumber: null }, huraikanMaklumat_(''));
      setRuj(e.message, true, true);
    }
    $('butangProses').disabled = false;
  }

  async function tambahGambar(fail) {
    if (!fail) return;
    try {
      gambar.push(await sediakanGambar(fail));
    } catch (e) {
      setRalat('Gambar tidak dapat dibaca. Cuba lagi.');
      return;
    }
    failPilih = null;
    paparFail();
    // Ruj dan butiran ada pada halaman pertama sahaja.
    if (gambar.length === 1) {
      const f = new File([gambar[0].blob], namaMasa() + '.jpg', { type: 'image/jpeg' });
      analisis(f);
    }
  }

  $('failKamera').addEventListener('change', (e) => { tambahGambar(e.target.files[0]); e.target.value = ''; });
  $('failTambah').addEventListener('change', (e) => { tambahGambar(e.target.files[0]); e.target.value = ''; });
  $('failPilih').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > KONFIG.had_fail_mb * 1048576) { setRalat('Fail melebihi had ' + KONFIG.had_fail_mb + ' MB.'); return; }
    gambar = [];
    failPilih = f;
    paparFail();
    analisis(f);
  });
  $('tukarFail').addEventListener('click', () => kosongkanFail());
  $('butangBetul').addEventListener('click', () => {
    $('ruj').disabled = false; $('medanRuj').hidden = false; $('butiran').open = true; $('ruj').focus();
  });

  function kosongkanFail() {
    giliran++;
    gambar.forEach((g) => URL.revokeObjectURL(g.url));
    gambar = [];
    failPilih = null;
    analisisSemasa = null;
    setRuj('', false, false);
    $('ruj').value = ''; $('ruj').disabled = true; $('medanRuj').hidden = true;
    isiButiran({});
    $('butangProses').disabled = true;
    paparFail();
  }

  function borangBaharu() {
    kosongkanFail();
    $('borang').reset();
    $('guruNama').disabled = false;
    setRalat(''); setKemajuan('');
    $('butiran').open = false;
    $('labelHantar').hidden = !k.kalendar;
    $('hantar').checked = k.kalendar;
    $('paparanHasil').hidden = true;
    $('paparanBorang').hidden = false;
    window.scrollTo(0, 0);
  }

  async function dapatTemplat() {
    if (!templatCop) {
      const t = await api('cop.templat');
      const imej = async (b64) => (b64 ? createImageBitmap(new Blob([dariBase64(b64)], { type: 'image/png' })) : null);
      templatCop = { terima: await imej(t.terima_b64), minit: await imej(t.minit_b64) };
    }
    return templatCop;
  }

  /** Nilai borang yang diisi mengatasi nilai bacaan (web_app.maklumat_borang). */
  function maklumatAkhir(baca) {
    const b = { tajuk: $('isiTajuk').value.trim(), tarikh: $('isiTarikh').value, masa_mula: $('isiMula').value, masa_tamat: $('isiTamat').value, tempat: $('isiTempat').value.trim() };
    const m = { tajuk: baca.tajuk, tarikh: baca.tarikh, tarikh_teks: baca.tarikh_teks, masa_mula: baca.masa_mula, masa_tamat: baca.masa_tamat, tempat: baca.tempat };
    Object.keys(b).forEach((x) => { if (b[x]) m[x] = b[x]; });
    if (m.tarikh !== baca.tarikh) m.tarikh_teks = null;
    return m;
  }

  $('borang').addEventListener('submit', async (e) => {
    e.preventDefault();
    setRalat('');
    if (!gambar.length && !failPilih) return setRalat('Sila ambil gambar atau pilih fail surat.');
    const b = $('butangProses');
    b.disabled = true; b.textContent = 'Sedang memproses...';
    try {
      const fail = gambar.length ? await pdfDaripadaGambar() : failSemasa();
      const baca = analisisSemasa || (await bacaSurat(fail));
      const manual = !$('ruj').disabled && $('ruj').value.trim();
      const semua = $('semuaGuru') && $('semuaGuru').checked;
      const guru = semua ? [SEMUA_GURU] : $('guruNama').value.split(',').map((n) => n.trim()).filter(Boolean);
      const jawatan = [...document.querySelectorAll('input[name=jawatan]:checked')].map((x) => x.value);
      setKemajuan('Menyediakan cop...');
      const hariIni = Cop.hariIniIso();
      const cop = await Cop.copSurat(fail, {
        templat: await dapatTemplat(), tarikhTerima: hariIni, jawatan, guru,
        // Halaman tandatangan pengirim: teks halaman 1 sudah dibaca; halaman imbasan lain dibaca OCR.
        teksHalaman1: baca.teks || '',
        ocr: async (png) => (await api('surat.ocr', { png_b64: keBase64(new Uint8Array(await png.arrayBuffer())) })).teks,
      });
      setKemajuan('Menyimpan ke Drive dan menghantar ke Telegram...');
      const h = await api('surat.proses', {
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^A-Za-z0-9]/g, '').slice(0, 32),
        nama_batang: cop.nama_batang, sambungan: cop.sambungan, jenis_mime: cop.jenis, fail_b64: keBase64(cop.bait),
        ruj: manual || baca.ruj || '', maklumat: maklumatAkhir(baca), jawatan, guru: semua ? [] : guru, semua_guru: semua,
        jenis: $('isiJenis').value, daripada: $('isiDaripada').value.trim(), minit_ringkas: $('isiMinit').value.trim(),
        ke_kalendar: $('hantar').checked, tarikh_terima: hariIni,
      });
      if (!manual && baca.sumber === 'ocr') h.amaran = (h.amaran || []).concat(['Ruj dibaca oleh OCR. Sila semak.']);
      setKemajuan('');
      await paparHasil(h, cop);
    } catch (err) {
      setKemajuan('');
      setRalat(err.message);
    } finally {
      b.disabled = false; b.textContent = 'Proses Surat';
    }
  });

  function baris(status, label, isi) {
    const li = el('li');
    li.append(el('span', 's-' + status, { berjaya: '✓', gagal: '✕', dilangkau: '–' }[status]), el('span', '', label), el('span', 'isi', isi));
    return li;
  }

  async function paparHasil(h, cop) {
    const s = h.surat;
    const letak = [];
    if (cop.penempatan.terima) letak.push('Terima hal. ' + cop.penempatan.terima.halaman);
    if (cop.penempatan.minit) letak.push('Minit hal. ' + cop.penempatan.minit.halaman + (cop.penempatan.minit.tandatangan ? ' (tandatangan)' : ''));
    const senarai = [baris('berjaya', 'Cop', letak.join(', '))];
    senarai.push(s.kod ? baris('berjaya', 'Ruj', s.ruj) : baris('dilangkau', 'Ruj', 'Tidak dikesan'));
    senarai.push(baris('berjaya', 'Tindakan', (s.tindakan || []).join(', ') || '-'));
    senarai.push(baris('berjaya', 'Arkib', h.laluan || ''));
    const amaran = (h.amaran || []).concat(cop.amaran || []);
    if (amaran.length) senarai.push(baris('dilangkau', 'Amaran', amaran.join(' ')));
    senarai.push(baris(h.telegram.status, 'Telegram', h.telegram.mesej));
    (h.google.langkah || []).filter((l) => l.label !== 'Drive').forEach((l) => senarai.push(baris(l.status, l.label, l.mesej)));
    $('langkah').replaceChildren(...senarai);
    $('hasilNama').textContent = s.tajuk;
    $('hasilFolder').textContent = s.nama;
    if (urlHasil) URL.revokeObjectURL(urlHasil);
    urlHasil = URL.createObjectURL(new Blob([cop.bait], { type: cop.jenis }));
    $('pautanBuka').href = urlHasil;
    $('pautanBuka').download = s.nama;
    const pdf = cop.jenis === 'application/pdf';
    $('kanvasPratonton').hidden = !pdf;
    $('imejPratonton').hidden = pdf;
    $('paparanBorang').hidden = true;
    $('paparanHasil').hidden = false;
    window.scrollTo(0, 0);
    if (pdf) {
      try {
        await Cop.pratonton(cop.bait, cop.halaman_cop[0] || 1, $('kanvasPratonton'), $('kanvasPratonton').clientWidth || 360);
      } catch (e) { $('kanvasPratonton').hidden = true; }
    } else {
      $('imejPratonton').src = urlHasil;
    }
    // Senarai guru mungkin bertambah.
    muatGuru();
  }
  $('suratLagi').addEventListener('click', borangBaharu);

  async function muatGuru() {
    try {
      const n = await api('navigasi', { tahun: 'semua' });
      binaCadangan(n.guru.map((g) => g.nama));
    } catch (e) { /* cadangan bukan wajib */ }
  }

  async function mula() {
    k = await api('konfigurasi');
    if (!PEJABAT.includes(k.pengguna.peranan)) {
      simpanSesi(null);
      sesi = null;
      $('rangka').hidden = true;
      $('layarMasuk').hidden = false;
      $('butangGoogle').hidden = true;
      $('teksMasuk').textContent = '';
      ralatMasuk('Versi telefon ini hanya untuk pentadbir. Sila semak surat melalui Telegram atau papan pemuka.');
      return;
    }
    $('layarMasuk').hidden = true;
    $('rangka').hidden = false;
    $('namaPengguna').textContent = k.pengguna.nama || k.pengguna.emel;
    $('tarikhHari').textContent = k.tarikh;
    binaJawatan(k.jawatan, k.semua_guru);
    borangBaharu();
    muatGuru();
    dapatTemplat().catch(() => {});
  }

  sesi = bacaSesi();
  if (sesi) {
    mula().catch((e) => {
      if (e.kod === 'SESI_TAMAT') return;
      tunjukLogMasuk();
      ralatMasuk(e.message);
    });
  } else {
    tunjukLogMasuk();
  }
})();
