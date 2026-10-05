require("dotenv").config();

const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { MongoClient, ObjectId } = require("mongodb");
const { DateTime } = require("luxon");
const nodemailer = require("nodemailer");
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
const localeTags = { az: "az-AZ", ru: "ru-RU", en: "en-US" };
const translations = {
  az: { bookedSubject: "Görüşünüz təsdiqləndi · Good Cut", booked: "Salam {name}, görüşünüz təsdiqləndi.", canceledSubject: "Görüşünüz ləğv edildi · Good Cut", canceled: "Salam {name}, görüşünüz ləğv edildi.", details: "Xidmət: {service}\nBərbər: {barber}\nTarix və saat: {date} · {time}", reason: "Qeyd: {reason}", footer: "Good Cut bərbər studiyası · {timezone}" },
  ru: { bookedSubject: "Запись подтверждена · Good Cut", booked: "Здравствуйте, {name}, ваша запись подтверждена.", canceledSubject: "Запись отменена · Good Cut", canceled: "Здравствуйте, {name}, ваша запись отменена.", details: "Услуга: {service}\nБарбер: {barber}\nДата и время: {date} · {time}", reason: "Комментарий: {reason}", footer: "Барбершоп Good Cut · {timezone}" },
  en: { bookedSubject: "Appointment confirmed · Good Cut", booked: "Hi {name}, your appointment is confirmed.", canceledSubject: "Appointment canceled · Good Cut", canceled: "Hi {name}, your appointment has been canceled.", details: "Service: {service}\nBarber: {barber}\nDate and time: {date} · {time}", reason: "Note: {reason}", footer: "Good Cut Barber Studio · {timezone}" }
};

const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: 5000 });
let db;
let mailer;
let appReady;

function localDateTime(date, time, zone = shopZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const value = DateTime.fromISO(`${date}T${time}`, { zone });
  return value.isValid && value.toFormat("yyyy-MM-dd'T'HH:mm") === `${date}T${time}` ? value : null;
}

function dateKey(value) {
  return value.setZone(shopZone).toFormat("yyyy-MM-dd");
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

function localLabel(date, time, locale) {
  const local = DateTime.fromJSDate(date, { zone: "utc" }).setZone(shopZone);
  const dateLabel = new Intl.DateTimeFormat(localeTags[locale] || localeTags.az, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: shopZone }).format(local.toJSDate());
  return { date: dateLabel, time: local.toFormat("HH:mm") };
}

function serviceName(service, locale) { return service?.name?.[locale] || service?.name?.az || ""; }
function barberName(barber, locale) { return barber?.name?.[locale] || barber?.name?.az || ""; }

async function seedBusiness() {
  for (const barber of barbers) await db.collection("barbers").updateOne({ _id: barber._id }, { $setOnInsert: barber }, { upsert: true });
  for (const service of services) await db.collection("services").updateOne({ _id: service._id }, { $setOnInsert: service }, { upsert: true });
  await db.collection("settings").updateOne({ _id: business._id }, { $setOnInsert: { ...business, timezone: shopZone } }, { upsert: true });
  await db.collection("appointments").createIndex({ barberId: 1, occupiedSlots: 1 }, { unique: true, name: "unique_barber_occupied_slots" });
  await db.collection("appointments").createIndex({ status: 1, startAt: 1 });
  await db.collection("blocks").createIndex({ barberId: 1, startAt: 1, endAt: 1 });
}

function sendMail(to, subject, text) {
  if (!mailer || !process.env.EMAIL_FROM || !to) return Promise.resolve(false);
  return mailer.sendMail({ from: process.env.EMAIL_FROM, to, subject, text })
    .then(() => true)
    .catch((error) => { console.error("Email notification failed:", error.message); return false; });
}

async function sendAppointmentMail(appointment, canceled = false) {
  const language = translations[appointment.language] ? appointment.language : "az";
  const t = translations[language];
  const service = await db.collection("services").findOne({ _id: appointment.serviceId });
  const barber = await db.collection("barbers").findOne({ _id: appointment.barberId });
  const local = localLabel(appointment.startAt, appointment.time, language);
  const interpolate = (line) => line.replace("{name}", appointment.customerName)
    .replace("{service}", serviceName(service, language))
    .replace("{barber}", barberName(barber, language))
    .replace("{date}", local.date)
    .replace("{time}", local.time)
    .replace("{reason}", appointment.cancellationReason || "")
    .replace("{timezone}", shopZone);
  const intro = interpolate(canceled ? t.canceled : t.booked);
  const detailLines = interpolate(t.details);
  const reason = canceled && appointment.cancellationReason ? `\n${interpolate(t.reason)}` : "";
  return sendMail(appointment.customerEmail, canceled ? t.canceledSubject : t.bookedSubject, `${intro}\n\n${detailLines}${reason}\n\n${interpolate(t.footer)}`);
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
      fontSrc: ["'self'", "https://fonts.gstatic.com"], imgSrc: ["'self'", "https://images.unsplash.com", "data:"],
      connectSrc: ["'self'"], formAction: ["'self'"], baseUri: ["'self'"], frameAncestors: ["'none'"],
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
  secret: process.env.SESSION_SECRET || "missing-secret-set-this-in-env-before-starting",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl, dbName, collectionName: "sessions", ttl: 60 * 60 * 8 }),
  cookie: { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
}));

const bookingLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false });
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false });

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/catalog", async (_req, res, next) => {
  try {
    const [catalogBarbers, catalogServices] = await Promise.all([
      db.collection("barbers").find({ active: { $ne: false } }).sort({ _id: 1 }).toArray(),
      db.collection("services").find({ active: { $ne: false } }).sort({ _id: 1 }).toArray()
    ]);
    res.json({ barbers: catalogBarbers, services: catalogServices, timezone: shopZone, currency: "AZN" });
  } catch (error) { next(error); }
});

app.get("/api/availability", async (req, res, next) => {
  try {
    const { barberId, serviceId, month } = req.query;
    if (typeof barberId !== "string" || typeof serviceId !== "string" || typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "Choose a barber, service, and valid month." });
    }
    const [barber, service, settings] = await Promise.all([
      db.collection("barbers").findOne({ _id: barberId, active: { $ne: false } }),
      db.collection("services").findOne({ _id: serviceId, active: { $ne: false } }),
      db.collection("settings").findOne({ _id: "main" })
    ]);
    if (!barber || !service || !settings) return res.status(404).json({ error: "Barber or service was not found." });

    const first = DateTime.fromFormat(`${month}-01`, "yyyy-MM-dd", { zone: shopZone });
    if (!first.isValid || first.toFormat("yyyy-MM") !== month) return res.status(400).json({ error: "Invalid calendar month." });
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
    const { customerName, email, barberId, serviceId, date, time, note = "", language = "az" } = req.body || {};
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (typeof customerName !== "string" || customerName.trim().length < 2 || customerName.trim().length > 100) return res.status(400).json({ error: "Enter a valid name." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
    if (typeof note !== "string" || note.length > 1000) return res.status(400).json({ error: "The note is too long." });
    if (!["az", "ru", "en"].includes(language)) return res.status(400).json({ error: "Choose a valid language." });
    const [barber, service] = await Promise.all([
      db.collection("barbers").findOne({ _id: barberId, active: { $ne: false } }),
      db.collection("services").findOne({ _id: serviceId, active: { $ne: false } })
    ]);
    if (!barber || !service) return res.status(400).json({ error: "Choose a valid barber and service." });

    const start = localDateTime(date, time);
    if (!start || start <= DateTime.now().setZone(shopZone)) return res.status(400).json({ error: "Choose a future time." });
    const settings = await db.collection("settings").findOne({ _id: "main" });
    const hours = settings.weeklyHours[String(start.weekday % 7)];
    const blockMinutes = reservedMinutes(service.durationMinutes);
    const end = start.plus({ minutes: service.durationMinutes });
    const reservedEnd = start.plus({ minutes: blockMinutes });
    if (!hours || start.toFormat("HH:mm") < hours.open || reservedEnd.toFormat("HH:mm") > hours.close) return res.status(409).json({ error: "That time is outside the shop schedule." });

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
      barberName: barberName(barber, language),
      serviceId,
      serviceName: serviceName(service, language),
      servicePrice: service.price,
      serviceDurationMinutes: service.durationMinutes,
      date,
      time,
      timezone: shopZone,
      note: note.trim(),
      language,
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
    const emailSent = await sendAppointmentMail(appointment);
    res.status(201).json({ id: String(appointment._id), status: "confirmed", emailSent, date, time });
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
    res.json({ weeklyHours: settings.weeklyHours, timezone: settings.timezone, barbers: allBarbers });
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

function validTranslations(value, maxLength = 100) {
  return value && typeof value === "object" && ["az", "ru", "en"].every((language) => typeof value[language] === "string" && value[language].trim().length > 0 && value[language].trim().length <= maxLength);
}

app.post("/api/admin/barbers", requireAdmin, async (req, res, next) => {
  try {
    const { name, role, photo = "photo-1500648767791-00dcc994a43e" } = req.body || {};
    if (!validTranslations(name) || !validTranslations(role) || typeof photo !== "string" || photo.length > 160) return res.status(400).json({ error: "Provide a name and role in Azerbaijani, Russian, and English." });
    const id = name.en.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
    if (!id) return res.status(400).json({ error: "Enter a valid barber name." });
    if (await db.collection("barbers").findOne({ _id: id })) return res.status(409).json({ error: "A barber with a similar English name already exists." });
    await db.collection("barbers").insertOne({ _id: id, name: Object.fromEntries(Object.entries(name).map(([key, value]) => [key, value.trim()])), role: Object.fromEntries(Object.entries(role).map(([key, value]) => [key, value.trim()])), photo: photo.trim() || "photo-1500648767791-00dcc994a43e", active: true, createdAt: new Date() });
    res.status(201).json({ ok: true, id });
  } catch (error) { next(error); }
});

app.patch("/api/admin/barbers/:id", requireAdmin, async (req, res, next) => {
  try {
    const { name, role, active, photo } = req.body || {};
    const changes = { updatedAt: new Date() };
    if (name !== undefined) {
      if (!validTranslations(name)) return res.status(400).json({ error: "Provide a name in Azerbaijani, Russian, and English." });
      changes.name = Object.fromEntries(Object.entries(name).map(([key, value]) => [key, value.trim()]));
    }
    if (role !== undefined) {
      if (!validTranslations(role)) return res.status(400).json({ error: "Provide a role in Azerbaijani, Russian, and English." });
      changes.role = Object.fromEntries(Object.entries(role).map(([key, value]) => [key, value.trim()]));
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
    if (photo !== undefined) {
      if (typeof photo !== "string" || photo.length > 160) return res.status(400).json({ error: "Invalid barber photo." });
      changes.photo = photo.trim();
    }
    const result = await db.collection("barbers").updateOne({ _id: req.params.id }, { $set: changes });
    if (!result.matchedCount) return res.status(404).json({ error: "Barber not found." });
    res.json({ ok: true });
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
    const emailSent = await sendAppointmentMail(appointment, true);
    res.json({ ok: true, emailSent });
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
    const nameById = new Map(allBarbers.map((item) => [item._id, item.name.az]));
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
  "/admin": "admin.html", "/admin/appointments": "admin.html", "/admin/hours": "admin-hours.html", "/admin/barbers": "admin-barbers.html", "/admin/blocks": "admin-blocks.html",
  "/admin.css": "admin.css", "/admin-auth.js": "admin-auth.js", "/admin.js": "admin.js", "/admin-hours.js": "admin-hours.js", "/admin-barbers.js": "admin-barbers.js", "/admin-blocks.js": "admin-blocks.js"
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
  if (process.env.SMTP_HOST && process.env.EMAIL_FROM) {
    mailer = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === "true", auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined });
  } else {
    console.warn("Email is not configured. Bookings will save, but notification emails will not be sent.");
  }
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
