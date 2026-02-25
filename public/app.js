/* =========================
   Burger Shot – App JS
   ========================= */

let currentRegister = 1;
let currentCategory = "Burger";
let me = null;
let serverDay = null;

let cart = [];

// Products are now loaded from server (editable in Management)
let PRODUCTS = [];

/* ========= UI: Login/App View ========= */
function showLoginPage(msg = "Bitte einloggen.") {
  document.getElementById("loginPage")?.classList.remove("hidden");
  document.getElementById("appRoot")?.classList.add("hidden");
  const m = document.getElementById("loginMsg");
  if (m) m.innerText = msg;
  setTimeout(() => document.getElementById("loginUser")?.focus(), 50);
}

function showApp() {
  document.getElementById("loginPage")?.classList.add("hidden");
  document.getElementById("appRoot")?.classList.remove("hidden");
}

/* ========= Roles ========= */
function isBoss() {
  return me?.role === "boss";
}

function applyRoleVisibility() {
  const mgmtBtn = document.getElementById("tabBtnMgmt");
  const mgmtTab = document.getElementById("tab_mgmt");
  if (!mgmtBtn || !mgmtTab) return;

  if (isBoss()) {
    mgmtBtn.style.display = "";
  } else {
    mgmtBtn.style.display = "none";
    if (!mgmtTab.classList.contains("hidden")) {
      const kassBtn = document.querySelector(".tabsTop .tabTop");
      openTab("tab_pos", kassBtn);
      alert("Management ist nur für den Chef verfügbar.");
    }
  }
}

/* ========= Tabs ========= */
let kitchenPoll = null;
let kitchenAgeTicker = null;

function openTab(tabId, btn) {
  if (tabId === "tab_mgmt" && !isBoss()) {
    alert("Management ist nur für den Chef verfügbar.");
    tabId = "tab_pos";
    btn = document.querySelector(".tabsTop .tabTop") || btn;
  }

  document.querySelectorAll(".tabPage").forEach(p => p.classList.add("hidden"));
  document.getElementById(tabId)?.classList.remove("hidden");

  document.querySelectorAll(".tabTop").forEach(b => b.classList.remove("active"));
  btn?.classList.add("active");

  if (tabId === "tab_mgmt") {
    refreshStats();
    loadProducts();
  }

  if (tabId === "tab_kitchen") {
    loadKitchen();
    startKitchenPolling();
    startKitchenAgeTicker();
  } else {
    stopKitchenPolling();
    stopKitchenAgeTicker();
  }
}

function startKitchenPolling() {
  if (kitchenPoll) return;
  kitchenPoll = setInterval(() => {
    const visible = !document.getElementById("tab_kitchen")?.classList.contains("hidden");
    if (visible) loadKitchen();
  }, 3000);
}
function stopKitchenPolling() {
  if (kitchenPoll) clearInterval(kitchenPoll);
  kitchenPoll = null;
}
function startKitchenAgeTicker() {
  if (kitchenAgeTicker) return;
  kitchenAgeTicker = setInterval(() => {
    document.querySelectorAll("[data-order-age]").forEach(el => {
      const t = Number(el.getAttribute("data-order-age") || 0);
      if (!t) return;
      const age = Date.now() - t;
      el.innerText = fmtAge(age);
    });
  }, 1000);
}
function stopKitchenAgeTicker() {
  if (kitchenAgeTicker) clearInterval(kitchenAgeTicker);
  kitchenAgeTicker = null;
}

/* ========= Login ========= */
async function login() {
  const u = document.getElementById("loginUser")?.value || "";
  const p = document.getElementById("loginPass")?.value || "";

  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: p })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return showLoginPage(data.message || "Login fehlgeschlagen.");

  me = data.user;
  serverDay = data.currentDay;
  showApp();
  applyRoleVisibility();
  await loadProducts(); // load VK list
  renderCart();
  updateDayInfo();
}

async function logout() {
  await fetch("/auth/logout", { method: "POST" }).catch(() => {});
  me = null;
  PRODUCTS = [];
  showLoginPage("Ausgeloggt.");
}

/* ========= Me ========= */
async function loadMe() {
  const res = await fetch("/auth/me");
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return showLoginPage("Bitte einloggen.");

  serverDay = data.currentDay;
  if (!data.loggedIn) return showLoginPage("Bitte einloggen.");

  me = data.user;
  showApp();
  applyRoleVisibility();
  await loadProducts();
  renderCart();
  updateDayInfo();
}

/* ========= Day Info ========= */
function updateDayInfo() {
  const dayInfo = document.getElementById("dayInfo");
  const who = document.getElementById("whoami");
  if (dayInfo) dayInfo.innerText = `Tag: ${serverDay || "—"} · Uhrzeit: ${new Date().toLocaleTimeString("de-DE")}`;
  if (who) who.innerText = me ? `${me.displayName} (${me.role})` : "Nicht eingeloggt";
}
setInterval(updateDayInfo, 1000);

/* ========= Products (from server) ========= */
async function loadProducts() {
  const msg = document.getElementById("productsMsg");
  try {
    const res = await fetch("/products");
    if (res.status === 401) return showLoginPage("Bitte einloggen.");
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || "Fehler beim Laden der Produkte.");

    PRODUCTS = Array.isArray(data.products) ? data.products : [];
    renderProducts();
    if (isBoss()) renderProductsEditor();
    if (msg) msg.innerText = `Geladen: ${PRODUCTS.length} Produkte.`;
  } catch (e) {
    if (msg) msg.innerText = String(e?.message || e);
  }
}

function renderProducts() {
  const box = document.getElementById("products");
  if (!box) return;
  box.innerHTML = "";

  const list = (PRODUCTS || []).filter(p => p.cat === currentCategory);
  if (list.length === 0) {
    box.innerHTML = `<div class="muted small">Keine Produkte in dieser Kategorie.</div>`;
    return;
  }

  list.forEach(p => {
    const el = document.createElement("button");
    el.className = "productBtn";
    el.innerHTML = `
      <div style="font-weight:900;">${esc(p.name)}</div>
      <div class="muted small">${money(p.price)}</div>
    `;
    el.onclick = () => addToCart(p);
    box.appendChild(el);
  });
}

function setCategory(cat, btn) {
  currentCategory = cat;
  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  renderProducts();
}

/* ========= Cart ========= */
function addToCart(p) {
  cart.push({ id: p.id, name: p.name, price: p.price, qty: 1 });
  renderCart();
}

function clearCart() {
  cart = [];
  renderCart();
}

function cartTotal() {
  return cart.reduce((s, x) => s + x.price * x.qty, 0);
}

function renderCart() {
  const box = document.getElementById("cart");
  const tot = document.getElementById("cartTotal");
  if (tot) tot.innerText = money(cartTotal());
  if (!box) return;

  if (cart.length === 0) {
    box.innerHTML = `<div class="muted small">Leer.</div>`;
    return;
  }

  box.innerHTML = cart.map((x, idx) => `
    <div class="cartRow">
      <div style="font-weight:900;">${esc(x.name)}</div>
      <div class="muted small">${money(x.price)}</div>
      <button class="ghost" onclick="removeItem(${idx})">x</button>
    </div>
  `).join("");
}

function removeItem(idx) {
  cart.splice(idx, 1);
  renderCart();
}

/* ========= Register ========= */
function setRegister(n) {
  currentRegister = n;
  const d = document.getElementById("registerDisplay");
  if (d) d.innerText = `Kasse ${n}`;
}

/* ========= Pay Overlay ========= */
function openPay() {
  if (cart.length === 0) return alert("Warenkorb ist leer.");
  document.getElementById("payTotal").innerText = money(cartTotal());
  document.getElementById("payAmount").value = "";
  document.getElementById("payOverlay").classList.remove("hidden");
  setTimeout(() => document.getElementById("payAmount")?.focus(), 50);
}

function closePay() {
  document.getElementById("payOverlay").classList.add("hidden");
}

function parseMoney(val) {
  const s = String(val || "").replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

async function submitPay() {
  const total = cartTotal();
  const paid = parseMoney(document.getElementById("payAmount").value);

  if (!Number.isFinite(paid) || paid < total) return alert("Bezahlt muss >= Total sein.");

  const payload = {
    register: currentRegister,
    items: cart.map(x => ({ id: x.id, name: x.name, price: x.price, qty: x.qty })),
    total,
    paidAmount: paid,
    time: new Date().toISOString()
  };

  const res = await fetch("/sale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return alert(data.message || "Fehler beim Speichern.");

  closePay();
  const tip = data.tip || 0;
  alert(`Order #${data.orderId} gespeichert. Trinkgeld: ${money(tip)}`);
  cart = [];
  renderCart();
}

/* ========= Kitchen ========= */
async function loadKitchen() {
  const res = await fetch("/kitchen/orders");
  if (res.status === 401) return showLoginPage("Bitte einloggen.");
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return;

  serverDay = data.currentDay || serverDay;
  updateDayInfo();

  const box = document.getElementById("kitchenOrders");
  if (!box) return;

  const orders = data.pending || [];
  if (orders.length === 0) {
    box.innerHTML = `<div class="muted small">Keine offenen Bestellungen.</div>`;
    return;
  }

  box.innerHTML = orders.map(o => {
    const t = Date.parse(o.time || "") || Date.now();
    const items = (o.items || []).map(i => `${i.qty || 1}× ${i.name}`).join(", ");
    return `
      <div class="kCard">
        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div style="font-weight:900;">#${o.id} · Kasse ${o.register}</div>
          <div class="muted small" data-order-age="${t}">${fmtAge(Date.now() - t)}</div>
        </div>
        <div class="muted small">${esc(o.employee || "")}</div>
        <div style="margin-top:8px;">${esc(items)}</div>
        <div class="row" style="margin-top:10px; justify-content:space-between;">
          <div class="muted small">${money(o.total)}</div>
          <button class="primary" onclick="kitchenDone(${o.id})">Fertig</button>
        </div>
      </div>
    `;
  }).join("");
}

async function kitchenDone(id) {
  const res = await fetch("/kitchen/done", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return alert(data.message || "Fehler.");
  loadKitchen();
}

async function resetKitchen() {
  if (!isBoss()) return alert("Nur Chef.");
  const ok = confirm("Küche für heute resetten?");
  if (!ok) return;

  const res = await fetch("/kitchen/reset", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return alert(data.message || "Fehler.");
  loadKitchen();
}

/* ========= Management: Mitarbeiter ========= */
async function refreshStats() {
  if (!isBoss()) return;
  loadUsers();
}

async function resetToday() {
  if (!isBoss()) return alert("Nur Chef.");
  const ok = confirm("ACHTUNG: Alle heutigen Verkäufe + Küche löschen?");
  if (!ok) return;

  const res = await fetch("/reset/today", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return alert(data.message || "Fehler.");
  alert("Heute zurückgesetzt.");
}

async function loadUsers() {
  const res = await fetch("/users");
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return;

  const box = document.getElementById("usersList");
  if (!box) return;

  const users = data.users || [];
  box.innerHTML = users.map(u => `
    <div class="userRow">
      <div>
        <div style="font-weight:900;">${esc(u.displayName)}</div>
        <div class="muted small">${esc(u.username)} · ${esc(u.role)}</div>
      </div>
      <button class="ghost" onclick="delUser('${escAttr(u.username)}')">Löschen</button>
    </div>
  `).join("");
}

function openAddUser() {
  const username = prompt("Username (login) (ohne Leerzeichen, z.B. max.mustermann):");
  if (!username) return;

  const displayName = prompt("Anzeigename:", username) || username;
  const role = prompt("Rolle: staff oder boss", "staff") || "staff";
  const password = prompt("Passwort (default admin):", "admin") || "admin";

  addUser(username, displayName, role, password);
}

async function addUser(username, displayName, role, password) {
  const res = await fetch("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, displayName, role, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return alert(data.message || "Fehler.");
  loadUsers();
}

async function delUser(username) {
  const ok = confirm(`User ${username} löschen?`);
  if (!ok) return;

  const res = await fetch(`/users/${encodeURIComponent(username)}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return alert(data.message || "Fehler.");
  loadUsers();
}

/* ========= Management: VK Editor ========= */
function renderProductsEditor() {
  const body = document.getElementById("productsEditor");
  if (!body) return;

  const list = (PRODUCTS || []).slice().sort((a, b) => (a.cat || "").localeCompare(b.cat || "") || (a.name || "").localeCompare(b.name || ""));
  body.innerHTML = list.map(p => `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${esc(p.cat)}</td>
      <td style="text-align:right;">
        <input class="input inputInline" data-price-for="${escAttr(p.id)}" value="${escAttr(p.price)}" />
      </td>
    </tr>
  `).join("") || `<tr><td colspan="3" class="muted">Keine Produkte.</td></tr>`;
}

async function saveProducts() {
  if (!isBoss()) return alert("Nur Chef.");
  const msg = document.getElementById("productsMsg");

  // collect prices
  const next = (PRODUCTS || []).map(p => ({ ...p }));
  for (const p of next) {
    const el = document.querySelector(`[data-price-for="${CSS.escape(p.id)}"]`);
    if (!el) continue;
    const n = parseMoney(el.value);
    if (!Number.isFinite(n) || n < 0) {
      if (msg) msg.innerText = `Ungültiger Preis bei "${p.name}".`;
      return;
    }
    p.price = Math.round(n);
  }

  try {
    const res = await fetch("/products", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products: next })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || "Fehler beim Speichern.");

    PRODUCTS = Array.isArray(data.products) ? data.products : next;
    renderProducts();
    renderProductsEditor();
    if (msg) msg.innerText = "Gespeichert ✅";
  } catch (e) {
    if (msg) msg.innerText = String(e?.message || e);
  }
}

/* ========= Password Change ========= */
function openPwChange() {
  document.getElementById("pwOld").value = "";
  document.getElementById("pwNew1").value = "";
  document.getElementById("pwNew2").value = "";
  document.getElementById("pwMsg").innerText = "—";
  document.getElementById("pwOverlay").classList.remove("hidden");
  setTimeout(() => document.getElementById("pwOld")?.focus(), 50);
}

function closePwChange() {
  document.getElementById("pwOverlay").classList.add("hidden");
}

async function submitPwChange() {
  const oldPw = document.getElementById("pwOld").value || "";
  const n1 = document.getElementById("pwNew1").value || "";
  const n2 = document.getElementById("pwNew2").value || "";
  const msg = document.getElementById("pwMsg");

  if (n1 !== n2) {
    if (msg) msg.innerText = "Neue Passwörter stimmen nicht überein.";
    return;
  }

  const res = await fetch("/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldPw, newPw: n1 })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    if (msg) msg.innerText = data.message || "Fehler.";
    return;
  }

  if (msg) msg.innerText = "Passwort geändert ✅";
  setTimeout(closePwChange, 800);
}

/* ========= Helpers ========= */
function money(n) {
  const x = Number(n || 0);
  return "$" + (Number.isFinite(x) ? x : 0);
}

function fmtAge(ms) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escAttr(s) {
  return esc(s).replaceAll("`", "&#096;");
}

/* ========= Boot ========= */
async function boot() {
  await loadMe();
}
boot();
