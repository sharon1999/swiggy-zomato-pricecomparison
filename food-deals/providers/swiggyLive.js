// Live Swiggy search: maps the official Swiggy MCP `search_menu` results
// straight into the app's listing format (no AI needed for this part).
//
// What Swiggy's search gives us: real dish price, veg flag, rating, delivery
// time and distance for your saved address. What it doesn't: offers and
// delivery/packaging fees. Swiggy only calculates those once a cart exists,
// and we don't touch your real cart just to peek, so they show as "at checkout".

import { shortArea } from "../engine/area.js";

const PAGES = [0, 10, 20]; // search_menu returns 10 items per page

export function createSwiggyLive(conn) {
  async function addresses() {
    const r = await conn.callTool("get_addresses", {});
    if (r.isError) throw new Error(r.text.slice(0, 200));
    const list = r.structured?.addresses ?? [];
    // Only what the picker needs: no phone numbers or full street address.
    return list.map((a) => ({
      id: a.id,
      label: a.addressTag || a.addressCategory || "Saved address",
      category: a.addressCategory ?? null,
      area: shortArea(a.addressLine),
    }));
  }

  async function addressId() {
    const chosen = conn.auth._get().addressId;
    if (chosen) return chosen;
    const list = await addresses();
    if (!list.length) throw new Error("no saved address on your Swiggy account; add one in the Swiggy app");
    conn.auth._set({ addressId: list[0].id }); // Swiggy lists the most relevant first
    return list[0].id;
  }

  async function search(query, { veg } = {}) {
    if (!query) return [];
    const id = await addressId();
    const pages = await Promise.all(
      PAGES.map((offset) =>
        conn.callTool("search_menu", { query, addressId: id, offset, ...(veg === true ? { vegFilter: 1 } : {}) }),
      ),
    );
    const first = pages[0];
    if (first.isError) throw new Error(first.text.split("\n")[0].slice(0, 200));
    const seen = new Set();
    const items = [];
    for (const p of pages) {
      for (const it of p.structured?.items ?? []) {
        if (seen.has(it.menu_item_id) || !it.inStock) continue;
        seen.add(it.menu_item_id);
        items.push(toListing(it));
      }
    }
    return items;
  }

  return { search, addresses, addressId };
}

function toListing(it) {
  const restRating = parseFloat(it.restaurant_rating);
  const itemRating = parseFloat(it.rating);
  return {
    id: `swiggy-live-${it.menu_item_id}`,
    platform: "swiggy",
    source: "live",
    restaurant: it.restaurant_name,
    restaurantId: it.restaurant_id,
    menuItemId: it.menu_item_id,
    area: it.distanceKm != null ? `${it.distanceKm} km` : null,
    cuisine: [],
    dish: it.name.replace(/\.$/, "").trim(),
    category: "",
    veg: !!it.isVeg,
    price: Number(it.price),
    originalPrice: null,
    offer: null,
    deliveryFee: 0,
    packagingFee: 0,
    platformFee: 0,
    feesKnown: false,
    rating: Number.isFinite(restRating) ? restRating : Number.isFinite(itemRating) ? itemRating : null,
    itemRating: Number.isFinite(itemRating) ? itemRating : null,
    etaMins: it.deliveryTimeMinutes ?? null,
    bestseller: !!it.isBestseller,
    imageUrl: it.imageUrl ?? null,
  };
}
