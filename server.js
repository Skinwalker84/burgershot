// server.js — BurgerShot POS · Kompletter Neubau
"use strict";
const express  = require("express");
const path     = require("path");
const fs       = require("fs");
const crypto   = require("crypto");

const app  = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = Date.now();

app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── DB Path ──────────────────────────────────────────────────────────────────
const DB_PATH = process.env.DATA_FILE || process.env.DB_PATH
  ? path.resolve(process.env.DATA_FILE || process.env.DB_PATH)
  : path.join(__dirname, "data", "db.json");
console.log("[DB] Pfad:", DB_PATH);

// ── Produkte (Default) ───────────────────────────────────────────────────────
const DEFAULT_PRODUCTS = [
  { id:"bleeder",            name:"The Bleeder",          price:19,  cat:"Burger" },
  { id:"heartstopper",       name:"The Heartstopper",     price:21,  cat:"Burger" },
  { id:"chicken",            name:"The Chicken",          price:17,  cat:"Burger" },
  { id:"vegan_burger",       name:"Vegan Burger",         price:15,  cat:"Burger" },
  { id:"chozzo",             name:"The Chozzo",           price:17,  cat:"Burger" },
  { id:"german",             name:"The German",           price:21,  cat:"Burger" },
  { id:"breakfast_deluxe",   name:"Breakfast Deluxe",     price:0,   cat:"Burger", icon:"breakfast_deluxe.png" },
  { id:"special_burger",     name:"Special Burger",       price:0,   cat:"Burger", icon:"special_burger.png" },

  { id:"coleslaw",           name:"Coleslaw",             price:15,  cat:"Beilagen" },
  { id:"fries",              name:"Fries",                price:11,  cat:"Beilagen" },
  { id:"cheesy_fries",       name:"Cheesy Fries",         price:13,  cat:"Beilagen" },
  { id:"chicken_nuggets",    name:"Chicken Nuggets",      price:15,  cat:"Beilagen" },
  { id:"onion_rings",        name:"Onion Rings",          price:11,  cat:"Beilagen" },

  { id:"ecola",              name:"ECola",                price:13,  cat:"Getränke" },
  { id:"ecola_light",        name:"ECola Light",          price:13,  cat:"Getränke" },
  { id:"sprunk",             name:"Sprunk",               price:13,  cat:"Getränke" },
  { id:"sprunk_light",       name:"Sprunk Light",         price:13,  cat:"Getränke" },
  { id:"slush",              name:"Slush",                price:15,  cat:"Getränke" },
  { id:"milchshake",         name:"Milchshake",           price:15,  cat:"Getränke" },
  { id:"orange_o_tang",      name:"Orange O Tang",        price:9,   cat:"Getränke", icon:"orang_o_tang.png" },
  { id:"mexi_coke_spicy",    name:"Mexi-Coke Spicy",      price:13,  cat:"Getränke", icon:"mexi_coke_spicy.png" },
  { id:"junk_energy",        name:"Junk Energy",          price:15,  cat:"Getränke", icon:"junk_energy.png" },
  { id:"juice_apple",        name:"Apfelsaft",            price:8,   cat:"Getränke", icon:"Juice_Apple.png" },
  { id:"juice_orange",       name:"Orangensaft",          price:8,   cat:"Getränke", icon:"Juice_Orange.png" },
  { id:"slushy_atom",        name:"Slush Atom",           price:18,  cat:"Getränke", icon:"slushy_atom.png" },
  { id:"electrolyte_drink",  name:"Elektrolyte Trink",    price:14,  cat:"Getränke", icon:"electrolytet_rink.png" },
  { id:"splashy_drink",      name:"Splashy Drink",        price:0,   cat:"Getränke", icon:"splashy.png" },

  { id:"donut",              name:"Donut",                price:13,  cat:"Süßes" },
  { id:"caramel_sundae",     name:"Caramel Sundae",       price:13,  cat:"Süßes" },
  { id:"chocolate_sundae",   name:"Chocolate Sundae",     price:13,  cat:"Süßes" },
  { id:"strawberry_sundae",  name:"Strawberry Sundae",    price:13,  cat:"Süßes" },

  // Menüs
  { id:"menu_small",    name:"Small Menü",          price:48,  cat:"Menü", icon:"small.png",           groupSize:1,  desc:"1× Burger, Beilage & Getränk" },
  { id:"menu_medium",   name:"Medium Menü",         price:97,  cat:"Menü", icon:"medium.png",          groupSize:2,  desc:"2× Burger, Beilage & Getränk" },
  { id:"menu_large",    name:"Large Menü",          price:242, cat:"Menü", icon:"large.png",           groupSize:5,  desc:"5× Burger, Beilage & Getränk" },
  { id:"menu_xlarge",   name:"X-tra Large Menü",    price:484, cat:"Menü", icon:"xl.png",              groupSize:10, desc:"10× Burger, Beilage & Getränk" },

  { id:"ns_small",      name:"No Sides Small",      price:34,  cat:"Menü", icon:"no_sides_small.png",  groupSize:1,  noSidesBox:true, desc:"1× Burger & 1 Getränk" },
  { id:"ns_medium",     name:"No Sides Medium",     price:68,  cat:"Menü", icon:"no_sides_medium.png", groupSize:2,  noSidesBox:true, desc:"2× Burger & 2 Getränke" },
  { id:"ns_large",      name:"No Sides Large",      price:171, cat:"Menü", icon:"no_sides_large.png",  groupSize:5,  noSidesBox:true, desc:"5× Burger & 5 Getränke" },
  { id:"ns_xl",         name:"No Sides X-tra Large",price:342, cat:"Menü", icon:"no_sides_xl.png",     groupSize:10, noSidesBox:true, desc:"10× Burger & 10 Getränke" },

  { id:"sbmenu_small",  name:"Special Burger Small",       price:0, cat:"Menü", icon:"special_burger.png", groupSize:1,  specialBurgerBox:true, desc:"1× Special Burger, 1 Side, 1 Dessert & 1 Getränk" },
  { id:"sbmenu_medium", name:"Special Burger Medium",      price:0, cat:"Menü", icon:"special_burger.png", groupSize:2,  specialBurgerBox:true, desc:"2× Special Burger, 2 Sides, 2 Desserts & 2 Getränke" },
  { id:"sbmenu_large",  name:"Special Burger Large",       price:0, cat:"Menü", icon:"special_burger.png", groupSize:5,  specialBurgerBox:true, desc:"5× Special Burger, 5 Sides, 5 Desserts & 5 Getränke" },
  { id:"sbmenu_xl",     name:"Special Burger X-tra Large", price:0, cat:"Menü", icon:"special_burger.png", groupSize:10, specialBurgerBox:true, desc:"10× Special Burger, 10 Sides, 10 Desserts & 10 Getränke" },

  { id:"dbox_small",    name:"Donut Box Small",      price:49,  cat:"Menü", icon:"donut_box.png", donutBox:true, groupSize:4,  desc:"4× Donut" },
  { id:"dbox_medium",   name:"Donut Box Medium",     price:74,  cat:"Menü", icon:"donut_box.png", donutBox:true, groupSize:6,  desc:"6× Donut" },
  { id:"dbox_large",    name:"Donut Box Large",      price:148, cat:"Menü", icon:"donut_box.png", donutBox:true, groupSize:12, desc:"12× Donut" },
  { id:"dbox_xl",       name:"Donut Box X-tra Large",price:247, cat:"Menü", icon:"donut_box.png", donutBox:true, groupSize:20, desc:"20× Donut" },
];

// ── Kisten-Konfiguration (1 Lebensmittelkarton = X Portionen) ────────────────
const CRATE_CONFIG = {
  "The Heartstopper":  5,  "Vegan Burger":      8,
  "The Bleeder":       6,  "The Chicken":       7,
  "The Chozzo":        7,  "The German":        5,
  "Special Burger":    3,  "Breakfast Deluxe":  5,
  "Fries":            13,  "Cheesy Fries":     10,
  "Onion Rings":      13,  "Chicken Nuggets":   8,
  "Coleslaw":          8,  "Donut":            10,
  "Caramel Sundae":   10,  "Chocolate Sundae": 10,
  "Strawberry Sundae":10,  "Milchshake":        8,
  "ECola":            10,  "ECola Light":      10,
  "Sprunk":           10,  "Sprunk Light":     10,
  "Slush":             8,  "Slush Atom":        8,
  "Splashy Drink":    10,
};

// ── Weekly Special Burger ────────────────────────────────────────────────────
const SPECIAL_BURGER_CYCLE = [
  "Crispy Tropical Fish Burger", "Smokey Mountain",
  "Sweet & Salty Crunch", "Spicy Inferno", "Veggie Volcano"
];
const SPECIAL_BURGER_START_WEEK = 9;

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - y) / 86400000) + 1) / 7);
}
function isoWeekYearWeek(d) {
  const week = getISOWeek(d);
  const year = d.getFullYear();
  return { year, week };
}
function getCurrentSpecialBurgerName() {
  const week = getISOWeek(new Date());
  const idx  = ((week - SPECIAL_BURGER_START_WEEK) % SPECIAL_BURGER_CYCLE.length + SPECIAL_BURGER_CYCLE.length) % SPECIAL_BURGER_CYCLE.length;
  return SPECIAL_BURGER_CYCLE[idx];
}

// ── Date Helpers ─────────────────────────────────────────────────────────────
function getDayKeyLocal(d) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:"Europe/Berlin", year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(d);
  const g = t => parts.find(p => p.type === t)?.value || "00";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
function parseDateYYYYMMDD(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function isoWeekStartDate(year, week) {
  const jan4 = new Date(year, 0, 4); jan4.setHours(0,0,0,0);
  const w1 = new Date(jan4); w1.setDate(jan4.getDate() - ((jan4.getDay()+6)%7));
  const s  = new Date(w1);  s.setDate(w1.getDate() + (week-1)*7); return s;
}
function parseWeekYYYY_Www(s) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(s||""));
  if (!m) return null;
  const y = Number(m[1]), w = Number(m[2]);
  if (w < 1 || w > 53) return null;
  return { year:y, week:w };
}
function parseMonthYYYY_MM(s) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(s||""));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return { year:y, month:mo };
}
function toHM(iso) {
  const d = new Date(iso); if (isNaN(d)) return "—";
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

// ── Password ──────────────────────────────────────────────────────────────────
function hashPassword(pw, salt = null) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const h = crypto.pbkdf2Sync(String(pw), s, 120000, 32, "sha256").toString("hex");
  return { salt:s, hash:h };
}
function verifyPassword(pw, obj) {
  if (!obj?.salt || !obj?.hash) return false;
  const { hash } = hashPassword(pw, obj.salt);
  return crypto.timingSafeEqual(Buffer.from(hash,"hex"), Buffer.from(obj.hash,"hex"));
}

// ── Cookie ────────────────────────────────────────────────────────────────────
function setCookie(res, name, value, opts={}) {
  const p = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (opts.maxAge) p.push(`Max-Age=${opts.maxAge}`);
  res.setHeader("Set-Cookie", p.join("; "));
}
function clearCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; Path=/; Max-Age=0; HttpOnly`);
}
function getToken(req) {
  const c = String(req.headers.cookie || "");
  return /(?:^|;\s*)bs_token=([^;]+)/.exec(c)?.[1] || null;
}

// ── DB I/O ───────────────────────────────────────────────────────────────────
function safeReadJSON(fp) {
  try { return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp,"utf-8")) : null; }
  catch(e) { console.error("DB read error:", e); return null; }
}
function safeWriteJSON(fp, obj) {
  try {
    fs.mkdirSync(path.dirname(fp), { recursive:true });
    const tmp = fp + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
    fs.renameSync(tmp, fp);
    return true;
  } catch(e) { console.error("DB write error:", e); return false; }
}

// ── DB Schema ─────────────────────────────────────────────────────────────────
function makeFreshDB() {
  const today = getDayKeyLocal(new Date());
  const { salt, hash } = hashPassword("admin");
  return {
    meta: { currentDay: today, nextOrderId: 1 },
    users: [{ username:"chris.adams", displayName:"Chris Adams", role:"boss", pw:{salt,hash} }],
    sessions: {},
    products: [],           // prices/icons overrides only; defaults via DEFAULT_PRODUCTS
    hiddenProducts: [],
    // ── Lager: nur lmk + cooked_* ──
    inventory: [
      { id:"lmk", name:"Lebensmittelkarton", unit:"Karton", stock:0, minStock:5, ekPrice:0, updatedAt:new Date().toISOString() }
    ],
    purchases: [],
    purchaseOverrides: {},
    salesByDay: { [today]: [] },
    kitchenByDay: { [today]: { pending:[], done:[] } },
    closedDays: {},
    expenses: [],
    bankBalance: 0,
    bankLog: [],
    board: [],
    zutaten: [],
    giftCards: {},
  };
}

function normalizeDB(raw) {
  if (!raw || typeof raw !== "object") return makeFreshDB();
  const db = raw;
  if (!db.meta || typeof db.meta !== "object") db.meta = {};
  if (!db.meta.currentDay) db.meta.currentDay = getDayKeyLocal(new Date());
  if (!db.meta.nextOrderId) db.meta.nextOrderId = 1;
  if (!Array.isArray(db.users)) db.users = [];
  if (!db.sessions || typeof db.sessions !== "object") db.sessions = {};
  if (!Array.isArray(db.products)) db.products = [];
  if (!Array.isArray(db.hiddenProducts)) db.hiddenProducts = [];
  if (!db.salesByDay || typeof db.salesByDay !== "object") db.salesByDay = {};
  if (!db.kitchenByDay || typeof db.kitchenByDay !== "object") db.kitchenByDay = {};
  if (!db.closedDays || typeof db.closedDays !== "object") db.closedDays = {};
  if (!Array.isArray(db.expenses)) db.expenses = [];
  if (!Number.isFinite(db.bankBalance)) db.bankBalance = 0;
  if (!Array.isArray(db.bankLog)) db.bankLog = [];
  if (!Array.isArray(db.board)) db.board = [];
  if (!Array.isArray(db.zutaten)) db.zutaten = [];
  if (!db.giftCards || typeof db.giftCards !== "object") db.giftCards = {};
  if (!db.purchaseOverrides || typeof db.purchaseOverrides !== "object") db.purchaseOverrides = {};
  if (!Array.isArray(db.purchases)) db.purchases = [];
  // Inventory: ensure lmk exists, keep cooked_* items
  if (!Array.isArray(db.inventory)) db.inventory = [];
  // Remove old-style inventory items (random hex IDs) but keep cooked_* and lmk
  db.inventory = db.inventory.filter(x => x && (x.id === "lmk" || String(x.id||"").startsWith("cooked_")));
  if (!db.inventory.find(x => x.id === "lmk")) {
    db.inventory.unshift({ id:"lmk", name:"Lebensmittelkarton", unit:"Karton", stock:0, minStock:5, ekPrice:0, updatedAt:new Date().toISOString() });
  }
  return db;
}

// ── Produkt-Normalisierung ────────────────────────────────────────────────────
function getProducts(db) {
  const overrides = new Map((db.products||[]).map(p => [p.id, p]));
  const hidden    = new Set(db.hiddenProducts||[]);
  return DEFAULT_PRODUCTS
    .filter(p => !hidden.has(p.id))
    .map(p => {
      const ov = overrides.get(p.id) || {};
      const extra = {};
      for (const k of ["icon","desc","groupSize","chickenBox","donutBox","germanBox","noSidesBox","specialBurgerBox"]) {
        const val = ov[k] ?? p[k];
        if (val !== undefined) extra[k] = val;
      }
      return { id:p.id, name:p.name, cat:p.cat, price: Number(ov.price ?? p.price)||0, ...extra };
    });
}

// ── Load DB ───────────────────────────────────────────────────────────────────
let db;
{
  const raw = safeReadJSON(DB_PATH);
  db = raw ? normalizeDB(raw) : makeFreshDB();
  if (!raw) safeWriteJSON(DB_PATH, db);
  console.log("[STARTUP] DB geladen:", !!raw);
  console.log("[STARTUP] Inventory:", db.inventory.length, "Artikel");
  console.log("[STARTUP] Mitarbeiter:", db.users.length);
}

function saveDB(next) {
  db = normalizeDB(next || db);
  safeWriteJSON(DB_PATH, db);
}

// ── Bank ──────────────────────────────────────────────────────────────────────
function adjustBank(amount, note) {
  if (!Number.isFinite(amount) || amount === 0) return;
  if (!Number.isFinite(db.bankBalance)) db.bankBalance = 0;
  const prev = db.bankBalance;
  db.bankBalance = Math.round((db.bankBalance + amount) * 100) / 100;
  db.bankLog = db.bankLog || [];
  db.bankLog.unshift({ ts: new Date().toISOString(), prev, amount, next: db.bankBalance, note: note||"" });
  if (db.bankLog.length > 500) db.bankLog.length = 500;
}

// ── Day Rotation ──────────────────────────────────────────────────────────────
function rotateDayIfNeeded() {
  const today = getDayKeyLocal(new Date());
  if (db.meta.currentDay === today) return;
  db.meta.currentDay = today;
  if (!db.salesByDay[today]) db.salesByDay[today] = [];
  if (!db.kitchenByDay[today]) db.kitchenByDay[today] = { pending:[], done:[] };
  saveDB(db);
}

// ── Cost Helpers ──────────────────────────────────────────────────────────────
function getPurchaseCosts(dayKeys) {
  const keySet = new Set(dayKeys);
  let total = 0;
  for (const p of db.purchases||[]) {
    const day = (p.date||p.createdAt||"").slice(0,10);
    if (keySet.has(day)) total += Number(p.price||0) * Number(p.qty||0);
  }
  for (const [key, val] of Object.entries(db.purchaseOverrides||{})) {
    if (keySet.has(key)) total = Number(val);
  }
  return Math.round(total * 100) / 100;
}
function getExpensesCosts(dayKeys) {
  const keySet = new Set(dayKeys);
  let total = 0;
  for (const e of db.expenses||[]) {
    const day = (e.date||e.createdAt||"").slice(0,10);
    if (keySet.has(day)) total += Number(e.amount||0);
  }
  return Math.round(total * 100) / 100;
}

// ── Presence / Carts (SSE) ───────────────────────────────────────────────────
let presenceState = { "1":{users:{}},"2":{users:{}},"3":{users:{}},"4":{users:{}},"5":{users:{}},"6":{users:{}} };
let onlineUsers   = {};
const presenceClients = new Set();
let cartsState    = { 1:[],2:[],3:[],4:[],5:[],6:[] };
let cartsRev      = 0;
const cartsClients = new Set();

// lastSeen debounce
let _lastSeenTimer = null;
function scheduleLastSeenSave() {
  if (_lastSeenTimer) clearTimeout(_lastSeenTimer);
  _lastSeenTimer = setTimeout(() => { _lastSeenTimer = null; saveDB(db); }, 2000);
}

function prunePresence() {
  const now = Date.now(); let changed = false;
  for (const u of Object.keys(onlineUsers)) {
    if (now - (onlineUsers[u].at||0) > 30000) { delete onlineUsers[u]; changed = true; }
  }
  for (const k of ["1","2","3","4","5","6"]) {
    const users = presenceState[k]?.users || {};
    for (const u of Object.keys(users)) {
      if (now - (users[u].at||0) > 20000) { delete users[u]; changed = true; }
    }
  }
  if (changed) broadcastPresence();
}
setInterval(prunePresence, 5000);

function broadcastPresence() {
  const payload = JSON.stringify({ presence: presenceState, online: onlineUsers, ts: Date.now() });
  for (const res of presenceClients) {
    try { res.write(`data: ${payload}\n\n`); } catch(e) { presenceClients.delete(res); }
  }
}
function broadcastCarts() {
  cartsRev++;
  const payload = JSON.stringify({ rev: cartsRev, carts: cartsState });
  for (const res of cartsClients) {
    try { res.write(`data: ${payload}\n\n`); } catch(e) { cartsClients.delete(res); }
  }
}
function normalizeCarts(obj) {
  const out = {1:[],2:[],3:[],4:[],5:[],6:[]};
  for (const k of [1,2,3,4,5,6]) {
    const arr = obj && (obj[k] || obj[String(k)]);
    if (Array.isArray(arr)) {
      out[k] = arr.filter(x => x && typeof x==="object").map(x => ({
        name: String(x.name||""), price: Number(x.price)||0,
        qty: Number(x.qty)||1, productId: x.productId||null, components: x.components||null
      }));
    }
  }
  return out;
}

// ── Middleware ────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  rotateDayIfNeeded();
  const token = getToken(req);
  if (!token || !db.sessions[token]) return res.status(401).json({ success:false, message:"Nicht eingeloggt." });
  const sess = db.sessions[token];
  if (sess.exp && Date.now() > sess.exp) {
    delete db.sessions[token]; saveDB(db);
    return res.status(401).json({ success:false, message:"Session abgelaufen." });
  }
  const user = db.users.find(u => u.username === sess.username);
  if (!user) {
    delete db.sessions[token]; saveDB(db);
    return res.status(401).json({ success:false, message:"User nicht gefunden." });
  }
  if (user.locked) return res.status(403).json({ success:false, message:"Zugang gesperrt.", locked:true });
  // Auto-logout after 1h inactivity (session-based)
  const INACTIVITY = 60 * 60 * 1000;
  const now = Date.now();
  if (user.role !== "boss") {
    const lastActive = sess.lastActivity || now;
    if (now - lastActive > INACTIVITY) {
      delete db.sessions[token]; saveDB(db);
      return res.status(401).json({ success:false, message:"Automatisch ausgeloggt (Inaktivität)." });
    }
  }
  sess.lastActivity = now;
  user.lastSeen = new Date(now).toISOString();
  req.user = user; req.token = token;
  next();
}
function requireBoss(req, res, next) {
  if (req.user?.role !== "boss") return res.status(403).json({ success:false, message:"Nur Chef." });
  next();
}
function requireBossOrManager(req, res, next) {
  if (!["boss","manager"].includes(req.user?.role)) return res.status(403).json({ success:false, message:"Nur Chef / Manager." });
  next();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Health & Version ──────────────────────────────────────────────────────────
app.get("/health",  (req, res) => res.json({ ok:true }));
app.get("/version", (req, res) => res.json({ version: APP_VERSION }));

// ── Auth ──────────────────────────────────────────────────────────────────────
app.get("/auth/me", (req, res) => {
  const token = getToken(req);
  if (!token || !db.sessions[token]) return res.json({ success:true, loggedIn:false });
  const sess = db.sessions[token];
  const user = db.users.find(u => u.username === sess.username);
  if (!user || user.locked) return res.json({ success:true, loggedIn:false });
  if (sess.exp && Date.now() > sess.exp) return res.json({ success:true, loggedIn:false });
  res.json({ success:true, loggedIn:true, currentDay: db.meta.currentDay,
    user:{ username:user.username, displayName:user.displayName, role:user.role },
    appVersion: APP_VERSION });
});

app.post("/auth/login", (req, res) => {
  rotateDayIfNeeded();
  const username = String(req.body?.username||"").toLowerCase().trim();
  const password = String(req.body?.password||"");
  const user = db.users.find(u => u.username === username);
  if (!user || !verifyPassword(password, user.pw))
    return res.status(401).json({ success:false, message:"Falscher Login." });
  if (user.locked)
    return res.status(403).json({ success:false, message:"Zugang gesperrt, bitte bei der Geschäftsleitung melden.", locked:true });
  const token = crypto.randomBytes(32).toString("hex");
  const today = getDayKeyLocal(new Date());
  db.sessions[token] = { username: user.username, exp: Date.now() + 1000*60*60*24*30, lastActivity: Date.now() };
  user.lastSeen = new Date().toISOString();
  if (!user.firstLoginByDay) user.firstLoginByDay = {};
  if (!user.firstLoginByDay[today]) user.firstLoginByDay[today] = new Date().toISOString();
  saveDB(db);
  setCookie(res, "bs_token", token, { maxAge: 60*60*24*30 });
  res.json({ success:true, user:{ username:user.username, displayName:user.displayName, role:user.role },
    currentDay: db.meta.currentDay, appVersion: APP_VERSION });
});

app.post("/auth/logout", (req, res) => {
  const token = getToken(req);
  if (token && db.sessions[token]) { delete db.sessions[token]; saveDB(db); }
  clearCookie(res, "bs_token");
  res.json({ success:true });
});

app.post("/auth/change-password", requireAuth, (req, res) => {
  const old = String(req.body?.old||""), nw = String(req.body?.new||"");
  if (!old || !nw || nw.length < 3)
    return res.status(400).json({ success:false, message:"Ungültig." });
  if (!verifyPassword(old, req.user.pw))
    return res.status(403).json({ success:false, message:"Altes Passwort falsch." });
  req.user.pw = hashPassword(nw);
  saveDB(db);
  res.json({ success:true });
});

// ── Produkte ──────────────────────────────────────────────────────────────────
app.get("/products", requireAuth, (req, res) => {
  const weeklyName = getCurrentSpecialBurgerName();
  const products = getProducts(db).map(p =>
    p.id === "special_burger" ? { ...p, name: weeklyName, weeklyName } : p
  );
  res.json({ success:true, products, hiddenProducts: db.hiddenProducts||[] });
});

app.put("/products", requireAuth, requireBoss, (req, res) => {
  const incoming = req.body?.products;
  if (!Array.isArray(incoming)) return res.status(400).json({ success:false, message:"Ungültig." });
  // Store only price/icon overrides
  const overrides = [];
  for (const p of incoming) {
    const def = DEFAULT_PRODUCTS.find(d => d.id === p.id);
    if (!def) continue;
    const ov = { id: p.id };
    if (p.price !== def.price) ov.price = Number(p.price)||0;
    if (p.icon  !== def.icon)  ov.icon  = String(p.icon||"");
    overrides.push(ov);
  }
  db.products = overrides;
  db.hiddenProducts = Array.isArray(req.body?.hiddenProducts) ? req.body.hiddenProducts : db.hiddenProducts;
  saveDB(db);
  res.json({ success:true });
});

app.get("/special-burger-name", requireAuth, (req, res) =>
  res.json({ success:true, name: getCurrentSpecialBurgerName() }));

// ── Inventory ─────────────────────────────────────────────────────────────────
app.get("/inventory", requireAuth, (req, res) =>
  res.json({ success:true, items: db.inventory }));

// Add/update inventory item (lmk or cooked_*)
app.post("/inventory", requireAuth, requireBoss, (req, res) => {
  const { id, name, unit, minStock, ekPrice } = req.body||{};
  if (!id || !name) return res.status(400).json({ success:false, message:"ID und Name fehlen." });
  if (id !== "lmk" && !String(id).startsWith("cooked_"))
    return res.status(400).json({ success:false, message:"Ungültige ID — nur lmk oder cooked_* erlaubt." });
  const existing = db.inventory.find(x => x.id === id);
  const now = new Date().toISOString();
  if (existing) {
    existing.name      = String(name).trim();
    existing.unit      = String(unit||"Stk").trim();
    existing.minStock  = Math.max(0, Number(minStock)||0);
    existing.ekPrice   = Math.max(0, Number(ekPrice)||0);
    existing.updatedAt = now;
  } else {
    db.inventory.push({ id, name:String(name).trim(), unit:String(unit||"Stk").trim(),
      stock:0, minStock:Math.max(0,Number(minStock)||0), ekPrice:Math.max(0,Number(ekPrice)||0),
      createdAt:now, updatedAt:now });
  }
  saveDB(db);
  res.json({ success:true, items: db.inventory });
});

// Delta-based stock adjustment
app.post("/inventory/adjust", requireAuth, requireBoss, (req, res) => {
  const id    = String(req.body?.id||"").trim();
  const delta = Number(req.body?.delta);
  if (!id || !Number.isFinite(delta) || delta === 0)
    return res.status(400).json({ success:false, message:"Ungültig." });
  const it = db.inventory.find(x => x.id === id);
  if (!it) return res.status(404).json({ success:false, message:"Artikel nicht gefunden." });
  it.stock = Math.max(0, Math.round((Number(it.stock)||0)*100 + delta*100) / 100);
  it.updatedAt = new Date().toISOString();
  saveDB(db);
  res.json({ success:true, item: it, items: db.inventory });
});

app.delete("/inventory/:id", requireAuth, requireBoss, (req, res) => {
  const id = String(req.params.id||"");
  if (id === "lmk") return res.status(400).json({ success:false, message:"lmk kann nicht gelöscht werden." });
  db.inventory = db.inventory.filter(x => x.id !== id);
  saveDB(db);
  res.json({ success:true, items: db.inventory });
});

// ── Kochen ────────────────────────────────────────────────────────────────────
app.post("/cook", requireAuth, (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || !items.length)
    return res.status(400).json({ success:false, message:"Keine Items." });

  let totalKartons = 0;
  const breakdown = [];
  for (const item of items) {
    const qty = Number(item.qty)||0;
    if (qty <= 0) continue;
    const perKarton = CRATE_CONFIG[item.name];
    if (!perKarton) continue;
    totalKartons += qty / perKarton;
    breakdown.push({ name: item.name, qty, kartons: Math.round(qty/perKarton*100)/100 });
  }
  totalKartons = Math.ceil(totalKartons * 100) / 100;

  const lmk = db.inventory.find(x => x.id === "lmk");
  if (!lmk) return res.status(404).json({ success:false, message:"Lebensmittelkarton nicht im Lager." });
  if (lmk.stock < totalKartons)
    return res.status(400).json({ success:false,
      message:`Nicht genug Kartons. Benötigt: ${totalKartons}, Vorhanden: ${lmk.stock}` });

  lmk.stock = Math.round((lmk.stock - totalKartons) * 100) / 100;
  lmk.updatedAt = new Date().toISOString();

  const now = new Date().toISOString();
  for (const item of breakdown) {
    const invId = "cooked_" + item.name.toLowerCase().replace(/[^a-z0-9]/g,"_");
    let inv = db.inventory.find(x => x.id === invId);
    if (!inv) {
      inv = { id:invId, name:item.name, unit:"Stk", stock:0, minStock:0, ekPrice:0, createdAt:now, updatedAt:now };
      db.inventory.push(inv);
    }
    inv.stock = Math.round((Number(inv.stock)||0)*100 + item.qty*100) / 100;
    inv.updatedAt = now;
  }
  saveDB(db);
  res.json({ success:true, kartonsUsed: totalKartons, remaining: lmk.stock, breakdown });
});

// ── Einkauf (Lebensmittelkartons) ─────────────────────────────────────────────
app.get("/purchases", requireAuth, (req, res) => res.json({ success:true, purchases: db.purchases||[] }));

app.post("/purchases", requireAuth, requireBossOrManager, (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items)||!items.length)
    return res.status(400).json({ success:false, message:"Keine Items." });
  const now = new Date().toISOString();
  const date = String(req.body?.date||"").slice(0,10) || getDayKeyLocal(new Date());
  for (const item of items) {
    const qty = Number(item.qty)||0;
    if (qty <= 0) continue;
    const price = Number(item.price)||0;
    const lmk = db.inventory.find(x => x.id === "lmk");
    if (lmk) {
      lmk.stock = Math.round((Number(lmk.stock)||0)*100 + qty*100)/100;
      lmk.updatedAt = now;
    }
    if (price > 0) adjustBank(-(qty * price), `Einkauf: ${qty} Karton(s)`);
    db.purchases.push({ id: crypto.randomBytes(8).toString("hex"),
      inventoryId:"lmk", name:"Lebensmittelkarton", qty, price, date, createdAt:now,
      employee: req.user.displayName||req.user.username });
  }
  saveDB(db);
  res.json({ success:true, items: db.inventory, purchases: db.purchases });
});

app.put("/purchases/:id", requireAuth, requireBoss, (req, res) => {
  const p = (db.purchases||[]).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ success:false, message:"Nicht gefunden." });
  const oldCost = Number(p.price||0) * Number(p.qty||0);
  p.price = Math.max(0, Number(req.body?.price)||0);
  const newCost = p.price * Number(p.qty||0);
  if (newCost !== oldCost) adjustBank(oldCost - newCost, "Einkauf korrigiert");
  saveDB(db);
  res.json({ success:true });
});

app.delete("/purchases/:id", requireAuth, requireBoss, (req, res) => {
  const p = (db.purchases||[]).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ success:false, message:"Nicht gefunden." });
  // Reverse stock
  const lmk = db.inventory.find(x => x.id === "lmk");
  if (lmk) lmk.stock = Math.max(0, Math.round((Number(lmk.stock)||0)*100 - Number(p.qty||0)*100)/100);
  // Reverse bank
  if (Number(p.price||0) > 0) adjustBank(Number(p.qty||0)*Number(p.price||0), `Einkauf storniert`);
  db.purchases = db.purchases.filter(x => x.id !== req.params.id);
  saveDB(db);
  res.json({ success:true });
});

app.put("/reports/purchases-override", requireAuth, requireBoss, (req, res) => {
  const { date, value } = req.body||{};
  if (!date || !Number.isFinite(Number(value)))
    return res.status(400).json({ success:false, message:"Ungültig." });
  db.purchaseOverrides = db.purchaseOverrides||{};
  db.purchaseOverrides[String(date).slice(0,10)] = Number(value);
  saveDB(db);
  res.json({ success:true });
});

// ── Verkauf ───────────────────────────────────────────────────────────────────
app.post("/sale", requireAuth, (req, res) => {
  rotateDayIfNeeded();
  const { register, items, total, paidAmount, discount, isCash, isDelivery,
    tip=0, staffOrder=false, staffEmployee="", bahamaMamas=false,
    littleSeoul=false, paymentMethod="card" } = req.body||{};

  if (!Array.isArray(items)||!items.length)
    return res.status(400).json({ success:false, message:"Keine Artikel." });
  if (!Number.isFinite(Number(total)))
    return res.status(400).json({ success:false, message:"Total fehlt." });

  const day = db.meta.currentDay;
  if (!db.salesByDay[day]) db.salesByDay[day] = [];
  if (!db.kitchenByDay[day]) db.kitchenByDay[day] = { pending:[], done:[] };

  const orderId = db.meta.nextOrderId++;
  const time    = new Date().toISOString();

  // Inventory deduction from cooked_* by product name
  const deductCooked = (name, qty) => {
    if (!name) return;
    const invId = "cooked_" + name.toLowerCase().replace(/[^a-z0-9]/g,"_");
    const inv = db.inventory.find(x => x.id === invId);
    if (inv && Number(inv.stock) > 0) {
      inv.stock = Math.max(0, Math.round((Number(inv.stock)||0)*100 - qty*100)/100);
      inv.updatedAt = time;
    }
  };
  const allProds = getProducts(db);
  for (const item of items) {
    const itemQty = Number(item.qty)||1;
    if (Array.isArray(item.components) && item.components.length) {
      for (const c of item.components) {
        const prod = allProds.find(p => p.id === c.productId);
        deductCooked(prod?.name||c.productId, (Number(c.qty)||1)*itemQty);
      }
    } else {
      const name = String(item.name||"").replace(/ \(kein Side\)$/,"").trim();
      deductCooked(name, itemQty);
    }
  }

  // Bank
  if (!isCash && paymentMethod !== "guthaben") {
    adjustBank(Number(total)||0, `Verkauf #${orderId}`);
    if (Number(tip||0) > 0) adjustBank(Number(tip), `Trinkgeld #${orderId}`);
  }

  const sale = { id:orderId, day, time, timeHM:toHM(time),
    employee:req.user.displayName||req.user.username, employeeUsername:req.user.username,
    register:Number(register)||1, items, total:Number(total)||0,
    paidAmount:Number(paidAmount)||0, tip:Number(tip)||0,
    discount:discount||null, isCash:!!isCash, isDelivery:!!isDelivery,
    staffOrder:!!staffOrder, staffEmployee:staffEmployee||"",
    bahamaMamas:!!bahamaMamas, littleSeoul:!!littleSeoul, paymentMethod };
  db.salesByDay[day].push(sale);

  // Kitchen
  if (!staffOrder) {
    db.kitchenByDay[day].pending.push({ id:orderId, time, register:sale.register,
      employee:sale.employee, items });
  }

  saveDB(db);
  res.json({ success:true, orderId });
});

app.put("/sale/:id", requireAuth, requireBoss, (req, res) => {
  const id = Number(req.params.id);
  let found = null;
  for (const sales of Object.values(db.salesByDay||{})) {
    found = sales.find(x => Number(x.id)===id);
    if (found) break;
  }
  if (!found) return res.status(404).json({ success:false, message:"Nicht gefunden." });
  if (req.body?.tip !== undefined) {
    const diff = (Number(req.body.tip)||0) - (Number(found.tip)||0);
    found.tip = Math.max(0, Number(req.body.tip)||0);
    if (diff !== 0 && !found.isCash) adjustBank(diff, `Trinkgeld korrigiert #${id}`);
  }
  saveDB(db);
  res.json({ success:true, sale:found });
});

app.delete("/sale/:id", requireAuth, requireBoss, (req, res) => {
  const id = Number(req.params.id);
  let removed = null;
  for (const [, sales] of Object.entries(db.salesByDay||{})) {
    const idx = sales.findIndex(x => Number(x.id)===id);
    if (idx !== -1) { [removed] = sales.splice(idx,1); break; }
  }
  if (!removed) return res.status(404).json({ success:false, message:"Nicht gefunden." });

  // Restore bank
  if (!removed.isCash && removed.paymentMethod !== "guthaben")
    adjustBank(-(Number(removed.total||0)+Number(removed.tip||0)), `Storno #${id}`);

  // Restore inventory
  const allProds = getProducts(db);
  const restoreCooked = (name, qty) => {
    if (!name) return;
    const invId = "cooked_" + name.toLowerCase().replace(/[^a-z0-9]/g,"_");
    const inv = db.inventory.find(x => x.id === invId);
    if (inv) inv.stock = Math.round((Number(inv.stock)||0)*100 + qty*100)/100;
  };
  for (const item of (removed.items||[])) {
    const itemQty = Number(item.qty)||1;
    if (Array.isArray(item.components) && item.components.length) {
      for (const c of item.components) {
        const prod = allProds.find(p => p.id === c.productId);
        restoreCooked(prod?.name||c.productId, (Number(c.qty)||1)*itemQty);
      }
    } else {
      restoreCooked(String(item.name||"").replace(/ \(kein Side\)$/,"").trim(), itemQty);
    }
  }
  saveDB(db);
  res.json({ success:true });
});

// ── Küche ─────────────────────────────────────────────────────────────────────
app.get("/kitchen/orders", requireAuth, (req, res) => {
  rotateDayIfNeeded();
  const day = db.meta.currentDay;
  res.json({ success:true, currentDay:day,
    pending:(db.kitchenByDay[day]?.pending||[]),
    done:(db.kitchenByDay[day]?.done||[]) });
});
app.post("/kitchen/done", requireAuth, (req, res) => {
  const { orderId } = req.body||{};
  const day = db.meta.currentDay;
  const kitchen = db.kitchenByDay[day];
  if (!kitchen) return res.status(404).json({ success:false });
  const idx = kitchen.pending.findIndex(o => Number(o.id)===Number(orderId));
  if (idx !== -1) kitchen.done.push(...kitchen.pending.splice(idx,1));
  saveDB(db); res.json({ success:true });
});
app.post("/kitchen/reset", requireAuth, requireBoss, (req, res) => {
  const day = db.meta.currentDay;
  db.kitchenByDay[day] = { pending:[], done:[] };
  saveDB(db); res.json({ success:true });
});

// ── Reports ───────────────────────────────────────────────────────────────────
app.get("/reports/day-details", requireAuth, requireBossOrManager, (req, res) => {
  rotateDayIfNeeded();
  const dateStr = String(req.query?.date||db.meta.currentDay);
  const date = parseDateYYYYMMDD(dateStr);
  if (!date) return res.status(400).json({ success:false, message:"Ungültiges Datum." });
  const key = getDayKeyLocal(date);
  const sales = db.salesByDay[key]||[];
  const dayKeys = [key];
  const totals = {
    revenue:  sales.reduce((s,x)=>s+Number(x.total||0),0),
    tips:     sales.reduce((s,x)=>s+Number(x.tip||0),0),
    cash:     sales.filter(x=>x.isCash).reduce((s,x)=>s+Number(x.total||0),0),
    orders:   sales.length,
    purchases: getPurchaseCosts(dayKeys),
    expenses:  getExpensesCosts(dayKeys),
  };
  totals.profit = totals.revenue - totals.purchases - totals.expenses;
  totals.avg = totals.orders > 0 ? totals.revenue / totals.orders : 0;
  const byEmployee = {};
  for (const s of sales) {
    const k = s.employeeUsername||s.employee||"—";
    if (!byEmployee[k]) byEmployee[k] = { username:k, employee:s.employee||k, revenue:0, tips:0, orders:0 };
    byEmployee[k].revenue += Number(s.total||0);
    byEmployee[k].tips    += Number(s.tip||0);
    byEmployee[k].orders++;
  }
  res.json({ success:true, date:dateStr, key, sales, totals,
    byEmployee: Object.values(byEmployee).sort((a,b)=>b.revenue-a.revenue),
    closed: !!db.closedDays?.[key] });
});

app.get("/reports/week-employee", requireAuth, (req, res) => {
  rotateDayIfNeeded();
  const parsed = parseWeekYYYY_Www(req.query?.week);
  if (!parsed) return res.status(400).json({ success:false, message:"Ungültige KW." });
  const start = isoWeekStartDate(parsed.year, parsed.week);
  const dayKeys = [], salesAll = [];
  for (let i=0;i<7;i++) {
    const d = addDays(start,i), k = getDayKeyLocal(d);
    dayKeys.push(k);
    salesAll.push(...(db.salesByDay[k]||[]));
  }
  const totals = {
    revenue:  salesAll.reduce((s,x)=>s+Number(x.total||0),0),
    tips:     salesAll.reduce((s,x)=>s+Number(x.tip||0),0),
    orders:   salesAll.length,
    purchases: getPurchaseCosts(dayKeys),
    expenses:  getExpensesCosts(dayKeys),
  };
  totals.avg    = totals.orders>0 ? totals.revenue/totals.orders : 0;
  totals.profit = totals.revenue - totals.purchases - totals.expenses;

  const byEmployeeMap = {};
  for (const s of salesAll) {
    const k = s.employeeUsername||s.employee||"—";
    if (!byEmployeeMap[k]) byEmployeeMap[k] = { employeeUsername:k, employee:s.employee||k, revenue:0, tips:0, orders:0, cashRevenue:0 };
    byEmployeeMap[k].revenue += Number(s.total||0);
    byEmployeeMap[k].tips    += Number(s.tip||0);
    byEmployeeMap[k].orders++;
    if (s.isCash) byEmployeeMap[k].cashRevenue += Number(s.total||0);
  }
  const byEmployee = Object.values(byEmployeeMap)
    .map(x=>({...x, avg:x.orders>0?x.revenue/x.orders:0}))
    .sort((a,b)=>b.revenue-a.revenue);

  // Products sold — expand menu components
  const allProds = getProducts(db);
  const byProductMap = {};
  const addProd = (name, qty, rev) => {
    const k = String(name||"").trim(); if (!k) return;
    if (!byProductMap[k]) byProductMap[k] = { name:k, qty:0, revenue:0 };
    byProductMap[k].qty += qty; byProductMap[k].revenue += rev;
  };
  for (const s of salesAll) {
    for (const item of (s.items||[])) {
      const itemQty = Number(item.qty)||1;
      if (Array.isArray(item.components) && item.components.length) {
        const totalCP = item.components.reduce((sum,c)=>{
          const p = allProds.find(x=>x.id===c.productId);
          return sum + (p?.price||0)*(c.qty||1);
        },0);
        for (const c of item.components) {
          const p = allProds.find(x=>x.id===c.productId);
          const cName = p?.name||c.productId, cQty=(c.qty||1)*itemQty;
          const cRev = totalCP>0 ? (item.price||0)*itemQty*(p?.price||0)*(c.qty||1)/totalCP : 0;
          addProd(cName, cQty, cRev);
        }
      } else {
        const name = String(item.name||"").replace(/ \(kein Side\)$/,"").trim();
        if (name.includes("Liefergebühr")) continue;
        addProd(name, itemQty, (item.price||0)*itemQty);
      }
    }
  }
  const byProduct = Object.values(byProductMap)
    .map(p=>({...p, perCrate:CRATE_CONFIG[p.name]||null, crates:CRATE_CONFIG[p.name]?Math.ceil(p.qty/CRATE_CONFIG[p.name]):null}))
    .sort((a,b)=>b.qty-a.qty);

  const weeksSet = new Set();
  for (const k of dayKeys) {
    const d = parseDateYYYYMMDD(k);
    if (d) weeksSet.add(`${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2,"0")}`);
  }
  res.json({ success:true,
    week:`${parsed.year}-W${String(parsed.week).padStart(2,"0")}`,
    range:{ start:dayKeys[0], end:dayKeys[6] },
    totals, byEmployee, byProduct, weeks:Array.from(weeksSet) });
});

app.get("/reports/month-employee", requireAuth, requireBoss, (req, res) => {
  rotateDayIfNeeded();
  const parsed = parseMonthYYYY_MM(req.query?.month);
  if (!parsed) return res.status(400).json({ success:false, message:"Ungültiger Monat." });
  const start = new Date(parsed.year, parsed.month-1, 1); start.setHours(0,0,0,0);
  const end   = new Date(parsed.year, parsed.month, 0);   end.setHours(0,0,0,0);
  const salesAll = [], dayKeys = [];
  for (let d=new Date(start); d<=end; d=addDays(d,1)) {
    const k = getDayKeyLocal(d); dayKeys.push(k);
    salesAll.push(...(db.salesByDay[k]||[]));
  }
  const totals = {
    revenue:  salesAll.reduce((s,x)=>s+Number(x.total||0),0),
    tips:     salesAll.reduce((s,x)=>s+Number(x.tip||0),0),
    orders:   salesAll.length,
    purchases: getPurchaseCosts(dayKeys),
    expenses:  getExpensesCosts(dayKeys),
  };
  totals.avg = totals.orders>0 ? totals.revenue/totals.orders : 0;
  totals.profit = totals.revenue - totals.purchases - totals.expenses;
  const byEmployeeMap = {};
  for (const s of salesAll) {
    const k = s.employeeUsername||s.employee||"—";
    if (!byEmployeeMap[k]) byEmployeeMap[k] = { employeeUsername:k, employee:s.employee||k, revenue:0, tips:0, orders:0 };
    byEmployeeMap[k].revenue += Number(s.total||0);
    byEmployeeMap[k].tips    += Number(s.tip||0);
    byEmployeeMap[k].orders++;
  }
  const byEmployee = Object.values(byEmployeeMap)
    .map(x=>({...x,avg:x.orders>0?x.revenue/x.orders:0})).sort((a,b)=>b.revenue-a.revenue);
  const weeksSet = new Set();
  for (const k of dayKeys) {
    const d = parseDateYYYYMMDD(k);
    if (d) weeksSet.add(`${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2,"0")}`);
  }
  res.json({ success:true, month:req.query.month, totals, byEmployee, weeks:Array.from(weeksSet) });
});

app.get("/reports/staff-consumption", requireAuth, requireBoss, (req, res) => {
  rotateDayIfNeeded();
  const dateStr = String(req.query?.date||db.meta.currentDay);
  const date = parseDateYYYYMMDD(dateStr);
  if (!date) return res.status(400).json({ success:false });
  const key = getDayKeyLocal(date);
  const staffSales = (db.salesByDay[key]||[]).filter(s=>s.staffOrder);
  res.json({ success:true, date:dateStr, sales:staffSales });
});

app.post("/reports/close-day", requireAuth, requireBoss, (req, res) => {
  rotateDayIfNeeded();
  const dateStr = String(req.body?.date||db.meta.currentDay);
  const date = parseDateYYYYMMDD(dateStr);
  if (!date) return res.status(400).json({ success:false, message:"Ungültiges Datum." });
  const key = getDayKeyLocal(date);
  if (db.closedDays?.[key]) return res.status(409).json({ success:false, message:"Bereits abgeschlossen." });
  if (!db.closedDays) db.closedDays = {};
  db.closedDays[key] = { closedAt: new Date().toISOString(), cashCount:req.body?.cashCount, note:req.body?.note||"" };
  // Invalidate non-boss sessions
  for (const [tok, sess] of Object.entries(db.sessions||{})) {
    if (tok === req.token) continue;
    const u = db.users.find(x => x.username === sess.username);
    if (!u || u.role !== "boss") delete db.sessions[tok];
  }
  // Cash booking
  if (req.body?.cashCount !== undefined) {
    const daySales = db.salesByDay[key]||[];
    const cashTotal = daySales.filter(s=>s.isCash).reduce((s,x)=>s+Number(x.total||0)+Number(x.tip||0),0);
    adjustBank(cashTotal, `Tagesabschluss Bar ${key}`);
  }
  saveDB(db);
  res.json({ success:true, key });
});

// ── Bank ──────────────────────────────────────────────────────────────────────
app.get("/bank-balance", requireAuth, requireBossOrManager, (req, res) =>
  res.json({ success:true, balance: db.bankBalance||0, updatedAt: db.bankBalanceUpdatedAt||null }));

app.get("/bank-balance/history", requireAuth, requireBoss, (req, res) =>
  res.json({ success:true, log: (db.bankLog||[]).slice(0,200) }));

app.put("/bank-balance", requireAuth, requireBoss, (req, res) => {
  const val = Number(req.body?.balance);
  if (!Number.isFinite(val)) return res.status(400).json({ success:false });
  const diff = val - (db.bankBalance||0);
  adjustBank(diff, "Manuelle Korrektur");
  saveDB(db);
  res.json({ success:true, balance: db.bankBalance });
});

app.post("/cash-transferred", requireAuth, requireBoss, (req, res) => {
  const amount = Number(req.body?.amount)||0;
  adjustBank(-amount, "Bar übertragen");
  saveDB(db);
  res.json({ success:true, balance: db.bankBalance });
});

// ── Ausgaben ──────────────────────────────────────────────────────────────────
app.get("/expenses", requireAuth, (req, res) =>
  res.json({ success:true, expenses: db.expenses||[] }));

app.post("/expenses", requireAuth, requireBossOrManager, (req, res) => {
  const { category, amount, note, date } = req.body||{};
  const amt = Number(amount)||0;
  if (!category || amt <= 0) return res.status(400).json({ success:false, message:"Ungültig." });
  const entry = { id: crypto.randomBytes(8).toString("hex"),
    category: String(category), amount:amt, note:String(note||""),
    date: String(date||"").slice(0,10)||getDayKeyLocal(new Date()),
    createdAt:new Date().toISOString(), employee:req.user.displayName||req.user.username };
  db.expenses.push(entry);
  adjustBank(-amt, `Ausgabe: ${category}`);
  saveDB(db);
  res.json({ success:true, expense:entry });
});

app.delete("/expenses/:id", requireAuth, requireBossOrManager, (req, res) => {
  const entry = (db.expenses||[]).find(e=>e.id===req.params.id);
  if (!entry) return res.status(404).json({ success:false, message:"Nicht gefunden." });
  adjustBank(Number(entry.amount||0), `Ausgabe storniert: ${entry.category}`);
  db.expenses = db.expenses.filter(e=>e.id!==req.params.id);
  saveDB(db);
  res.json({ success:true });
});

// ── Mitarbeiter ───────────────────────────────────────────────────────────────
app.get("/users", requireAuth, requireBossOrManager, (req, res) => {
  const today = getDayKeyLocal(new Date());
  res.json({ success:true, users: db.users.map(u=>({
    username:u.username, displayName:u.displayName, role:u.role,
    lastSeen:u.lastSeen||null, locked:u.locked||false,
    firstLoginToday:(u.firstLoginByDay&&u.firstLoginByDay[today])||null
  }))});
});

app.post("/users", requireAuth, requireBoss, (req, res) => {
  const { username, displayName, role, password } = req.body||{};
  if (!username||!displayName||!password||password.length<3)
    return res.status(400).json({ success:false, message:"Fehlende Felder." });
  const un = String(username).toLowerCase().trim();
  if (db.users.find(u=>u.username===un))
    return res.status(409).json({ success:false, message:"Username belegt." });
  db.users.push({ username:un, displayName:String(displayName).trim(),
    role:["boss","manager","staff"].includes(role)?role:"staff",
    pw:hashPassword(password) });
  saveDB(db);
  res.json({ success:true });
});

app.put("/users/:username", requireAuth, requireBoss, (req, res) => {
  const u = db.users.find(u=>u.username===req.params.username);
  if (!u) return res.status(404).json({ success:false, message:"User nicht gefunden." });
  if (req.body?.displayName) u.displayName = String(req.body.displayName).trim();
  if (req.body?.role && u.role!=="boss") u.role = ["manager","staff"].includes(req.body.role)?req.body.role:"staff";
  if (req.body?.password) {
    u.pw = hashPassword(String(req.body.password));
    // Invalidate sessions
    for (const [tok,sess] of Object.entries(db.sessions||{}))
      if (sess.username===u.username) delete db.sessions[tok];
  }
  saveDB(db);
  res.json({ success:true });
});

app.post("/users/:username/lock", requireAuth, requireBoss, (req, res) => {
  const u = db.users.find(u=>u.username===req.params.username);
  if (!u) return res.status(404).json({ success:false });
  if (u.role==="boss") return res.status(400).json({ success:false, message:"Chef kann nicht gesperrt werden." });
  u.locked = !u.locked;
  if (u.locked) for (const [tok,sess] of Object.entries(db.sessions||{}))
    if (sess.username===u.username) delete db.sessions[tok];
  saveDB(db);
  res.json({ success:true, locked:u.locked });
});

app.delete("/users/:username", requireAuth, requireBoss, (req, res) => {
  const un = req.params.username;
  const u = db.users.find(u=>u.username===un);
  if (!u) return res.status(404).json({ success:false });
  if (u.role==="boss") return res.status(400).json({ success:false, message:"Chef kann nicht gelöscht werden." });
  db.users = db.users.filter(u=>u.username!==un);
  for (const [tok,sess] of Object.entries(db.sessions||{}))
    if (sess.username===un) delete db.sessions[tok];
  saveDB(db);
  res.json({ success:true });
});

// ── Schwarzes Brett ───────────────────────────────────────────────────────────
app.get("/board", requireAuth, (req, res) => res.json({ success:true, board:db.board||[] }));

app.post("/board", requireAuth, requireBossOrManager, (req, res) => {
  const { text, category } = req.body||{};
  if (!text) return res.status(400).json({ success:false });
  const entry = { id:crypto.randomBytes(8).toString("hex"), text:String(text).trim(),
    category:String(category||"info"), author:req.user.displayName||req.user.username,
    createdAt:new Date().toISOString(), readBy:[] };
  db.board = db.board||[];
  db.board.unshift(entry);
  if (db.board.length > 50) db.board.length = 50;
  saveDB(db);
  res.json({ success:true, entry });
});

app.post("/board/mark-read", requireAuth, (req, res) => {
  const { id } = req.body||{};
  const entry = (db.board||[]).find(e=>e.id===id);
  if (entry && !entry.readBy.includes(req.user.username)) entry.readBy.push(req.user.username);
  saveDB(db);
  res.json({ success:true });
});

app.delete("/board/:id", requireAuth, requireBossOrManager, (req, res) => {
  db.board = (db.board||[]).filter(e=>e.id!==req.params.id);
  saveDB(db);
  res.json({ success:true });
});

// ── Zutaten ───────────────────────────────────────────────────────────────────
app.get("/zutaten", requireAuth, (req, res) => res.json({ success:true, zutaten:db.zutaten||[] }));

app.post("/zutaten", requireAuth, requireBossOrManager, (req, res) => {
  const { name, zutaten } = req.body||{};
  if (!name) return res.status(400).json({ success:false });
  const existing = (db.zutaten||[]).find(z=>z.name.toLowerCase()===String(name).toLowerCase().trim());
  if (existing) { existing.zutaten=String(zutaten||""); saveDB(db); return res.json({ success:true }); }
  db.zutaten = db.zutaten||[];
  db.zutaten.push({ id:crypto.randomBytes(6).toString("hex"), name:String(name).trim(), zutaten:String(zutaten||"") });
  saveDB(db);
  res.json({ success:true });
});

app.put("/zutaten/:id", requireAuth, requireBossOrManager, (req, res) => {
  const z = (db.zutaten||[]).find(x=>x.id===req.params.id);
  if (!z) return res.status(404).json({ success:false });
  if (req.body?.name)    z.name    = String(req.body.name).trim();
  if (req.body?.zutaten !== undefined) z.zutaten = String(req.body.zutaten);
  saveDB(db); res.json({ success:true });
});

app.delete("/zutaten/:id", requireAuth, requireBossOrManager, (req, res) => {
  db.zutaten = (db.zutaten||[]).filter(z=>z.id!==req.params.id);
  saveDB(db); res.json({ success:true });
});

// ── Gutscheine ────────────────────────────────────────────────────────────────
app.get("/guthaben-karten", requireAuth, requireBossOrManager, (req, res) =>
  res.json({ success:true, cards: Object.values(db.giftCards||{}) }));

app.get("/guthaben-karten/check", requireAuth, (req, res) => {
  const code = String(req.query?.code||"").trim().toUpperCase();
  const card = db.giftCards?.[code];
  if (!card||!card.active) return res.json({ success:false, message:"Karte nicht gefunden." });
  res.json({ success:true, card });
});

app.post("/guthaben-karten", requireAuth, requireBoss, (req, res) => {
  const { code, amount } = req.body||{};
  const c = String(code||"").trim().toUpperCase();
  const a = Number(amount)||0;
  if (!c||a<=0) return res.status(400).json({ success:false });
  db.giftCards = db.giftCards||{};
  db.giftCards[c] = { code:c, amount:a, remaining:a, active:true, createdAt:new Date().toISOString() };
  saveDB(db); res.json({ success:true });
});

app.post("/guthaben-karten/pay", requireAuth, (req, res) => {
  const { code, amount } = req.body||{};
  const c = String(code||"").trim().toUpperCase();
  const a = Number(amount)||0;
  const card = db.giftCards?.[c];
  if (!card||!card.active) return res.status(404).json({ success:false, message:"Karte nicht gefunden." });
  if (card.remaining < a) return res.status(400).json({ success:false, message:"Nicht genug Guthaben." });
  card.remaining = Math.round((card.remaining-a)*100)/100;
  if (card.remaining <= 0) card.active = false;
  saveDB(db); res.json({ success:true, remaining:card.remaining });
});

// ── Presence & Carts (SSE) ───────────────────────────────────────────────────
app.get("/events/presence", requireAuth, (req, res) => {
  res.setHeader("Content-Type","text/event-stream");
  res.setHeader("Cache-Control","no-cache"); res.setHeader("Connection","keep-alive");
  res.flushHeaders(); presenceClients.add(res);
  try { res.write(`data: ${JSON.stringify({ presence:presenceState, online:onlineUsers, ts:Date.now() })}\n\n`); } catch(e){}
  req.on("close", ()=>presenceClients.delete(res));
});

app.get("/events/carts", requireAuth, (req, res) => {
  res.setHeader("Content-Type","text/event-stream");
  res.setHeader("Cache-Control","no-cache"); res.setHeader("Connection","keep-alive");
  res.flushHeaders(); cartsClients.add(res);
  try { res.write(`data: ${JSON.stringify({ rev:cartsRev, carts:cartsState })}\n\n`); } catch(e){}
  req.on("close", ()=>cartsClients.delete(res));
});

app.get("/carts", requireAuth, (req, res) =>
  res.json({ success:true, rev:cartsRev, carts:cartsState }));

app.put("/carts", requireAuth, (req, res) => {
  const { carts, rev } = req.body||{};
  if (rev !== undefined && Number(rev) < cartsRev)
    return res.json({ success:false, stale:true, rev:cartsRev, carts:cartsState });
  cartsState = normalizeCarts(carts||{});
  broadcastCarts();
  res.json({ success:true, rev:cartsRev });
});

app.post("/presence", (req, res) => {
  const register = String(req.body?.register||"");
  const username = String(req.body?.username||"").trim();
  const name     = String(req.body?.name||username).trim();
  if (!["1","2","3","4","5","6"].includes(register)||!username)
    return res.status(400).json({ success:false });
  for (const k of ["1","2","3","4","5","6"])
    if (presenceState[k]?.users?.[username]) delete presenceState[k].users[username];
  if (!presenceState[register]) presenceState[register] = { users:{} };
  presenceState[register].users[username] = { name, at:Date.now() };
  broadcastPresence();
  res.json({ success:true });
});

app.post("/presence/heartbeat", requireAuth, (req, res) => {
  const now = Date.now();
  onlineUsers[req.user.username] = { name:req.user.displayName||req.user.username, at:now };
  const u = db.users.find(x=>x.username===req.user.username);
  if (u) { u.lastSeen = new Date(now).toISOString(); scheduleLastSeenSave(); }
  broadcastPresence();
  res.json({ success:true });
});

app.post("/presence/leave", (req, res) => {
  const username = String(req.body?.username||"").trim();
  for (const k of ["1","2","3","4","5","6"])
    if (presenceState[k]?.users?.[username]) delete presenceState[k].users[username];
  delete onlineUsers[username];
  broadcastPresence();
  res.json({ success:true });
});

app.post("/presence/force-clear", requireAuth, requireBoss, (req, res) => {
  const register = String(req.body?.register||"");
  if (presenceState[register]) presenceState[register] = { users:{} };
  broadcastPresence();
  res.json({ success:true });
});

// ── Schichtplan ───────────────────────────────────────────────────────────────
app.get("/reports/employee-totals", requireAuth, requireBossOrManager, (req, res) => {
  const dateStr = String(req.query?.date||db.meta.currentDay).slice(0,10);
  const sales = db.salesByDay[dateStr]||[];
  const byEmp = {};
  for (const s of sales) {
    const k = s.employeeUsername||"—";
    if (!byEmp[k]) byEmp[k] = { revenue:0, orders:0 };
    byEmp[k].revenue += Number(s.total||0); byEmp[k].orders++;
  }
  res.json({ success:true, date:dateStr, byEmployee:byEmp });
});

// ── Reset ─────────────────────────────────────────────────────────────────────
app.post("/reset/today", requireAuth, requireBoss, (req, res) => {
  const day = db.meta.currentDay;
  db.salesByDay[day] = [];
  db.kitchenByDay[day] = { pending:[], done:[] };
  saveDB(db); res.json({ success:true });
});

// ── Static / Fallback ─────────────────────────────────────────────────────────
app.get("/", (req, res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BurgerShot Server läuft auf http://0.0.0.0:${PORT}`);
});
