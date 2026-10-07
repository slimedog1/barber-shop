const barbers = [
  {
    _id: "alex-morgan",
    name: "Alex Morgan",
    role: "Təsisçi · Kəsim və fade",
    photo: "photo-1500648767791-00dcc994a43e"
  },
  {
    _id: "jordan-lee",
    name: "Jordan Lee",
    role: "Bərbər · Saç teksturası üzrə",
    photo: "photo-1506794778202-cad84cf45f1d"
  },
  {
    _id: "sam-rivera",
    name: "Sam Rivera",
    role: "Bərbər · Saqqal dizaynı üzrə",
    photo: "photo-1507003211169-0a1dd7228f2d"
  }
];

const services = [
  {
    _id: "signature-cut",
    name: "İmza saç kəsimi",
    description: "Sizə yaraşan, səliqəli saç kəsimi.",
    price: 38,
    durationMinutes: 45
  },
  {
    _id: "cut-and-beard",
    name: "Saç və saqqal",
    description: "Təzə kəsim, dəqiq konturlar və isti dəsmal.",
    price: 58,
    durationMinutes: 60
  },
  {
    _id: "beard-sculpt",
    name: "Saqqal forması",
    description: "Saqqalınıza səliqəli forma verək.",
    price: 30,
    durationMinutes: 30
  },
  {
    _id: "full-reset",
    name: "Tam qulluq",
    description: "Saç və saqqal kəsimi, yuma və rahatlıq.",
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
