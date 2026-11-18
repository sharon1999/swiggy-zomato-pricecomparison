// One place that answers "what food is out there, and what does it really cost?"
// Uses the live platform when you're signed in, demo data otherwise.

import { demoProvider } from "../providers/demo.js";
import { priceAll } from "./pricing.js";
import { groupAcrossPlatforms } from "./matcher.js";
import { createSwiggyLive } from "../providers/swiggyLive.js";
import { createZomatoLive } from "../providers/zomatoLive.js";

export const PLATFORMS = ["swiggy", "zomato"];
const LABEL = { swiggy: "Swiggy", zomato: "Zomato" };

export function createCatalog({ live }) {
  const demo = Object.fromEntries(PLATFORMS.map((p) => [p, demoProvider(p)]));
  const liveApi = { swiggy: createSwiggyLive(live.swiggy), zomato: createZomatoLive(live.zomato) };
  const cache = new Map(); // live results cache: key -> { at, listings }

  // City of the Swiggy address, so Zomato can default to the same place.
  async function preferredCity() {
    try {
      if (!live.swiggy?.connected) return null;
      const id = await liveApi.swiggy.addressId();
      const a = (await addressesCached("swiggy")).find((x) => x.id === id);
      return a?.area ?? null;
    } catch {
      return null;
    }
  }

  const addrCache = new Map();
  async function addressesCached(platform) {
    const hit = addrCache.get(platform);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.list;
    const list = await liveApi[platform].addresses();
    addrCache.set(platform, { at: Date.now(), list });
    return list;
  }

  async function fromPlatform(platform, query, { veg } = {}) {
    const conn = live[platform];
    if (!conn?.connected) return { listings: await demo[platform].search(query), mode: "demo" };
    if (!query) return { listings: [], mode: "live", info: `Type a dish to see live ${LABEL[platform]} prices near you.` };

    const isVeg = veg === true || veg === "true";
    const key = `${platform}:${query.toLowerCase()}:${isVeg}:${conn.auth._get().addressId}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000) return { listings: hit.listings, mode: "live" };
    try {
      const preferCity = platform === "zomato" ? await preferredCity() : null;
      const listings = await liveApi[platform].search(query, { veg: isVeg, preferCity });
      cache.set(key, { at: Date.now(), listings });
      return { listings, mode: "live" };
    } catch (err) {
      return { listings: [], mode: "live", warning: `${LABEL[platform]} live search failed: ${err.message}` };
    }
  }

  /** Search both platforms, price everything, filter and sort. */
  async function search({ q = "", veg, maxPrice, minRating, maxEta, platform, sort = "price", limit = 60 } = {}) {
    const plats = platform && PLATFORMS.includes(platform) ? [platform] : PLATFORMS;
    const results = await Promise.all(plats.map((p) => fromPlatform(p, q, { veg })));
    const sources = Object.fromEntries(plats.map((p, i) => [p, results[i].mode]));
    const warnings = results.map((r) => r.warning ?? r.info).filter(Boolean);

    // Never rank real prices against made-up demo prices: once any platform
    // returns live results, leave the demo ones out.
    const anyLive = results.some((r) => r.mode === "live" && r.listings.length);
    if (anyLive) {
      results.forEach((r, i) => {
        if (r.mode === "demo") {
          if (r.listings.length) warnings.push(`${plats[i]} isn't connected, so only live results are shown.`);
          r.listings = [];
        }
      });
    }
    const items = applyFilters(priceAll(results.flatMap((r) => r.listings)), { veg, maxPrice, minRating, maxEta });
    items.sort(SORTERS[sort] ?? SORTERS.price);
    return { items: items.slice(0, +limit), total: items.length, sources, warnings };
  }

  /**
   * Home screen: the cheapest dishes near you without typing anything.
   * Live platforms only search by keyword, so this runs a set of popular
   * dishes on both apps, merges them and ranks by price per item.
   */
  const homeCache = new Map(); // address key -> { at, items, sources, warnings }
  const anyConnected = () => PLATFORMS.some((p) => live[p]?.connected);

  /** The popular-dishes pool behind the home screen (cached 10 min per address). */
  async function homeBase() {
    const key = PLATFORMS.map((p) => (live[p]?.connected ? live[p].auth._get().addressId ?? "?" : "-")).join("|");
    let base = homeCache.get(key);
    if (!base || Date.now() - base.at > 10 * 60_000) {
      const results = [];
      // A few searches at a time, to go easy on the Swiggy/Zomato servers.
      for (let i = 0; i < HOME_QUERIES.length; i += 3) {
        const batch = HOME_QUERIES.slice(i, i + 3);
        results.push(...(await Promise.all(batch.map((q) => search({ q, limit: 1000 }).then((r) => ({ q, r }))))));
      }
      const byId = new Map();
      for (const { q, r } of results) for (const it of r.items) if (!byId.has(it.id)) byId.set(it.id, { ...it, category: q });
      const sources = {};
      for (const { r } of results) for (const [p, m] of Object.entries(r.sources)) if (sources[p] !== "live") sources[p] = m;
      const warnings = [...new Set(results.flatMap(({ r }) => r.warnings).filter((w) => !w.startsWith("Type a dish")))];
      base = { at: Date.now(), items: [...byId.values()], sources, warnings };
      homeCache.set(key, base);
    }
    return base;
  }

  /**
   * What the Compare / Top offers tabs work on: the search results for a typed
   * dish, or with nothing typed (and a platform connected) the home-screen pool.
   */
  async function pool(opts) {
    if (opts.q?.trim() || !anyConnected()) return search({ ...opts, platform: undefined, limit: 1000 });
    const base = await homeBase();
    const items = applyFilters(base.items, opts).sort(SORTERS.price);
    return { items, sources: base.sources, warnings: base.warnings };
  }

  async function home({ veg, maxPrice, minRating, maxEta, category, limit = 30 } = {}) {
    if (!anyConnected()) {
      const r = await search({ veg, maxPrice, minRating, maxEta, limit });
      return { ...r, categories: [] };
    }
    const base = await homeBase();

    // Real dishes only: no add-ons ("extra chutney") or tiny side items.
    let items = base.items.filter((i) => i.pricing.perUnit >= HOME_MIN_PRICE && !NOT_A_DISH.test(i.dish));
    items = applyFilters(items, { veg, maxPrice, minRating, maxEta });
    const counts = {};
    for (const i of items) counts[i.category] = (counts[i.category] ?? 0) + 1;
    const categories = HOME_QUERIES.filter((q) => counts[q]).map((q) => ({ name: q, count: counts[q] }));
    if (category) items = items.filter((i) => i.category === category);

    items.sort(SORTERS.price);
    // At most 2 dishes per restaurant, so one cheap shop doesn't fill the page.
    const perRest = new Map();
    const picked = [];
    for (const i of items) {
      const k = `${i.platform}:${i.restaurant}`;
      const n = perRest.get(k) ?? 0;
      if (n >= 2) continue;
      perRest.set(k, n + 1);
      picked.push(i);
      if (picked.length >= +limit) break;
    }
    return { items: picked, total: items.length, categories, sources: base.sources, warnings: base.warnings, home: true };
  }

  /** Same dish, side by side: which app is cheaper and by how much. */
  async function compare(opts = {}) {
    const { items, sources, warnings } = await pool(opts);
    // Dishes listed on both apps first (that's the actual comparison), cheapest first.
    const onBoth = (r) => (Object.keys(r.byPlatform).length > 1 ? 0 : 1);
    const rows = groupAcrossPlatforms(items).sort((a, b) => onBoth(a) - onBoth(b) || a.cheapestTotal - b.cheapestTotal);
    return { rows: rows.slice(0, opts.limit ?? 40), sources, warnings };
  }

  /** Restaurants ranked by how strong today's offer is. */
  async function topOffers({ limit = 15, ...opts } = {}) {
    const { items, sources, warnings } = await pool(opts);
    const byRest = new Map();
    for (const i of items) {
      if (!i.offer) continue;
      const key = `${i.platform}:${i.restaurant}`;
      const cur = byRest.get(key);
      if (!cur || i.pricing.valueSavingsPct > cur.bestDish.pricing.valueSavingsPct) {
        byRest.set(key, { platform: i.platform, restaurant: i.restaurant, area: i.area, rating: i.rating, offer: i.offer, bestDish: i });
      }
    }
    const offers = [...byRest.values()].sort(
      (a, b) => b.bestDish.pricing.valueSavingsPct - a.bestDish.pricing.valueSavingsPct,
    );
    return { offers: offers.slice(0, limit), sources, warnings };
  }

  // Delivery address per platform: prices, ETA and availability depend on it.
  async function addresses(platform) {
    if (!live[platform]?.connected) throw new Error(`${LABEL[platform] ?? platform} is not connected`);
    const list = await addressesCached(platform);
    const selected = await liveApi[platform].addressId(platform === "zomato" ? await preferredCity() : undefined);
    return { addresses: list, selected };
  }
  function setAddress(platform, id) {
    live[platform].auth._set({ addressId: id });
    cache.clear();
  }

  return { search, home, compare, topOffers, addresses, setAddress };
}

// Popular dishes searched for the home screen (cheapest food without typing).
export const HOME_QUERIES = ["biryani", "dosa", "burger", "pizza", "fried rice", "shawarma", "parotta", "meals"];
const HOME_MIN_PRICE = 30;
const NOT_A_DISH =
  /\b(extra|add[\s-]?on|addon|raita|chutney|gravy only|sauce|dip|mayo(nnaise)?|packing|packaging|water|bottle|curd|pickle|papad|cutlery|carry bag|pizza base|burger buns?)\b/i;

const SORTERS = {
  price: (a, b) => a.pricing.perUnit - b.pricing.perUnit,
  offer: (a, b) => b.pricing.valueSavingsPct - a.pricing.valueSavingsPct || b.pricing.savings - a.pricing.savings,
  rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
  eta: (a, b) => (a.etaMins ?? 99) - (b.etaMins ?? 99),
};

function applyFilters(items, { veg, maxPrice, minRating, maxEta }) {
  let out = items;
  if (veg === true || veg === "true") out = out.filter((i) => i.veg);
  if (veg === "nonveg") out = out.filter((i) => !i.veg);
  if (maxPrice) out = out.filter((i) => i.pricing.total <= +maxPrice);
  if (minRating) out = out.filter((i) => (i.rating ?? 0) >= +minRating);
  if (maxEta) out = out.filter((i) => (i.etaMins ?? 99) <= +maxEta);
  return out;
}
