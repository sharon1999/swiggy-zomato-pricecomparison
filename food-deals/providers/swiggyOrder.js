// Ordering from the UI on Swiggy, using the official Swiggy MCP cart/order tools.
//
// Kept deliberately simple and safe:
// - A Swiggy cart holds dishes from ONE restaurant. Adding a dish from the same
//   restaurant adds it to the cart; a different restaurant (or a cart this app
//   didn't build) needs the user's OK before the cart is replaced.
// - Every cart change writes the whole item list (flush, then update), so the
//   result doesn't depend on whether Swiggy merges or replaces on update.
// - Dishes with size/variant choices aren't added here (no picker yet).
// - Payment is Pay on delivery only (no UPI polling yet).
// - Placing re-reads the cart and refuses if the total changed since you saw it.
// - One order at a time, and a failed/timed-out order is never retried
//   automatically (it may have gone through): we check active orders instead.

const firstLine = (t) => String(t ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, 300) ?? "";
const MAX_QTY = 10;
const MAX_LINES = 15;
const couponCodeOf = (c) => {
  if (!c) return null;
  const code = typeof c === "string" ? c : c.code ?? c.coupon_code ?? c.couponCode ?? null;
  return code ? String(code).trim() || null : null;
};

export function createSwiggyOrder(conn, swiggyLive) {
  let placing = false;
  let writing = Promise.resolve(); // serialise cart writes
  const menuCache = new Map(); // restaurantId -> { at, menu }

  async function call(name, args) {
    const r = await conn.callTool(name, args);
    if (r.isError) throw new Error(firstLine(r.text) || `${name} failed`);
    return r;
  }

  const saved = () => conn.auth._get().cart ?? {};

  function shape(r) {
    const d = r?.structured?.data ?? {};
    const items = (d.items ?? []).map((it) => ({
      menuItemId: String(it.menu_item_id),
      name: it.name,
      quantity: it.quantity,
      total: it.final_price ?? it.total ?? it.subtotal,
      veg: it.is_veg === "1" || it.is_veg === true,
      imageUrl: it.imageUrl ?? null,
      inStock: it.in_stock !== 0,
      options: [...(it.variants ?? []), ...(it.addons ?? [])].map((v) => v.name).filter(Boolean),
    }));
    // The cart API doesn't return the restaurant id. We know it only when this
    // app built the cart: every item in it is one we put there, with no options.
    const s = saved();
    const ours =
      items.length > 0 &&
      Array.isArray(s.itemIds) &&
      items.every((i) => s.itemIds.includes(i.menuItemId) && !i.options.length);
    const p = d.pricing;
    return {
      items,
      restaurantId: ours ? s.restaurantId : null,
      restaurantName: ours ? s.restaurantName : null,
      deliverTo: d.restaurant?.deliverySubtitle ?? null,
      pricing: p
        ? {
            itemTotal: p.item_total,
            delivery: p.delivery_charge,
            deliveryStrike: p.delivery_charge_strikeoff ?? null,
            taxes: Math.round((p.taxes_and_charges ?? 0) * 100) / 100,
            toPay: p.to_pay,
          }
        : null,
      couponDiscount: d.offers?.coupon_discount > 0 ? d.offers.coupon_discount : 0,
      // Swiggy may name a "best" coupon here without applying it: only trust it with a discount.
      coupon: d.offers?.coupon_discount > 0 ? couponCodeOf(d.offers.coupon_applied) : null,
      freeDelivery: !!d.offers?.free_delivery_applied,
    };
  }

  async function cart() {
    const addressId = await swiggyLive.addressId();
    const name = saved().restaurantName;
    const r = await conn.callTool("get_food_cart", { addressId, ...(name ? { restaurantName: name } : {}) });
    if (r.isError) {
      if (/empty|no items|not found/i.test(r.text)) return shape(null);
      throw new Error(firstLine(r.text) || "Couldn't read your Swiggy cart");
    }
    return shape(r);
  }

  /** Make the Swiggy cart exactly `lines` ([{ menuItemId, quantity }]) from one restaurant. */
  async function write(restaurantId, restaurantName, lines, { hadItems, previous, coupon }) {
    if (hadItems) await call("flush_food_cart", {});
    if (!lines.length) {
      conn.auth._set({ cart: {} });
      return;
    }
    const addressId = await swiggyLive.addressId();
    const send = (ls) =>
      call("update_food_cart", {
        restaurantId,
        addressId,
        ...(restaurantName ? { restaurantName: String(restaurantName).slice(0, 120) } : {}),
        cartItems: ls.map((l) => ({ menu_item_id: l.menuItemId, quantity: l.quantity })),
      });
    try {
      await send(lines);
    } catch (err) {
      // Put the previous items back so a failed add doesn't empty the cart.
      if (previous?.length) await send(previous).catch(() => {});
      else conn.auth._set({ cart: {} });
      throw err;
    }
    conn.auth._set({
      cart: { restaurantId, restaurantName: restaurantName ?? null, itemIds: lines.map((l) => l.menuItemId) },
    });
    // Rebuilding the cart drops the coupon: put it back if it still applies.
    if (coupon) {
      const r = await conn.callTool("apply_food_coupon", { couponCode: coupon, addressId }).catch(() => ({ isError: true }));
      if (r.isError) return { couponDropped: coupon };
    }
    return {};
  }

  // Cart writes run one at a time so two quick clicks can't interleave.
  const serial = (fn) => (...args) => {
    const run = writing.then(() => fn(...args));
    writing = run.catch(() => {});
    return run;
  };

  const linesOf = (c) => c.items.map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity }));

  /** Add one of a dish. Same restaurant: added to the cart. Otherwise asks before replacing. */
  const addItem = serial(async ({ restaurantId, restaurantName, menuItemId, replace = false }) => {
    if (typeof restaurantId !== "string" || typeof menuItemId !== "string" || !restaurantId || !menuItemId) {
      throw new Error("Missing restaurant or dish");
    }
    const cur = await cart();
    const sameRestaurant = cur.items.length > 0 && cur.restaurantId === restaurantId;

    if (cur.items.length && !sameRestaurant && !replace) {
      return {
        needsReplace: true,
        reason: cur.restaurantId ? "otherRestaurant" : "notFromApp",
        cart: cur,
      };
    }

    let lines = sameRestaurant ? linesOf(cur) : [];
    const existing = lines.find((l) => l.menuItemId === menuItemId);
    if (existing) {
      if (existing.quantity >= MAX_QTY) throw new Error(`Max ${MAX_QTY} of one dish`);
      existing.quantity += 1;
    } else {
      if (lines.length >= MAX_LINES) throw new Error(`Max ${MAX_LINES} different dishes`);
      lines.push({ menuItemId, quantity: 1 });
    }
    const name = sameRestaurant ? cur.restaurantName ?? restaurantName : restaurantName;
    const w = await write(restaurantId, name, lines, {
      hadItems: cur.items.length > 0,
      previous: sameRestaurant ? linesOf(cur) : null,
      coupon: sameRestaurant ? cur.coupon : null,
    });
    return { ...w, cart: await cart() };
  });

  /** Change the quantity of a dish already in an app-built cart (0 removes it). */
  const setQuantity = serial(async ({ menuItemId, quantity }) => {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 0 || qty > MAX_QTY) throw new Error(`Quantity must be 0 to ${MAX_QTY}`);
    const cur = await cart();
    if (!cur.restaurantId) throw new Error("This cart was set up in the Swiggy app; change it there");
    const lines = linesOf(cur);
    const line = lines.find((l) => l.menuItemId === String(menuItemId));
    if (!line) throw new Error("That dish isn't in your cart any more");
    line.quantity = qty;
    const next = lines.filter((l) => l.quantity > 0);
    const w = await write(cur.restaurantId, cur.restaurantName, next, { hadItems: true, previous: linesOf(cur), coupon: cur.coupon });
    return { ...w, cart: await cart() };
  });

  const clear = serial(async () => {
    await call("flush_food_cart", {});
    conn.auth._set({ cart: {} });
    return { cart: await cart() };
  });

  /**
   * Coupons Swiggy offers for this cart. Swiggy itself filters these to ones
   * that work with Pay on delivery. Needs a cart this app built, because the
   * cart API doesn't say which restaurant it's from.
   */
  async function coupons() {
    const cur = await cart();
    if (!cur.items.length) return { coupons: [], applied: null, reason: "empty" };
    if (!cur.restaurantId) return { coupons: [], applied: cur.coupon, reason: "notFromApp" };
    const addressId = await swiggyLive.addressId();
    const r = await call("fetch_food_coupons", { restaurantId: cur.restaurantId, addressId });
    const list = [];
    for (const sec of r.structured?.coupon_sections ?? []) {
      const section = sec.title ?? sec.name ?? sec.section_title ?? sec.type ?? null;
      for (const c of sec.coupons ?? []) {
        // Swiggy sends { id, title: "FLAT30", subtitle, applicable? }: the title IS the
        // coupon code (that's what apply_food_coupon takes); `id` is internal.
        // No `applicable` field means not applicable yet (e.g. "Add ₹14 more").
        const code = couponCodeOf(c) ?? (/^[A-Za-z0-9_-]{2,40}$/.test(c.title ?? "") ? c.title : null);
        const description = String(c.subtitle ?? c.description ?? "").slice(0, 200) || null;
        if (!code && !c.title) continue;
        list.push({
          code,
          title: String(c.title ?? code).slice(0, 120),
          description,
          discount: Number(description?.match(/(?:save|get|flat)\s*₹\s*(\d+)/i)?.[1] ?? 0),
          applicable: c.applicable === true,
          section,
        });
      }
    }
    // Usable ones first, biggest saving first.
    const rank = (c) => (c.applicable === false ? 1 : 0);
    list.sort((a, b) => rank(a) - rank(b) || b.discount - a.discount);
    return { coupons: list.slice(0, 20), applied: cur.coupon, reason: list.length ? null : "none" };
  }

  const applyCoupon = serial(async ({ code }) => {
    if (typeof code !== "string" || !/^[A-Za-z0-9_-]{2,40}$/.test(code)) throw new Error("Bad coupon code");
    const cur = await cart();
    if (!cur.items.length) throw new Error("Your Swiggy cart is empty");
    const addressId = await swiggyLive.addressId();
    await call("apply_food_coupon", { couponCode: code, addressId });
    const next = await cart();
    if (!next.couponDiscount) throw new Error(`Swiggy didn't give a discount for ${code} on this cart`);
    return { cart: next };
  });

  // There's no "remove coupon" tool: rebuild the same cart without it.
  const removeCoupon = serial(async () => {
    const cur = await cart();
    if (!cur.restaurantId) throw new Error("This cart was set up in the Swiggy app; remove the coupon there");
    await write(cur.restaurantId, cur.restaurantName, linesOf(cur), { hadItems: true, previous: linesOf(cur) });
    return { cart: await cart() };
  });

  /** A restaurant's menu, flattened to what the "add more" list needs. */
  async function menu(restaurantId) {
    if (typeof restaurantId !== "string" || !/^\d+$/.test(restaurantId)) throw new Error("Bad restaurant id");
    const hit = menuCache.get(restaurantId);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.menu;
    const addressId = await swiggyLive.addressId();
    const pages = [];
    for (let page = 1; page <= 3; page++) {
      const r = await call("get_restaurant_menu", { restaurantId, addressId, page, pageSize: 8 });
      pages.push(r.structured ?? {});
      if (!r.structured?.hasMore) break;
    }
    const rest = pages[0].restaurant ?? {};
    const seen = new Set();
    const categories = pages
      .flatMap((p) => p.categories ?? [])
      .map((c) => ({
        name: c.name ?? c.title ?? "Menu",
        items: (c.items ?? (c.subcategories ?? []).flatMap((s) => s.items ?? []))
          .filter((it) => it?.id != null && !seen.has(String(it.id)) && seen.add(String(it.id)))
          .map((it) => ({
            menuItemId: String(it.id),
            name: it.name,
            price: it.price,
            veg: !!it.isVeg,
            inStock: !!it.inStock,
            needsChoice: !!it.hasVariants,
            bestseller: !!it.isBestseller,
            imageUrl: it.imageUrl ?? null,
          })),
      }))
      .filter((c) => c.items.length);
    const out = {
      restaurant: { id: String(rest.id ?? restaurantId), name: rest.name ?? null, isOpen: rest.isOpen !== false, eta: rest.slaString ?? null },
      categories,
    };
    menuCache.set(restaurantId, { at: Date.now(), menu: out });
    return out;
  }

  async function activeOrders() {
    const addressId = await swiggyLive.addressId();
    const r = await conn.callTool("get_food_orders", { addressId, activeOnly: true, orderCount: 3 });
    return r.text.split("\n").filter((l) => l.trim() && !/widget|⚠️/i.test(l)).slice(0, 6).join("\n");
  }

  /** Place the current cart, Pay on delivery. `expectedTotal` must match what the user saw. */
  async function place({ expectedTotal, note, confirm }) {
    if (confirm !== true) throw new Error("Order needs your confirmation");
    if (placing) throw new Error("An order is already being placed");
    placing = true;
    try {
      await writing; // never place while a cart change is still running
      const cur = await cart();
      if (!cur.items.length) throw new Error("Your Swiggy cart is empty");
      if (!cur.pricing || cur.pricing.toPay !== Number(expectedTotal)) return { priceChanged: true, cart: cur };

      const addressId = await swiggyLive.addressId();
      const pay = await call("get_payment_options", { addressId });
      if (!pay.structured?.cod?.available) {
        return { failed: true, error: "Swiggy isn't offering Pay on delivery for this cart. Finish this order in the Swiggy app." };
      }

      const args = { addressId, paymentMethod: "Cash" };
      const trimmed = typeof note === "string" ? note.trim().slice(0, 200) : "";
      if (trimmed) args.noteToRestaurant = trimmed;

      let r;
      try {
        r = await conn.callTool("place_food_order", args);
      } catch (err) {
        // Timeout / network error: the order may still have gone through. Never retry.
        const active = await activeOrders().catch(() => null);
        return {
          uncertain: true,
          error: `We couldn't tell if Swiggy placed the order (${err.message}). Don't order again: check the Swiggy app first.`,
          active,
        };
      }
      if (r.isError) return { failed: true, error: firstLine(r.text) || "Swiggy didn't place the order" };

      const s = r.structured ?? {};
      const data = s.data ?? s;
      const orderId = String(data.orderId ?? data.order_id ?? s.orderId ?? r.text.match(/order\s*(?:id)?\s*[:#]?\s*(\d{6,})/i)?.[1] ?? "") || null;
      const status = data.status ?? s.status ?? null;
      conn.auth._set({ cart: {} });
      return {
        placed: status !== "PENDING_PAYMENT",
        pending: status === "PENDING_PAYMENT",
        orderId,
        message: firstLine(r.text),
        trackUrl: orderId ? `https://www.swiggy.com/track-order/${orderId}` : null,
      };
    } finally {
      placing = false;
    }
  }

  return { cart, addItem, setQuantity, clear, menu, coupons, applyCoupon, removeCoupon, place };
}
