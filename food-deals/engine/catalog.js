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
    let items = priceAll(results.flatMap((r) => r.listings));
    if (veg === true || veg === "true") items = items.filter((i) => i.veg);
    if (veg === "nonveg") items = items.filter((i) => !i.veg);
    if (maxPrice) items = items.filter((i) => i.pricing.total <= +maxPrice);
    if (minRating) items = items.filter((i) => (i.rating ?? 0) >= +minRating);
    if (maxEta) items = items.filter((i) => (i.etaMins ?? 99) <= +maxEta);

    const sorters = {
      price: (a, b) => a.pricing.perUnit - b.pricing.perUnit,
      offer: (a, b) => b.pricing.valueSavingsPct - a.pricing.valueSavingsPct || b.pricing.savings - a.pricing.savings,
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
      eta: (a, b) => (a.etaMins ?? 99) - (b.etaMins ?? 99),
    };
    items.sort(sorters[sort] ?? sorters.price);
    return { items: items.slice(0, +limit), total: items.length, sources, warnings };
  }

  /** Same dish, side by side: which app is cheaper and by how much. */
  async function compare(opts = {}) {
    const { items, sources, warnings } = await search({ ...opts, platform: undefined, limit: 500 });
    // Dishes listed on both apps first (that's the actual comparison), cheapest first.
    const onBoth = (r) => (Object.keys(r.byPlatform).length > 1 ? 0 : 1);
    const rows = groupAcrossPlatforms(items).sort((a, b) => onBoth(a) - onBoth(b) || a.cheapestTotal - b.cheapestTotal);
    return { rows: rows.slice(0, opts.limit ?? 40), sources, warnings };
  }

  /** Restaurants ranked by how strong today's offer is. */
  async function topOffers({ q = "", limit = 15 } = {}) {
    const { items, sources, warnings } = await search({ q, limit: 1000 });
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

  return { search, compare, topOffers, addresses, setAddress };
}
