export const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const PASARAN = ['Legi', 'Pahing', 'Pon', 'Wage', 'Kliwon'];

export const NEPTU_HARI: Record<string, number> = {
  Minggu: 5, Senin: 4, Selasa: 3, Rabu: 7, Kamis: 8, Jumat: 6, Sabtu: 9,
};
export const NEPTU_PASARAN: Record<string, number> = {
  Legi: 5, Pahing: 9, Pon: 7, Wage: 4, Kliwon: 8,
};

export const WATAK_WETON: Record<string, string> = {
  Minggu: 'Berjiwa besar, cinta keindahan, dan mudah bergaul.',
  Senin: 'Lembut, pendiam, tapi teguh pendirian.',
  Selasa: 'Pemberani, tegas, dan pekerja keras.',
  Rabu: 'Cerdas, pandai bicara, disukai banyak orang.',
  Kamis: 'Berwibawa, bijaksana, dan bertanggung jawab.',
  Jumat: 'Ramah, dermawan, dan penuh cinta kasih.',
  Sabtu: 'Ambisius, gigih, dan tidak mudah menyerah.',
};

// Ramalan jodoh berdasarkan (neptu1+neptu2) mod 8 (index+1)
export const JODOH_RESULT = [
  { key: 'Pegat', arti: 'Sering bertengkar, hati-hati konflik masalah ekonomi atau perselingkuhan.', pesan: 'Perkuat komunikasi dan sabar.' },
  { key: 'Ratu', arti: 'Pasangan yang sangat cocok, dihormati dan disegani banyak orang.', pesan: 'Jaga terus keharmonisan kalian.' },
  { key: 'Jodoh', arti: 'Benar-benar berjodoh, saling menerima kekurangan dan kelebihan.', pesan: 'Rawat cinta dengan kesetiaan.' },
  { key: 'Topo', arti: 'Awal susah, tapi akhirnya bahagia setelah punya anak dan mapan.', pesan: 'Sabar, bahagia menunggu di depan.' },
  { key: 'Tinari', arti: 'Rumah tangga bahagia, mudah rezeki, sering dapat keberuntungan.', pesan: 'Bersyukur atas rezeki yang mengalir.' },
  { key: 'Padu', arti: 'Sering cekcok, tapi tidak sampai bercerai.', pesan: 'Kendalikan emosi, saling mengalah.' },
  { key: 'Sujanan', arti: 'Rawan perselingkuhan dan pertengkaran.', pesan: 'Bangun kepercayaan dan keterbukaan.' },
  { key: 'Pesthi', arti: 'Rumah tangga rukun, tentram, dan langgeng sampai tua.', pesan: 'Pertahankan komitmen dan kasih sayang.' },
];

export const SHIO_LIST = [
  { nama: 'Monyet', sifat: 'Cerdik, kreatif, dan lincah.', hoki: 'Rezeki dari ide-ide inovatif.' },
  { nama: 'Ayam', sifat: 'Rajin, disiplin, dan percaya diri.', hoki: 'Sukses karena kerja keras.' },
  { nama: 'Anjing', sifat: 'Setia, jujur, dan pelindung.', hoki: 'Dikelilingi sahabat yang tulus.' },
  { nama: 'Babi', sifat: 'Baik hati, tulus, dan sabar.', hoki: 'Rezeki lancar dari relasi baik.' },
  { nama: 'Tikus', sifat: 'Pintar, gesit, dan pandai menabung.', hoki: 'Cocok bisnis kecil yang cepat cuan.' },
  { nama: 'Kerbau', sifat: 'Tekun, sabar, dan pekerja keras.', hoki: 'Sukses lewat konsistensi jangka panjang.' },
  { nama: 'Macan', sifat: 'Berani, karismatik, dan pemimpin alami.', hoki: 'Cocok di posisi memimpin.' },
  { nama: 'Kelinci', sifat: 'Lembut, ramah, dan penuh kasih.', hoki: 'Hidup harmonis dan damai.' },
  { nama: 'Naga', sifat: 'Ambisius, karismatik, dan berbakat.', hoki: 'Sukses besar dan disegani.' },
  { nama: 'Ular', sifat: 'Bijaksana, misterius, dan intuitif.', hoki: 'Sukses lewat strategi cerdik.' },
  { nama: 'Kuda', sifat: 'Enerjik, bebas, dan petualang.', hoki: 'Rezeki dari perjalanan dan relasi luas.' },
  { nama: 'Kambing', sifat: 'Kreatif, artistik, dan penyayang.', hoki: 'Sukses di bidang seni dan kreatif.' },
];

// Shio 1900 = Tikus. offset dari 1900.
export const SHIO_START_YEAR = 1900;
export const SHIO_ORDER = ['Tikus', 'Kerbau', 'Macan', 'Kelinci', 'Naga', 'Ular', 'Kuda', 'Kambing', 'Monyet', 'Ayam', 'Anjing', 'Babi'];
export const ELEMEN_SHIO = ['Logam', 'Logam', 'Air', 'Air', 'Kayu', 'Kayu', 'Api', 'Api', 'Tanah', 'Tanah'];

export const ARTI_NAMA_TEMPLATE = [
  'Membawa cahaya dan harapan bagi sekitarnya.',
  'Sosok pemberani yang tak mudah menyerah.',
  'Penuh kasih sayang dan lembut hati.',
  'Cerdas dan berbakat memimpin.',
  'Pembawa keberuntungan dan rezeki.',
  'Jiwa bebas yang penuh kreativitas.',
  'Setia, tulus, dan berhati mulia.',
  'Bijaksana melampaui usianya.',
  'Karismatik dan disukai banyak orang.',
  'Pekerja keras yang tekun mengejar mimpi.',
];

export const SIFAT_POOL = [
  'ramah', 'pekerja keras', 'kreatif', 'jujur', 'ambisius',
  'penyayang', 'humoris', 'pemberani', 'sabar', 'karismatik',
  'setia', 'cerdas', 'mandiri', 'religius', 'bijaksana',
];

export const WARNA_POOL = ['Merah', 'Biru', 'Hijau', 'Kuning', 'Ungu', 'Putih', 'Emas', 'Perak', 'Hitam', 'Oranye'];