// AI deal finder: Claude answers questions like "lowest price burgers today"
// or "which shop has the biggest offer right now" by calling tools over the
// catalog (and the live Swiggy/Zomato tools when you're signed in).
//
// Safety: any live tool that places/pays/books an order is never run
// automatically. The loop pauses and the UI asks you to confirm.

import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { createMessage, getClient, MODEL } from "./claude.js";
import { isRiskyTool } from "../providers/mcp.js";

const SYSTEM = `You are "Food Deals", a decisive assistant that helps the user find the cheapest food and the best offers across Swiggy and Zomato, fast. The user built this app because they waste too much time scrolling delivery apps, so your job is to decide for them.

How to answer:
- Always use the tools to get real numbers; never invent prices or offers.
- "Final price" means what they actually pay: item price minus offer, plus delivery, packaging and platform fees. Rank by final price (per unit for Buy-1-Get-1).
- Give at most 3 picks, best first. For each: dish, restaurant, platform, final price in ₹, the offer applied, rating, and delivery time. Then one line on why #1 wins.
- If the same dish is cheaper on the other app, say how much they save.
- If an offer needs a minimum order, say how much more to add, but only if it's actually worth it.
- Keep it short. No long lists, no filler. Use ₹.
- If the results come from demo data, say so in one short line at the end.
- Never claim an order was placed unless a tool result confirms it. Ordering always needs the user's confirmation in the app.`;

const LOCAL_TOOLS = [
  {
    name: "search_food",
    description:
      "Search dishes on Swiggy and Zomato with their real final price after offers and fees. Use for 'cheapest X', 'X under ₹N', 'best rated X'. Returns items sorted as requested.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Dish, cuisine or restaurant, e.g. 'burger', 'chicken biryani'. Empty for everything." },
        veg: { type: "string", enum: ["any", "veg", "nonveg"] },
        max_price: { type: "number", description: "Max final price in ₹" },
        min_rating: { type: "number" },
        max_eta_mins: { type: "number" },
        platform: { type: "string", enum: ["any", "swiggy", "zomato"] },
        sort: { type: "string", enum: ["price", "offer", "rating", "eta"] },
        limit: { type: "integer", description: "Default 10" },
      },
      required: ["query"],
    },
  },
  {
    name: "compare_platforms",
    description: "Compare the same dish at the same restaurant on Swiggy vs Zomato and show which app is cheaper and by how much.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        veg: { type: "string", enum: ["any", "veg", "nonveg"] },
        limit: { type: "integer", description: "Default 8" },
      },
      required: ["query"],
    },
  },
  {
    name: "top_offers",
    description: "Restaurants ranked by the strongest offer available today (real savings %), optionally filtered by a dish/cuisine. Use for 'highest offer', 'best deals today'.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional dish/cuisine filter" },
        limit: { type: "integer", description: "Default 8" },
      },
      required: [],
    },
  },
];

const compact = (i) => ({
  id: i.id,
  platform: i.platform,
  data: i.source,
  restaurant: i.restaurant,
  dish: i.dish,
  veg: i.veg,
  menu_price: i.price,
  offer: i.offer?.label ?? null,
  offer_applied: i.pricing.offerApplied,
  offer_note: i.pricing.offerNote,
  final_price: i.pricing.total,
  per_unit: i.pricing.perUnit,
  est_price_after_offer_if_eligible: i.pricing.estTotal ?? null,
  units: i.pricing.units,
  fees: i.feesKnown === false ? "not shown until checkout" : i.pricing.fees,
  savings: i.pricing.savings,
  rating: i.rating,
  eta_mins: i.etaMins,
});

const sessions = new Map(); // id -> { messages, pending }

export function createDealFinder({ catalog, live }) {
  // Live MCP tools are exposed to Claude as "<platform>__<tool>".
  function liveTools() {
    const out = [];
    for (const [platform, conn] of Object.entries(live)) {
      if (!conn.connected) continue;
      for (const t of conn.tools) {
        out.push({
          name: `${platform}__${t.name}`.slice(0, 64),
          description: `[${platform.toUpperCase()} live] ${t.description ?? t.name}`.slice(0, 1024),
          input_schema: t.inputSchema?.type === "object" ? t.inputSchema : { type: "object", properties: {} },
        });
      }
    }
    return out;
  }

  async function runLocalTool(name, input, emit) {
    const veg = input.veg === "veg" ? true : input.veg === "nonveg" ? "nonveg" : undefined;
    const platform = input.platform && input.platform !== "any" ? input.platform : undefined;
    if (name === "search_food") {
      emit({ type: "status", text: `Searching ${platform ?? "Swiggy & Zomato"} for "${input.query || "everything"}"…` });
      const r = await catalog.search({
        q: input.query ?? "",
        veg,
        maxPrice: input.max_price,
        minRating: input.min_rating,
        maxEta: input.max_eta_mins,
        platform,
        sort: input.sort ?? "price",
        limit: input.limit ?? 10,
      });
      emit({ type: "cards", kind: "items", items: r.items.slice(0, 6) });
      return { sources: r.sources, warnings: r.warnings, total_matches: r.total, items: r.items.map(compact) };
    }
    if (name === "compare_platforms") {
      emit({ type: "status", text: `Comparing "${input.query}" on Swiggy vs Zomato…` });
      const r = await catalog.compare({ q: input.query ?? "", veg, limit: input.limit ?? 8 });
      emit({ type: "cards", kind: "compare", rows: r.rows.slice(0, 5) });
      return {
        sources: r.sources,
        rows: r.rows.map((row) => ({
          restaurant: row.restaurant,
          dish: row.dish,
          cheaper_on: row.cheapestPlatform,
          you_save: row.youSave,
          platforms: Object.fromEntries(Object.entries(row.byPlatform).map(([p, i]) => [p, compact(i)])),
        })),
      };
    }
    if (name === "top_offers") {
      emit({ type: "status", text: `Finding today's biggest offers${input.query ? ` on ${input.query}` : ""}…` });
      const r = await catalog.topOffers({ q: input.query ?? "", limit: input.limit ?? 8 });
      emit({ type: "cards", kind: "offers", offers: r.offers.slice(0, 6) });
      return {
        sources: r.sources,
        offers: r.offers.map((o) => ({
          platform: o.platform,
          restaurant: o.restaurant,
          rating: o.rating,
          offer: o.offer.label,
          code: o.offer.code,
          best_dish: compact(o.bestDish),
          savings_pct: o.bestDish.pricing.valueSavingsPct,
        })),
      };
    }
    throw new Error(`Unknown tool ${name}`);
  }

  async function runTool(block, emit) {
    const [platform, liveName] = block.name.includes("__") ? block.name.split("__") : [null, null];
    try {
      if (platform && live[platform]) {
        emit({ type: "status", text: `Asking ${live[platform].server.label}: ${liveName}…` });
        const r = await live[platform].callTool(liveName, block.input);
        return { type: "tool_result", tool_use_id: block.id, content: r.text.slice(0, 40000) || "(empty)", is_error: r.isError };
      }
      const out = await runLocalTool(block.name, block.input ?? {}, emit);
      return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) };
    } catch (err) {
      return { type: "tool_result", tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true };
    }
  }

  /** Run the agent loop until Claude answers or a risky tool needs confirmation. */
  async function loop(session, emit) {
    const tools = [...LOCAL_TOOLS, ...liveTools()];
    const notes = [];
    const swiggyAddr = live.swiggy?.connected ? live.swiggy.auth._get().addressId : null;
    const zomatoAddr = live.zomato?.connected ? live.zomato.auth._get().addressId : null;
    if (swiggyAddr) notes.push(`Swiggy is live. Selected Swiggy addressId: "${swiggyAddr}". Live Swiggy prices are item prices; offers and fees appear only at checkout.`);
    if (zomatoAddr) notes.push(`Zomato is live. Selected Zomato address_id: "${zomatoAddr}". Zomato offers are restaurant-level and their minimum order isn't known, so present "≈₹X after offer" as an estimate ("if eligible").`);
    if (notes.length) notes.push("Prefer search_food / compare_platforms / top_offers for finding food. Never add to a cart or order unless the user asks.");
    const system = notes.length ? `${SYSTEM}\n\n${notes.join("\n")}` : SYSTEM;
    for (let step = 0; step < 12; step++) {
      const stream = getClient().beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system,
        tools,
        messages: session.messages,
      });
      stream.on("text", (delta) => emit({ type: "text", delta }));
      const msg = await stream.finalMessage();
      session.messages.push({ role: "assistant", content: msg.content });

      if (msg.stop_reason === "refusal") {
        emit({ type: "text", delta: "\n\nSorry, I can't help with that one." });
        return;
      }
      if (msg.stop_reason === "pause_turn") continue;
      const uses = msg.content.filter((b) => b.type === "tool_use");
      if (!uses.length) return;

      const risky = uses.filter((u) => {
        const [p, n] = u.name.split("__");
        return n && live[p] && isRiskyTool(n);
      });
      if (risky.length) {
        // Run the safe calls now, hold the risky one for the user's "yes".
        const results = [];
        for (const u of uses) if (!risky.includes(u)) results.push(await runTool(u, emit));
        session.pending = { uses: risky, results };
        const r = risky[0];
        emit({
          type: "confirm",
          id: r.id,
          platform: r.name.split("__")[0],
          action: r.name.split("__")[1],
          input: r.input,
        });
        return;
      }

      const results = [];
      for (const u of uses) results.push(await runTool(u, emit));
      session.messages.push({ role: "user", content: results });
    }
    emit({ type: "text", delta: "\n\n(Stopped after too many steps.)" });
  }

  async function chat({ sessionId, message }, emit) {
    const id = sessionId && sessions.has(sessionId) ? sessionId : crypto.randomUUID();
    if (!sessions.has(id)) sessions.set(id, { messages: [], pending: null });
    const session = sessions.get(id);
    emit({ type: "session", sessionId: id });

    if (session.pending) {
      // User typed instead of confirming: treat as "no".
      await resolvePending(session, false, emit, true);
    }
    session.messages.push({ role: "user", content: message });
    await loop(session, emit);
  }

  async function resolvePending(session, approved, emit, silent = false) {
    const { uses, results } = session.pending;
    session.pending = null;
    for (const u of uses) {
      if (approved) results.push(await runTool(u, emit));
      else results.push({ type: "tool_result", tool_use_id: u.id, content: "The user declined this action in the app. Do not retry it.", is_error: true });
    }
    session.messages.push({ role: "user", content: results });
    if (!silent) await loop(session, emit);
  }

  async function confirm({ sessionId, approved }, emit) {
    const session = sessions.get(sessionId);
    if (!session?.pending) throw new Error("Nothing waiting for confirmation");
    emit({ type: "session", sessionId });
    await resolvePending(session, !!approved, emit);
  }

  return { chat, confirm };
}

export function describeAiError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Your Anthropic API key is invalid. Check ANTHROPIC_API_KEY in .env.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the AI service. Try again in a minute.";
  if (err instanceof Anthropic.BadRequestError) return `AI request rejected: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `AI service error (${err.status}): ${err.message}`;
  return err.message;
}

export { createMessage };
