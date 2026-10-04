const barbers = [
  {
    _id: "alex-morgan",
    name: { az: "Alex Morgan", ru: "Alex Morgan", en: "Alex Morgan" },
    role: { az: "Təsisçi · Kəsim və fade", ru: "Основатель · Стрижки и фейды", en: "Founder · Cuts & fades" },
    photo: "photo-1500648767791-00dcc994a43e"
  },
  {
    _id: "jordan-lee",
    name: { az: "Jordan Lee", ru: "Jordan Lee", en: "Jordan Lee" },
    role: { az: "Bərbər · Saç teksturası üzrə", ru: "Барбер · Текстурные стрижки", en: "Barber · Texture specialist" },
    photo: "photo-1506794778202-cad84cf45f1d"
  },
  {
    _id: "sam-rivera",
    name: { az: "Sam Rivera", ru: "Sam Rivera", en: "Sam Rivera" },
    role: { az: "Bərbər · Saqqal dizaynı üzrə", ru: "Барбер · Уход за бородой", en: "Barber · Beard detailing" },
    photo: "photo-1507003211169-0a1dd7228f2d"
  }
];

const services = [
  {
    _id: "signature-cut",
    name: { az: "İmza saç kəsimi", ru: "Фирменная стрижка", en: "The signature cut" },
    description: { az: "Sizə yaraşan, səliqəli saç kəsimi.", ru: "Аккуратная стрижка с учётом ваших пожеланий.", en: "A considered cut, finished to suit you." },
    price: 38,
    durationMinutes: 45
  },
  {
    _id: "cut-and-beard",
    name: { az: "Saç və saqqal", ru: "Стрижка и борода", en: "Cut & beard" },
    description: { az: "Təzə kəsim, dəqiq konturlar və isti dəsmal.", ru: "Свежая стрижка, чёткие контуры и горячее полотенце.", en: "A fresh shape-up, clean lines, hot towel finish." },
    price: 58,
    durationMinutes: 60
  },
  {
    _id: "beard-sculpt",
    name: { az: "Saqqal forması", ru: "Моделирование бороды", en: "Beard sculpt" },
    description: { az: "Saqqalınıza səliqəli forma verək.", ru: "Придадим бороде аккуратную форму.", en: "A little structure goes a long way." },
    price: 30,
    durationMinutes: 30
  },
  {
    _id: "full-reset",
    name: { az: "Tam qulluq", ru: "Полный уход", en: "The full reset" },
    description: { az: "Saç və saqqal kəsimi, yuma və rahatlıq.", ru: "Стрижка, борода, мытьё и время для отдыха.", en: "Cut, beard, rinse, and a moment to breathe." },
    price: 72,
    durationMinutes: 75
  }
];

const business = {
  _id: "main",
  timezone: process.env.SHOP_TIMEZONE || "Asia/Baku",
  currency: "AZN",
  slotIntervalMinutes: 30,
  weeklyHours: {
    2: { open: "09:00", close: "19:00" },
    3: { open: "09:00", close: "19:00" },
    4: { open: "09:00", close: "19:00" },
    5: { open: "09:00", close: "19:00" },
    6: { open: "10:00", close: "17:00" }
  }
};

module.exports = { barbers, services, business };
