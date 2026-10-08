require("dotenv").config();

const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { MongoClient, ObjectId } = require("mongodb");
const { DateTime } = require("luxon");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { barbers, services, business } = require("./config/business");

const app = express();
const port = Number(process.env.PORT || 3000);
const mongoUrl = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = process.env.MONGODB_DB || "good_cut";
const shopZone = process.env.SHOP_TIMEZONE || "Asia/Baku";
const intervalMinutes = business.slotIntervalMinutes;
const root = __dirname;
const publicRoot = path.join(root, "public");
const defaultSiteContent = {
  about: {
    kicker: "BİZİMLƏ TANIŞ OLUN",
    title: "Saç kəsimindən daha çoxu.",
    paragraph1: "Good Cut — özünüzə vaxt ayıra, rahat söhbət edə və güzgüdə özünüzü daha yaxşı hiss edə biləcəyiniz bir məkandır.",
    paragraph2: "Hər qonağı diqqətlə dinləyir, ona uyğun üslub seçir və işi səliqə ilə tamamlayırıq. Qapıdan necə gəlirsinizsə, elə də buyurun.",
    note: "Səmimi münasibət. Diqqətli iş. Rahat mühit."
  },
  photos: {
    hero: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=1300&q=90",
    gallery: ["https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1000&q=85", "https://images.unsplash.com/photo-1622287162716-f311baa1a2b8?auto=format&fit=crop&w=1000&q=85"]
  }
};

const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 5000 });
let db;
let appReady;

function localDateTime(date, time, zone = shopZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const value = DateTime.fromISO(`${date}T${time}`, { zone });
  return value.isValid && value.toFormat("yyyy-MM-dd'T'HH:mm") === `${date}T${time}` ? value : null;
}

function dateKey(value) {
  return value.setZone(shopZone).toFormat("yyyy-MM-dd");
}

function isWithinBookingHorizon(value) {
  const currentMonth = DateTime.now().setZone(shopZone).startOf("month");
  return value >= currentMonth && value < currentMonth.plus({ months: 12 });
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function reservedMinutes(duration) {
  return Math.ceil(duration / intervalMinutes) * intervalMinutes;
}

function slotKeys(start, minutes) {
  return Array.from({ length: minutes / intervalMinutes }, (_, i) =>
    start.plus({ minutes: i * intervalMinutes }).toFormat("yyyy-MM-dd'T'HH:mm")
  );
}

function safeEquals(left, right) {
  const a = crypto.createHash("sha256").update(String(left)).digest();
  const b = crypto.createHash("sha256").update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Keep limits shared across serverless instances; HMAC keys and TTL avoid storing raw client IPs indefinitely.
class MongoRateLimitStore {
  constructor(collectionName) {
    this.collectionName = collectionName;
    this.localKeys = false;
    this.windowMs = 15 * 60 * 1000;
    this.indexPromise = null;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  get collection() {
    return db.collection(this.collectionName);
  }

  storageKey(key) {
    return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(key).digest("hex");
  }

  async ensureExpiryIndex() {
    if (!this.indexPromise) {
      this.indexPromise = this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch((error) => {
        this.indexPromise = null;
        throw error;
      });
    }
    await this.indexPromise;
  }

  async increment(key) {
    await this.ensureExpiryIndex();
    const id = this.storageKey(key);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.windowMs);
    const active = await this.collection.findOneAndUpdate(
      { _id: id, expiresAt: { $gt: now } },
      { $inc: { totalHits: 1 } },
      { returnDocument: "after", includeResultMetadata: false }
    );
    if (active) return { totalHits: active.totalHits, resetTime: active.expiresAt };

    await this.collection.updateOne(
      { _id: id, expiresAt: { $lte: now } },
      { $set: { totalHits: 0, expiresAt } }
    );
    try {
      await this.collection.updateOne(
        { _id: id },
        { $setOnInsert: { totalHits: 0, expiresAt } },
        { upsert: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
    }

    const result = await this.collection.findOneAndUpdate(
      { _id: id, expiresAt: { $gt: now } },
      { $inc: { totalHits: 1 } },
      { returnDocument: "after", includeResultMetadata: false }
    );
    if (!result) throw new Error("Could not update the shared rate-limit counter.");
    return { totalHits: result.totalHits, resetTime: result.expiresAt };
  }

  async decrement(key) {
    const id = this.storageKey(key);
    await this.collection.updateOne({ _id: id, totalHits: { $gt: 0 } }, { $inc: { totalHits: -1 } });
  }

  async resetKey(key) {
    const id = this.storageKey(key);
    await this.collection.deleteOne({ _id: id });
  }

  async resetAll() {
    await this.collection.deleteMany({});
  }
}

function serviceName(service) { return typeof service?.name === "string" ? service.name : service?.name?.az || ""; }
function barberName(barber) { return typeof barber?.name === "string" ? barber.name : barber?.name?.az || ""; }

async function seedBusiness() {
  for (const barber of barbers) {
    await db.collection("barbers").updateOne({ _id: barber._id }, { $setOnInsert: barber }, { upsert: true });
    const current = await db.collection("barbers").findOne({ _id: barber._id });
    if (current && typeof current.name !== "string") {
      await db.collection("barbers").updateOne({ _id: barber._id }, { $set: { name: barber.name, role: barber.role, photoUrl: current.photoUrl || `https://images.unsplash.com/${current.photo || barber.photo}?auto=format&fit=crop&w=900&q=85` }, $unset: { photo: "" } });
    } else if (current && !current.photoUrl) {
      await db.collection("barbers").updateOne({ _id: barber._id }, { $set: { photoUrl: `https://images.unsplash.com/${current.photo || barber.photo}?auto=format&fit=crop&w=900&q=85` }, $unset: { photo: "" } });
    }
  }
  for (const current of await db.collection("barbers").find({}).toArray()) {
    const name = typeof current.name === "string" ? current.name : current.name?.az || "Bərbər";
    const role = typeof current.role === "string" ? current.role : current.role?.az || "Bərbər";
    const photoUrl = current.photoUrl || (current.photo ? `https://images.unsplash.com/${current.photo}?auto=format&fit=crop&w=900&q=85` : barbers[0].photo ? `https://images.unsplash.com/${barbers[0].photo}?auto=format&fit=crop&w=900&q=85` : "");
    if (name !== current.name || role !== current.role || photoUrl !== current.photoUrl || current.photo) {
      await db.collection("barbers").updateOne({ _id: current._id }, { $set: { name, role, photoUrl }, $unset: { photo: "" } });
    }
  }
  for (const service of services) {
    await db.collection("services").updateOne({ _id: service._id }, { $setOnInsert: { ...service, active: false } }, { upsert: true });
    const legacy = await db.collection("services").findOne({ _id: service._id });
    if (legacy && (typeof legacy.name !== "string" || legacy.active !== false)) {
      await db.collection("services").updateOne({ _id: service._id }, { $set: { name: service.name, description: service.description, active: false } });
    }
  }
  const storedBarbers = await db.collection("barbers").find({}).toArray();
  for (const barber of storedBarbers) for (const service of services) {
    const barberService = { ...service, _id: `${service._id}-${barber._id}`, barberId: barber._id, active: true };
    await db.collection("services").updateOne({ _id: barberService._id }, { $setOnInsert: barberService }, { upsert: true });
  }
  await db.collection("settings").updateOne({ _id: business._id }, { $setOnInsert: { ...business, timezone: shopZone } }, { upsert: true });
  await db.collection("settings").updateOne({ _id: business._id, siteContent: { $exists: false } }, { $set: { siteContent: defaultSiteContent } });
  await db.collection("appointments").createIndex({ barberId: 1, occupiedSlots: 1 }, { unique: true, name: "unique_barber_occupied_slots" });
  await db.collection("appointments").createIndex({ status: 1, startAt: 1 });
  await db.collection("blocks").createIndex({ barberId: 1, startAt: 1, endAt: 1 });
}

function requireAdmin(req, res, next) {
  if (req.session?.admin) return next();
  return res.status(401).json({ error: "Authentication required." });
}

function checkSameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin && new URL(origin).host !== req.get("host")) return res.status(403).json({ error: "Cross-origin request rejected." });
  next();
}

app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"], imgSrc: ["'self'", "https://images.unsplash.com", "https://res.cloudinary.com", "data:"],
      connectSrc: ["'self'", "https://api.cloudinary.com"], formAction: ["'self'"], baseUri: ["'self'"], frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null
    }
  }
}));
app.use(express.json({ limit: "20kb" }));
app.use((_req, _res, next) => {
  appReady.then(() => next(), next);
});
app.use(session({
  name: "goodcut.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl, dbName, collectionName: "sessions", ttl: 60 * 60 * 8 }),
  cookie: { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
}));

const bookingLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, store: new MongoRateLimitStore("rate_limits_bookings"), standardHeaders: "draft-8", legacyHeaders: false });
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, store: new MongoRateLimitStore("rate_limits_logins"), standardHeaders: "draft-8", legacyHeaders: false });
const availabilityLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, store: new MongoRateLimitStore("rate_limits_availability"), standardHeaders: "draft-8", legacyHeaders: false });

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/catalog", async (_req, res, next) => {
  try {
    const [catalogBarbers, catalogServices, settings] = await Promise.all([
      db.collection("barbers").find({ active: { $ne: false } }).sort({ _id: 1 }).toArray(),
      db.collection("services").find({ active: { $ne: false }, barberId: { $exists: true } }).sort({ barberId: 1, _id: 1 }).toArray(),
      db.collection("settings").findOne({ _id: "main" })
    ]);
    res.json({ barbers: catalogBarbers, services: catalogServices, siteContent: settings.siteContent || defaultSiteContent, timezone: shopZone, currency: "AZN" });
  } catch (error) { next(error); }
});

app.get("/api/availability", availabilityLimit, async (req, res, next) => {
  try {
    const { barberId, serviceId, month } = req.query;
    if (typeof barberId !== "string" || typeof serviceId !== "string" || typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "Choose a barber, service, and valid month." });
    }
    const [barber, service, settings] = await Promise.all([
      db.collection("barbers").findOne({ _id: barberId, active: { $ne: false } }),
      db.collection("services").findOne({ _id: serviceId, barberId, active: { $ne: false } }),
      db.collection("settings").findOne({ _id: "main" })
    ]);
    if (!barber || !service || !settings) return res.status(404).json({ error: "Barber or service was not found." });

    const first = DateTime.fromFormat(`${month}-01`, "yyyy-MM-dd", { zone: shopZone });
    if (!first.isValid || first.toFormat("yyyy-MM") !== month) return res.status(400).json({ error: "Invalid calendar month." });
    if (!isWithinBookingHorizon(first)) return res.status(400).json({ error: "Choose a month within the next 12 months." });
    const monthEnd = first.plus({ months: 1 });
    const monthStartDate = first.startOf("day").toJSDate();
    const monthEndDate = monthEnd.startOf("day").toJSDate();
    const [appointments, blocks] = await Promise.all([
      db.collection("appointments").find({ barberId, status: "confirmed", startAt: { $lt: monthEndDate }, reservedEndAt: { $gt: monthStartDate } }).toArray(),
      db.collection("blocks").find({ startAt: { $lt: monthEndDate }, endAt: { $gt: monthStartDate }, $or: [{ barberId }, { barberId: null }] }).toArray()
    ]);
    const slotsByDay = {};
    const today = DateTime.now().setZone(shopZone).startOf("day");
    const serviceReserve = reservedMinutes(service.durationMinutes);
    for (let date = first.startOf("day"); date < monthEnd; date = date.plus({ days: 1 })) {
      const hours = settings.weeklyHours[String(date.weekday % 7)];
      if (!hours || date < today) continue;
      const opening = DateTime.fromISO(`${date.toFormat("yyyy-MM-dd")}T${hours.open}`, { zone: shopZone });
      const closing = DateTime.fromISO(`${date.toFormat("yyyy-MM-dd")}T${hours.close}`, { zone: shopZone });
      const daySlots = [];
      for (let start = opening; start.plus({ minutes: serviceReserve }) <= closing; start = start.plus({ minutes: settings.slotIntervalMinutes })) {
        if (start <= DateTime.now().setZone(shopZone)) continue;
        const end = start.plus({ minutes: serviceReserve });
        const startUtc = start.toUTC().toJSDate();
        const endUtc = end.toUTC().toJSDate();
        if (appointments.some((item) => overlaps(startUtc, endUtc, item.startAt, item.reservedEndAt))) continue;
        if (blocks.some((item) => overlaps(startUtc, endUtc, item.startAt, item.endAt))) continue;
        daySlots.push(start.toFormat("HH:mm"));
      }
      if (daySlots.length) slotsByDay[date.toFormat("yyyy-MM-dd")] = daySlots;
    }
    res.json({ month, timezone: shopZone, days: slotsByDay });
  } catch (error) { next(error); }
});

app.post("/api/appointments", bookingLimit, async (req, res, next) => {
  try {
    const { customerName, email, barberId, serviceId, date, time, note = "" } = req.body || {};
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (typeof customerName !== "string" || customerName.trim().length < 2 || customerName.trim().length > 100) return res.status(400).json({ error: "Enter a valid name." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
    if (typeof note !== "string" || note.length > 1000) return res.status(400).json({ error: "The note is too long." });
    const [barber, service] = await Promise.all([
      db.collection("barbers").findOne({ _id: barberId, active: { $ne: false } }),
      db.collection("services").findOne({ _id: serviceId, barberId, active: { $ne: false } })
    ]);
    if (!barber || !service) return res.status(400).json({ error: "Choose a valid barber and service." });

    const start = localDateTime(date, time);
    if (!start || start <= DateTime.now().setZone(shopZone)) return res.status(400).json({ error: "Choose a future time." });
    if (!isWithinBookingHorizon(start)) return res.status(400).json({ error: "Choose a time within the next 12 months." });
    const settings = await db.collection("settings").findOne({ _id: "main" });
    const hours = settings.weeklyHours[String(start.weekday % 7)];
    const opening = hours && localDateTime(date, hours.open);
    const closing = hours && localDateTime(date, hours.close);
    const blockMinutes = reservedMinutes(service.durationMinutes);
    const end = start.plus({ minutes: service.durationMinutes });
    const reservedEnd = start.plus({ minutes: blockMinutes });
    // Compare complete local date-times so a reservation ending after midnight cannot wrap past closing.
    if (!opening || !closing || start < opening || reservedEnd > closing) return res.status(409).json({ error: "That time is outside the shop schedule." });

    const startUtc = start.toUTC().toJSDate();
    const endUtc = end.toUTC().toJSDate();
    const reservedEndUtc = reservedEnd.toUTC().toJSDate();
    const [block, conflict] = await Promise.all([
      db.collection("blocks").findOne({ startAt: { $lt: reservedEndUtc }, endAt: { $gt: startUtc }, $or: [{ barberId }, { barberId: null }] }),
      db.collection("appointments").findOne({ barberId, status: "confirmed", startAt: { $lt: reservedEndUtc }, reservedEndAt: { $gt: startUtc } })
    ]);
    if (block || conflict) return res.status(409).json({ error: "That slot was just taken. Please choose another time." });

    const appointment = {
      customerId: normalizedEmail,
      customerName: customerName.trim(),
      customerEmail: normalizedEmail,
      barberId,
      barberName: barberName(barber),
      serviceId,
      serviceName: serviceName(service),
      servicePrice: service.price,
      serviceDurationMinutes: service.durationMinutes,
      date,
      time,
      timezone: shopZone,
      note: note.trim(),
      status: "confirmed",
      startAt: startUtc,
      endAt: endUtc,
      reservedEndAt: reservedEndUtc,
      occupiedSlots: slotKeys(start, blockMinutes),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const insert = await db.collection("appointments").insertOne(appointment);
    appointment._id = insert.insertedId;
    await db.collection("customers").updateOne(
      { _id: normalizedEmail },
      { $set: { name: appointment.customerName, email: normalizedEmail, lastSeenAt: new Date() }, $setOnInsert: { createdAt: new Date() }, $inc: { appointmentCount: 1 } },
      { upsert: true }
    );
    res.status(201).json({ id: String(appointment._id), status: "confirmed", date, time });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "That slot was just taken. Please choose another time." });
    next(error);
  }
});

app.use("/api/admin", checkSameOrigin);
app.get("/api/admin/session", (req, res) => req.session.admin ? res.json({ authenticated: true, username: req.session.admin }) : res.status(401).json({ authenticated: false }));
app.post("/api/admin/login", loginLimit, (req, res, next) => {
  const username = String(req.body?.username || "");
  const password = String(req.body?.password || "");
  if (!safeEquals(username, process.env.ADMIN_USERNAME) || !safeEquals(password, process.env.ADMIN_PASSWORD)) return res.status(401).json({ error: "Username or password is incorrect." });
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.admin = username;
    req.session.save((saveError) => saveError ? next(saveError) : res.json({ authenticated: true, username }));
  });
});
app.post("/api/admin/logout", requireAdmin, (req, res, next) => req.session.destroy((error) => error ? next(error) : res.clearCookie("goodcut.sid", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" }).json({ ok: true })));

app.get("/api/admin/appointments", requireAdmin, async (req, res, next) => {
  try {
    const status = ["confirmed", "cancelled", "all"].includes(req.query.status) ? req.query.status : "confirmed";
    const date = typeof req.query.date === "string" ? req.query.date : DateTime.now().setZone(shopZone).toFormat("yyyy-MM-dd");
    const selectedDay = DateTime.fromFormat(date, "yyyy-MM-dd", { zone: shopZone });
    if (!selectedDay.isValid || selectedDay.toFormat("yyyy-MM-dd") !== date) return res.status(400).json({ error: "Choose a valid appointment date." });
    const query = { startAt: { $gte: selectedDay.startOf("day").toUTC().toJSDate(), $lt: selectedDay.plus({ days: 1 }).startOf("day").toUTC().toJSDate() } };
    if (status !== "all") query.status = status;
    const rows = await db.collection("appointments").find(query).sort({ startAt: 1 }).limit(300).toArray();
    res.json(rows.map((item) => ({
      id: String(item._id), customerName: item.customerName, customerEmail: item.customerEmail,
      barberId: item.barberId, barberName: item.barberName, serviceId: item.serviceId, serviceName: item.serviceName,
      servicePrice: item.servicePrice, serviceDurationMinutes: item.serviceDurationMinutes, date: item.date,
      time: item.time, timezone: item.timezone, note: item.note, status: item.status,
      cancellationReason: item.cancellationReason || "", createdAt: item.createdAt
    })));
  } catch (error) { next(error); }
});

app.get("/api/admin/settings", requireAdmin, async (_req, res, next) => {
  try {
    const [settings, allBarbers] = await Promise.all([
      db.collection("settings").findOne({ _id: "main" }),
      db.collection("barbers").find({}).sort({ _id: 1 }).toArray()
    ]);
    res.json({ weeklyHours: settings.weeklyHours, timezone: settings.timezone, siteContent: settings.siteContent || defaultSiteContent, barbers: allBarbers });
  } catch (error) { next(error); }
});

app.put("/api/admin/settings/hours", requireAdmin, async (req, res, next) => {
  try {
    const weeklyHours = req.body?.weeklyHours;
    if (!weeklyHours || typeof weeklyHours !== "object" || Array.isArray(weeklyHours)) return res.status(400).json({ error: "Provide opening hours for each day." });
    const cleaned = {};
    for (let day = 0; day < 7; day++) {
      const row = weeklyHours[String(day)];
      if (!row || row.closed === true) continue;
      if (typeof row.open !== "string" || typeof row.close !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.close) || row.close <= row.open) {
        return res.status(400).json({ error: "Each open day needs a valid opening and closing time." });
      }
      cleaned[String(day)] = { open: row.open, close: row.close };
    }
    if (!Object.keys(cleaned).length) return res.status(400).json({ error: "Keep at least one day open." });
    await db.collection("settings").updateOne({ _id: "main" }, { $set: { weeklyHours: cleaned, updatedAt: new Date() } });
    res.json({ ok: true, weeklyHours: cleaned });
  } catch (error) { next(error); }
});

function validText(value, maxLength = 100) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function slugify(value) {
  const transliterated = value.toLocaleLowerCase("az-AZ").replace(/[əıöüşçğ]/g, (char) => ({ ə: "e", ı: "i", ö: "o", ü: "u", ş: "sh", ç: "ch", ğ: "g" })[char]);
  return transliterated.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

app.post("/api/admin/barbers", requireAdmin, async (req, res, next) => {
  try {
    const { name, role } = req.body || {};
    if (!validText(name) || !validText(role)) return res.status(400).json({ error: "Bərbərin adını və vəzifəsini düzgün daxil edin." });
    const baseId = slugify(name);
    if (!baseId) return res.status(400).json({ error: "Düzgün bərbər adı daxil edin." });
    let id = baseId;
    for (let suffix = 2; await db.collection("barbers").findOne({ _id: id }); suffix++) id = `${baseId}-${suffix}`;
    await db.collection("barbers").insertOne({ _id: id, name: name.trim(), role: role.trim(), photoUrl: barbers[0].photo ? `https://images.unsplash.com/${barbers[0].photo}?auto=format&fit=crop&w=900&q=85` : "", active: true, createdAt: new Date() });
    for (const service of services) {
      const barberService = { ...service, _id: `${service._id}-${id}`, barberId: id, active: true };
      await db.collection("services").updateOne({ _id: barberService._id }, { $setOnInsert: barberService }, { upsert: true });
    }
    res.status(201).json({ ok: true, id });
  } catch (error) { next(error); }
});

app.patch("/api/admin/barbers/:id", requireAdmin, async (req, res, next) => {
  try {
    const { name, role, active } = req.body || {};
    const changes = { updatedAt: new Date() };
    if (name !== undefined) {
      if (!validText(name)) return res.status(400).json({ error: "Düzgün bərbər adı daxil edin." });
      changes.name = name.trim();
      const baseId = slugify(name);
      if (baseId !== req.params.id && await db.collection("barbers").findOne({ _id: baseId })) return res.status(409).json({ error: "Bu adda bərbər artıq mövcuddur." });
    }
    if (role !== undefined) {
      if (!validText(role)) return res.status(400).json({ error: "Bərbərin vəzifəsini daxil edin." });
      changes.role = role.trim();
    }
    if (active !== undefined) {
      if (typeof active !== "boolean") return res.status(400).json({ error: "Invalid barber status." });
      if (!active) {
        const activeCount = await db.collection("barbers").countDocuments({ active: { $ne: false } });
        const current = await db.collection("barbers").findOne({ _id: req.params.id, active: { $ne: false } });
        if (current && activeCount <= 1) return res.status(409).json({ error: "Keep at least one active barber for online bookings." });
      }
      changes.active = active;
    }
    const result = await db.collection("barbers").updateOne({ _id: req.params.id }, { $set: changes });
    if (!result.matchedCount) return res.status(404).json({ error: "Barber not found." });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/admin/services", requireAdmin, async (_req, res, next) => {
  try {
    const [allBarbers, allServices] = await Promise.all([
      db.collection("barbers").find({}).sort({ _id: 1 }).toArray(),
      db.collection("services").find({ barberId: { $exists: true } }).sort({ barberId: 1, name: 1 }).toArray()
    ]);
    res.json({ barbers: allBarbers, services: allServices });
  } catch (error) { next(error); }
});

app.post("/api/admin/services", requireAdmin, async (req, res, next) => {
  try {
    const { barberId, name, description, price, durationMinutes } = req.body || {};
    const priceValue = Number(price);
    const durationValue = Number(durationMinutes);
    if (!validText(name, 100) || typeof description !== "string" || description.trim().length > 240 || !Number.isFinite(priceValue) || priceValue <= 0 || priceValue > 10000 || !Number.isInteger(durationValue) || durationValue < 10 || durationValue > 240) {
      return res.status(400).json({ error: "Xidmətin adını, qiymətini və müddətini düzgün daxil edin." });
    }
    if (!await db.collection("barbers").findOne({ _id: barberId, active: { $ne: false } })) return res.status(400).json({ error: "Aktiv bərbər seçin." });
    const service = { _id: crypto.randomUUID(), barberId, name: name.trim(), description: description.trim(), price: priceValue, durationMinutes: durationValue, active: true, createdAt: new Date() };
    await db.collection("services").insertOne(service);
    res.status(201).json(service);
  } catch (error) { next(error); }
});

app.patch("/api/admin/services/:id", requireAdmin, async (req, res, next) => {
  try {
    const { name, description, price, durationMinutes, active } = req.body || {};
    const changes = { updatedAt: new Date() };
    if (name !== undefined) {
      if (!validText(name, 100)) return res.status(400).json({ error: "Xidmətin adını daxil edin." });
      changes.name = name.trim();
    }
    if (description !== undefined) {
      if (typeof description !== "string" || description.trim().length > 240) return res.status(400).json({ error: "Xidmət təsviri çox uzundur." });
      changes.description = description.trim();
    }
    if (price !== undefined) {
      const value = Number(price);
      if (!Number.isFinite(value) || value <= 0 || value > 10000) return res.status(400).json({ error: "Düzgün qiymət daxil edin." });
      changes.price = value;
    }
    if (durationMinutes !== undefined) {
      const value = Number(durationMinutes);
      if (!Number.isInteger(value) || value < 10 || value > 240) return res.status(400).json({ error: "Müddət 10–240 dəqiqə arasında olmalıdır." });
      changes.durationMinutes = value;
    }
    if (active !== undefined) {
      if (typeof active !== "boolean") return res.status(400).json({ error: "Xidmət statusu düzgün deyil." });
      changes.active = active;
    }
    const result = await db.collection("services").updateOne({ _id: req.params.id, barberId: { $exists: true } }, { $set: changes });
    if (!result.matchedCount) return res.status(404).json({ error: "Xidmət tapılmadı." });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.put("/api/admin/site-content", requireAdmin, async (req, res, next) => {
  try {
    const about = req.body?.about;
    const fields = ["kicker", "title", "paragraph1", "paragraph2", "note"];
    const limits = { kicker: 80, title: 120, paragraph1: 500, paragraph2: 500, note: 180 };
    if (!about || fields.some((field) => !validText(about[field], limits[field]))) return res.status(400).json({ error: "Haqqımızda bölməsinin bütün xanalarını düzgün doldurun." });
    const cleaned = Object.fromEntries(fields.map((field) => [field, about[field].trim()]));
    await db.collection("settings").updateOne({ _id: "main" }, { $set: { "siteContent.about": cleaned, updatedAt: new Date() } });
    res.json({ ok: true, about: cleaned });
  } catch (error) { next(error); }
});

function cloudinaryPublicId(type, key) {
  if (type === "site" && ["hero", "gallery-1", "gallery-2", "gallery-3", "gallery-4"].includes(key)) return `goodcut-site-${key}`;
  if (type === "barber" && typeof key === "string" && /^[a-z0-9-]{1,64}$/.test(key)) return `goodcut-barber-${key}`;
  return "";
}

app.post("/api/admin/images/signature", requireAdmin, async (req, res, next) => {
  try {
    const { type, key } = req.body || {};
    const publicId = cloudinaryPublicId(type, key);
    if (!publicId || (type === "barber" && !await db.collection("barbers").findOne({ _id: key }))) return res.status(400).json({ error: "Şəkil yeri düzgün deyil." });
    const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
    if (!cloudName || !apiKey || !apiSecret) return res.status(503).json({ error: "Cloudinary sazlanmayıb. Vercel mühit dəyişənlərini yoxlayın." });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const params = { overwrite: "true", public_id: publicId, timestamp };
    const stringToSign = Object.keys(params).sort().map((name) => `${name}=${params[name]}`).join("&") + apiSecret;
    const signature = crypto.createHash("sha1").update(stringToSign).digest("hex");
    res.json({ cloudName, apiKey, timestamp, publicId, signature });
  } catch (error) { next(error); }
});

app.post("/api/admin/images", requireAdmin, async (req, res, next) => {
  try {
    const { type, key, publicId, url } = req.body || {};
    if (publicId !== cloudinaryPublicId(type, key) || typeof url !== "string" || url.length > 1000) return res.status(400).json({ error: "Şəkil məlumatı düzgün deyil." });
    let parsed;
    try { parsed = new URL(url); } catch { return res.status(400).json({ error: "Şəkil ünvanı düzgün deyil." }); }
    if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com") return res.status(400).json({ error: "Şəkil Cloudinary-dən olmalıdır." });
    if (type === "barber") {
      const result = await db.collection("barbers").updateOne({ _id: key }, { $set: { photoUrl: url, updatedAt: new Date() } });
      if (!result.matchedCount) return res.status(404).json({ error: "Bərbər tapılmadı." });
    } else {
      const settingsField = key === "hero" ? "siteContent.photos.hero" : `siteContent.photos.gallery.${Number(key.slice(-1)) - 1}`;
      await db.collection("settings").updateOne({ _id: "main" }, { $set: { [settingsField]: url, updatedAt: new Date() } });
    }
    res.json({ ok: true, url });
  } catch (error) { next(error); }
});

app.patch("/api/admin/appointments/:id/cancel", requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid appointment." });
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
    const appointment = await db.collection("appointments").findOneAndUpdate(
      { _id: new ObjectId(req.params.id), status: "confirmed", startAt: { $gt: new Date() } },
      { $set: { status: "cancelled", cancellationReason: reason, cancelledAt: new Date(), cancelledBy: req.session.admin, updatedAt: new Date(), occupiedSlots: [] } },
      { returnDocument: "after" }
    );
    if (!appointment) return res.status(409).json({ error: "The appointment could not be canceled. It may have already started or been canceled." });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/admin/blocks", requireAdmin, async (_req, res, next) => {
  try {
    const from = DateTime.now().setZone(shopZone).startOf("day").toUTC().toJSDate();
    const to = DateTime.now().setZone(shopZone).plus({ days: 180 }).toUTC().toJSDate();
    const [rows, allBarbers] = await Promise.all([
      db.collection("blocks").find({ startAt: { $lt: to }, endAt: { $gt: from } }).sort({ startAt: 1 }).toArray(),
      db.collection("barbers").find({}).toArray()
    ]);
    const nameById = new Map(allBarbers.map((item) => [item._id, typeof item.name === "string" ? item.name : item.name?.az || ""]));
    res.json(rows.map((item) => ({ id: String(item._id), barberId: item.barberId, barberName: item.barberId ? nameById.get(item.barberId) : "Bütün salon", date: dateKey(DateTime.fromJSDate(item.startAt, { zone: "utc" })), startTime: DateTime.fromJSDate(item.startAt, { zone: "utc" }).setZone(shopZone).toFormat("HH:mm"), endTime: DateTime.fromJSDate(item.endAt, { zone: "utc" }).setZone(shopZone).toFormat("HH:mm"), reason: item.reason })));
  } catch (error) { next(error); }
});

app.post("/api/admin/blocks", requireAdmin, async (req, res, next) => {
  try {
    const { date, barberId = "", startTime = "", endTime = "", reason = "" } = req.body || {};
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Choose a date." });
    if ((startTime && !endTime) || (!startTime && endTime)) return res.status(400).json({ error: "Enter both times, or leave both blank for the full day." });
    if (typeof reason !== "string" || reason.length > 500) return res.status(400).json({ error: "The reason is too long." });
    if (barberId && !await db.collection("barbers").findOne({ _id: barberId, active: { $ne: false } })) return res.status(400).json({ error: "Choose a valid barber." });
    let start;
    let end;
    if (startTime) {
      start = localDateTime(date, startTime);
      end = localDateTime(date, endTime);
      if (!start || !end || end <= start) return res.status(400).json({ error: "Enter a valid time range." });
    } else {
      start = DateTime.fromISO(date, { zone: shopZone }).startOf("day");
      end = start.plus({ days: 1 });
    }
    if (end <= DateTime.now().setZone(shopZone)) return res.status(400).json({ error: "Choose a future time." });
    const startAt = start.toUTC().toJSDate();
    const endAt = end.toUTC().toJSDate();
    const overlapQuery = { status: "confirmed", startAt: { $lt: endAt }, reservedEndAt: { $gt: startAt } };
    if (barberId) overlapQuery.barberId = barberId;
    if (await db.collection("appointments").findOne(overlapQuery)) return res.status(409).json({ error: "There is already a confirmed appointment in that period. Cancel or move it before blocking this time." });
    const block = { barberId: barberId || null, startAt, endAt, reason: reason.trim(), createdAt: new Date(), createdBy: req.session.admin };
    const result = await db.collection("blocks").insertOne(block);
    res.status(201).json({ id: String(result.insertedId) });
  } catch (error) { next(error); }
});

app.delete("/api/admin/blocks/:id", requireAdmin, async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid time block." });
    const result = await db.collection("blocks").deleteOne({ _id: new ObjectId(req.params.id) });
    if (!result.deletedCount) return res.status(404).json({ error: "Time block not found." });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

const publicFiles = {
  "/": "index.html", "/index.html": "index.html", "/styles.css": "styles.css", "/script.js": "script.js",
  "/admin": "admin.html", "/admin/appointments": "admin.html", "/admin/hours": "admin-hours.html", "/admin/barbers": "admin-barbers.html", "/admin/blocks": "admin-blocks.html", "/admin/services": "admin-services.html", "/admin/content": "admin-content.html",
  "/admin.css": "admin.css", "/admin-auth.js": "admin-auth.js", "/admin.js": "admin.js", "/admin-hours.js": "admin-hours.js", "/admin-barbers.js": "admin-barbers.js", "/admin-blocks.js": "admin-blocks.js", "/admin-services.js": "admin-services.js", "/admin-content.js": "admin-content.js",
  "/admin-services.html": "admin-services.html", "/admin-content.html": "admin-content.html"
};
for (const [route, file] of Object.entries(publicFiles)) app.get(route, (_req, res) => res.sendFile(path.join(publicRoot, file)));
app.use((_req, res) => res.status(404).json({ error: "Not found." }));
app.use((error, _req, res, _next) => {
  console.error(error);
  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

async function initialize() {
  if (!process.env.MONGODB_URI || process.env.MONGODB_URI.includes("paste-your-mongodb")) throw new Error("Set MONGODB_URI in your .env file to your MongoDB Atlas connection string.");
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) throw new Error("Set ADMIN_USERNAME and ADMIN_PASSWORD in your .env file before starting.");
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.includes("replace-with")) throw new Error("Set SESSION_SECRET in .env to a random value at least 32 characters long.");
  await client.connect();
  db = client.db(dbName);
  await seedBusiness();
}

appReady = initialize();
appReady.catch(() => {});

if (require.main === module) {
  appReady.then(() => {
    app.listen(port, "0.0.0.0", () => console.log(`Good Cut is running at http://localhost:${port}`));
  }).catch((error) => {
    console.error(`Could not start the local app: ${error.message}`);
    if (error.name === "MongoServerSelectionError") console.error("Check your Atlas IP access list, database user, password, and connection string.");
    process.exitCode = 1;
  });
}

module.exports = app;
