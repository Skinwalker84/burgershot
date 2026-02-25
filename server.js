// ===============================
// Burger Shot – Railway Version
// Stable Volume Path: /data
// ===============================

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ===============================
// PERSISTENCE (Railway Volume)
// ===============================

const DATA_DIR = "/data";
const DB_FILE = path.join(DATA_DIR, "db.json");

console.log("Using DATA_DIR:", DATA_DIR);
console.log("Using DB_FILE:", DB_FILE);

function ensureDataDir() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (err) {
    console.error("❌ Failed to create data dir:", err);
  }
}

function loadDB() {
  ensureDataDir();

  if (!fs.existsSync(DB_FILE)) {
    const fresh = makeFreshDB();
    saveDB(fresh);
    return fresh;
  }

  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (err) {
    console.error("❌ DB load error:", err);
    const fresh = makeFreshDB();
    saveDB(fresh);
    return fresh;
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("❌ DB save error:", err);
  }
}

function makeFreshDB() {
  const today = getDayKey(new Date());
  const { salt, hash } = hashPassword("admin");

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
    sessions: {},
    salesByDay: { [today]: [] },
    kitchenByDay: { [today]: { pending: [], done: [] } }
  };
}

let db = loadDB();

// ===============================
// TIME HELPERS
// ===============================

function getDayKey(d) {
  return d.toISOString().slice(0, 10);
}

function rotateDay() {
  const today = getDayKey(new Date());
  if (db.meta.currentDay !== today) {
    db.meta.currentDay = today;
    if (!db.salesByDay[today]) db.salesByDay[today] = [];
    if (!db.kitchenByDay[today]) db.kitchenByDay[today] = { pending: [], done: [] };
    saveDB(db);
  }
}

// ===============================
// PASSWORD
// ===============================

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, pw) {
  const hash = crypto.pbkdf2Sync(password, pw.salt, 100000, 32, "sha256").toString("hex");
  return hash === pw.hash;
}

// ===============================
// SESSION
// ===============================

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  header.split(";").forEach(c => {
    const parts = c.trim().split("=");
    out[parts[0]] = decodeURIComponent(parts[1] || "");
  });
  return out;
}

function setCookie(res, name, value) {
  res.setHeader("Set-Cookie", `${name}=${value}; Path=/; HttpOnly; SameSite=Lax`);
}

function requireAuth(req, res, next) {
  rotateDay();
  const cookies = parseCookies(req);
  const token = cookies.bs_token;
  if (!token || !db.sessions[token]) {
    return res.status(401).json({ success: false });
  }
  req.user = db.sessions[token];
  next();
}

function requireBoss(req, res, next) {
  if (req.user.role !== "boss") {
    return res.status(403).json({ success: false });
  }
  next();
}

// ===============================
// AUTH ROUTES
// ===============================

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body;

  const user = db.users.find(u => u.username === username);
  if (!user || !verifyPassword(password, user.pw)) {
    return res.status(401).json({ success: false, message: "Login falsch." });
  }

  const token = crypto.randomBytes(24).toString("hex");
  db.sessions[token] = user;
  saveDB(db);

  setCookie(res, "bs_token", token);
  res.json({ success: true, user });
});

app.post("/auth/logout", (req, res) => {
  const cookies = parseCookies(req);
  delete db.sessions[cookies.bs_token];
  saveDB(db);
  setCookie(res, "bs_token", "");
  res.json({ success: true });
});

// ===============================
// SALE
// ===============================

app.post("/sale", requireAuth, (req, res) => {
  const { register, items, total, paidAmount } = req.body;

  if (!items || !Array.isArray(items) || !total) {
    return res.status(400).json({ success: false });
  }

  const tip = Math.max(0, paidAmount - total);
  const day = db.meta.currentDay;
  const id = db.meta.nextOrderId++;

  const sale = {
    id,
    time: new Date().toISOString(),
    employee: req.user.displayName,
    register,
    items,
    total,
    tip
  };

  db.salesByDay[day].push(sale);
  db.kitchenByDay[day].pending.push(sale);

  saveDB(db);

  res.json({ success: true, orderId: id, tip });
});

// ===============================
// REPORTS
// ===============================

app.get("/reports/summary", requireAuth, requireBoss, (req, res) => {
  const period = req.query.period || "day";
  const date = req.query.date || db.meta.currentDay;

  function summarizeDay(dayKey) {
    const sales = db.salesByDay[dayKey] || [];
    const revenue = sales.reduce((s, x) => s + x.total, 0);
    const tips = sales.reduce((s, x) => s + x.tip, 0);
    const orders = sales.length;
    const avg = orders ? revenue / orders : 0;
    return { day: dayKey, revenue, tips, orders, avg };
  }

  if (period === "day") {
    const sum = summarizeDay(date);
    return res.json({
      success: true,
      totals: sum,
      breakdown: [sum]
    });
  }

  // simple month example
  if (period === "month") {
    const [y, m] = date.split("-");
    const breakdown = [];
    for (let d = 1; d <= 31; d++) {
      const key = `${y}-${m}-${String(d).padStart(2,"0")}`;
      if (db.salesByDay[key]) breakdown.push(summarizeDay(key));
    }

    const totals = breakdown.reduce((acc, x) => {
      acc.revenue += x.revenue;
      acc.tips += x.tips;
      acc.orders += x.orders;
      return acc;
    }, { revenue:0, tips:0, orders:0 });

    totals.avg = totals.orders ? totals.revenue / totals.orders : 0;

    return res.json({ success:true, totals, breakdown });
  }

  res.json({ success:false });
});

// ===============================
// START
// ===============================

app.listen(PORT, () => {
  console.log("Burger Shot running on port", PORT);
});
