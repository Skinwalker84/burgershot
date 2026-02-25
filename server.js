// server.js
// Burger Shot – Firmensoftware (GTA RP)
// Features: Login (Boss/Staff), Mitarbeiterverwaltung, POS Sales, Küche, Reset (heute),
// Persistenz via JSON, + Buchhaltung Reports (Tag/Woche/Monat/Jahr)

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// -------------------- Simple JSON DB --------------------
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    const db = makeFreshDB();
    saveDB(db);
    return db;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    const db = JSON.parse(raw);
    return normalizeDB(db);
  } catch (e) {
    const db = makeFreshDB();
    saveDB(db);
    return db;
  }
}

function saveDB(db) {
  ensureDataDir();
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf-8");
  fs.renameSync(tmp, DB_FILE);
}

function makeFreshDB() {
  const today = getDayKeyLocal(new Date());
  const bossUsername = "chris.adams";

  const { salt, hash } = hashPassword("admin"); // Default Boss Passwort: admin (bitte danach ändern)
  return {
    meta: {
      currentDay: today,
      nextOrderId: 1
    },
    users: [
      {
        username: bossUsername,
        displayName: "Chris Adams",
        role: "boss",
        pw: { salt, hash }
      }
    ],
    sessions: {}, // token -> { username, exp }
    salesByDay: {
      [today]: []
    },
    kitchenByDay: {
      [today]: {
        pending: [], // orders pending
        done: []     // completed
      }
    },
    closedDays: {}
  };
}

function normalizeDB(db) {
  if (!db || typeof db !== "object") return makeFreshDB();
  if (!db.meta) db.meta = {};
  if (!db.meta.currentDay) db.meta.currentDay = getDayKeyLocal(new Date());
  if (!db.meta.nextOrderId) db.meta.nextOrderId = 1;
  if (!Array.isArray(db.users)) db.users = [];
  if (!db.sessions || typeof db.sessions !== "object") db.sessions = {};
  if (!db.salesByDay || typeof db.salesByDay !== "object") db.salesByDay = {};
  if (!db.kitchenByDay || typeof db.kitchenByDay !== "object") db.kitchenByDay = {};
  if (!db.closedDays || typeof db.closedDays !== "object") db.closedDays = {};

  // Ensure day buckets exist
  const day = db.meta.currentDay;
  if (db.closedDays && db.closedDays[day]) {
    return res.status(409).json({ success: false, message: "Dieser Tag ist bereits abgeschlossen. Keine neuen Verkäufe möglich." });
  }
  if (!Array.isArray(db.salesByDay[day])) db.salesByDay[day] = [];
  if (!db.kitchenByDay[day]) db.kitchenByDay[day] = { pending: [], done: [] };
  if (!Array.isArray(db.kitchenByDay[day].pending)) db.kitchenByDay[day].pending = [];
  if (!Array.isArray(db.kitchenByDay[day].done)) db.kitchenByDay[day].done = [];

  // Ensure at least one boss
  const hasBoss = db.users.some(u => u.role === "boss");
  if (!hasBoss) {
    const { salt, hash } = hashPassword("admin");
    db.users.push({
      username: "chris.adams",
      displayName: "Chris Adams",
      role: "boss",
      pw: { salt, hash }
    });
  }

  return db;
}

let db = loadDB();

// Rotate day if needed (local time)
function rotateDayIfNeeded() {
  const today = getDayKeyLocal(new Date());
  if (db.meta.currentDay !== today) {
    db.meta.currentDay = today;
    if (!Array.isArray(db.salesByDay[today])) db.salesByDay[today] = [];
    if (!db.kitchenByDay[today]) db.kitchenByDay[today] = { pending: [], done: [] };
    saveDB(db);
  }
}

// -------------------- Time helpers --------------------
function getDayKeyLocal(d) {
  // YYYY-MM-DD in local time
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toHM(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseDateYYYYMMDD(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  // Ensure it matches (e.g. no overflow)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

function startOfWeekMonday(dateLocal) {
  const d = new Date(dateLocal.getFullYear(), dateLocal.getMonth(), dateLocal.getDate());
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day); // Monday as start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseISOWeek(s) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) return null;
  return { year, week };
}

// ISO week start (Monday) in local time
function startOfISOWeek(year, week) {
  // ISO week 1 is the week with Jan 4th in it.
  const jan4 = new Date(year, 0, 4);
  const week1Mon = startOfWeekMonday(jan4);
  const d = addDays(week1Mon, (week - 1) * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}


function addDays(dateLocal, n) {
  const d = new Date(dateLocal.getFullYear(), dateLocal.getMonth(), dateLocal.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

function monthKey(dateLocal) {
  const y = dateLocal.getFullYear();
  const m = String(dateLocal.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// -------------------- Password hashing --------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, pwObj) {
  if (!pwObj?.salt || !pwObj?.hash) return false;
  const hash = crypto.pbkdf2Sync(password, pwObj.salt, 120000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(pwObj.hash, "hex"));
}

// -------------------- Cookies + sessions --------------------
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(";").forEach(part => {
    const [k, ...rest] = part.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(rest.join("=") || "");
  });
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  parts.push("Path=/");
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  else parts.push("SameSite=Lax");

  // If behind https (Railway) we can set Secure
  if (opts.secure) parts.push("Secure");

  res.setHeader("Set-Cookie", parts.join("; "));
}

function createSession(username) {
  const token = crypto.randomBytes(24).toString("hex");
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 14; // 14 days
  db.sessions[token] = { username, exp };
  saveDB(db);
  return token;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, s] of Object.entries(db.sessions)) {
    if (!s || !s.exp || s.exp < now) delete db.sessions[token];
  }
}

function getUserFromReq(req) {
  cleanupSessions();
  const cookies = parseCookies(req);
  const token = cookies["bs_token"];
  if (!token) return null;
  const sess = db.sessions[token];
  if (!sess) return null;
  if (sess.exp < Date.now()) {
    delete db.sessions[token];
    saveDB(db);
    return null;
  }
  const user = db.users.find(u => u.username === sess.username);
  if (!user) return null;
  return user;
}

function requireAuth(req, res, next) {
  rotateDayIfNeeded();
  const user = getUserFromReq(req);
  if (!user) return res.status(401).json({ success: false, message: "Not logged in" });
  req.user = user;
  next();
}

function requireBoss(req, res, next) {
  if (!req.user || req.user.role !== "boss") {
    return res.status(403).json({ success: false, message: "Boss only" });
  }
  next();
}

// -------------------- Core helpers --------------------
function publicUser(u) {
  return {
    username: u.username,
    displayName: u.displayName,
    role: u.role
  };
}

function todaysSales() {
  const day = db.meta.currentDay;
  if (!Array.isArray(db.salesByDay[day])) db.salesByDay[day] = [];
  return db.salesByDay[day];
}

function todaysKitchen() {
  const day = db.meta.currentDay;
  if (!db.kitchenByDay[day]) db.kitchenByDay[day] = { pending: [], done: [] };
  if (!Array.isArray(db.kitchenByDay[day].pending)) db.kitchenByDay[day].pending = [];
  if (!Array.isArray(db.kitchenByDay[day].done)) db.kitchenByDay[day].done = [];
  return db.kitchenByDay[day];
}

// -------------------- AUTH --------------------
app.get("/auth/me", (req, res) => {
  rotateDayIfNeeded();
  const user = getUserFromReq(req);
  if (!user) return res.json({ loggedIn: false });
  return res.json({ loggedIn: true, user: publicUser(user) });
});

app.post("/auth/login", (req, res) => {
  rotateDayIfNeeded();
  const { username, password } = req.body || {};

  const u = db.users.find(x => x.username === String(username || "").trim().toLowerCase());
  if (!u) return res.status(401).json({ success: false, message: "Falscher Login." });

  if (!verifyPassword(String(password || ""), u.pw)) {
    return res.status(401).json({ success: false, message: "Falscher Login." });
  }

  const token = createSession(u.username);

  const secure = (req.headers["x-forwarded-proto"] || "").includes("https") || req.secure;
  setCookie(res, "bs_token", token, { secure, maxAge: 60 * 60 * 24 * 14 });

  res.json({ success: true, user: publicUser(u) });
});

app.post("/auth/logout", (req, res) => {
  rotateDayIfNeeded();
  const cookies = parseCookies(req);
  const token = cookies["bs_token"];
  if (token && db.sessions[token]) {
    delete db.sessions[token];
    saveDB(db);
  }
  const secure = (req.headers["x-forwarded-proto"] || "").includes("https") || req.secure;
  setCookie(res, "bs_token", "", { secure, maxAge: 0 });
  res.json({ success: true });
});

// Change password (logged-in user)
app.post("/auth/change-password", requireAuth, (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: "Felder fehlen." });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: "Neues Passwort zu kurz (mind. 6 Zeichen)." });
  }
  if (!verifyPassword(currentPassword, req.user.pw)) {
    return res.status(401).json({ success: false, message: "Aktuelles Passwort ist falsch." });
  }

  const { salt, hash } = hashPassword(newPassword);
  req.user.pw = { salt, hash };

  // Invalidate other sessions of this user (keep current)
  const cookies = parseCookies(req);
  const currentToken = cookies["bs_token"];
  for (const [token, s] of Object.entries(db.sessions)) {
    if (!s) continue;
    if (s.username === req.user.username && token !== currentToken) delete db.sessions[token];
  }

  saveDB(db);
  res.json({ success: true });
});

// -------------------- USERS (Boss) --------------------
app.get("/users", requireAuth, requireBoss, (req, res) => {
  const staff = db.users
    .filter(u => u.role !== "boss")
    .map(publicUser);
  res.json({ success: true, staff });
});

app.post("/users/add", requireAuth, requireBoss, (req, res) => {
  const displayName = String(req.body?.displayName || "").trim();
  const usernameRaw = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!displayName || !usernameRaw || !password) {
    return res.status(400).json({ success: false, message: "Felder fehlen." });
  }
  if (!/^[a-z0-9._-]{3,32}$/.test(usernameRaw)) {
    return res.status(400).json({ success: false, message: "Username ungültig (3-32, a-z 0-9 . _ -)." });
  }
  if (db.users.some(u => u.username === usernameRaw)) {
    return res.status(400).json({ success: false, message: "Username existiert bereits." });
  }

  const { salt, hash } = hashPassword(password);

  db.users.push({
    username: usernameRaw,
    displayName,
    role: "staff",
    pw: { salt, hash }
  });
  saveDB(db);

  res.json({ success: true });
});

app.post("/users/delete", requireAuth, requireBoss, (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  if (!username) return res.status(400).json({ success: false, message: "Username fehlt." });

  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(404).json({ success: false, message: "Nicht gefunden." });
  if (user.role === "boss") return res.status(400).json({ success: false, message: "Chef kann nicht gelöscht werden." });

  db.users = db.users.filter(u => u.username !== username);

  // sessions cleanup
  for (const [token, s] of Object.entries(db.sessions)) {
    if (s?.username === username) delete db.sessions[token];
  }

  saveDB(db);
  res.json({ success: true });
});

// -------------------- STATS (today) --------------------
app.get("/stats", requireAuth, (req, res) => {
  const sales = todaysSales();

  const employees = {}; // displayName -> { total, tips, orders }
  for (const s of sales) {
    const name = s.employee || "Unbekannt";
    if (!employees[name]) employees[name] = { total: 0, tips: 0, orders: 0 };
    employees[name].total += Number(s.total || 0);
    employees[name].tips += Number(s.tip || 0);
    employees[name].orders += 1;
  }

  res.json({
    success: true,
    me: publicUser(req.user),
    currentDay: db.meta.currentDay,
    sales,
    employees
  });
});

// -------------------- SALE (POS -> save + kitchen pending) --------------------
app.post("/sale", requireAuth, (req, res) => {
  rotateDayIfNeeded();
  const body = req.body || {};
  const register = Number(body.register);
  const items = body.items;
  const total = Number(body.total);
  const time = String(body.time || new Date().toISOString());
  const paidAmount = Number(body.paidAmount);

  if (!Number.isFinite(register) || register < 1) {
    return res.status(400).json({ success: false, message: "Invalid sale payload (register)." });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: "Invalid sale payload (items)." });
  }
  if (!Number.isFinite(total) || total < 0) {
    return res.status(400).json({ success: false, message: "Invalid sale payload (total)." });
  }
  if (!Number.isFinite(paidAmount) || paidAmount < total) {
    return res.status(400).json({ success: false, message: "Invalid sale payload (paidAmount)." });
  }

  const tip = Math.max(0, paidAmount - total);

  const day = db.meta.currentDay;
  const orderId = db.meta.nextOrderId++;
  const sale = {
    id: orderId,
    day,
    time,
    timeHM: toHM(time),
    employee: req.user.displayName || req.user.username,
    employeeUsername: req.user.username,
    register,
    items,
    total,
    paidAmount,
    tip
  };

  // Store sale for today
  if (!Array.isArray(db.salesByDay[day])) db.salesByDay[day] = [];
  db.salesByDay[day].push(sale);

  // Kitchen pending
  const kitchen = todaysKitchen();
  kitchen.pending.push({
    id: orderId,
    day,
    time,
    timeHM: sale.timeHM,
    employee: sale.employee,
    register,
    items,
    total
  });

  saveDB(db);

  res.json({ success: true, orderId, tip });
});

// -------------------- KITCHEN --------------------
app.get("/kitchen/orders", requireAuth, (req, res) => {
  const kitchen = todaysKitchen();
  const pending = kitchen.pending
    .slice()
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  res.json({
    success: true,
    currentDay: db.meta.currentDay,
    pending
  });
});

app.post("/kitchen/complete", requireAuth, (req, res) => {
  const id = Number(req.body?.id);
  if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "ID fehlt." });

  const kitchen = todaysKitchen();
  const idx = kitchen.pending.findIndex(o => Number(o.id) === id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Order nicht gefunden." });

  const doneOrder = kitchen.pending.splice(idx, 1)[0];
  kitchen.done.push({ ...doneOrder, completedAt: new Date().toISOString() });

  saveDB(db);
  res.json({ success: true });
});

// -------------------- RESET (today) --------------------
app.post("/reset", requireAuth, requireBoss, (req, res) => {
  const day = db.meta.currentDay;
  db.salesByDay[day] = [];
  db.kitchenByDay[day] = { pending: [], done: [] };
  saveDB(db);
  res.json({ success: true });
});

// -------------------- REPORTS / BUCHHALTUNG --------------------
// GET /reports/summary?period=day|week|month|year&date=YYYY-MM-DD
app.get("/reports/summary", requireAuth, requireBoss, (req, res) => {
  rotateDayIfNeeded();

  const period = String(req.query?.period || "day");
  const dateStr = String(req.query?.date || db.meta.currentDay);

  const date = parseDateYYYYMMDD(dateStr);
  if (!date) return res.status(400).json({ success: false, message: "Ungültiges Datum. Format: YYYY-MM-DD" });

  // Helper to compute sums for a dayKey
  function summarizeDay(dayKey) {
    const sales = Array.isArray(db.salesByDay[dayKey]) ? db.salesByDay[dayKey] : [];
    const revenue = sales.reduce((s, x) => s + Number(x.total || 0), 0);
    const tips = sales.reduce((s, x) => s + Number(x.tip || 0), 0);
    const orders = sales.length;
    const avg = orders > 0 ? revenue / orders : 0;
    return { day: dayKey, revenue, tips, orders, avg };
  }

  // DAY
  if (period === "day") {
    const dayKey = getDayKeyLocal(date);
    const sum = summarizeDay(dayKey);
    return res.json({
      success: true,
      period: "day",
      range: { start: dayKey, end: dayKey },
      totals: {
        revenue: sum.revenue,
        tips: sum.tips,
        orders: sum.orders,
        avg: sum.avg
      },
      breakdown: [sum] // 1 element
    });
  }

  // WEEK (Mon-Sun)
  if (period === "week") {
    const start = startOfWeekMonday(date);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      days.push(getDayKeyLocal(d));
    }
    const breakdown = days.map(summarizeDay);
    const totals = {
      revenue: breakdown.reduce((s, x) => s + x.revenue, 0),
      tips: breakdown.reduce((s, x) => s + x.tips, 0),
      orders: breakdown.reduce((s, x) => s + x.orders, 0)
    };
    totals.avg = totals.orders > 0 ? totals.revenue / totals.orders : 0;

    return res.json({
      success: true,
      period: "week",
      range: { start: days[0], end: days[6] },
      totals,
      breakdown
    });
  }

  // MONTH (all days)
  if (period === "month") {
    const y = date.getFullYear();
    const m = date.getMonth(); // 0-11
    const first = new Date(y, m, 1);
    const next = new Date(y, m + 1, 1);
    const breakdown = [];

    for (let d = new Date(first); d < next; d = addDays(d, 1)) {
      const dayKey = getDayKeyLocal(d);
      breakdown.push(summarizeDay(dayKey));
    }

    const totals = {
      revenue: breakdown.reduce((s, x) => s + x.revenue, 0),
      tips: breakdown.reduce((s, x) => s + x.tips, 0),
      orders: breakdown.reduce((s, x) => s + x.orders, 0)
    };
    totals.avg = totals.orders > 0 ? totals.revenue / totals.orders : 0;

    return res.json({
      success: true,
      period: "month",
      range: { start: breakdown[0]?.day, end: breakdown[breakdown.length - 1]?.day },
      totals,
      breakdown
    });
  }

  // YEAR (months)
  if (period === "year") {
    const y = date.getFullYear();
    const breakdown = [];

    for (let month = 0; month < 12; month++) {
      const first = new Date(y, month, 1);
      const next = new Date(y, month + 1, 1);

      let revenue = 0, tips = 0, orders = 0;

      for (let d = new Date(first); d < next; d = addDays(d, 1)) {
        const dayKey = getDayKeyLocal(d);
        const sum = summarizeDay(dayKey);
        revenue += sum.revenue;
        tips += sum.tips;
        orders += sum.orders;
      }

      const avg = orders > 0 ? revenue / orders : 0;
      breakdown.push({
        month: `${y}-${String(month + 1).padStart(2, "0")}`,
        revenue,
        tips,
        orders,
        avg
      });
    }

    const totals = {
      revenue: breakdown.reduce((s, x) => s + x.revenue, 0),
      tips: breakdown.reduce((s, x) => s + x.tips, 0),
      orders: breakdown.reduce((s, x) => s + x.orders, 0)
    };
    totals.avg = totals.orders > 0 ? totals.revenue / totals.orders : 0;

    return res.json({
      success: true,
      period: "year",
      range: { start: `${y}-01-01`, end: `${y}-12-31` },
      totals,
      breakdown
    });
  }

  return res.status(400).json({ success: false, message: "period muss day|week|month|year sein." });
});

// GET /reports/day-details?date=YYYY-MM-DD
// Returns: all sales for that day + totals + breakdown by employee/register
app.get("/reports/day-details", requireAuth, requireBoss, (req, res) => {
  rotateDayIfNeeded();

  const dateStr = String(req.query?.date || db.meta.currentDay);
  const date = parseDateYYYYMMDD(dateStr);
  if (!date) return res.status(400).json({ success: false, message: "Ungültiges Datum. Format: YYYY-MM-DD" });

  const dayKey = getDayKeyLocal(date);
  const sales = Array.isArray(db.salesByDay[dayKey]) ? db.salesByDay[dayKey] : [];

  const totals = {
    revenue: sales.reduce((s, x) => s + Number(x.total || 0), 0),
    tips: sales.reduce((s, x) => s + Number(x.tip || 0), 0),
    orders: sales.length
  };
  totals.avg = totals.orders > 0 ? totals.revenue / totals.orders : 0;

  const byEmployee = {}; // displayName -> {revenue,tips,orders}
  const byRegister = {}; // register -> {revenue,tips,orders}

  for (const s of sales) {
    const emp = String(s.employee || s.employeeUsername || "Unbekannt");
    const reg = String(s.register || "?");

    if (!byEmployee[emp]) byEmployee[emp] = { revenue: 0, tips: 0, orders: 0 };
    byEmployee[emp].revenue += Number(s.total || 0);
    byEmployee[emp].tips += Number(s.tip || 0);
    byEmployee[emp].orders += 1;

    if (!byRegister[reg]) byRegister[reg] = { revenue: 0, tips: 0, orders: 0 };
    byRegister[reg].revenue += Number(s.total || 0);
    byRegister[reg].tips += Number(s.tip || 0);
    byRegister[reg].orders += 1;
  }

  return res.json({
    success: true,
    day: dayKey,
    closed: db.closedDays ? (db.closedDays[dayKey] || null) : null,
    totals,
    byEmployee,
    byRegister,
    sales
  });
});

// GET /reports/week-employee?week=YYYY-Www
// Returns: totals + breakdown by employee for the ISO week (Mo–So)
app.get("/reports/week-employee", requireAuth, requireBoss, (req, res) => {
  rotateDayIfNeeded();

  const weekStr = String(req.query?.week || "");
  const parsed = parseISOWeek(weekStr);
  if (!parsed) return res.status(400).json({ success: false, message: "Ungültige Kalenderwoche. Format: YYYY-Www (z.B. 2026-W09)" });

  const start = startOfISOWeek(parsed.year, parsed.week);

  function summarizeSales(sales) {
    const revenue = sales.reduce((s, x) => s + Number(x.total || 0), 0);
    const tips = sales.reduce((s, x) => s + Number(x.tip || 0), 0);
    const orders = sales.length;
    const avg = orders > 0 ? revenue / orders : 0;
    return { revenue, tips, orders, avg };
  }

  const days = [];
  const salesAll = [];

  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const dayKey = getDayKeyLocal(d);
    days.push(dayKey);
    const sales = Array.isArray(db.salesByDay[dayKey]) ? db.salesByDay[dayKey] : [];
    salesAll.push(...sales);
  }

  const totals = summarizeSales(salesAll);

  const byEmployeeMap = {};
  for (const s of salesAll) {
    const empKey = String(s.employeeUsername || s.employee || "—");
    if (!byEmployeeMap[empKey]) byEmployeeMap[empKey] = { employeeUsername: empKey, employee: s.employee || empKey, revenue: 0, tips: 0, orders: 0, avg: 0 };
    byEmployeeMap[empKey].revenue += Number(s.total || 0);
    byEmployeeMap[empKey].tips += Number(s.tip || 0);
    byEmployeeMap[empKey].orders += 1;
  }

  const byEmployee = Object.values(byEmployeeMap)
    .map(x => ({ ...x, avg: x.orders > 0 ? x.revenue / x.orders : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  res.json({
    success: true,
    period: "week",
    week: weekStr,
    range: { start: days[0], end: days[6] },
    totals,
    byEmployee
  });
});



// POST /reports/close-day
// Body: { date: YYYY-MM-DD, cashCount?: number, note?: string }
app.post("/reports/close-day", requireAuth, requireBoss, (req, res) => {
  rotateDayIfNeeded();

  const body = req.body || {};
  const dateStr = String(body.date || db.meta.currentDay);
  const date = parseDateYYYYMMDD(dateStr);
  if (!date) return res.status(400).json({ success: false, message: "Ungültiges Datum. Format: YYYY-MM-DD" });

  const dayKey = getDayKeyLocal(date);

  if (!db.closedDays || typeof db.closedDays !== "object") db.closedDays = {};
  if (db.closedDays[dayKey]) {
    return res.status(409).json({ success: false, message: "Der Tag ist bereits abgeschlossen." });
  }

  const cashCountRaw = body.cashCount;
  const cashCount = Number(cashCountRaw);
  const note = typeof body.note === "string" ? body.note.trim() : "";

  db.closedDays[dayKey] = {
    day: dayKey,
    closedAt: new Date().toISOString(),
    closedBy: req.user.username,
    closedByName: req.user.displayName || req.user.username,
    cashCount: Number.isFinite(cashCount) ? cashCount : null,
    note: note || null
  };

  saveDB(db);
  return res.json({ success: true, closed: db.closedDays[dayKey] });
});

// Fallback to SPA index (optional)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Burger Shot running on port ${PORT}`);
});
