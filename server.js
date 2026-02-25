// server.js — Burger Shot (Railway + Volume /data)
// Full API: auth, users, stats, sales, kitchen, reset, reports

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 8080);

// --- middleware
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// -------------------- Persistent storage (Railway Volume) --------------------
const DATA_DIR = "/data";
const DB_FILE = path.join(DATA_DIR, "db.json");

console.log("Using DATA_DIR:", DATA_DIR);
console.log("Using DB_FILE:", DB_FILE);

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.error("❌ Cannot create DATA_DIR:", DATA_DIR, e);
  }
}

function atomicWrite(filePath, content) {
  try {
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, filePath);
    return true;
  } catch (e) {
    console.error("❌ atomicWrite failed:", e);
    return false;
  }
}

function makeFreshDB() {
  const today = getDayKeyLocal(new Date());
  const { salt, hash } = hashPassword("admin"); // default boss pw
  return {
    meta: {
      currentDay: today,
      nextOrderId: 1
    },
    users: [
      {
        username: "chris.adams",
        displayName: "Chris Adams",
        role: "boss",
        pw: { salt, hash }
      }
    ],
    sessions: {}, // token -> { username, exp }
    salesByDay: { [today]: [] },
    kitchenByDay: { [today]: { pending: [], done: [] } }
  };
}

function normalizeDB(db) {
  if (!db || typeof db !== "object") return makeFreshDB();

  db.meta ||= {};
  db.meta.currentDay ||= getDayKeyLocal(new Date());
  db.meta.nextOrderId ||= 1;

  if (!Array.isArray(db.users)) db.users = [];
  if (!db.sessions || typeof db.sessions !== "object") db.sessions = {};
  if (!db.salesByDay || typeof db.salesByDay !== "object") db.salesByDay = {};
  if (!db.kitchenByDay || typeof db.kitchenByDay !== "object") db.kitchenByDay = {};

  const day = db.meta.currentDay;
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

function loadDB() {
  ensureDataDir();

  if (!fs.existsSync(DB_FILE)) {
    const fresh = makeFreshDB();
    atomicWrite(DB_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }

  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    return normalizeDB(JSON.parse(raw));
  } catch (e) {
    console.error("❌ Failed to read db.json, creating fresh DB:", e);
    const fresh = makeFreshDB();
    atomicWrite(DB_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function saveDB() {
  ensureDataDir();
  atomicWrite(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();

// -------------------- time helpers --------------------
function getDayKeyLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function parseDateYYYYMMDD(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

function startOfWeekMonday(dateLocal) {
  const d = new Date(dateLocal.getFullYear(), dateLocal.getMonth(), dateLocal.getDate());
  const day = d.getDay(); // 0 Sun..6 Sat
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(dateLocal, n) {
  const d = new Date(dateLocal.getFullYear(), dateLocal.getMonth(), dateLocal.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

function toHM(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function rotateDayIfNeeded() {
  const today = getDayKeyLocal(new Date());
  if (db.meta.currentDay !== today) {
    db.meta.currentDay = today;
    if (!Array.isArray(db.salesByDay[today])) db.salesByDay[today] = [];
    if (!db.kitchenByDay[today]) db.kitchenByDay[today] = { pending: [], done: [] };
    saveDB();
  }
}

// -------------------- password hashing --------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, pwObj) {
  if (!pwObj?.salt || !pwObj?.hash) return false;
  const hash = crypto.pbkdf2Sync(password, pwObj.salt, 120000, 32, "sha256").toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(pwObj.hash, "hex"));
  } catch {
    return false;
  }
}

// -------------------- cookies + sessions --------------------
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
  parts.push("Path=/");
  parts.push("HttpOnly");
  parts.push("SameSite=Lax");
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  // Railway runs https at the edge; Secure is fine
  parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, s] of Object.entries(db.sessions)) {
    if (!s || !s.exp || s.exp < now) delete db.sessions[token];
  }
}

function createSession(username) {
  const token = crypto.randomBytes(24).toString("hex");
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 14;
  db.sessions[token] = { username, exp };
  saveDB();
  return token;
}

function getUserFromReq(req) {
  cleanupSessions();
  const cookies = parseCookies(req);
  const token = cookies["bs_token"];
  if (!token) return null;
  const sess = db.sessions[token];
  if (!sess) return null;
  const user = db.users.find(u => u.username === sess.username);
  return user || null;
}

function requireAuth(req, res, next) {
  rotateDayIfNeeded();
  const user = getUserFromReq(req);
  if (!user) return res.status(401).json({ success: false, message: "Not logged in" });
  req.user = user;
  next();
}

function requireBoss(req, res, next) {
  if (req.user?.role !== "boss") {
    return res.status(403).json({ success: false, message: "Boss only" });
  }
  next();
}

function publicUser(u) {
  return { username: u.username, displayName: u.displayName, role: u.role };
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

  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  const u = db.users.find(x => x.username === username);
  if (!u) return res.status(401).json({ success: false, message: "Falscher Login." });

  if (!verifyPassword(password, u.pw)) {
    return res.status(401).json({ success: false, message: "Falscher Login." });
  }

  const token = createSession(u.username);
  setCookie(res, "bs_token", token, { maxAge: 60 * 60 * 24 * 14 });
  res.json({ success: true, user: publicUser(u) });
});

app.post("/auth/logout", (req, res) => {
  rotateDayIfNeeded();
  const cookies = parseCookies(req);
  const token = cookies["bs_token"];
  if (token && db.sessions[token]) {
    delete db.sessions[token];
    saveDB();
  }
  setCookie(res, "bs_token", "", { maxAge: 0 });
  res.json({ success: true });
});

// -------------------- USERS (Boss) --------------------
app.get("/users", requireAuth, requireBoss, (req, res) => {
  const staff = db.users.filter(u => u.role !== "boss").map(publicUser);
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
  saveDB();
  res.json({ success: true });
});

app.post("/users/delete", requireAuth, requireBoss, (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  if (!username) return res.status(400).json({ success: false, message: "Username fehlt." });

  const user = db.users.find(u => u.username === username);
  if (!user) return res.status(404).json({ success: false, message: "Nicht gefunden." });
  if (user.role === "boss") return res.status(400).json({ success: false, message: "Chef kann nicht gelöscht werden." });

  db.users = db.users.filter(u => u.username !== username);

  // remove sessions
  for (const [token, s] of Object.entries(db.sessions)) {
    if (s?.username === username) delete db.sessions[token];
  }

  saveDB();
  res.json({ success: true });
});

// -------------------- STATS (today) --------------------
app.get("/stats", requireAuth, (req, res) => {
  const sales = todaysSales();

  const employees = {};
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

// -------------------- SALE --------------------
app.post("/sale", requireAuth, (req, res) => {
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

  if (!Array.isArray(db.salesByDay[day])) db.salesByDay[day] = [];
  db.salesByDay[day].push(sale);

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

  saveDB();
  res.json({ success: true, orderId, tip });
});

// -------------------- KITCHEN --------------------
app.get("/kitchen/orders", requireAuth, (req, res) => {
  const kitchen = todaysKitchen();
  const pending = kitchen.pending.slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  res.json({ success: true, currentDay: db.meta.currentDay, pending });
});

app.post("/kitchen/complete", requireAuth, (req, res) => {
  const id = Number(req.body?.id);
  if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "ID fehlt." });

  const kitchen = todaysKitchen();
  const idx = kitchen.pending.findIndex(o => Number(o.id) === id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Order nicht gefunden." });

  const doneOrder = kitchen.pending.splice(idx, 1)[0];
  kitchen.done.push({ ...doneOrder, completedAt: new Date().toISOString() });

  saveDB();
  res.json({ success: true });
});

// -------------------- RESET (today) --------------------
app.post("/reset", requireAuth, requireBoss, (req, res) => {
  const day = db.meta.currentDay;
  db.salesByDay[day] = [];
  db.kitchenByDay[day] = { pending: [], done: [] };
  saveDB();
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

  function summarizeDay(dayKey) {
    const sales = Array.isArray(db.salesByDay[dayKey]) ? db.salesByDay[dayKey] : [];
    const revenue = sales.reduce((s, x) => s + Number(x.total || 0), 0);
    const tips = sales.reduce((s, x) => s + Number(x.tip || 0), 0);
    const orders = sales.length;
    const avg = orders > 0 ? revenue / orders : 0;
    return { day: dayKey, revenue, tips, orders, avg };
  }

  if (period === "day") {
    const dayKey = getDayKeyLocal(date);
    const sum = summarizeDay(dayKey);
    return res.json({
      success: true,
      period: "day",
      range: { start: dayKey, end: dayKey },
      totals: { revenue: sum.revenue, tips: sum.tips, orders: sum.orders, avg: sum.avg },
      breakdown: [sum]
    });
  }

  if (period === "week") {
    const start = startOfWeekMonday(date);
    const days = [];
    for (let i = 0; i < 7; i++) days.push(getDayKeyLocal(addDays(start, i)));

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

  if (period === "month") {
    const y = date.getFullYear();
    const m = date.getMonth();
    const first = new Date(y, m, 1);
    const next = new Date(y, m + 1, 1);

    const breakdown = [];
    for (let d = new Date(first); d < next; d = addDays(d, 1)) {
      breakdown.push(summarizeDay(getDayKeyLocal(d)));
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

  if (period === "year") {
    const y = date.getFullYear();
    const breakdown = [];

    for (let month = 0; month < 12; month++) {
      const first = new Date(y, month, 1);
      const next = new Date(y, month + 1, 1);

      let revenue = 0, tips = 0, orders = 0;
      for (let d = new Date(first); d < next; d = addDays(d, 1)) {
        const sum = summarizeDay(getDayKeyLocal(d));
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

// -------------------- SPA fallback --------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// -------------------- IMPORTANT: bind 0.0.0.0 for Railway --------------------
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Burger Shot running on http://${HOST}:${PORT}`);
});

// helpful crash logs
process.on("uncaughtException", (err) => console.error("❌ uncaughtException:", err));
process.on("unhandledRejection", (err) => console.error("❌ unhandledRejection:", err));
