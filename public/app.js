/* =========================
   Burger Shot – App JS
   passend zu index.html (Login-Seite, kein Popup)
   ========================= */

let currentRegister = 1;
let currentCategory = "Burger";
let me = null;
let serverDay = null;

const products = [
  { name: "The Bleeder", price: 14, category: "Burger" },
  { name: "The Heartstopper", price: 16, category: "Burger" },
  { name: "The Chicken", price: 12, category: "Burger" },
  { name: "Vegan Burger", price: 10, category: "Burger" },
  { name: "The Chozzo", price: 12, category: "Burger" },
  { name: "The German", price: 16, category: "Burger" },

  { name: "Coleslaw", price: 10, category: "Beilagen" },
  { name: "Fries", price: 6, category: "Beilagen" },
  { name: "Cheesy Fries", price: 8, category: "Beilagen" },
  { name: "Chicken Nuggets", price: 10, category: "Beilagen" },
  { name: "Onion Rings", price: 6, category: "Beilagen" },

  { name: "ECola", price: 8, category: "Getränke" },
  { name: "Sprung", price: 8, category: "Getränke" },
  { name: "Blueberry Slush", price: 10, category: "Getränke" },
  { name: "Strawberry Slush", price: 10, category: "Getränke" },
  { name: "Choco Milchshake", price: 10, category: "Getränke" },
  { name: "Vanille Milchshake", price: 10, category: "Getränke" },
  { name: "Strawberry Milchshake", price: 10, category: "Getränke" },

  { name: "Glazed Donut", price: 8, category: "Süßes" },
  { name: "Sprinke Donut", price: 8, category: "Süßes" },
  { name: "Caramel Sundae", price: 8, category: "Süßes" },
  { name: "Chocolate Sundae", price: 8, category: "Süßes" },
  { name: "Strawberry Sundae", price: 8, category: "Süßes" }
];

let cart = [];

/* ========= UI: Login/App View ========= */
function showLoginPage(msg = "Bitte einloggen.") {
  const lp = document.getElementById("loginPage");
  const app = document.getElementById("appRoot");
  if (lp) lp.classList.remove("hidden");
  if (app) app.classList.add("hidden");

  const m = document.getElementById("loginMsg");
  if (m) m.innerText = msg;

  setTimeout(() => document.getElementById("loginUser")?.focus(), 50);
}

function showApp() {
  const lp = document.getElementById("loginPage");
  const app = document.getElementById("appRoot");
  if (lp) lp.classList.add("hidden");
  if (app) app.classList.remove("hidden");
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

    // Falls ein Mitarbeiter irgendwie im Management landet -> zurück zur Kasse
    if (!mgmtTab.classList.contains("hidden")) {
      const kassBtn = document.querySelector(".tabsTop .tabTop.active") || document.querySelector(".tabsTop .tabTop");
      openTab("tab_pos", kassBtn);
      alert("Management ist nur für den Chef verfügbar.");
    }
  }

  const bossPanel = document.getElementById("bossPanel");
  if (bossPanel) {
    if (isBoss()) bossPanel.classList.remove("hidden");
    else bossPanel.classList.add("hidden");
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

  if (tabId === "tab_mgmt") refreshStats();

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
  if (!kitchenPoll) return;
  clearInterval(kitchenPoll);
  kitchenPoll = null;
}

function startKitchenAgeTicker() {
  if (kitchenAgeTicker) return;
  kitchenAgeTicker = setInterval(() => {
    const visible = !document.getElementById("tab_kitchen")?.classList.contains("hidden");
    if (!visible) return;
    tickKitchenAges();
  }, 1000);
}

function stopKitchenAgeTicker() {
  if (!kitchenAgeTicker) return;
  clearInterval(kitchenAgeTicker);
  kitchenAgeTicker = null;
}

/* ========= POS ========= */
function setRegister(n) {
  currentRegister = n;
  document.getElementById("registerDisplay").innerText = "Kasse " + n;
  clearCart();
}

function setCategory(cat, btn) {
  currentCategory = cat;
  // Buttons in index.html haben class "tab"
  document.querySelectorAll("#tab_pos .tab").forEach(b => b.classList.remove("active"));
  btn?.classList.add("active");
  renderProducts();
}

function burgerOptions() {
  return products.filter(p => p.category === "Burger").map(p => p.name);
}
function drinkOptions() {
  return products.filter(p => p.category === "Getränke").map(p => p.name);
}

function renderProducts() {
  const container = document.getElementById("products");
  if (!container) return;
  container.innerHTML = "";

  if (currentCategory === "Menü") {
    const menuItems = [
      {
        name: "Burgermenü",
        price: 26,
        desc: "1 Burger + Fries + 1 Getränk auswählen",
        onClick: () => openMenuBuilder("burgermenu")
      },
      {
        name: "Spar Paket 10/10",
        price: 200,
        desc: "10× Burger + 10× Getränk (frei zusammenstellen)",
        onClick: () => openMenuBuilder("spar1010")
      }
    ];

    menuItems.forEach(m => {
      const div = document.createElement("div");
      div.className = "product";
      div.innerHTML = `
        <div>
          <div class="name">${escapeHtml(m.name)}</div>
          <div class="small" style="color:var(--muted); margin-top:4px;">${escapeHtml(m.desc)}</div>
        </div>
        <div class="price">$${m.price}</div>
      `;
      div.onclick = m.onClick;
      container.appendChild(div);
    });

    return;
  }

  products
    .filter(p => p.category === currentCategory)
    .forEach(p => {
      const div = document.createElement("div");
      div.className = "product";
      div.innerHTML = `<div class="name">${escapeHtml(p.name)}</div><div class="price">$${p.price}</div>`;
      div.onclick = () => addToCart(p);
      container.appendChild(div);
    });
}

/* ========= Menü Builder (Overlay) ========= */
let menuMode = null; // "burgermenu" | "spar1010"
let spar = { burgers: {}, drinks: {} };

function ensureMenuOverlay() {
  document.getElementById("menuOverlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "menuOverlay";
  overlay.className = "overlay hidden";
  overlay.innerHTML = `
    <div class="loginCard" style="width:650px;">
      <h2 id="menuTitle">Menü</h2>
      <div class="muted" id="menuSubtitle">Auswahl</div>

      <!-- Burgermenü Mode -->
      <div id="simpleMode">
        <div style="margin-top:10px;">
          <div class="muted small" style="margin-bottom:6px;">Burger</div>
          <select id="menuBurger"
            style="width:100%; padding:10px 12px; border-radius:10px; background:#0e243a; color:white; border:1px solid rgba(255,255,255,0.12);">
          </select>
        </div>

        <div style="margin-top:10px;">
          <div class="muted small" style="margin-bottom:6px;">Getränk</div>
          <select id="menuDrink"
            style="width:100%; padding:10px 12px; border-radius:10px; background:#0e243a; color:white; border:1px solid rgba(255,255,255,0.12);">
          </select>
        </div>

        <div id="cheesyWrap" style="margin-top:12px; display:none; width:100%;">
          <div style="display:flex; align-items:center; gap:10px; width:100%;">
            <input id="cheesyCheck" type="checkbox" />
            <div style="flex:1 1 auto; min-width:0; white-space:normal; word-break:break-word; line-height:1.2;">
              Cheesy Fries statt Fries (+$2)
            </div>
          </div>
        </div>
      </div>

      <!-- Spar Mode -->
      <div id="sparMode" style="display:none; margin-top:10px;">
        <div class="muted small" style="margin-bottom:8px;">
          Wähle insgesamt <b>10 Burger</b> und <b>10 Getränke</b>.
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div style="border:1px solid rgba(255,255,255,0.10); border-radius:12px; padding:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div><b>Burger</b></div>
              <div class="muted small" id="sparBurgerCount">0 / 10</div>
            </div>
            <div id="sparBurgerList" style="margin-top:8px; display:flex; flex-direction:column; gap:6px;"></div>
          </div>

          <div style="border:1px solid rgba(255,255,255,0.10); border-radius:12px; padding:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div><b>Getränke</b></div>
              <div class="muted small" id="sparDrinkCount">0 / 10</div>
            </div>
            <div id="sparDrinkList" style="margin-top:8px; display:flex; flex-direction:column; gap:6px;"></div>
          </div>
        </div>

        <div class="muted small" style="margin-top:10px;" id="sparSummary">—</div>
      </div>

      <div class="row" style="margin-top:12px; justify-content:flex-end;">
        <button class="ghost" onclick="closeMenuBuilder()">Abbrechen</button>
        <button class="primary" onclick="confirmMenuBuilder()">Hinzufügen</button>
      </div>

      <div class="muted small" id="menuHint" style="margin-top:10px;">—</div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function resetSparState() {
  spar = { burgers: {}, drinks: {} };
}

function sparTotal(obj) {
  return Object.values(obj).reduce((s, n) => s + (Number(n) || 0), 0);
}

function summarizeCounts(obj) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "—";
  return entries.map(([n, q]) => `${n} x${q}`).join(", ");
}

function sparAdd(type, name) {
  if (type === "burger") {
    if (sparTotal(spar.burgers) >= 10) return;
    spar.burgers[name] = (spar.burgers[name] || 0) + 1;
  } else {
    if (sparTotal(spar.drinks) >= 10) return;
    spar.drinks[name] = (spar.drinks[name] || 0) + 1;
  }
  renderSparLists();
}

function sparRemove(type, name) {
  const obj = type === "burger" ? spar.burgers : spar.drinks;
  const v = obj[name] || 0;
  if (v <= 1) delete obj[name];
  else obj[name] = v - 1;
  renderSparLists();
}

function renderSparLists() {
  const bCount = document.getElementById("sparBurgerCount");
  const dCount = document.getElementById("sparDrinkCount");
  const bList = document.getElementById("sparBurgerList");
  const dList = document.getElementById("sparDrinkList");
  const summary = document.getElementById("sparSummary");
  if (!bList || !dList) return;

  const bt = sparTotal(spar.burgers);
  const dt = sparTotal(spar.drinks);

  if (bCount) bCount.textContent = `${bt} / 10`;
  if (dCount) dCount.textContent = `${dt} / 10`;

  bList.innerHTML = "";
  dList.innerHTML = "";

  burgerOptions().forEach(name => {
    const qty = spar.burgers[name] || 0;
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.justifyContent = "space-between";
    row.style.gap = "8px";

    row.innerHTML = `
      <div style="flex:1; min-width:0;">${escapeHtml(name)}</div>
      <div class="muted small" style="width:46px; text-align:center;">${qty}</div>
      <div style="display:flex; gap:6px;">
        <button class="ghost" style="padding:6px 10px;" onclick="sparRemove('burger','${escapeAttr(name)}')">-</button>
        <button class="primary" style="padding:6px 10px;" onclick="sparAdd('burger','${escapeAttr(name)}')">+</button>
      </div>
    `;
    bList.appendChild(row);
  });

  drinkOptions().forEach(name => {
    const qty = spar.drinks[name] || 0;
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.justifyContent = "space-between";
    row.style.gap = "8px";

    row.innerHTML = `
      <div style="flex:1; min-width:0;">${escapeHtml(name)}</div>
      <div class="muted small" style="width:46px; text-align:center;">${qty}</div>
      <div style="display:flex; gap:6px;">
        <button class="ghost" style="padding:6px 10px;" onclick="sparRemove('drink','${escapeAttr(name)}')">-</button>
        <button class="primary" style="padding:6px 10px;" onclick="sparAdd('drink','${escapeAttr(name)}')">+</button>
      </div>
    `;
    dList.appendChild(row);
  });

  if (summary) {
    summary.innerHTML = `
      <div><b>Auswahl</b></div>
      <div class="muted small">Burger: ${escapeHtml(summarizeCounts(spar.burgers))}</div>
      <div class="muted small">Getränke: ${escapeHtml(summarizeCounts(spar.drinks))}</div>
    `;
  }
}

function openMenuBuilder(mode) {
  ensureMenuOverlay();
  menuMode = mode;

  const title = document.getElementById("menuTitle");
  const sub = document.getElementById("menuSubtitle");
  const hint = document.getElementById("menuHint");
  const simpleMode = document.getElementById("simpleMode");
  const sparMode = document.getElementById("sparMode");

  const burgerSel = document.getElementById("menuBurger");
  const drinkSel = document.getElementById("menuDrink");
  const cheesyWrap = document.getElementById("cheesyWrap");
  const cheesyCheck = document.getElementById("cheesyCheck");

  if (burgerSel && drinkSel) {
    burgerSel.innerHTML = "";
    drinkSel.innerHTML = "";
    burgerOptions().forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      burgerSel.appendChild(opt);
    });
    drinkOptions().forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      drinkSel.appendChild(opt);
    });
  }

  if (cheesyCheck) cheesyCheck.checked = false;

  if (mode === "burgermenu") {
    if (title) title.textContent = "Burgermenü";
    if (sub) sub.textContent = "Burger + Fries + Getränk auswählen";
    if (hint) hint.textContent = "VK: $26 (Cheesy Fries +$2)";
    if (simpleMode) simpleMode.style.display = "block";
    if (sparMode) sparMode.style.display = "none";
    if (cheesyWrap) cheesyWrap.style.display = "block";
  } else {
    if (title) title.textContent = "Spar Paket 10/10";
    if (sub) sub.textContent = "10× Burger + 10× Getränk frei zusammenstellen";
    if (hint) hint.textContent = "VK: $200";
    if (simpleMode) simpleMode.style.display = "none";
    if (sparMode) sparMode.style.display = "block";
    if (cheesyWrap) cheesyWrap.style.display = "none";
    resetSparState();
    renderSparLists();
  }

  document.getElementById("menuOverlay")?.classList.remove("hidden");
}

function closeMenuBuilder() {
  document.getElementById("menuOverlay")?.classList.add("hidden");
  menuMode = null;
}

function confirmMenuBuilder() {
  if (menuMode === "burgermenu") {
    const burger = document.getElementById("menuBurger")?.value;
    const drink = document.getElementById("menuDrink")?.value;
    if (!burger || !drink) return alert("Bitte Burger und Getränk auswählen.");

    const cheesy = !!document.getElementById("cheesyCheck")?.checked;
    const friesName = cheesy ? "Cheesy Fries" : "Fries";
    const price = cheesy ? 28 : 26;

    addToCart({
      name: "Burgermenü",
      price,
      category: "Menü",
      bundle: { type: "burgermenu", burger, drink, fries: friesName, cheesy }
    });

    closeMenuBuilder();
    return;
  }

  if (sparTotal(spar.burgers) !== 10 || sparTotal(spar.drinks) !== 10) {
    return alert("Du musst genau 10 Burger und 10 Getränke auswählen.");
  }

  addToCart({
    name: "Spar Paket 10/10",
    price: 200,
    category: "Menü",
    bundle: { type: "spar1010", burgers: spar.burgers, drinks: spar.drinks }
  });

  closeMenuBuilder();
}

/* ========= Cart ========= */
function addToCart(product) {
  const keyA = JSON.stringify(product.bundle || {});
  const found = cart.find(
    i => i.name === product.name && i.price === product.price && JSON.stringify(i.bundle || {}) === keyA
  );
  if (found) found.qty++;
  else cart.push({ ...product, qty: 1 });
  renderCart();
}

function clearCart() {
  cart = [];
  renderCart();
}

function getTotal() {
  return cart.reduce((sum, i) => sum + i.price * i.qty, 0);
}

function renderCart() {
  const list = document.getElementById("cart");
  if (!list) return;
  list.innerHTML = "";

  let itemsCount = 0;

  cart.forEach(item => {
    itemsCount += item.qty;

    let bundleLine = "";
    if (item.bundle?.type === "burgermenu") {
      bundleLine = `<div class="small">Bundle: ${escapeHtml(item.bundle.burger)} + ${escapeHtml(item.bundle.fries)} + ${escapeHtml(item.bundle.drink)}</div>`;
    } else if (item.bundle?.type === "spar1010") {
      bundleLine = `
        <div class="small">Burger: ${escapeHtml(summarizeCounts(item.bundle.burgers || {}))}</div>
        <div class="small">Getränke: ${escapeHtml(summarizeCounts(item.bundle.drinks || {}))}</div>
      `;
    }

    const li = document.createElement("li");
    li.className = "cartItem";
    li.innerHTML = `
      <div class="meta">
        <div><b>${escapeHtml(item.name)}</b></div>
        ${bundleLine}
        <div class="small">${item.qty} × $${item.price} = <b>$${item.qty * item.price}</b></div>
      </div>
      <div class="controls">
        <button onclick="decItem('${escapeAttr(item.name)}','${escapeAttr(JSON.stringify(item.bundle||{}))}')">-1</button>
        <button onclick="incItem('${escapeAttr(item.name)}','${escapeAttr(JSON.stringify(item.bundle||{}))}')">+1</button>
        <button class="danger" onclick="removeItem('${escapeAttr(item.name)}','${escapeAttr(JSON.stringify(item.bundle||{}))}')">Entfernen</button>
      </div>
    `;
    list.appendChild(li);
  });

  document.getElementById("itemsCount").innerText = String(itemsCount);
  document.getElementById("total").innerText = "$" + getTotal();
}

function findCartItem(name, bundleJson) {
  const b = bundleJson ? JSON.parse(bundleJson) : {};
  const key = JSON.stringify(b);
  return cart.find(i => i.name === name && JSON.stringify(i.bundle || {}) === key);
}

function incItem(name, bundleJson) {
  const item = findCartItem(name, bundleJson);
  if (!item) return;
  item.qty++;
  renderCart();
}

function decItem(name, bundleJson) {
  const item = findCartItem(name, bundleJson);
  if (!item) return;
  item.qty--;
  if (item.qty <= 0) cart = cart.filter(i => i !== item);
  renderCart();
}

function removeItem(name, bundleJson) {
  const item = findCartItem(name, bundleJson);
  if (!item) return;
  cart = cart.filter(i => i !== item);
  renderCart();
}

/* ========= Payment Overlay + Checkout + Trinkgeld ========= */
let pendingSale = null;

function openPay() {
  const due = getTotal();
  if (cart.length === 0) return alert("Warenkorb ist leer.");

  pendingSale = {
    register: currentRegister,
    items: cart,
    total: due,
    time: new Date().toISOString()
  };

  const dueEl = document.getElementById("payDue");
  const input = document.getElementById("payAmount");
  const hint = document.getElementById("payHint");

  if (dueEl) dueEl.innerText = "$" + due;
  if (input) input.value = String(due);
  if (hint) hint.innerText = "Wenn mehr bezahlt wird, wird der Überschuss als Trinkgeld verbucht.";

  document.getElementById("payOverlay")?.classList.remove("hidden");
  setTimeout(() => input?.focus(), 50);
}

function closePay() {
  document.getElementById("payOverlay")?.classList.add("hidden");
}

function confirmPay() {
  if (!pendingSale) return closePay();

  const raw = document.getElementById("payAmount")?.value;
  const paid = Number(raw);

  if (!Number.isFinite(paid) || paid < 0) return alert("Bitte gültigen Betrag eingeben.");
  if (paid < pendingSale.total) return alert("Der bezahlte Betrag darf nicht kleiner als der VK sein.");

  closePay();
  checkout(paid);
}

async function checkout(paidAmount = null) {
  // Klick "Bezahlen" -> erst Popup fragen
  if (paidAmount === null) return openPay();

  if (!pendingSale || !Array.isArray(pendingSale.items) || typeof pendingSale.total !== "number") {
    return alert("Fehler: Keine offene Bestellung gefunden. Bitte erneut bezahlen klicken.");
  }

  const payload = { ...pendingSale, paidAmount };

  const res = await fetch("/sale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    if (res.status === 401) return showLoginPage("Bitte einloggen.");
    return alert(data.message || "Fehler beim Speichern.");
  }

  const tip = Number(data.tip || 0);

  clearCart();
  pendingSale = null; // erst NACH Erfolg löschen

  refreshStats();

  if (tip > 0) alert(`Bestellung abgeschickt! (Order #${data.orderId})\nTrinkgeld: $${tip}`);
  else alert(`Bestellung abgeschickt! (Order #${data.orderId})`);

  // Küche ggf. aktualisieren wenn offen
  const kitchenVisible = !document.getElementById("tab_kitchen")?.classList.contains("hidden");
  if (kitchenVisible) loadKitchen();
}

/* ========= Küche: Ping + Blink (2–4 warn, >4 rot) ========= */
let kitchenInitialized = false;
let lastMaxOrderId = 0;

function playPingSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();

    const beep = (freq, t0, dur) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.value = 0.0001;
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.stop(t0 + dur + 0.01);
    };

    const t = ctx.currentTime + 0.01;
    beep(880, t, 0.11);
    beep(1175, t + 0.14, 0.12);

    setTimeout(() => {
      try { ctx.close(); } catch (e) {}
    }, 500);
  } catch (e) {}
}

function itemLinesForKitchen(item) {
  if (!item.bundle) return [`${item.qty}× ${item.name}`];

  if (item.bundle.type === "burgermenu") {
    return [`${item.qty}× Burgermenü: ${item.bundle.burger} + ${item.bundle.fries} + ${item.bundle.drink}`];
  }

  if (item.bundle.type === "spar1010") {
    return [
      `${item.qty}× Spar Paket 10/10`,
      `— Burger: ${summarizeCounts(item.bundle.burgers || {})}`,
      `— Getränke: ${summarizeCounts(item.bundle.drinks || {})}`
    ];
  }

  return [`${item.qty}× ${item.name}`];
}

function fmtAge(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

// 0-2 min normal, 2-4 warn blink, >4 hot blink
function ageClass(ms) {
  const min = ms / 60000;
  if (min >= 4) return "age-hot-blink";
  if (min >= 2) return "age-warn-blink";
  return "age-ok";
}

async function loadKitchen() {
  const res = await fetch("/kitchen/orders");
  if (res.status === 401) return showLoginPage("Bitte einloggen.");

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return;

  const info = document.getElementById("kitchenInfo");
  if (info) info.innerText = `Tag: ${data.currentDay} · Auto-Update alle 3s`;

  const pending = (data.pending || []).slice().sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  // Ping bei neuer Order
  const currentMax = pending.reduce((m, o) => Math.max(m, Number(o.id) || 0), 0);
  if (kitchenInitialized && currentMax > lastMaxOrderId) playPingSound();
  lastMaxOrderId = Math.max(lastMaxOrderId, currentMax);
  kitchenInitialized = true;

  const pendEl = document.getElementById("kitchenPending");
  const emptyEl = document.getElementById("kitchenEmpty");
  if (!pendEl) return;

  pendEl.innerHTML = "";
  if (emptyEl) emptyEl.style.display = pending.length === 0 ? "block" : "none";

  const now = Date.now();

  pending.forEach(o => {
    const box = document.createElement("div");
    box.className = "panel orderCard";

    const reg = o.register ? `Kasse ${o.register}` : "Kasse —";

    const lines = [];
    (o.items || []).forEach(it => itemLinesForKitchen(it).forEach(l => lines.push(l)));

    const ts = Date.parse(o.time || "") || now;
    const ageMs = Math.max(0, now - ts);

    box.classList.add(ageClass(ageMs));
    box.dataset.orderTs = String(ts);

    box.innerHTML = `
      <div class="orderTop">
        <div>
          <div class="orderTitle">Order #${o.id}</div>
          <div class="muted small">
            ${escapeHtml(o.timeHM || "")} · ${escapeHtml(reg)} · von ${escapeHtml(o.employee || "")}
          </div>
        </div>

        <div class="orderRight">
          <div class="orderAge" data-role="age">${fmtAge(ageMs)}</div>
          <button class="primary" onclick="completeKitchenOrder(${o.id})">Erledigt ✅</button>
        </div>
      </div>

      <div class="orderBody">
        ${lines.map(l => `<div class="orderLine">${escapeHtml(l)}</div>`).join("")}
        <div class="muted small" style="margin-top:8px;">Gesamt: <b>$${Number(o.total || 0)}</b></div>
      </div>
    `;

    pendEl.appendChild(box);
  });

  tickKitchenAges();
}

async function completeKitchenOrder(id) {
  const res = await fetch("/kitchen/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    if (res.status === 401) return showLoginPage("Bitte einloggen.");
    return alert(data.message || "Fehler beim Erledigt markieren.");
  }

  loadKitchen();
}

function tickKitchenAges() {
  const pendEl = document.getElementById("kitchenPending");
  if (!pendEl) return;

  const now = Date.now();
  const cards = pendEl.querySelectorAll(".orderCard");
  cards.forEach(card => {
    const ts = Number(card.dataset.orderTs || 0);
    if (!ts) return;
    const ageMs = Math.max(0, now - ts);

    card.classList.remove("age-ok", "age-warn-blink", "age-hot-blink");
    card.classList.add(ageClass(ageMs));

    const ageEl = card.querySelector('[data-role="age"]');
    if (ageEl) ageEl.textContent = fmtAge(ageMs);
  });
}

/* ========= Management / Stats ========= */
async function refreshStats() {
  const res = await fetch("/stats");
  if (res.status === 401) {
    me = null;
    applyRoleVisibility();
    return showLoginPage("Bitte einloggen.");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return;

  me = data.me || null;

  const display = me?.displayName || me?.username || "—";

  const who = document.getElementById("whoami");
  if (who) who.innerText = me ? `Eingeloggt: ${display} (${me.role})` : "Nicht eingeloggt";

  const statMe = document.getElementById("statMe");
  if (statMe) statMe.innerText = display;

  applyRoleVisibility();

  const sales = data.sales || [];
  const revenue = sales.reduce((s, x) => s + (Number(x.total) || 0), 0);
  const tipsTotal = sales.reduce((s, x) => s + (Number(x.tip) || 0), 0);

  const revEl = document.getElementById("statRevenue");
  const ordEl = document.getElementById("statOrders");
  const tipEl = document.getElementById("statTips");
  if (revEl) revEl.innerText = "$" + revenue;
  if (ordEl) ordEl.innerText = String(sales.length);
  if (tipEl) tipEl.innerText = "$" + tipsTotal;

  const employees = data.employees || {};
  const empRows = Object.entries(employees)
    .sort((a, b) => (b[1].total || 0) - (a[1].total || 0))
    .map(([name, info]) => {
      const total = Number(info.total || 0);
      const orders = Number(info.orders || 0);
      const tips = Number(info.tips || 0);
      return `<tr><td>${escapeHtml(name)}</td><td>$${total}</td><td>$${tips}</td><td>${orders}</td></tr>`;
    })
    .join("");

  const employeeTable = document.getElementById("employeeTable");
  if (employeeTable) {
    employeeTable.innerHTML = `
      <table class="table">
        <thead><tr><th>Name</th><th>Umsatz</th><th>Trinkgeld</th><th>Orders</th></tr></thead>
        <tbody>${empRows || `<tr><td colspan="4" class="muted">Noch keine Daten</td></tr>`}</tbody>
      </table>
    `;
  }

  if (isBoss()) {
    await loadUsers();
  }

  if (data.currentDay) {
    serverDay = data.currentDay;
    updateDayTimeUI();
  }
}

/* ========= Chef: Users ========= */
async function loadUsers() {
  if (!isBoss()) return;

  const res = await fetch("/users");
  if (res.status === 401) return showLoginPage("Bitte einloggen.");

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return;

  const el = document.getElementById("usersList");
  if (!el) return;

  const staff = data.staff || [];
  el.innerHTML = staff.length
    ? staff
        .map(
          u => `
        <div class="panel" style="margin-top:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <div>
              <b>${escapeHtml(u.displayName)}</b>
              <div class="muted small">@${escapeHtml(u.username)}</div>
            </div>
            <button class="danger" onclick="deleteUser('${escapeAttr(u.username)}')">Löschen</button>
          </div>
        </div>
      `
        )
        .join("")
    : `<div class="muted small">Keine Mitarbeiter vorhanden.</div>`;
}

async function addUser() {
  if (!isBoss()) return alert("Nur Chef.");

  const displayName = document.getElementById("newUserDisplayName")?.value?.trim() || "";
  const username = document.getElementById("newUserUsername")?.value?.trim() || "";
  const password = document.getElementById("newUserPassword")?.value || "";

  if (!displayName || !username || !password) return alert("Bitte alle Felder ausfüllen.");

  const res = await fetch("/users/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName, username, password })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return alert(data.message || "Fehler beim Hinzufügen.");

  document.getElementById("newUserDisplayName").value = "";
  document.getElementById("newUserUsername").value = "";
  document.getElementById("newUserPassword").value = "";

  loadUsers();
}

async function deleteUser(username) {
  if (!isBoss()) return alert("Nur Chef.");

  const res = await fetch("/users/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return alert(data.message || "Fehler beim Löschen.");
  loadUsers();
}

async function resetAll() {
  if (!isBoss()) return alert("Nur Chef.");
  if (!confirm("Wirklich Reset (heute)?")) return;

  const res = await fetch("/reset", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) return alert(data.message || "Reset fehlgeschlagen.");

  // Danach alles neu laden
  kitchenInitialized = false;
  lastMaxOrderId = 0;

  await refreshStats();
  await loadKitchen();
}

/* ========= Auth ========= */
async function login() {
  const username = document.getElementById("loginUser")?.value?.trim() || "";
  const password = document.getElementById("loginPass")?.value || "";

  if (!username || !password) {
    const m = document.getElementById("loginMsg");
    if (m) m.innerText = "Bitte Username & Passwort eingeben.";
    return;
  }

  const res = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    const m = document.getElementById("loginMsg");
    if (m) m.innerText = data.message || "Login fehlgeschlagen.";
    return;
  }

  // Eingeloggt -> App zeigen
  showApp();
  await refreshStats();

  // Standard Tab: Kasse
  const kassBtn = document.querySelector(".tabsTop .tabTop");
  openTab("tab_pos", kassBtn);

  // Fokus weg
  document.getElementById("loginPass") && (document.getElementById("loginPass").value = "");
}

async function logout() {
  await fetch("/auth/logout", { method: "POST" });
  me = null;
  applyRoleVisibility();
  clearCart();
  stopKitchenPolling();
  stopKitchenAgeTicker();
  showLoginPage("Ausgeloggt.");
}

/* ========= Day/Time ========= */
function updateDayTimeUI() {
  const el = document.getElementById("dayInfo");
  if (!el) return;

  const now = new Date();
  const time = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const day = serverDay || "—";
  el.innerText = `Tag: ${day} · Uhrzeit: ${time}`;
}

/* ========= Helpers ========= */
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("\n", " ").replaceAll("\r", " ");
}

/* ========= Boot ========= */
async function boot() {
  // Menu overlay vorbereiten
  ensureMenuOverlay();

  // Produkte rendern (Kasse-Ansicht)
  renderProducts();

  // Uhrzeit tick
  updateDayTimeUI();
  setInterval(updateDayTimeUI, 1000);

  // Check Session
  const res = await fetch("/auth/me");
  const data = await res.json().catch(() => ({}));

  if (!data.loggedIn) {
    showLoginPage("Bitte einloggen.");
    return;
  }

  // schon eingeloggt
  showApp();
  await refreshStats();

  // Standard Tab: Kasse
  const kassBtn = document.querySelector(".tabsTop .tabTop");
  openTab("tab_pos", kassBtn);
}

boot();
