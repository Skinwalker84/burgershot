/* BurgerShot POS — app.js · Neubau */
"use strict";

// ── Globals ───────────────────────────────────────────────────────────────────
let me = null, serverDay = null;
let PRODUCTS = [], HIDDEN_PRODUCTS = [];
let _specialBurgerWeeklyName = "Special Burger";
const PRODUCTS_CACHE_KEY = "bs_products_v12";

// Carts
let currentRegister = null;
let cartsByRegister = { 1:[], 2:[], 3:[], 4:[], 5:[], 6:[] };
let cart = cartsByRegister[1];
let cartsRev = 0, cartsSaveTimer = null, cartsDirtyByMe = false;

// Reports
let currentDayReport = null, currentWeekReport = null, currentMonthReport = null;
let inventoryItems = [];

// Zutaten cache
let _zutatenCache = null, _zutatenCacheP = null;

// Kitchen timer
let kitchenTimerInterval = null;

// Update detection
let _appVersion = null;
if (!window._updateCheckInterval) {
  window._updateCheckInterval = setInterval(checkForUpdate, 60000);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function escAttr(s) { return esc(s); }
function money(n) { return `$${Number(n||0).toFixed(2)}`; }
function num(n)   { return Number.isFinite(Number(n)) ? String(Number(n)) : "0"; }
function localDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function fmtTs(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const pad = n => String(n).padStart(2,"0");
  return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
}
function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso); if (isNaN(d)) return "—";
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")} Uhr`;
}
function isBoss()          { return me?.role === "boss"; }
function isBossOrManager() { return ["boss","manager"].includes(me?.role); }

function toggleSection(id) {
  const el = document.getElementById(id);
  const arrow = document.getElementById(id + "Arrow");
  if (!el) return;
  el.classList.toggle("hidden");
  if (arrow) arrow.style.transform = el.classList.contains("hidden") ? "" : "rotate(180deg)";
}

// ── Update Detection ──────────────────────────────────────────────────────────
async function checkForUpdate() {
  if (!me) return;
  try {
    const r = await fetch("/version").catch(()=>null);
    if (!r?.ok) return;
    const d = await r.json().catch(()=>({}));
    if (d.version && _appVersion && d.version !== _appVersion) showUpdatePopup();
  } catch(e) {}
}
function showUpdatePopup() {
  if (document.getElementById("updatePopupOv")) return;
  const ov = document.createElement("div");
  ov.id = "updatePopupOv"; ov.className = "overlay"; ov.style.zIndex = "9999";
  ov.innerHTML = `<div class="overlayCard" style="max-width:460px;text-align:center;">
    <div style="font-size:48px;margin-bottom:12px;">🔄</div>
    <div style="font-weight:900;font-size:20px;margin-bottom:10px;">System Update</div>
    <div style="color:var(--muted);line-height:1.6;margin-bottom:20px;">
      Es wurde ein Update eingespielt.<br>Bitte logge dich aus und lade die Seite neu.
    </div>
    <button class="primary" style="min-width:160px;" onclick="doUpdateReload()">🔄 Jetzt neu laden</button>
  </div>`;
  document.body.appendChild(ov);
}
function doUpdateReload() {
  fetch("/auth/logout",{method:"POST"}).catch(()=>{}).finally(()=>location.reload(true));
}

// ── Locked Popup ──────────────────────────────────────────────────────────────
function showLockedPopup(msg) {
  let ov = document.getElementById("lockedPopupOv");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "lockedPopupOv"; ov.className = "overlay"; ov.style.zIndex = "9999";
    ov.innerHTML = `<div class="overlayCard" style="max-width:420px;text-align:center;">
      <div style="font-size:52px;margin-bottom:12px;">🔒</div>
      <div style="font-weight:900;font-size:20px;margin-bottom:12px;color:#ef4444;">Zugang gesperrt</div>
      <div id="lockedPopupMsg" style="color:var(--muted);line-height:1.6;margin-bottom:20px;"></div>
      <button class="primary" onclick="document.getElementById('lockedPopupOv').classList.add('hidden')">OK</button>
    </div>`;
    document.body.appendChild(ov);
  }
  document.getElementById("lockedPopupMsg").innerText = msg;
  ov.classList.remove("hidden");
}

// ── Login / Auth ──────────────────────────────────────────────────────────────
function showLoginPage(msg = "Bitte einloggen.") {
  document.getElementById("loginPage")?.classList.remove("hidden");
  document.getElementById("appRoot")?.classList.add("hidden");
  const m = document.getElementById("loginMsg");
  if (m) {
    if (msg.includes("Inaktivität")) msg = "⏱️ Automatisch ausgeloggt (Inaktivität).";
    m.innerText = msg;
  }
}
function showApp() {
  document.getElementById("loginPage")?.classList.add("hidden");
  document.getElementById("appRoot")?.classList.remove("hidden");
}

async function login() {
  const username = document.getElementById("loginUser")?.value?.trim() || "";
  const password = document.getElementById("loginPass")?.value || "";
  const res = await fetch("/auth/login", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ username, password })
  }).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : await res?.json().catch(()=>({})) || {};
  if (!res?.ok || !data.success) {
    if (data.locked) { showLockedPopup(data.message||"Zugang gesperrt."); return; }
    showLoginPage(data.message || "Login fehlgeschlagen.");
    return;
  }
  me = data.user;
  serverDay = data.currentDay;
  if (data.appVersion) _appVersion = data.appVersion;
  await afterLogin();
}

async function loadMe() {
  const res  = await fetch("/auth/me");
  const data = await res.json().catch(()=>({}));
  if (!res.ok || !data.success || !data.loggedIn) return showLoginPage("Bitte einloggen.");
  me = data.user; serverDay = data.currentDay;
  if (data.appVersion) _appVersion = data.appVersion;
  await afterLogin();
}

async function afterLogin() {
  showApp();
  setupRoleUI();
  await hydrateProducts();
  getZutatenCache();
  fetch("/special-burger-name").then(r=>r.json()).then(d=>{ if(d.name) _specialBurgerWeeklyName = d.name; }).catch(()=>{});
  loadBankBalance();
  startPresenceSSE();
  startCartsSSE();
  await loadCartsFromServer();
  sendPresencePing();
  startHeartbeat();
  openTab("tab_pos");
}

async function logout() {
  await fetch("/auth/logout",{method:"POST"}).catch(()=>{});
  fetch("/presence/leave",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:me?.username||""})}).catch(()=>{});
  me = null; cart = []; cartsByRegister={1:[],2:[],3:[],4:[],5:[],6:[]};
  currentRegister = null;
  if (kitchenTimerInterval) clearInterval(kitchenTimerInterval);
  showLoginPage("Ausgeloggt.");
}

function setupRoleUI() {
  const boss    = document.querySelectorAll(".bossOnly");
  const manager = document.querySelectorAll(".managerOnly");
  boss.forEach(el    => el.style.display = isBoss() ? "" : "none");
  manager.forEach(el => el.style.display = isBossOrManager() ? "" : "none");
  const nameEl = document.getElementById("userDisplayName");
  if (nameEl) nameEl.innerText = me?.displayName || me?.username || "";
  const roleEl = document.getElementById("userRole");
  if (roleEl) roleEl.innerText = me?.role === "boss" ? "Chef" : me?.role === "manager" ? "Manager" : "Mitarbeiter";
}

// ── Products ──────────────────────────────────────────────────────────────────
const REGISTER_NAMES = { 1:"Kasse 1", 2:"Kasse 2", 3:"Kasse 3", 4:"Kasse 4", 5:"Drive-In", 6:"Foodtruck" };

async function hydrateProducts() {
  try {
    const cached = localStorage.getItem(PRODUCTS_CACHE_KEY);
    if (cached) { PRODUCTS = JSON.parse(cached); renderAllCategories(); }
  } catch(e) {}
  try {
    const res  = await fetch("/products");
    const data = await res.json().catch(()=>({}));
    if (!res.ok || !data.success) return;
    PRODUCTS = (data.products||[]).map(p => ({
      id:p.id, name:p.weeklyName||p.name, weeklyName:p.weeklyName||null,
      cat:p.cat, price:Number(p.price)||0, icon:p.icon||null, desc:p.desc||null,
      groupSize:p.groupSize||null, chickenBox:!!p.chickenBox, donutBox:!!p.donutBox,
      germanBox:!!p.germanBox, noSidesBox:!!p.noSidesBox, specialBurgerBox:!!p.specialBurgerBox
    }));
    HIDDEN_PRODUCTS = data.hiddenProducts||[];
    try { localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(PRODUCTS)); } catch(e) {}
    renderAllCategories();
  } catch(e) {}
}

function renderAllCategories() {
  renderCategory("Burger");
  renderCategory("Beilagen");
  renderCategory("Süßes");
  renderCategory("Getränke");
  renderCategory("Menü");
}

function renderCategory(cat) {
  const containerId = {
    "Burger":"catBurger","Beilagen":"catBeilagen","Süßes":"catSuesses",
    "Getränke":"catGetraenke","Menü":"catMenue"
  }[cat];
  const el = document.getElementById(containerId);
  if (!el) return;
  const items = PRODUCTS.filter(p => p.cat === cat);
  el.innerHTML = items.map(p => renderProductBtn(p)).join("");
}

function renderProductBtn(p) {
  const iconHtml = p.icon
    ? `<img src="/icons/${esc(p.icon)}" style="width:44px;height:44px;object-fit:contain;border-radius:6px;" onerror="this.style.display='none'" />`
    : `<div style="font-size:28px;line-height:1;">${catEmoji(p.cat)}</div>`;
  const priceStr = p.price > 0 ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${money(p.price)}</div>` : "";
  return `<div class="productBtn" onclick="addToCart(${JSON.stringify(JSON.stringify(p))})"
    style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 6px;border-radius:10px;
    border:1px solid var(--border);background:var(--card);cursor:pointer;min-width:80px;max-width:100px;
    transition:background .15s;position:relative;" onmouseenter="this.style.background='rgba(255,255,255,.08)'"
    onmouseleave="this.style.background='var(--card)'">
    <div style="position:relative;">
      ${iconHtml}
      ${hasZutaten(p.name||p.weeklyName) ? `<button class="ghost" style="position:absolute;top:-6px;right:-10px;padding:1px 5px;font-size:10px;border-radius:50%;min-width:0;" onclick="event.stopPropagation();showZutatenPopup('${escAttr(p.weeklyName||p.name)}')">ⓘ</button>` : ""}
    </div>
    <div style="font-size:12px;font-weight:700;text-align:center;line-height:1.2;">${esc(p.name)}</div>
    ${priceStr}
  </div>`;
}

function catEmoji(cat) {
  return {Burger:"🍔",Beilagen:"🍟",Süßes:"🍩",Getränke:"🥤",Menü:"📦"}[cat] || "🛒";
}

function hasZutaten(name) {
  if (!_zutatenCache) return false;
  return _zutatenCache.some(z => z.name.toLowerCase() === String(name||"").toLowerCase());
}
function getZutatenCache() {
  if (_zutatenCacheP) return _zutatenCacheP;
  _zutatenCacheP = fetch("/zutaten").then(r=>r.json()).then(d => {
    _zutatenCache = d.zutaten||[];
    return _zutatenCache;
  }).catch(()=>{ _zutatenCache=[]; return []; });
  return _zutatenCacheP;
}
async function showZutatenPopup(name) {
  const cache = await getZutatenCache();
  const entry = cache.find(z => z.name.toLowerCase() === String(name||"").toLowerCase());
  const text  = entry?.zutaten || "Keine Zutaten hinterlegt.";
  let ov = document.getElementById("zutatenPopupOv");
  if (!ov) {
    ov = document.createElement("div"); ov.id="zutatenPopupOv"; ov.className="overlay";
    ov.innerHTML=`<div class="overlayCard" style="max-width:420px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div id="zutatenPopupTitle" style="font-weight:900;font-size:17px;"></div>
        <button class="ghost" onclick="document.getElementById('zutatenPopupOv').classList.add('hidden')">✕</button>
      </div>
      <div id="zutatenPopupText" style="color:var(--muted);line-height:1.7;white-space:pre-wrap;"></div>
    </div>`;
    document.body.appendChild(ov);
  }
  document.getElementById("zutatenPopupTitle").innerText = name;
  document.getElementById("zutatenPopupText").innerText  = text;
  ov.classList.remove("hidden");
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function openTab(tabId) {
  document.querySelectorAll(".tabPage").forEach(t => t.classList.add("hidden"));
  document.querySelectorAll(".iconBtn").forEach(b => b.classList.remove("active"));
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.remove("hidden");
  const btn = document.getElementById(`iconBtn${tabId.replace("tab_","").replace(/_./,m=>m[1].toUpperCase())}`);
  if (btn) btn.classList.add("active");

  if (tabId==="tab_pos")     { renderCart(); }
  if (tabId==="tab_kitchen") { loadKitchen(); startKitchenTimers(); }
  if (tabId==="tab_stock")   { loadInventory(); }
  if (tabId==="tab_shop")    { loadShopTab(); }
  if (tabId==="tab_day")     { loadDayReport(); }
  if (tabId==="tab_week")    { initWeekTab(); }
  if (tabId==="tab_month")   { initMonthTab(); }
  if (tabId==="tab_mgmt")    { loadMgmtTab(); }
  if (tabId==="tab_schicht") { loadSchichtplan(); }
}

// ── Register ──────────────────────────────────────────────────────────────────
function selectRegister(n) {
  const others = getOtherUsersOnRegister(n);
  if (others.length > 0) {
    showRegisterBlockOverlay(n, others);
    return;
  }
  currentRegister = Number(n);
  switchCartToRegister(currentRegister);
  syncActiveRegisterButton(currentRegister);
  closeRegisterBlockOverlay();
  sendPresencePing();
  renderCart();
  const nameEl = document.getElementById("currentRegisterName");
  if (nameEl) nameEl.innerText = REGISTER_NAMES[currentRegister]||"";
}

function switchCartToRegister(n) {
  const key = Number(n)||1;
  if (!cartsByRegister[key]) cartsByRegister[key] = [];
  cart = cartsByRegister[key];
}

function syncActiveRegisterButton(reg) {
  try {
    const myUser = String(me?.username||"").trim();
    document.querySelectorAll(".regBtn").forEach((btn,i) => {
      const k = i + 1;
      btn.classList.remove("active","free","occupied");
      const users = presenceData?.[String(k)]?.users || {};
      const others = Object.keys(users).filter(u=>u!==myUser);
      if (Number(reg)===k) btn.classList.add("active");
      else if (others.length>0) btn.classList.add("occupied");
      else btn.classList.add("free");
    });
  } catch(e) {}
}

function getOtherUsersOnRegister(reg) {
  const myUser = String(me?.username||"").trim();
  const users  = presenceData?.[String(reg)]?.users || {};
  return Object.entries(users).filter(([u])=>u!==myUser).map(([,v])=>v.name||v);
}

// Register block overlay
function showRegisterBlockOverlay(n, others) {
  let ov = document.getElementById("regBlockOv");
  if (!ov) {
    ov = document.createElement("div"); ov.id="regBlockOv"; ov.className="overlay";
    ov.innerHTML=`<div class="overlayCard" style="max-width:400px;text-align:center;">
      <div style="font-size:40px;margin-bottom:12px;">🔒</div>
      <div id="regBlockTitle" style="font-weight:900;font-size:18px;margin-bottom:8px;"></div>
      <div id="regBlockMsg" style="color:var(--muted);margin-bottom:16px;"></div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
        <button class="ghost" onclick="closeRegisterBlockOverlay()">Abbrechen</button>
        <button id="regBlockForceBtn" class="ghost" style="color:#f97316;display:none;" onclick="forceRegister()">🔓 Kasse freigeben</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
  }
  ov._pendingReg = n;
  document.getElementById("regBlockTitle").innerText = `${REGISTER_NAMES[n]||n} ist belegt`;
  document.getElementById("regBlockMsg").innerText = `Belegt von: ${others.join(", ")}`;
  const forceBtn = document.getElementById("regBlockForceBtn");
  if (forceBtn) forceBtn.style.display = isBoss() ? "" : "none";
  ov.classList.remove("hidden");
}
function closeRegisterBlockOverlay() { document.getElementById("regBlockOv")?.classList.add("hidden"); }
async function forceRegister() {
  const ov = document.getElementById("regBlockOv");
  const n  = ov?._pendingReg;
  if (!n) return;
  await fetch("/presence/force-clear",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({register:String(n)})}).catch(()=>{});
  closeRegisterBlockOverlay();
  selectRegister(n);
}

// ── Cart ──────────────────────────────────────────────────────────────────────
function addToCart(pJson) {
  if (!currentRegister) { alert("Bitte zuerst eine Kasse auswählen."); return; }
  const p = typeof pJson === "string" ? JSON.parse(pJson) : pJson;
  if (p.cat === "Menü") { openGroupMenu(p); return; }
  const existing = cart.find(x => x.productId===p.id && !x.components);
  if (existing) existing.qty = (existing.qty||1)+1;
  else cart.push({ name: p.id==="special_burger" ? "Special Burger" : p.name, price:p.price, qty:1, productId:p.id });
  renderCart(); saveCartsDebounced(); sendPresencePing();
}

function removeItem(idx) { cart.splice(idx,1); renderCart(); saveCartsDebounced(); }

function changeQty(idx, delta) {
  if (!cart[idx]) return;
  const newQty = (cart[idx].qty||1) + delta;
  if (newQty <= 0) cart.splice(idx,1);
  else cart[idx].qty = newQty;
  renderCart(); saveCartsDebounced();
}

function clearCart() {
  cartsByRegister[currentRegister] = []; cart = [];
  renderCart(); saveCartsDebounced();
}

function renderCart() {
  const el = document.getElementById("cartItems");
  const total = document.getElementById("cartTotal");
  if (!el) return;
  if (!cart.length) {
    el.innerHTML = `<div class="muted small" style="padding:16px 0;">Warenkorb ist leer</div>`;
    if (total) total.innerText = money(0);
    const btn = document.getElementById("payBtn");
    if (btn) btn.disabled = true;
    return;
  }
  let sum = 0;
  el.innerHTML = cart.map((item,idx) => {
    const lineTotal = (item.price||0) * (item.qty||1);
    sum += lineTotal;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(item.name)}</div>
        <div style="font-size:11px;color:var(--muted);">${money(item.price)} × ${item.qty||1} = ${money(lineTotal)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:4px;margin-left:8px;">
        <button class="ghost" style="padding:2px 8px;font-size:13px;" onclick="changeQty(${idx},-1)">−</button>
        <span style="min-width:20px;text-align:center;font-weight:900;">${item.qty||1}</span>
        <button class="ghost" style="padding:2px 8px;font-size:13px;" onclick="changeQty(${idx},1)">+</button>
        <button class="ghost" style="padding:2px 6px;font-size:12px;color:#ef4444;" onclick="removeItem(${idx})">✕</button>
      </div>
    </div>`;
  }).join("");
  if (total) total.innerText = money(sum);
  const btn = document.getElementById("payBtn");
  if (btn) btn.disabled = false;
}

// ── Group Menu Popup ──────────────────────────────────────────────────────────
let _groupMenuProduct = null;
let _groupSelections  = { burgers:{}, fries:{}, desserts:{}, drinks:{} };

function openGroupMenu(p) {
  if (!currentRegister) { alert("Bitte zuerst eine Kasse auswählen."); return; }
  _groupMenuProduct = p;
  _groupSelections  = { burgers:{}, fries:{}, desserts:{}, drinks:{} };
  const size = p.groupSize || 1;

  document.getElementById("groupMenuTitle").innerText = `${p.name} — ${money(p.price)}`;
  document.getElementById("groupMenuDesc").innerText  = p.desc || "";

  // Reset swap checkbox
  const swapRow = document.getElementById("groupSwapRow");
  const swapCb  = document.getElementById("groupSwapSideForDrink");
  if (swapRow) swapRow.style.display = "none";
  if (swapCb)  swapCb.checked = false;

  const drinks  = PRODUCTS.filter(x => x.cat==="Getränke");

  if (p.specialBurgerBox) {
    _groupSelections.burgers["special_burger"] = size;
    document.getElementById("groupBurgerSection").style.display  = "none";
    document.getElementById("groupFriesSection").style.display   = "";
    document.getElementById("groupDessertSection").style.display = "";
    document.getElementById("groupDessertSection").style.display = "";
    const friesLabel = document.getElementById("groupFriesSection").querySelector("div");
    if (friesLabel) friesLabel.innerHTML = `🍟 Beilage nach Wahl <span class="muted small" id="groupFriesCounter">0 / 0</span>`;
    const sides    = PRODUCTS.filter(x => x.cat==="Beilagen");
    const desserts = PRODUCTS.filter(x => x.cat==="Süßes");
    renderGroupSection("groupFriesList",   sides,    "fries",    size);
    renderGroupSection("groupDessertList", desserts, "desserts", size);
    renderGroupSection("groupDrinkList",   drinks,   "drinks",   size);

  } else if (p.chickenBox) {
    _groupSelections.burgers["chicken"] = size;
    _groupSelections.fries["chicken_nuggets"] = size;
    document.getElementById("groupBurgerSection").style.display  = "none";
    document.getElementById("groupFriesSection").style.display   = "none";
    document.getElementById("groupDessertSection").style.display = "none";
    if (swapRow) swapRow.style.display = "none";
    renderGroupSection("groupDrinkList", drinks, "drinks", size);

  } else if (p.germanBox) {
    _groupSelections.burgers["german"] = size;
    _groupSelections.fries["coleslaw"] = size;
    document.getElementById("groupBurgerSection").style.display  = "none";
    document.getElementById("groupFriesSection").style.display   = "none";
    document.getElementById("groupDessertSection").style.display = "none";
    if (swapRow) swapRow.style.display = "none";
    renderGroupSection("groupDrinkList", drinks, "drinks", size);

  } else if (p.donutBox) {
    _groupSelections.fries["donut"] = size;
    document.getElementById("groupBurgerSection").style.display  = "none";
    document.getElementById("groupFriesSection").style.display   = "none";
    document.getElementById("groupDessertSection").style.display = "none";
    if (swapRow) swapRow.style.display = "none";

  } else if (p.noSidesBox) {
    const burgers = PRODUCTS.filter(x => x.cat==="Burger" && x.id!=="special_burger");
    document.getElementById("groupBurgerSection").style.display  = "";
    document.getElementById("groupFriesSection").style.display   = "none";
    document.getElementById("groupDessertSection").style.display = "none";
    if (swapRow) swapRow.style.display = "none";
    _groupSelections.fries = { "__none": 0 };
    renderGroupSection("groupBurgerList", burgers, "burgers", size);
    renderGroupSection("groupDrinkList",  drinks,  "drinks",  size);

  } else {
    // Regular menu
    const burgers = PRODUCTS.filter(x => x.cat==="Burger" && x.id!=="special_burger");
    const fries   = PRODUCTS.filter(x => x.cat==="Beilagen" || (x.cat==="Süßes" && x.name?.toLowerCase().includes("sundae")));
    document.getElementById("groupBurgerSection").style.display  = "";
    document.getElementById("groupFriesSection").style.display   = "";
    document.getElementById("groupDessertSection").style.display = "none";
    if (swapRow) swapRow.style.display = "";
    renderGroupSection("groupBurgerList", burgers, "burgers", size);
    renderGroupSection("groupFriesList",  fries,   "fries",   size);
    renderGroupSection("groupDrinkList",  drinks,  "drinks",  size);
  }

  updateGroupCounters(size);
  document.getElementById("groupMenuMsg").innerText = "";
  document.getElementById("groupMenuConfirmBtn").disabled = true;
  document.getElementById("groupMenuOverlay").classList.remove("hidden");
}

function renderGroupSection(containerId, items, key, size) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items.map(p => {
    const qty = _groupSelections[key]?.[p.id] || 0;
    return `<div style="display:flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:8px;padding:6px 10px;background:var(--card);">
      <div style="flex:1;font-size:13px;font-weight:700;">${esc(p.name)}</div>
      <button class="ghost" style="padding:2px 8px;" onclick="groupAdjust('${key}','${p.id}',${size},-1)">−</button>
      <span id="gqty_${key}_${p.id}" style="min-width:20px;text-align:center;font-weight:900;">${qty}</span>
      <button class="ghost" style="padding:2px 8px;" onclick="groupAdjust('${key}','${p.id}',${size},1)">+</button>
    </div>`;
  }).join("");
}

function groupAdjust(key, id, size, delta) {
  const isSwapped = document.getElementById("groupSwapSideForDrink")?.checked || false;
  const cap = (key==="drinks" && isSwapped) ? size*2 : size;
  if (!_groupSelections[key]) _groupSelections[key] = {};
  const current = _groupSelections[key][id] || 0;
  const total   = Object.values(_groupSelections[key]).reduce((s,v)=>s+v,0);
  const newVal  = current + delta;
  if (newVal < 0) return;
  if (delta > 0 && total >= cap) return;
  _groupSelections[key][id] = newVal;
  if (!_groupSelections[key][id]) delete _groupSelections[key][id];
  const el = document.getElementById(`gqty_${key}_${id}`);
  if (el) el.innerText = _groupSelections[key][id] || 0;
  updateGroupCounters(size);
}

function toggleSideSwap() {
  const size     = _groupMenuProduct?.groupSize || 1;
  const swapped  = document.getElementById("groupSwapSideForDrink")?.checked || false;
  const drinks   = PRODUCTS.filter(x => x.cat==="Getränke");
  const friesSec = document.getElementById("groupFriesSection");
  if (swapped) {
    if (friesSec) friesSec.style.display = "none";
    _groupSelections.fries   = { "__swapped": 0 };
    _groupSelections.drinks  = {};
    renderGroupSection("groupDrinkList", drinks, "drinks", size*2);
  } else {
    const fries = PRODUCTS.filter(x => x.cat==="Beilagen"||(x.cat==="Süßes"&&x.name?.toLowerCase().includes("sundae")));
    if (friesSec) friesSec.style.display = "";
    _groupSelections.fries  = {};
    _groupSelections.drinks = {};
    renderGroupSection("groupFriesList",  fries,  "fries",  size);
    renderGroupSection("groupDrinkList",  drinks, "drinks", size);
  }
  updateGroupCounters(size);
}

function updateGroupCounters(size) {
  const isSpecialBurger = !!_groupMenuProduct?.specialBurgerBox;
  const isChicken       = !!_groupMenuProduct?.chickenBox || !!_groupMenuProduct?.germanBox;
  const isNoSides       = !!_groupMenuProduct?.noSidesBox;
  const isDonut         = !!_groupMenuProduct?.donutBox;
  const isSwapped       = !isChicken && !isNoSides && !isSpecialBurger &&
                          (document.getElementById("groupSwapSideForDrink")?.checked||false);
  const drinkLimit = isSwapped ? size*2 : size;

  const b   = Object.values(_groupSelections.burgers).reduce((s,v)=>s+v,0);
  const f   = Object.values(_groupSelections.fries).reduce((s,v)=>s+v,0);
  const des = Object.values(_groupSelections.desserts||{}).reduce((s,v)=>s+v,0);
  const d   = Object.values(_groupSelections.drinks).reduce((s,v)=>s+v,0);

  if (!isChicken) {
    const bc = document.getElementById("groupBurgerCounter");
    if (bc) bc.innerText = `${b} / ${size}`;
    if (!isSwapped) { const fc = document.getElementById("groupFriesCounter"); if(fc) fc.innerText = `${f} / ${size}`; }
  }
  const dc = document.getElementById("groupDrinkCounter");
  if (dc) dc.innerText = `${d} / ${drinkLimit}`;
  const desc = document.getElementById("groupDessertCounter");
  if (desc) desc.innerText = `${des} / ${size}`;

  let ok;
  if (isDonut)         ok = true;
  else if (isSpecialBurger) ok = f===size && des===size && d===size;
  else if (isChicken)  ok = d===size;
  else if (isNoSides)  ok = b===size && d===size;
  else if (isSwapped)  ok = b===size && d===size*2;
  else                 ok = b===size && f===size && d===size;

  document.getElementById("groupMenuConfirmBtn").disabled = !ok;
  const msg = document.getElementById("groupMenuMsg");
  if (msg) msg.innerText = ok ? "✅ Auswahl vollständig" : "";
}

function closeGroupMenu() {
  document.getElementById("groupMenuOverlay").classList.add("hidden");
}

function confirmGroupMenu() {
  const p    = _groupMenuProduct;
  const size = p.groupSize || 1;
  if (!p) return;
  const drinkNames = Object.entries(_groupSelections.drinks).filter(([,q])=>q>0)
    .map(([id,q])=>{ const pr=PRODUCTS.find(x=>x.id===id); return (q>1?`${q}× `:"")+( pr?.name||id); }).join(", ");
  const isSwapped = document.getElementById("groupSwapSideForDrink")?.checked || false;

  let displayName;
  if (p.donutBox) {
    displayName = p.name;
  } else if (p.specialBurgerBox) {
    const sideNames = Object.entries(_groupSelections.fries).filter(([k,q])=>q>0&&k!=="__swapped")
      .map(([id,q])=>{ const pr=PRODUCTS.find(x=>x.id===id); return (q>1?`${q}× `:"")+( pr?.name||id); }).join(", ");
    const dessertNames = Object.entries(_groupSelections.desserts||{}).filter(([,q])=>q>0)
      .map(([id,q])=>{ const pr=PRODUCTS.find(x=>x.id===id); return (q>1?`${q}× `:"")+( pr?.name||id); }).join(", ");
    displayName = `${p.name} | 🍔 ${size}× ${_specialBurgerWeeklyName} | 🍟 ${sideNames} | 🍩 ${dessertNames} | 🥤 ${drinkNames}`;
  } else if (p.chickenBox) {
    displayName = `${p.name} | 🥤 ${drinkNames}`;
  } else if (p.germanBox) {
    displayName = `${p.name} | 🥤 ${drinkNames}`;
  } else if (p.noSidesBox) {
    const burgerNames = Object.entries(_groupSelections.burgers).filter(([,q])=>q>0)
      .map(([id,q])=>{ const pr=PRODUCTS.find(x=>x.id===id); return (q>1?`${q}× `:"")+( pr?.name||id); }).join(", ");
    displayName = `${p.name} | 🍔 ${burgerNames} | 🥤 ${drinkNames}`;
  } else if (isSwapped) {
    const burgerNames = Object.entries(_groupSelections.burgers).filter(([,q])=>q>0)
      .map(([id,q])=>{ const pr=PRODUCTS.find(x=>x.id===id); return (q>1?`${q}× `:"")+( pr?.name||id); }).join(", ");
    displayName = `${p.name} | 🍔 ${burgerNames} | 🥤 ${drinkNames} (kein Side)`;
  } else {
    const burgerNames = Object.entries(_groupSelections.burgers).filter(([,q])=>q>0)
      .map(([id,q])=>{ const pr=PRODUCTS.find(x=>x.id===id); return (q>1?`${q}× `:"")+( pr?.name||id); }).join(", ");
    const friesNames  = Object.entries(_groupSelections.fries).filter(([k,q])=>q>0&&k!=="__none"&&k!=="__swapped")
      .map(([id,q])=>{ const pr=PRODUCTS.find(x=>x.id===id); return (q>1?`${q}× `:"")+( pr?.name||id); }).join(", ");
    displayName = `${p.name} | 🍔 ${burgerNames} | 🍟 ${friesNames} | 🥤 ${drinkNames}`;
  }

  const components = [];
  for (const [id,qty] of Object.entries(_groupSelections.burgers))  if(qty>0) components.push({productId:id,qty});
  for (const [id,qty] of Object.entries(_groupSelections.fries))    if(qty>0&&id!=="__none"&&id!=="__swapped") components.push({productId:id,qty});
  for (const [id,qty] of Object.entries(_groupSelections.desserts||{})) if(qty>0) components.push({productId:id,qty});
  for (const [id,qty] of Object.entries(_groupSelections.drinks))   if(qty>0) components.push({productId:id,qty});
  if (p.donutBox) components.push({ productId:"donut", qty:size });

  cart.push({ name:displayName, price:p.price, qty:1, productId:p.id, components });
  closeGroupMenu(); renderCart(); saveCartsDebounced(); sendPresencePing();
}

// ── Pay ───────────────────────────────────────────────────────────────────────
let _currentDiscount = 0, _bahamaMamas = false, _littleSeoul = false;

const DISCOUNTS = { lspd:15, lsmd:20, doj:10, taxi:10 };

function openPay() {
  if (!cart.length) return;
  _currentDiscount = 0; _bahamaMamas = false; _littleSeoul = false;
  document.querySelectorAll(".discBtn").forEach(b=>b.classList.remove("active"));
  document.getElementById("bahamaBtn")?.classList.remove("active");
  document.getElementById("seoulBtn")?.classList.remove("active");
  const delivCb = document.getElementById("payIsDelivery");
  if (delivCb) delivCb.checked = false;
  const cashCb = document.getElementById("payIsCash");
  if (cashCb) cashCb.checked = false;
  const tipEl = document.getElementById("payTip");
  if (tipEl) tipEl.value = "";
  updatePayPreview();
  document.getElementById("payOverlay")?.classList.remove("hidden");
}
function closePay() { document.getElementById("payOverlay")?.classList.add("hidden"); }

function setDiscount(pct, btn) {
  if (_currentDiscount === pct) { _currentDiscount=0; btn.classList.remove("active"); }
  else {
    _currentDiscount = pct;
    document.querySelectorAll(".discBtn").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
  }
  updatePayPreview();
}
function toggleBahama(btn) {
  _bahamaMamas = !_bahamaMamas;
  _littleSeoul = false;
  document.getElementById("seoulBtn")?.classList.remove("active");
  btn.classList.toggle("active", _bahamaMamas);
  updatePayPreview();
}
function toggleSeoul(btn) {
  _littleSeoul = !_littleSeoul;
  _bahamaMamas = false;
  document.getElementById("bahamaBtn")?.classList.remove("active");
  btn.classList.toggle("active", _littleSeoul);
  updatePayPreview();
}

const BAHAMA_IDS   = ["heartstopper","chicken","vegan_burger"];
const SEOUL_PRICES = { heartstopper:16, milchshake:10 };

function calcPay() {
  const original = cart.reduce((s,x)=>(s+(x.price||0)*(x.qty||1)),0);
  const delivery = document.getElementById("payIsDelivery")?.checked ? 50 : 0;
  let discAmt=0, bahamaDisc=0, seoulDisc=0;

  if (_currentDiscount>0) discAmt = original * _currentDiscount/100;

  if (_bahamaMamas) {
    for (const item of cart) {
      const pid = item.productId;
      if (Array.isArray(item.components)) {
        for (const c of item.components) {
          if (BAHAMA_IDS.includes(c.productId)) {
            const prod = PRODUCTS.find(p=>p.id===c.productId);
            bahamaDisc += ((prod?.price||0) - 10) * (c.qty||1) * (item.qty||1);
          }
        }
      } else if (BAHAMA_IDS.includes(pid)) {
        const prod = PRODUCTS.find(p=>p.id===pid);
        bahamaDisc += ((prod?.price||0) - 10) * (item.qty||1);
      }
    }
    if (bahamaDisc < 0) bahamaDisc = 0;
  }

  if (_littleSeoul) {
    for (const item of cart) {
      if (SEOUL_PRICES[item.productId]!==undefined) {
        const fixedPrice = SEOUL_PRICES[item.productId];
        const prod = PRODUCTS.find(p=>p.id===item.productId);
        seoulDisc += ((prod?.price||0) - fixedPrice) * (item.qty||1);
      }
    }
    if (seoulDisc < 0) seoulDisc = 0;
  }

  const total = Math.max(0, original - discAmt - bahamaDisc - seoulDisc + delivery);
  return { original, discAmt, bahamaDisc, seoulDisc, delivery, total };
}

function updatePayPreview() {
  const { original, discAmt, bahamaDisc, seoulDisc, delivery, total } = calcPay();
  const el = document.getElementById("payTotal");
  if (el) el.innerText = money(total);
  const disc = document.getElementById("payDiscLine");
  if (disc) {
    const hasDisc = discAmt>0||bahamaDisc>0||seoulDisc>0;
    disc.style.display = hasDisc ? "" : "none";
    disc.innerText = hasDisc ? `Rabatt: −${money(discAmt+bahamaDisc+seoulDisc)}` : "";
  }
  const delLine = document.getElementById("payDelivLine");
  if (delLine) {
    delLine.style.display = delivery>0 ? "" : "none";
    delLine.innerText = delivery>0 ? `Liefergebühr: +${money(delivery)}` : "";
  }
}

async function submitPay(staffOrder=false) {
  if (!cart.length) return;
  const { original, discAmt, bahamaDisc, seoulDisc, delivery, total } = calcPay();
  const tip        = parseFloat(document.getElementById("payTip")?.value||0)||0;
  const isCash     = document.getElementById("payIsCash")?.checked||false;
  const isDelivery = document.getElementById("payIsDelivery")?.checked||false;

  const items = cart.map(item => ({
    name:item.name, price:item.price, qty:item.qty||1,
    productId:item.productId||null, components:item.components||null
  }));

  const payload = {
    register:currentRegister, items, total, paidAmount:total+tip,
    discount:_currentDiscount>0?_currentDiscount:undefined,
    bahamaMamas:_bahamaMamas||undefined, littleSeoul:_littleSeoul||undefined,
    isCash, isDelivery, tip, staffOrder, paymentMethod: isCash?"cash":"card"
  };

  const res  = await fetch("/sale",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if (!res?.ok||!data.success) { alert(data.message||"Fehler beim Buchen."); return; }

  clearCart(); closePay(); loadBankBalance();
}

// ── Kitchen ───────────────────────────────────────────────────────────────────
async function loadKitchen() {
  const res  = await fetch("/kitchen/orders");
  if (res.status===401) return showLoginPage("Bitte einloggen.");
  const data = await res.json().catch(()=>({}));
  if (!res.ok||!data.success) return;
  serverDay = data.currentDay||serverDay;
  const box = document.getElementById("kitchenOrders");
  if (!box) return;
  const orders = (data.pending||[]).sort((a,b)=>(Date.parse(a.time||"")||0)-(Date.parse(b.time||"")||0));
  if (!orders.length) { box.innerHTML=`<div class="muted small" style="padding:16px 0;">Keine offenen Bestellungen.</div>`; return; }
  box.innerHTML = orders.map(o=>{
    const timeStr = o.timeHM||"—";
    const itemList = (o.items||[]).map(it=>`<div style="font-size:12px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,.05);">
      <span style="font-weight:700;">${it.qty||1}×</span> ${esc(it.name)}</div>`).join("");
    return `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;background:var(--card);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-weight:900;">#${o.id} · ${esc(o.employee||"—")}</div>
        <div class="muted small">🕐 ${timeStr} · Kasse ${o.register||"?"}</div>
      </div>
      <div style="margin-bottom:10px;">${itemList}</div>
      <button class="primary" style="width:100%;padding:8px;" onclick="markKitchenDone(${o.id})">✅ Fertig</button>
    </div>`;
  }).join("");
}
async function markKitchenDone(orderId) {
  await fetch("/kitchen/done",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId})}).catch(()=>{});
  loadKitchen();
}
async function resetKitchen() {
  if (!isBoss()||!confirm("Alle offenen Bestellungen löschen?")) return;
  await fetch("/kitchen/reset",{method:"POST"}).catch(()=>{});
  loadKitchen();
}
function startKitchenTimers() {
  if (kitchenTimerInterval) clearInterval(kitchenTimerInterval);
  kitchenTimerInterval = setInterval(loadKitchen, 10000);
}

// ── Kochen ────────────────────────────────────────────────────────────────────
function updateCookPreview() {
  const inputs = Array.from(document.querySelectorAll("[data-cook-name]"));
  let total = 0;
  for (const inp of inputs) {
    const qty = Number(inp.value)||0;
    const per = Number(inp.getAttribute("data-per-karton"))||1;
    if (qty>0) total += qty/per;
  }
  const el = document.getElementById("cookKartonPreview");
  if (el) el.innerText = `${Math.ceil(total*100)/100} Kartons`;
}
async function submitCooking() {
  const inputs = Array.from(document.querySelectorAll("[data-cook-name]"));
  const items  = inputs.map(inp=>({ name:inp.getAttribute("data-cook-name"), qty:Number(inp.value)||0 })).filter(x=>x.qty>0);
  const msg    = document.getElementById("cookMsg");
  if (!items.length) { if(msg) msg.innerText="Bitte mindestens ein Produkt eintragen."; return; }
  if (msg) msg.innerText="Buche Kochen…";
  const res  = await fetch("/cook",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items})}).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if (!res?.ok||!data.success) { if(msg) msg.innerText=data.message||"Fehler."; return; }
  inputs.forEach(inp=>inp.value=""); updateCookPreview(); loadInventory();
  if(msg) msg.innerText=`✅ ${data.kartonsUsed} Karton${data.kartonsUsed===1?"":"s"} abgezogen. Verbleibend: ${data.remaining}`;
  setTimeout(()=>{ if(msg) msg.innerText=""; },5000);
}

// ── Inventory ─────────────────────────────────────────────────────────────────
async function loadInventory() {
  const res  = await fetch("/inventory");
  const data = await res.json().catch(()=>({}));
  if (!res.ok||!data.success) return;
  inventoryItems = data.items||[];
  renderInventory();
}

function renderInventory() {
  const body   = document.getElementById("inventoryBody");
  const lowBox = document.getElementById("inventoryLowList");
  if (!body) return;

  // Sort: lmk first, then cooked_* sorted by name
  const sorted = [...inventoryItems].sort((a,b) => {
    if (a.id==="lmk") return -1; if (b.id==="lmk") return 1;
    return (a.name||"").localeCompare(b.name||"","de");
  });

  const low = sorted.filter(it=>Number(it.stock)<=Number(it.minStock)&&it.minStock>0);
  if (lowBox) lowBox.innerHTML = low.length
    ? low.map(it=>`• <b>${esc(it.name)}</b> (${num(it.stock)} / ${num(it.minStock)} ${esc(it.unit||"")})`).join("<br>")
    : "Alles ok ✅";

  if (!sorted.length) { body.innerHTML=`<tr><td colspan="5" class="muted small">Keine Artikel.</td></tr>`; return; }

  body.innerHTML = sorted.map(it => {
    const isLow    = Number(it.stock)<=Number(it.minStock)&&it.minStock>0;
    const isKarton = it.id==="lmk";
    const badge    = isKarton
      ? `<span style="font-size:11px;background:rgba(96,165,250,.15);color:#60a5fa;border-radius:4px;padding:1px 6px;margin-left:6px;">📦 Karton</span>`
      : `<span style="font-size:11px;background:rgba(34,197,94,.15);color:#22c55e;border-radius:4px;padding:1px 6px;margin-left:6px;">🍳 gekocht</span>`;
    return `<tr class="${isLow?"lowRow":""}">
      <td><b>${esc(it.name)}</b>${badge}</td>
      <td>${esc(it.unit||"Stk")}</td>
      <td style="text-align:right;font-weight:900;">${num(it.stock)}</td>
      <td style="text-align:right;">${num(it.minStock)}</td>
      <td style="text-align:right;">
        ${isBoss()?`<button class="ghost" onclick="openInventoryEditor('${escAttr(it.id)}')">✏️ Bearbeiten</button>`:""}</td>
    </tr>`;
  }).join("");
}

async function openInventoryEditor(id) {
  if (!isBoss()) return;
  let existing = null;
  if (id) {
    try {
      const r = await fetch("/inventory");
      const d = r.ok ? await r.json().catch(()=>({})) : {};
      if (d.success) { inventoryItems = d.items||[]; existing = inventoryItems.find(x=>x.id===id)||null; }
    } catch(e) { existing = inventoryItems.find(x=>x.id===id)||null; }
  }
  const name = prompt("Artikelname:", existing?.name||"");
  if (name===null) return;
  const unit = prompt("Einheit:", existing?.unit||"Stk");
  if (unit===null) return;

  if (existing) {
    // Delta-based stock edit
    const deltaStr = prompt(`Bestand anpassen für "${existing.name}"\nAktuell: ${existing.stock} ${existing.unit}\n\nDelta eingeben (z.B. +10 oder -5, 0 = keine Änderung):`, "0");
    if (deltaStr===null) return;
    const delta = Number(String(deltaStr).replace(",","."));
    if (delta!==0 && Number.isFinite(delta)) {
      const r = await fetch("/inventory/adjust",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,delta})}).catch(()=>null);
      const d = r?.ok ? await r.json().catch(()=>({})) : {};
      if (!d.success) { alert(d.message||"Fehler."); return; }
    }
  }

  const minStr = prompt("Mindestbestand:", String(existing?.minStock??0));
  if (minStr===null) return;
  const ekStr  = prompt("EK-Preis ($):", String(existing?.ekPrice??0));
  if (ekStr===null) return;

  const res = await fetch("/inventory",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ id:existing?.id||id, name:String(name).trim(), unit:String(unit).trim(),
      minStock:Number(String(minStr).replace(",","."))||0, ekPrice:Number(String(ekStr).replace(",","."))||0 })
  }).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if (!data.success) { alert(data.message||"Fehler."); return; }
  inventoryItems = data.items||inventoryItems;
  renderInventory();
}

// ── Shop / Einkauf ────────────────────────────────────────────────────────────
async function loadShopTab() {
  if (!isBossOrManager()) return;
  const d = document.getElementById("shopDate");
  if (d && !d.value) d.value = localDateStr();
}

async function bookKartonPurchase() {
  if (!isBoss()) return;
  const msg   = document.getElementById("shopMsg");
  const qty   = Number(document.getElementById("shopKartonQty")?.value);
  const price = Number(document.getElementById("shopKartonPrice")?.value)||0;
  const date  = document.getElementById("shopDate")?.value||serverDay;
  if (!qty||qty<=0) { if(msg) msg.innerText="Bitte Anzahl eintragen."; return; }
  const res  = await fetch("/purchases",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:[{inventoryId:"lmk",qty,price:price>0?price:null}],date})}).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if (!res?.ok||!data.success) { if(msg) msg.innerText=data.message||"Fehler."; return; }
  inventoryItems = data.items||inventoryItems;
  document.getElementById("shopKartonQty").value="";
  document.getElementById("shopKartonPrice").value="";
  if(msg) msg.innerText=`✅ ${qty} Karton${qty===1?"":"s"} eingebucht.`;
  loadBankBalance(); loadPurchaseHistory();
  setTimeout(()=>{ if(msg) msg.innerText="—"; },4000);
}

async function loadPurchaseHistory() {
  const dateFilter = document.getElementById("purchaseHistoryDate")?.value||"";
  const res  = await fetch("/purchases");
  const data = await res.json().catch(()=>({}));
  const tbody = document.getElementById("purchaseHistoryBody");
  if (!tbody) return;
  let purchases = data.purchases||[];
  if (dateFilter) purchases = purchases.filter(p=>String(p.date||"").slice(0,10)===dateFilter);
  purchases = purchases.sort((a,b)=>String(b.date||b.createdAt||"").localeCompare(String(a.date||a.createdAt||"")));
  if (!purchases.length) { tbody.innerHTML=`<tr><td colspan="7" class="muted small">Keine Einträge.</td></tr>`; return; }
  tbody.innerHTML = purchases.map(p=>`<tr>
    <td>${esc(String(p.date||"").slice(0,10))}</td>
    <td>${esc(p.name||"Lebensmittelkarton")}</td>
    <td style="text-align:right;">${p.qty}</td>
    <td style="text-align:right;">${p.price>0?money(p.price):"—"}</td>
    <td style="text-align:right;">${p.price>0?money(p.price*p.qty):"—"}</td>
    <td>${esc(p.employee||"—")}</td>
    <td>${isBoss()?`<button class="ghost" style="color:#ef4444;font-size:12px;" onclick="deletePurchase('${escAttr(p.id)}')">🗑️</button>`:"—"}</td>
  </tr>`).join("");
}

async function deletePurchase(id) {
  if (!isBoss()||!confirm("Einkauf stornieren?")) return;
  const res  = await fetch(`/purchases/${id}`,{method:"DELETE"}).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if (!data.success) { alert(data.message||"Fehler."); return; }
  loadPurchaseHistory(); loadInventory(); loadBankBalance();
}

// ── Bank Balance ──────────────────────────────────────────────────────────────
async function loadBankBalance() {
  const res  = await fetch("/bank-balance");
  const data = await res.json().catch(()=>({}));
  if (!res.ok||!data.success) return;
  const els = document.querySelectorAll(".bankBalanceDisplay");
  els.forEach(el=>{ el.innerText=money(data.balance); });
}

// ── Day Report ────────────────────────────────────────────────────────────────
async function loadDayReport() {
  if (!isBossOrManager()) return;
  const dateEl = document.getElementById("dayReportDate");
  if (dateEl && !dateEl.value) dateEl.value = serverDay||localDateStr();
  const date = dateEl?.value||serverDay;
  const res  = await fetch(`/reports/day-details?date=${date}`);
  if (res.status===401) return showLoginPage("Bitte einloggen.");
  const data = await res.json().catch(()=>({}));
  if (!res.ok||!data.success) return;
  currentDayReport = data;
  renderDayReport(data);
}

function renderDayReport(data) {
  const t = data.totals||{};
  const set = (id,v) => { const el=document.getElementById(id); if(el) el.innerText=v; };
  set("dayRevenue",  money(t.revenue||0));
  set("dayTips",     money(t.tips||0));
  set("dayOrders",   String(t.orders||0));
  set("dayPurchases",money(t.purchases||0));
  set("dayExpenses", money(t.expenses||0));
  set("dayProfit",   money(t.profit||0));
  set("dayAvg",      money(t.avg||0));
  set("dayCash",     money(t.cash||0));

  const tbody = document.getElementById("dayByEmployee");
  if (tbody) {
    tbody.innerHTML = (data.byEmployee||[]).map(e=>`<tr>
      <td>${esc(e.employee||e.username||"—")}</td>
      <td style="text-align:right;">${e.orders}</td>
      <td style="text-align:right;font-weight:900;color:#22c55e;">${money(e.revenue)}</td>
      <td style="text-align:right;color:#60a5fa;">${money(e.tips)}</td>
      <td>${isBoss()?`<button class="ghost" style="font-size:12px;" onclick="openOrdersDetail('${escAttr(e.username)}','${escAttr(e.employee||e.username)}')">🔍 Details</button>`:"—"}</td>
    </tr>`).join("");
  }

  const expBody = document.getElementById("dayExpensesBody");
  if (expBody) loadExpenses(data.date);
}

async function loadExpenses(date) {
  const res  = await fetch("/expenses");
  const data = await res.json().catch(()=>({}));
  const tbody = document.getElementById("dayExpensesBody");
  if (!tbody) return;
  const filtered = (data.expenses||[]).filter(e=>String(e.date||e.createdAt||"").slice(0,10)===(date||localDateStr()));
  if (!filtered.length) { tbody.innerHTML=`<tr><td colspan="4" class="muted small">Keine Ausgaben.</td></tr>`; return; }
  tbody.innerHTML = filtered.map(e=>`<tr>
    <td>${esc(e.category)}</td>
    <td>${esc(e.note||"—")}</td>
    <td style="text-align:right;color:#ef4444;">${money(e.amount)}</td>
    <td>${isBossOrManager()?`<button class="ghost" style="color:#ef4444;font-size:12px;" onclick="deleteExpense('${escAttr(e.id)}')">🗑️</button>`:"—"}</td>
  </tr>`).join("");
}

async function addExpense() {
  if (!isBossOrManager()) return;
  const cat  = document.getElementById("expCategory")?.value||"";
  const amt  = parseFloat(document.getElementById("expAmount")?.value||0)||0;
  const note = document.getElementById("expNote")?.value||"";
  const date = document.getElementById("dayReportDate")?.value||localDateStr();
  if (!cat||amt<=0) { alert("Kategorie und Betrag fehlen."); return; }
  const res  = await fetch("/expenses",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({category:cat,amount:amt,note,date})}).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if (!data.success) { alert(data.message||"Fehler."); return; }
  document.getElementById("expCategory").value="";
  document.getElementById("expAmount").value="";
  document.getElementById("expNote").value="";
  loadDayReport(); loadBankBalance();
}

async function deleteExpense(id) {
  if (!confirm("Ausgabe löschen?")) return;
  const res  = await fetch(`/expenses/${id}`,{method:"DELETE"}).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if (!data.success) { alert(data.message||"Fehler."); return; }
  loadDayReport(); loadBankBalance();
}

// Orders Detail
function openOrdersDetail(empUsername, empName) {
  if (!currentDayReport||!isBoss()) return;
  const sales = (currentDayReport.sales||[])
    .filter(s=>(s.employeeUsername||s.employee||"—")===empUsername)
    .sort((a,b)=>String(a.time||"").localeCompare(String(b.time||"")));
  const ov    = document.getElementById("ordersDetailOverlay");
  const title = document.getElementById("ordersDetailTitle");
  const body  = document.getElementById("ordersDetailBody");
  if (!ov||!body) return;
  if (title) title.innerText=`Bestellungen — ${empName||empUsername}`;
  if (!sales.length) { body.innerHTML=`<div class="muted small" style="padding:16px;">Keine Bestellungen.</div>`; }
  else {
    body.innerHTML = sales.map(s=>{
      const d=new Date(s.time); const pad=n=>String(n).padStart(2,"0");
      const timeStr=`${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
      const isStaff = s.staffOrder||s.paymentMethod==="guthaben";
      const typeBadge = isStaff
        ? `<span style="background:rgba(251,191,36,.15);color:#fbbf24;border:1px solid rgba(251,191,36,.3);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:900;">🍽️ Mitarbeiter-Verzehr</span>`
        : `<span style="background:rgba(34,197,94,.12);color:#22c55e;border:1px solid rgba(34,197,94,.25);border-radius:6px;padding:2px 8px;font-size:11px;font-weight:900;">👤 Kunde</span>`;
      const items = (s.items||[]).map(it=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);">
        <span>${esc(it.name)}${it.qty>1?` <span class="muted small">×${it.qty}</span>`:""}</span>
        <span style="color:var(--muted);font-size:12px;">${money(it.price*(it.qty||1))}</span>
      </div>`).join("");
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;background:rgba(255,255,255,.03);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="font-weight:900;font-size:15px;">🕐 ${timeStr}</div>
            ${typeBadge}
          </div>
          <button class="ghost" style="padding:2px 8px;font-size:11px;color:#ef4444;" onclick="deleteSale(${s.id})">🗑️ Löschen</button>
        </div>
        <div style="margin-bottom:8px;">${items}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.1);">
          <span style="font-weight:900;">Total</span>
          <span style="font-weight:900;color:#22c55e;">${money(s.total)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
          <span class="muted small">Trinkgeld</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="color:#60a5fa;">${money(s.tip||0)}</span>
            <button class="ghost" style="padding:2px 7px;font-size:11px;" onclick="editTip(${s.id},${s.tip||0})">✏️</button>
          </div>
        </div>
      </div>`;
    }).join("");
  }
  ov.classList.remove("hidden");
}
function closeOrdersDetail() { document.getElementById("ordersDetailOverlay")?.classList.add("hidden"); }

async function editTip(saleId, currentTip) {
  const val = prompt(`Trinkgeld für #${saleId} korrigieren:`, currentTip);
  if (val===null) return;
  const tip = parseFloat(val); if (!Number.isFinite(tip)||tip<0) return alert("Ungültiger Betrag.");
  const res = await fetch(`/sale/${saleId}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({tip})}).catch(()=>null);
  const data= res?.ok?await res.json().catch(()=>({})):{};
  if (!data.success) return alert(data.message||"Fehler.");
  const sale = (currentDayReport?.sales||[]).find(s=>Number(s.id)===saleId);
  if (sale) sale.tip=tip;
  loadDayReport(); loadBankBalance();
}

async function deleteSale(saleId) {
  if (!confirm(`Bestellung #${saleId} löschen?`)) return;
  const res = await fetch(`/sale/${saleId}`,{method:"DELETE"}).catch(()=>null);
  const data= res?.ok?await res.json().catch(()=>({})):{};
  if (!data.success) return alert(data.message||"Fehler.");
  if (currentDayReport?.sales) currentDayReport.sales=currentDayReport.sales.filter(s=>Number(s.id)!==saleId);
  closeOrdersDetail(); loadDayReport(); loadBankBalance();
}

// ── Week Report ───────────────────────────────────────────────────────────────
function initWeekTab() {
  const el = document.getElementById("weekYW");
  if (el && !el.value) {
    const now = new Date();
    const w   = getISOWeek(now);
    el.value  = `${now.getFullYear()}-W${String(w).padStart(2,"0")}`;
  }
  loadWeekReport();
}
function getISOWeek(d) {
  const dc = new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
  dc.setUTCDate(dc.getUTCDate()+4-(dc.getUTCDay()||7));
  const y = new Date(Date.UTC(dc.getUTCFullYear(),0,1));
  return Math.ceil((((dc-y)/86400000)+1)/7);
}

async function loadWeekReport() {
  const yw = document.getElementById("weekYW")?.value; if(!yw) return;
  const res  = await fetch(`/reports/week-employee?week=${encodeURIComponent(yw)}`);
  if (res.status===401) return showLoginPage("Bitte einloggen.");
  const data = await res.json().catch(()=>({}));
  if (!res.ok||!data.success) return;
  currentWeekReport = data;
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.innerText=v; };
  set("weekRevenue",  money(data.totals?.revenue||0));
  set("weekTips",     money(data.totals?.tips||0));
  set("weekOrders",   String(data.totals?.orders||0));
  set("weekPurchases",money(data.totals?.purchases||0));
  const weekExpEl=document.getElementById("weekExpenses");
  if(weekExpEl) weekExpEl.innerText=(data.totals?.expenses||0)>0?money(data.totals.expenses):"—";
  set("weekProfit",   money(data.totals?.profit||0));

  const tbody=document.getElementById("weekByEmployee");
  if(tbody) tbody.innerHTML=(data.byEmployee||[]).map(e=>`<tr>
    <td>${esc(e.employee||e.employeeUsername||"—")}</td>
    <td style="text-align:right;">${e.orders}</td>
    <td style="text-align:right;font-weight:900;color:#22c55e;">${money(e.revenue)}</td>
    <td style="text-align:right;color:#60a5fa;">${money(e.tips)}</td>
    <td style="text-align:right;color:var(--muted);">${money(e.avg)}</td>
  </tr>`).join("");

  const prodTbody=document.getElementById("weekByProduct");
  if(prodTbody){
    const products=data.byProduct||[];
    if(products.length){
      const totalQty   = products.reduce((s,p)=>s+p.qty,0);
      const totalCrates= products.reduce((s,p)=>s+(p.crates||0),0);
      const totalRev   = products.reduce((s,p)=>s+p.revenue,0);
      prodTbody.innerHTML=products.map(p=>`<tr>
        <td>${esc(p.name)}</td>
        <td style="text-align:right;font-weight:900;">${p.qty}×</td>
        <td style="text-align:right;color:#60a5fa;">${p.crates!=null?p.crates+' 📦':'<span class="muted small">—</span>'}</td>
        <td style="text-align:right;color:#22c55e;">${money(p.revenue)}</td>
      </tr>`).join("")+`<tr style="border-top:2px solid var(--border);font-weight:900;">
        <td>Gesamt</td><td style="text-align:right;">${totalQty}×</td>
        <td style="text-align:right;color:#60a5fa;">${totalCrates} 📦</td>
        <td style="text-align:right;color:#22c55e;">${money(totalRev)}</td>
      </tr>`;
    } else prodTbody.innerHTML=`<tr><td colspan="4" class="muted small">Keine Daten.</td></tr>`;
  }
}

// ── Month Report ──────────────────────────────────────────────────────────────
function initMonthTab() {
  const el = document.getElementById("monthYM");
  if (el && !el.value) {
    const n = new Date();
    el.value = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;
  }
  loadMonthReport();
}
async function loadMonthReport() {
  if (!isBoss()) return;
  const ym=document.getElementById("monthYM")?.value; if(!ym) return;
  const res  = await fetch(`/reports/month-employee?month=${encodeURIComponent(ym)}`);
  if (res.status===401) return showLoginPage("Bitte einloggen.");
  const data = await res.json().catch(()=>({}));
  if (!res.ok||!data.success) return;
  currentMonthReport=data;
  const weeksText=(data.weeks||[]).join(", ")||"—";
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.innerText=v; };
  set("monthPrintYM",ym); set("monthPrintWeeks",weeksText);
  const hint=document.getElementById("monthWeeksHint");
  if(hint) hint.innerText=weeksText?`Enthaltene KW: ${weeksText}`:"";
  set("monthRevenue",  money(data.totals?.revenue||0));
  set("monthPurchases",money(data.totals?.purchases||0));
  const mExp=document.getElementById("monthExpenses");
  if(mExp) mExp.innerText=(data.totals?.expenses||0)>0?money(data.totals.expenses):"—";
  set("monthProfit",   money(data.totals?.profit||0));
  set("monthOrders",   String(data.totals?.orders||0));
  const tbody=document.getElementById("monthByEmployee");
  if(tbody) tbody.innerHTML=(data.byEmployee||[]).map(x=>`<tr>
    <td>${esc(x.employee||x.employeeUsername||"—")}</td>
    <td style="text-align:right;">${x.orders}</td>
    <td style="text-align:right;font-weight:900;color:#22c55e;">${money(x.revenue)}</td>
    <td style="text-align:right;color:#60a5fa;">${money(x.tips)}</td>
    <td style="text-align:right;color:var(--muted);">${money(x.avg)}</td>
  </tr>`).join("");
}

// ── Management ────────────────────────────────────────────────────────────────
function loadMgmtTab() {
  loadUsers(); loadBoard(); if(isBossOrManager()) loadZutaten();
}

// Users
async function loadUsers() {
  if (!isBossOrManager()) return;
  const res  = await fetch("/users");
  const data = await res.json().catch(()=>({}));
  const tbody = document.getElementById("usersList");
  if (!tbody) return;
  if (!data.success||!data.users?.length) { tbody.innerHTML=`<tr><td colspan="4" class="muted small">Keine Mitarbeiter.</td></tr>`; return; }
  const today = new Date().toISOString().slice(0,10);
  tbody.innerHTML = data.users.map(u=>{
    const isOnline = onlineData?.[u.username];
    let lastSeenStr = "Noch nie aktiv";
    if (isOnline) lastSeenStr="🟢 Gerade online";
    else if (u.lastSeen) lastSeenStr=fmtTs(u.lastSeen);
    const firstStr = u.firstLoginToday ? fmtTs(u.firstLoginToday) : "Heute noch nicht eingeloggt";
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <b>${esc(u.displayName)}</b>
          ${u.locked?'<span style="font-size:10px;background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);border-radius:4px;padding:1px 6px;">🔒 Gesperrt</span>':""}
        </div>
        <div class="muted small">${esc(u.username)}</div>
      </td>
      <td><span style="font-size:12px;background:rgba(255,255,255,.07);border-radius:4px;padding:2px 8px;">${esc(u.role)}</span></td>
      <td class="muted small">
        <div>Zuletzt: ${lastSeenStr}</div>
        <div>Heute: ${firstStr}</div>
      </td>
      <td style="text-align:right;">
        ${isBoss()?`<div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">
          <button class="ghost" onclick="openEditUser('${escAttr(u.username)}','${escAttr(u.displayName)}','${escAttr(u.role)}')">✏️</button>
          ${u.role!=="boss"?`
            <button class="ghost" style="color:${u.locked?"#22c55e":"#f97316"};border-color:${u.locked?"#22c55e":"#f97316"};" onclick="toggleUserLock('${escAttr(u.username)}','${escAttr(u.displayName)}',${u.locked})">
              ${u.locked?"🔓 Entsperren":"🔒 Sperren"}</button>
            <button class="ghost" style="color:#ef4444;" onclick="delUser('${escAttr(u.username)}')">Löschen</button>`:""}
        </div>`:"—"}
      </td>
    </tr>`;
  }).join("");
}

function openEditUser(username, displayName, role) {
  const ov = document.getElementById("editUserOverlay");
  if (!ov) return;
  document.getElementById("editUserUsername").value    = username;
  document.getElementById("editUserName").value        = displayName;
  document.getElementById("editUserRole").value        = role;
  document.getElementById("editUserPassword").value    = "";
  ov.classList.remove("hidden");
}
function closeEditUser() { document.getElementById("editUserOverlay")?.classList.add("hidden"); }

async function saveEditUser() {
  const username = document.getElementById("editUserUsername")?.value||"";
  const name     = document.getElementById("editUserName")?.value||"";
  const role     = document.getElementById("editUserRole")?.value||"staff";
  const password = document.getElementById("editUserPassword")?.value||"";
  const body     = { displayName:name, role };
  if (password) body.password = password;
  const res  = await fetch(`/users/${encodeURIComponent(username)}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if (!data.success) { alert(data.message||"Fehler."); return; }
  closeEditUser(); loadUsers();
}

async function addUser() {
  const username = prompt("Username (z.B. max.mustermann):");
  if (!username) return;
  const displayName = prompt("Anzeigename:");
  if (!displayName) return;
  const password = prompt("Passwort (mind. 3 Zeichen):");
  if (!password||password.length<3) return;
  const role = prompt("Rolle (boss/manager/staff):")||"staff";
  const res  = await fetch("/users",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,displayName,password,role})}).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if (!data.success) { alert(data.message||"Fehler."); return; }
  loadUsers();
}

async function delUser(username) {
  if (!confirm(`${username} löschen?`)) return;
  const res  = await fetch(`/users/${encodeURIComponent(username)}`,{method:"DELETE"}).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if (!data.success) alert(data.message||"Fehler.");
  loadUsers();
}

async function toggleUserLock(username, displayName, isLocked) {
  if (!confirm(`${displayName} ${isLocked?"entsperren":"sperren"}?`)) return;
  const res  = await fetch(`/users/${encodeURIComponent(username)}/lock`,{method:"POST"}).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if (!data.success) alert(data.message||"Fehler.");
  loadUsers();
}

// Board
async function loadBoard() {
  const res  = await fetch("/board");
  const data = await res.json().catch(()=>({}));
  const el   = document.getElementById("boardList");
  if (!el) return;
  const entries = data.board||[];
  if (!entries.length) { el.innerHTML=`<div class="muted small">Keine Einträge.</div>`; return; }
  el.innerHTML = entries.map(e=>{
    const catColors = { info:"#60a5fa", warning:"#fbbf24", urgent:"#ef4444" };
    const c = catColors[e.category]||"#60a5fa";
    return `<div style="border-left:3px solid ${c};padding:10px 14px;background:var(--card);border-radius:6px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="font-size:13px;line-height:1.6;white-space:pre-wrap;">${esc(e.text)}</div>
        ${isBossOrManager()?`<button class="ghost" style="color:#ef4444;font-size:11px;padding:2px 6px;flex-shrink:0;" onclick="deleteBoard('${escAttr(e.id)}')">✕</button>`:""}
      </div>
      <div class="muted small" style="margin-top:4px;">${esc(e.author||"—")} · ${fmtTs(e.createdAt)}</div>
    </div>`;
  }).join("");
}

async function postBoard() {
  const text = document.getElementById("boardText")?.value?.trim();
  const cat  = document.getElementById("boardCat")?.value||"info";
  if (!text) return;
  const res  = await fetch("/board",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,category:cat})}).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if (!data.success) return;
  document.getElementById("boardText").value=""; loadBoard();
}

async function deleteBoard(id) {
  await fetch(`/board/${id}`,{method:"DELETE"}).catch(()=>{});
  loadBoard();
}

// Zutaten
async function loadZutaten() {
  const res  = await fetch("/zutaten");
  const data = await res.json().catch(()=>({}));
  const el   = document.getElementById("zutatenList");
  if (!el) return;
  const list = data.zutaten||[];
  if (!list.length) { el.innerHTML=`<div class="muted small">Keine Einträge.</div>`; return; }
  el.innerHTML = list.map(z=>`<div style="border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:8px;background:var(--card);">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
      <div>
        <div style="font-weight:900;margin-bottom:4px;">${esc(z.name)}</div>
        <div class="muted small" style="white-space:pre-wrap;">${esc(z.zutaten||"—")}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="ghost" style="font-size:12px;" onclick="editZutat('${escAttr(z.id)}','${escAttr(z.name)}',${JSON.stringify(JSON.stringify(z.zutaten||''))})">✏️</button>
        <button class="ghost" style="color:#ef4444;font-size:12px;" onclick="deleteZutat('${escAttr(z.id)}')">🗑️</button>
      </div>
    </div>
  </div>`).join("");
}

async function saveZutat() {
  const name    = document.getElementById("zName")?.value?.trim();
  const zutaten = document.getElementById("zText")?.value||"";
  if (!name) return;
  const res  = await fetch("/zutaten",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,zutaten})}).catch(()=>null);
  const data = res?.ok?await res.json().catch(()=>({})):{};
  if (!data.success) { alert(data.message||"Fehler."); return; }
  document.getElementById("zName").value=""; document.getElementById("zText").value="";
  _zutatenCache=null; _zutatenCacheP=null; loadZutaten(); getZutatenCache().then(()=>renderAllCategories());
}

async function editZutat(id, name, zutatenJson) {
  const zutaten = JSON.parse(zutatenJson);
  const newText = prompt(`Zutaten für "${name}":`, zutaten);
  if (newText===null) return;
  await fetch(`/zutaten/${id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,zutaten:newText})}).catch(()=>{});
  _zutatenCache=null; _zutatenCacheP=null; loadZutaten(); getZutatenCache().then(()=>renderAllCategories());
}

async function deleteZutat(id) {
  if (!confirm("Zutaten-Eintrag löschen?")) return;
  await fetch(`/zutaten/${id}`,{method:"DELETE"}).catch(()=>{});
  _zutatenCache=null; _zutatenCacheP=null; loadZutaten(); getZutatenCache().then(()=>renderAllCategories());
}

// Tagesabschluss
async function openCloseDay() {
  const date = document.getElementById("dayReportDate")?.value||localDateStr();
  const cash  = prompt(`Tagesabschluss für ${date}.\nWieviel Bar liegt in der Kasse? (leer = kein Bar-Buchen)`,"");
  if (cash===null) return;
  const body = { date };
  if (cash.trim()!=="") body.cashCount = parseFloat(cash)||0;
  const res  = await fetch("/reports/close-day",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).catch(()=>null);
  const data = res?.ok?await res.json().catch(()=>({})):{};
  if (!data.success&&res?.status!==409) { alert(data.message||"Fehler."); return; }
  alert("Tagesabschluss durchgeführt. Alle Mitarbeiter wurden ausgeloggt.");
  loadDayReport(); loadBankBalance();
}

// Schichtplan
async function loadSchichtplan() {
  const dateEl = document.getElementById("schichtDate");
  if (dateEl && !dateEl.value) dateEl.value = localDateStr();
  const date = dateEl?.value||localDateStr();

  const [usersRes, dayRes] = await Promise.all([
    fetch("/users"), fetch(`/reports/employee-totals?date=${date}`)
  ]);
  const usersData = await usersRes.json().catch(()=>({}));
  const dayData   = await dayRes.json().catch(()=>({}));
  const byEmp     = dayData.byEmployee||{};
  const today     = localDateStr();

  const tbody = document.getElementById("schichtBody");
  if (!tbody) return;
  const users = (usersData.users||[]).filter(u=>u.role!=="boss"||isBoss());
  if (!users.length) { tbody.innerHTML=`<tr><td colspan="6" class="muted small">Keine Mitarbeiter.</td></tr>`; return; }

  tbody.innerHTML = users.map(u=>{
    const isOnline = onlineData?.[u.username];
    const lastSeenRaw = u.lastSeen||null;
    const lastSeen = isOnline ? "ONLINE"
      : (lastSeenRaw&&lastSeenRaw.slice(0,10)===date) ? lastSeenRaw : null;
    const firstLogin = u.firstLoginToday || null;
    const empData    = byEmp[u.username]||null;
    return `<tr>
      <td><b>${esc(u.displayName)}</b><div class="muted small">${esc(u.role)}</div></td>
      <td class="muted small">${date}</td>
      <td class="muted small">${firstLogin?fmtTs(firstLogin):"—"}</td>
      <td>${lastSeen==="ONLINE"?'<span style="color:#22c55e;font-weight:900;font-size:13px;">🟢 Gerade online</span>':lastSeen?`<span style="color:var(--muted);font-size:13px;">${fmtTime(lastSeen)}</span>`:'<span class="muted small">—</span>'}</td>
      <td style="text-align:right;">${empData?.orders||"—"}</td>
      <td style="text-align:right;font-weight:900;color:#22c55e;">${empData?.revenue?money(empData.revenue):"—"}</td>
    </tr>`;
  }).join("");
}

// Product Manager
async function loadProductManager() {
  await hydrateProducts();
  const el = document.getElementById("productManagerBody");
  if (!el) return;
  el.innerHTML = PRODUCTS.map(p=>`<tr>
    <td>${esc(p.name)}</td><td>${esc(p.cat)}</td>
    <td style="text-align:right;">${money(p.price)}</td>
    <td><button class="ghost" style="font-size:12px;" onclick="editProductPrice('${escAttr(p.id)}',${p.price})">✏️ Preis</button></td>
  </tr>`).join("");
}

async function editProductPrice(id, currentPrice) {
  const val = prompt("Neuer Preis ($):", currentPrice);
  if (val===null) return;
  const price = parseFloat(val); if (!Number.isFinite(price)||price<0) return;
  const allProds = PRODUCTS.map(p=>p.id===id?{...p,price}:p);
  const res = await fetch("/products",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({products:allProds,hiddenProducts:HIDDEN_PRODUCTS})}).catch(()=>null);
  if (res?.ok) { try{localStorage.removeItem(PRODUCTS_CACHE_KEY);}catch(e){} await hydrateProducts(); loadProductManager(); }
}

// ── Presence / SSE ────────────────────────────────────────────────────────────
let presenceData = null, onlineData = {}, presenceES = null;

function startPresenceSSE() {
  if (presenceES) presenceES.close();
  presenceES = new EventSource("/events/presence");
  presenceES.onmessage = ev => {
    try {
      const d = JSON.parse(ev.data||"{}");
      presenceData = d.presence || presenceData;
      onlineData   = d.online   || {};
      syncActiveRegisterButton(currentRegister);
    } catch(e) {}
  };
}

async function sendPresencePing() {
  if (!me || !currentRegister) return;
  await fetch("/presence",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({register:String(currentRegister),username:me.username,name:me.displayName||me.username})
  }).catch(()=>{});
}

// Heartbeat
let _heartbeatInterval = null;
function startHeartbeat() {
  if (_heartbeatInterval) clearInterval(_heartbeatInterval);
  sendHeartbeat();
  _heartbeatInterval = setInterval(sendHeartbeat, 15000);
}
async function sendHeartbeat() {
  if (!me) return;
  const res = await fetch("/presence/heartbeat",{method:"POST"}).catch(()=>null);
  if (res?.status===401) {
    clearInterval(_heartbeatInterval);
    showLoginPage("Sitzung abgelaufen.");
  }
}

// ── Carts SSE ─────────────────────────────────────────────────────────────────
function startCartsSSE() {
  try {
    const es = new EventSource("/events/carts");
    es.onmessage = ev => {
      try {
        const d = JSON.parse(ev.data||"{}");
        const rev = Number(d.rev)||0;
        if (rev && rev <= cartsRev) return;
        cartsRev = rev;
        if (cartsDirtyByMe) return;
        cartsByRegister = normalizeCarts(d.carts);
        switchCartToRegister(currentRegister);
        renderCart();
      } catch(e) {}
    };
  } catch(e) {}
}

function normalizeCarts(obj) {
  const out = {1:[],2:[],3:[],4:[],5:[],6:[]};
  for (const k of [1,2,3,4,5,6]) {
    const arr = obj && (obj[k]||obj[String(k)]);
    if (Array.isArray(arr)) {
      out[k] = arr.filter(x=>x&&typeof x==="object").map(x=>({
        name:String(x.name||""), price:Number(x.price)||0, qty:Number(x.qty)||1,
        productId:x.productId||null, components:x.components||null
      }));
    }
  }
  return out;
}

async function loadCartsFromServer() {
  try {
    const res  = await fetch("/carts");
    const data = await res.json().catch(()=>({}));
    if (!res.ok||!data.success) return;
    cartsRev = Number(data.rev)||0;
    if (!cartsDirtyByMe) {
      cartsByRegister = normalizeCarts(data.carts);
      switchCartToRegister(currentRegister);
      renderCart();
    }
  } catch(e) {}
}

function saveCartsDebounced() {
  cartsDirtyByMe = true;
  if (cartsSaveTimer) clearTimeout(cartsSaveTimer);
  cartsSaveTimer = setTimeout(saveCartsToServer, 400);
}

async function saveCartsToServer() {
  if (!cartsDirtyByMe) return;
  cartsDirtyByMe = false;
  try {
    await fetch("/carts",{method:"PUT",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({carts:cartsByRegister,rev:cartsRev})});
  } catch(e) {}
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Set default date inputs
  const today = localDateStr();
  document.querySelectorAll('input[type="date"]').forEach(el => { if (!el.value) el.value=today; });
  loadMe();
});
