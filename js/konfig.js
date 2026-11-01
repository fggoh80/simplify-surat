/**
 * Tetapan papan pemuka dalam talian. Salinan bahagian awam Config.json.
 * Token Telegram dan ID Drive/Kalendar TIDAK di sini: semuanya dalam Script Properties Apps Script.
 */
var KONFIG = {
  // Isi selepas deploy Apps Script (Deploy -> Web app -> URL berakhir /exec).
  API_URL: 'https://script.google.com/macros/s/AKfycbw7DuQgt8iZHRaay-XssB8wQNqWfkG_UapAIhVPs3r2pUmOlTp0oJtAinQ4RTEtKJM8kA/exec',
  // OAuth Client ID jenis "Web application" (Google Cloud -> Credentials).
  GOOGLE_CLIENT_ID: '570642787927-jn9l85247pqhu2ab60segibqbmtj89j3.apps.googleusercontent.com',

  sistem: {
    nama: 'S.I.M.P.L.I.F.Y-Surat',
    nama_penuh: 'Sistem Inovasi Minit Penerimaan & Log Integrasi Fail Yang Efisien',
  },
  sekolah: { nama: 'SJKC PEAY MIN', kod: '3912' },
  zon_masa: 'Asia/Kuala_Lumpur',
  had_fail_mb: 30,

  cop: {
    warna: [10, 10, 255, 255],
    warna_isi_minit: [0, 0, 0, 255],
    lebar_piksel: 1200,
    pad_ruang: 4,
    terima: {
      buang_latar_putih: true,
      format_tarikh: 'dd.MM.yyyy',
      cap_masa: { teks: 'By {sekolah} at {masa}, {tarikh}', saiz: 0.05, lebar_maks: 0.84, x: 0.51, y: 0.85 },
      lebar_nisbah: 0.3,
      skala_min: 0.6,
      tinggi_nisbah_cop: 0.5,
      margin_nisbah: 0.03,
      tarikh_xy: [0.51, 0.69],
      tarikh_saiz: 0.07,
    },
    minit: {
      buang_latar_putih: true,
      lebar_nisbah: 0.38,
      skala_min: 0.55,
      tinggi_nisbah_cop: 0.68,
      margin_nisbah: 0.03,
      format_tarikh: 'dd.MM.yyyy',
      tarikh_xy: [0.215, 0.863],
      tarikh_saiz: 0.043,
      kolum_x: { jawatan: 0.04, perhatian: 0.379, tindakan: 0.614 },
      sel_nama: { lebar: 0.21, tinggi: 0.072, saiz_maks: 0.042, saiz_min: 0.024 },
      pengepala_y: 0.21,
      baris: [
        { jawatan: 'GB', y: 0.268 },
        { jawatan: 'PK P', y: 0.352 },
        { jawatan: 'PK HEM', y: 0.436 },
        { jawatan: 'PK KK', y: 0.520 },
        { jawatan: 'Guru', y: 0.603, isi_nama: true },
        { jawatan: 'PT/PO', alias: ['PT', 'PO'], y: 0.687 },
      ],
    },
  },
};
