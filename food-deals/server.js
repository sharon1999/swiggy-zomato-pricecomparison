import "dotenv/config";
import express from "express";
import { createCatalog } from "./engine/catalog.js";
import { McpPlatform, MCP_SERVERS } from "./providers/mcp.js";
import { createDealFinder, describeAiError } from "./ai/dealFinder.js";
import { aiAvailable } from "./ai/claude.js";
import { createSwiggyLive } from "./providers/swiggyLive.js";
import { createSwiggyOrder } from "./providers/swiggyOrder.js";

const PORT = Number(process.env.PORT || 3000);
const REDIRECT = `http://localhost:${PORT}/callback`;

const live = Object.fromEntries(Object.keys(MCP_SERVERS).map((p) => [p, new McpPlatform(p, REDIRECT)]));
const catalog = createCatalog({ live });
const finder = createDealFinder({ catalog, live });
const swiggyOrder = createSwiggyOrder(live.swiggy, createSwiggyLive(live.swiggy));

const app = express();
app.use(express.json());
app.use(express.static("public"));

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

app.get("/api/status", wrap(async () => ({
  ai: aiAvailable(),
  city: process.env.DEFAULT_CITY || "Bengaluru",
  platforms: Object.fromEntries(
    Object.entries(live).map(([p, c]) => [p, { label: c.server.label, status: c.status, error: c.error, tools: c.tools.map((t) => t.name) }]),
  ),
})));

app.get("/api/search", wrap((req) => catalog.search(req.query)));
app.get("/api/compare", wrap((req) => catalog.compare(req.query)));
app.get("/api/top-offers", wrap((req) => catalog.topOffers(req.query)));

app.get("/api/:platform/addresses", wrap((req) => {
  if (!live[req.params.platform]) throw new Error("Unknown platform");
  return catalog.addresses(req.params.platform);
}));
app.post("/api/:platform/address", wrap(async (req) => {
  const p = req.params.platform;
  if (!live[p]) throw new Error("Unknown platform");
  const { addresses } = await catalog.addresses(p);
  if (!addresses.some((a) => a.id === req.body?.id)) throw new Error("Unknown address");
  catalog.setAddress(p, req.body.id);
  return { selected: req.body.id };
}));

// ---- Order on Swiggy from the UI (cart → bill → Pay on delivery) ----
const needSwiggy = () => {
  if (!live.swiggy.connected) throw new Error("Swiggy is not connected");
};
app.get("/api/swiggy/cart", wrap(() => (needSwiggy(), swiggyOrder.cart())));
app.post("/api/swiggy/cart", wrap((req) => (needSwiggy(), swiggyOrder.setItem(req.body ?? {}))));
app.post("/api/swiggy/cart/clear", wrap(() => (needSwiggy(), swiggyOrder.clear())));
app.post("/api/swiggy/order", wrap((req) => (needSwiggy(), swiggyOrder.place(req.body ?? {}))));

// ---- Sign in to Swiggy / Zomato (official OAuth via their MCP servers) ----
app.post("/api/connect/:platform", wrap(async (req) => {
  const conn = live[req.params.platform];
  if (!conn) throw new Error("Unknown platform");
  return conn.connect();
}));

app.post("/api/disconnect/:platform", wrap(async (req) => {
  const conn = live[req.params.platform];
  if (!conn) throw new Error("Unknown platform");
  await conn.disconnect();
  return { status: conn.status };
}));

app.get("/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const conn = live[String(state ?? "").split(".")[0]];
  const back = (msg) => res.redirect(`/?auth=${encodeURIComponent(msg)}`);
  if (error) return back(`Sign-in cancelled: ${error}`);
  if (!conn || !code) return back("Sign-in failed: missing code");
  if (!conn.auth.checkState(String(state))) return back("Sign-in failed: security check (state) did not match, try again");
  try {
    const r = await conn.finishAuth(String(code));
    back(r.status === "connected" ? `${conn.server.label} connected` : `Sign-in failed: ${r.error ?? r.status}`);
  } catch (err) {
    back(`Sign-in failed: ${err.message}`);
  }
});

// ---- AI deal finder (streams events as newline-delimited JSON) ----
function streamHandler(fn) {
  return async (req, res) => {
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    const emit = (ev) => res.write(JSON.stringify(ev) + "\n");
    if (!aiAvailable()) {
      emit({ type: "error", text: "AI is off: add ANTHROPIC_API_KEY to the .env file and restart. Search and compare still work." });
      return res.end();
    }
    try {
      await fn(req.body ?? {}, emit);
    } catch (err) {
      console.error(err);
      emit({ type: "error", text: describeAiError(err) });
    }
    emit({ type: "done" });
    res.end();
  };
}
app.post("/api/chat", streamHandler((body, emit) => finder.chat(body, emit)));
app.post("/api/confirm", streamHandler((body, emit) => finder.confirm(body, emit)));

// Reconnect saved sign-ins before serving, so the page never shows a stale status.
await Promise.all(
  Object.values(live).map(async (conn) => {
    const s = await conn.resume().catch(() => "error");
    if (s !== "disconnected") console.log(`${conn.server.label}: ${s}`);
  }),
);
app.listen(PORT, () => {
  console.log(`Food Deals running at http://localhost:${PORT}`);
  console.log(`AI deal finder: ${aiAvailable() ? "on" : "off (set ANTHROPIC_API_KEY in .env)"}`);
});
