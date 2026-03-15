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

// DB_PATH: Wenn RAILWAY_VOLUME_MOUNT_PATH gesetzt ist, wird das persistente Volume genutzt.
// Sonst fallback auf lokales data/db.json (Entwicklung).
const DB_PATH = process.env.DATA_FILE || process.env.DB_PATH
  ? path.resolve(process.env.DATA_FILE || process.env.DB_PATH)
  : path.join(__dirname, "data", "db.json");

console.log("[DB] Pfad:", DB_PATH);

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
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
    fs.renameSync(tmp, filePath); // Atomic: kein korruptes JSON bei Absturz
    return true;
  } catch (e) {
    console.error("DB write error:", e);
    return false;
  }
}

function getDayKeyLocal(dateObj) {
  // Always use Europe/Berlin timezone so midnight works correctly for German users
  const d = new Date(dateObj);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(d);
  const get = type => parts.find(p => p.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
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
    const parts = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(d);
    const get = type => parts.find(p => p.type === type)?.value || "00";
    return `${get("hour")}:${get("minute")}`;
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
  { id:"bleeder", name:"The Bleeder", price:19, cat:"Burger" },
  { id:"heartstopper", name:"The Heartstopper", price:21, cat:"Burger" },
  { id:"chicken", name:"The Chicken", price:17, cat:"Burger" },
  { id:"vegan_burger", name:"Vegan Burger", price:15, cat:"Burger" },
  { id:"chozzo", name:"The Chozzo", price:17, cat:"Burger" },
  { id:"german", name:"The German", price:21, cat:"Burger" },

  { id:"coleslaw", name:"Coleslaw", price:15, cat:"Beilagen" },
  { id:"fries", name:"Fries", price:11, cat:"Beilagen" },
  { id:"cheesy_fries", name:"Cheesy Fries", price:13, cat:"Beilagen" },
  { id:"chicken_nuggets", name:"Chicken Nuggets", price:15, cat:"Beilagen" },
  { id:"onion_rings", name:"Onion Rings", price:11, cat:"Beilagen" },

  { id:"ecola", name:"ECola", price:13, cat:"Getränke" },
  { id:"ecola_light", name:"ECola Light", price:13, cat:"Getränke" },
  { id:"sprunk", name:"Sprunk", price:13, cat:"Getränke" },
  { id:"sprunk_light", name:"Sprunk Light", price:13, cat:"Getränke" },
  { id:"slush", name:"Slush", price:15, cat:"Getränke" },
  { id:"milchshake",       name:"Milchshake",        price:15, cat:"Getränke" },
  { id:"orange_o_tang",    name:"Orange O Tang",     price:9,  cat:"Getränke", icon:"orang_o_tang.png",     ekPrice:2 },
  { id:"mexi_coke_spicy",  name:"Mexi-Coke Spicy",   price:13, cat:"Getränke", icon:"mexi_coke_spicy.png",  ekPrice:4 },
  { id:"junk_energy",      name:"Junk Energy",        price:15, cat:"Getränke", icon:"junk_energy.png",      ekPrice:5 },
  { id:"juice_apple",      name:"Apfelsaft",          price:8, cat:"Getränke", icon:"Juice_Apple.png",      ekPrice:3 },
  { id:"juice_orange",     name:"Orangensaft",        price:8, cat:"Getränke", icon:"Juice_Orange.png",     ekPrice:3 },
  { id:"slushy_atom",      name:"Slush Atom",         price:18, cat:"Getränke", icon:"slushy_atom.png",      ekPrice:8 },
  { id:"electrolyte_drink",name:"Elektrolyte Trink",  price:14, cat:"Getränke", icon:"electrolytet_rink.png",ekPrice:7 },

  { id:"donut", name:"Donut", price:13, cat:"Süßes" },
  { id:"caramel_sundae", name:"Caramel Sundae", price:13, cat:"Süßes" },
  { id:"chocolate_sundae", name:"Chocolate Sundae", price:13, cat:"Süßes" },
  { id:"strawberry_sundae", name:"Strawberry Sundae", price:13, cat:"Süßes" },

  // Gruppen-Menüs
  { id:"menu_small",   name:"Small Menü",       price:39,  cat:"Menü", icon:"small.png",       groupSize:1,  desc:"1× Burger, Fries/Cheesy Fries & Getränk" },
  { id:"menu_medium",  name:"Medium Menü",      price:78,  cat:"Menü", icon:"medium.png",      groupSize:2,  desc:"2× Burger, Fries/Cheesy Fries & Getränk" },
  { id:"menu_large",   name:"Large Menü",       price:195, cat:"Menü", icon:"large.png",       groupSize:5,  desc:"5× Burger, Fries/Cheesy Fries & Getränk" },
  { id:"menu_xlarge",  name:"X-tra Large Menü", price:390, cat:"Menü", icon:"xl.png", groupSize:10, desc:"10× Burger, Fries/Cheesy Fries & Getränk" },

  // No Sides — Burger + Getränk, keine Beilage
  { id:"ns_small",  name:"No Sides Small",       price:28,  cat:"Menü", icon:"no_sides_small.png",  groupSize:1,  noSidesBox:true, desc:"1× Burger & 1 Getränk nach Wahl" },
  { id:"ns_medium", name:"No Sides Medium",      price:57,  cat:"Menü", icon:"no_sides_medium.png", groupSize:2,  noSidesBox:true, desc:"2× Burger & 2 Getränke nach Wahl" },
  { id:"ns_large",  name:"No Sides Large",       price:142, cat:"Menü", icon:"no_sides_large.png",  groupSize:5,  noSidesBox:true, desc:"5× Burger & 5 Getränke nach Wahl" },
  { id:"ns_xl",     name:"No Sides X-tra Large", price:285, cat:"Menü", icon:"no_sides_xl.png",     groupSize:10, noSidesBox:true, desc:"10× Burger & 10 Getränke nach Wahl" },

  // Chicken Boxes — fixer Chicken Burger + Nuggets, nur Getränk wählbar

  // German Special — fixer German + Coleslaw, nur Getränk wählbar

  // Donut Boxes — nur Anzahl, keine Auswahl
  { id:"dbox_small",  name:"Donut Box Small",       price:49,  cat:"Menü", icon:"donut_box.png", donutBox:true, groupSize:4,  desc:"4× Donut" },
  { id:"dbox_medium", name:"Donut Box Medium",      price:74,  cat:"Menü", icon:"donut_box.png", donutBox:true, groupSize:6,  desc:"6× Donut" },
  { id:"dbox_large",  name:"Donut Box Large",       price:148,  cat:"Menü", icon:"donut_box.png", donutBox:true, groupSize:12, desc:"12× Donut" },
  { id:"dbox_xl",     name:"Donut Box X-tra Large", price:247, cat:"Menü", icon:"donut_box.png", donutBox:true, groupSize:20, desc:"20× Donut" }
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
    saleInventoryLinks: [],

    // Lagerbestand (Chef)
    inventory: [],

    // Einkäufe (Chef) – Bewegungslog / Historie
    purchases: [],

    salesByDay: { [today]: [] },
    expenses: [],
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
    let ekPrice = Number(it.ekPrice);
    if(!Number.isFinite(ekPrice) || ekPrice < 0) ekPrice = 0;
    ekPrice = Math.round(ekPrice * 100) / 100;
    out.push({ id, name, unit, stock, minStock, ekPrice, updatedAt });
  }
  // sort stable
  out.sort((a,b)=>String(a.name).localeCompare(String(b.name), "de"));
  return out;
}

function normalizeProducts(list, hiddenProducts) {
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
    const extra = {};
    if (p.icon) extra.icon = String(p.icon);
    if (p.desc) extra.desc = String(p.desc);
    if (p.groupSize) extra.groupSize = Number(p.groupSize);
    if (p.chickenBox) extra.chickenBox = true;
    if (p.donutBox) extra.donutBox = true;
    if (p.germanBox) extra.germanBox = true;
    if (p.noSidesBox) extra.noSidesBox = true;
    out.push({ id, name, cat, price: Math.round(price), ...extra });
  }

  // Ensure defaults always exist and always have up-to-date extra fields
  const map = new Map(out.map(p => [p.id, p]));
  for (const dp of DEFAULT_PRODUCTS) {
    if (!dp || typeof dp !== "object") continue;
    const id = String(dp.id || "").trim();
    if (!id) continue;
    const extra = {};
    if (dp.icon) extra.icon = String(dp.icon);
    if (dp.desc) extra.desc = String(dp.desc);
    if (dp.groupSize) extra.groupSize = Number(dp.groupSize);
    if (dp.chickenBox) extra.chickenBox = true;
    if (dp.donutBox) extra.donutBox = true;
    if (dp.germanBox) extra.germanBox = true;
    if (dp.noSidesBox) extra.noSidesBox = true;
    if (!map.has(id)) {
      map.set(id, { id, name: dp.name, cat: dp.cat, price: Math.round(Number(dp.price) || 0), ...extra });
    } else {
      // Always sync extra fields from defaults (groupSize, icon, desc)
      Object.assign(map.get(id), extra);
    }
  }
  // Remove products that no longer exist in DEFAULT_PRODUCTS (e.g. renamed/deleted defaults)
  const defaultIds = new Set(DEFAULT_PRODUCTS.map(p => String(p.id || "").trim()).filter(Boolean));
  for (const [id] of map) {
    if (!defaultIds.has(id)) map.delete(id);
  }
  // Remove hidden products
  const hidden = new Set(Array.isArray(hiddenProducts) ? hiddenProducts : []);
  for (const id of hidden) map.delete(id);
  return Array.from(map.values());
}

function normalizeDB(db) {
  if (!db || typeof db !== "object") return makeFreshDB();
  if (!db.meta) db.meta = {};
  if (!db.meta.currentDay) db.meta.currentDay = getDayKeyLocal(new Date());
  if (!db.board) db.board = [];
  if (!db.meta.nextOrderId) db.meta.nextOrderId = 1;
  if (!Array.isArray(db.users)) db.users = [];
  if (!db.sessions || typeof db.sessions !== "object") db.sessions = {};
  if (!db.salesByDay || typeof db.salesByDay !== "object") db.salesByDay = {};
  if (!db.kitchenByDay || typeof db.kitchenByDay !== "object") db.kitchenByDay = {};
  if (!db.closedDays || typeof db.closedDays !== "object") db.closedDays = {};

  if (!Array.isArray(db.inventory)) db.inventory = [];
  if (!Array.isArray(db.purchases)) db.purchases = [];
  if (!db.purchaseOverrides || typeof db.purchaseOverrides !== "object") db.purchaseOverrides = {};
  if (!Array.isArray(db.expenses)) db.expenses = [];

  db.products = normalizeProducts(db.products, db.hiddenProducts);
  db.inventory = normalizeInventory(db.inventory);
  // saleInventoryLinks: [{id, productId, inventoryId, qty}]
  if(!Array.isArray(db.saleInventoryLinks)) db.saleInventoryLinks = [];

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

const rawDb = safeReadJSON(DB_PATH);
console.log("[STARTUP] DB_PATH:", DB_PATH);
console.log("[STARTUP] DB gefunden:", !!rawDb);
console.log("[STARTUP] Inventory:", (rawDb?.inventory||[]).length, "Artikel");
console.log("[STARTUP] Links:", (rawDb?.saleInventoryLinks||[]).length, "Zuordnungen");
let db = normalizeDB(rawDb || makeFreshDB());
// Note: do NOT write back here - would overwrite Volume data with empty defaults

function saveDB(next) {
  db = normalizeDB(next);
  safeWriteJSON(DB_PATH, db);
}

// Startup migration: remove deprecated product IDs from DB
function migrateProducts() {
  const defaultIds = new Set(DEFAULT_PRODUCTS.map(p => String(p.id || "").trim()).filter(Boolean));
  const before = (db.products || []).length;
  db.products = (db.products || []).filter(p => defaultIds.has(String(p.id || "").trim()));
  if (db.products.length !== before) {
    console.log(`[Migration] ${before - db.products.length} veraltete Produkte entfernt.`);
    saveDB(db);
  }
}
migrateProducts();

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


// ===== Soft Lock / Presence (SSE) =====
const presenceClients = new Set();
// { "1": { users: { "username": { name, at } } } }
let presenceState = { "1": {users:{}}, "2": {users:{}}, "3": {users:{}}, "4": {users:{}} };
// Global online tracking (no register required)
let onlineUsers = {}; // { username: { name, at } }
// Debounced lastSeen save — avoid saveDB on every heartbeat (race conditions)
let _lastSeenSaveTimer = null;
function scheduleLastSeenSave(){
  if(_lastSeenSaveTimer) clearTimeout(_lastSeenSaveTimer);
  _lastSeenSaveTimer = setTimeout(()=>{ _lastSeenSaveTimer = null; saveDB(db); }, 10000); // save after 10s quiet
}

function prunePresence(){
  const now = Date.now();
  let changed = false;
  // Prune global online users (30s timeout)
  for(const u of Object.keys(onlineUsers)){
    if(now - (onlineUsers[u].at||0) > 30000){ delete onlineUsers[u]; changed = true; }
  }
  for(const k of ["1","2","3","4"]){
    const users = presenceState[k]?.users || {};
    for(const u of Object.keys(users)){
      if(now - (users[u].at||0) > 20000){ // 20s stale
        delete users[u];
        changed = true;
      }
    }
  }
  if(changed) broadcastPresence();
}

function broadcastPresence(){
  const payload = JSON.stringify({ presence: presenceState, online: onlineUsers, ts: Date.now() });
  for(const res of Array.from(presenceClients)){
    try{ res.write("data: " + payload + "\n\n"); }
    catch(e){ try{ presenceClients.delete(res); }catch(_){} }
  }
}

// prune periodically
setInterval(prunePresence, 5000);

// ===== Live Carts (SSE) =====
let cartsRev = 0;
let cartsState = { 1: [], 2: [], 3: [], 4: [] };
const cartsClients = new Set();

function normalizeCarts(obj){
  const out = { 1:[], 2:[], 3:[], 4:[] };
  [1,2,3,4].forEach(k=>{
    const arr = obj && (obj[k] || obj[String(k)]);
    if(Array.isArray(arr)){
      out[k] = arr.filter(x=>x && typeof x==="object").map(x=>({
        name: String(x.name||""),
        price: Number(x.price)||0,
        qty: Number(x.qty)||1,
        productId: x.productId || null,
        components: x.components || null
      }));
    }
  });
  return out;
}

function broadcastCarts(){
  const payload = JSON.stringify({ rev: cartsRev, carts: cartsState });
  for(const res of Array.from(cartsClients)){
    try{ res.write("data: " + payload + "\n\n"); }
    catch(e){ try{ cartsClients.delete(res); }catch(_){} }
  }
}

function loadCartsFromDb(db){
  try{
    if(db && db.carts) cartsState = normalizeCarts(db.carts);
    cartsRev = Number(db && db.cartsRev) || 0;
  }catch(e){}
}

function persistCartsToDb(){
  try{
    const db = readDB();
    
loadCartsFromDb(db);
loadCartsFromDb(db); // bring existing in
    db.carts = cartsState;
    db.cartsRev = cartsRev;
    writeDB(db);
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
function requireBossOrManager(req, res, next) {
  if (!["boss","manager"].includes(req.user?.role)) return res.status(403).json({ success: false, message: "Kein Zugriff." });
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
  // Track first login of today
  const todayKey = getDayKeyLocal(new Date());
  if(!user.firstLoginByDay) user.firstLoginByDay = {};
  if(!user.firstLoginByDay[todayKey]) user.firstLoginByDay[todayKey] = new Date().toISOString();
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
app.delete("/products/:id", requireAuth, requireBoss, (req, res) => {
  const id = String(req.params.id || "").trim();
  if(!id) return res.status(400).json({ success:false, message:"ID fehlt." });
  if(!Array.isArray(db.hiddenProducts)) db.hiddenProducts = [];
  if(!db.hiddenProducts.includes(id)) db.hiddenProducts.push(id);
  db.products = normalizeProducts(db.products, db.hiddenProducts); // rebuild without hidden
  saveDB(db);
  res.json({ success:true, products: db.products, hiddenProducts: db.hiddenProducts });
});

app.post("/products/:id/restore", requireAuth, requireBoss, (req, res) => {
  const id = String(req.params.id || "").trim();
  db.hiddenProducts = (db.hiddenProducts||[]).filter(h => h !== id);
  db.products = normalizeProducts(db.products, db.hiddenProducts);
  saveDB(db);
  res.json({ success:true, products: db.products });
});

app.get("/products", requireAuth, (req, res) => {
  res.json({ success: true, products: db.products });
});

app.put("/products", requireAuth, requireBoss, (req, res) => {
  const incoming = req.body?.products;
  const normalized = normalizeProducts(incoming, db.hiddenProducts);

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
app.get("/inventory", requireAuth, (req, res) => {
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

  let ekPrice = Number(body.ekPrice);
  if(!Number.isFinite(ekPrice) || ekPrice < 0) ekPrice = 0;
  ekPrice = Math.round(ekPrice * 100) / 100;

  if(id){
    const it = db.inventory.find(x => x.id === id);
    if(!it) return res.status(404).json({ success:false, message:"Artikel nicht gefunden." });
    it.name = name;
    it.unit = unit;
    it.stock = stock;
    it.minStock = minStock;
    it.ekPrice = ekPrice;
    it.updatedAt = new Date().toISOString();
  } else {
    db.inventory.push({ id: makeInvId(), name, unit, stock, minStock, ekPrice, updatedAt: new Date().toISOString() });
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

app.get("/purchases", requireAuth, requireBossOrManager, (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const date  = String(req.query.date || "").slice(0,10);
  let list = (db.purchases || []).slice().reverse();
  if(date) list = list.filter(p => String(p.date||"").slice(0,10) === date);
  list = list.slice(0, limit);
  res.json({ success:true, items: list });
});

// Body:
//   Single: { inventoryId, qty, price?, note?, date? (YYYY-MM-DD) }
//   Batch:  { items: [{ inventoryId, qty, price?, note? }...], note?, date? (YYYY-MM-DD) }
app.post("/purchases", requireAuth, requireBossOrManager, (req, res) => {
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

    // Lagereinkauf → vom Kontostand abziehen
    const batchCost = added.reduce((s,p) => s + (p.price != null ? p.qty * p.price : 0), 0);
    if(batchCost > 0) adjustBankBalance(-batchCost, `Lagereinkauf (${added.length} Artikel)`);

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

  // Lagereinkauf → vom Kontostand abziehen
  if(price != null && price > 0) adjustBankBalance(-(qty * price), `Lagereinkauf: ${it.name}`);

  saveDB(db);
  res.json({ success:true, purchase: p, items: db.inventory });
});

app.put("/purchases/:id", requireAuth, requireBoss, (req, res) => {
  const id = String(req.params.id || "");
  const entry = (db.purchases||[]).find(p => p.id === id);
  if(!entry) return res.status(404).json({ success:false, message:"Eintrag nicht gefunden." });

  const newPrice = req.body?.price !== undefined ? Number(req.body.price) : entry.price;
  const newQty   = req.body?.qty   !== undefined ? Number(req.body.qty)   : entry.qty;

  if(!Number.isFinite(newQty) || newQty < 0) return res.status(400).json({ success:false, message:"Ungültige Menge." });

  // Reverse old cost, apply new cost
  const oldCost = (entry.price != null && entry.qty > 0) ? entry.qty * entry.price : 0;
  const newCost = (newPrice != null && !isNaN(newPrice) && newPrice >= 0 && newQty > 0) ? newQty * newPrice : 0;
  const diff = newCost - oldCost;
  if(diff !== 0) adjustBankBalance(-diff, `Einkauf korrigiert: ${entry.name}`);

  entry.price = (newPrice != null && !isNaN(newPrice) && newPrice >= 0) ? Math.round(newPrice * 100) / 100 : null;
  entry.qty   = Math.round(newQty * 100) / 100;

  saveDB(db);
  res.json({ success: true, entry });
});

app.delete("/purchases/:id", requireAuth, requireBoss, (req, res) => {
  const id = String(req.params.id || "");
  const before = (db.purchases||[]).length;
  const entry = (db.purchases||[]).find(p => p.id === id);
  if(!entry) return res.status(404).json({ success:false, message:"Eintrag nicht gefunden." });
  // Reverse stock and bank balance
  const it = (db.inventory || []).find(x => x.id === entry.inventoryId);
  if(it) it.stock = Math.round(Math.max(0, (Number(it.stock)||0) - (Number(entry.qty)||0)) * 100) / 100;
  if(entry.price != null && entry.qty > 0) adjustBankBalance(entry.qty * entry.price, `Einkauf storniert: ${entry.name}`);
  db.purchases = db.purchases.filter(p => p.id !== id);
  saveDB(db);
  res.json({ success: true, items: db.inventory });
});

/* =========================
   GUTHABEN KARTEN
   ========================= */

function normalizeKarten() {
  if (!Array.isArray(db.guthabenKarten)) db.guthabenKarten = [];
}

app.get("/guthaben-karten", requireAuth, (req, res) => {
  normalizeKarten();
  res.json({ success: true, karten: db.guthabenKarten.map(k => ({
    id: k.id, name: k.name, balance: k.balance, createdAt: k.createdAt, updatedAt: k.updatedAt
  }))});
});

app.get("/guthaben-karten/check", requireAuth, (req, res) => {
  normalizeKarten();
  const name = String(req.query.name || "").trim().toLowerCase();
  if (!name) return res.status(400).json({ success: false, message: "Name fehlt." });
  const karte = db.guthabenKarten.find(k => k.name.toLowerCase() === name);
  if (!karte) return res.json({ success: true, found: false, balance: 0 });
  res.json({ success: true, found: true, id: karte.id, name: karte.name, balance: karte.balance });
});

app.post("/guthaben-karten", requireAuth, requireBossOrManager, (req, res) => {
  normalizeKarten();
  const name = String(req.body?.name || "").trim();
  const betrag = Math.round(Number(req.body?.betrag) * 100) / 100;
  if (!name) return res.status(400).json({ success: false, message: "Name fehlt." });
  if (!Number.isFinite(betrag) || betrag <= 0) return res.status(400).json({ success: false, message: "Betrag muss > 0 sein." });

  let karte = db.guthabenKarten.find(k => k.name.toLowerCase() === name.toLowerCase());
  const isNew = !karte;
  const ts = new Date().toISOString();

  if (isNew) {
    karte = { id: crypto.randomBytes(6).toString("hex"), name, balance: 0, history: [], createdAt: ts, updatedAt: ts };
    db.guthabenKarten.push(karte);
  }

  karte.balance = Math.round((karte.balance + betrag) * 100) / 100;
  karte.updatedAt = ts;
  if (!Array.isArray(karte.history)) karte.history = [];
  karte.history.push({ ts, type: "topup", amount: betrag, by: req.user.displayName || req.user.username });
  if (karte.history.length > 200) karte.history = karte.history.slice(-200);

  // Book topup as revenue entry
  rotateDayIfNeeded();
  const day = db.meta.currentDay;
  if (!Array.isArray(db.salesByDay[day])) db.salesByDay[day] = [];
  const topupOrderId = db.meta.nextOrderId++;
  db.salesByDay[day].push({
    id: topupOrderId,
    day,
    time: ts,
    timeHM: toHM(ts),
    employee: req.user.displayName || req.user.username,
    employeeUsername: req.user.username,
    register: 0,
    items: [{ name: `Guthaben-Aufladung: ${karte.name}`, price: betrag, qty: 1 }],
    total: betrag,
    paidAmount: betrag,
    tip: 0,
    paymentMethod: "guthabenTopup",
    guthabenName: karte.name
  });

  saveDB(db);
  res.json({ success: true, isNew, karte: { id: karte.id, name: karte.name, balance: karte.balance } });
});

app.post("/guthaben-karten/pay", requireAuth, (req, res) => {
  normalizeKarten();
  const name = String(req.body?.name || "").trim().toLowerCase();
  const amount = Math.round(Number(req.body?.amount) * 100) / 100;
  if (!name || !Number.isFinite(amount) || amount <= 0)
    return res.status(400).json({ success: false, message: "Ungültige Daten." });

  const karte = db.guthabenKarten.find(k => k.name.toLowerCase() === name);
  if (!karte) return res.status(404).json({ success: false, message: "Karte nicht gefunden." });
  if (karte.balance < amount) return res.status(400).json({ success: false, message: `Guthaben reicht nicht aus (${karte.balance.toFixed(2)} $).` });

  const ts = new Date().toISOString();
  karte.balance = Math.round((karte.balance - amount) * 100) / 100;
  karte.updatedAt = ts;
  if (!Array.isArray(karte.history)) karte.history = [];
  karte.history.push({ ts, type: "pay", amount, by: req.user.displayName || req.user.username });

  saveDB(db);
  res.json({ success: true, balance: karte.balance, name: karte.name });
});

/* =========================
   TIP PAYOUTS
   ========================= */
app.get("/tip-payouts", requireAuth, requireBoss, (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const list = (db.tipPayouts || []).slice().reverse().slice(0, limit);
  res.json({ success: true, payouts: list });
});

app.post("/tip-payouts", requireAuth, requireBoss, (req, res) => {
  const body = req.body || {};
  const week = String(body.week || "").trim();
  const entries = body.entries; // [{employeeUsername, employee, amount}]
  if (!week || !Array.isArray(entries) || entries.length === 0)
    return res.status(400).json({ success: false, message: "Fehlende Daten." });

  const validated = entries
    .filter(e => e && Number(e.amount) > 0)
    .map(e => ({
      employeeUsername: String(e.employeeUsername || ""),
      employee: String(e.employee || e.employeeUsername || ""),
      amount: Math.round(Number(e.amount) * 100) / 100
    }));

  if (!validated.length)
    return res.status(400).json({ success: false, message: "Keine gültigen Beträge." });

  const total = validated.reduce((s, e) => s + e.amount, 0);
  const payout = {
    id: crypto.randomBytes(8).toString("hex"),
    ts: new Date().toISOString(),
    week,
    by: req.user.username,
    byName: req.user.displayName || req.user.username,
    entries: validated,
    total: Math.round(total * 100) / 100
  };

  if (!Array.isArray(db.tipPayouts)) db.tipPayouts = [];
  db.tipPayouts.push(payout);
  if (db.tipPayouts.length > 1000) db.tipPayouts = db.tipPayouts.slice(-1000);

  saveDB(db);
  res.json({ success: true, payout });
});

/* =========================
   SCHWARZES BRETT
   ========================= */
app.get("/board", requireAuth, (req, res) => {
  const user = db.users.find(u => u.username === req.user.username);
  const lastRead = user?.boardLastRead || null;
  res.json({ success: true, posts: db.board || [], lastRead });
});

app.post("/board", requireAuth, (req, res) => {
  const title = String(req.body?.title || "").trim();
  const body  = String(req.body?.body  || "").trim();
  const prio  = ["normal","important","urgent"].includes(req.body?.prio) ? req.body.prio : "normal";
  if (!title) return res.status(400).json({ success: false, message: "Titel fehlt." });
  if (!db.board) db.board = [];
  const post = {
    id: Date.now().toString(),
    title, body, prio,
    author: req.user.displayName || req.user.username,
    authorUsername: req.user.username,
    createdAt: new Date().toISOString()
  };
  db.board.unshift(post);
  saveDB(db);
  res.json({ success: true, post });
});

app.post("/board/mark-read", requireAuth, (req, res) => {
  const user = db.users.find(u => u.username === req.user.username);
  if(user) { user.boardLastRead = new Date().toISOString(); saveDB(db); }
  res.json({ success: true });
});

app.delete("/board/:id", requireAuth, (req, res) => {
  if (!db.board) return res.json({ success: true });
  const before = db.board.length;
  // Any role can delete own post; boss/manager can delete all
  db.board = db.board.filter(p => {
    if (p.id !== req.params.id) return true;
    if (["boss","manager"].includes(req.user.role)) return false;
    return p.authorUsername !== req.user.username;
  });
  if (db.board.length < before) saveDB(db);
  res.json({ success: true });
});

/* =========================
   CASH TRANSFER
   ========================= */
app.post("/cash-transferred", requireAuth, requireBossOrManager, (req, res) => {
  const { day, employeeUsername } = req.body || {};
  if (!day || !employeeUsername) return res.status(400).json({ success: false, message: "day und employeeUsername erforderlich." });
  // Mark all isCash sales for this employee on this day as transferred
  const sales = db.salesByDay[day] || [];
  let count = 0;
  for (const s of sales) {
    const empKey = String(s.employeeUsername || s.employee || "—");
    if (s.isCash && empKey === employeeUsername) {
      s.cashTransferred = true;
      count++;
    }
  }
  saveDB(db);
  res.json({ success: true, count });
});

/* =========================
   STATS ENDPOINTS
   ========================= */

app.get("/reports/employee-totals", requireAuth, requireBossOrManager, (req, res) => {
  const byEmployee = {};
  for (const [, sales] of Object.entries(db.salesByDay || {})) {
    for (const s of sales) {
      if (s.staffOrder || s.paymentMethod === "guthaben") continue;
      const name = s.employee || s.employeeUsername || "Unbekannt";
      if (!byEmployee[name]) byEmployee[name] = { name, revenue: 0, orders: 0 };
      byEmployee[name].revenue += Number(s.total || 0);
      byEmployee[name].orders++;
    }
  }
  const result = Object.values(byEmployee)
    .sort((a, b) => b.revenue - a.revenue)
    .map(e => ({ ...e, avg: e.orders > 0 ? Math.round(e.revenue / e.orders) : 0 }));
  res.json({ success: true, employees: result });
});

app.get("/reports/bestseller", requireAuth, requireBossOrManager, (req, res) => {
  const byItem = {};
  for (const [, sales] of Object.entries(db.salesByDay || {})) {
    for (const s of sales) {
      if (!Array.isArray(s.items)) continue;
      for (const it of s.items) {
        const name = it.name || "Unbekannt";
        if (!byItem[name]) byItem[name] = { name, qty: 0, revenue: 0 };
        byItem[name].qty += Number(it.qty || 1);
        byItem[name].revenue += Number(it.price || 0) * Number(it.qty || 1);
      }
    }
  }
  const result = Object.values(byItem)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 50);
  res.json({ success: true, items: result });
});

/* =========================
   BANK BALANCE
   ========================= */
app.get("/bank-balance", requireAuth, requireBoss, (req, res) => {
  res.json({ success: true, balance: db.bankBalance ?? null, updatedAt: db.bankBalanceUpdatedAt ?? null });
});

app.get("/bank-balance/history", requireAuth, requireBoss, (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 100);
  const history = (db.bankHistory || []).slice().reverse().slice(0, limit);
  res.json({ success: true, history });
});

app.put("/bank-balance", requireAuth, requireBoss, (req, res) => {
  const balance = Number(req.body?.balance);
  const note = String(req.body?.note || "").trim();
  if (!Number.isFinite(balance)) return res.status(400).json({ success: false, message: "Ungültiger Betrag." });

  const prev = db.bankBalance ?? null;
  db.bankBalance = Math.round(balance * 100) / 100;
  db.bankBalanceUpdatedAt = new Date().toISOString();

  // Save to history
  if (!Array.isArray(db.bankHistory)) db.bankHistory = [];
  db.bankHistory.push({
    ts: db.bankBalanceUpdatedAt,
    balance: db.bankBalance,
    prev,
    diff: prev !== null ? Math.round((db.bankBalance - prev) * 100) / 100 : null,
    note: note || null,
    by: req.user?.username || null,
    byName: req.user?.displayName || req.user?.username || null
  });
  if (db.bankHistory.length > 500) db.bankHistory = db.bankHistory.slice(-500);

  saveDB(db);
  res.json({ success: true, balance: db.bankBalance, updatedAt: db.bankBalanceUpdatedAt });
});

/* =========================
   SALE INVENTORY LINKS (Management)
   ========================= */

app.get("/sale-inventory-links", requireAuth, requireBoss, (req, res) => {
  res.json({ success: true, links: db.saleInventoryLinks || [] });
});

app.put("/sale-inventory-links", requireAuth, requireBoss, (req, res) => {
  const incoming = req.body?.links;
  if (!Array.isArray(incoming)) return res.status(400).json({ success: false, message: "links muss ein Array sein." });
  const validated = [];
  for (const l of incoming) {
    const productId = String(l.productId || "").trim();
    const inventoryId = String(l.inventoryId || "").trim();
    const qty = Number(l.qty);
    if (!productId || !inventoryId) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    validated.push({ productId, inventoryId, qty: Math.round(qty * 100) / 100 });
  }
  db.saleInventoryLinks = validated;
  saveDB(db);
  res.json({ success: true, links: db.saleInventoryLinks });
});

/* =========================
   USERS (Management)
   ========================= */
app.get("/users", requireAuth, requireBoss, (req, res) => {
  const todayKey = getDayKeyLocal(new Date());
  res.json({ success: true, users: db.users.map(u => ({ username: u.username, displayName: u.displayName, role: u.role, lastSeen: u.lastSeen || null, firstLoginToday: (u.firstLoginByDay && u.firstLoginByDay[todayKey]) || null })) });
});

app.post("/users", requireAuth, requireBoss, (req, res) => {
  const username = String(req.body?.username || "").trim().toLowerCase();
  const displayName = String(req.body?.displayName || "").trim() || username;
  let role = String(req.body?.role || "staff").toLowerCase();
  if (!["boss","manager","staff"].includes(role)) role = "staff";
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
  const isStaffOrder = body.staffOrder === true;
  if (!Number.isFinite(paidAmount) || (!isStaffOrder && paidAmount < total)) return res.status(400).json({ success: false, message: "Invalid sale payload (paidAmount)." });

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
    tip,
    staffOrder: isStaffOrder || false,
    staffEmployee: isStaffOrder ? String(body.staffEmployee||"").trim() : undefined,
    staffEmployeeName: isStaffOrder ? String(body.staffEmployeeName||"").trim() : undefined,
    paymentMethod: String(body.paymentMethod || "cash"),
    guthabenName: body.guthabenName ? String(body.guthabenName).trim() : undefined,
    isCash: body.isCash === true || false,
    discount: body.discount ? Number(body.discount) : undefined
  };

  if (!Array.isArray(db.salesByDay[day])) db.salesByDay[day] = [];
  db.salesByDay[day].push(sale);

  // Staff orders skip kitchen
  if (!isStaffOrder) {
    const kitchen = todaysKitchen();
    kitchen.pending.push({ id: orderId, day, time, timeHM: sale.timeHM, employee: sale.employee, register, items, total });
  }

  // Lagerbestand reduzieren
  try {
    const links = db.saleInventoryLinks || [];
    for (const saleItem of items) {
      const productIds = [];
      // Einzelne Komponenten (Menü hat components-Array)
      if (Array.isArray(saleItem.components)) {
        for (const c of saleItem.components) {
          if (c.productId) productIds.push({ productId: c.productId, qty: (c.qty || 1) * (saleItem.qty || 1) });
        }
      } else if (saleItem.productId) {
        productIds.push({ productId: saleItem.productId, qty: saleItem.qty || 1 });
      }
      for (const { productId, qty } of productIds) {
        const matched = links.filter(l => l.productId === productId);
        for (const link of matched) {
          const invItem = (db.inventory || []).find(x => x.id === link.inventoryId);
          if (invItem) {
            invItem.stock = Math.max(0, Math.round((Number(invItem.stock) || 0) * 100 - link.qty * qty * 100) / 100);
            invItem.updatedAt = new Date().toISOString();
          }
        }
      }
    }
  } catch(e) { console.error("Lager-Abzug Fehler:", e); }

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

// Reset ALL sales, purchases, tips and closed days (Testphase only)
app.post("/reset/all-data", requireAuth, requireBoss, (req, res) => {
  db.salesByDay = {};
  db.kitchenByDay = {};
  db.purchases = [];
  db.closedDays = {};
  db.meta.nextOrderId = 1;
  saveDB(db);
  res.json({ success: true });
});

/* =========================
   STAFF CONSUMPTION REPORT
   ========================= */
app.get("/reports/staff-consumption", requireAuth, requireBoss, (req, res) => {
  const all = Object.values(db.salesByDay || {}).flat().filter(s => s.staffOrder);
  // Group by staffEmployee, track individual bookings with date
  const byEmployee = {};
  for (const s of all) {
    const key = s.staffEmployee || s.employeeUsername || "—";
    const name = s.staffEmployeeName || s.employee || key;
    if (!byEmployee[key]) byEmployee[key] = { username: key, name, bookings: [], total: 0, orders: 0 };
    byEmployee[key].orders++;
    byEmployee[key].bookings.push({
      date: s.day || String(s.time || "").slice(0, 10),
      time: s.timeHM || String(s.time || "").slice(11, 16),
      items: (s.items || []).map(it => ({ name: String(it.name||""), qty: Number(it.qty)||1 }))
    });
  }
  // Sort bookings newest first
  const result = Object.values(byEmployee).map(e => ({
    ...e,
    bookings: e.bookings.sort((a,b) => String(b.date+b.time).localeCompare(String(a.date+a.time)))
  })).sort((a,b) => b.orders - a.orders);
  res.json({ success: true, entries: result });
});

/* =========================
   REPORTS (Day details only; keep existing endpoints if you have more)
   ========================= */
// Helper: sum purchase costs for a list of day keys
/* =========================
   BANK BALANCE HELPER
   ========================= */
function adjustBankBalance(amount, note) {
  if (!Number.isFinite(amount) || amount === 0) return;
  if (!Number.isFinite(db.bankBalance)) db.bankBalance = 0;
  const prev = db.bankBalance;
  db.bankBalance = Math.round((db.bankBalance + amount) * 100) / 100;
  db.bankBalanceUpdatedAt = new Date().toISOString();
  if (!Array.isArray(db.bankHistory)) db.bankHistory = [];
  db.bankHistory.push({
    ts: db.bankBalanceUpdatedAt,
    balance: db.bankBalance,
    prev,
    diff: Math.round(amount * 100) / 100,
    note: note || null,
    by: "system",
    byName: "System"
  });
  if (db.bankHistory.length > 500) db.bankHistory = db.bankHistory.slice(-500);
}

function getExpensesCosts(dayKeys) {
  const keySet = new Set(dayKeys);
  return (db.expenses || [])
    .filter(e => keySet.has(String(e.date || "").slice(0, 10)))
    .reduce((s, e) => s + Number(e.amount || 0), 0);
}

function getPurchaseCosts(dayKeys) {
  let total = 0;
  for (const dayKey of dayKeys) {
    if (db.purchaseOverrides && db.purchaseOverrides[dayKey] != null) {
      total += Number(db.purchaseOverrides[dayKey]);
    } else {
      total += (db.purchases || [])
        .filter(p => String(p.date || "").slice(0, 10) === dayKey)
        .reduce((s, p) => s + (Number(p.price) > 0 ? Number(p.qty || 0) * Number(p.price) : 0), 0);
    }
  }
  return total;
}

app.get("/reports/day-details", requireAuth, requireBossOrManager, (req, res) => {
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
  totals.purchases = getPurchaseCosts([dayKey]);
  totals.expenses = getExpensesCosts([dayKey]);
  totals.guthabenRevenue = sales.filter(s => s.paymentMethod === "guthabenTopup").reduce((sum, s) => sum + Number(s.total||0), 0);
  totals.cashRevenue = sales.filter(s => s.isCash && !s.cashTransferred).reduce((sum, s) => sum + Number(s.total||0) + Number(s.tip||0), 0);
  totals.profit = totals.revenue - totals.purchases - totals.expenses;

  const byEmployeeMap = {};
  for (const s of sales) {
    const empKey = String(s.employeeUsername || s.employee || "—");
    if (!byEmployeeMap[empKey]) byEmployeeMap[empKey] = { employeeUsername: empKey, employee: s.employee || empKey, revenue: 0, tips: 0, orders: 0, avg: 0, cashRevenue: 0 };
    byEmployeeMap[empKey].revenue += Number(s.total || 0);
    byEmployeeMap[empKey].tips += Number(s.tip || 0);
    byEmployeeMap[empKey].orders += 1;
    if (s.isCash && !s.cashTransferred) byEmployeeMap[empKey].cashRevenue += Number(s.total || 0) + Number(s.tip || 0);
    if (s.isCash && !s.cashTransferred) byEmployeeMap[empKey].hasPendingCash = true;
  }
  const byEmployee = Object.values(byEmployeeMap).map(x => ({ ...x, avg: x.orders > 0 ? x.revenue / x.orders : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  sales.sort((a, b) => String(a.time).localeCompare(String(b.time)));

  const dayExpenses = (db.expenses || []).filter(e => String(e.date||"").slice(0,10) === dayKey)
    .sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  res.json({
    success: true,
    day: dayKey,
    closed: db.closedDays ? (db.closedDays[dayKey] || null) : null,
    totals,
    byEmployee,
    sales,
    expenses: dayExpenses
  });
});

// ===== FIRMENAUSGABEN =====
app.get("/expenses", requireAuth, requireBossOrManager, (req, res) => {
  const date = String(req.query?.date || "");
  let list = db.expenses || [];
  if(date) list = list.filter(e => String(e.date||"").slice(0,10) === date);
  list = list.slice().sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ success: true, expenses: list });
});

app.post("/expenses", requireAuth, requireBossOrManager, (req, res) => {
  const category = String(req.body?.category || "").trim();
  const note     = String(req.body?.note || "").trim();
  const amount   = Number(req.body?.amount);
  const date     = String(req.body?.date || getDayKeyLocal(new Date())).slice(0,10);
  if(!category || !amount || amount <= 0) return res.status(400).json({ success:false, message:"Kategorie und Betrag erforderlich." });
  const entry = {
    id: makeToken().slice(0,12),
    category, note, amount, date,
    createdAt: new Date().toISOString(),
    createdBy: req.user.displayName || req.user.username
  };
  if(!Array.isArray(db.expenses)) db.expenses = [];
  db.expenses.push(entry);

  // Firmenausgabe → vom Kontostand abziehen
  adjustBankBalance(-amount, `Firmenausgabe: ${category}${note ? ' – ' + note : ''}`);

  saveDB(db);
  res.json({ success: true, entry });
});

app.delete("/expenses/:id", requireAuth, requireBossOrManager, (req, res) => {
  const id = String(req.params.id || "");
  const before = (db.expenses||[]).length;
  db.expenses = (db.expenses||[]).filter(e => e.id !== id);
  if(db.expenses.length === before) return res.status(404).json({ success:false, message:"Nicht gefunden." });
  saveDB(db);
  res.json({ success: true });
});

app.put("/reports/purchases-override", requireAuth, requireBoss, (req, res) => {
  const date   = String(req.body?.date || "").slice(0,10);
  const amount = Number(req.body?.amount);
  if(!date) return res.status(400).json({ success:false, message:"Datum fehlt." });
  if(!Number.isFinite(amount) || amount < 0) return res.status(400).json({ success:false, message:"Ungültiger Betrag." });
  if(!db.purchaseOverrides) db.purchaseOverrides = {};
  const old = db.purchaseOverrides[date] ?? getPurchaseCosts([date]);
  const diff = amount - old;
  db.purchaseOverrides[date] = Math.round(amount * 100) / 100;
  if(diff !== 0) adjustBankBalance(-diff, `Einkaufskosten korrigiert (${date})`);
  saveDB(db);
  res.json({ success:true, amount: db.purchaseOverrides[date] });
});

// Week report by employee (Calendar Week)
// GET /reports/week-employee?week=YYYY-Www
app.get("/reports/week-employee", requireAuth, (req, res) => {
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
  totals.purchases = getPurchaseCosts(dayKeys);
  totals.expenses = getExpensesCosts(dayKeys);
  totals.profit = totals.revenue - totals.purchases - totals.expenses;

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

  // collect all day keys in this month for purchase cost lookup
  const monthDayKeys = [];
  for(let d = new Date(start); d <= end; d = addDays(d, 1)){
    monthDayKeys.push(getDayKeyLocal(d));
  }
  totals.purchases = getPurchaseCosts(monthDayKeys);
  totals.expenses = getExpensesCosts(monthDayKeys);
  totals.profit = totals.revenue - totals.purchases - totals.expenses;

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


// SSE stream for carts (auth required if middleware exists)
app.get("/events/carts", (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if(res.flushHeaders) res.flushHeaders();

  cartsClients.add(res);
  try{ res.write("data: " + JSON.stringify({ rev: cartsRev, carts: cartsState }) + "\n\n"); }catch(e){}

  req.on("close", () => {
    try{ cartsClients.delete(res); }catch(e){}
  });
});

app.get("/carts", (req, res) => {
  res.json({ success: true, rev: cartsRev, carts: cartsState });
});

app.put("/carts", (req, res) => {
  try{
    const incoming = req.body && req.body.carts;
    cartsState = normalizeCarts(incoming);
    cartsRev = (Number(cartsRev)||0) + 1;
    persistCartsToDb();
    broadcastCarts();
    res.json({ success: true, rev: cartsRev });
  }catch(e){
    res.status(400).json({ success: false, message: "Bad carts payload" });
  }
});


// Presence stream (SSE)
app.get("/events/presence", (req, res) => {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if(res.flushHeaders) res.flushHeaders();

  presenceClients.add(res);
  try{ res.write("data: " + JSON.stringify({ presence: presenceState, online: onlineUsers, ts: Date.now() }) + "\n\n"); }catch(e){}

  req.on("close", () => {
    try{ presenceClients.delete(res); }catch(e){}
  });
});

// Presence ping (soft lock helper)
app.post("/presence", (req, res) => {
  try{
    const register = String((req.body && req.body.register) || "");
    const username = String((req.body && req.body.username) || "").trim();
    const name = String((req.body && req.body.name) || username).trim() || username;
        // Move user: remove from any other register first
    for(const k of ["1","2","3","4"]){
      try{ if(presenceState[k]?.users && presenceState[k].users[username]) delete presenceState[k].users[username]; }catch(e){}
    }
if(!["1","2","3","4"].includes(register) || !username){
      return res.status(400).json({ success:false, message:"Bad payload" });
    }
    if(!presenceState[register]) presenceState[register] = { users:{} };
    if(!presenceState[register].users) presenceState[register].users = {};
    presenceState[register].users[username] = { name, at: Date.now() };
    broadcastPresence();
    return res.json({ success:true });
  }catch(e){
    return res.status(400).json({ success:false });
  }
});


// Heartbeat — nur online melden, keine Kasse nötig
app.post("/presence/heartbeat", requireAuth, (req, res) => {
  try{
    const username = String(req.user?.username || req.body?.username || "").trim();
    const name = String(req.body?.name || req.user?.displayName || username).trim() || username;
    if(!username) return res.status(400).json({ success:false });
    const now = Date.now();
    onlineUsers[username] = { name, at: now };
    // Persist lastSeen in db.users
    const dbUser = db.users.find(u => u.username === username);
    if(dbUser){ dbUser.lastSeen = new Date(now).toISOString(); scheduleLastSeenSave(); }
    broadcastPresence();
    return res.json({ success:true });
  }catch(e){ return res.status(400).json({ success:false }); }
});

// Presence leave (remove user immediately)
app.post("/presence/leave", (req, res) => {
  try{
    const username = String(((req.query && (req.query.u || req.query.username)) || (req.body && req.body.username) || "")).trim();
    if(!username) return res.status(400).json({ success:false, message:"Bad payload" });
    let changed = false;
    for(const k of ["1","2","3","4"]){
      try{
        if(presenceState[k] && presenceState[k].users && presenceState[k].users[username]){
          delete presenceState[k].users[username];
          changed = true;
        }
      }catch(e){}
    }
    if(changed) broadcastPresence();
    return res.json({ success:true, changed });
  }catch(e){
    return res.status(400).json({ success:false });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BurgerShot Server läuft auf http://0.0.0.0:${PORT}`);
});
