/* Burger Shot – App JS */

let currentRegister = 1;
let currentCategory = "Burger";
let me = null;
let serverDay = null;

// Warenkorb pro Kasse
let cartsByRegister = { 1: [], 2: [], 3: [], 4: [] };
let cart = cartsByRegister[currentRegister]; // Alias auf aktuell aktive Kasse

function switchCartToRegister(n){
  const key = Number(n) || 1;
  if(!cartsByRegister[key]) cartsByRegister[key] = [];
  cart = cartsByRegister[key];
}

/* ===== Warenkorb Sync (Local + Server Live) ===== */
const CARTS_STORAGE_KEY = "bs_carts_by_register_v2";
const CLIENT_ID_KEY = "bs_client_id_v1";
let clientId = "";

function getClientId(){
  try{
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if(!id){
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  }catch{
    return "anon";
  }
}

function loadCartsFromStorage(){
  try{
    const raw = localStorage.getItem(CARTS_STORAGE_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    if(parsed && typeof parsed === "object"){
      // keep only 1..4 arrays
      const out = { 1: [], 2: [], 3: [], 4: [] };
      for(const k of [1,2,3,4]){
        if(Array.isArray(parsed[k])) out[k] = parsed[k];
      }
      cartsByRegister = out;
      switchCartToRegister(currentRegister);
    }
  }catch{}
}

function saveCartsToStorage(){
  try{
    localStorage.setItem(CARTS_STORAGE_KEY, JSON.stringify(cartsByRegister));
  }catch{}
}

let cartsSaveTimer = null;
let cartsSse = null;
let lastServerUpdatedAt = "";

async function loadCartsFromServer(){
  try{
    const res = await fetch("/carts");
    const data = await res.json().catch(()=>({}));
    if(res.ok && data.success && data.carts){
      cartsByRegister = data.carts;
      lastServerUpdatedAt = String(data.updatedAt||"");
      switchCartToRegister(currentRegister);
      renderCart();
      saveCartsToStorage();
    }
  }catch{}
}

function scheduleSaveCartsToServer(){
  if(cartsSaveTimer) clearTimeout(cartsSaveTimer);
  cartsSaveTimer = setTimeout(saveCartsToServer, 250);
}

async function saveCartsToServer(){
  cartsSaveTimer = null;
  try{
    await fetch("/carts",{
      method:"PUT",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ carts: cartsByRegister, clientId })
    });
  }catch{}
}

function startCartsLiveSync(){
  try{ if(cartsSse){ cartsSse.close(); cartsSse=null; } }catch{}
  try{
    cartsSse = new EventSource("/carts/stream");
    cartsSse.addEventListener("carts", (ev)=>{
      try{
        const payload = JSON.parse(ev.data||"{}");
        if(!payload || !payload.carts) return;
        // ignore older updates
        const upd = String(payload.updatedAt||"");
        if(lastServerUpdatedAt && upd && upd < lastServerUpdatedAt) return;

        // if this update came from us, we still accept it (server is source of truth)
        cartsByRegister = payload.carts;
        lastServerUpdatedAt = upd || lastServerUpdatedAt;

        // keep current cart pointer valid
        switchCartToRegister(currentRegister);
        renderCart();
        saveCartsToStorage();
      }catch{}
    });

    cartsSse.onerror = ()=>{ /* browser will auto-reconnect */ };
  }catch{}
}

function onCartChanged(){
  saveCartsToStorage();
  scheduleSaveCartsToServer();
}


let currentDayReport = null;
let currentWeekReport = null;
let currentMonthReport = null;
let inventoryItems = [];

let menuBuilderState = null;

let kitchenTimerInterval = null;

function isBoss(){ return me?.role === "boss"; }

function showLoginPage(msg="Bitte einloggen."){
  document.getElementById("loginPage")?.classList.remove("hidden");
  document.getElementById("appRoot")?.classList.add("hidden");
  const m = document.getElementById("loginMsg");
  if(m) m.innerText = msg;
}

function showApp(){
  document.getElementById("loginPage")?.classList.add("hidden");
  document.getElementById("appRoot")?.classList.remove("hidden");
}

function applyRoleVisibility(){
  const show = isBoss();
  // modern tab buttons removed; keep boss-only visibility via top icon buttons
  const ids = ["iconBtnShop","iconBtnDay","iconBtnWeek","iconBtnMonth","iconBtnStock","iconBtnMgmt"];
  ids.forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.style.display = show ? "" : "none";
  });
}

function openTab(tabId, btn){
  if((tabId==="tab_mgmt"||tabId==="tab_day"||tabId==="tab_week"||tabId==="tab_month"||tabId==="tab_stock"||tabId==="tab_shop") && !isBoss()){
    alert("Nur Chef.");
    tabId="tab_pos";
    btn=null;
  }

  document.querySelectorAll(".tabPage").forEach(p=>p.classList.add("hidden"));
  document.getElementById(tabId)?.classList.remove("hidden");

  // legacy tab highlighting (no longer visible)
  document.querySelectorAll(".tabTop").forEach(b=>b.classList.remove("active"));
  btn?.classList?.add("active");

  if(tabId==="tab_kitchen") { loadKitchen(); startKitchenTimers(); }
  else { stopKitchenTimers(); }
  if(tabId==="tab_day") { initDayTab(); loadDayReport(); }
  if(tabId==="tab_week") { initWeekTab(); loadWeekReport(); }
  if(tabId==="tab_month") { initMonthTab(); loadMonthReport(); }
  if(tabId==="tab_stock") { loadInventory(); }
  if(tabId==="tab_shop") { loadShopTab(); }
  if(tabId==="tab_mgmt") {
    // Management: only Mitarbeiter + VK-Preise
    loadUsers();
    mgmtReloadProducts();
  }
}

/* =========================
   EINKAUF TAB (Batch)
   ========================= */

async function loadShopTab(){
  if(!isBoss()) return;
  const d = document.getElementById("shopDate");
  if(d && !d.value) d.value = new Date().toISOString().slice(0,10);

  await ensureInventoryLoadedForPurchase();
  renderShopTable();
}

function renderShopTable(){
  const body = document.getElementById("shopBody");
  const msg = document.getElementById("shopMsg");
  if(msg) msg.innerText = "—";
  if(!body) return;

  if(!Array.isArray(inventoryItems) || inventoryItems.length===0){
    body.innerHTML = `<tr><td colspan="5" class="muted small">Noch keine Lager-Artikel. Lege sie im Lagerbestand an.</td></tr>`;
    return;
  }

  body.innerHTML = inventoryItems.map(it=>{
    const isLow = Number(it.stock) <= Number(it.minStock);
    return `
      <tr class="${isLow ? "lowRow" : ""}">
        <td><b>${esc(it.name)}</b></td>
        <td>${esc(it.unit||"Stk")}</td>
        <td style="text-align:right; font-weight:900;">${num(it.stock)}</td>
        <td style="text-align:right;">${num(it.minStock)}</td>
        <td style="text-align:right;">
          <input class="input shopQty" data-id="${escAttr(it.id)}" type="number" step="0.01" min="0" placeholder="0" style="width:140px; text-align:right;" />
        </td>
      </tr>
    `;
  }).join("");
}

async function bookShopPurchases(){
  if(!isBoss()) return alert("Nur Chef.");
  const msg = document.getElementById("shopMsg");
  const date = document.getElementById("shopDate")?.value || "";

  const inputs = Array.from(document.querySelectorAll(".shopQty"));
  const items = inputs.map(inp=>{
    const id = inp.getAttribute("data-id") || "";
    const qty = Number(inp.value);
    if(!id) return null;
    if(!Number.isFinite(qty) || qty<=0) return null;
    return { inventoryId: id, qty };
  }).filter(Boolean);

  if(items.length===0){
    if(msg) msg.innerText = "Bitte mindestens eine Menge eintragen.";
    return;
  }

  if(msg) msg.innerText = "Buche Einkauf…";
  const payload = { date: date || undefined, items };
  const res = await fetch("/purchases", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  }).catch(()=>null);
  const data = res ? await res.json().catch(()=>({})) : {};
  if(!res || !res.ok || !data.success){
    if(msg) msg.innerText = data.message || "Fehler beim Buchen.";
    return;
  }

  inventoryItems = Array.isArray(data.items) ? data.items : inventoryItems;
  // Clear inputs
  inputs.forEach(i=>{ i.value = ""; });
  renderShopTable();

  // Keep Lager tab in sync if open
  if(!document.getElementById("tab_stock")?.classList.contains("hidden")){
    renderInventory();
  }

  const added = Number(data.added) || items.length;
  if(msg) msg.innerText = `Gebucht ✅ ${added} Position${added===1?"":"en"} ins Lager übernommen.`;
}

/* =========================
   INVENTORY / LAGER
   ========================= */
async function loadInventory(){
  if(!isBoss()) return;
  const body = document.getElementById("inventoryBody");
  if(body) body.innerHTML = `<tr><td colspan="5" class="muted small">Lade…</td></tr>`;

  const res = await fetch("/inventory").catch(()=>null);
  const data = res ? await res.json().catch(()=>({})) : {};
  if(!res || !res.ok || !data.success){
    if(body) body.innerHTML = `<tr><td colspan="5" class="muted small">Fehler beim Laden.</td></tr>`;
    return;
  }
  inventoryItems = Array.isArray(data.items) ? data.items : [];
  renderInventory();
}

/* =========================
   EINKAUF -> LAGER (Chef)
   ========================= */

async function initPurchaseUI(){
  if(!isBoss()) return;
  const d = document.getElementById("purchaseDate");
  if(d && !d.value){
    d.value = new Date().toISOString().slice(0,10);
  }
  await ensureInventoryLoadedForPurchase();
  renderPurchaseSelect();
  await loadPurchases();
}

async function ensureInventoryLoadedForPurchase(){
  if(Array.isArray(inventoryItems) && inventoryItems.length) return;
  const res = await fetch("/inventory").catch(()=>null);
  const data = res ? await res.json().catch(()=>({})) : {};
  if(res && res.ok && data.success){
    inventoryItems = Array.isArray(data.items) ? data.items : [];
  }
}

function renderPurchaseSelect(){
  const sel = document.getElementById("purchaseItem");
  if(!sel) return;
  if(!Array.isArray(inventoryItems) || inventoryItems.length===0){
    sel.innerHTML = `<option value="">(keine Lager-Artikel angelegt)</option>`;
    return;
  }
  const cur = sel.value;
  sel.innerHTML = inventoryItems.map(it=>`<option value="${escAttr(it.id)}">${esc(it.name)} (${num(it.stock)} ${esc(it.unit||"")})</option>`).join("");
  if(cur && inventoryItems.some(x=>x.id===cur)) sel.value = cur;
}

async function loadPurchases(){
  const body = document.getElementById("purchasesBody");
  if(body) body.innerHTML = `<tr><td colspan="5" class="muted small">Lade…</td></tr>`;
  const res = await fetch("/purchases?limit=25").catch(()=>null);
  const data = res ? await res.json().catch(()=>({})) : {};
  if(!res || !res.ok || !data.success){
    if(body) body.innerHTML = `<tr><td colspan="5" class="muted small">Fehler beim Laden.</td></tr>`;
    return;
  }
  const items = Array.isArray(data.items) ? data.items : [];
  renderPurchases(items);
}

function renderPurchases(items){
  const body = document.getElementById("purchasesBody");
  if(!body) return;
  if(!items.length){
    body.innerHTML = `<tr><td colspan="5" class="muted small">Noch keine Einkäufe gebucht.</td></tr>`;
    return;
  }
  body.innerHTML = items.map(p=>{
    const price = (p.price===null || p.price===undefined) ? "—" : num(p.price);
    return `
      <tr>
        <td>${esc(p.date || "")}</td>
        <td><b>${esc(p.name || "")}</b><div class="muted small">${esc(p.unit || "")}</div></td>
        <td style="text-align:right; font-weight:900;">${num(p.qty)}</td>
        <td style="text-align:right;">${price}</td>
        <td>${esc(p.note || "")}</td>
      </tr>
    `;
  }).join("");
}

async function bookPurchase(){
  if(!isBoss()) return alert("Nur Chef.");
  const msg = document.getElementById("purchaseMsg");
  const date = document.getElementById("purchaseDate")?.value || "";
  const inventoryId = document.getElementById("purchaseItem")?.value || "";
  const qty = Number(document.getElementById("purchaseQty")?.value);
  const priceRaw = document.getElementById("purchasePrice")?.value;
  const note = document.getElementById("purchaseNote")?.value || "";

  if(!inventoryId) { if(msg) msg.innerText="Bitte Artikel wählen."; return; }
  if(!Number.isFinite(qty) || qty<=0){ if(msg) msg.innerText="Menge muss > 0 sein."; return; }

  const payload = {
    inventoryId,
    qty,
    date: date || undefined,
    note: note || undefined
  };
  const price = Number(priceRaw);
  if(Number.isFinite(price) && price>=0) payload.price = price;

  if(msg) msg.innerText = "Buche…";
  const res = await fetch("/purchases", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  }).catch(()=>null);
  const data = res ? await res.json().catch(()=>({})) : {};
  if(!res || !res.ok || !data.success){
    if(msg) msg.innerText = data.message || "Fehler beim Buchen.";
    return;
  }

  inventoryItems = Array.isArray(data.items) ? data.items : inventoryItems;
  renderPurchaseSelect();
  // if stock tab is currently visible, refresh table too
  if(!document.getElementById("tab_stock")?.classList.contains("hidden")){
    renderInventory();
  }
  // clear inputs
  const qEl = document.getElementById("purchaseQty");
  const pEl = document.getElementById("purchasePrice");
  const nEl = document.getElementById("purchaseNote");
  if(qEl) qEl.value = "";
  if(pEl) pEl.value = "";
  if(nEl) nEl.value = "";
  if(msg) msg.innerText = "Gebucht ✅ Lagerbestand erhöht.";
  await loadPurchases();
}

function renderInventory(){
  const body = document.getElementById("inventoryBody");
  const lowBox = document.getElementById("inventoryLowList");
  if(!body) return;

  // keep Einkauf-Dropdown in sync (if present)
  try { renderPurchaseSelect(); } catch {}

  if(!Array.isArray(inventoryItems) || inventoryItems.length===0){
    body.innerHTML = `<tr><td colspan="5" class="muted small">Noch keine Artikel. Klicke auf „+ Artikel“.</td></tr>`;
    if(lowBox) lowBox.innerText = "—";
    return;
  }

  const low = inventoryItems.filter(it => Number(it.stock) <= Number(it.minStock));
  if(lowBox){
    lowBox.innerHTML = low.length
      ? low.map(it => `• <b>${esc(it.name)}</b> (${num(it.stock)} / ${num(it.minStock)} ${esc(it.unit||"")})`).join("<br>")
      : "Alles ok ✅";
  }

  body.innerHTML = inventoryItems.map(it=>{
    const isLow = Number(it.stock) <= Number(it.minStock);
    return `
      <tr class="${isLow ? "lowRow" : ""}">
        <td><b>${esc(it.name)}</b><div class="muted small">${it.updatedAt ? esc(new Date(it.updatedAt).toLocaleString('de-DE')) : ""}</div></td>
        <td>${esc(it.unit||"Stk")}</td>
        <td style="text-align:right; font-weight:900;">${num(it.stock)}</td>
        <td style="text-align:right;">${num(it.minStock)}</td>
        <td class="noPrint" style="text-align:right; white-space:nowrap;">
          <button class="ghost" onclick="adjustInventory('${escAttr(it.id)}', -1)">-1</button>
          <button class="ghost" onclick="adjustInventory('${escAttr(it.id)}', 1)">+1</button>
          <button class="ghost" onclick="adjustInventoryPrompt('${escAttr(it.id)}')">±</button>
          <button class="primary" onclick="openInventoryEditor('${escAttr(it.id)}')">Bearbeiten</button>
          <button class="ghost" onclick="deleteInventoryItem('${escAttr(it.id)}')">Löschen</button>
        </td>
      </tr>
    `;
  }).join("");
}

function openInventoryEditor(id){
  if(!isBoss()) return;
  const existing = id ? inventoryItems.find(x=>x.id===id) : null;
  const name = prompt("Artikelname:", existing?.name || "");
  if(name===null) return;
  const unit = prompt("Einheit (z.B. Stk, l, kg):", existing?.unit || "Stk");
  if(unit===null) return;
  const stockStr = prompt("Aktueller Bestand:", String(existing?.stock ?? 0));
  if(stockStr===null) return;
  const minStr = prompt("Mindestbestand (Warnung ab diesem Wert):", String(existing?.minStock ?? 0));
  if(minStr===null) return;

  const stock = Number(String(stockStr).replace(",","."));
  const minStock = Number(String(minStr).replace(",","."));

  saveInventory({
    id: existing?.id,
    name: String(name).trim(),
    unit: String(unit).trim() || "Stk",
    stock: Number.isFinite(stock) ? stock : 0,
    minStock: Number.isFinite(minStock) ? minStock : 0
  });
}

async function saveInventory(item){
  const res = await fetch("/inventory",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(item)
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || !data.success){
    alert(data.message || "Konnte nicht speichern.");
    return;
  }
  inventoryItems = Array.isArray(data.items) ? data.items : [];
  renderInventory();
}

async function adjustInventory(id, delta){
  const res = await fetch("/inventory/adjust",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ id, delta })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || !data.success){
    alert(data.message || "Konnte Bestand nicht ändern.");
    return;
  }
  inventoryItems = Array.isArray(data.items) ? data.items : inventoryItems;
  renderInventory();
}

function adjustInventoryPrompt(id){
  const s = prompt("Bestand ändern (z.B. +12 oder -3):", "+1");
  if(s===null) return;
  const delta = Number(String(s).replace(",","."));
  if(!Number.isFinite(delta) || delta===0) return alert("Ungültiger Wert.");
  adjustInventory(id, delta);
}

async function deleteInventoryItem(id){
  if(!confirm("Artikel wirklich löschen?")) return;
  const res = await fetch(`/inventory/${encodeURIComponent(id)}`,{ method:"DELETE" });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || !data.success){
    alert(data.message || "Konnte nicht löschen.");
    return;
  }
  inventoryItems = Array.isArray(data.items) ? data.items : [];
  renderInventory();
}

function printInventory(){
  window.print();
}

async function login(){
  const username = document.getElementById("loginUser")?.value || "";
  const password = document.getElementById("loginPass")?.value || "";
  const res = await fetch("/auth/login",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return showLoginPage(data.message || "Login fehlgeschlagen.");
  me = data.user;
  serverDay = data.currentDay;
  showApp();
  applyRoleVisibility();
  clientId = getClientId();
  loadCartsFromStorage();
  await loadCartsFromServer();
  startCartsLiveSync();
  await initProducts();
  await loadCartsFromServer().catch(()=>false);
  renderCart();
  saveCartsToStorage();
  scheduleSaveCartsToServer();
  updateDayInfo();
}

async function logout(){
  await fetch("/auth/logout",{ method:"POST" }).catch(()=>{});
  me=null;
  showLoginPage("Ausgeloggt.");
}

async function loadMe(){
  const res = await fetch("/auth/me");
  const data = await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return showLoginPage("Bitte einloggen.");
  serverDay = data.currentDay;
  if(!data.loggedIn) return showLoginPage("Bitte einloggen.");
  me = data.user;
  showApp();
  applyRoleVisibility();
  clientId = getClientId();
  loadCartsFromStorage();
  await loadCartsFromServer();
  startCartsLiveSync();
  await initProducts();
  await loadCartsFromServer().catch(()=>false);
  renderCart();
  saveCartsToStorage();
  scheduleSaveCartsToServer();
  updateDayInfo();
}

function updateDayInfo(){
  const clock = document.getElementById("clockDisplay");
  const screenTitle = document.getElementById("screenTitle");
  const counterTitle = document.getElementById("counterTitle");

  // Vorlage nutzt ein 12h-ähnliches Format ("11:25 AM")
  if(clock){
    clock.innerText = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }
  if(screenTitle) screenTitle.innerText = currentCategory || "—";
  if(counterTitle){
    const short = (me?.displayName || "").trim().split(/\s+/)[0] || "";
    counterTitle.innerText = short ? `Counter ${short}.` : "Counter";
  }
}
setInterval(updateDayInfo, 1000);

function activateRegBtn(btn){
  document.querySelectorAll('.regBtn').forEach(b=>b.classList.remove('active'));
  btn?.classList?.add('active');
}

/* Products */
const PRODUCTS_DEFAULT = [
  { name: "The Bleeder", price: 14, cat: "Burger" },
  { name: "The Heartstopper", price: 16, cat: "Burger" },
  { name: "The Chicken", price: 12, cat: "Burger" },
  { name: "Vegan Burger", price: 10, cat: "Burger" },
  { name: "The Chozzo", price: 12, cat: "Burger" },
  { name: "The German", price: 16, cat: "Burger" },
  { name: "Coleslaw", price: 10, cat: "Beilagen" },
  { name: "Fries", price: 6, cat: "Beilagen" },
  { name: "Cheesy Fries", price: 8, cat: "Beilagen" },
  { name: "Chicken Nuggets", price: 10, cat: "Beilagen" },
  { name: "Onion Rings", price: 6, cat: "Beilagen" },
  { name: "ECola", price: 8, cat: "Getränke" },
  { name: "ECola Light", price: 8, cat: "Getränke" },
  { name: "Sprunk", price: 8, cat: "Getränke" },
  { name: "Sprunk Light", price: 8, cat: "Getränke" },
  // legacy typo kept for compatibility with older saved data
  { name: "Sprung", price: 8, cat: "Getränke" },
  { name: "Blueberry Slush", price: 10, cat: "Getränke" },
  { name: "Strawberry Slush", price: 10, cat: "Getränke" },
  { name: "Choco Milchshake", price: 10, cat: "Getränke" },
  { name: "Vanille Milchshake", price: 10, cat: "Getränke" },
  { name: "Strawberry Milchshake", price: 10, cat: "Getränke" },
  { name: "Glazed Donut", price: 8, cat: "Süßes" },
  { name: "Sprinke Donut", price: 8, cat: "Süßes" },
  { name: "Caramel Sundae", price: 8, cat: "Süßes" },
  { name: "Chocolate Sundae", price: 8, cat: "Süßes" },
  { name: "Strawberry Sundae", price: 8, cat: "Süßes" },
];
let PRODUCTS = [];


function initProducts(){ hydrateProducts(); renderProducts(); }

// bump version so newly added default items (e.g. Light drinks) appear even if older data was cached
const PRODUCTS_STORAGE_KEY = "bs_products_v2";

function loadProductsFromStorage(){
  try{
    const raw = localStorage.getItem(PRODUCTS_STORAGE_KEY);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    if(!Array.isArray(parsed)) return null;
    // validate
    const out = [];
    for(const p of parsed){
      if(!p || typeof p!=="object") continue;
      const name = String(p.name||"").trim();
      const cat = String(p.cat||"").trim();
      const price = Number(p.price);
      if(!name || !cat || !Number.isFinite(price) || price<0) continue;
      out.push({ name, cat, price: Math.round(price) });
    }
    return out.length ? out : null;
  }catch{ return null; }
}

function saveProductsToStorage(list){
  try{
    localStorage.setItem(PRODUCTS_STORAGE_KEY, JSON.stringify(list));
    return true;
  }catch{
    alert("Konnte Preise nicht speichern (LocalStorage).");
    return false;
  }
}

function resetProductsToDefault(){
  localStorage.removeItem(PRODUCTS_STORAGE_KEY);
  PRODUCTS = PRODUCTS_DEFAULT.map(p=>({ ...p }));
  renderProducts();
  renderProductsEditor();
}

async function hydrateProducts(){
  // 1) Server (auth required)
  try{
    const res = await fetch("/products");
    if(res.ok){
      const data = await res.json().catch(()=>({}));
      if(data.success && Array.isArray(data.products) && data.products.length){
        PRODUCTS = data.products.map(p=>({ id:p.id, name:p.name, cat:p.cat, price:Number(p.price)||0 }));
        saveProductsToStorage(PRODUCTS); // keep fallback in sync
        return;
      }
    }
  }catch(e){}

  // 2) LocalStorage fallback
  const stored = loadProductsFromStorage();
  if(stored && Array.isArray(stored) && stored.length){
    PRODUCTS = stored.map(p=>({ ...p, price:Number(p.price)||0 }));
    return;
  }

  // 3) Defaults
  PRODUCTS = PRODUCTS_DEFAULT.map(p=>({ ...p, id: p.id || slugKey(p) }));
}

function renderProductsEditor(){
  const body = document.getElementById("mgmtProductsBody");
  const msg = document.getElementById("mgmtProductsMsg");
  if(!body) return; // panel might not exist
  const list = (PRODUCTS||[]).slice().sort((a,b)=>(a.cat||"").localeCompare(b.cat||"") || (a.name||"").localeCompare(b.name||""));
  body.innerHTML = list.map((p, idx)=>`
    <tr>
      <td>${esc(p.name)}</td>
      <td>${esc(p.cat)}</td>
      <td style="text-align:right;">
        <input class="input" style="width:110px; text-align:right; padding:8px 10px;" data-price-key="${escAttr(slugKey(p))}" value="${escAttr(p.price)}" />
      </td>
    </tr>
  `).join("") || `<tr><td colspan="3" class="muted small">Keine Produkte.</td></tr>`;
  if(msg) msg.innerText = "—";
}

async function mgmtReloadProducts(){
  await hydrateProducts();
  renderProducts();
  renderProductsEditor();
  const msg=document.getElementById("mgmtProductsMsg");
  if(msg) msg.innerText="—";
}

async function mgmtSaveProducts(){
  const msg = document.getElementById("mgmtProductsMsg");

  // collect all edited prices by key
  const inputs = Array.from(document.querySelectorAll("[data-price-key]"));
  const priceMap = new Map();
  for(const el of inputs){
    const key = el.getAttribute("data-price-key");
    const n = parseMoney(el.value);
    if(!Number.isFinite(n) || n<0){
      if(msg) msg.innerText = "Ungültiger Preis.";
      return;
    }
    priceMap.set(key, Math.round(n));
  }

  // apply to PRODUCTS by key
  const list = (PRODUCTS||[]).map(p=>{
    const key = slugKey(p);
    const hit = priceMap.get(key);
    return hit != null ? { ...p, price: hit } : { ...p };
  });

  // server first
  try{
    const payload = list.map(p=>({
      id: p.id || slugKey(p),
      name: p.name,
      cat: p.cat,
      price: p.price
    }));
    const res = await fetch("/products",{
      method:"PUT",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ products: payload })
    });
    const data = await res.json().catch(()=>({}));
    if(res.ok && data.success){
      if(Array.isArray(data.products) && data.products.length){
        PRODUCTS = data.products.map(p=>({ id:p.id, name:p.name, cat:p.cat, price:Number(p.price)||0 }));
      }else{
        PRODUCTS = list;
      }
      saveProductsToStorage(PRODUCTS);
      renderProducts();
      renderProductsEditor();
      if(msg) msg.innerText = "Gespeichert (Server) ✅";
      return;
    }
    throw new Error(data.message||"Fehler");
  }catch(e){
    PRODUCTS = list;
    saveProductsToStorage(PRODUCTS);
    renderProducts();
    renderProductsEditor();
    if(msg) msg.innerText = "Gespeichert (Local) ⚠️";
  }
}

function mgmtResetProducts(){
  const ok = confirm("VK-Preise auf Standard zurücksetzen?");
  if(!ok) return;
  resetProductsToDefault();
  const msg = document.getElementById("mgmtProductsMsg");
  if(msg) msg.innerText = "Zurückgesetzt ✅";
}


function setCategory(cat, btn){
  currentCategory=cat;
  document.querySelectorAll(".catBtn").forEach(b=>b.classList.remove("active"));
  if(btn){
    btn.classList.add("active");
  }else{
    // best-effort: activate matching category button
    const match = Array.from(document.querySelectorAll('.catBtn')).find(b=> (b?.textContent||'').toLowerCase().includes(cat.toLowerCase().slice(0,3)));
    match?.classList?.add('active');
  }
  const title = document.getElementById('screenTitle');
  if(title) title.innerText = cat;
  renderProducts();
}

const PRODUCT_ICON = {
  "The Bleeder": "burgershot_the_bleeder.png",
  "The Heartstopper": "burgershot_heartstopper.png",
  "The Chicken": "burgershot_the_chicken.png",
  "Vegan Burger": "burger_the_vegan.png",
  "The Chozzo": "burgershot_the_chozzo.png",
  "The German": "burgershot_the_german.png",
  "Coleslaw": "coleslaw.png",
  "Fries": "burgershot_fries.png",
  "Cheesy Fries": "burgershot_cheese_fries.png",
  "Chicken Nuggets": "burgershot_nuggets.png",
  "Onion Rings": "burgershot_onion_rings.png",
  "ECola": "ECola.PNG",
  "ECola Light": "ecola_light.png",
  "Sprunk": "sprunk.jpeg",
  "Sprunk Light": "sprunk_light.png",
  // legacy typo
  "Sprung": "sprunk.jpeg",
  "Blueberry Slush": "blueberry_slush.png",
  "Strawberry Slush": "strawberry_slush.png",
  "Choco Milchshake": "choco_milkshake.png",
  "Vanille Milchshake": "vanille_milkshake.png",
  "Strawberry Milchshake": "strawberry_milkshake.png",
  "Glazed Donut": "burgershot_donut.png",
  "Sprinke Donut": "burgershot_donut.png",
  "Caramel Sundae": "burgershot_sunday_caramel.png",
  "Chocolate Sundae": "burgershot_sunday_chocolate.png",
  "Strawberry Sundae": "burgershot_sunday_strawberry.png",
};

function getIconForProduct(p){
  const name = String(p?.name||"");
  const cat = String(p?.cat||p?.category||"");

  // 1) direct mapping
  if(PRODUCT_ICON[name]) return `/icons/${PRODUCT_ICON[name]}`;

  // 2) Menü: reuse burger icons (match by keyword, otherwise default burger)
  if(cat === "Menü"){
    const lower = name.toLowerCase();
    const burgerNames = Object.keys(PRODUCT_ICON).filter(k => {
      const c = (PRODUCTS||[]).find(x => x.name===k)?.cat;
      return c === "Burger";
    });
    // try to match any known burger name inside the menu name
    for(const bn of burgerNames){
      if(lower.includes(bn.toLowerCase())) return `/icons/${PRODUCT_ICON[bn]}`;
    }
    // fallback: any burger icon we have
    const fallback = PRODUCT_ICON["The Bleeder"] || PRODUCT_ICON[burgerNames[0]];
    if(fallback) return `/icons/${fallback}`;
  }

  return "";
}

function renderProducts(){
  const box=document.getElementById("products");
  if(!box) return;
  box.innerHTML="";
  const list = PRODUCTS.filter(p=>p.cat===currentCategory);
  list.forEach(p=>{
    const wrap=document.createElement("div");
    wrap.className="disp";

    const imgWrap=document.createElement("div");
    imgWrap.className="dispImg dispClickable";
    const img=document.createElement("img");
    const src = getIconForProduct(p);
    img.src = src;
    img.alt = p.name;
    if(!src){
      img.style.display='none';
      imgWrap.textContent = p.name;
      imgWrap.style.fontSize='11px';
      imgWrap.style.fontWeight='900';
      imgWrap.style.padding='6px';
      imgWrap.style.textAlign='center';
      imgWrap.style.lineHeight='12px';
    }else{
      imgWrap.appendChild(img);
    }

    // Click on image adds to cart (touch + mouse)
    imgWrap.tabIndex = 0;
    imgWrap.setAttribute('role','button');
    imgWrap.setAttribute('aria-label', `Add ${p.name} to cart`);
    const onPick = (ev)=>{
      // Menüs open the builder (no cart animation until confirmed)
      const isMenu = String(p?.cat||p?.category||"") === "Menü";
      addToCart(p);
      if(isMenu) return;

      // Visual feedback
      const r = imgWrap.getBoundingClientRect();
      const x = (ev && 'clientX' in ev) ? ev.clientX : (r.left + r.width/2);
      const y = (ev && 'clientY' in ev) ? ev.clientY : (r.top + r.height/2);
      popPlusOne(x, y);
      if(src) flyToCart(img, r);
      pulseCart();
    };
    imgWrap.addEventListener('click', onPick);
    imgWrap.addEventListener('keydown', (e)=>{
      if(e.key==='Enter' || e.key===' '){
        e.preventDefault();
        onPick(e);
      }
    });

    const meta=document.createElement('div');
    meta.className='dispMeta';
    const n=document.createElement('div');
    n.className='dispName';
    n.textContent=p.name;
    const pr=document.createElement('div');
    pr.className='dispPrice';
    pr.textContent=money(p.price);
    meta.appendChild(n);
    meta.appendChild(pr);

    wrap.appendChild(imgWrap);
    wrap.appendChild(meta);
    box.appendChild(wrap);
  });
}

// +1 popup near click position
function popPlusOne(x, y){
  try{
    const el=document.createElement('div');
    el.className='plusOne';
    el.textContent = '+1';
    el.style.left = `${Math.round(x)}px`;
    el.style.top  = `${Math.round(y)}px`;
    document.body.appendChild(el);
    requestAnimationFrame(()=> el.classList.add('show'));
    setTimeout(()=>{ try{ el.remove(); }catch{} }, 900);
  }catch{}
}

// Fly product image to the cart
function flyToCart(imgEl, fromRect){
  try{
    const cartEl = document.getElementById('cart');
    if(!cartEl) return;
    const toRect = cartEl.getBoundingClientRect();
    const start = fromRect || imgEl.getBoundingClientRect();

    const clone = imgEl.cloneNode(true);
    clone.className = 'flyImg';
    clone.style.left = `${start.left}px`;
    clone.style.top  = `${start.top}px`;
    clone.style.width  = `${start.width}px`;
    clone.style.height = `${start.height}px`;
    document.body.appendChild(clone);

    const targetX = toRect.left + Math.min(40, toRect.width/2);
    const targetY = toRect.top + 20;
    const dx = targetX - start.left;
    const dy = targetY - start.top;

    requestAnimationFrame(()=>{
      clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.25)`;
      clone.style.opacity = '0.2';
    });

    clone.addEventListener('transitionend', ()=>{ try{ clone.remove(); }catch{} }, { once:true });
    setTimeout(()=>{ try{ clone.remove(); }catch{} }, 800);
  }catch{}
}

function pulseCart(){
  const panel = document.querySelector('.counterPanel');
  if(!panel) return;
  panel.classList.remove('cartPulse');
  void panel.offsetWidth;
  panel.classList.add('cartPulse');
}

/* Cart */
function addToCart(p){
  if(String(p?.cat||p?.category||"")==="Menü"){
    openMenuBuilder(p);
    return;
  }
  cart.push({ name: p.name, price: p.price, qty: 1 });
  renderCart();
  onCartChanged();
  saveCartsToStorage();
  scheduleSaveCartsToServer();
}
function clearCart(){ cartsByRegister[currentRegister]=[]; switchCartToRegister(currentRegister); renderCart(); onCartChanged(); }
function cartTotal(){ return cart.reduce((s,x)=>s+x.price*x.qty,0); }

function renderCart(){
  const box=document.getElementById("cart");
  const tot=document.getElementById("cartTotal");
  if(tot) tot.innerText=money(cartTotal());
  if(!box) return;
  if(cart.length===0){ box.innerHTML=`<div class="cartEmpty">Leer.</div>`; return; }
  box.innerHTML=cart.map((x,idx)=>`
    <div class="cartItem">
      <div class="name">${esc(x.name)}</div>
      <div style="display:flex; gap:8px; align-items:center;">
        <div class="price">${money(x.price)}</div>
        <button class="pushBtn" style="width:26px; height:22px;" onclick="removeItem(${idx})">x</button>
      </div>
    </div>`).join("");
}
function removeItem(idx){ cart.splice(idx,1); renderCart(); onCartChanged(); }

// Mobile UX: collapse/expand cart panel
function toggleCart(){
  const panel = document.querySelector('.counterPanel');
  if(!panel) return;
  panel.classList.toggle('counterCollapsed');
}

/* Register */
function setRegister(n){ currentRegister=Number(n)||1; const d=document.getElementById("registerDisplay"); if(d) d.innerText=`Kasse ${currentRegister}`; switchCartToRegister(currentRegister); renderCart(); onCartChanged(); }`;
  switchCartToRegister(currentRegister);
  renderCart();
  saveCartsToStorage();
  scheduleSaveCartsToServer();
}

/* Pay overlay */

function openMenuBuilder(menuProduct){
  const drinks = (PRODUCTS||[]).filter(x => String(x.cat||x.category||"") === "Getränke");
  if(!drinks.length){
    alert("Keine Getränke vorhanden. Bitte Produkte neu laden.");
    return;
  }
  menuBuilderState = { base:{...menuProduct}, drinks };

  const nameEl=document.getElementById("menuBaseName");
  const priceEl=document.getElementById("menuBasePrice");
  const sel=document.getElementById("menuDrinkSelect");
  const chk=document.getElementById("menuCheesy");

  if(nameEl) nameEl.innerText = menuProduct.name;
  if(priceEl) priceEl.innerText = money(menuProduct.price);

  if(sel){
    sel.innerHTML="";
    drinks.forEach(d=>{
      const opt=document.createElement("option");
      opt.value=d.name;
      opt.textContent = d.name + " (" + money(d.price) + ")";
      sel.appendChild(opt);
    });
  }
  if(chk) chk.checked=false;

  document.getElementById("menuOverlay")?.classList.remove("hidden");
}

function closeMenuBuilder(){
  document.getElementById("menuOverlay")?.classList.add("hidden");
  menuBuilderState=null;
}

function confirmMenuBuilder(){
  if(!menuBuilderState) return;
  const sel=document.getElementById("menuDrinkSelect");
  const chk=document.getElementById("menuCheesy");
  const drinkName = sel?.value || "";
  const cheesy = !!chk?.checked;

  const extra = cheesy ? 2 : 0;
  const friesLabel = cheesy ? "Cheesy Fries (+$2)" : "Fries";

  const base = menuBuilderState.base;
  const finalPrice = Math.round(Number(base.price||0) + extra);

  const displayName = `${base.name} • Drink: ${drinkName} • ${friesLabel}`;

  cart.push({ name: displayName, price: finalPrice, qty:1 });
  closeMenuBuilder();
  renderCart();
  onCartChanged();
  saveCartsToStorage();
  scheduleSaveCartsToServer();
}

function openPay(){
  if(cart.length===0) return alert("Warenkorb ist leer.");
  document.getElementById("payTotal").innerText=money(cartTotal());
  document.getElementById("payAmount").value="";
  document.getElementById("payOverlay").classList.remove("hidden");
}
function closePay(){ document.getElementById("payOverlay").classList.add("hidden"); }
function parseMoney(val){ const s=String(val||"").replace(/[^\d.-]/g,""); const n=Number(s); return Number.isFinite(n)?n:NaN; }

async function submitPay(){
  const total=cartTotal();
  const paid=parseMoney(document.getElementById("payAmount").value);
  if(!Number.isFinite(paid) || paid<total) return alert("Bezahlt muss >= Total sein.");
  const payload={
    register: currentRegister,
    items: cart.map(x=>({ name:x.name, price:x.price, qty:x.qty })),
    total,
    paidAmount: paid,
    time: new Date().toISOString()
  };
  const res=await fetch("/sale",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return alert(data.message || "Fehler beim Speichern.");
  closePay();
  alert(`Order #${data.orderId} gespeichert. Trinkgeld: ${money(data.tip||0)}`);
  cartsByRegister[currentRegister] = [];
  switchCartToRegister(currentRegister);
  renderCart();
  saveCartsToStorage();
  scheduleSaveCartsToServer();
}

function slugify(s){
  return String(s||"")
    .toLowerCase()
    .replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss")
    .replace(/[^a-z0-9]+/g,"_")
    .replace(/^_+|_+$/g,"")
    .slice(0,60) || "item";
}
function slugKey(p){
  return `${slugify(p.cat||p.category||"")}__${slugify(p.name||"")}`;
}

/* Kitchen */

function formatElapsed(sec){
  sec = Math.max(0, Math.floor(sec||0));
  const m = Math.floor(sec/60);
  const s = sec%60;
  return `${m}:${String(s).padStart(2,"0")}`;
}

function stopKitchenTimers(){
  if(kitchenTimerInterval){
    clearInterval(kitchenTimerInterval);
    kitchenTimerInterval = null;
  }
}

function updateKitchenTimers(){
  const now = Date.now();
  document.querySelectorAll(".kCard[data-order-time]").forEach(card=>{
    const iso = card.getAttribute("data-order-time");
    const t = Date.parse(iso||"");
    if(!Number.isFinite(t)) return;
    const elapsedSec = (now - t)/1000;
    const el = card.querySelector(".kElapsed");
    if(el) el.textContent = formatElapsed(elapsedSec);

    card.classList.remove("kWarn","kCrit");
    if(elapsedSec >= 300) card.classList.add("kCrit");
    else if(elapsedSec >= 180) card.classList.add("kWarn");
  });
}

function startKitchenTimers(){
  stopKitchenTimers();
  kitchenTimerInterval = setInterval(updateKitchenTimers, 1000);
  updateKitchenTimers();
}

async function loadKitchen(){
  const res=await fetch("/kitchen/orders");
  if(res.status===401) return showLoginPage("Bitte einloggen.");
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return;
  serverDay=data.currentDay||serverDay;

  const box=document.getElementById("kitchenOrders");
  if(!box) return;
  const orders=(data.pending||[]).slice().sort((a,b)=> (Date.parse(a.time||"")||0) - (Date.parse(b.time||"")||0));
  if(orders.length===0){ box.innerHTML=`<div class="muted small">Keine offenen Bestellungen.</div>`; return; }
  box.innerHTML=orders.map(o=>{
    const items=(o.items||[]).map(i=>`${i.qty||1}× ${i.name}`).join(", ");
    return `
      <div class="kCard" data-order-time="${escAttr(o.time||"")}">
        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div style="font-weight:900;">#${o.id} · Kasse ${o.register}</div>
          <div style="text-align:right;">
            <div class="muted small">${esc(o.timeHM||"")}</div>
            <div class="kElapsed">0:00</div>
          </div>
        </div>
        <div class="muted small">${esc(o.employee||"")}</div>
        <div style="margin-top:8px;">${esc(items)}</div>
        <div class="row" style="margin-top:10px; justify-content:space-between;">
          <div class="muted small">${money(o.total)}</div>
          <button class="primary" onclick="kitchenDone(${o.id})">Fertig</button>
        </div>
      </div>`;
  }).join("");
  updateKitchenTimers();
}

async function kitchenDone(id){
  const res=await fetch("/kitchen/done",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ id }) });
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return alert(data.message || "Fehler.");
  loadKitchen();
}

async function resetKitchen(){
  if(!isBoss()) return alert("Nur Chef.");
  if(!confirm("Küche für heute resetten?")) return;
  const res=await fetch("/kitchen/reset",{ method:"POST" });
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return alert(data.message || "Fehler.");
  loadKitchen();
}

/* Day report (simplified) */
let dayTabInited=false;
function initDayTab(){
  if(dayTabInited) return;
  dayTabInited=true;
  const inp=document.getElementById("dayDate");
  if(inp) inp.value=serverDay||"";
}
function setDayToToday(){
  const inp=document.getElementById("dayDate");
  if(inp) inp.value=serverDay||inp.value;
}
function printDayReport(){
  document.body.classList.remove("printWeek");
  document.body.classList.add("printDay");
  window.print();
  document.body.classList.remove("printDay");
}

async function loadDayReport(){
  if(!isBoss()) return;
  const date=document.getElementById("dayDate")?.value || serverDay;
  if(!date) return;

  const res=await fetch(`/reports/day-details?date=${encodeURIComponent(date)}`);
  if(res.status===401) return showLoginPage("Bitte einloggen.");
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return alert(data.message || "Fehler beim Laden der Tagesabrechnung.");

  currentDayReport=data;
  document.getElementById("dayPrintDate").innerText=date;

  const closed=data.closed;
  const st=document.getElementById("dayCloseStatus");
  const stPrint=document.getElementById("dayPrintClosed");
  const closeBtn=document.getElementById("dayCloseBtn");
  if(closed){
    const txt=`Abgeschlossen: ${fmtDateTime(closed.closedAt)} — ${closed.closedByName||closed.closedBy||""}` +
      (closed.note ? ` — ${closed.note}` : "");
    if(st) st.innerText=txt;
    if(stPrint) stPrint.innerText=txt;
    if(closeBtn) closeBtn.disabled=true;
  }else{
    if(st) st.innerText="Status: Offen";
    if(stPrint) stPrint.innerText="Status: Offen";
    if(closeBtn) closeBtn.disabled=false;
  }

  document.getElementById("dayRevenue").innerText=money(data.totals?.revenue||0);

  const tbody=document.getElementById("dayByEmployee");
  if(tbody){
    tbody.innerHTML=(data.byEmployee||[]).map(x=>`
      <tr>
        <td>${esc(x.employee||x.employeeUsername||"")}</td>
        <td style="text-align:right;">${money(x.revenue||0)}</td>
        <td style="text-align:right;">${money(x.tips||0)}</td>
        <td style="text-align:right;">${x.orders||0}</td>
      </tr>
    `).join("") || `<tr><td colspan="4" class="muted">Keine Daten.</td></tr>`;
  }
}

/* Day close */
function openCloseDay(){
  if(!isBoss()) return;
  const date=document.getElementById("dayDate")?.value || serverDay;
  if(!date) return;
  if(currentDayReport?.closed) return alert("Dieser Tag ist bereits abgeschlossen.");
  window.__dayCloseDate=date;
  document.getElementById("dayCloseDateLabel").innerText=date;
  document.getElementById("dayCashCount").value="";
  document.getElementById("dayCloseNote").value="";
  document.getElementById("dayCloseMsg").innerText="—";
  document.getElementById("dayCloseOverlay").classList.remove("hidden");
}
function closeDayClose(){ document.getElementById("dayCloseOverlay").classList.add("hidden"); }

async function submitDayClose(){
  const date=window.__dayCloseDate || (document.getElementById("dayDate")?.value || serverDay);
  const cashCount=document.getElementById("dayCashCount")?.value;
  const note=document.getElementById("dayCloseNote")?.value || "";
  const msg=document.getElementById("dayCloseMsg");
  const res=await fetch("/reports/close-day",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ date, cashCount, note }) });
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success){ if(msg) msg.innerText=data.message||"Fehler."; return; }
  closeDayClose();
  loadDayReport();
}

/* Week report (KW, employees only) */
let weekTabInited=false;
function initWeekTab(){
  if(weekTabInited) return;
  weekTabInited=true;
  const w=document.getElementById("weekKW");
  if(w) w.value = currentISOWeekString(new Date());
}

function setWeekToThisKW(){
  const w=document.getElementById("weekKW");
  if(w) w.value = currentISOWeekString(new Date());
}

function printWeekReport(){
  document.body.classList.remove("printDay");
  document.body.classList.add("printWeek");
  window.print();
  document.body.classList.remove("printWeek");
}

async function loadWeekReport(){
  if(!isBoss()) return;
  const kw=document.getElementById("weekKW")?.value;
  if(!kw) return;
  // kw format: YYYY-Www
  const res=await fetch(`/reports/week-employee?week=${encodeURIComponent(kw)}`);
  if(res.status===401) return showLoginPage("Bitte einloggen.");
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return alert(data.message || "Fehler beim Laden der Wochenabrechnung.");

  currentWeekReport=data;
  document.getElementById("weekPrintKW").innerText=kw;

  const range=`${data.range?.start||"—"} bis ${data.range?.end||"—"}`;
  document.getElementById("weekRange").innerText=range;
  document.getElementById("weekPrintRange").innerText=range;

  document.getElementById("weekRevenue").innerText=money(data.totals?.revenue||0);
  document.getElementById("weekOrders").innerText=String(data.totals?.orders||0);

  const tbody=document.getElementById("weekByEmployee");
  if(tbody){
    tbody.innerHTML=(data.byEmployee||[]).map(x=>`
      <tr>
        <td>${esc(x.employee||x.employeeUsername||"")}</td>
        <td style="text-align:right;">${money(x.revenue||0)}</td>
        <td style="text-align:right;">${money(x.tips||0)}</td>
        <td style="text-align:right;">${x.orders||0}</td>
      </tr>
    `).join("") || `<tr><td colspan="4" class="muted">Keine Daten.</td></tr>`;
  }
}

/* Month report (Summe aus Wochen) */
let monthTabInited=false;
function initMonthTab(){
  if(monthTabInited) return;
  monthTabInited=true;
  const m=document.getElementById("monthYM");
  if(m) m.value = currentISOYMString(new Date());
}

function setMonthToThisMonth(){
  const m=document.getElementById("monthYM");
  if(m) m.value = currentISOYMString(new Date());
}

function printMonthReport(){
  document.body.classList.remove("printDay");
  document.body.classList.remove("printWeek");
  document.body.classList.add("printMonth");
  window.print();
  document.body.classList.remove("printMonth");
}

async function loadMonthReport(){
  if(!isBoss()) return;
  const ym=document.getElementById("monthYM")?.value;
  if(!ym) return;

  const res=await fetch(`/reports/month-employee?month=${encodeURIComponent(ym)}`);
  if(res.status===401) return showLoginPage("Bitte einloggen.");
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return alert(data.message || "Fehler beim Laden der Monatsabrechnung.");

  currentMonthReport=data;

  const weeksText=(data.weeks||[]).join(", ") || "—";
  document.getElementById("monthPrintYM").innerText=ym;
  document.getElementById("monthPrintWeeks").innerText=weeksText;
  const hint=document.getElementById("monthWeeksHint");
  if(hint) hint.innerText = `Enthaltene KW: ${weeksText}` + (data.note ? ` — ${data.note}` : "");

  document.getElementById("monthRevenue").innerText=money(data.totals?.revenue||0);
  document.getElementById("monthOrders").innerText=String(data.totals?.orders||0);

  const tbody=document.getElementById("monthByEmployee");
  if(tbody){
    tbody.innerHTML=(data.byEmployee||[]).map(x=>`
      <tr>
        <td>${esc(x.employee||x.employeeUsername||"")}</td>
        <td style="text-align:right;">${money(x.revenue||0)}</td>
        <td style="text-align:right;">${money(x.tips||0)}</td>
        <td style="text-align:right;">${x.orders||0}</td>
      </tr>
    `).join("") || `<tr><td colspan="4" class="muted">Keine Daten.</td></tr>`;
  }
}

/* Management */
async function refreshStats(){
  if(!isBoss()) return;
  if(!serverDay) return;
  const res=await fetch(`/reports/day-details?date=${encodeURIComponent(serverDay)}`);
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return;

  document.getElementById("statRevenue").innerText=money(data.totals?.revenue||0);
  document.getElementById("statTips").innerText=money(data.totals?.tips||0);
  document.getElementById("statOrders").innerText=String(data.totals?.orders||0);

  loadUsers();
}

async function resetToday(){
  if(!isBoss()) return alert("Nur Chef.");
  if(!confirm("ACHTUNG: Alle heutigen Verkäufe + Küche löschen?")) return;
  const res=await fetch("/reset/today",{ method:"POST" });
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return alert(data.message || "Fehler.");
  alert("Heute zurückgesetzt.");
  refreshStats();
}

/* Users */
async function loadUsers(){
  const res=await fetch("/users");
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return;
  const box=document.getElementById("usersList");
  if(!box) return;
  const users=data.users||data.staff||[];
  box.innerHTML=users.map(u=>`
    <div class="userRow">
      <div>
        <div style="font-weight:900;">${esc(u.displayName)}</div>
        <div class="muted small">${esc(u.username)} · ${esc(u.role)}</div>
      </div>
      <button class="ghost" onclick="delUser('${escAttr(u.username)}')">Löschen</button>
    </div>
  `).join("");
}

function openAddUser(){
  const uEl=document.getElementById("addUserUsername");
  const dEl=document.getElementById("addUserDisplayName");
  const rEl=document.getElementById("addUserRole");
  const pEl=document.getElementById("addUserPassword");
  const msg=document.getElementById("addUserMsg");

  if(uEl) uEl.value="";
  if(dEl) dEl.value="";
  if(rEl) rEl.value="staff";
  if(pEl) pEl.value="admin";
  if(msg) msg.innerText="—";

  document.getElementById("addUserOverlay").classList.remove("hidden");
  setTimeout(()=>{ try{ uEl && uEl.focus(); }catch(e){} }, 0);
}

function closeAddUser(){ document.getElementById("addUserOverlay").classList.add("hidden"); }

async function submitAddUser(){
  const u=(document.getElementById("addUserUsername").value||"").trim().toLowerCase();
  const d=(document.getElementById("addUserDisplayName").value||"").trim() || u;
  const role=String(document.getElementById("addUserRole").value||"staff");
  const pw=(document.getElementById("addUserPassword").value||"admin");
  const msg=document.getElementById("addUserMsg");

  if(!u){ if(msg) msg.innerText="Username fehlt."; return; }
  if(!["boss","staff"].includes(role)){ if(msg) msg.innerText="Ungültige Rolle."; return; }

  // optional: prevent spaces
  if(/\s/.test(u)){ if(msg) msg.innerText="Username darf keine Leerzeichen enthalten."; return; }

  if(msg) msg.innerText="Speichern…";
  const res=await fetch("/users",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ username:u, displayName:d, role, password:pw || "admin" }) });
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success){ if(msg) msg.innerText=(data.message || "Fehler."); return; }

  if(msg) msg.innerText="Erstellt ✅";
  closeAddUser();
  loadUsers();
}

async function addUser(username, displayName, role, password){
  const res=await fetch("/users",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ username, displayName, role, password }) });
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return alert(data.message || "Fehler.");
  loadUsers();
}
async function delUser(username){
  if(!confirm(`User ${username} löschen?`)) return;
  const res=await fetch(`/users/${encodeURIComponent(username)}`,{ method:"DELETE" });
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return alert(data.message || "Fehler.");
  loadUsers();
}

/* Password change */
function openPwChange(){
  document.getElementById("pwOld").value="";
  document.getElementById("pwNew1").value="";
  document.getElementById("pwNew2").value="";
  document.getElementById("pwMsg").innerText="—";
  document.getElementById("pwOverlay").classList.remove("hidden");
}
function closePwChange(){ document.getElementById("pwOverlay").classList.add("hidden"); }

async function submitPwChange(){
  const oldPw=document.getElementById("pwOld").value||"";
  const n1=document.getElementById("pwNew1").value||"";
  const n2=document.getElementById("pwNew2").value||"";
  const msg=document.getElementById("pwMsg");
  if(n1!==n2){ if(msg) msg.innerText="Neue Passwörter stimmen nicht überein."; return; }
  const res=await fetch("/auth/change-password",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ oldPw, newPw:n1 }) });
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success){ if(msg) msg.innerText=data.message || "Fehler."; return; }
  if(msg) msg.innerText="Passwort geändert ✅";
  setTimeout(closePwChange, 600);
}

/* Helpers */
function money(n){ const x=Number(n||0); return "$"+(Number.isFinite(x)?x:0); }
function num(n){
  const x = Number(n);
  if(!Number.isFinite(x)) return "0";
  // keep simple: no trailing zeros clutter
  return (Math.round(x*100)/100).toString().replace(".", ",");
}
function esc(s){
  return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function escAttr(s){ return esc(s).replaceAll("`","&#096;"); }
function fmtDateTime(iso){ try{ return new Date(iso).toLocaleString("de-DE"); }catch{ return String(iso||""); } }

// ISO week string for <input type="week">: YYYY-Www
function currentISOWeekString(d){
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1)/7);
  const y = date.getUTCFullYear();
  return `${y}-W${String(weekNo).padStart(2,"0")}`;
}

// YYYY-MM for <input type="month">
function currentISOYMString(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  return `${y}-${m}`;
}

/* Boot */
loadCartsFromStorage();
switchCartToRegister(currentRegister);
loadMe();
