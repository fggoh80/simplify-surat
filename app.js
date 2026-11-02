/* S.I.M.P.L.I.F.Y-Surat dalam talian: logik papan pemuka (port templates/index.html). */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const borang = $('borang');
  const BULAN = ['Jan', 'Feb', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'Sep', 'Okt', 'Nov', 'Dis'];
  const KUNCI_SESI = 'simplify-surat-sesi';
  const PEJABAT = ['admin', 'kerani'];

  let sesi = null;
  let pengguna = null;
  let k = null; // konfigurasi pelayan
  let semasa = { bait: null, jenis: '', hal: 1, jumlah: 1, nama: '', url: '' };
  let giliranAnalisis = 0;
  let analisisSemasa = null;
  let penapis = { jenis: '', nilai: '', label: 'Semua surat' };
  let tahunAktif = '';
  let senaraiSurat = [];
  let tabAktif = '';
  let templatCop = null;
  let suratDibuka = null;
  const simpananFail = new Map();
  const kodTerbuka = new Set();

  // --- Storan sesi (pelayar sahaja; boleh gagal dalam mod peribadi) ---
  function bacaSesi() {
    try {
      const s = JSON.parse(localStorage.getItem(KUNCI_SESI) || 'null');
      return s && s.tamat > Date.now() ? s : null;
    } catch (e) {
      return null;
    }
  }
  function simpanSesi(s) {
    try {
      if (s) localStorage.setItem(KUNCI_SESI, JSON.stringify(s)); else localStorage.removeItem(KUNCI_SESI);
    } catch (e) { /* abaikan */ }
  }

  // --- API ---
  class RalatApi extends Error {
    constructor(kod, mesej) { super(mesej); this.kod = kod; }
  }

  async function api(tindakan, data) {
    if (!KONFIG.API_URL) throw new RalatApi('BELUM_DITETAPKAN', 'API_URL belum diisi dalam js/konfig.js.');
    let jawapan;
    try {
      jawapan = await fetch(KONFIG.API_URL, {
        method: 'POST',
        // text/plain mengelakkan preflight CORS yang tidak dilayan oleh Apps Script.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ tindakan, data: data || {}, sesi: sesi && sesi.sesi }),
      });
    } catch (e) {
      throw new RalatApi('RANGKAIAN', 'Tidak dapat menghubungi pelayan. Semak sambungan internet.');
    }
    let hasil;
    try {
      hasil = await jawapan.json();
    } catch (e) {
      throw new RalatApi('RALAT_DALAMAN', 'Pelayan memberi jawapan tidak sah.');
    }
    if (!hasil.ok) {
      if (hasil.kod === 'SESI_TAMAT') tamatSesi();
      throw new RalatApi(hasil.kod, hasil.ralat || 'Permintaan gagal.');
    }
    return hasil.data;
  }

  function el(tag, kelas, teks) {
    const e = document.createElement(tag);
    if (kelas) e.className = kelas;
    if (teks !== undefined) e.textContent = teks;
    return e;
  }

  function keBase64(bait) {
    let s = '';
    for (let i = 0; i < bait.length; i += 0x8000) s += String.fromCharCode.apply(null, bait.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function dariBase64(b64) {
    const s = atob(b64);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  const pejabat = () => pengguna && PEJABAT.includes(pengguna.peranan);
  const admin = () => pengguna && pengguna.peranan === 'admin';

  // --- Log masuk ---
  function ralatMasuk(teks) {
    $('ralatMasuk').textContent = teks || '';
    $('ralatMasuk').hidden = !teks;
  }

  async function terimaIdToken(idToken) {
    ralatMasuk('');
    $('teksMasuk').textContent = 'Menyemak akaun...';
    try {
      const h = await api('auth.google', { id_token: idToken });
      sesi = { sesi: h.sesi, tamat: Date.now() + (h.tamat_saat - 120) * 1000, pengguna: h.pengguna };
      simpanSesi(sesi);
      await mulaAplikasi();
    } catch (e) {
      $('teksMasuk').textContent = 'Log masuk dengan akaun Google yang didaftarkan oleh pentadbir.';
      ralatMasuk(e.message);
    }
  }

  function muatGis() {
    return new Promise((lulus, gagal) => {
      if (window.google && google.accounts && google.accounts.id) return lulus();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = lulus;
      s.onerror = () => gagal(new Error('Log masuk Google tidak dapat dimuatkan. Semak sambungan internet.'));
      document.head.append(s);
    });
  }

  async function tunjukLogMasuk() {
    $('rangka').hidden = true;
    $('layarMasuk').hidden = false;
    // Ujian automatik: token palsu disuntik terus.
    if (window.UJI_ID_TOKEN) return terimaIdToken(window.UJI_ID_TOKEN);
    if (!KONFIG.GOOGLE_CLIENT_ID || !KONFIG.API_URL) {
      ralatMasuk('Sistem belum ditetapkan: isi API_URL dan GOOGLE_CLIENT_ID dalam js/konfig.js.');
      return;
    }
    try {
      await muatGis();
      google.accounts.id.initialize({
        client_id: KONFIG.GOOGLE_CLIENT_ID,
        callback: (r) => terimaIdToken(r.credential),
        auto_select: true,
        cancel_on_tap_outside: false,
        use_fedcm_for_prompt: true,
      });
      google.accounts.id.renderButton($('butangGoogle'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'ms' });
      google.accounts.id.prompt();
    } catch (e) {
      ralatMasuk(e.message);
    }
  }

  function tamatSesi() {
    sesi = null;
    simpanSesi(null);
    tunjukLogMasuk();
  }

  $('logKeluar').addEventListener('click', async () => {
    try { await api('auth.keluar'); } catch (e) { /* sesi mungkin sudah tamat */ }
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    tamatSesi();
  });

  function tunjuk(paparan) {
    ['paparanSenarai', 'paparanBorang', 'paparanHasil'].forEach((id) => { $(id).hidden = id !== paparan; });
    $('ruangUtama').scrollTop = 0;
    window.scrollTo(0, 0);
  }

  // --- Navigasi ---
  function butangNav(label, bil, jenis, nilai) {
    const b = el('button', 'nav');
    b.type = 'button';
    b.dataset.jenis = jenis; b.dataset.nilai = nilai;
    if (penapis.jenis === jenis && penapis.nilai === nilai) b.classList.add('aktif');
    b.append(el('span', 'teks', label), el('span', 'bil', bil));
    b.title = label;
    b.addEventListener('click', () => pilihPenapis(jenis, nilai, label));
    return b;
  }

  function nodKod(n) {
    const kotak = el('div');
    const baris = el('div', 'nod');
    const ada = n.anak.length > 0;
    const togol = el('button', 'togol', ada ? (kodTerbuka.has(n.kod) ? '▾' : '▸') : '');
    togol.type = 'button';
    togol.tabIndex = ada ? 0 : -1;
    if (ada) togol.setAttribute('aria-label', 'Kembangkan ' + n.kod);
    baris.append(togol, butangNav(n.tajuk ? n.kod + ' ' + n.tajuk : n.kod, n.bil, 'kod', n.kod));
    kotak.append(baris);
    if (ada) {
      const anak = el('div', 'pokok');
      anak.hidden = !kodTerbuka.has(n.kod);
      n.anak.forEach((a) => anak.append(nodKod(a)));
      kotak.append(anak);
      togol.addEventListener('click', () => {
        if (kodTerbuka.has(n.kod)) kodTerbuka.delete(n.kod); else kodTerbuka.add(n.kod);
        anak.hidden = !kodTerbuka.has(n.kod);
        togol.textContent = anak.hidden ? '▸' : '▾';
      });
    }
    return kotak;
  }

  function kumpulan(tajuk, kandungan) {
    const d = el('details', 'kumpulan');
    d.open = true;
    d.append(el('summary', '', tajuk), ...kandungan);
    return d;
  }

  function pilihanTahun(nilai, label) {
    const o = el('option', '', label);
    o.value = nilai;
    return o;
  }

  async function muatNavigasi() {
    const n = await api('navigasi', { tahun: tahunAktif });
    $('pilihTahun').replaceChildren(...n.tahun.map((t) => pilihanTahun(t, t)), pilihanTahun('semua', 'Semua Tahun'));
    $('pilihTahun').value = tahunAktif;
    const orang = n.jawatan.map((j) => butangNav(j.nama, j.bil, 'jawatan', j.nama));
    orang.push(el('div', 'sub', 'Guru'), butangNav('Semua Guru', n.semua_guru, 'guru', 'Semua Guru'), ...n.guru.map((g) => butangNav(g.nama, g.bil, 'guru', g.nama)));
    const kod = n.kod.map(nodKod);
    if (n.tiada_kod) kod.push(butangNav('Belum diklasifikasi', n.tiada_kod, 'kod', 'tiada'));
    const bulan = n.bulan.length ? n.bulan.map((b) => butangNav(b.label, b.bil, 'bulan', b.kunci)) : [el('div', 'sub', 'Belum ada surat')];
    $('navigasi').replaceChildren(
      butangNav('Semua surat', n.jumlah, '', ''),
      kumpulan('Guru / Jawatan', orang),
      kumpulan('Kod Arkib', kod),
      kumpulan('Bulan', bulan),
    );
    $('senaraiGuru').replaceChildren(...n.guru.map((g) => { const o = el('option'); o.value = g.nama; return o; }));
  }

  // --- Senarai ---
  async function muatSenarai() {
    const tapis = penapis.jenis ? { [penapis.jenis]: penapis.nilai } : {};
    senaraiSurat = await api('surat.senarai', Object.assign({ tahun: tahunAktif }, tapis));
    paparSenarai();
  }

  function pilihPenapis(jenis, nilai, label) {
    penapis = { jenis, nilai, label };
    tabAktif = '';
    $('navigasi').querySelectorAll('.nav').forEach((b) => {
      b.classList.toggle('aktif', b.dataset.jenis === jenis && b.dataset.nilai === nilai);
    });
    tunjuk('paparanSenarai');
    $('kiraan').textContent = 'Memuatkan...';
    muatSenarai().catch((e) => { $('kiraan').textContent = e.message; });
  }

  function formatTarikh(iso) {
    const [y, m, d] = iso.split('-');
    return d + '.' + m + '.' + y;
  }

  function paparSenarai() {
    $('tajukSenarai').textContent = penapis.label;
    const kunci = [...new Set(senaraiSurat.map((r) => r.tarikh_papar.slice(0, 7)))].sort().reverse();
    if (tabAktif && !kunci.includes(tabAktif)) tabAktif = '';
    const tab = $('tabBulan');
    // Tab bulan berguna hanya apabila senarai merangkumi lebih daripada satu bulan.
    tab.hidden = penapis.jenis === 'bulan' || kunci.length < 2;
    const butangTab = (label, nilai) => {
      const b = el('button', nilai === tabAktif ? 'aktif' : '', label);
      b.type = 'button';
      b.addEventListener('click', () => { tabAktif = nilai; paparSenarai(); });
      return b;
    };
    tab.replaceChildren(butangTab('Semua', ''), ...kunci.map((x) => butangTab(BULAN[+x.slice(5, 7) - 1] + ' ' + x.slice(0, 4), x)));

    const papar = tabAktif ? senaraiSurat.filter((r) => r.tarikh_papar.startsWith(tabAktif)) : senaraiSurat;
    $('kiraan').textContent = papar.length + ' surat · ' + (tahunAktif === 'semua' ? 'Semua Tahun' : tahunAktif);
    if (!papar.length) {
      const td = el('td', 'kosong', 'Tiada surat dalam kategori ini.');
      td.colSpan = 5;
      const tr = el('tr'); tr.append(td);
      $('badanJadual').replaceChildren(tr);
      return;
    }
    $('badanJadual').replaceChildren(...papar.map(barisSurat));
  }

  function barisSurat(r) {
    const tr = el('tr');
    const tajuk = el('td', 'tajuk', r.tajuk);
    if (r.ruj) tajuk.append(el('span', 'kecil', r.ruj));
    const lencana = r.tindakan.map((n) => el('span', 'lencana orang', n));
    if (r.kod) lencana.unshift(el('span', 'lencana kod', r.kod));
    if (lencana.length) {
      const barisan = el('div', 'lencana-baris');
      barisan.append(...lencana);
      tajuk.append(barisan);
    }
    const aksi = el('td', 'aksi');
    const lihat = el('button', 'butang', 'Pratonton');
    lihat.type = 'button';
    lihat.addEventListener('click', () => bukaArkib(r).catch((e) => alertRalat(e)));
    const muat = el('button', 'butang', 'Muat Turun');
    muat.type = 'button';
    muat.style.marginLeft = '6px';
    muat.addEventListener('click', async () => {
      muat.disabled = true;
      try {
        const f = await failSurat(r);
        muatTurun(f.bait, f.jenis, r.nama);
      } catch (e) {
        alertRalat(e);
      } finally {
        muat.disabled = false;
      }
    });
    aksi.append(lihat, muat);
    tr.append(el('td', 'tarikh', r.tarikh_teks || formatTarikh(r.tarikh_papar)), tajuk,
      el('td', '', r.tempat || '-'), el('td', 'masa', r.masa || '-'), aksi);
    return tr;
  }

  function alertRalat(e) {
    $('kiraan').textContent = e.message;
  }

  // --- Fail dan pratonton ---
  async function failSurat(r) {
    if (simpananFail.has(r.id)) return simpananFail.get(r.id);
    const f = await api('surat.fail', { id: r.id });
    const hasil = { bait: dariBase64(f.fail_b64), jenis: f.jenis_mime };
    simpananFail.set(r.id, hasil);
    return hasil;
  }

  function muatTurun(bait, jenis, nama) {
    const url = URL.createObjectURL(new Blob([bait], { type: jenis }));
    const a = el('a');
    a.href = url;
    a.download = nama;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function setHalaman(h) {
    semasa.hal = h;
    $('labelHal').textContent = 'Halaman ' + h + ' daripada ' + semasa.jumlah;
    $('kawalanHal').hidden = semasa.jumlah < 2;
    $('halSebelum').disabled = h <= 1;
    $('halSeterus').disabled = h >= semasa.jumlah;
    if (semasa.jenis !== 'application/pdf') return;
    const kanvas = $('kanvasPratonton');
    try {
      semasa.jumlah = await Cop.pratonton(semasa.bait, h, kanvas, kanvas.clientWidth || 600);
      $('labelHal').textContent = 'Halaman ' + h + ' daripada ' + semasa.jumlah;
      $('kawalanHal').hidden = semasa.jumlah < 2;
      $('halSeterus').disabled = h >= semasa.jumlah;
    } catch (e) {
      $('labelHal').textContent = e.message;
    }
  }

  function paparFail(bait, jenis, nama, folder, jumlah, halaman) {
    if (semasa.url) URL.revokeObjectURL(semasa.url);
    const url = URL.createObjectURL(new Blob([bait], { type: jenis }));
    semasa = { bait, jenis, hal: halaman, jumlah, nama, url };
    $('hasilNama').textContent = nama;
    $('hasilFolder').textContent = 'Arkib: ' + folder;
    $('pautanBuka').href = url;
    $('pautanMuat').href = url;
    $('pautanMuat').download = semasa.namaFail || nama;
    const pdf = jenis === 'application/pdf';
    $('kanvasPratonton').hidden = !pdf;
    $('imejPratonton').hidden = pdf;
    if (!pdf) $('imejPratonton').src = url;
    tunjuk('paparanHasil');
    setHalaman(halaman);
  }

  async function bukaArkib(r) {
    suratDibuka = r;
    $('langkah').replaceChildren();
    $('memuatPratonton').hidden = false;
    $('kanvasPratonton').hidden = true;
    $('imejPratonton').hidden = true;
    $('kawalanHal').hidden = true;
    $('hasilNama').textContent = r.tajuk;
    $('hasilFolder').textContent = 'Arkib: ' + r.nama;
    $('pautanDrive').hidden = !(pejabat() && r.drive_pautan);
    $('pautanDrive').href = r.drive_pautan || '#';
    $('butangPadam').hidden = !admin();
    tunjuk('paparanHasil');
    try {
      const f = await failSurat(r);
      semasa.namaFail = r.nama;
      paparFail(f.bait, f.jenis, r.tajuk, r.nama, 1, 1);
      $('pautanMuat').download = r.nama;
    } finally {
      $('memuatPratonton').hidden = true;
    }
  }

  function baris(status, label, isi) {
    const li = el('li');
    const s = el('span', 's-' + status, { berjaya: '✓', gagal: '✕', dilangkau: '–' }[status]);
    li.append(s, el('span', '', label), el('span', 'isi', isi));
    return li;
  }

  function paparHasil(h, cop, bait, jenis) {
    const s = h.surat;
    const letak = [];
    if (cop.penempatan.terima) letak.push('Terima hal. ' + cop.penempatan.terima.halaman);
    if (cop.penempatan.minit) letak.push('Minit hal. ' + cop.penempatan.minit.halaman + (cop.penempatan.minit.tandatangan ? ' (tandatangan)' : ''));
    const senarai = [baris('berjaya', 'Cop', letak.join(', '))];
    senarai.push(s.kod ? baris('berjaya', 'Ruj', s.ruj) : baris('dilangkau', 'Ruj', 'Tidak dikesan'));
    senarai.push(baris('berjaya', 'Butiran', [s.tarikh_teks, s.masa, s.tempat].filter(Boolean).join(' · ') || 'Tiada butiran acara'));
    senarai.push(baris('berjaya', 'Arkib', h.laluan || ''));
    const amaran = (h.amaran || []).concat(cop.amaran || []);
    if (amaran.length) senarai.push(baris('dilangkau', 'Amaran', amaran.join(' ')));
    senarai.push(baris(h.telegram.status, 'Telegram', h.telegram.mesej));
    (h.google.langkah || []).filter((l) => l.label !== 'Drive').forEach((l) => senarai.push(baris(l.status, l.label, l.mesej)));
    $('langkah').replaceChildren(...senarai);
    suratDibuka = s;
    $('pautanDrive').hidden = !s.drive_pautan;
    $('pautanDrive').href = s.drive_pautan || '#';
    $('butangPadam').hidden = !admin();
    semasa.namaFail = s.nama;
    simpananFail.set(s.id, { bait, jenis });
    paparFail(bait, jenis, s.tajuk, h.folder || s.folder, cop.halaman, cop.halaman_cop[0] || 1);
    $('pautanMuat').download = s.nama;
  }

  $('butangPadam').addEventListener('click', async () => {
    const r = suratDibuka;
    if (!r || !window.confirm('Padam "' + r.tajuk + '"?\nRekod dibuang dan fail Drive dipindah ke Sampah (boleh dipulihkan dari Sampah Drive dalam 30 hari).')) return;
    try {
      await api('surat.padam', { id: r.id });
      simpananFail.delete(r.id);
      tunjuk('paparanSenarai');
      await Promise.all([muatNavigasi(), muatSenarai()]);
    } catch (e) {
      $('labelHal').textContent = e.message;
    }
  });

  // --- Borang ---
  function binaJawatan(senarai, semuaGuru) {
    $('jawatan').replaceChildren(...senarai.map((nama) => {
      const label = el('label');
      const kotak = el('input');
      kotak.type = 'checkbox'; kotak.name = 'jawatan'; kotak.value = nama;
      if (nama === semuaGuru) {
        kotak.name = 'semua_guru'; kotak.value = '1'; kotak.id = 'semuaGuru';
        kotak.addEventListener('change', setSemuaGuru);
      }
      label.append(kotak, el('span', '', nama));
      return label;
    }));
  }

  // Semua Guru sudah merangkumi setiap guru; nama individu tidak diperlukan.
  function setSemuaGuru() {
    $('guruNama').disabled = $('semuaGuru').checked;
    if ($('semuaGuru').checked) $('guruNama').value = '';
  }

  function setRalat(teks) { $('ralatUtama').textContent = teks || ''; $('ralatUtama').hidden = !teks; }
  function setKemajuan(teks) { $('kemajuan').textContent = teks || ''; }
  function setRuj(teks, amaran, betul, butiran) {
    $('kotakRuj').hidden = !teks;
    $('kotakRuj').classList.toggle('amaran', amaran);
    $('teksRuj').textContent = teks || '';
    $('teksButiran').textContent = butiran || '';
    $('butangBetul').hidden = !betul;
  }

  // Ruj dihantar sebagai manual hanya selepas Betulkan; jika tidak, Ruj bacaan digunakan bersama sumbernya.
  function tutupRuj() {
    $('ruj').value = '';
    $('ruj').disabled = true;
    $('medanRuj').hidden = true;
  }

  function isiButiran(r) {
    $('isiTajuk').value = r.tajuk || '';
    $('isiTarikh').value = r.tarikh || '';
    $('isiTempat').value = r.tempat || '';
    $('isiMula').value = r.masa_mula || '';
    $('isiTamat').value = r.masa_tamat || '';
  }

  /** Port baca_surat: lapisan teks PDF dahulu; imbasan dibaca oleh OCR Google (250 kemudian 300 dpi). */
  async function bacaSurat(fail) {
    const kosong = Object.assign({ ruj: null, sumber: null }, huraikanMaklumat_(''));
    let teks = '';
    const pdf = Cop.sambunganFail(fail.name) === 'pdf';
    if (pdf) {
      teks = await Cop.teksHalamanPertama(new Uint8Array(await fail.arrayBuffer()));
      const ruj = cariRuj_(teks, false);
      if (ruj) return Object.assign({ ruj, sumber: 'teks', teks }, huraikanMaklumat_(teks));
    }
    for (const dpi of Cop.OCR_DPI) {
      setRuj('Membaca imbasan dengan OCR Google (' + dpi + ' dpi)...', false, false);
      const png = await Cop.imejOcr(fail, dpi);
      const b = new Uint8Array(await png.arrayBuffer());
      const { teks: teksOcr } = await api('surat.ocr', { png_b64: keBase64(b) });
      const ruj = cariRuj_(teksOcr, true);
      if (ruj) return Object.assign({ ruj, sumber: 'ocr', teks: teksOcr }, huraikanMaklumat_(teksOcr));
      // Ruj mungkin tertutup cop, tetapi butiran lain masih berguna.
      teks = teksOcr || teks;
    }
    return Object.assign(kosong, { teks }, huraikanMaklumat_(teks));
  }

  async function analisis(fail) {
    const giliran = ++giliranAnalisis;
    analisisSemasa = null;
    tutupRuj();
    isiButiran({});
    $('zon').classList.add('ada');
    $('zonTajuk').textContent = fail.name;
    $('zonKecil').textContent = (fail.size / 1048576).toFixed(1) + ' MB. Klik untuk menukar.';
    setRalat('');
    setKemajuan('');
    setRuj('Membaca surat...', false, false);
    $('butangProses').disabled = true;
    if (fail.size > KONFIG.had_fail_mb * 1048576) {
      setRuj('Fail melebihi had ' + KONFIG.had_fail_mb + ' MB.', true, false);
      return;
    }
    try {
      const r = await bacaSurat(fail);
      if (giliran !== giliranAnalisis) return;
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
      if (giliran !== giliranAnalisis) return;
      analisisSemasa = Object.assign({ ruj: null, sumber: null }, huraikanMaklumat_(''));
      setRuj(e.message, true, true);
    }
    $('butangProses').disabled = false;
  }

  function borangBaharu() {
    giliranAnalisis++;
    analisisSemasa = null;
    borang.reset();
    setSemuaGuru();
    $('zon').classList.remove('ada');
    $('zonTajuk').textContent = 'Seret surat ke sini';
    $('zonKecil').textContent = 'atau klik untuk memilih fail PDF atau imej';
    setRuj('', false, false);
    setRalat('');
    setKemajuan('');
    tutupRuj();
    $('butangProses').disabled = true;
    $('labelHantar').hidden = !k.kalendar;
    $('hantar').checked = k.kalendar;
    tunjuk('paparanBorang');
  }

  const zon = $('zon');
  ['dragenter', 'dragover'].forEach((n) => zon.addEventListener(n, (e) => { e.preventDefault(); zon.classList.add('atas'); }));
  ['dragleave', 'drop'].forEach((n) => zon.addEventListener(n, (e) => { e.preventDefault(); zon.classList.remove('atas'); }));
  zon.addEventListener('drop', (e) => {
    if (!e.dataTransfer.files.length) return;
    $('fail').files = e.dataTransfer.files;
    analisis($('fail').files[0]);
  });
  $('fail').addEventListener('change', () => { if ($('fail').files[0]) analisis($('fail').files[0]); });
  $('butangBetul').addEventListener('click', () => {
    $('ruj').disabled = false;
    $('medanRuj').hidden = false;
    $('butiran').open = true;
    $('ruj').focus();
  });

  async function dapatTemplat() {
    if (!templatCop) {
      const t = await api('cop.templat');
      const imej = async (b64) => (b64 ? createImageBitmap(new Blob([dariBase64(b64)], { type: 'image/png' })) : null);
      templatCop = { terima: await imej(t.terima_b64), minit: await imej(t.minit_b64) };
    }
    return templatCop;
  }

  /** Port web_app.maklumat_borang: nilai borang yang diisi mengatasi nilai bacaan. */
  function maklumatAkhir(baca) {
    const borangan = {
      tajuk: $('isiTajuk').value.trim(), tarikh: $('isiTarikh').value, masa_mula: $('isiMula').value,
      masa_tamat: $('isiTamat').value, tempat: $('isiTempat').value.trim(),
    };
    const m = {
      tajuk: baca.tajuk, tarikh: baca.tarikh, tarikh_teks: baca.tarikh_teks, masa_mula: baca.masa_mula,
      masa_tamat: baca.masa_tamat, tempat: baca.tempat,
    };
    Object.keys(borangan).forEach((x) => { if (borangan[x]) m[x] = borangan[x]; });
    // Tarikh yang diubah dalam borang: teks tarikh asal surat tidak lagi sepadan.
    if (m.tarikh !== baca.tarikh) m.tarikh_teks = null;
    return m;
  }

  borang.addEventListener('submit', async (e) => {
    e.preventDefault();
    setRalat('');
    const fail = $('fail').files[0];
    if (!fail) return setRalat('Sila pilih fail surat.');
    const b = $('butangProses');
    b.disabled = true; b.textContent = 'Sedang memproses...';
    try {
      const baca = analisisSemasa || (await bacaSurat(fail));
      const manual = !$('ruj').disabled && $('ruj').value.trim();
      const ruj = manual || baca.ruj || '';
      const semua = $('semuaGuru') && $('semuaGuru').checked;
      const guru = semua ? [SEMUA_GURU] : $('guruNama').value.split(',').map((n) => n.trim()).filter(Boolean);
      const jawatan = [...borang.querySelectorAll('input[name=jawatan]:checked')].map((x) => x.value);
      setKemajuan('Menyediakan cop...');
      const hariIni = Cop.hariIniIso();
      const cop = await Cop.copSurat(fail, {
        templat: await dapatTemplat(), tarikhTerima: hariIni, jawatan, guru,
        // Halaman tandatangan pengirim: teks halaman 1 sudah dibaca; halaman imbasan lain dibaca OCR.
        teksHalaman1: baca.teks || '',
        ocr: async (png) => (await api('surat.ocr', { png_b64: keBase64(new Uint8Array(await png.arrayBuffer())) })).teks,
      });
      setKemajuan('Menyimpan ke Drive dan menghantar makluman...');
      const h = await api('surat.proses', {
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^A-Za-z0-9]/g, '').slice(0, 32),
        nama_batang: cop.nama_batang, sambungan: cop.sambungan, jenis_mime: cop.jenis, fail_b64: keBase64(cop.bait),
        ruj, maklumat: maklumatAkhir(baca), jawatan, guru: semua ? [] : guru, semua_guru: semua,
        jenis: $('isiJenis').value, daripada: $('isiDaripada').value.trim(), minit_ringkas: $('isiMinit').value.trim(),
        ke_kalendar: $('hantar').checked, tarikh_terima: hariIni,
      });
      if (!manual && baca.sumber === 'ocr') h.amaran = (h.amaran || []).concat(['Ruj dibaca oleh OCR. Sila semak kod sebelum menyimpan rekod.']);
      setKemajuan('');
      paparHasil(h, cop, cop.bait, cop.jenis);
      await Promise.all([muatNavigasi(), muatSenarai()]);
    } catch (err) {
      setKemajuan('');
      setRalat(err.message);
    } finally {
      b.disabled = false; b.textContent = 'Proses Surat';
    }
  });

  $('baharu').addEventListener('click', borangBaharu);
  $('pilihTahun').addEventListener('change', async (e) => {
    tahunAktif = e.target.value;
    tabAktif = '';
    // Bulan terikat kepada tahun; kategori lain kekal merentas tahun.
    if (penapis.jenis === 'bulan') penapis = { jenis: '', nilai: '', label: 'Semua surat' };
    await Promise.all([muatNavigasi(), muatSenarai()]).catch((err) => { $('kiraan').textContent = err.message; });
  });
  $('kembali').addEventListener('click', () => tunjuk('paparanSenarai'));
  $('halSebelum').addEventListener('click', () => setHalaman(semasa.hal - 1));
  $('halSeterus').addEventListener('click', () => setHalaman(semasa.hal + 1));

  // --- Uji Peringatan ---
  const dialogUjian = $('dialogUjian');
  $('bukaUjian').addEventListener('click', async () => {
    $('ralatUjian').hidden = true;
    $('hantarUjian').disabled = true;
    $('kadUjian').textContent = 'Memuatkan...';
    dialogUjian.showModal();
    try {
      const r = await api('peringatan.pratonton');
      const ada = r.status === 'pratonton';
      // Pratonton menunjukkan teks biasa; tag HTML hanya untuk Telegram.
      $('kadUjian').textContent = ada ? r.teks.replace(/<\/?b>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : r.mesej;
      $('hantarUjian').disabled = !ada;
    } catch (e) {
      $('kadUjian').textContent = '';
      $('ralatUjian').textContent = e.message; $('ralatUjian').hidden = false;
    }
  });
  $('tutupUjian').addEventListener('click', () => dialogUjian.close());
  $('hantarUjian').addEventListener('click', async () => {
    const b = $('hantarUjian');
    b.disabled = true; b.textContent = 'Menghantar...';
    $('ralatUjian').hidden = true;
    try {
      const r = await api('peringatan.uji');
      if (r.status === 'berjaya') { dialogUjian.close(); return; }
      $('ralatUjian').textContent = r.mesej; $('ralatUjian').hidden = false;
    } catch (e) {
      $('ralatUjian').textContent = e.message; $('ralatUjian').hidden = false;
    } finally {
      b.disabled = false; b.textContent = 'Hantar ke Telegram';
    }
  });

  // --- Sambungan Google (status pelayan) ---
  // Lampu hijau hanya datang daripada semakan pelayan terhadap Google.
  function paparStatus(s) {
    const hijau = s.keadaan === 'bersambung';
    $('titikGoogle').classList.toggle('ok', hijau);
    $('titikGoogle').classList.toggle('gagal', s.keadaan === 'ralat');
    $('teksGoogle').textContent = hijau ? 'Connected' : s.keadaan === 'ralat' ? 'Ralat' : '';
    $('teksSambungan').textContent = hijau
      ? 'Connected: ' + s.akaun + '. Kalendar ' + (s.kalendar || '-') + '. Arkib ke folder "' + s.folder + '".'
      : 'Sistem berjalan sebagai ' + s.akaun + '. Betulkan perkara bertanda ✕ di bawah.';
    $('senaraiSemakan').replaceChildren(...s.semakan.map((x) => baris(x.status, x.label, x.mesej)));
  }

  async function muatStatus(segar) {
    try {
      paparStatus(await api('sistem.status', { segar: segar === true }));
    } catch (e) {
      $('teksSambungan').textContent = e.message;
      $('titikGoogle').classList.add('gagal');
    }
  }

  const dialog = $('dialogGoogle');
  $('bukaTetapan').addEventListener('click', () => { $('ralatGoogle').hidden = true; dialog.showModal(); muatStatus(true); });
  $('tutupGoogle').addEventListener('click', () => dialog.close());
  $('semakGoogle').addEventListener('click', () => muatStatus(true));

  const hasilAlat = (teks) => { $('hasilAlat').textContent = teks; };
  const alat = (fungsi) => async (e) => {
    $('ralatGoogle').hidden = true;
    hasilAlat('Sedang diproses...');
    try {
      hasilAlat(await fungsi(e));
    } catch (err) {
      hasilAlat('');
      $('ralatGoogle').textContent = err.message; $('ralatGoogle').hidden = false;
    } finally {
      if (e && e.target && e.target.type === 'file') e.target.value = '';
    }
  };
  ['Terima', 'Minit'].forEach((jenis) => {
    $('templat' + jenis).addEventListener('change', alat(async (e) => {
      const f = e.target.files[0];
      if (!f) return '';
      await api('cop.templat.simpan', { jenis: jenis.toLowerCase(), png_b64: keBase64(new Uint8Array(await f.arrayBuffer())) });
      templatCop = null;
      muatStatus(true);
      return 'Templat Cop ' + jenis + ' disimpan.';
    }));
  });
  $('failImport').addEventListener('change', alat(async (e) => {
    const f = e.target.files[0];
    if (!f) return '';
    let db;
    try {
      db = JSON.parse(await f.text());
    } catch (err) {
      throw new Error('Fail ini bukan JSON yang sah.');
    }
    const h = await api('data.import', { db });
    await Promise.all([muatNavigasi(), muatSenarai()]);
    return 'Diimport: ' + h.surat + ' surat (' + h.dilangkau + ' sudah ada), ' + h.kod + ' kod baharu.';
  }));
  $('aktifAutomasi').addEventListener('click', alat(async () => {
    if (!window.confirm('Pastikan papan pemuka di komputer (mula_dashboard.bat) sudah ditutup, jika tidak peringatan akan dihantar dua kali. Teruskan?')) return '';
    paparStatus(await api('automasi.aktif'));
    return 'Peringatan automatik diaktifkan.';
  }));
  $('segerakArkib').addEventListener('click', alat(async () => {
    const h = await api('arkib.segerak');
    await Promise.all([muatNavigasi(), muatSenarai()]);
    return 'Segerak selesai: ' + h.didaftar + ' fail baharu didaftarkan, ' + h.dipadam + ' rekod dibuang (fail tiada di Drive).';
  }));

  // --- Pengguna ---
  const dialogPengguna = $('dialogPengguna');
  async function muatPengguna() {
    const senarai = await api('pengguna.senarai');
    const label = { admin: 'Admin', kerani: 'Kerani', guru: 'Guru' };
    $('badanPengguna').replaceChildren(...senarai.map((p) => {
      const tr = el('tr');
      const td = el('td');
      if (p.emel.toLowerCase() !== pengguna.emel) {
        const buang = el('button', 'butang bahaya', 'Buang');
        buang.type = 'button';
        buang.addEventListener('click', async () => {
          if (!window.confirm('Buang akses ' + p.emel + '?')) return;
          try { await api('pengguna.padam', { emel: p.emel }); await muatPengguna(); } catch (e) { ralatPengguna(e.message); }
        });
        td.append(buang);
      }
      tr.append(el('td', '', p.emel), el('td', '', p.nama || '-'), el('td', '', label[p.peranan] || p.peranan), td);
      return tr;
    }));
  }
  function ralatPengguna(t) { $('ralatPengguna').textContent = t || ''; $('ralatPengguna').hidden = !t; }
  $('bukaPengguna').addEventListener('click', () => { ralatPengguna(''); dialogPengguna.showModal(); muatPengguna().catch((e) => ralatPengguna(e.message)); });
  $('tutupPengguna').addEventListener('click', () => dialogPengguna.close());
  $('borangPengguna').addEventListener('submit', async (e) => {
    e.preventDefault();
    ralatPengguna('');
    try {
      await api('pengguna.simpan', { emel: $('penggunaEmel').value.trim(), nama: $('penggunaNama').value.trim(), peranan: $('penggunaPeranan').value });
      $('borangPengguna').reset();
      await muatPengguna();
    } catch (err) {
      ralatPengguna(err.message);
    }
  });

  // --- Mula ---
  async function mulaAplikasi() {
    k = await api('konfigurasi');
    pengguna = k.pengguna;
    $('layarMasuk').hidden = true;
    $('rangka').hidden = false;
    document.title = k.sistem.nama;
    $('namaSistem').textContent = k.sistem.nama;
    $('namaPenuh').textContent = k.sistem.nama_penuh;
    $('sekolah').textContent = k.sekolah;
    $('tarikhHari').textContent = k.tarikh;
    $('tarikhAtas').textContent = k.tarikh;
    $('namaPengguna').textContent = pengguna.nama || pengguna.emel;
    $('baharu').hidden = !pejabat();
    $('bukaUjian').hidden = !pejabat();
    $('bukaPengguna').hidden = !admin();
    $('alatAdmin').hidden = !admin();
    binaJawatan(k.jawatan, k.semua_guru);
    tahunAktif = k.tahun_semasa;
    muatStatus(false);
    await Promise.all([muatNavigasi(), muatSenarai()]);
  }

  sesi = bacaSesi();
  if (sesi) {
    mulaAplikasi().catch((e) => {
      if (e.kod === 'SESI_TAMAT') return;
      tunjukLogMasuk();
      ralatMasuk(e.message);
    });
  } else {
    tunjukLogMasuk();
  }
})();
