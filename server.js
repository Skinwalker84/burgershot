const express = require("express");
const path = require("path");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

/* ========= Zeit helpers (Berlin) ========= */
function berlinDateISO(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(d);
}

function berlinTimeHM(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit"
  });
  return fmt.format(d);
}

/* ========= Persistenz ========= */
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");

function defaultUsers() {
  return {
    boss: { username: "chrisadams", password: "burger123", displayName: "Chris Adams" },
    staff: [
      { username: "kasse1", password: "1234", displayName: "Kasse 1" },
      { username: "kasse2", password: "1234", displayName: "Kasse 2" },
      { username: "kasse3", password: "1234", displayName: "Kasse 3" }
    ]
  };
}

function normalizeUsername(u) {
  return String(u || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9_-]/g, "");
}

function cleanDisplayName(n, fallback) {
  const s = String(n || "").trim();
  return s.length ? s : fallback;
}

function migrateUsers(u) {
  const def = defaultUsers();
  const users = (u && typeof u === "object") ? u : def;

  if (!users.boss || typeof users.boss !== "object") users.boss = def.boss;
  users.boss.username = users.boss.username || def.boss.username;
  users.boss.password = users.boss.password || def.boss.password;
  users.boss.displayName = cleanDisplayName(users.boss.displayName, users.boss.username);

  if (!Array.isArray(users.staff)) users.staff = def.staff;
  users.staff = users.staff.map(s => {
    const username = s?.username || "";
    return {
      username,
      password: s?.password || "1234",
      displayName: cleanDisplayName(s?.displayName, username || "Mitarbeiter")
    };
  });

  return users;
}

function defaultData() {
  return {
    currentDay: berlinDateISO(),
    sales: [],
    employeeTotals: {}, // {name: {total, orders, tips}}
    dailyReports: [],
    users: defaultUsers(),

    kitchenOrders: [],
    orderSeq: 1
  };
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return defaultData();
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);

    const base = defaultData();
    const et = parsed.employeeTotals && typeof parsed.employeeTotals === "object" ? parsed.employeeTotals : {};

    // migrate employeeTotals -> ensure tips exists
    for (const k of Object.keys(et)) {
      if (!et[k] || typeof et[k] !== "object") et[k] = { total: 0, orders: 0, tips: 0 };
      if (!Number.isFinite(et[k].total)) et[k].total = 0;
      if (!Number.isFinite(et[k].orders)) et[k].orders = 0;
      if (!Number.isFinite(et[k].tips)) et[k].tips = 0;
    }

    return {
      currentDay: typeof parsed.currentDay === "string" ? parsed.currentDay : base.currentDay,
      sales: Array.isArray(parsed.sales) ? parsed.sales : [],
      employeeTotals: et,
      dailyReports: Array.isArray(parsed.dailyReports) ? parsed.dailyReports : [],
      users: migrateUsers(parsed.users),

      kitchenOrders: Array.isArray(parsed.kitchenOrders) ? parsed.kitchenOrders : [],
      orderSeq: Number.isFinite(parsed.orderSeq) ? parsed.orderSeq : 1
    };
  } catch (e) {
    console.error("Fehler beim Laden data.json:", e);
    return defaultData();
  }
}

function saveData() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ currentDay, sales, employeeTotals, dailyReports, users, kitchenOrders, orderSeq }, null, 2),
    "utf-8"
  );
}

let { currentDay, sales, employeeTotals, dailyReports, users, kitchenOrders, orderSeq } = loadData();

/* ========= Sessions ========= */
const sessions = new Map(); // token -> { username, role, displayName }

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function authRequired(req, res, next) {
  const token = req.cookies?.bs_session;
  if (!token || !sessions.has(token)) return res.status(401).json({ success: false, message: "Not logged in" });
  req.user = sessions.get(token);
  next();
}

function bossOnly(req, res, next) {
  if (req.user?.role !== "boss") return res.status(403).json({ success: false, message: "Boss only" });
  next();
}

/* ========= Auth ========= */
app.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, message: "Missing credentials" });

  const uname = normalizeUsername(username);

  if (normalizeUsername(users?.boss?.username) === uname && users?.boss?.password === password) {
    const token = newToken();
    const displayName = cleanDisplayName(users.boss.displayName, users.boss.username);
    sessions.set(token, { username: users.boss.username, role: "boss", displayName });
    res.cookie("bs_session", token, { httpOnly: true, sameSite: "lax" });
    return res.json({ success: true, role: "boss", username: users.boss.username, displayName });
  }

  const staff = Array.isArray(users?.staff) ? users.staff : [];
  const found = staff.find(u => normalizeUsername(u.username) === uname && u.password === password);
  if (found) {
    const token = newToken();
    const displayName = cleanDisplayName(found.displayName, found.username);
    sessions.set(token, { username: found.username, role: "staff", displayName });
    res.cookie("bs_session", token, { httpOnly: true, sameSite: "lax" });
    return res.json({ success: true, role: "staff", username: found.username, displayName });
  }

  return res.status(401).json({ success: false, message: "Falscher Login" });
});

app.post("/auth/logout", (req, res) => {
  const token = req.cookies?.bs_session;
  if (token) sessions.delete(token);
  res.clearCookie("bs_session");
  res.json({ success: true });
});

app.get("/auth/me", (req, res) => {
  const token = req.cookies?.bs_session;
  if (!token || !sessions.has(token)) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, ...sessions.get(token) });
});

/* ========= Sale + Trinkgeld + Küche ========= */
app.post("/sale", authRequired, (req, res) => {
  const sale = req.body;

  if (!sale || !Array.isArray(sale.items) || typeof sale.total !== "number") {
    return res.status(400).json({ success: false, message: "Invalid sale payload" });
  }

  const today = berlinDateISO();
  if (today !== currentDay) currentDay = today;

  const total = Number(sale.total);
  if (!Number.isFinite(total) || total < 0) {
    return res.status(400).json({ success: false, message: "Invalid total" });
  }

  // bezahlt (optional)
  let paid = sale.paidAmount;
  paid = paid === undefined || paid === null || paid === "" ? total : Number(paid);
  if (!Number.isFinite(paid) || paid < 0) {
    return res.status(400).json({ success: false, message: "Invalid paidAmount" });
  }

  // Trinkgeld serverseitig berechnen
  const tip = Math.max(0, Math.round((paid - total) * 100) / 100);

  const record = {
    day: currentDay,
    employee: req.user.displayName,
    employeeUser: req.user.username,
    register: sale.register ?? null,
    time: sale.time || new Date().toISOString(),
    items: sale.items,
    total: total,
    paidAmount: paid,
    tip: tip
  };

  sales.push(record);

  // Mitarbeiter totals
  const key = req.user.displayName;
  if (!employeeTotals[key]) employeeTotals[key] = { total: 0, orders: 0, tips: 0 };
  employeeTotals[key].total += total;
  employeeTotals[key].orders += 1;
  employeeTotals[key].tips += tip;

  // Küche Order
  const order = {
    id: orderSeq++,
    day: currentDay,
    time: record.time,
    timeHM: berlinTimeHM(new Date(record.time)),
    register: record.register,
    employee: record.employee,
    items: record.items,
    total: record.total,
    status: "pending"
  };
  kitchenOrders.push(order);

  saveData();
  res.json({ success: true, orderId: order.id, tip });
});

/* ========= Stats ========= */
app.get("/stats", authRequired, (req, res) => {
  res.json({ success: true, currentDay, sales, employees: employeeTotals, me: req.user });
});

/* ========= Küche API ========= */
app.get("/kitchen/orders", authRequired, (req, res) => {
  const pending = kitchenOrders.filter(o => o.status === "pending");
  res.json({ success: true, pending, currentDay });
});

app.post("/kitchen/complete", authRequired, (req, res) => {
  const { id } = req.body || {};
  const orderId = Number(id);
  if (!Number.isFinite(orderId)) return res.status(400).json({ success: false, message: "Invalid id" });

  const order = kitchenOrders.find(o => o.id === orderId);
  if (!order) return res.status(404).json({ success: false, message: "Order not found" });

  order.status = "done";
  order.doneTime = new Date().toISOString();
  saveData();
  res.json({ success: true });
});

/* ========= Chef: Mitarbeiter ========= */
app.get("/users", authRequired, bossOnly, (req, res) => {
  const staff = Array.isArray(users.staff) ? users.staff : [];
  res.json({
    success: true,
    boss: { username: users.boss.username, displayName: users.boss.displayName },
    staff: staff.map(u => ({ username: u.username, displayName: u.displayName }))
  });
});

app.post("/users/add", authRequired, bossOnly, (req, res) => {
  let { username, password, displayName } = req.body || {};
  const rawUsername = username;

  username = normalizeUsername(username);
  password = String(password || "");
  displayName = cleanDisplayName(displayName, rawUsername || username);

  if (!username) return res.status(400).json({ success: false, message: "Ungültiger Username" });
  if (password.length < 3) return res.status(400).json({ success: false, message: "Passwort zu kurz" });

  const staff = Array.isArray(users.staff) ? users.staff : [];
  const exists =
    normalizeUsername(users.boss.username) === username ||
    staff.some(u => normalizeUsername(u.username) === username);

  if (exists) return res.status(400).json({ success: false, message: "Username existiert schon" });

  staff.push({ username, password, displayName });
  users.staff = staff;
  saveData();
  res.json({ success: true });
});

app.post("/users/delete", authRequired, bossOnly, (req, res) => {
  let { username } = req.body || {};
  username = normalizeUsername(username);
  if (!username) return res.status(400).json({ success: false, message: "Ungültiger Username" });

  const before = users.staff.length;
  users.staff = users.staff.filter(u => normalizeUsername(u.username) !== username);
  if (users.staff.length === before) return res.status(404).json({ success: false, message: "User nicht gefunden" });

  saveData();
  res.json({ success: true });
});

/* ========= Chef: Reset ========= */
app.post("/reset", authRequired, bossOnly, (req, res) => {
  sales = [];
  employeeTotals = {};
  kitchenOrders = [];
  orderSeq = 1;
  saveData();
  res.json({ success: true });
});

/* ========= Start ========= */
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log("Server läuft auf Port " + PORT));
