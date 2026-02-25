/* Burger Shot – App JS */

let currentRegister = 1;
let currentCategory = "Burger";
let me = null;
let serverDay = null;

let cart = [];
let currentDayReport = null;
let currentWeekReport = null;

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
  const ids = ["tabBtnDay","tabBtnWeek","tabBtnMgmt"];
  ids.forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.style.display = show ? "" : "none";
  });
}

function openTab(tabId, btn){
  if((tabId==="tab_mgmt"||tabId==="tab_day"||tabId==="tab_week") && !isBoss()){
    alert("Nur Chef.");
    tabId="tab_pos";
    btn=document.querySelector(".tabsTop .tabTop");
  }

  document.querySelectorAll(".tabPage").forEach(p=>p.classList.add("hidden"));
  document.getElementById(tabId)?.classList.remove("hidden");

  document.querySelectorAll(".tabTop").forEach(b=>b.classList.remove("active"));
  btn?.classList.add("active");

  if(tabId==="tab_kitchen") loadKitchen();
  if(tabId==="tab_day") { initDayTab(); loadDayReport(); }
  if(tabId==="tab_week") { initWeekTab(); loadWeekReport(); }
  if(tabId==="tab_mgmt") refreshStats();
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
  await initProducts();
  renderCart();
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
  await initProducts();
  renderCart();
  updateDayInfo();
}

function updateDayInfo(){
  const dayInfo = document.getElementById("dayInfo");
  const who = document.getElementById("whoami");
  if(dayInfo) dayInfo.innerText = `Tag: ${serverDay||"—"} · Uhrzeit: ${new Date().toLocaleTimeString("de-DE")}`;
  if(who) who.innerText = me ? `${me.displayName} (${me.role})` : "Nicht eingeloggt";
}
setInterval(updateDayInfo, 1000);

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


async function initProducts(){
  await hydrateProducts();
  renderProducts();
  try{ if(typeof renderProductsEditor === 'function') renderProductsEditor(); }catch(e){}
}

const PRODUCTS_STORAGE_KEY = "bs_products_v1";

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
  // 1) Try server (auth required)
  try{
    const res = await fetch("/products");
    if(res.ok){
      const data = await res.json().catch(()=>({}));
      const list = Array.isArray(data.products) ? data.products : null;
      if(data.success && list && list.length){
        PRODUCTS = list.map(p=>({
          id: p.id,
          name: p.name,
          cat: p.cat,
          price: Number(p.price)||0
        }));
        saveProductsToStorage(PRODUCTS); // keep fallback in sync
        return;
      }
    }
  }catch(e){}

  // 2) LocalStorage fallback
  const stored = loadProductsFromStorage();
  if(stored && Array.isArray(stored) && stored.length){
    PRODUCTS = stored.map(p=>({ ...p, price: Number(p.price)||0 }));
    return;
  }

  // 3) Defaults
  PRODUCTS = PRODUCTS_DEFAULT.map(p=>({ ...p, id: p.id || slugify(p.name) }));
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
        <input class="input" style="width:110px; text-align:right; padding:8px 10px;" data-price-key="${escAttr(prodKey(p))}" data-price-idx="${idx}" value="${escAttr(p.price)}" />
      </td>
    </tr>
  `).join("") || `<tr><td colspan="3" class="muted small">Keine Produkte.</td></tr>`;
  if(msg) msg.innerText = "—";
}

function mgmtReloadProducts(){
  hydrateProducts();
  renderProducts();
  renderProductsEditor();
  const msg = document.getElementById("mgmtProductsMsg");
  if(msg) msg.innerText = "Neu geladen ✅";
}

function mgmtSaveProducts(){
  const msg = document.getElementById("mgmtProductsMsg");
  const list = (PRODUCTS||[]).map(p=>({ ...p }));
  for(let i=0;i<list.length;i++){
    const el = document.querySelector(`[data-price-idx="${i}"]`);
    if(!el) continue;
    const n = parseMoney(el.value);
    if(!Number.isFinite(n) || n<0){
      if(msg) msg.innerText = `Ungültiger Preis bei "${list[i].name}".`;
      return;
    }
    list[i].price = Math.round(n);
  }
  PRODUCTS = list;
  if(saveProductsToStorage(PRODUCTS)){
    renderProducts();
    if(msg) msg.innerText = "Gespeichert ✅";
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
  document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  renderProducts();
}

function renderProducts(){
  const box=document.getElementById("products");
  if(!box) return;
  box.innerHTML="";
  PRODUCTS.filter(p=>p.cat===currentCategory).forEach(p=>{
    const el=document.createElement("button");
    el.className="productBtn";
    el.innerHTML=`<div style="font-weight:900;">${esc(p.name)}</div><div class="muted small">${money(p.price)}</div>`;
    el.onclick=()=>addToCart(p);
    box.appendChild(el);
  });
}

/* Cart */
function addToCart(p){
  // Menüs: erst Optionen auswählen (Drink + Cheesy Fries Upgrade)
  if((p.cat||p.category)==="Menü"){
    return openMenuOptions(p);
  }
  cart.push({ name:p.name, price:p.price, qty:1 });
  renderCart();
}
function clearCart(){ cart=[]; renderCart(); }
function cartTotal(){ return cart.reduce((s,x)=>s+x.price*x.qty,0); }

function renderCart(){
  const box=document.getElementById("cart");
  const tot=document.getElementById("cartTotal");
  if(tot) tot.innerText=money(cartTotal());
  if(!box) return;
  if(cart.length===0){ box.innerHTML=`<div class="muted small">Leer.</div>`; return; }
  box.innerHTML=cart.map((x,idx)=>`
    <div class="cartRow">
      <div style="font-weight:900;">${esc(x.name)}</div>
      ${x.meta?.lines ? `<div class="muted small">${x.meta.lines.map(esc).join(' · ')}</div>` : ``}
      <div class="muted small">${money(x.price)}</div>
      <button class="ghost" onclick="removeItem(${idx})">x</button>
    </div>`).join("");
}
function removeItem(idx){ cart.splice(idx,1); renderCart(); }

/* Register */
function setRegister(n){ currentRegister=n; const d=document.getElementById("registerDisplay"); if(d) d.innerText=`Kasse ${n}`; }

/* Pay overlay */
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
    items: cart.map(x=>({ name:x.name, price:x.price, qty:x.qty, meta:x.meta||null })),
    total,
    paidAmount: paid,
    time: new Date().toISOString()
  };
  const res=await fetch("/sale",{ method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return alert(data.message || "Fehler beim Speichern.");
  closePay();
  alert(`Order #${data.orderId} gespeichert. Trinkgeld: ${money(data.tip||0)}`);
  cart=[]; renderCart();
}


function slugify(s){
  return String(s||"")
    .toLowerCase()
    .replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss")
    .replace(/[^a-z0-9]+/g,"_")
    .replace(/^_+|_+$/g,"")
    .slice(0,60) || "item";
}

function prodKey(p){
  return String(p?.id || "") || (slugify(p?.cat) + "__" + slugify(p?.name));
}


/* Menü Optionen */
function openMenuOptions(p){
  pendingMenuProduct = p;
  const sel = document.getElementById("menuDrink");
  const chk = document.getElementById("menuCheesy");
  const title = document.getElementById("menuTitle");
  const priceEl = document.getElementById("menuPrice");

  if(title) title.innerText = p.name;
  if(chk) chk.checked = false;

  // Drinks aus Produkten
  const drinks = (PRODUCTS||[]).filter(x => (x.cat||x.category) === "Getränke");
  if(sel){
    sel.innerHTML = drinks.map((d,i)=>`<option value="${escAttr(d.name)}">${esc(d.name)}</option>`).join("");
    if(drinks.length === 0){
      sel.innerHTML = `<option value="">(Keine Getränke angelegt)</option>`;
    }
  }

  if(priceEl) priceEl.innerText = money(p.price);
  document.getElementById("menuOverlay")?.classList.remove("hidden");
}

function closeMenuOptions(){
  document.getElementById("menuOverlay")?.classList.add("hidden");
  pendingMenuProduct = null;
}

function updateMenuPrice(){
  if(!pendingMenuProduct) return;
  const chk = document.getElementById("menuCheesy");
  const priceEl = document.getElementById("menuPrice");
  let price = Number(pendingMenuProduct.price||0);
  if(chk?.checked) price += 2; // Cheesy Fries +2
  if(priceEl) priceEl.innerText = money(price);
}

function addMenuToCart(){
  if(!pendingMenuProduct) return closeMenuOptions();

  const sel = document.getElementById("menuDrink");
  const chk = document.getElementById("menuCheesy");

  const drink = String(sel?.value || "").trim();
  const cheesy = !!chk?.checked;

  let price = Number(pendingMenuProduct.price||0);
  const lines = [];
  if(drink) lines.push(`Getränk: ${drink}`);
  lines.push(`Beilage: ${cheesy ? "Cheesy Fries (+$2)" : "Fries"}`);
  if(cheesy) price += 2;

  cart.push({
    name: pendingMenuProduct.name,
    price,
    qty: 1,
    meta: { type: "menu", drink, side: cheesy ? "Cheesy Fries" : "Fries", lines }
  });

  closeMenuOptions();
  renderCart();
}

/* Kitchen */
async function loadKitchen(){
  const res=await fetch("/kitchen/orders");
  if(res.status===401) return showLoginPage("Bitte einloggen.");
  const data=await res.json().catch(()=>({}));
  if(!res.ok || !data.success) return;
  serverDay=data.currentDay||serverDay;

  const box=document.getElementById("kitchenOrders");
  if(!box) return;
  const orders=data.pending||[];
  if(orders.length===0){ box.innerHTML=`<div class="muted small">Keine offenen Bestellungen.</div>`; return; }
  box.innerHTML=orders.map(o=>{
    const items=(o.items||[]).map(i=>`${i.qty||1}× ${i.name}`).join(", ");
    return `
      <div class="kCard">
        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div style="font-weight:900;">#${o.id} · Kasse ${o.register}</div>
          <div class="muted small">${esc(o.timeHM||"")}</div>
        </div>
        <div class="muted small">${esc(o.employee||"")}</div>
        <div style="margin-top:8px;">${esc(items)}</div>
        <div class="row" style="margin-top:10px; justify-content:space-between;">
          <div class="muted small">${money(o.total)}</div>
          <button class="primary" onclick="kitchenDone(${o.id})">Fertig</button>
        </div>
      </div>`;
  }).join("");
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
        <td style="text-align:right;">${x.orders||0}</td>
      </tr>
    `).join("") || `<tr><td colspan="3" class="muted">Keine Daten.</td></tr>`;
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
        <td style="text-align:right;">${x.orders||0}</td>
      </tr>
    `).join("") || `<tr><td colspan="3" class="muted">Keine Daten.</td></tr>`;
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
  const username=prompt("Username (login) (ohne Leerzeichen, z.B. max.mustermann):");
  if(!username) return;
  const displayName=prompt("Anzeigename:", username) || username;
  const role=prompt("Rolle: staff oder boss", "staff") || "staff";
  const password=prompt("Passwort (default admin):", "admin") || "admin";
  addUser(username, displayName, role, password);
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

/* Boot */
loadMe();
