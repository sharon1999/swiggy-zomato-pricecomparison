const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rs = (n) => `₹${Math.round(n)}`;

const state = { tab: "cheapest", veg: "", status: null, sessionId: null, busy: false };

// ---------- connections ----------
async function loadStatus() {
  state.status = await fetch("/api/status").then((r) => r.json());
  const { platforms, ai } = state.status;
  $("#conns").innerHTML = Object.entries(platforms)
    .map(([p, s]) => {
      const live = s.status === "connected";
      const dot = live ? "live" : s.status === "error" ? "err" : "";
      const label = live ? "Live" : s.status === "needs_auth" ? "Sign-in needed" : s.status === "error" ? "Error" : "Demo data";
      const btn = live
        ? `<button data-disconnect="${p}">Disconnect</button>`
        : `<button data-connect="${p}">Connect</button>`;
      return `<div class="conn" title="${esc(s.error ?? "")}"><span class="dot ${dot}"></span><b>${esc(s.label)}</b> ${label} ${btn}</div>`;
    })
    .join("") +
    `<div class="conn"><span class="dot ${ai ? "live" : ""}"></span><b>AI</b> ${ai ? "On" : "Off"}&nbsp;</div>`;
  loadAddresses();
  $("#aiState").textContent = ai
    ? "Ask in plain words. It checks both apps and picks for you."
    : "AI is off. Add ANTHROPIC_API_KEY to .env and restart. Search still works.";
}

$("#conns").addEventListener("click", async (e) => {
  const c = e.target.dataset.connect;
  const d = e.target.dataset.disconnect;
  if (c) {
    e.target.disabled = true;
    e.target.textContent = "Connecting…";
    const r = await fetch(`/api/connect/${c}`, { method: "POST" }).then((r) => r.json());
    if (r.authUrl) {
      toast("Opening sign-in page. Approve there and you'll come back here.");
      location.href = r.authUrl;
      return;
    }
    if (r.status === "connected") toast(`${c} connected`);
    else toast(`Couldn't connect to ${c}: ${r.error ?? r.status}. Using demo data.`);
    loadStatus();
    run();
  }
  if (d) {
    await fetch(`/api/disconnect/${d}`, { method: "POST" });
    loadStatus();
    run();
  }
});

async function loadAddresses() {
  const livePlats = Object.entries(state.status.platforms).filter(([, s]) => s.status === "connected").map(([p]) => p);
  const rows = await Promise.all(
    livePlats.map(async (p) => {
      try {
        const r = await fetch(`/api/${p}/addresses`).then((r) => r.json());
        if (r.error) throw new Error(r.error);
        const sel = r.addresses.find((a) => a.id === r.selected);
        return { p, html: r.addresses.map((a) => `<option value="${esc(a.id)}" ${a.id === r.selected ? "selected" : ""}>${esc(a.label)}${a.area ? ` · ${esc(a.area)}` : ""}</option>`).join(""), city: (sel?.area?.split(",").pop() ?? "").trim().toLowerCase().replace("bangalore", "bengaluru").replace("trivandrum", "thiruvananthapuram") };
      } catch (err) {
        toast(`Couldn't load ${p} addresses: ${err.message}`);
        return null;
      }
    }),
  );
  const ok = rows.filter(Boolean);
  const mismatch = ok.length === 2 && ok[0].city && ok[1].city && ok[0].city !== ok[1].city;
  $("#addrs").innerHTML =
    ok.map((r) => `<label class="addr ${mismatch ? "mismatch" : ""}"><span class="plat ${r.p}">${r.p}</span><select data-plat="${r.p}">${r.html}</select></label>`).join("") +
    (mismatch ? `<div class="city-warn">Your Swiggy and Zomato addresses are in different cities, so prices won't be comparable. Pick the same place for both.</div>` : "");
}
$("#addrs").addEventListener("change", async (e) => {
  const p = e.target.dataset.plat;
  if (!p) return;
  await fetch(`/api/${p}/address`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.target.value }) });
  loadAddresses();
  run();
});

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 4500);
}

// ---------- cards ----------
function itemCard(i, { best = false, mini = false } = {}) {
  const p = i.pricing;
  const offer = p.offerApplied
    ? `<span class="offer">${esc(p.offerApplied)}${i.offer?.code ? ` · ${esc(i.offer.code)}` : ""}</span>`
    : i.offer?.estimated
      ? `<span class="offer">${esc(p.offerNote)}</span>`
      : p.offerNote
        ? `<span class="offer locked">${esc(p.offerNote)}</span>`
        : "";
  const live = i.feesKnown === false;
  const plat = i.platform === "zomato" ? "Zomato" : "Swiggy";
  const unit = p.units > 1 ? `<small>${rs(p.perUnit)}/item · ${p.units} items</small>` : `<small>${live ? "item price" : "final price"}</small>`;
  const breakdown = live
    ? `<div class="breakdown">${i.offer?.estimated ? "Min. order for the offer & delivery fee" : "Delivery fee & offers"} shown at ${plat} checkout${i.bestseller ? " · Bestseller" : ""}</div>`
    : `<div class="breakdown">Item ${rs(p.itemTotal)}${p.discount ? ` − offer ${rs(p.discount)}` : ""} + fees ${rs(p.fees)}${p.savings ? ` · you save ${rs(p.savings)}` : ""}</div>`;
  return `<div class="card ${best ? "best" : ""}">
    ${best ? `<span class="badge-best">Best pick</span>` : ""}
    ${i.imageUrl && !mini ? `<img class="thumb" src="${esc(i.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}
    <div class="row"><div class="dish"><span class="veg ${i.veg ? "" : "non"}"></span>${esc(i.dish)}</div><span class="plat ${i.platform}">${i.platform}</span></div>
    <div class="rest">${esc(i.restaurant)}${i.area ? ` · ${esc(i.area)}` : ""}</div>
    <div><span class="price">${rs(p.total)}</span>${unit}${i.originalPrice ? `<span class="strike">${rs(i.originalPrice)}</span>` : ""}</div>
    ${offer}
    ${mini ? "" : breakdown}
    <div class="meta"><span>★ ${i.rating ?? "–"}</span><span>${i.etaMins ? `${i.etaMins} min` : ""}</span>${i.source === "demo" ? `<span class="tag-demo">demo</span>` : `<span class="tag-live">live</span>`}</div>
  </div>`;
}

function side(i, win) {
  if (!i) return `<div class="side"><span class="muted">Not listed</span></div>`;
  const p = i.pricing;
  return `<div class="side ${win ? "win" : ""}">
    <div class="row"><span class="plat ${i.platform}">${i.platform}</span>${win ? `<span class="save">Cheaper</span>` : ""}</div>
    <div class="price">${rs(p.total)}</div>
    <div class="breakdown">${p.offerApplied ? esc(p.offerApplied) : p.offerNote ? esc(p.offerNote) : i.feesKnown === false ? "Offers at checkout" : "No offer"}</div>
    <div class="meta"><span>★ ${i.rating ?? "–"}</span><span>${i.etaMins ?? ""} min</span></div>
  </div>`;
}

function compareCard(row) {
  const s = row.byPlatform.swiggy;
  const z = row.byPlatform.zomato;
  return `<div class="card cmp">
    <div>
      <div class="dish"><span class="veg ${row.veg ? "" : "non"}"></span>${esc(row.dish)}</div>
      <div class="rest">${esc(row.restaurant)}</div>
      ${!s || !z
        ? `<div class="muted" style="margin-top:6px">Only on ${s ? "Swiggy" : "Zomato"}</div>`
        : row.youSave > 0
          ? `<div class="save" style="margin-top:6px">Save ${rs(row.youSave)} on ${row.cheapestPlatform}</div>`
          : `<div class="muted" style="margin-top:6px">Same price${z?.offer ? ", but Zomato has an offer" : ""}</div>`}
    </div>
    ${side(s, s && row.cheapestPlatform === "swiggy" && row.youSave > 0)}
    ${side(z, z && row.cheapestPlatform === "zomato" && row.youSave > 0)}
  </div>`;
}

function offerCard(o, idx) {
  const d = o.bestDish;
  return `<div class="card ${idx === 0 ? "best" : ""}">
    ${idx === 0 ? `<span class="badge-best">Biggest offer</span>` : ""}
    <div class="row"><div class="dish">${esc(o.restaurant)}</div><span class="plat ${o.platform}">${o.platform}</span></div>
    <span class="offer">${esc(o.offer.label)}${o.offer.code ? ` · ${esc(o.offer.code)}` : ""}</span>
    <div class="rest">Best value: ${esc(d.dish)}</div>
    <div><span class="price">${d.pricing.estTotal != null ? "≈" : ""}${rs(d.pricing.estTotal ?? d.pricing.total)}</span><small class="muted"> ${d.pricing.valueSavingsPct}% off${d.pricing.estTotal != null ? ` · was ${rs(d.pricing.total)}, if eligible` : ""}</small></div>
    <div class="meta"><span>★ ${o.rating ?? "–"}</span><span>${d.etaMins ?? ""} min</span>${d.source === "demo" ? `<span class="tag-demo">demo</span>` : ""}</div>
  </div>`;
}

// ---------- search page ----------
function params() {
  const p = new URLSearchParams();
  const q = $("#q").value.trim();
  if (q) p.set("q", q);
  if (state.veg) p.set("veg", state.veg);
  for (const id of ["maxPrice", "minRating", "maxEta"]) if ($(`#${id}`).value) p.set(id, $(`#${id}`).value);
  return p;
}

function showNotice(sources, warnings = []) {
  const demo = Object.entries(sources ?? {}).filter(([, m]) => m === "demo").map(([p]) => p);
  const anyLive = Object.values(sources ?? {}).includes("live");
  const msgs = [...warnings];
  if (demo.length && !anyLive) msgs.push(`${demo.join(" & ")} showing demo data. Connect at the top for real prices.`);
  $("#notice").hidden = !msgs.length;
  $("#notice").textContent = msgs.join(" ");
}

async function run() {
  const p = params();
  const el = $("#results");
  el.innerHTML = `<div class="empty"><span class="spin" style="display:inline-block"></span></div>`;
  try {
    if (state.tab === "cheapest") {
      p.set("sort", "price");
      const r = await fetch(`/api/search?${p}`).then((r) => r.json());
      showNotice(r.sources, r.warnings);
      el.innerHTML = r.items.length ? r.items.map((i, k) => itemCard(i, { best: k === 0 })).join("") : `<div class="empty">${p.get("q") ? "Nothing matches. Try fewer filters." : "Search a dish above, or tap a question on the right, to compare live prices."}</div>`;
    } else if (state.tab === "compare") {
      const r = await fetch(`/api/compare?${p}`).then((r) => r.json());
      showNotice(r.sources, r.warnings);
      el.innerHTML = r.rows.length ? r.rows.map(compareCard).join("") : `<div class="empty">Nothing to compare.</div>`;
    } else {
      const r = await fetch(`/api/top-offers?${p}`).then((r) => r.json());
      showNotice(r.sources, r.warnings);
      el.innerHTML = r.offers.length ? r.offers.map(offerCard).join("") : `<div class="empty">No offers found.</div>`;
    }
  } catch (err) {
    el.innerHTML = `<div class="empty">Couldn't load results: ${esc(err.message)}</div>`;
  }
}

$("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); run(); });
$("#tabs").addEventListener("click", (e) => {
  const t = e.target.dataset.tab;
  if (!t) return;
  state.tab = t;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  run();
});
$("#vegSeg").addEventListener("click", (e) => {
  if (!("veg" in e.target.dataset)) return;
  state.veg = e.target.dataset.veg;
  document.querySelectorAll("#vegSeg button").forEach((b) => b.classList.toggle("on", b === e.target));
  run();
});
for (const id of ["maxPrice", "minRating", "maxEta"]) $(`#${id}`).addEventListener("change", run);

// ---------- AI chat ----------
function md(text) {
  // Tiny, safe markdown: escape first, then bold / lists / paragraphs.
  const lines = esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split("\n");
  let out = "", list = null;
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*•]|(\d+)\.)\s+(.*)/);
    if (m) {
      const type = m[1] ? "ol" : "ul";
      if (list !== type) { if (list) out += `</${list}>`; out += `<${type}>`; list = type; }
      out += `<li>${m[2]}</li>`;
    } else {
      if (list) { out += `</${list}>`; list = null; }
      if (line.trim()) out += `<p>${line}</p>`;
    }
  }
  if (list) out += `</${list}>`;
  return out;
}

function add(html, cls = "") {
  const div = document.createElement("div");
  div.className = cls;
  div.innerHTML = html;
  $("#chat").append(div);
  $("#chat").scrollTop = $("#chat").scrollHeight;
  return div;
}

async function streamTo(url, body) {
  state.busy = true;
  $("#askForm button").disabled = true;
  const started = performance.now();
  const status = add(`<span class="spin"></span><span>Thinking…</span>`, "status");
  let bot = null, text = "";
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === "session") state.sessionId = ev.sessionId;
        else if (ev.type === "status") status.lastElementChild.textContent = ev.text;
        else if (ev.type === "text") {
          if (!bot) { bot = add("", "msg bot"); $("#chat").append(status); }
          text += ev.delta;
          bot.innerHTML = md(text);
        } else if (ev.type === "cards") {
          let html = "";
          if (ev.kind === "items") html = ev.items.slice(0, 3).map((i, k) => itemCard(i, { best: k === 0, mini: true })).join("");
          if (ev.kind === "offers") html = ev.offers.slice(0, 3).map(offerCard).join("");
          if (ev.kind === "compare") html = ev.rows.slice(0, 2).map(compareCard).join("");
          if (html) add(html, "mini");
          bot = null; text = "";
        } else if (ev.type === "confirm") {
          showConfirm(ev);
        } else if (ev.type === "error") {
          add(esc(ev.text), "msg err");
        }
        $("#chat").scrollTop = $("#chat").scrollHeight;
      }
    }
  } catch (err) {
    add(`Connection problem: ${esc(err.message)}`, "msg err");
  } finally {
    status.remove();
    const secs = ((performance.now() - started) / 1000).toFixed(0);
    if (bot) add(`⏱ Decided in ${secs}s`, "timer");
    state.busy = false;
    $("#askForm button").disabled = false;
  }
}

function showConfirm(ev) {
  const box = add(
    `<b>Confirm before ordering</b>
     <div class="muted">${esc(ev.platform)} wants to run <b>${esc(ev.action)}</b>. Nothing happens until you approve.</div>
     <pre>${esc(JSON.stringify(ev.input, null, 2))}</pre>
     <div class="row"><button class="btn primary" data-yes>Confirm</button><button class="btn" data-no>Cancel</button></div>`,
    "confirm",
  );
  box.addEventListener("click", (e) => {
    const yes = "yes" in e.target.dataset;
    const no = "no" in e.target.dataset;
    if (!yes && !no) return;
    box.querySelectorAll("button").forEach((b) => (b.disabled = true));
    streamTo("/api/confirm", { sessionId: state.sessionId, approved: yes });
  });
}

function ask(text) {
  if (!text || state.busy) return;
  add(esc(text), "msg user");
  streamTo("/api/chat", { sessionId: state.sessionId, message: text });
}

$("#askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#askInput").value.trim();
  $("#askInput").value = "";
  ask(v);
});
$("#chips").addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") ask(e.target.textContent); });

// ---------- start ----------
const authMsg = new URLSearchParams(location.search).get("auth");
if (authMsg) { toast(authMsg); history.replaceState(null, "", "/"); }
loadStatus().then(run);
