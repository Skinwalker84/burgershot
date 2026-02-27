// server.js
// Burger Shot – Firmensoftware (GTA RP)
// Auth, POS Sales, Küche, Management, Reports (Tag/Woche), Tagesabschluss
// Persistenz via JSON + editierbare Produktpreise (VK)

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);

const DB_PATH = path.join(__dirname, "data", "db.json");

/* =========================
   HELPERS
   ========================= */
function safeReadJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("DB read error:", e);
    return null;
  }
}

function safeWriteJSON(filePath, obj) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8");
    return true;
  } catch (e) {
    console.error("DB write error:", e);
    return false;
  }
}

function getDayKeyLocal(dateObj) {
  const d = new Date(dateObj);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateYYYYMMDD(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt;
}

function addDays(dateObj, days) {
  const d = new Date(dateObj);
  d.setDate(d.getDate() + days);
  return d;
}

function isoWeekStartDate(weekYear, week) {
  const jan4 = new Date(weekYear, 0, 4);
  jan4.setHours(0, 0, 0, 0);
  const week1Start = new Date(jan4);
  week1Start.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7)); // Monday
  const start = new Date(week1Start);
  start.setDate(week1Start.getDate() + (week - 1) * 7);
  start.setHours(0, 0, 0, 0);
  return start;
}

function parseWeekYYYY_Www(s) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const y = Number(m[1]);
  const w = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(w) || w < 1 || w > 53) return null;
  return { year: y, week: w };
}

function startOfWeekMonday(dateObj) {
  const d = new Date(dateObj);
  const day = d.getDay(); // 0=Sun ... 1=Mon
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoWeekYearWeek(dateObj){
  // ISO-8601 week number + week-year
  const d = new Date(Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()));
  const dayNum = d.getUTCDay() || 7; // 1..7 (Mon..Sun)
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thu decides week-year
  const weekYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: weekYear, week };
}

function parseMonthYYYY_MM(s){
  const m = /^(\d{4})-(\d{2})$/.exec(String(s||""));
  if(!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if(!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  return { year: y, month: mo };
}

function toHM(iso) {
  try {
    const d = new Date(iso);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  } catch {
    return "";
  }
}

/* =========================
   AUTH / PASSWORD
   ========================= */
function hashPassword(pw, salt = null) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(String(pw), s, 120000, 32, "sha256").toString("hex");
  return { salt: s, hash };
}

function verifyPassword(pw, pwObj) {
  if (!pwObj || !pwObj.salt || !pwObj.hash) return false;
  const { hash } = hashPassword(pw, pwObj.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(pwObj.hash, "hex"));
}

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

/* =========================
   DEFAULT PRODUCTS (VK)
   ========================= */
const DEFAULT_PRODUCTS = [
  { id:"bleeder", name:"The Bleeder", price:14, cat:"Burger" },
  { id:"heartstopper", name:"The Heartstopper", price:16, cat:"Burger" },
  { id:"chicken", name:"The Chicken", price:12, cat:"Burger" },
  { id:"vegan_burger", name:"Vegan Burger", price:10, cat:"Burger" },
  { id:"chozzo", name:"The Chozzo", price:12, cat:"Burger" },
  { id:"german", name:"The German", price:16, cat:"Burger" },

  { id:"coleslaw", name:"Coleslaw", price:10, cat:"Beilagen" },
  { id:"fries", name:"Fries", price:6, cat:"Beilagen" },
  { id:"cheesy_fries", name:"Cheesy Fries", price:8, cat:"Beilagen" },
  { id:"chicken_nuggets", name:"Chicken Nuggets", price:10, cat:"Beilagen" },
  { id:"onion_rings", name:"Onion Rings", price:6, cat:"Beilagen" },

  { id:"ecola", name:"ECola", price:8, cat:"Getränke" },
  { id:"ecola_light", name:"ECola Light", price:8, cat:"Getränke" },
  { id:"sprunk", name:"Sprunk", price:8, cat:"Getränke" },
  { id:"sprunk_light", name:"Sprunk Light", price:8, cat:"Getränke" },
  { id:"blueberry_slush", name:"Blueberry Slush", price:10, cat:"Getränke" },
  { id:"strawberry_slush", name:"Strawberry Slush", price:10, cat:"Getränke" },
  { id:"choco_milchshake", name:"Choco Milchshake", price:10, cat:"Getränke" },
  { id:"vanille_milchshake", name:"Vanille Milchshake", price:10, cat:"Getränke" },
  { id:"strawberry_milchshake", name:"Strawberry Milchshake", price:10, cat:"Getränke" },

  { id:"glazed_donut", name:"Glazed Donut", price:8, cat:"Süßes" },
  { id:"sprinkle_donut", name:"Sprinke Donut", price:8, cat:"Süßes" },
  { id:"caramel_sundae", name:"Caramel Sundae", price:8, cat:"Süßes" },
  { id:"chocolate_sundae", name:"Chocolate Sundae", price:8, cat:"Süßes" },
  { id:"strawberry_sundae", name:"Strawberry Sundae", price:8, cat:"Süßes" },

  // Menüs (Burger + Fries + Drink) – kleiner Rabatt eingerechnet
  { id:"menu_bleeder", name:"Menü: The Bleeder", price:26, cat:"Menü" },
  { id:"menu_heartstopper", name:"Menü: The Heartstopper", price:28, cat:"Menü" },
  { id:"menu_chicken", name:"Menü: The Chicken", price:24, cat:"Menü" },
  { id:"menu_vegan", name:"Menü: Vegan Burger", price:22, cat:"Menü" },
  { id:"menu_chozzo", name:"Menü: The Chozzo", price:24, cat:"Menü" },
  { id:"menu_german", name:"Menü: The German", price:28, cat:"Menü" }
];

/* =========================
   DB
   ========================= */
function makeFreshDB() {
  const today = getDayKeyLocal(new Date());
  const { salt, hash } = hashPassword("admin");
  const bossUsername = "chris.adams";

  return {
    meta: { currentDay: today, nextOrderId: 1 },
    users: [
      { username: bossUsername, displayName: "Chris Adams", role: "boss", pw: { salt, hash } }
    ],
    sessions: {},

    products: DEFAULT_PRODUCTS,

    // Lagerbestand (Chef)
    inventory: [],

    // Einkäufe (Chef) – Bewegungslog / Historie
    purchases: [],

    salesByDay: { [today]: [] },
    kitchenByDay: { [today]: { pending: [], done: [] } },
    closedDays: {}
  };
}

function makeInvId(){
  return crypto.randomBytes(8).toString("hex");
}

function normalizeInventory(list){
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  const seen = new Set();
  for(const it of arr){
    if(!it || typeof it !== "object") continue;
    const id = String(it.id || "").trim() || makeInvId();
    if(seen.has(id)) continue;
    seen.add(id);
    const name = String(it.name || "").trim();
    if(!name) continue;
    const unit = String(it.unit || "Stk").trim() || "Stk";
    let stock = Number(it.stock);
    let minStock = Number(it.minStock);
    if(!Number.isFinite(stock)) stock = 0;
    if(!Number.isFinite(minStock)) minStock = 0;
    stock = Math.max(0, Math.round(stock * 100) / 100);
    minStock = Math.max(0, Math.round(minStock * 100) / 100);
    const updatedAt = String(it.updatedAt || new Date().toISOString());
    out.push({ id, name, unit, stock, minStock, updatedAt });
  }
  // sort stable
  out.sort((a,b)=>String(a.name).localeCompare(String(b.name), "de"));
  return out;
}

function normalizeProducts(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  const seen = new Set();

  for (const p of arr) {
    if (!p || typeof p !== "object") continue;
    const id = String(p.id || "").trim();
    const name = String(p.name || "").trim();
    const cat = String(p.cat || "").trim();
    const price = Number(p.price);
    if (!id || !name || !cat) continue;
    if (!Number.isFinite(price) || price < 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, cat, price: Math.round(price) });
  }

  // Ensure defaults always exist (prevents accidental deletion e.g. Menüs)
  const map = new Map(out.map(p => [p.id, p]));
  for (const dp of DEFAULT_PRODUCTS) {
    if (!dp || typeof dp !== "object") continue;
    const id = String(dp.id || "").trim();
    if (!id) continue;
    if (!map.has(id)) {
      map.set(id, { id, name: dp.name, cat: dp.cat, price: Math.round(Number(dp.price) || 0) });
    }
  }
  return Array.from(map.values());
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

  if (!Array.isArray(db.inventory)) db.inventory = [];
  if (!Array.isArray(db.purchases)) db.purchases = [];

  db.products = normalizeProducts(db.products);
  db.inventory = normalizeInventory(db.inventory);

  // purchases: keep simple array of objects
  db.purchases = (Array.isArray(db.purchases) ? db.purchases : []).filter(x => x && typeof x === "object");

  const day = db.meta.currentDay;
  if (!Array.isArray(db.salesByDay[day])) db.salesByDay[day] = [];
  if (!db.kitchenByDay[day]) db.kitchenByDay[day] = { pending: [], done: [] };
  if (!Array.isArray(db.kitchenByDay[day].pending)) db.kitchenByDay[day].pending = [];
  if (!Array.isArray(db.kitchenByDay[day].done)) db.kitchenByDay[day].done = [];

  const hasBoss = db.users.some(u => u.role === "boss");
  if (!hasBoss) {
    const { salt, hash } = hashPassword("admin");
    db.users.push({ username: "chris.adams", displayName: "Chris Adams", role: "boss", pw: { salt, hash } });
  }

  return db;
}

let db = normalizeDB(safeReadJSON(DB_PATH) || makeFreshDB());
safeWriteJSON(DB_PATH, db);

function saveDB(next) {
  db = normalizeDB(next);
  safeWriteJSON(DB_PATH, db);
}

function rotateDayIfNeeded() {
  const today = getDayKeyLocal(new Date());
  if (db.meta.currentDay !== today) {
    db.meta.currentDay = today;
    if (!Array.isArray(db.salesByDay[today])) db.salesByDay[today] = [];
    if (!db.kitchenByDay[today]) db.kitchenByDay[today] = { pending: [], done: [] };
    saveDB(db);
  }
}

function todaysKitchen() {
  rotateDayIfNeeded();
  const day = db.meta.currentDay;
  if (!db.kitchenByDay[day]) db.kitchenByDay[day] = { pending: [], done: [] };
  if (!Array.isArray(db.kitchenByDay[day].pending)) db.kitchenByDay[day].pending = [];
  if (!Array.isArray(db.kitchenByDay[day].done)) db.kitchenByDay[day].done = [];
  return db.kitchenByDay[day];
}

/* =========================
   COOKIES
   ========================= */
function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly"];
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; Path=/; Max-Age=0; HttpOnly`);
}

/* =========================
   MIDDLEWARE
   ========================= */
app.use(express.json());

// ===== Live Carts (shared across devices) =====
let cartsRev = 0;
let cartsState = { 1: [], 2: [], 3: [], 4: [] };
const cartsClients = new Set();

function normalizeCartsServer(obj){
  const out = { 1:[],2:[],3:[],4:[] };
  for(const k of [1,2,3,4]){
    const arr = obj && (obj[k] || obj[String(k)]);
    if(Array.isArray(arr)){
      out[k] = arr.filter(x=>x && typeof x==='object').map(x=>({
        name: String(x.name||''),
        price: Number(x.price)||0,
        qty: Number(x.qty)||1
      }));
    }
  }
  return out;
}

function broadcastCarts(){
  const payload = JSON.stringify({ rev: cartsRev, carts: cartsState });
  for(const res of Array.from(cartsClients)){
    try{ res.write(`data: ${payload}\n\n`); }catch(e){ try{ cartsClients.delete(res); }catch{} }
  }
}

function loadCartsFromDb(db){
  try{
    if(db && db.carts && typeof db.carts==='object'){
      cartsState = normalizeCartsServer(db.carts);
    }
    cartsRev = Number(db?.cartsRev)||0;
  }catch(e){}
}

function saveCartsToDb(db){
  try{
    db.carts = cartsState;
    db.cartsRev = cartsRev;
  }catch(e){}
}

app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  rotateDayIfNeeded();
  const cookie = String(req.headers.cookie || "");
  const m = /(?:^|;\s*)bs_token=([^;]+)/.exec(cookie);
  const token = m ? m[1] : null;

  if (!token || !db.sessions[token]) return res.status(401).json({ success: false, message: "Nicht eingeloggt." });

  const sess = db.sessions[token];
  if (sess.exp && Date.now() > sess.exp) {
    delete db.sessions[token];
    saveDB(db);
    return res.status(401).json({ success: false, message: "Session abgelaufen." });
  }

  const user = db.users.find(u => u.username === sess.username);
  if (!user) {
    delete db.sessions[token];
    saveDB(db);
    return res.status(401).json({ success: false, message: "User nicht gefunden." });
  }

  req.user = { username: user.username, displayName: user.displayName, role: user.role };
  req.token = token;
  next();
}

function requireBoss(req, res, next) {
  if (req.user?.role !== "boss") return res.status(403).json({ success: false, message: "Nur Chef." });
  next();
}

/* =========================
   ROUTES
   ========================= */
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/auth/me", (req, res) => {
  rotateDayIfNeeded();
  const cookie = String(req.headers.cookie || "");
  const m = /(?:^|;\s*)bs_token=([^;]+)/.exec(cookie);
  const token = m ? m[1] : null;

  if (!token || !db.sessions[token]) return res.json({ success: true, loggedIn: false, currentDay: db.meta.currentDay });

  const sess = db.sessions[token];
  if (sess.exp && Date.now() > sess.exp) {
    delete db.sessions[token];
    saveDB(db);
    return res.json({ success: true, loggedIn: false, currentDay: db.meta.currentDay });
  }

  const user = db.users.find(u => u.username === sess.username);
  if (!user) {
    delete db.sessions[token];
    saveDB(db);
    return res.json({ success: true, loggedIn: false, currentDay: db.meta.currentDay });
  }

  res.json({ success: true, loggedIn: true, currentDay: db.meta.currentDay, user: { username: user.username, displayName: user.displayName, role: user.role } });
});

app.post("/auth/login", (req, res) => {
  rotateDayIfNeeded();
  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  const user = db.users.find(u => String(u.username || "").toLowerCase() === username);
  if (!user) return res.status(401).json({ success: false, message: "Falscher Login." });
  if (!verifyPassword(password, user.pw)) return res.status(401).json({ success: false, message: "Falscher Login." });

  const token = makeToken();
  db.sessions[token] = { username: user.username, exp: Date.now() + 1000 * 60 * 60 * 24 * 14 };
  saveDB(db);

  setCookie(res, "bs_token", token, { maxAge: 60 * 60 * 24 * 14 });
  res.json({ success: true, user: { username: user.username, displayName: user.displayName, role: user.role }, currentDay: db.meta.currentDay });
});

app.post("/auth/logout", requireAuth, (req, res) => {
  delete db.sessions[req.token];
  saveDB(db);
  clearCookie(res, "bs_token");
  res.json({ success: true });
});

app.post("/auth/change-password", requireAuth, (req, res) => {
  const oldPw = String(req.body?.oldPw || "");
  const newPw = String(req.body?.newPw || "");

  if (newPw.length < 6) return res.status(400).json({ success: false, message: "Neues Passwort muss mindestens 6 Zeichen haben." });

  const user = db.users.find(u => u.username === req.user.username);
  if (!user) return res.status(400).json({ success: false, message: "User nicht gefunden." });
  if (!verifyPassword(oldPw, user.pw)) return res.status(401).json({ success: false, message: "Aktuelles Passwort ist falsch." });

  user.pw = hashPassword(newPw);
  for (const [tok, sess] of Object.entries(db.sessions)) {
    if (sess.username === user.username && tok !== req.token) delete db.sessions[tok];
  }
  saveDB(db);
  res.json({ success: true });
});

/* =========================
   PRODUCTS (VK Preise)
   ========================= */
app.get("/products", requireAuth, (req, res) => {
  res.json({ success: true, products: db.products });
});

app.put("/products", requireAuth, requireBoss, (req, res) => {
  const incoming = req.body?.products;
  const normalized = normalizeProducts(incoming);

  // guard: prevent accidental wipe by requiring at least 5 products
  if (!Array.isArray(normalized) || normalized.length < 5) {
    return res.status(400).json({ success: false, message: "Produktliste ungültig." });
  }

  db.products = normalized;
  saveDB(db);
  res.json({ success: true, products: db.products });
});

/* =========================
   INVENTORY / LAGER
   ========================= */
app.get("/inventory", requireAuth, requireBoss, (req, res) => {
  res.json({ success: true, items: db.inventory || [] });
});

app.post("/inventory", requireAuth, requireBoss, (req, res) => {
  const body = req.body || {};
  const id = String(body.id || "").trim();
  const name = String(body.name || "").trim();
  const unit = String(body.unit || "Stk").trim() || "Stk";
  let stock = Number(body.stock);
  let minStock = Number(body.minStock);
  if(!name) return res.status(400).json({ success:false, message:"Name fehlt." });
  if(!Number.isFinite(stock)) stock = 0;
  if(!Number.isFinite(minStock)) minStock = 0;
  stock = Math.max(0, Math.round(stock * 100) / 100);
  minStock = Math.max(0, Math.round(minStock * 100) / 100);

  if(!Array.isArray(db.inventory)) db.inventory = [];

  if(id){
    const it = db.inventory.find(x => x.id === id);
    if(!it) return res.status(404).json({ success:false, message:"Artikel nicht gefunden." });
    it.name = name;
    it.unit = unit;
    it.stock = stock;
    it.minStock = minStock;
    it.updatedAt = new Date().toISOString();
  } else {
    db.inventory.push({ id: makeInvId(), name, unit, stock, minStock, updatedAt: new Date().toISOString() });
  }

  db.inventory = normalizeInventory(db.inventory);
  saveDB(db);
  res.json({ success:true, items: db.inventory });
});

app.post("/inventory/adjust", requireAuth, requireBoss, (req, res) => {
  const id = String(req.body?.id || "").trim();
  const delta = Number(req.body?.delta);
  if(!id) return res.status(400).json({ success:false, message:"ID fehlt." });
  if(!Number.isFinite(delta) || delta === 0) return res.status(400).json({ success:false, message:"Delta ungültig." });

  const it = (db.inventory || []).find(x => x.id === id);
  if(!it) return res.status(404).json({ success:false, message:"Artikel nicht gefunden." });
  const next = Math.max(0, (Number(it.stock) || 0) + delta);
  it.stock = Math.round(next * 100) / 100;
  it.updatedAt = new Date().toISOString();
  db.inventory = normalizeInventory(db.inventory);
  saveDB(db);
  res.json({ success:true, item: it, items: db.inventory });
});

app.delete("/inventory/:id", requireAuth, requireBoss, (req, res) => {
  const id = String(req.params.id || "").trim();
  if(!id) return res.status(400).json({ success:false, message:"ID fehlt." });
  const before = (db.inventory || []).length;
  db.inventory = (db.inventory || []).filter(x => x.id !== id);
  db.inventory = normalizeInventory(db.inventory);
  saveDB(db);
  if(db.inventory.length === before) return res.status(404).json({ success:false, message:"Artikel nicht gefunden." });
  res.json({ success:true, items: db.inventory });
});

/* =========================
   EINKAUF -> LAGER (Chef)
   ========================= */

function makePurchaseId(){
  return crypto.randomBytes(10).toString("hex");
}

app.get("/purchases", requireAuth, requireBoss, (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const list = (db.purchases || []).slice().reverse().slice(0, limit);
  res.json({ success:true, items: list });
});

// Body:
//   Single: { inventoryId, qty, price?, note?, date? (YYYY-MM-DD) }
//   Batch:  { items: [{ inventoryId, qty, price?, note? }...], note?, date? (YYYY-MM-DD) }
app.post("/purchases", requireAuth, requireBoss, (req, res) => {
  const body = req.body || {};

  const nowIso = new Date().toISOString();
  const by = req.user?.username || null;

  let date = String(body.date || "").trim();
  if(date){
    const dt = parseDateYYYYMMDD(date);
    if(!dt) return res.status(400).json({ success:false, message:"Ungültiges Datum." });
    date = getDayKeyLocal(dt);
  } else {
    date = getDayKeyLocal(new Date());
  }

  const globalNote = String(body.note || "").trim();
  const added = [];

  // Batch mode
  if(Array.isArray(body.items)){
    const items = body.items.filter(x => x && typeof x === "object");
    if(items.length === 0) return res.status(400).json({ success:false, message:"Keine Positionen." });

    for(const row of items){
      const inventoryId = String(row.inventoryId || row.id || "").trim();
      let qty = Number(row.qty);
      if(!inventoryId) continue;
      if(!Number.isFinite(qty) || qty <= 0) continue;
      qty = Math.round(qty * 100) / 100;

      const it = (db.inventory || []).find(x => x.id === inventoryId);
      if(!it) continue;

      let price = Number(row.price);
      if(!Number.isFinite(price) || price < 0) price = null;
      else price = Math.round(price * 100) / 100;

      const note = String(row.note || globalNote || "").trim();

      const next = Math.max(0, (Number(it.stock) || 0) + qty);
      it.stock = Math.round(next * 100) / 100;
      it.updatedAt = nowIso;

      const p = {
        id: makePurchaseId(),
        ts: nowIso,
        date,
        inventoryId: it.id,
        name: it.name,
        unit: it.unit,
        qty,
        price,
        note,
        by
      };
      added.push(p);
    }

    if(added.length === 0) return res.status(400).json({ success:false, message:"Keine gültigen Positionen." });

    db.inventory = normalizeInventory(db.inventory);
    if(!Array.isArray(db.purchases)) db.purchases = [];
    db.purchases.push(...added);
    if(db.purchases.length > 5000) db.purchases = db.purchases.slice(-5000);

    saveDB(db);
    return res.json({ success:true, added: added.length, items: db.inventory });
  }

  // Single mode (legacy)
  const inventoryId = String(body.inventoryId || body.id || "").trim();
  let qty = Number(body.qty);
  if(!inventoryId) return res.status(400).json({ success:false, message:"Artikel fehlt." });
  if(!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ success:false, message:"Menge muss > 0 sein." });
  qty = Math.round(qty * 100) / 100;

  const it = (db.inventory || []).find(x => x.id === inventoryId);
  if(!it) return res.status(404).json({ success:false, message:"Artikel nicht gefunden." });

  let price = Number(body.price);
  if(!Number.isFinite(price) || price < 0) price = null;
  else price = Math.round(price * 100) / 100;
  const note = String(body.note || "").trim();

  const next = Math.max(0, (Number(it.stock) || 0) + qty);
  it.stock = Math.round(next * 100) / 100;
  it.updatedAt = nowIso;
  db.inventory = normalizeInventory(db.inventory);

  const p = {
    id: makePurchaseId(),
    ts: nowIso,
    date,
    inventoryId: it.id,
    name: it.name,
    unit: it.unit,
    qty,
    price,
    note,
    by
  };
  if(!Array.isArray(db.purchases)) db.purchases = [];
  db.purchases.push(p);
  if(db.purchases.length > 5000) db.purchases = db.purchases.slice(-5000);

  saveDB(db);
  res.json({ success:true, purchase: p, items: db.inventory });
});

/* =========================
   USERS (Management)
   ========================= */
app.get("/users", requireAuth, requireBoss, (req, res) => {
  res.json({ success: true, users: db.users.map(u => ({ username: u.username, displayName: u.displayName, role: u.role })) });
});

app.post("/users", requireAuth, requireBoss, (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const displayName = String(req.body?.displayName || "").trim() || username;
  let role = String(req.body?.role || "staff").toLowerCase();
  if (!["boss", "staff"].includes(role)) role = "staff";
  const password = String(req.body?.password || "admin");

  if (!username) return res.status(400).json({ success: false, message: "Username fehlt." });
  if (db.users.some(u => u.username === username)) return res.status(400).json({ success: false, message: "Username existiert bereits." });

  const pw = hashPassword(password);
  db.users.push({ username, displayName, role, pw });
  saveDB(db);
  res.json({ success: true });
});

app.delete("/users/:username", requireAuth, requireBoss, (req, res) => {
  const u = String(req.params.username || "").trim().toLowerCase();
  if (!u) return res.status(400).json({ success: false, message: "Username fehlt." });
  if (u === req.user.username) return res.status(400).json({ success: false, message: "Du kannst dich nicht selbst löschen." });

  const before = db.users.length;
  db.users = db.users.filter(x => x.username !== u);

  for (const [tok, sess] of Object.entries(db.sessions)) {
    if (sess.username === u) delete db.sessions[tok];
  }

  saveDB(db);
  if (db.users.length === before) return res.status(404).json({ success: false, message: "User nicht gefunden." });
  res.json({ success: true });
});

/* =========================
   SALES (POS -> save + kitchen)
   ========================= */
app.post("/sale", requireAuth, (req, res) => {
  rotateDayIfNeeded();
  const body = req.body || {};
  const register = Number(body.register);
  const items = body.items;
  const total = Number(body.total);
  const time = String(body.time || new Date().toISOString());
  const paidAmount = Number(body.paidAmount);

  if (!Number.isFinite(register) || register < 1) return res.status(400).json({ success: false, message: "Invalid sale payload (register)." });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, message: "Invalid sale payload (items)." });
  if (!Number.isFinite(total) || total < 0) return res.status(400).json({ success: false, message: "Invalid sale payload (total)." });
  if (!Number.isFinite(paidAmount) || paidAmount < total) return res.status(400).json({ success: false, message: "Invalid sale payload (paidAmount)." });

  const day = db.meta.currentDay;
  if (db.closedDays && db.closedDays[day]) return res.status(409).json({ success: false, message: "Dieser Tag ist bereits abgeschlossen. Keine neuen Verkäufe möglich." });

  const tip = Math.max(0, paidAmount - total);

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
  kitchen.pending.push({ id: orderId, day, time, timeHM: sale.timeHM, employee: sale.employee, register, items, total });

  saveDB(db);
  res.json({ success: true, orderId, tip });
});

/* =========================
   KITCHEN
   ========================= */
app.get("/kitchen/orders", requireAuth, (req, res) => {
  const kitchen = todaysKitchen();
  const pending = kitchen.pending.slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  res.json({ success: true, currentDay: db.meta.currentDay, pending });
});

app.post("/kitchen/done", requireAuth, (req, res) => {
  const id = Number(req.body?.id);
  if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: "Invalid id." });

  const kitchen = todaysKitchen();
  const idx = kitchen.pending.findIndex(o => Number(o.id) === id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Order nicht gefunden." });

  const [order] = kitchen.pending.splice(idx, 1);
  kitchen.done.push({ ...order, doneAt: new Date().toISOString() });
  saveDB(db);

  res.json({ success: true });
});

app.post("/kitchen/reset", requireAuth, requireBoss, (req, res) => {
  rotateDayIfNeeded();
  const day = db.meta.currentDay;
  db.kitchenByDay[day] = { pending: [], done: [] };
  saveDB(db);
  res.json({ success: true });
});

/* =========================
   RESET TODAY
   ========================= */
app.post("/reset/today", requireAuth, requireBoss, (req, res) => {
  rotateDayIfNeeded();
  const day = db.meta.currentDay;
  db.salesByDay[day] = [];
  db.kitchenByDay[day] = { pending: [], done: [] };
  saveDB(db);
  res.json({ success: true });
});

/* =========================
   REPORTS (Day details only; keep existing endpoints if you have more)
   ========================= */
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

  const byEmployeeMap = {};
  for (const s of sales) {
    const empKey = String(s.employeeUsername || s.employee || "—");
    if (!byEmployeeMap[empKey]) byEmployeeMap[empKey] = { employeeUsername: empKey, employee: s.employee || empKey, revenue: 0, tips: 0, orders: 0, avg: 0 };
    byEmployeeMap[empKey].revenue += Number(s.total || 0);
    byEmployeeMap[empKey].tips += Number(s.tip || 0);
    byEmployeeMap[empKey].orders += 1;
  }
  const byEmployee = Object.values(byEmployeeMap).map(x => ({ ...x, avg: x.orders > 0 ? x.revenue / x.orders : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  sales.sort((a, b) => String(a.time).localeCompare(String(b.time)));

  res.json({
    success: true,
    day: dayKey,
    closed: db.closedDays ? (db.closedDays[dayKey] || null) : null,
    totals,
    byEmployee,
    sales
  });
});

// Week report by employee (Calendar Week)
// GET /reports/week-employee?week=YYYY-Www
app.get("/reports/week-employee", requireAuth, requireBoss, (req, res) => {
  rotateDayIfNeeded();

  const weekStr = String(req.query?.week || "");
  const parsed = parseWeekYYYY_Www(weekStr);
  if (!parsed) return res.status(400).json({ success: false, message: "Ungültige KW. Format: YYYY-Www (z.B. 2026-W08)" });

  const start = isoWeekStartDate(parsed.year, parsed.week);
  const dayKeys = [];
  const salesAll = [];

  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const key = getDayKeyLocal(d);
    dayKeys.push(key);
    const sales = Array.isArray(db.salesByDay[key]) ? db.salesByDay[key] : [];
    salesAll.push(...sales);
  }

  const totals = {
    revenue: salesAll.reduce((s, x) => s + Number(x.total || 0), 0),
    tips: salesAll.reduce((s, x) => s + Number(x.tip || 0), 0),
    orders: salesAll.length
  };
  totals.avg = totals.orders > 0 ? totals.revenue / totals.orders : 0;

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
    week: `${parsed.year}-W${String(parsed.week).padStart(2, "0")}`,
    range: { start: dayKeys[0], end: dayKeys[6] },
    totals,
    byEmployee
  });
});

// Month report by summing whole ISO weeks that intersect the month
// GET /reports/month-employee?month=YYYY-MM
app.get("/reports/month-employee", requireAuth, requireBoss, (req, res) => {
  rotateDayIfNeeded();

  const monthStr = String(req.query?.month || "");
  const parsed = parseMonthYYYY_MM(monthStr);
  if(!parsed) return res.status(400).json({ success:false, message:"Ungültiger Monat. Format: YYYY-MM (z.B. 2026-02)" });

  const start = new Date(parsed.year, parsed.month - 1, 1);
  start.setHours(0,0,0,0);
  const end = new Date(parsed.year, parsed.month, 0); // last day of month
  end.setHours(0,0,0,0);

  // collect unique ISO weeks that intersect this month (based on days in month)
  const weekSet = new Set();
  for(let d = new Date(start); d <= end; d = addDays(d, 1)){
    const w = isoWeekYearWeek(d);
    weekSet.add(`${w.year}-W${String(w.week).padStart(2,"0")}`);
  }
  const weeks = Array.from(weekSet.values()).sort();

  const salesAll = [];
  for(const wStr of weeks){
    const wParsed = parseWeekYYYY_Www(wStr);
    if(!wParsed) continue;
    const wStart = isoWeekStartDate(wParsed.year, wParsed.week);
    for(let i=0;i<7;i++){
      const key = getDayKeyLocal(addDays(wStart, i));
      const sales = Array.isArray(db.salesByDay[key]) ? db.salesByDay[key] : [];
      salesAll.push(...sales);
    }
  }

  const totals = {
    revenue: salesAll.reduce((s,x)=> s + Number(x.total||0), 0),
    tips: salesAll.reduce((s,x)=> s + Number(x.tip||0), 0),
    orders: salesAll.length
  };
  totals.avg = totals.orders>0 ? totals.revenue / totals.orders : 0;

  const byEmployeeMap = {};
  for(const s of salesAll){
    const empKey = String(s.employeeUsername || s.employee || "—");
    if(!byEmployeeMap[empKey]) byEmployeeMap[empKey] = { employeeUsername: empKey, employee: s.employee || empKey, revenue:0, tips:0, orders:0, avg:0 };
    byEmployeeMap[empKey].revenue += Number(s.total||0);
    byEmployeeMap[empKey].tips += Number(s.tip||0);
    byEmployeeMap[empKey].orders += 1;
  }
  const byEmployee = Object.values(byEmployeeMap)
    .map(x => ({ ...x, avg: x.orders>0 ? x.revenue/x.orders : 0 }))
    .sort((a,b)=> b.revenue - a.revenue);

  return res.json({
    success:true,
    month: monthStr,
    weeks,
    note: "Monatsabrechnung = Summe ganzer KW (inkl. Tage außerhalb des Monats, wenn KW überlappt).",
    totals,
    byEmployee
  });
});


// close day
app.post("/reports/close-day", requireAuth, requireBoss, (req, res) => {
  rotateDayIfNeeded();
  const dateStr = String(req.body?.date || db.meta.currentDay);
  const date = parseDateYYYYMMDD(dateStr);
  if (!date) return res.status(400).json({ success: false, message: "Ungültiges Datum. Format: YYYY-MM-DD" });
  const dayKey = getDayKeyLocal(date);

  if (!db.closedDays || typeof db.closedDays !== "object") db.closedDays = {};
  if (db.closedDays[dayKey]) return res.status(409).json({ success: false, message: "Tag ist bereits abgeschlossen." });

  const cashCount = req.body?.cashCount;
  const note = String(req.body?.note || "");

  db.closedDays[dayKey] = {
    closedAt: new Date().toISOString(),
    closedBy: req.user.username,
    closedByName: req.user.displayName,
    cashCount: cashCount != null && cashCount !== "" ? Number(cashCount) : null,
    note: note || ""
  };

  saveDB(db);
  return res.json({ success: true, closed: db.closedDays[dayKey] });
});

/* =========================
   FRONTEND
   ========================= */
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));


// Live carts stream (SSE)
app.get("/events/carts", (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders && res.flushHeaders();

  cartsClients.add(res);

  // send current state immediately
  try{
    res.write(`data: ${JSON.stringify({ rev: cartsRev, carts: cartsState })}\n\n`);
  }catch(e){}

  req.on("close", () => {
    try{ cartsClients.delete(res); }catch(e){}
  });
});

app.get("/carts", (req, res) => {
  return res.json({ success: true, rev: cartsRev, carts: cartsState });
});

app.put("/carts", (req, res) => {
  try{
    const incoming = req.body && req.body.carts;
    const next = normalizeCartsServer(incoming);
    cartsState = next;
    cartsRev = (Number(cartsRev)||0) + 1;

    // persist
    try{
      const db = readDB();
      loadCartsFromDb(db); // keep other state stable
      cartsState = next;
      cartsRev = (Number(db.cartsRev)||0) + 1;
      saveCartsToDb(db);
      writeDB(db);
    }catch(e){}

    broadcastCarts();
    return res.json({ success: true, rev: cartsRev });
  }catch(e){
    return res.status(400).json({ success: false, message: "Bad carts payload" });
  }
});

app.listen(PORT, () => {
  console.log(`BurgerShot Server läuft auf http://localhost:${PORT}`);
});
