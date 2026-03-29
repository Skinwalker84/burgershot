/* Burger Shot – App JS */

let currentRegister = null;
let currentCategory = "Burger";
let me = null;
let serverDay = null;

// Warenkorb pro Kasse (lokal)
let cartsByRegister = { 1: [], 2: [], 3: [], 4: [] };
let cart = cartsByRegister[currentRegister];

function switchCartToRegister(n){
  const key = Number(n)||1;
  if(!cartsByRegister[key]) cartsByRegister[key] = [];
  cart = cartsByRegister[key];
}

let currentDayReport = null;
let currentWeekReport = null;
let currentMonthReport = null;
let inventoryItems = [];

let menuBuilderState = null;

let kitchenTimerInterval = null;

function isBoss(){ return me?.role === "boss"; }
function localDateStr(){
  return new Intl.DateTimeFormat("en-CA", { timeZone:"Europe/Berlin", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
}
function isManager(){ return me?.role === "manager"; }
function isBossOrManager(){ return me?.role === "boss" || me?.role === "manager"; }

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

function applyMgmtRoleVisibility(){
  const bossOnly = [
    "panel_mgmtMitarbeiter","panel_vkPreise","panel_lagerZuordnung",
    "panel_staffConsumption","panel_bankHistory","panel_tipPayouts"
  ];
  const managerOk = [
    "panel_guthabenKarten","panel_mitarbeiterUmsatz","panel_bestseller","panel_firmenausgaben"
  ];
  bossOnly.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.display = isBoss() ? "block" : "none";
  });
  managerOk.forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.display = isBossOrManager() ? "block" : "none";
  });
  // Testdaten panel — find by heading text
  document.querySelectorAll("#tab_mgmt > .panel, #tab_mgmt .panel").forEach(p => {
    const heading = p.querySelector("div[style*='font-weight:900']");
    if(heading && heading.textContent.includes("Testdaten")) {
      p.style.display = isBoss() ? "block" : "none";
    }
  });
}

function applyRoleVisibility(){
  const boss = isBoss();
  const mgr = isBossOrManager();

  // Boss-only tabs
  ["iconBtnMonth","iconBtnSchicht"].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.style.display = boss ? "" : "none";
  });
  // Week visible for all staff (but limited content)
  const weekBtn = document.getElementById("iconBtnWeek");
  if(weekBtn) weekBtn.style.display = "";
  // Boss + Manager tabs
  ["iconBtnShop","iconBtnDay","iconBtnMgmt"].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.style.display = mgr ? "" : "none";
  });
  // All staff: Lager
  const stockBtn = document.getElementById("iconBtnStock");
  if(stockBtn) stockBtn.style.display = "";
}

function openTab(tabId, btn){
  const bossOnlyTabs = ["tab_month","tab_schicht"];
  const managerTabs   = ["tab_shop","tab_day"];
  if(bossOnlyTabs.includes(tabId) && !isBoss()){
    alert("Nur Chef.");
    tabId="tab_pos"; btn=null;
  } else if(managerTabs.includes(tabId) && !isBossOrManager()){
    alert("Kein Zugriff.");
    tabId="tab_pos"; btn=null;
  }

  document.querySelectorAll(".tabPage").forEach(p=>p.classList.add("hidden"));
  document.getElementById(tabId)?.classList.remove("hidden");

  // legacy tab highlighting (no longer visible)
  document.querySelectorAll(".tabTop").forEach(b=>b.classList.remove("active"));
  btn?.classList?.add("active");

  if(tabId==="tab_kitchen") { loadKitchen(); startKitchenTimers(); }
  else { stopKitchenTimers(); }
  if(tabId==="tab_day") { initDayTab(); loadDayReport(); if(isBoss()) loadBankBalance(); }
  if(tabId==="tab_week") { initWeekTab(); loadWeekReport(); const p=document.getElementById("weekPdfBtn"); const t=document.getElementById("weekTipBtn"); const show=isBossOrManager(); if(p) p.style.display=show?"":"none"; if(t) t.style.display=show?"":"none"; }
  if(tabId==="tab_month") { initMonthTab(); loadMonthReport(); }
  if(tabId==="tab_schicht") { initSchichtTab(); }
  if(tabId==="tab_zutaten") { loadZutaten(); }
  if(tabId==="tab_stock") { loadInventory(); }
  if(tabId==="tab_board") {
    // Mark seen: store current time so all existing posts are considered read
    setBoardLastSeen(new Date().toISOString());
    const badge=document.getElementById("boardBadge");
    if(badge) badge.style.display="none";
    loadBoard();
  }
  if(tabId==="tab_shop") { loadShopTab(); }
  if(tabId==="tab_mgmt") {
    applyMgmtRoleVisibility();
    if(isBoss()) loadUsers();
    loadGuthabenKarten();
  }
}

/* =========================
   EINKAUF TAB (Batch)
   ========================= */

async function loadShopTab(){
  if(!isBossOrManager()) return;
  const d = document.getElementById("shopDate");
  if(d && !d.value) d.value = localDateStr();

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
          <input class="input shopQty" data-id="${escAttr(it.id)}" type="number" step="0.01" min="0" placeholder="0" style="width:120px; text-align:right;" oninput="updateShopTotal()" />
        </td>
        <td style="text-align:right;">
          <input class="input shopPrice" data-id="${escAttr(it.id)}" type="number" step="0.01" min="0" placeholder="0.00" style="width:110px; text-align:right;" value="${it.ekPrice > 0 ? it.ekPrice : ""}" oninput="updateShopTotal()" />
        </td>
        <td style="text-align:right; font-weight:900;" id="shopRowTotal_${escAttr(it.id)}">—</td>
      </tr>
    `;
  }).join("");
  updateShopTotal();
}

function updateShopTotal(){
  let total = 0;
  const qtyInputs = Array.from(document.querySelectorAll(".shopQty"));
  for(const qtyEl of qtyInputs){
    const id = qtyEl.getAttribute("data-id");
    const priceEl = document.querySelector(`.shopPrice[data-id="${id}"]`);
    const rowEl = document.getElementById("shopRowTotal_" + id);
    const qty = Number(qtyEl.value) || 0;
    const price = Number(priceEl?.value) || 0;
    const rowTotal = qty * price;
    if(rowEl) rowEl.innerText = rowTotal > 0 ? "$" + rowTotal.toFixed(2) : "—";
    total += rowTotal;
  }
  const totalEl = document.getElementById("shopTotal");
  if(totalEl) totalEl.innerText = "$" + total.toFixed(2);
}

async function loadPurchaseHistory(){
  const tbody = document.getElementById("purchaseHistoryBody");
  const msg   = document.getElementById("purchaseHistoryMsg");
  if(!tbody) return;

  // Set date default on first open
  const dateInput = document.getElementById("purchaseHistoryDate");
  if(dateInput && !dateInput.value) dateInput.value = serverDay || new Date().toISOString().slice(0,10);

  const date = document.getElementById("purchaseHistoryDate")?.value || "";
  const url  = date ? `/purchases?limit=200&date=${encodeURIComponent(date)}` : "/purchases?limit=200";

  const res  = await fetch(url).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  const list = (data.items || []).filter(p => !date || String(p.date||"").slice(0,10) === date);

  if(list.length === 0){
    tbody.innerHTML = `<tr><td colspan="7" class="muted small">Keine Einträge${date ? " für dieses Datum" : ""}.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const summe = (p.price != null && p.qty) ? `$${(p.qty * p.price).toFixed(0)}` : "—";
    const priceStr = p.price != null ? `$${p.price}` : "—";
    return `<tr>
      <td class="muted small">${esc(String(p.date||"").slice(0,10))}</td>
      <td style="font-weight:900;">${esc(p.name||p.inventoryId||"")}</td>
      <td style="text-align:right;">${p.qty} ${esc(p.unit||"")}</td>
      <td style="text-align:right; color:var(--muted);">${priceStr}</td>
      <td style="text-align:right; font-weight:900; color:#ef4444;">-${summe}</td>
      <td class="muted small">${esc(p.by||"")}</td>
      <td style="display:flex; gap:4px;">
        ${isBoss() ? `
          <button class="ghost" style="font-size:11px; padding:2px 8px;"
            onclick="editPurchase('${escAttr(p.id||"")}','${escAttr(p.name||"")}',${p.qty||0},${p.price??'null'})">✏️ Bearbeiten</button>
          <button class="ghost" style="font-size:11px; padding:2px 8px; color:#ef4444;"
            onclick="deletePurchase('${escAttr(p.id||"")}')">Stornieren</button>
        ` : ""}
      </td>
    </tr>`;
  }).join("");
}

function editPurchase(id, name, qty, price){
  const newPrice = prompt(`Einkauf korrigieren: ${name}

Neuer EK-Preis pro Einheit ($):
(leer lassen = kein Preis)`, price != null ? price : "");
  if(newPrice === null) return; // cancelled
  const newQty = prompt(`Neue Menge (${qty}):`, qty);
  if(newQty === null) return;

  const payload = {};
  if(newPrice.trim() !== "") payload.price = parseFloat(newPrice);
  else payload.price = null;
  payload.qty = parseFloat(newQty) || qty;

  fetch(`/purchases/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload)
  }).then(r => r.json()).then(data => {
    const msg = document.getElementById("purchaseHistoryMsg");
    if(!data.success){ if(msg) msg.innerText = data.message || "Fehler."; return; }
    if(msg){ msg.innerText = "✅ Eintrag aktualisiert."; setTimeout(()=>{ msg.innerText=""; }, 3000); }
    loadPurchaseHistory();
    if(isBoss()) loadBankBalance();
  }).catch(()=>{});
}

async function deletePurchase(id){
  if(!isBoss()) return;
  if(!confirm("Diesen Einkauf wirklich stornieren?\nBestand und Kontostand werden zurückgesetzt.")) return;
  const msg = document.getElementById("purchaseHistoryMsg");
  const res = await fetch(`/purchases/${encodeURIComponent(id)}`, { method:"DELETE" }).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if(!res?.ok || !data.success){
    if(msg) msg.innerText = data.message || "Fehler beim Stornieren.";
    return;
  }
  inventoryItems = Array.isArray(data.items) ? data.items : inventoryItems;
  renderInventory();
  loadPurchaseHistory();
  loadBankBalance();
  if(msg){ msg.innerText = "✅ Storniert — Bestand und Kontostand wurden angepasst."; setTimeout(()=>{ msg.innerText=""; }, 4000); }
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
    const priceEl = document.querySelector(`.shopPrice[data-id="${id}"]`);
    const price = Number(priceEl?.value) || null;
    return { inventoryId: id, qty, price: price > 0 ? price : null };
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
  if(msg) msg.innerText = "Gebucht ✅ " + added + " Position" + (added===1?"":"en") + " ins Lager übernommen.";
}

/* =========================
   INVENTORY / LAGER
   ========================= */
async function loadInventory(){
  // Show/hide boss-only elements in Lager tab
  const addBtn = document.getElementById("lagerAddBtn");
  const subtitle = document.getElementById("lagerSubtitle");
  if(addBtn) addBtn.style.display = isBoss() ? "" : "none";
  if(subtitle) subtitle.innerText = isBoss() ? "Chef only · Bestände & Mindestbestand" : "Nur lesen";

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
  if(!isBossOrManager()) return;
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
          ${isBoss() ? `<button class="primary" onclick="openInventoryEditor('${escAttr(it.id)}')">Bearbeiten</button>
          <button class="ghost" onclick="deleteInventoryItem('${escAttr(it.id)}')">Löschen</button>` : ''}
          <span class="muted small" style="margin-left:6px;">EK: $${Number(it.ekPrice||0).toFixed(2)}</span>
        </td>
      </tr>
    `;
  }).join("");
}

async function openInventoryEditor(id){
  if(!isBoss()) return;
  // BUGFIX: Immer frische Daten vom Server laden, nie veralteten Cache verwenden
  // Verhindert dass Bestand beim Bearbeiten auf alten Wert zurückgesetzt wird
  let existing = null;
  if(id){
    try {
      const freshRes = await fetch("/inventory");
      const freshData = freshRes.ok ? await freshRes.json().catch(()=>({})) : {};
      if(freshData.success && Array.isArray(freshData.items)){
        inventoryItems = freshData.items; // Cache auch aktualisieren
        existing = freshData.items.find(x=>x.id===id) || null;
      }
    } catch(e) {
      existing = inventoryItems.find(x=>x.id===id) || null;
    }
  }
  const name = prompt("Artikelname:", existing?.name || "");
  if(name===null) return;
  const unit = prompt("Einheit (z.B. Stk, l, kg):", existing?.unit || "Stk");
  if(unit===null) return;
  const stockStr = prompt("Aktueller Bestand:", String(existing?.stock ?? 0));
  if(stockStr===null) return;
  const minStr = prompt("Mindestbestand (Warnung ab diesem Wert):", String(existing?.minStock ?? 0));
  if(minStr===null) return;
  const ekStr = prompt("EK-Preis pro Einheit ($):", String(existing?.ekPrice ?? 0));
  if(ekStr===null) return;

  const stock = Number(String(stockStr).replace(",","."));
  const minStock = Number(String(minStr).replace(",","."));
  const ekPrice = Number(String(ekStr).replace(",","."));

  saveInventory({
    id: existing?.id,
    name: String(name).trim(),
    unit: String(unit).trim() || "Stk",
    stock: Number.isFinite(stock) ? stock : 0,
    minStock: Number.isFinite(minStock) ? minStock : 0,
    ekPrice: Number.isFinite(ekPrice) && ekPrice >= 0 ? ekPrice : 0
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
  weekTabInited = false;
  monthTabInited = false;
  showApp();
  applyRoleVisibility();
  // Check for unread board posts after login
  fetch("/board").then(r=>r.json()).then(data => {
    const lastSeen = getBoardLastSeen();
    const hasNew = (data.posts||[]).some(p => p.createdAt > lastSeen);
    const badge = document.getElementById("boardBadge");
    if(badge) badge.style.display = hasNew ? "" : "none";
  }).catch(()=>{});
  updateRegisterDisplay();
  syncActiveRegisterButton(null);
  await initProducts();
  getZutatenCache(); // preload so ⓘ buttons render correctly
  renderCart();
  await loadCartsFromServer();
  startCartsSSE();
  startPresenceSSE();
  startPresenceLoop();
  sendHeartbeat();
  if(!window._heartbeatInterval){ window._heartbeatInterval = setInterval(sendHeartbeat, 15000); }
  renderPresenceWarning();
  await loadCartsFromServer();
  startCartsSSE();
  updateDayInfo();
  if(isBoss()){
    checkLowStockAlert();
    startLowStockMonitor();
    loadBankBalance();
  }
}

async function checkLowStockAlert(){
  try{
    const res = await fetch("/inventory");
    const data = await res.json().catch(()=>({}));
    const items = data.items || [];
    const low = items.filter(it => Number(it.minStock) > 0 && Number(it.stock) <= Number(it.minStock));
    
    // Badge on lager icon
    const badge = document.getElementById("stockBadge");
    if(badge){
      if(low.length > 0){
        badge.innerText = low.length;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }

    // Toast notification
    if(low.length > 0){
      showLowStockToast(low);
    }
  }catch(e){}
}

function showLowStockToast(items){
  // Remove existing toast
  document.getElementById("lowStockToast")?.remove();

  const toast = document.createElement("div");
  toast.id = "lowStockToast";
  toast.style.cssText = `
    position:fixed; bottom:24px; right:24px; z-index:9999;
    background:#1e293b; border:2px solid #ef4444; border-radius:10px;
    padding:14px 18px; max-width:320px; box-shadow:0 8px 32px rgba(0,0,0,.5);
    animation: slideInRight .3s ease;
  `;
  toast.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
      <div>
        <div style="font-weight:900; color:#ef4444; margin-bottom:6px;">⚠️ Mindestbestand unterschritten</div>
        <div style="font-size:13px; color:#94a3b8; line-height:1.6;">
          ${items.map(it => `<div>• <b style="color:#e2e8f0;">${esc(it.name)}</b> — ${num(it.stock)} ${esc(it.unit||"Stk")} (Min: ${num(it.minStock)})</div>`).join("")}
        </div>
      </div>
      <button onclick="document.getElementById('lowStockToast').remove()" 
        style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:18px;line-height:1;padding:0;flex-shrink:0;">✕</button>
    </div>
    <button onclick="openTab('tab_stock',null); document.getElementById('lowStockToast').remove();"
      style="margin-top:10px; width:100%; padding:6px; background:#ef4444; border:none; border-radius:6px; color:#fff; font-weight:900; cursor:pointer;">
      Zum Lager →
    </button>
  `;
  document.body.appendChild(toast);

  // Auto-dismiss after 15 seconds
  setTimeout(() => toast.remove(), 15000);
}

async function logout(){
  await sendPresenceLeave();
  await fetch("/auth/logout",{ method:"POST" }).catch(()=>{});
  me=null;
  stopPresenceLoop();
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
  updateRegisterDisplay();
  syncActiveRegisterButton(null);
  await initProducts();
  renderCart();
  await loadCartsFromServer();
  startCartsSSE();
  startPresenceSSE();
  startPresenceLoop();
  sendHeartbeat();
  if(!window._heartbeatInterval){ window._heartbeatInterval = setInterval(sendHeartbeat, 15000); }
  renderPresenceWarning();
  updateDayInfo();
}

function updateHeaderClock(){
  const now = new Date();
  const timeEl = document.getElementById("headerTime");
  const dateEl = document.getElementById("headerDate");
  if(timeEl) timeEl.innerText = now.toLocaleTimeString("de-DE", { hour:"2-digit", minute:"2-digit", second:"2-digit" });
  if(dateEl) dateEl.innerText = now.toLocaleDateString("de-DE", { weekday:"short", day:"2-digit", month:"2-digit", year:"numeric" });
}
setInterval(updateHeaderClock, 1000);
updateHeaderClock();

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
    const full = String((me?.displayName||me?.name||"")).trim();
    counterTitle.innerText = full || "—";
  }
}
setInterval(updateDayInfo, 1000);

function updateRegisterDisplay(){
  const d=document.getElementById("registerDisplay");
  if(d) d.innerText = currentRegister ? (REGISTER_NAMES[Number(currentRegister)] || "Kasse " + currentRegister) : "Kasse —";
  syncActiveRegisterButton(currentRegister);
}


function activateRegBtn(btn){
  // setRegister already updated currentRegister — just sync buttons to match
  syncActiveRegisterButton(currentRegister);
}

/* Products */
const PRODUCTS_DEFAULT = [
  { name: "The Bleeder", price: 19, cat: "Burger" },
  { name: "The Heartstopper", price: 21, cat: "Burger" },
  { name: "The Chicken", price: 17, cat: "Burger" },
  { name: "Vegan Burger", price: 15, cat: "Burger" },
  { name: "The Chozzo", price: 17, cat: "Burger" },
  { name: "The German", price: 21, cat: "Burger" },
  { name: "Breakfast Deluxe", price: 0, cat: "Burger", icon: "breakfast_deluxe.png" },
  { name: "Special Burger",   price: 0, cat: "Burger", icon: "special_burger.png" },
  { name: "Coleslaw", price: 15, cat: "Beilagen" },
  { name: "Fries", price: 11, cat: "Beilagen" },
  { name: "Cheesy Fries", price: 13, cat: "Beilagen" },
  { name: "Chicken Nuggets", price: 15, cat: "Beilagen" },
  { name: "Onion Rings", price: 11, cat: "Beilagen" },
  { name: "ECola", price: 13, cat: "Getränke" },
  { name: "ECola Light", price: 13, cat: "Getränke" },
  { name: "Sprunk", price: 13, cat: "Getränke" },
  { name: "Sprunk Light", price: 13, cat: "Getränke" },
  // legacy typo kept for compatibility with older saved data
  { name: "Sprung", price: 13, cat: "Getränke" },
  { name: "Slush", price: 15, cat: "Getränke" },
  { name: "Milchshake", price: 15, cat: "Getränke" },
  { name: "Splashy Drink", price: 0, cat: "Getränke", icon: "splashy.png" },
  { name: "Donut", price: 13, cat: "Süßes" },
  { name: "Caramel Sundae", price: 13, cat: "Süßes" },
  { name: "Chocolate Sundae", price: 13, cat: "Süßes" },
  { name: "Strawberry Sundae", price: 13, cat: "Süßes" },
];
let PRODUCTS = [];
let HIDDEN_PRODUCTS = [];


function initProducts(){ hydrateProducts(); renderProducts(); }

// bump version so newly added default items (e.g. Light drinks) appear even if older data was cached
const PRODUCTS_STORAGE_KEY = "bs_products_v9";

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
      const id = String(p.id||"").trim() || null;
      const extra = {};
      if(p.icon)           extra.icon           = p.icon;
      if(p.desc)           extra.desc           = p.desc;
      if(p.groupSize)      extra.groupSize      = Number(p.groupSize);
      if(p.noSidesBox)     extra.noSidesBox     = true;
      if(p.donutBox)       extra.donutBox       = true;
      if(p.chickenBox)     extra.chickenBox     = true;
      if(p.germanBox)      extra.germanBox      = true;
      if(p.soulCarwashBox) extra.soulCarwashBox = true;
      if(p.specialBurgerBox) extra.specialBurgerBox = true;
      out.push({ id, name, cat, price: Math.round(price), ...extra });
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
        PRODUCTS = data.products.map(p=>({ id:p.id, name:p.name, cat:p.cat, price:Number(p.price)||0, icon:p.icon||null, desc:p.desc||null, groupSize:p.groupSize||null, chickenBox:!!p.chickenBox, donutBox:!!p.donutBox, germanBox:!!p.germanBox, noSidesBox:!!p.noSidesBox, soulCarwashBox:!!p.soulCarwashBox, specialBurgerBox:!!p.specialBurgerBox }));
        saveProductsToStorage(PRODUCTS); // keep fallback in sync
        return;
      }
    }
  }catch(e){}

  // 2) LocalStorage fallback
  const stored = loadProductsFromStorage();
  if(stored && Array.isArray(stored) && stored.length){
    PRODUCTS = stored.map(p=>({ ...p, price:Number(p.price)||0, id: p.id || slugKey(p) }));
    return;
  }

  // 3) Defaults
  PRODUCTS = PRODUCTS_DEFAULT.map(p=>({ ...p, id: p.id || slugKey(p) }));
  saveProductsToStorage(PRODUCTS);
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
      <td style="text-align:center; padding:4px;">
        <button class="ghost" title="Aus dem Sortiment entfernen"
          style="padding:2px 8px; font-size:12px; color:#ef4444;"
          onclick="hideProduct('${escAttr(p.id)}','${escAttr(p.name)}')">🗑️</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="4" class="muted small">Keine Produkte.</td></tr>`;
  // Show restore section if any hidden
  renderHiddenProductsList();
  if(msg) msg.innerText = "—";
}

async function hideProduct(id, name){
  if(!confirm(`"${name}" aus dem Sortiment entfernen?

Das Produkt erscheint nicht mehr in der Kasse.`)) return;
  const res  = await fetch(`/products/${encodeURIComponent(id)}`, { method:"DELETE" }).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if(!data.success){ alert(data.message||"Fehler."); return; }
  PRODUCTS = data.products;
  HIDDEN_PRODUCTS = data.hiddenProducts || HIDDEN_PRODUCTS;
  renderProducts();
  renderProductsEditor();
}

async function restoreProduct(id){
  const res  = await fetch(`/products/${encodeURIComponent(id)}/restore`, { method:"POST" }).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if(!data.success){ alert(data.message||"Fehler."); return; }
  PRODUCTS = data.products;
  HIDDEN_PRODUCTS = (HIDDEN_PRODUCTS||[]).filter(h => h !== id);
  renderProducts();
  renderProductsEditor();
}

function renderHiddenProductsList(){
  const body = document.getElementById("mgmtProductsBody");
  if(!body) return;
  if(!HIDDEN_PRODUCTS || HIDDEN_PRODUCTS.length === 0) return;

  // Find all DEFAULT product names for hidden ids
  // We don't have them client-side so just show IDs with restore button
  const hiddenRows = HIDDEN_PRODUCTS.map(id => `
    <tr style="opacity:.5;">
      <td colspan="2"><span class="muted small">🚫 ${esc(id)}</span></td>
      <td style="text-align:right;"><span class="muted small">versteckt</span></td>
      <td style="text-align:center;">
        <button class="ghost" style="padding:2px 8px; font-size:12px; color:#22c55e;"
          onclick="restoreProduct('${escAttr(id)}')">↩️ Wiederherstellen</button>
      </td>
    </tr>`).join("");
  body.innerHTML += hiddenRows;
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
        PRODUCTS = data.products.map(p=>({ id:p.id, name:p.name, cat:p.cat, price:Number(p.price)||0, icon:p.icon||null, desc:p.desc||null, groupSize:p.groupSize||null, chickenBox:!!p.chickenBox, donutBox:!!p.donutBox, germanBox:!!p.germanBox, noSidesBox:!!p.noSidesBox, soulCarwashBox:!!p.soulCarwashBox, specialBurgerBox:!!p.specialBurgerBox }));
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

/* ===== LAGER-ZUORDNUNG (Produkt → Lagerartikel) ===== */
let stockLinks = []; // [{productId, inventoryId, qty}]

async function loadStockLinks(){
  try{
    const res = await fetch("/sale-inventory-links");
    const data = await res.json().catch(()=>({}));
    if(data.success) stockLinks = data.links || [];
    renderStockLinks();
  }catch(e){}
}

function renderStockLinks(){
  const body = document.getElementById("stockLinksBody");
  if(!body) return;
  if(!stockLinks.length){
    body.innerHTML = `<tr><td colspan="4" class="muted small" style="text-align:center;">Keine Zuordnungen. Klicke "+ Zuordnung" um eine hinzuzufügen.</td></tr>`;
    return;
  }
  body.innerHTML = stockLinks.map((l, i) => {
    const prod = (PRODUCTS||[]).find(p => p.id === l.productId);
    const prodName = prod ? `${prod.name} (${prod.cat})` : l.productId;
    const inv = (window._invItems||[]).find(x => x.id === l.inventoryId);
    const invName = inv ? inv.name : l.inventoryId;
    return `<tr>
      <td>${esc(prodName)}</td>
      <td>${esc(invName)}</td>
      <td style="text-align:right;">${l.qty}</td>
      <td style="text-align:right;"><button class="ghost" onclick="removeStockLink(${i})">Löschen</button></td>
    </tr>`;
  }).join("");
}

function removeStockLink(idx){
  stockLinks.splice(idx, 1);
  renderStockLinks();
}

async function saveStockLinks(){
  const msg = document.getElementById("stockLinksMsg");
  try{
    const res = await fetch("/sale-inventory-links",{
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ links: stockLinks })
    });
    const data = await res.json().catch(()=>({}));
    if(res.ok && data.success){
      stockLinks = data.links || stockLinks;
      renderStockLinks();
      if(msg) msg.innerText = "Gespeichert ✅";
      setTimeout(()=>{ if(msg) msg.innerText="—"; }, 3000);
    } else {
      if(msg) msg.innerText = data.message || "Fehler beim Speichern.";
    }
  }catch(e){
    if(msg) msg.innerText = "Netzwerkfehler.";
  }
}

async function openAddStockLink(){
  // Load inventory items for dropdown
  try{
    const res = await fetch("/inventory");
    const data = await res.json().catch(()=>({}));
    window._invItems = data.items || [];
  }catch(e){ window._invItems = []; }

  // Fill product dropdown — alle Produkte AUSSER Menüs (die werden über Komponenten abgedeckt)
  const prodSel = document.getElementById("slProductId");
  const invSel = document.getElementById("slInventoryId");
  if(!prodSel || !invSel) return;

  const allProds = (PRODUCTS||[]).filter(p => String(p.cat||"") !== "Menü");
  prodSel.innerHTML = allProds.map(p =>
    `<option value="${escAttr(p.id||p.name)}">${esc(p.name)} (${esc(p.cat)})</option>`
  ).join("");

  invSel.innerHTML = (window._invItems||[]).map(it =>
    `<option value="${escAttr(it.id)}">${esc(it.name)} (${esc(it.unit||"Stk")})</option>`
  ).join("");

  if(!window._invItems.length){
    invSel.innerHTML = `<option value="">— Keine Lagerartikel vorhanden —</option>`;
  }

  document.getElementById("slQty").value = "1";
  document.getElementById("addStockLinkOverlay").classList.remove("hidden");
}

function closeAddStockLink(){
  document.getElementById("addStockLinkOverlay").classList.add("hidden");
}

function confirmAddStockLink(){
  const productId = document.getElementById("slProductId").value;
  const inventoryId = document.getElementById("slInventoryId").value;
  const qty = Number(document.getElementById("slQty").value);
  if(!productId || !inventoryId){ alert("Bitte Produkt und Lagerartikel wählen."); return; }
  if(!Number.isFinite(qty) || qty <= 0){ alert("Menge muss > 0 sein."); return; }
  stockLinks.push({ productId, inventoryId, qty: Math.round(qty*100)/100 });
  renderStockLinks();
  closeAddStockLink();
}

/* ===== SCHWARZES BRETT ===== */

let _boardPrio = "normal";
let _lastBoardCount = 0;

function selectPrio(p){
  _boardPrio = p;
  ["normal","important","urgent"].forEach(x => {
    const btn = document.getElementById("prioBtnNormal".replace("Normal", x.charAt(0).toUpperCase()+x.slice(1)));
    if(btn) btn.classList.toggle("active", x === p);
  });
  document.getElementById("prioBtnNormal").classList.toggle("active", p==="normal");
  document.getElementById("prioBtnImportant").classList.toggle("active", p==="important");
  document.getElementById("prioBtnUrgent").classList.toggle("active", p==="urgent");
}

function openNewPost(){
  document.getElementById("boardPostTitle").value = "";
  document.getElementById("boardPostBody").value = "";
  document.getElementById("boardPostMsg").innerText = "—";
  selectPrio("normal");
  document.getElementById("boardPostOverlay").classList.remove("hidden");
  setTimeout(() => document.getElementById("boardPostTitle")?.focus(), 100);
}
function closeBoardPost(){ document.getElementById("boardPostOverlay").classList.add("hidden"); }

async function submitBoardPost(){
  const title = document.getElementById("boardPostTitle").value.trim();
  const body  = document.getElementById("boardPostBody").value.trim();
  const msg   = document.getElementById("boardPostMsg");
  if(!title){ msg.innerText = "Bitte Titel eingeben."; return; }
  const res = await fetch("/board", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ title, body, prio: _boardPrio })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || !data.success){ msg.innerText = data.message||"Fehler."; return; }
  closeBoardPost();
  loadBoard();
}

async function deletePost(id){
  if(!confirm("Beitrag löschen?")) return;
  await fetch(`/board/${id}`, { method:"DELETE" });
  loadBoard();
}

const PRIO_LABEL = { normal:"📌 Normal", important:"⚠️ Wichtig", urgent:"🚨 Dringend" };
const PRIO_COLOR = { normal:"var(--muted)", important:"#f59e0b", urgent:"#ef4444" };

function getBoardSeenKey(){ return `boardSeen_${me?.username||"x"}`; }
function getBoardLastSeen(){ return localStorage.getItem(getBoardSeenKey()) || ""; }
function setBoardLastSeen(ts){ localStorage.setItem(getBoardSeenKey(), ts); }

async function loadBoard(fromPoll=false){
  const container = document.getElementById("boardPosts");
  if(!container) return;
  // Capture BEFORE async fetch — user might switch tabs while fetching
  const wasOpen = !document.getElementById("tab_board")?.classList.contains("hidden");
  const res = await fetch("/board").catch(()=>null);
  const data = res ? await res.json().catch(()=>({})) : {};
  const posts = data.posts || [];

  // Only update badge if board was NOT open when we started loading
  if(!wasOpen){
    const badge = document.getElementById("boardBadge");
    if(badge){
      const lastSeen = getBoardLastSeen();
      const hasNew = posts.some(p => p.createdAt > lastSeen);
      badge.style.display = hasNew ? "" : "none";
    }
  }

  if(!posts.length){
    container.innerHTML = `<div class="panel muted small" style="text-align:center; padding:32px;">Noch keine Beiträge. Sei der Erste! 📋</div>`;
    return;
  }

  container.innerHTML = posts.map(p => `
    <div class="boardCard prio-${p.prio||"normal"}">
      <div class="row" style="justify-content:space-between; align-items:flex-start; gap:10px;">
        <div>
          <span style="font-size:11px; font-weight:900; color:${PRIO_COLOR[p.prio]||"var(--muted)"}; text-transform:uppercase; letter-spacing:1px;">${PRIO_LABEL[p.prio]||""}</span>
          <div style="font-weight:900; font-size:16px; margin-top:4px;">${esc(p.title)}</div>
        </div>
        <button class="ghost boardDelete" onclick="deletePost('${escAttr(p.id)}')" style="padding:2px 8px; font-size:12px;">🗑</button>
      </div>
      ${p.body ? `<div style="margin-top:10px; line-height:1.6; white-space:pre-wrap;">${esc(p.body)}</div>` : ""}
      <div class="boardMeta">✍️ ${esc(p.author)} · ${esc(fmtDateTime(p.createdAt))}</div>
    </div>
  `).join("");
}

// Refresh board content if tab is open every 60s (no badge update)
setInterval(() => {
  const boardOpen = document.getElementById("tab_board") && !document.getElementById("tab_board").classList.contains("hidden");
  if(boardOpen) loadBoard();
}, 60000);

/* ===== MITARBEITER-UMSATZ & BESTSELLER ===== */

async function loadMitarbeiterUmsatz(){
  const body = document.getElementById("mitarbeiterUmsatzBody");
  if(!body) return;
  body.innerHTML = `<tr><td colspan="4" class="muted small">Lade…</td></tr>`;
  try{
    const res = await fetch("/reports/employee-totals");
    const data = await res.json().catch(()=>({}));
    if(!res.ok || !data.success){ body.innerHTML=`<tr><td colspan="4" class="muted small">Fehler.</td></tr>`; return; }
    const emps = data.employees || [];
    if(!emps.length){ body.innerHTML=`<tr><td colspan="4" class="muted small">Keine Daten.</td></tr>`; return; }
    body.innerHTML = emps.map((e,i) => `<tr>
      <td><b>${esc(e.name)}</b></td>
      <td style="text-align:right; font-weight:900; color:#22c55e;">${money(e.revenue)}</td>
      <td style="text-align:right;">${e.orders}</td>
      <td style="text-align:right; color:#60a5fa;">${money(e.avg)}</td>
    </tr>`).join("");
  }catch(e){
    body.innerHTML=`<tr><td colspan="4" class="muted small">Fehler beim Laden.</td></tr>`;
  }
}

async function loadBestseller(){
  const body = document.getElementById("bestsellerBody");
  if(!body) return;
  body.innerHTML = `<tr><td colspan="4" class="muted small">Lade…</td></tr>`;
  const medals = ["🥇","🥈","🥉"];
  try{
    const res = await fetch("/reports/bestseller");
    const data = await res.json().catch(()=>({}));
    if(!res.ok || !data.success){ body.innerHTML=`<tr><td colspan="4" class="muted small">Fehler.</td></tr>`; return; }
    const items = data.items || [];
    if(!items.length){ body.innerHTML=`<tr><td colspan="4" class="muted small">Keine Daten.</td></tr>`; return; }
    body.innerHTML = items.map((it,i) => `<tr>
      <td style="text-align:center; font-size:18px;">${medals[i] || String(i+1)}</td>
      <td><b>${esc(it.name)}</b></td>
      <td style="text-align:right; font-weight:900;">${it.qty}×</td>
      <td style="text-align:right; color:#22c55e;">${money(it.revenue)}</td>
    </tr>`).join("");
  }catch(e){
    body.innerHTML=`<tr><td colspan="4" class="muted small">Fehler beim Laden.</td></tr>`;
  }
}

/* ===== GUTHABEN KARTEN ===== */

async function loadGuthabenKarten(){
  const body = document.getElementById("guthabenKartenBody");
  if(!body) return;
  try{
    const res = await fetch("/guthaben-karten");
    const data = await res.json().catch(()=>({}));
    const karten = data.karten || [];
    if(!karten.length){
      body.innerHTML = `<tr><td colspan="3" class="muted small">Noch keine Karten.</td></tr>`;
      return;
    }
    body.innerHTML = karten
      .sort((a,b) => a.name.localeCompare(b.name))
      .map(k => `<tr>
        <td style="font-weight:900;">${esc(k.name)}</td>
        <td style="text-align:right; font-weight:900; color:${k.balance>0?"#22c55e":"#ef4444"};">${money(k.balance)}</td>
        <td class="muted small">${esc(fmtDateTime(k.updatedAt))}</td>
      </tr>`).join("");
  }catch(e){
    body.innerHTML = `<tr><td colspan="3" class="muted small">Fehler beim Laden.</td></tr>`;
  }
}

async function saveGuthabenKarte(){
  const name = document.getElementById("guthabenName")?.value?.trim();
  const betrag = Number(document.getElementById("guthabenBetrag")?.value);
  const msg = document.getElementById("guthabenMsg");
  if(!name){ if(msg) msg.innerText = "Bitte einen Namen eingeben."; return; }
  if(!betrag || betrag <= 0){ if(msg) msg.innerText = "Bitte einen gültigen Betrag eingeben."; return; }

  const res = await fetch("/guthaben-karten", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ name, betrag })
  });
  const data = await res.json().catch(()=>({}));
  if(res.ok && data.success){
    if(msg) msg.innerText = data.isNew
      ? `✅ Neue Karte für "${data.karte.name}" erstellt — Guthaben: ${money(data.karte.balance)}`
      : `✅ Guthaben aufgeladen — "${data.karte.name}" hat jetzt ${money(data.karte.balance)}`;
    document.getElementById("guthabenName").value = "";
    document.getElementById("guthabenBetrag").value = "";
    loadGuthabenKarten();
  } else {
    if(msg) msg.innerText = data.message || "Fehler.";
  }
}

let _guthabenPayData = null;

let _allGuthabenKarten = [];

async function openGuthabenPay(){
  if(!currentRegister) return alert("Bitte zuerst eine Kasse wählen.");
  if(cart.length === 0) return alert("Warenkorb ist leer.");
  _guthabenPayData = null;

  // Preload all cards for live search
  try{
    const res = await fetch("/guthaben-karten");
    const data = await res.json().catch(()=>({}));
    _allGuthabenKarten = data.karten || [];
  }catch(e){ _allGuthabenKarten = []; }

  document.getElementById("guthabenPayName").value = "";
  document.getElementById("guthabenPaySuggestions").innerHTML = "";
  document.getElementById("guthabenPayInfo").style.display = "none";
  document.getElementById("guthabenPayMsg").innerText = "—";
  document.getElementById("guthabenPayBtn").disabled = true;
  document.getElementById("guthabenPayOverlay").classList.remove("hidden");
  setTimeout(() => document.getElementById("guthabenPayName")?.focus(), 100);
}

function onGuthabenSearch(){
  const q = document.getElementById("guthabenPayName")?.value?.toLowerCase().trim() || "";
  const list = document.getElementById("guthabenPaySuggestions");
  // Reset state when typing
  _guthabenPayData = null;
  document.getElementById("guthabenPayInfo").style.display = "none";
  document.getElementById("guthabenPayBtn").disabled = true;
  document.getElementById("guthabenPayMsg").innerText = "—";

  if(!q){ list.innerHTML = ""; return; }
  const matches = _allGuthabenKarten.filter(k => k.name.toLowerCase().includes(q));
  if(!matches.length){ list.innerHTML = `<div class="guthabenSugItem muted small">Keine Karte gefunden.</div>`; return; }
  list.innerHTML = matches.map(k => `
    <div class="guthabenSugItem" data-name="${esc(k.name)}">
      <span style="font-weight:900;">${esc(k.name)}</span>
      <span style="color:${k.balance>0?"#22c55e":"#ef4444"}; font-weight:900;">${money(k.balance)}</span>
    </div>
  `).join("");
  list.querySelectorAll(".guthabenSugItem[data-name]").forEach(el => {
    el.addEventListener("mousedown", e => { e.preventDefault(); selectGuthabenKarte(el.dataset.name); });
  });
}

function selectGuthabenKarte(name){
  document.getElementById("guthabenPayName").value = name;
  document.getElementById("guthabenPaySuggestions").innerHTML = "";
  checkGuthabenBalance();
}

function closeGuthabenPay(){
  document.getElementById("guthabenPayOverlay").classList.add("hidden");
  _guthabenPayData = null;
}

async function checkGuthabenBalance(){
  const name = document.getElementById("guthabenPayName")?.value?.trim();
  const msg = document.getElementById("guthabenPayMsg");
  const info = document.getElementById("guthabenPayInfo");
  const btn = document.getElementById("guthabenPayBtn");
  if(!name){ msg.innerText = "Bitte einen Namen eingeben."; return; }

  const res = await fetch(`/guthaben-karten/check?name=${encodeURIComponent(name)}`);
  const data = await res.json().catch(()=>({}));

  if(!data.success){ msg.innerText = "Fehler beim Abfragen."; return; }
  if(!data.found){ msg.innerText = `❌ Keine Karte gefunden für "${name}".`; info.style.display="none"; btn.disabled=true; return; }

  const total = cartTotal();
  _guthabenPayData = data;
  document.getElementById("guthabenPayBalance").innerText = money(data.balance);
  document.getElementById("guthabenPaySummary").innerText =
    `Warenkorb: ${money(total)} — Verbleibendes Guthaben: ${money(data.balance - total)}`;

  if(data.balance < total){
    msg.innerText = `❌ Guthaben reicht nicht aus (fehlen ${money(total - data.balance)}).`;
    btn.disabled = true;
  } else {
    msg.innerText = "✅ Guthaben ausreichend.";
    btn.disabled = false;
  }
  info.style.display = "block";
}

async function confirmGuthabenPay(){
  if(!_guthabenPayData) return;
  const total = cartTotal();
  const name = _guthabenPayData.name;

  const payRes = await fetch("/guthaben-karten/pay", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ name, amount: total })
  });
  const payData = await payRes.json().catch(()=>({}));
  if(!payRes.ok || !payData.success){
    document.getElementById("guthabenPayMsg").innerText = payData.message || "Fehler beim Bezahlen.";
    return;
  }

  // $0 sale — Lagerabzug passiert, Umsatz wurde beim Aufladen gebucht
  const salePayload = {
    register: currentRegister,
    items: cart.map(x => ({ name:x.name, price:0, qty:x.qty, productId:x.productId||null, components:x.components||null })),
    total: 0,
    paidAmount: 0,
    time: new Date().toISOString(),
    paymentMethod: "guthaben",
    guthabenName: name,
    staffOrder: true
  };
  await fetch("/sale", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(salePayload) });

  closeGuthabenPay();
  cartsByRegister[currentRegister] = [];
  switchCartToRegister(currentRegister);
  renderCart();
  saveCartsDebounced();
  alert(`✅ Bezahlt mit Guthaben von "${name}" — Verbleibendes Guthaben: ${money(payData.balance)}`);
}

/* ===== TIP PAYOUTS ===== */
function openTipPayout(){
  if(!isBoss()) return;
  if(!currentWeekReport) return alert("Bitte zuerst eine Wochenabrechnung laden.");
  const kw = document.getElementById("weekKW")?.value || "";
  document.getElementById("tipPayoutWeekLabel").innerText = "KW: " + kw;

  const employees = (currentWeekReport.byEmployee || []).filter(x => Number(x.tips) > 0);
  const body = document.getElementById("tipPayoutBody");
  if(!employees.length){
    body.innerHTML = `<tr><td colspan="3" class="muted small">Kein Trinkgeld diese Woche.</td></tr>`;
  } else {
    body.innerHTML = employees.map(x => `
      <tr>
        <td>${esc(x.employee || x.employeeUsername || "")}</td>
        <td style="text-align:right;">${money(x.tips||0)}</td>
        <td style="text-align:right;">
          <input class="input tipPayoutAmount" data-username="${escAttr(x.employeeUsername||"")}" data-name="${escAttr(x.employee||"")}"
            type="number" step="0.01" min="0" value="${Number(x.tips||0).toFixed(2)}"
            style="width:100px; text-align:right;" />
        </td>
      </tr>
    `).join("");
  }
  document.getElementById("tipPayoutMsg").innerText = "—";
  document.getElementById("tipPayoutOverlay").classList.remove("hidden");
}

function closeTipPayout(){
  document.getElementById("tipPayoutOverlay").classList.add("hidden");
}

async function confirmTipPayout(){
  const kw = document.getElementById("weekKW")?.value || "";
  const msg = document.getElementById("tipPayoutMsg");
  const inputs = Array.from(document.querySelectorAll(".tipPayoutAmount"));
  const entries = inputs.map(inp => ({
    employeeUsername: inp.getAttribute("data-username"),
    employee: inp.getAttribute("data-name"),
    amount: Number(inp.value) || 0
  })).filter(e => e.amount > 0);

  if(!entries.length){ if(msg) msg.innerText = "Keine Beträge eingetragen."; return; }

  const res = await fetch("/tip-payouts", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ week: kw, entries })
  });
  const data = await res.json().catch(()=>({}));
  if(res.ok && data.success){
    closeTipPayout();
    alert("✅ Trinkgeld-Auszahlung gespeichert!");
  } else {
    if(msg) msg.innerText = data.message || "Fehler beim Speichern.";
  }
}

async function loadTipPayouts(){
  const body = document.getElementById("tipPayoutsBody");
  if(!body) return;
  try{
    const res = await fetch("/tip-payouts");
    const data = await res.json().catch(()=>({}));
    const payouts = data.payouts || [];
    if(!payouts.length){
      body.innerHTML = `<tr><td colspan="5" class="muted small">Noch keine Auszahlungen.</td></tr>`;
      return;
    }
    // Flatten: one row per employee per payout
    const rows = [];
    for(const p of payouts){
      for(const e of p.entries){
        rows.push(`<tr>
          <td>${esc(fmtDateTime(p.ts))}</td>
          <td>${esc(p.week||"")}</td>
          <td>${esc(e.employee||e.employeeUsername||"")}</td>
          <td style="text-align:right;">${money(e.amount||0)}</td>
          <td>${esc(p.byName||p.by||"")}</td>
        </tr>`);
      }
    }
    body.innerHTML = rows.join("");
  }catch(e){
    body.innerHTML = `<tr><td colspan="5" class="muted small">Fehler beim Laden.</td></tr>`;
  }
}

/* ===== BANK BALANCE ===== */
async function loadBankBalance(){
  try{
    const res = await fetch("/bank-balance");
    const data = await res.json().catch(()=>({}));
    const el = document.getElementById("bankBalance");
    if(!el) return;
    if(data.success && data.balance !== null){
      el.innerText = money(data.balance);
      const hint = data.updatedAt ? ` (${fmtDateTime(data.updatedAt)})` : "";
      el.title = "Zuletzt aktualisiert" + hint;
    } else {
      el.innerText = "—";
    }
  }catch(e){}
}

function openBankEdit(){
  const el = document.getElementById("bankBalance");
  const cur = el?.innerText?.replace(/[^0-9.-]/g,"") || "";
  document.getElementById("bankInput").value = cur && cur !== "—" ? cur : "";
  document.getElementById("bankNote").value = "";
  document.getElementById("bankMsg").innerText = "—";
  document.getElementById("bankOverlay").classList.remove("hidden");
  setTimeout(()=>document.getElementById("bankInput")?.focus(), 100);
}
function closeBankEdit(){ document.getElementById("bankOverlay").classList.add("hidden"); }

async function saveBankBalance(){
  const val = Number(document.getElementById("bankInput").value);
  const note = document.getElementById("bankNote")?.value || "";
  const msg = document.getElementById("bankMsg");
  if(!Number.isFinite(val)){ if(msg) msg.innerText = "Bitte einen gültigen Betrag eingeben."; return; }
  const res = await fetch("/bank-balance",{ method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ balance: val, note }) });
  const data = await res.json().catch(()=>({}));
  if(res.ok && data.success){
    closeBankEdit();
    loadBankBalance();
    loadBankHistory();
  } else {
    if(msg) msg.innerText = data.message || "Fehler beim Speichern.";
  }
}

function toggleSection(id){
  const el = document.getElementById(id);
  const arrow = document.getElementById(id + "Arrow");
  if(!el) return;
  el.classList.toggle("hidden");
  if(arrow) arrow.style.transform = el.classList.contains("hidden") ? "" : "rotate(180deg)";
}

async function loadStaffConsumption(){
  const body = document.getElementById("staffConsumptionBody");
  if(!body) return;
  body.innerHTML = `<div class="muted small">Lade...</div>`;
  try{
    const res = await fetch("/reports/staff-consumption");
    const data = await res.json().catch(()=>({}));
    const entries = data.entries || [];
    if(!entries.length){
      body.innerHTML = `<div class="muted small">Noch kein Mitarbeiter-Verzehr gebucht.</div>`;
      return;
    }
    body.innerHTML = entries.map(e => `
      <div style="margin-bottom:16px; padding:12px; background:rgba(255,255,255,.04); border-radius:8px;">
        <div style="font-weight:900; margin-bottom:8px; font-size:15px;">${esc(e.name)} <span class="muted small">(${e.orders} Buchung${e.orders!==1?"en":""})</span></div>
        ${(e.bookings||[]).map(b => `
          <div style="display:flex; align-items:flex-start; gap:10px; padding:6px 0; border-bottom:1px solid rgba(255,255,255,.06);">
            <div style="min-width:110px; color:#60a5fa; font-size:12px; font-weight:700; padding-top:2px;">
              📅 ${esc(b.date||"—")}<br><span class="muted" style="font-size:11px;">${esc(b.time||"")}</span>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:4px;">
              ${b.items.map(it => `<span style="background:rgba(255,255,255,.08); border-radius:6px; padding:2px 8px; font-size:13px;">${esc(it.name)} ×${it.qty}</span>`).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    `).join("");
  }catch(e){
    body.innerHTML = `<div class="muted small">Fehler beim Laden.</div>`;
  }
}

async function loadBankHistory(){
  const body = document.getElementById("bankHistoryBody");
  if(!body) return;
  try{
    const res = await fetch("/bank-balance/history");
    const data = await res.json().catch(()=>({}));
    const history = data.history || [];
    if(!history.length){
      body.innerHTML = `<tr><td colspan="5" class="muted small">Noch keine Einträge.</td></tr>`;
      return;
    }
    body.innerHTML = history.map(h => {
      const diffColor = h.diff === null ? "" : h.diff >= 0 ? "color:#22c55e;" : "color:#ef4444;";
      const diffStr = h.diff === null ? "—" : (h.diff >= 0 ? "+" : "") + money(h.diff);
      return `<tr>
        <td>${esc(fmtDateTime(h.ts))}</td>
        <td style="text-align:right; font-weight:900;">${money(h.balance)}</td>
        <td style="text-align:right; font-weight:900; ${diffColor}">${diffStr}</td>
        <td>${esc(h.note || "—")}</td>
        <td>${esc(h.byName || h.by || "—")}</td>
      </tr>`;
    }).join("");
  }catch(e){
    body.innerHTML = `<tr><td colspan="5" class="muted small">Fehler beim Laden.</td></tr>`;
  }
}

/* ===== STAFF ORDER ===== */
async function openStaffOrder(){
  if(!currentRegister) return alert("Bitte zuerst eine Kasse wählen.");
  if(cart.length === 0) return alert("Warenkorb ist leer.");

  // Fill employee dropdown
  const sel = document.getElementById("staffOrderEmployee");
  if(isBoss()){
    try{
      const res = await fetch("/users");
      const data = await res.json().catch(()=>({}));
      const users = data.users || [];
      sel.innerHTML = users.length
        ? users.map(u => `<option value="${escAttr(u.username)}">${esc(u.displayName||u.username)}</option>`).join("")
        : `<option value="${escAttr(me?.username||"")}">Ich (${esc(me?.displayName||"")})</option>`;
    }catch(e){
      sel.innerHTML = `<option value="${escAttr(me?.username||"")}">Ich (${esc(me?.displayName||"")})</option>`;
    }
  } else {
    // Mitarbeiter bucht für sich selbst
    sel.innerHTML = `<option value="${escAttr(me?.username||"")}">${esc(me?.displayName||me?.username||"")}</option>`;
  }

  // Show cart items
  const itemsDiv = document.getElementById("staffOrderItems");
  itemsDiv.innerHTML = cart.map(x =>
    `<div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid rgba(255,255,255,.07);">
      <span>${esc(x.name)}</span><span class="muted small">×${x.qty}</span>
    </div>`
  ).join("");

  document.getElementById("staffOrderMsg").innerText = "—";
  document.getElementById("staffOrderOverlay").classList.remove("hidden");
}

function closeStaffOrder(){
  document.getElementById("staffOrderOverlay").classList.add("hidden");
}

async function confirmStaffOrder(){
  const empSel = document.getElementById("staffOrderEmployee");
  const empUsername = empSel?.value || "";
  const empName = empSel?.options[empSel.selectedIndex]?.text || empUsername;
  const msg = document.getElementById("staffOrderMsg");

  const payload = {
    register: currentRegister,
    items: cart.map(x => ({ name:x.name, price:0, qty:x.qty, productId: x.productId||null, components: x.components||null })),
    total: 0,
    paidAmount: 0,
    time: new Date().toISOString(),
    staffOrder: true,
    staffEmployee: empUsername,
    staffEmployeeName: empName
  };

  const res = await fetch("/sale", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || !data.success){ if(msg) msg.innerText = data.message || "Fehler."; return; }

  closeStaffOrder();
  cartsByRegister[currentRegister] = [];
  switchCartToRegister(currentRegister);
  renderCart();
  saveCartsDebounced();
  alert("✅ Mitarbeiter-Verzehr gebucht für " + empName);
}

async function resetAllData(){
  if(!isBoss()) return;
  const ok = confirm("⚠️ ACHTUNG: Alle Verkäufe, Einkäufe, Trinkgelder und Tagesabschlüsse werden unwiderruflich gelöscht.\n\nLager und Mitarbeiter bleiben erhalten.\n\nWirklich fortfahren?");
  if(!ok) return;
  const res = await fetch("/reset/all-data", { method:"POST", headers:{"Content-Type":"application/json"} });
  const data = await res.json().catch(()=>({}));
  if(res.ok && data.success){
    alert("✅ Alle Abrechnungsdaten gelöscht.");
  } else {
    alert(data.message || "Fehler beim Zurücksetzen.");
  }
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
  "Slush": "slush.png",
  "Milchshake": "milchshake.png",
  "Splashy Drink": "splashy.png",
  "Donut": "burgershot_donut.png",
  "Caramel Sundae": "burgershot_sunday_caramel.png",
  "Chocolate Sundae": "burgershot_sunday_chocolate.png",
  "Strawberry Sundae": "burgershot_sunday_strawberry.png",
};

function getIconForProduct(p){
  const name = String(p?.name||"");
  const cat = String(p?.cat||p?.category||"");
  const lower = name.toLowerCase();

  // 0) product has its own icon field (Gruppen-Menü etc.)
  if(p.icon) return `/icons/${p.icon}`;

  // 1) exact match in PRODUCT_ICON map
  if(PRODUCT_ICON[name]) return `/icons/${PRODUCT_ICON[name]}`;

  // 2) case-insensitive match
  const keys = Object.keys(PRODUCT_ICON);
  const ciMatch = keys.find(k => k.toLowerCase() === lower);
  if(ciMatch) return `/icons/${PRODUCT_ICON[ciMatch]}`;

  // 3) partial match
  const partialMatch = keys.find(k => lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower));
  if(partialMatch) return `/icons/${PRODUCT_ICON[partialMatch]}`;

  return "";
}

function renderProducts(){
  const box=document.getElementById("products");
  if(!box) return;
  box.innerHTML="";
  let list = PRODUCTS.filter(p=>p.cat===currentCategory);

  // Menü tab: fixed row order — Regular → No Sides → Donut Box
  if(currentCategory === "Menü"){
    box.style.display = "flex";
    box.style.flexWrap = "wrap";
    box.style.alignContent = "start";

    const makeRow = (label) => {
      if(label){
        const lbl = document.createElement("div");
        lbl.style.cssText = "width:100%; font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:1px; color:var(--muted); margin:12px 0 4px; padding-top:10px; border-top:1px solid var(--border);";
        lbl.innerText = label;
        box.appendChild(lbl);
      }
      const row = document.createElement("div");
      row.style.cssText = "display:flex; flex-wrap:wrap; gap:8px; width:100%;";
      box.appendChild(row);
      return row;
    };

    const regular = list.filter(p=>!p.noSidesBox && !p.donutBox && !p.chickenBox && !p.germanBox && !p.soulCarwashBox && !p.specialBurgerBox);
    const noSides = list.filter(p=>p.noSidesBox);
    const donuts  = list.filter(p=>p.donutBox);

    const soulCarwash   = list.filter(p=>p.soulCarwashBox);
    const specialBurger = list.filter(p=>p.specialBurgerBox);
    if(regular.length)       renderProductList(regular,       makeRow(null));
    if(noSides.length)       renderProductList(noSides,       makeRow("No Sides"));
    if(soulCarwash.length)   renderProductList(soulCarwash,   makeRow("Little Seoul Carwash"));
    if(specialBurger.length) renderProductList(specialBurger, makeRow("Special Burger Menü"));
    if(donuts.length)        renderProductList(donuts,        makeRow("Donut Box"));
    return;
  }
  box.style.display = "";
  box.style.flexWrap = "";
  box.style.alignContent = "";
  renderProductList(list, box);
}

function renderProductList(list, box){
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
      addToCart(p);

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
    if(p.desc){
      const desc=document.createElement('div');
      desc.style.cssText='font-size:10px; color:var(--muted); line-height:1.3; margin-top:2px; text-align:center;';
      desc.textContent=p.desc;
      meta.appendChild(desc);
    }
    meta.appendChild(pr);

    // ⓘ info button — only show if zutaten exist for this product
    const infoBtn = document.createElement('button');
    infoBtn.innerHTML = 'ⓘ';
    infoBtn.title = 'Zutaten anzeigen';
    infoBtn.style.cssText = [
      'position:absolute','top:4px','right:4px',
      'width:20px','height:20px','border-radius:50%',
      'border:1px solid rgba(255,255,255,.3)',
      'background:rgba(0,0,0,.55)','color:#fff',
      'font-size:11px','font-weight:900','line-height:1',
      'cursor:pointer','display:flex','align-items:center',
      'justify-content:center','z-index:2','padding:0',
      'transition:background .15s'
    ].join(';');
    infoBtn.addEventListener('mouseenter', ()=>{ infoBtn.style.background='rgba(96,165,250,.8)'; });
    infoBtn.addEventListener('mouseleave', ()=>{ infoBtn.style.background='rgba(0,0,0,.55)'; });
    infoBtn.addEventListener('click', (e)=>{ e.stopPropagation(); showZutatenPopup(p.name); });
    imgWrap.style.position = 'relative';
    // Hide button if no zutaten entry exists (check cache, hide async if not loaded yet)
    infoBtn.style.display = 'none'; // hidden by default
    getZutatenCache().then(cache => {
      const hasEntry = cache.some(z => z.name.toLowerCase() === p.name.toLowerCase());
      infoBtn.style.display = hasEntry ? 'flex' : 'none';
    });
    imgWrap.appendChild(infoBtn);

    wrap.appendChild(imgWrap);
    wrap.appendChild(meta);
    box.appendChild(wrap);
  });
}

/* ============================
   ZUTATEN POPUP (POS)
   ============================ */
let _zutatenCache = null;

async function getZutatenCache(){
  if(_zutatenCache) return _zutatenCache;
  const res  = await fetch("/zutaten").catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  _zutatenCache = data.zutaten || [];
  return _zutatenCache;
}

async function showZutatenPopup(productName){
  const zutaten = await getZutatenCache();
  const entry = zutaten.find(z => z.name.toLowerCase() === productName.toLowerCase());

  let ov = document.getElementById('zutatenPopupOv');
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'zutatenPopupOv';
    ov.className = 'overlay hidden';
    ov.innerHTML = `
      <div class="overlayCard" style="max-width:480px; width:95%;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div style="font-weight:900; font-size:17px;" id="zutPopupTitle">Zutaten</div>
          <button class="ghost" style="padding:4px 10px;" onclick="document.getElementById('zutatenPopupOv').classList.add('hidden')">✕</button>
        </div>
        <div id="zutPopupBody"></div>
      </div>`;
    document.body.appendChild(ov);
  }

  document.getElementById('zutPopupTitle').innerText = '🍔 ' + productName;
  const body = document.getElementById('zutPopupBody');

  if(!entry){
    body.innerHTML = '<div class="muted small" style="padding:8px 0;">Keine Zutatenliste hinterlegt.</div>';
  } else {
    const tags = entry.ingredients.split(',').map(i =>
      `<span style="display:inline-block;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:4px 10px;font-size:13px;margin:4px 4px 0 0;">${i.trim()}</span>`
    ).join('');
    body.innerHTML = `<div style="line-height:2;">${tags}</div>`;
  }
  ov.classList.remove('hidden');
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
  const panel = document.querySelector('.posCartPanel');
  if(!panel) return;
  panel.classList.remove('cartPulse');
  void panel.offsetWidth;
  panel.classList.add('cartPulse');
}

/* Cart */
function addToCart(p){
  if(String(p?.cat||p?.category||"")==="Menü"){
    if(p.germanBox || p.noSidesBox){
      openGroupMenu(p);
      return;
    }
    if(p.donutBox){
      // No selection needed — just add qty of donuts
      const size = p.groupSize || 1;
      const displayName = `${p.name} | 🍩 ${size}× Donut`;
      cart.push({ name: displayName, price: p.price, qty:1, productId: p.id,
        components:[{ productId:"donut", qty: size }] });
      renderCart(); saveCartsDebounced(); sendPresencePing(); renderPresenceWarning();
      return;
    }
    if(p.specialBurgerBox){
      // Special Burger fixed + side + dessert + drink selection
      openGroupMenu(p);
      return;
    }
    if(p.id === "lsc_xl" || p.soulCarwashBox){
      // Fixed: 10× Heartstopper + 10× Milchshake
      const size = p.groupSize || 10;
      const displayName = `${p.name} | 💜 ${size}× The Heartstopper & ${size}× Milchshake`;
      cart.push({ name: displayName, price: p.price, qty:1, productId: p.id,
        components:[{ productId:"heartstopper", qty: size }, { productId:"milchshake", qty: size }] });
      renderCart(); saveCartsDebounced(); sendPresencePing(); renderPresenceWarning();
      return;
    }
    openGroupMenu(p);
    return;
  }
  const productId = p.id || (PRODUCTS||[]).find(x=>x.name===p.name)?.id || slugKey(p);
  // Merge with existing cart item if same product
  const existing = cart.find(x => x.productId === productId && !x.components);
  if(existing){ existing.qty = (existing.qty||1) + 1; }
  else { cart.push({ name: p.name, price: p.price, qty: 1, productId: productId }); }
  renderCart();
  saveCartsDebounced();
  sendPresencePing();
  renderPresenceWarning();
  updateRegisterDisplay();
}

function clearCart(){ cartsByRegister[currentRegister]=[]; if(currentRegister){ if(currentRegister){ switchCartToRegister(currentRegister); renderCart(); } } saveCartsDebounced(); }
function cartTotal(){ if(!Array.isArray(cart)) return 0; return cart.reduce((s,x)=>s+x.price*x.qty,0); }

function renderCart(){
  const box=document.getElementById("cart");
  const tot=document.getElementById("cartTotal");
  if(tot) tot.innerText=money(cartTotal());
  if(!box) return;
  if(!Array.isArray(cart)) cart=[];
  if(cart.length===0){ box.innerHTML=`<div class="cartEmpty">Leer.</div>`; return; }
  box.innerHTML=cart.map((x,idx)=>`
    <div class="cartItem">
      <div class="name">${esc(x.name)}</div>
      <div style="display:flex; gap:6px; align-items:center;">
        <button class="qtyBtn" onclick="changeQty(${idx},-1)">−</button>
        <input class="qtyInput" type="number" min="1" value="${x.qty}"
          onchange="setQty(${idx}, this.value)"
          onclick="this.select()"
          style="width:42px; text-align:center; padding:2px 4px; font-size:13px;
                 background:rgba(0,0,0,.25); border:1px solid rgba(255,255,255,.2);
                 border-radius:6px; color:#1b1b1b; font-weight:900;" />
        <button class="qtyBtn" onclick="changeQty(${idx},1)">+</button>
        <div class="price">${money(x.price * x.qty)}</div>
        <button class="pushBtn" style="width:26px; height:22px;" onclick="removeItem(${idx})">×</button>
      </div>
    </div>`).join("");
}
function removeItem(idx){ cart.splice(idx,1); renderCart(); saveCartsDebounced(); }

function changeQty(idx, delta){
  if(!cart[idx]) return;
  const newQty = (cart[idx].qty || 1) + delta;
  if(newQty <= 0){ cart.splice(idx,1); }
  else { cart[idx].qty = newQty; }
  renderCart(); saveCartsDebounced();
}

function setQty(idx, val){
  if(!cart[idx]) return;
  const n = parseInt(val);
  if(!Number.isFinite(n) || n <= 0){ cart.splice(idx,1); }
  else { cart[idx].qty = n; }
  renderCart(); saveCartsDebounced();
}

// Mobile UX: collapse/expand cart panel
function toggleCart(){
  const panel = document.querySelector('.posCartPanel');
  if(!panel) return;
  panel.classList.toggle('counterCollapsed');
}

/* Register */
function setRegister(n){
  const desired = Number(n) || 1;
  const prev = currentRegister ? Number(currentRegister) : null;

  // Toggle: clicking the active register releases it
  if(desired === prev){
    currentRegister = null;
    const d=document.getElementById("registerDisplay");
    if(d) d.innerText="Kasse —";
    syncActiveRegisterButton(null);
    sendPresenceLeave();
    renderPresenceWarning();
    return;
  }

  // Always check if another user is on the desired register
  const others = getOtherUsersOnRegister(desired);
  if(others && others.length){
    const names = others.map(o=>o.name).join(', ');
    showRegisterBlocked(desired, names);
    setTimeout(()=>{ syncActiveRegisterButton(prev); updateRegisterDisplay(); }, 0);
    return;
  }
  currentRegister = desired;
  const d=document.getElementById("registerDisplay");
  if(d) d.innerText="Kasse " + currentRegister;
  switchCartToRegister(currentRegister);
  renderCart();
  saveCartsDebounced();
  sendPresencePing();
  renderPresenceWarning();
}



/* Pay overlay */

let _groupMenuProduct = null;
let _groupSelections = { burgers:{}, fries:{}, drinks:{} };

function openGroupMenu(p){
  _groupMenuProduct = p;
  const size = p.groupSize || 1;
  _groupSelections = { burgers:{}, fries:{}, drinks:{} };

  document.getElementById("groupMenuTitle").innerText = p.name + " — " + money(p.price);
  document.getElementById("groupMenuDesc").innerText = p.desc || "";

  const drinks = (PRODUCTS||[]).filter(x => x.cat === "Getränke");

  if(p.specialBurgerBox){
    // Pre-fill Special Burger, show side + dessert + drink
    _groupSelections.burgers["special_burger"] = size;
    document.getElementById("groupBurgerSection").style.display = "none";
    // Sides: all Beilagen + Desserts
    const sidesAndDesserts = (PRODUCTS||[]).filter(x => x.cat === "Beilagen" || (x.cat === "Süßes" && x.name && x.name.toLowerCase().includes("sundae")) || x.cat === "Süßes");
    document.getElementById("groupFriesSection").style.display = "";
    document.getElementById("groupFriesSection").querySelector("div:first-child").innerText = "🍟 Side & Dessert nach Wahl";
    renderGroupSection("groupFriesList", sidesAndDesserts, "fries", size);
    renderGroupSection("groupDrinkList", drinks, "drinks", size);
  } else if(p.chickenBox){
    // Pre-fill burger + nuggets, only show drinks
    _groupSelections.burgers["chicken"] = size;
    _groupSelections.fries["chicken_nuggets"] = size;
    document.getElementById("groupBurgerSection").style.display = "none";
    document.getElementById("groupFriesSection").style.display = "none";
    renderGroupSection("groupDrinkList", drinks, "drinks", size);
  } else if(p.noSidesBox){
    // Only burger and drink selection
    document.getElementById("groupBurgerSection").style.display = "";
    document.getElementById("groupFriesSection").style.display = "none";
    _groupSelections.fries = { "__none": 0 }; // skip fries requirement
    const burgers = (PRODUCTS||[]).filter(x => x.cat === "Burger" && x.id !== "special_burger");
    renderGroupSection("groupBurgerList", burgers, "burgers", size);
    renderGroupSection("groupDrinkList", drinks, "drinks", size);
  } else if(p.germanBox){
    // Pre-fill german + coleslaw, only show drinks
    _groupSelections.burgers["german"] = size;
    _groupSelections.fries["coleslaw"] = size;
    document.getElementById("groupBurgerSection").style.display = "none";
    document.getElementById("groupFriesSection").style.display = "none";
    renderGroupSection("groupDrinkList", drinks, "drinks", size);
  } else {
    const burgers = (PRODUCTS||[]).filter(x => x.cat === "Burger");
    const fries   = (PRODUCTS||[]).filter(x => x.cat === "Beilagen" || (x.cat === "Süßes" && x.name && x.name.toLowerCase().includes("sundae")));
    document.getElementById("groupBurgerSection").style.display = "";
    document.getElementById("groupFriesSection").style.display = "";
    renderGroupSection("groupBurgerList", burgers, "burgers", size);
    renderGroupSection("groupFriesList",  fries,   "fries",   size);
    renderGroupSection("groupDrinkList",  drinks,  "drinks",  size);
  }

  updateGroupCounters(size);
  document.getElementById("groupMenuOverlay").classList.remove("hidden");
}

function renderGroupSection(containerId, items, key, size){
  const el = document.getElementById(containerId);
  if(!el) return;
  el.innerHTML = items.map(item => `
    <div style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,.06); border-radius:8px; padding:6px 10px;">
      <span style="font-size:13px; font-weight:700;">${esc(item.name)}</span>
      <button onclick="groupAdjust('${key}','${escAttr(item.id)}','${escAttr(item.name)}',-1)" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:rgba(255,255,255,.1);cursor:pointer;font-weight:900;">−</button>
      <span id="gqty_${key}_${escAttr(item.id)}" style="min-width:20px;text-align:center;font-weight:900;">0</span>
      <button onclick="groupAdjust('${key}','${escAttr(item.id)}','${escAttr(item.name)}',1)" style="width:24px;height:24px;border-radius:6px;border:1px solid var(--border);background:rgba(255,255,255,.1);cursor:pointer;font-weight:900;">+</button>
    </div>
  `).join("");
}

function groupAdjust(key, id, name, delta){
  const size = _groupMenuProduct?.groupSize || 1;
  if(!_groupSelections[key]) _groupSelections[key] = {};
  const current = _groupSelections[key][id] || 0;
  const total = Object.values(_groupSelections[key]).reduce((s,v)=>s+v,0);
  const newVal = current + delta;
  if(newVal < 0) return;
  if(delta > 0 && total >= size) return; // cap at groupSize
  _groupSelections[key][id] = newVal;
  if(_groupSelections[key][id] === 0) delete _groupSelections[key][id];
  const el = document.getElementById(`gqty_${key}_${id}`);
  if(el) el.innerText = _groupSelections[key][id] || 0;
  updateGroupCounters(size);
}

function updateGroupCounters(size){
  const isFixedMenu = _groupMenuProduct?.chickenBox || _groupMenuProduct?.germanBox;
  const isNoSides = _groupMenuProduct?.noSidesBox;
  const isChicken = isFixedMenu;
  const b = Object.values(_groupSelections.burgers).reduce((s,v)=>s+v,0);
  const f = Object.values(_groupSelections.fries).reduce((s,v)=>s+v,0);
  const d = Object.values(_groupSelections.drinks).reduce((s,v)=>s+v,0);
  if(!isChicken){
    document.getElementById("groupBurgerCounter").innerText = `${b} / ${size}`;
    document.getElementById("groupFriesCounter").innerText  = `${f} / ${size}`;
  }
  document.getElementById("groupDrinkCounter").innerText = `${d} / ${size}`;
  const isSpecialBurger = !!_groupMenuProduct?.specialBurgerBox;
  const ok = isSpecialBurger ? (f===size && d===size) : isChicken ? d===size : isNoSides ? (b===size && d===size) : (b===size && f===size && d===size);
  document.getElementById("groupMenuConfirmBtn").disabled = !ok;
  const msg = document.getElementById("groupMenuMsg");
  if(msg){
    if(ok) msg.innerText = "✅ Auswahl vollständig";
    else if(isChicken) msg.innerText = `Noch: ${size-d} Getränke`;
    else if(isNoSides) msg.innerText = `Noch: ${size-b} Burger, ${size-d} Getränke`;
    else msg.innerText = `Noch: ${size-b} Burger, ${size-f} Fries, ${size-d} Getränke`;
  }
}

function closeGroupMenu(){
  document.getElementById("groupMenuOverlay").classList.add("hidden");
  _groupMenuProduct = null;
}

function confirmGroupMenu(){
  if(!_groupMenuProduct) return;
  const p = _groupMenuProduct;
  const size = p.groupSize || 1;

  const isFixedMenu = p.chickenBox || p.germanBox;
  const _isNoSides = p.noSidesBox;
  // Build components for inventory deduction
  const components = [];
  for(const [id, qty] of Object.entries(_groupSelections.burgers)) if(qty>0) components.push({productId:id, qty});
  for(const [id, qty] of Object.entries(_groupSelections.fries))   if(qty>0) components.push({productId:id, qty});
  for(const [id, qty] of Object.entries(_groupSelections.drinks))  if(qty>0) components.push({productId:id, qty});

  const drinkNames = Object.entries(_groupSelections.drinks).filter(([,q])=>q>0).map(([id,q])=>{
    const prod = (PRODUCTS||[]).find(x=>x.id===id);
    return (q>1?q+"× ":"")+(prod?.name||id);
  }).join(", ");

  let displayName;
  if(p.specialBurgerBox){
    const sideNames2 = Object.entries(_groupSelections.fries).filter(([,q])=>q>0).map(([id,q])=>{ const pr=(PRODUCTS||[]).find(x=>x.id===id); return (q>1?q+'× ':'')+( pr?.name||id); }).join(', ');
    displayName = `${p.name} | 🍔 ${size}× Special Burger | 🍟 ${sideNames2} | 🥤 ${drinkNames}`;
  } else if(p.chickenBox){
    displayName = `${p.name} | 🍗 ${size}× The Chicken | 🍗 ${size}× Chicken Nuggets | 🥤 ${drinkNames}`;
  } else if(p.germanBox){
    displayName = `${p.name} | 🇩🇪 ${size}× The German | 🥗 ${size}× Coleslaw | 🥤 ${drinkNames}`;
  } else if(p.noSidesBox){
    const burgerNames2 = Object.entries(_groupSelections.burgers).filter(([,q])=>q>0).map(([id,q])=>{ const pr=(PRODUCTS||[]).find(x=>x.id===id); return (q>1?q+'× ':'')+( pr?.name||id); }).join(', ');
    displayName = `${p.name} | 🍔 ${burgerNames2} | 🥤 ${drinkNames}`;
  } else {
    const burgerNames = Object.entries(_groupSelections.burgers).filter(([,q])=>q>0).map(([id,q])=>{
      const prod = (PRODUCTS||[]).find(x=>x.id===id);
      return (q>1?q+"× ":"")+(prod?.name||id);
    }).join(", ");
    const friesNames = Object.entries(_groupSelections.fries).filter(([,q])=>q>0).map(([id,q])=>{
      const prod = (PRODUCTS||[]).find(x=>x.id===id);
      return (q>1?q+"× ":"")+(prod?.name||id);
    }).join(", ");
    displayName = `${p.name} | 🍔 ${burgerNames} | 🍟 ${friesNames} | 🥤 ${drinkNames}`;
  }
  cart.push({ name: displayName, price: p.price, qty:1, productId: p.id, components });
  closeGroupMenu();
  renderCart(); saveCartsDebounced();
  sendPresencePing(); renderPresenceWarning();
}


let _currentDiscount = 0;
let _currentDiscountId = null; // percent
let _bahamaMamas = false; // flat $10 per burger for Bahama Mama's
let _littleSeoul = false;  // flat Heartstopper $16, Milchshake $10 for Little Seoul

const DISCOUNTS = {
  0:  { label: "Kein Rabatt", id: "discBtn0" },
  15: { label: "LSPD −15%",  id: "discBtn15" },
  20: { label: "LSMD −20%",  id: "discBtn20" },
  10: { label: "DOJ −10%",   id: "discBtn10" },
  "taxi10": { label: "Taxi −10%", id: "discBtnTaxi", pct: 10 }
};

function openPay(){
  if(!currentRegister) return alert("Bitte zuerst eine Kasse wählen.");
  if(cart.length===0) return alert("Warenkorb ist leer.");
  _currentDiscount = 0;
  _currentDiscountId = null;
  _bahamaMamas = false;
  _littleSeoul = false;
  updatePayOverlay();
  document.getElementById("payAmount").value = "";
  const cashCb = document.getElementById("payIsCash"); if(cashCb) cashCb.checked = false;
  const delivCb = document.getElementById("payIsDelivery"); if(delivCb) delivCb.checked = false;
  document.getElementById("payOverlay").classList.remove("hidden");
}

const BAHAMA_BURGER_IDS = ["heartstopper","chicken","vegan_burger"];
const SEOUL_PRICES = { "heartstopper": 16, "milchshake": 10 };

function applyBahamaMamas(){
  _bahamaMamas = !_bahamaMamas;
  if(_bahamaMamas){ _littleSeoul = false; _currentDiscount = 0; _currentDiscountId = null; }
  updatePayOverlay();
}

function applyLittleSeoul(){
  _littleSeoul = !_littleSeoul;
  if(_littleSeoul){ _bahamaMamas = false; _currentDiscount = 0; _currentDiscountId = null; }
  updatePayOverlay();
}

function applyDiscount(pct, id){
  _bahamaMamas = false;
  _littleSeoul = false;
  _currentDiscount = pct;
  _currentDiscountId = id || null;
  updatePayOverlay();
}

function updatePayOverlay(){
  const original = cartTotal();
  const discAmt = Math.round(original * _currentDiscount / 100);
  const deliveryFee = document.getElementById("payIsDelivery")?.checked ? 50 : 0;

  // Little Seoul flat prices
  let seoulDisc = 0;
  if(_littleSeoul){
    for(const item of (cart||[])){
      const pid = item.productId || "";
      if(SEOUL_PRICES[pid] !== undefined){
        seoulDisc += Math.max(0, item.price - SEOUL_PRICES[pid]) * (item.qty || 1);
      }
    }
  }

  // Bahama Mama's: calculate burger discount
  let bahamaDisc = 0;
  if(_bahamaMamas){
    for(const item of (cart||[])){
      const pid = item.productId || "";
      if(BAHAMA_BURGER_IDS.includes(pid)){
        bahamaDisc += Math.max(0, item.price - 10) * (item.qty || 1);
      }
    }
  }

  const total = original - discAmt - bahamaDisc - seoulDisc + deliveryFee;

  document.getElementById("payOriginal").innerText = money(original);
  document.getElementById("payTotal").innerText = money(total);

  const discRow = document.getElementById("payDiscountRow");
  if(_currentDiscount > 0){
    discRow.style.display = "flex";
    document.getElementById("payDiscountLabel").innerText = `Rabatt ${_currentDiscount}%`;
    document.getElementById("payDiscountAmt").innerText = `−${money(discAmt)}`;
  } else {
    discRow.style.display = "none";
  }
  const bahamaRow = document.getElementById("payBahamaRow");
  if(bahamaRow){
    bahamaRow.style.display = _bahamaMamas && bahamaDisc > 0 ? "flex" : "none";
    const bahamaAmtEl = document.getElementById("payBahamaAmt");
    if(bahamaAmtEl) bahamaAmtEl.innerText = `−${money(bahamaDisc)}`;
  }
  const bahamaBtn = document.getElementById("discBtnBahama");
  if(bahamaBtn) bahamaBtn.classList.toggle("discountBtnActive", _bahamaMamas);
  const seoulRow = document.getElementById("paySeoulRow");
  if(seoulRow){
    seoulRow.style.display = _littleSeoul && seoulDisc > 0 ? "flex" : "none";
    const seoulAmtEl = document.getElementById("paySeoulAmt");
    if(seoulAmtEl) seoulAmtEl.innerText = `−${money(seoulDisc)}`;
  }
  const seoulBtn = document.getElementById("discBtnSeoul");
  if(seoulBtn) seoulBtn.classList.toggle("discountBtnActive", _littleSeoul);
  const delivRow = document.getElementById("payDeliveryRow");
  if(delivRow) delivRow.style.display = deliveryFee > 0 ? "flex" : "none";

  // Highlight active button
  Object.keys(DISCOUNTS).forEach(p => {
    const d = DISCOUNTS[p];
    const btn = document.getElementById(d.id);
    if(!btn) return;
    const isActive = _currentDiscountId
      ? d.id === (_currentDiscountId === "taxi" ? "discBtnTaxi" : `discBtn${_currentDiscount}`)
      : (Number(p) === _currentDiscount && p !== "taxi10");
    btn.classList.toggle("discountBtnActive", isActive);
  });
}

function closePay(){ document.getElementById("payOverlay").classList.add("hidden"); }
function parseMoney(val){ const s=String(val||"").replace(/[^\d.-]/g,""); const n=Number(s); return Number.isFinite(n)?n:NaN; }

async function submitPay(){
  const original = cartTotal();
  const discAmt = Math.round(original * _currentDiscount / 100);

  // Bahama Mama's flat-price discount
  let bahamaDisc = 0;
  if(_bahamaMamas){
    for(const item of (cart||[])){
      if(BAHAMA_BURGER_IDS.includes(item.productId||"")){
        bahamaDisc += Math.max(0, item.price - 10) * (item.qty || 1);
      }
    }
  }
  let seoulDisc = 0;
  if(_littleSeoul){
    for(const item of (cart||[])){
      const pid = item.productId||"";
      if(SEOUL_PRICES[pid] !== undefined){
        seoulDisc += Math.max(0, item.price - SEOUL_PRICES[pid]) * (item.qty || 1);
      }
    }
  }

  const isDelivery = document.getElementById("payIsDelivery")?.checked || false;
  const deliveryFee = isDelivery ? 50 : 0;
  const total = original - discAmt - bahamaDisc - seoulDisc + deliveryFee;
  const paid = parseMoney(document.getElementById("payAmount").value);
  if(!Number.isFinite(paid) || paid < total) return alert("Bezahlt muss >= Total sein.");

  const discountFactor = (total - deliveryFee) / (original || 1);
  const items = cart.map(x => {
    let itemPrice = x.price;
    if(_currentDiscount > 0){
      itemPrice = Math.round(x.price * discountFactor * 100) / 100;
    } else if(_bahamaMamas && BAHAMA_BURGER_IDS.includes(x.productId||"")){
      itemPrice = 10;
    } else if(_littleSeoul && SEOUL_PRICES[x.productId||""] !== undefined){
      itemPrice = SEOUL_PRICES[x.productId||""];
    }
    return { name: x.name, price: itemPrice, qty: x.qty, productId: x.productId||null, components: x.components||null };
  });
  if(isDelivery) items.push({ name: "🛵 Liefergebühr", price: 50, qty: 1, productId: null, components: null });

  const payload = {
    register: currentRegister,
    items,
    total: total - deliveryFee,
    paidAmount: paid,
    time: new Date().toISOString(),
    discount: _currentDiscount > 0 ? _currentDiscount : undefined,
    bahamaMamas: _bahamaMamas || undefined,
    isCash: document.getElementById("payIsCash")?.checked || false,
    isDelivery
  };
  const res = await fetch("/sale", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return alert(data.message || "Fehler beim Speichern.");
  closePay();
  const cashMsg = payload.isCash ? " 💵 BAR" : "";
  const delivMsg = payload.isDelivery ? " 🛵 Lieferung" : "";
  const tipMsg = data.tip > 0 ? ` — Trinkgeld: ${money(data.tip)}` : "";
  const discMsg = _currentDiscount > 0 ? ` (${_currentDiscount}% Rabatt)` : "";
  alert(`Order #${data.orderId||""} gespeichert${discMsg}${cashMsg}${delivMsg}${tipMsg}`);
  cartsByRegister[currentRegister]=[]; switchCartToRegister(currentRegister); renderCart(); saveCartsDebounced();
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
  return slugify(p.cat||p.category||"") + "__" + slugify(p.name||"");
}

/* Kitchen */

function formatElapsed(sec){
  sec = Math.max(0, Math.floor(sec||0));
  const m = Math.floor(sec/60);
  const s = sec%60;
  return String(m) + ":" + String(s).padStart(2,"0");
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

async function markCashTransferred(day, employeeUsername, employeeName){
  if(!day || !employeeUsername) return;
  if(!confirm(`BAR-Betrag von "${employeeName||employeeUsername}" für ${day} als verbucht markieren?`)) return;
  const res = await fetch("/cash-transferred", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ day, employeeUsername })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return alert(data.message || "Fehler.");
  alert(`✅ Verbucht! ${data.count} Buchung${data.count!==1?"en":""} markiert.`);
  loadDayReport();
}

async function openEditPurchaseCosts(){
  if(!isBoss()) return;
  const date    = document.getElementById("dayDate")?.value || serverDay;
  const current = document.getElementById("dayPurchases")?.innerText || "0";
  const val = prompt(`Einkaufskosten für ${date} korrigieren:

Aktueller Wert: ${current}`, current.replace(/[^0-9.]/g,""));
  if(val === null) return;
  const amount = parseFloat(val);
  if(!isFinite(amount) || amount < 0) return alert("Ungültiger Betrag.");
  const res  = await fetch("/reports/purchases-override", {
    method:"PUT", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ date, amount })
  }).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if(!data.success) return alert(data.message || "Fehler.");
  loadDayReport();
  loadBankBalance();
}

function openOrdersDetail(empUsername, empName){
  if(!currentDayReport || !isBoss()) return;
  const sales = (currentDayReport.sales || []).filter(s =>
    (s.employeeUsername || s.employee || "—") === empUsername
  ).sort((a,b) => String(a.time).localeCompare(String(b.time)));

  const ov = document.getElementById("ordersDetailOverlay");
  const title = document.getElementById("ordersDetailTitle");
  const body = document.getElementById("ordersDetailBody");
  if(!ov || !body) return;

  if(title) title.innerText = `Bestellungen — ${empName || empUsername}`;

  if(sales.length === 0){
    body.innerHTML = `<div class="muted small" style="padding:16px;">Keine Bestellungen.</div>`;
  } else {
    body.innerHTML = sales.map(s => {
      const d = new Date(s.time);
      const pad = n => String(n).padStart(2,'0');
      const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
      const isStaff = s.staffOrder || s.paymentMethod === "guthaben";
      const typeBadge = isStaff
        ? `<span style="background:rgba(251,191,36,.15); color:#fbbf24; border:1px solid rgba(251,191,36,.3); border-radius:6px; padding:2px 8px; font-size:11px; font-weight:900;">🍽️ Mitarbeiter-Verzehr</span>`
        : `<span style="background:rgba(34,197,94,.12); color:#22c55e; border:1px solid rgba(34,197,94,.25); border-radius:6px; padding:2px 8px; font-size:11px; font-weight:900;">👤 Kunde</span>`;
      const items = (s.items || []).map(it =>
        `<div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid rgba(255,255,255,.05);">
          <span>${esc(it.name)}${it.qty > 1 ? ` <span class="muted small">×${it.qty}</span>` : ''}</span>
          <span style="color:var(--muted); font-size:12px;">${money(it.price * it.qty)}</span>
        </div>`
      ).join('');
      const discount = s.discount ? `<div class="muted small" style="margin-top:4px;">Rabatt: ${s.discount}%</div>` : '';
      return `
        <div style="border:1px solid var(--border); border-radius:10px; padding:12px; margin-bottom:10px; background:rgba(255,255,255,.03);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="font-weight:900; font-size:15px;">🕐 ${timeStr}</div>
            ${typeBadge}
          </div>
          <div style="margin-bottom:8px;">${items}</div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,.1);">
            <span style="font-weight:900;">Total</span>
            <span style="font-weight:900; color:#22c55e;">${money(s.total)}</span>
          </div>
          ${discount}
        </div>`;
    }).join('');
  }
  ov.classList.remove('hidden');
}

function closeOrdersDetail(){
  document.getElementById("ordersDetailOverlay")?.classList.add("hidden");
}

async function loadExpenses(){
  const res = await fetch("/expenses").catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  const tbody = document.getElementById("expenseBody");
  if(!tbody) return;
  const list = data.expenses || [];
  // Set date default
  const dateInput = document.getElementById("expenseDate");
  if(dateInput && !dateInput.value) dateInput.value = serverDay || new Date().toISOString().slice(0,10);

  if(list.length === 0){
    tbody.innerHTML = `<tr><td colspan="6" class="muted small">Keine Einträge.</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(e => `
    <tr>
      <td class="muted small">${esc(String(e.date||"").slice(0,10))}</td>
      <td style="font-weight:900;">${esc(e.category||"")}</td>
      <td class="muted small">${esc(e.note||"—")}</td>
      <td style="text-align:right; font-weight:900; color:#ef4444;">-${money(e.amount)}</td>
      <td class="muted small">${esc(e.createdBy||"")}</td>
      <td><button class="ghost" style="font-size:11px; padding:2px 8px; color:#ef4444;" onclick="deleteExpense('${escAttr(e.id||"")}')">Löschen</button></td>
    </tr>
  `).join("");
}

async function submitExpense(){
  const category = document.getElementById("expenseCategory")?.value;
  const amount   = Number(document.getElementById("expenseAmount")?.value);
  const date     = document.getElementById("expenseDate")?.value || serverDay;
  const note     = document.getElementById("expenseNote")?.value || "";
  const msg      = document.getElementById("expenseMsg");
  if(!amount || amount <= 0){ if(msg) msg.innerText="Bitte Betrag eingeben."; return; }
  const res = await fetch("/expenses",{ method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({category,amount,date,note}) });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || !data.success){ if(msg) msg.innerText = data.message||"Fehler."; return; }
  if(msg) msg.innerText = "✅ Eingetragen.";
  document.getElementById("expenseAmount").value = "";
  document.getElementById("expenseNote").value = "";
  setTimeout(()=>{ if(msg) msg.innerText=""; }, 3000);
  loadExpenses();
  if(isBoss()) loadBankBalance();
}

async function deleteExpense(id){
  if(!confirm("Ausgabe wirklich löschen?")) return;
  await fetch(`/expenses/${encodeURIComponent(id)}`,{ method:"DELETE" });
  loadExpenses();
}

async function loadDayReport(){
  // Manager: read-only — hide edit controls
  const _dayCloseBtn = document.getElementById("dayCloseBtn");
  const _bankEditBtn = document.querySelector('[onclick="openBankEdit()"]');
  if(_dayCloseBtn) _dayCloseBtn.style.display = isBoss() ? "" : "none";
  if(_bankEditBtn) _bankEditBtn.style.display = isBoss() ? "" : "none";

  if(!isBossOrManager()) return;
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
  document.getElementById("dayPurchases").innerText=money(data.totals?.purchases||0);
  const expEl = document.getElementById("dayExpenses");
  if(expEl) expEl.innerText = (data.totals?.expenses||0) > 0 ? `-${money(data.totals.expenses)}` : "—";
  const expCardEl = document.getElementById("dayExpensesCard");
  if(expCardEl) expCardEl.innerText = (data.totals?.expenses||0) > 0 ? money(data.totals.expenses) : "—";
  document.getElementById("dayProfit").innerText=money(data.totals?.profit||0);
  const cashEl=document.getElementById("dayCash"); if(cashEl) cashEl.innerText=money(data.totals?.cashRevenue||0);

  const tbody=document.getElementById("dayByEmployee");
  if(tbody){
    tbody.innerHTML=(data.byEmployee||[]).map(x=>`
      <tr>
        <td>${esc(x.employee||x.employeeUsername||"")}</td>
        <td style="text-align:right;">${money(x.revenue||0)}</td>
        <td style="text-align:right;">${money(x.tips||0)}</td>
        <td style="text-align:right;">
          ${(x.cashRevenue||0)>0
            ? `<div style="display:flex; align-items:center; justify-content:flex-end; gap:6px;">
                <span style="color:#fbbf24; font-weight:900;">${money(x.cashRevenue)}</span>
                <button onclick="markCashTransferred('${escAttr(currentDayReport?.day||"")}','${escAttr(x.employeeUsername||x.employee||"")}','${escAttr(x.employee||"")}')"
                  style="padding:2px 8px; font-size:11px; background:#22c55e; color:#000; border:none; border-radius:6px; cursor:pointer; font-weight:900;">
                  ✓ Verbucht
                </button>
              </div>`
            : "—"}
        </td>
        <td style="text-align:right;">
          ${isBoss() ? `<span onclick="openOrdersDetail('${escAttr(x.employeeUsername||x.employee||"")}','${escAttr(x.employee||"")}')"
            style="cursor:pointer; color:#60a5fa; text-decoration:underline; font-weight:900;">${x.orders||0}</span>` : (x.orders||0)}
        </td>
      </tr>
    `).join("") || `<tr><td colspan="5" class="muted">Keine Daten.</td></tr>`;
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
  if(!me) return;
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

  if(isBoss() || isManager()){
    document.getElementById("weekRevenue").innerText=money(data.totals?.revenue||0);
    document.getElementById("weekPurchases").innerText=money(data.totals?.purchases||0);
    const weekExpEl = document.getElementById("weekExpenses");
    if(weekExpEl) weekExpEl.innerText = (data.totals?.expenses||0) > 0 ? money(data.totals.expenses) : "—";
    document.getElementById("weekProfit").innerText=money(data.totals?.profit||0);
    document.getElementById("weekOrders").innerText=String(data.totals?.orders||0);
  } else {
    // Staff: mask all totals
    document.getElementById("weekRevenue").innerText="—";
    document.getElementById("weekPurchases").innerText="—";
    const weekExpElErr = document.getElementById("weekExpenses");
    if(weekExpElErr) weekExpElErr.innerText="—";
    document.getElementById("weekProfit").innerText="—";
    document.getElementById("weekOrders").innerText="—";
  }

  const tbody=document.getElementById("weekByEmployee");
  if(tbody){
    const isPrivileged = isBoss() || isManager();
    const rows = data.byEmployee || [];
    tbody.innerHTML = rows.map(x=>`
        <tr>
          <td>${esc(x.employee||x.employeeUsername||"")}</td>
          <td style="text-align:right;">${isPrivileged ? money(x.revenue||0) : "—"}</td>
          <td style="text-align:right; font-weight:900; color:#22c55e;">${money(x.tips||0)}</td>
          <td style="text-align:right;">${isPrivileged ? (x.orders||0) : "—"}</td>
        </tr>
      `).join("") || `<tr><td colspan="4" class="muted">Keine Daten.</td></tr>`;
  }
}

/* Month report (Summe aus Wochen) */
let monthTabInited=false;
/* ============================
   SCHICHTPLAN
   ============================ */
/* ============================
   ZUTATEN TAB
   ============================ */
const ZUTAT_CATEGORIES = [
  { key:"Burger",    icon:"🍔" },
  { key:"Sides",     icon:"🍟" },
  { key:"Desserts",  icon:"🍩" },
  { key:"Drinks",    icon:"🥤" },
  { key:"Special Burger", icon:"🌟" },
];

async function loadZutaten(){
  const res  = await fetch("/zutaten").catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  const list = document.getElementById("zutatenList");
  if(!list) return;
  const items = data.zutaten || [];

  const groups = {};
  for(const cat of ZUTAT_CATEGORIES) groups[cat.key] = [];
  for(const z of items){
    const cat = z.category || "Sonstiges";
    if(!groups[cat]) groups[cat] = [];
    groups[cat].push(z);
  }

  list.innerHTML = ZUTAT_CATEGORIES.map(cat => {
    const entries = groups[cat.key] || [];
    if(entries.length === 0) return "";
    const rows = entries.map(z => {
      const tags = z.ingredients.split(",").map(i =>
        `<span style="display:inline-block;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:3px 9px;font-size:12px;margin:3px 3px 0 0;">${esc(i.trim())}</span>`
      ).join("");
      return `<div style="padding:12px 0; border-bottom:1px solid rgba(255,255,255,.06);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="font-weight:900; font-size:14px;">${esc(z.name)}</div>
          ${isBoss() ? `
          <div style="display:flex; gap:4px;">
            <button class="ghost" style="padding:2px 8px; font-size:12px;" onclick="editZutat('${escAttr(z.id)}','${escAttr(z.name)}','${escAttr(z.category||'')}','${escAttr(z.ingredients)}')">✏️</button>
            <button class="ghost" style="padding:2px 8px; color:#ef4444; font-size:12px;" onclick="deleteZutat('${escAttr(z.id)}')">🗑️</button>
          </div>` : ""}
        </div>
        <div>${tags}</div>
      </div>`;
    }).join("");
    const sid = `zutatcat_${cat.key}`;
    return `<div style="border:1px solid var(--border); border-radius:10px; margin-bottom:10px; overflow:hidden;">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; cursor:pointer; background:rgba(255,255,255,.04);"
          onclick="toggleZutatCat('${sid}')">
          <div style="font-weight:900; font-size:15px;">${cat.icon} ${cat.key} <span class="muted small">(${entries.length})</span></div>
          <span id="${sid}_arr" style="transition:transform .2s;">▼</span>
        </div>
        <div id="${sid}" style="padding:0 16px; display:none;">${rows}</div>
      </div>`;
  }).join("");
}

function toggleZutatCat(id){
  const el  = document.getElementById(id);
  const arr = document.getElementById(id+"_arr");
  if(!el) return;
  const open = el.style.display !== "none";
  el.style.display  = open ? "none" : "block";
  if(arr) arr.style.transform = open ? "" : "rotate(180deg)";
}

async function openAddZutat(){
  if(!isBoss()) return;
  const catOptions = ZUTAT_CATEGORIES.map((c,i) => `${i+1}. ${c.key}`).join("\n");
  const catIdx = prompt(`Kategorie wählen:\n${catOptions}\n\nNummer eingeben:`);
  if(!catIdx) return;
  const cat = ZUTAT_CATEGORIES[Number(catIdx)-1];
  if(!cat) return alert("Ungültige Kategorie.");
  const name = prompt(`Name (${cat.key}):`);
  if(!name) return;
  const ingredients = prompt(`Zutaten für "${name}" (kommagetrennt):`);
  if(!ingredients) return;
  const res = await fetch("/zutaten",{
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ name:name.trim(), category:cat.key, ingredients:ingredients.trim() })
  }).catch(()=>null);
  if(res?.ok) loadZutaten();
}

async function editZutat(id, currentName, currentCat, currentIngredients){
  if(!isBoss()) return;

  const catOptions = ZUTAT_CATEGORIES.map((c,i) => `${i+1}. ${c.key}`).join("\n");
  const currentCatIdx = ZUTAT_CATEGORIES.findIndex(c => c.key === currentCat) + 1;
  const catIdx = prompt(`Kategorie (aktuell: ${currentCat}):\n${catOptions}\n\nNummer eingeben (Enter = unverändert):`, currentCatIdx);
  if(catIdx === null) return;
  const cat = ZUTAT_CATEGORIES[Number(catIdx)-1] || ZUTAT_CATEGORIES.find(c=>c.key===currentCat);

  const name = prompt("Name:", currentName);
  if(name === null) return;

  const ingredients = prompt("Zutaten (kommagetrennt):", currentIngredients);
  if(ingredients === null) return;

  const res = await fetch(`/zutaten/${encodeURIComponent(id)}`, {
    method:"PUT",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ name: name.trim(), category: cat.key, ingredients: ingredients.trim() })
  }).catch(()=>null);
  if(res?.ok) loadZutaten();
}

async function deleteZutat(id){
  if(!isBoss()) return;
  if(!confirm("Eintrag löschen?")) return;
  await fetch(`/zutaten/${encodeURIComponent(id)}`,{ method:"DELETE" }).catch(()=>null);
  loadZutaten();
}

function initSchichtTab(){
  if(!isBoss()) return;
  const d = document.getElementById("schichtDate");
  if(d && !d.value) d.value = serverDay || new Date().toISOString().slice(0,10);
  loadSchichtplan();
}

function setSchichtToday(){
  const d = document.getElementById("schichtDate");
  if(d) d.value = serverDay || new Date().toISOString().slice(0,10);
  loadSchichtplan();
}

async function loadSchichtplan(){
  if(!isBoss()) return;
  const body = document.getElementById("schichtBody");
  if(!body) return;
  const date = document.getElementById("schichtDate")?.value || serverDay;
  if(!date) return;

  body.innerHTML = `<div class="muted small">Lade…</div>`;

  // Fetch users with firstLoginByDay + lastSeen from /users
  const res = await fetch("/users").catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if(!data.success){ body.innerHTML=`<div class="muted small">Fehler beim Laden.</div>`; return; }

  const users = (data.users||[]).filter(u => u.username);

  // Fetch day sales to get order count per employee
  const rRes = await fetch(`/reports/day-details?date=${encodeURIComponent(date)}`).catch(()=>null);
  const rData = rRes?.ok ? await rRes.json().catch(()=>({})) : {};
  const byEmp = {};
  for(const e of (rData.byEmployee||[])) byEmp[e.employeeUsername||e.employee] = e;

  const pad = n => String(n).padStart(2,'0');
  const fmtTime = iso => {
    if(!iso) return '—';
    const d = new Date(iso);
    return `${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
  };

  // Build rows
  const rows = users.map(u => {
    const firstToday = u.firstLoginToday || null;
    // Only show lastSeen if it was today
    const todayStr = document.getElementById("schichtDate")?.value || serverDay || new Date().toISOString().slice(0,10);
    const lastSeenRaw = u.lastSeen || null;
    const lastSeen = (lastSeenRaw && lastSeenRaw.slice(0,10) === todayStr) ? lastSeenRaw : null;
    const empData    = byEmp[u.username] || null;
    const orders     = empData?.orders || 0;
    const revenue    = empData?.revenue || 0;
    const wasActive  = !!firstToday;

    return { u, firstToday, lastSeen, orders, revenue, wasActive };
  }).sort((a,b) => {
    // Active employees first, then by first login time
    if(a.wasActive && !b.wasActive) return -1;
    if(!a.wasActive && b.wasActive) return 1;
    if(a.firstToday && b.firstToday) return a.firstToday.localeCompare(b.firstToday);
    return (a.u.displayName||'').localeCompare(b.u.displayName||'');
  });

  const roleLabel = { boss:'👑 Chef', manager:'⭐ Manager', staff:'👤 Mitarbeiter' };

  body.innerHTML = `
    <table style="width:100%; border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:2px solid var(--border); color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.5px;">
          <th style="text-align:left; padding:8px 10px;">Mitarbeiter</th>
          <th style="text-align:center; padding:8px 10px;">Datum</th>
          <th style="text-align:center; padding:8px 10px;">Zuerst eingeloggt</th>
          <th style="text-align:center; padding:8px 10px;">Letztes Mal online</th>
          <th style="text-align:right; padding:8px 10px;">Orders</th>
          <th style="text-align:right; padding:8px 10px;">Umsatz</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(({u, firstToday, lastSeen, orders, revenue, wasActive}) => `
          <tr style="border-bottom:1px solid var(--border); opacity:${wasActive?1:.45};">
            <td style="padding:10px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="width:9px;height:9px;border-radius:50%;background:${wasActive?'#22c55e':'#ef4444'};display:inline-block;flex-shrink:0;"></span>
                <div>
                  <div style="font-weight:900;">${esc(u.displayName)}</div>
                  <div class="muted small">${roleLabel[u.role]||u.role}</div>
                </div>
              </div>
            </td>
            <td style="text-align:center; padding:10px; color:var(--muted); font-size:13px;">${esc(date)}</td>
            <td style="text-align:center; padding:10px;">
              ${firstToday
                ? `<span style="color:#22c55e; font-weight:900;">${fmtTime(firstToday)}</span>`
                : `<span class="muted small">Nicht eingeloggt</span>`}
            </td>
            <td style="text-align:center; padding:10px;">
              ${lastSeen
                ? `<span style="color:var(--muted); font-size:13px;">${fmtTime(lastSeen)}</span>`
                : `<span class="muted small">—</span>`}
            </td>
            <td style="text-align:right; padding:10px; font-weight:900;">${orders||'—'}</td>
            <td style="text-align:right; padding:10px; font-weight:900; color:#22c55e;">${revenue>0?money(revenue):'—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div class="muted small" style="margin-top:12px; text-align:right;">
      ${rows.filter(r=>r.wasActive).length} von ${rows.length} Mitarbeitern aktiv
    </div>
  `;
}

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
  document.getElementById("monthPurchases").innerText=money(data.totals?.purchases||0);
  const monthExpEl = document.getElementById("monthExpenses");
  if(monthExpEl) monthExpEl.innerText = (data.totals?.expenses||0) > 0 ? money(data.totals.expenses) : "—";
  document.getElementById("monthProfit").innerText=money(data.totals?.profit||0);
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

  // Collect all online usernames — onlineData = auf der Seite, presenceData = an Kasse
  const onlineSet = new Set();
  if(onlineData){ for(const uname of Object.keys(onlineData)) onlineSet.add(uname); }
  if(presenceData){
    for(const regKey of Object.keys(presenceData)){
      const usersObj = presenceData[regKey]?.users || {};
      for(const uname of Object.keys(usersObj)) onlineSet.add(uname);
    }
  }

  box.innerHTML=users.map(u=>{
    const isOnline = onlineSet.has(u.username);
    const dot = `<span title="${isOnline ? 'Online' : 'Offline'}" style="
      display:inline-block;
      width:10px; height:10px;
      border-radius:50%;
      background:${isOnline ? '#22c55e' : '#ef4444'};
      box-shadow:0 0 0 2px ${isOnline ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.2)'};
      flex-shrink:0;
    "></span>`;

    // Format lastSeen timestamp
    const fmtTs = (iso) => {
      if(!iso) return null;
      const d = new Date(iso);
      const now = new Date();
      const pad = n => String(n).padStart(2,'0');
      const sameDay = d.toDateString() === now.toDateString();
      return sameDay
        ? `Heute ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`
        : `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
    };
    let lastSeenStr = "Noch nie aktiv";
    if(isOnline)      lastSeenStr = "Gerade online";
    else if(u.lastSeen) lastSeenStr = fmtTs(u.lastSeen);

    const firstLoginStr = u.firstLoginToday ? fmtTs(u.firstLoginToday) : "Heute noch nicht eingeloggt";

    return `
    <div class="userRow">
      <div style="display:flex; align-items:center; gap:8px; flex:1;">
        ${dot}
        <div style="flex:1;">
          <div style="font-weight:900;">${esc(u.displayName)}</div>
          <div class="muted small">${esc(u.username)} · ${{boss:"👑 Chef", manager:"⭐ Leitender Angestellter", staff:"👤 Mitarbeiter"}[u.role] || esc(u.role)}</div>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end; flex-shrink:0;">
          <div style="
            font-size:11px;
            color:${isOnline ? '#22c55e' : 'var(--muted)'};
            background:${isOnline ? 'rgba(34,197,94,.1)' : 'rgba(255,255,255,.05)'};
            border:1px solid ${isOnline ? 'rgba(34,197,94,.25)' : 'rgba(255,255,255,.1)'};
            border-radius:6px; padding:3px 8px; white-space:nowrap;
          ">🕐 ${lastSeenStr}</div>
          <div style="
            font-size:11px; color:var(--muted);
            background:rgba(255,255,255,.04);
            border:1px solid rgba(255,255,255,.08);
            border-radius:6px; padding:3px 8px; white-space:nowrap;
          ">📅 Heute eingeloggt: ${firstLoginStr}</div>
        </div>
      </div>
      <div style="display:flex; gap:6px; margin-left:8px;">
        <button class="ghost" onclick="openEditUser('${escAttr(u.username)}','${escAttr(u.displayName)}','${escAttr(u.role)}')">✏️ Bearbeiten</button>
        <button class="ghost" style="color:#ef4444;" onclick="delUser('${escAttr(u.username)}')">Löschen</button>
      </div>
    </div>
  `}).join("");
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
  if(!["boss","manager","staff"].includes(role)){ if(msg) msg.innerText="Ungültige Rolle."; return; }

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
function openEditUser(username, displayName, role){
  document.getElementById("editUserLabel").innerText = `${displayName} (${username})`;
  document.getElementById("editUserDisplayName").value = displayName;
  document.getElementById("editUserRole").value = role;
  document.getElementById("editUserPassword").value = "";
  document.getElementById("editUserMsg").innerText = "";
  document.getElementById("editUserOverlay")._username = username;
  document.getElementById("editUserOverlay").classList.remove("hidden");
}

async function submitEditUser(){
  const ov       = document.getElementById("editUserOverlay");
  const username = ov._username;
  const role     = document.getElementById("editUserRole").value;
  const displayName = document.getElementById("editUserDisplayName").value.trim();
  const password = document.getElementById("editUserPassword").value;
  const msg      = document.getElementById("editUserMsg");

  const payload = { role };
  if(displayName) payload.displayName = displayName;
  if(password)    payload.password    = password;

  const res  = await fetch(`/users/${encodeURIComponent(username)}`, {
    method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload)
  }).catch(()=>null);
  const data = res?.ok ? await res.json().catch(()=>({})) : {};
  if(!data.success){ if(msg) msg.innerText = data.message||"Fehler."; return; }

  ov.classList.add("hidden");
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


/* Server carts (SSE) */
let cartsRev = 0;
let cartsSaveTimer = null;
let cartsDirtyByMe = false;

function normalizeCarts(obj){
  const out = { 1:[],2:[],3:[],4:[] };
  try{
    for(const k of [1,2,3,4]){
      const arr = obj && obj[k] || obj && obj[String(k)];
      if(Array.isArray(arr)){
        out[k] = arr.filter(x=>x && typeof x==='object').map(x=>({
          name: String(x.name||''),
          price: Number(x.price)||0,
          qty: Number(x.qty)||1,
          productId: x.productId || null,
          components: x.components || null
        }));
      }
    }
  }catch(e){}
  return out;
}

async function loadCartsFromServer(){
  try{
    const res = await fetch('/carts');
    const data = await res.json().catch(()=>({}));
    if(!res.ok || !data.success) return;
    cartsRev = Number(data.rev)||0;
    cartsByRegister = normalizeCarts(data.carts);
    switchCartToRegister(currentRegister);
    renderCart();
  }catch(e){}
}

function saveCartsDebounced(){
  cartsDirtyByMe = true;
  if(cartsSaveTimer) clearTimeout(cartsSaveTimer);
  cartsSaveTimer = setTimeout(saveCartsToServer, 200);
}

async function saveCartsToServer(){
  if(!cartsDirtyByMe) return;
  cartsDirtyByMe = false;
  try{
    await fetch('/carts',{
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ carts: cartsByRegister, rev: cartsRev })
    });
  }catch(e){}
}

function startCartsSSE(){
  try{
    const es = new EventSource('/events/carts');
    es.onmessage = (ev)=>{
      try{
        const data = JSON.parse(ev.data||'{}');
        const rev = Number(data.rev)||0;
        if(rev && rev <= cartsRev) return; // ignore old
        cartsRev = rev;
        cartsByRegister = normalizeCarts(data.carts);
        switchCartToRegister(currentRegister);
        renderCart();
      }catch(e){}
    };
    es.onerror = ()=>{
      // let browser auto-reconnect
    };
  }catch(e){}
}


/* ===== Soft Lock / Presence (SSE) ===== */
let presenceData = null;
let onlineData = {}; // { username: { name, at } } — alle die auf der Seite sind
let presenceInterval = null;
let presenceES = null;

function ensurePresenceBanner(){
  let el = document.getElementById("presenceBanner");
  if(el) return el;
  const host = document.getElementById("registerDisplay")?.parentElement || document.body;
  el = document.createElement("div");
  el.id = "presenceBanner";
  el.style.marginTop = "6px";
  el.style.padding = "6px 10px";
  el.style.borderRadius = "12px";
  el.style.fontWeight = "900";
  el.style.fontSize = "12px";
  el.style.display = "none";
  el.style.background = "rgba(255, 193, 7, 0.20)";
  el.style.border = "1px solid rgba(255, 193, 7, 0.45)";
  el.style.color = "#ffcc66";
  // try to place near register display
  try{
    const reg = document.getElementById("registerDisplay");
    if(reg && reg.parentElement){
      reg.parentElement.appendChild(el);
    }else{
      host.appendChild(el);
    }
  }catch(e){
    host.appendChild(el);
  }
  return el;
}


function getOtherUsersOnRegister(reg){
  const myUser = String(me?.username || "").trim();
  const regKey = String(reg||1);
  const usersObj = presenceData && presenceData[regKey] && presenceData[regKey].users ? presenceData[regKey].users : {};
  const users = Object.keys(usersObj||{}).map(k=>({ username:k, name: usersObj[k]?.name || k }));
  return users.filter(u => u.username && u.username !== myUser);
}

function syncActiveRegisterButton(reg){
  try{
    const btns = Array.from(document.querySelectorAll('.regBtn'));
    const myUser = String(me?.username || "").trim();
    btns.forEach((btn, i) => {
      const kassNum = i + 1;
      btn.classList.remove('active', 'free', 'occupied');
      // Check who is on this register
      const regKey = String(kassNum);
      const usersObj = presenceData && presenceData[regKey] && presenceData[regKey].users ? presenceData[regKey].users : {};
      const others = Object.keys(usersObj).filter(u => u !== myUser);
      const isMine = Number(reg) === kassNum;
      if(isMine){
        btn.classList.add('active');
      } else if(others.length > 0){
        btn.classList.add('occupied');
      } else {
        btn.classList.add('free');
      }
    });
  }catch(e){}
}

const REGISTER_NAMES = { 1:"Kasse 1", 2:"Kasse 2", 3:"Kasse 3", 4:"Kasse 4", 5:"Drive-In", 6:"Foodtruck" };

function ensureRegisterBlockOverlay(){
  let ov = document.getElementById('regBlockOverlay');
  if(ov) return ov;
  ov = document.createElement('div');
  ov.id = 'regBlockOverlay';
  ov.className = 'overlay hidden';
  ov.innerHTML = `
    <div class="overlayCard" style="max-width:420px; text-align:center;">
      <div style="font-size:48px; margin-bottom:8px;">🔒</div>
      <div style="font-weight:900; font-size:20px; margin-bottom:6px;"><span id="regBlockLabel">Kasse</span> ist belegt</div>
      <div style="font-size:15px; margin-bottom:4px;"><b><span id="regBlockName">—</span></b> arbeitet gerade an dieser Kasse.</div>
      <div class="muted" style="font-size:13px; margin-top:6px;">Bitte wähle eine andere Kasse oder warte, bis sie freigegeben wird.</div>
      <div style="display:flex; justify-content:center; gap:10px; flex-wrap:wrap; margin-top:20px;">
        <button class="primary" id="regBlockOkBtn" style="min-width:120px;">OK</button>
        <button class="ghost" id="regBlockForceBtn" style="min-width:160px; color:#ef4444; display:none;">🔓 Kasse freigeben</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
  ov.querySelector('#regBlockOkBtn')?.addEventListener('click', ()=>{ ov.classList.add('hidden'); });
  ov.querySelector('#regBlockForceBtn')?.addEventListener('click', async ()=>{
    const reg = ov._blockedReg;
    if(!reg) return;
    const res = await fetch('/presence/force-clear',{
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ register: String(reg) })
    }).catch(()=>null);
    if(res?.ok) ov.classList.add('hidden');
  });
  return ov;
}

function showRegisterBlocked(reg, names){
  const ov = ensureRegisterBlockOverlay();
  const labelEl = ov.querySelector('#regBlockLabel');
  const nameEl  = ov.querySelector('#regBlockName');
  const forceBtn = ov.querySelector('#regBlockForceBtn');
  if(labelEl) labelEl.textContent = REGISTER_NAMES[Number(reg)] || `Kasse ${reg}`;
  if(nameEl)  nameEl.textContent  = String(names||"—");
  if(forceBtn) forceBtn.style.display = isBoss() ? "" : "none";
  ov._blockedReg = reg;
  ov.classList.remove('hidden');
}

async function forceReleaseRegister(){
  const ov  = document.getElementById('regBlockOverlay');
  const reg = ov?._blockedReg;
  if(!reg) return;
  const res = await fetch('/presence/force-clear',{
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ register: String(reg) })
  }).catch(()=>null);
  if(res?.ok) ov.classList.add('hidden');
}

function renderPresenceWarning(){
  const el = ensurePresenceBanner();
  if(!currentRegister){ el.style.display='none'; return; }
  const myUser = String(me?.username || "").trim();
  const regKey = String(currentRegister||1);
  const usersObj = presenceData && presenceData[regKey] && presenceData[regKey].users ? presenceData[regKey].users : {};
  const users = Object.keys(usersObj||{}).map(k=>({ username:k, name: usersObj[k]?.name || k }));
  const others = users.filter(u => u.username && u.username !== myUser);
  if(others.length > 0){
    const names = others.map(o=>o.name).join(", ");
    el.textContent = "⚠️ Hinweis: Kasse " + regKey + " wird auch von " + names + " genutzt.";
    el.style.display = "";
  }else{
    el.style.display = "none";
  }
}

async function sendPresenceLeave(){
  try{
    if(!me) return;
    const u = encodeURIComponent(String(me.username||""));
    // keepalive works on unload in modern browsers
    await fetch("/presence/leave?u=" + u, { method:"POST", keepalive:true }).catch(()=>{});
  }catch(e){}
}

async function sendHeartbeat(){
  try{
    if(!me) return;
    await fetch("/presence/heartbeat",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ name: String(me.displayName||me.username||"") })
    });
  }catch(e){}
}

async function sendPresencePing(){
  try{
    if(!me) return;
    if(!currentRegister) return;
    const payload = {
      register: String(currentRegister||""),
      username: String(me.username||""),
      name: String(me.displayName||me.username||"")
    };
    await fetch("/presence",{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
  }catch(e){}
}

function startPresenceSSE(){
  try{
    if(presenceES) return;
    presenceES = new EventSource("/events/presence");
    presenceES.onmessage = (ev)=>{
      try{
        const data = JSON.parse(ev.data||"{}");
        presenceData = data.presence || null;
        onlineData = data.online || {};
        renderPresenceWarning();
        // Live-Update der Online-Punkte im Mitarbeiter-Panel
        if(document.getElementById("usersList")) loadUsers();
        // If current register is now occupied by someone else, show block popup
        if(currentRegister){
          const others = getOtherUsersOnRegister(currentRegister);
          if(others && others.length){
            const names = others.map(o=>o.name).join(', ');
            showRegisterBlocked(currentRegister, names);
            currentRegister = null;
            syncActiveRegisterButton(null);
            updateRegisterDisplay();
          } else {
            syncActiveRegisterButton(currentRegister);
          }
        } else {
          syncActiveRegisterButton(null);
        }
      }catch(e){}
    };
    presenceES.onerror = ()=>{};
  }catch(e){}
}

function startPresenceLoop(){
  try{
    if(presenceInterval) clearInterval(presenceInterval);
    sendPresencePing();
    presenceInterval = setInterval(sendPresencePing, 5000);
  }catch(e){}
}

function stopPresenceLoop(){
  try{ if(presenceInterval) clearInterval(presenceInterval); }catch(e){}
  presenceInterval = null;
  try{ if(presenceES){ presenceES.close(); } }catch(e){}
  presenceES = null;
}


/* Helpers */
function money(n){ const x=Number.isFinite(Number(n)) ? Number(n) : 0; return "$" + x.toLocaleString("de-DE", {minimumFractionDigits:0, maximumFractionDigits:2}).replace(/,([0-9]+)$/, ".$1"); }
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
window.addEventListener('beforeunload', ()=>{ try{ sendPresenceLeave(); }catch(e){} });

loadMe();
