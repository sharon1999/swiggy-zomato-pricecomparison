import { shortArea, cityOf } from "../engine/area.js";

// Live Zomato search via the official Zomato MCP `get_restaurants_for_keyword`.
//
// Each restaurant comes back with its matching dishes and its current offer
// (e.g. "Flat ₹75 OFF", "60% OFF up to ₹120"). Zomato doesn't say the offer's
// minimum order, so the offer is marked `estimated`: the app shows
// "≈₹X if eligible" instead of claiming it as a sure price.

export function parseOffer(label) {
  if (!label) return null;
  const base = { label, estimated: true, minOrder: 0, code: null };
  let m = label.match(/(\d+)\s*%\s*OFF(?:\s*up\s*to\s*₹\s*(\d+))?/i);
  if (m) return { ...base, type: "percent", pct: +m[1], max: m[2] ? +m[2] : null };
  m = label.match(/Flat\s*₹\s*(\d+)\s*OFF/i) || label.match(/₹\s*(\d+)\s*OFF/i);
  if (m) return { ...base, type: "flat", amount: +m[1] };
  if (/buy\s*1\s*get\s*1|bogo/i.test(label)) return { ...base, type: "bogo" };
  if (/free\s*delivery/i.test(label)) return { ...base, type: "freeDelivery" };
  return { ...base, type: "other" };
}

function etaMins(s) {
  const nums = String(s ?? "").match(/\d+/g)?.map(Number) ?? [];
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function createZomatoLive(conn) {
  async function addresses() {
    const r = await conn.callTool("get_saved_addresses_for_user", {});
    if (r.isError) throw new Error(r.text.slice(0, 200));
    const list = r.structured?.result?.addresses ?? r.structured?.addresses ?? [];
    return list.map((a) => {
      return { id: String(a.address_id), label: a.label || "Saved address", area: shortArea(a.location_name ?? "") };
    });
  }

  /** Selected address, or the one in the same city as `preferCity` (to match Swiggy). */
  async function addressId(preferCity) {
    const chosen = conn.auth._get().addressId;
    if (chosen) return chosen;
    const list = await addresses();
    if (!list.length) throw new Error("no saved address on your Zomato account; add one in the Zomato app");
    const city = preferCity ? cityOf(preferCity) : null;
    const match = (city && list.find((a) => cityOf(a.area) === city)) || list[0];
    conn.auth._set({ addressId: match.id });
    return match.id;
  }

  async function search(query, { veg, preferCity } = {}) {
    if (!query) return [];
    const id = await addressId(preferCity);
    const r = await conn.callTool("get_restaurants_for_keyword", { address_id: id, keyword: query, page_size: 20 });
    if (r.isError) throw new Error(r.text.split("\n")[0].slice(0, 200));
    const out = [];
    for (const rest of r.structured?.results ?? []) {
      if (rest.serviceability_status && rest.serviceability_status !== "serviceable") continue;
      const offer = parseOffer(rest.res_offer);
      for (const it of rest.items ?? []) {
        if (veg === true && !it.is_veg) continue;
        out.push({
          id: `zomato-live-${rest.res_id}-${it.variant_id ?? it.catalogue_id}`,
          platform: "zomato",
          source: "live",
          restaurant: rest.name,
          restaurantId: String(rest.res_id),
          variantId: it.variant_id ?? null,
          area: rest.distance != null ? `${rest.distance} km` : null,
          cuisine: [],
          dish: String(it.name).replace(/\.$/, "").trim(),
          category: "",
          veg: !!it.is_veg,
          price: Math.round(Number(it.price)),
          originalPrice: null,
          offer,
          deliveryFee: 0,
          packagingFee: 0,
          platformFee: 0,
          feesKnown: false,
          rating: rest.rating ?? null,
          etaMins: etaMins(rest.eta),
          imageUrl: it.image_link || rest.res_image || null,
        });
      }
    }
    return out;
  }

  return { search, addresses, addressId };
}
