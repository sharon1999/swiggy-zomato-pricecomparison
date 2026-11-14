// Ordering from the UI on Swiggy, using the official Swiggy MCP cart/order tools.
//
// Kept deliberately simple and safe:
// - "Order" makes the cart exactly one dish (× quantity). If your Swiggy cart
//   already holds something else, the UI must ask before it is replaced.
// - Payment is Pay on delivery only (no UPI polling yet).
// - Placing re-reads the cart and refuses if the total changed since you saw it.
// - One order at a time, and a failed/timed-out order is never retried
//   automatically (it may have gone through): we check active orders instead.

const firstLine = (t) => String(t ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, 300) ?? "";

export function createSwiggyOrder(conn, swiggyLive) {
  let placing = false;

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
    // The cart API doesn't return the restaurant id. We know it only if this
    // app put exactly these items in the cart.
    const s = saved();
    const ours =
      items.length > 0 &&
      Array.isArray(s.itemIds) &&
      s.itemIds.length === items.length &&
      items.every((i) => s.itemIds.includes(i.menuItemId));
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
      freeDelivery: !!d.offers?.free_delivery_applied,
    };
  }

  async function cart() {
    const addressId = await swiggyLive.addressId();
    const r = await conn.callTool("get_food_cart", { addressId, ...(saved().restaurantName ? { restaurantName: saved().restaurantName } : {}) });
    if (r.isError) {
      if (/empty|no items|not found/i.test(r.text)) return shape(null);
      throw new Error(firstLine(r.text) || "Couldn't read your Swiggy cart");
    }
    return shape(r);
  }

  /** Make the cart exactly this one dish × quantity (0 empties the cart). */
  async function setItem({ restaurantId, restaurantName, menuItemId, quantity = 1, replace = false }) {
    if (typeof restaurantId !== "string" || typeof menuItemId !== "string" || !restaurantId || !menuItemId) {
      throw new Error("Missing restaurant or dish");
    }
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 0 || qty > 10) throw new Error("Quantity must be 0 to 10");

    const cur = await cart();
    const onlyThis = cur.items.length === 1 && cur.items[0].menuItemId === menuItemId && !cur.items[0].options.length;
    if (cur.items.length && !onlyThis && !replace) return { needsReplace: true, cart: cur };

    if (cur.items.length) await call("flush_food_cart", {});
    if (qty === 0) {
      conn.auth._set({ cart: {} });
      return { cart: await cart() };
    }
    const addressId = await swiggyLive.addressId();
    await call("update_food_cart", {
      restaurantId,
      addressId,
      ...(restaurantName ? { restaurantName: String(restaurantName).slice(0, 120) } : {}),
      cartItems: [{ menu_item_id: menuItemId, quantity: qty }],
    });
    conn.auth._set({ cart: { restaurantId, restaurantName: restaurantName ?? null, itemIds: [menuItemId] } });
    return { cart: await cart() };
  }

  async function clear() {
    await call("flush_food_cart", {});
    conn.auth._set({ cart: {} });
    return { cart: await cart() };
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
      const cur = await cart();
      if (!cur.items.length) throw new Error("Your Swiggy cart is empty");
      if (!cur.pricing || cur.pricing.toPay !== Number(expectedTotal)) return { priceChanged: true, cart: cur };

      const pay = await call("get_payment_options", { addressId: await swiggyLive.addressId() });
      if (!pay.structured?.cod?.available) {
        return { failed: true, error: "Swiggy isn't offering Pay on delivery for this cart. Finish this order in the Swiggy app." };
      }

      const addressId = await swiggyLive.addressId();
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

  return { cart, setItem, clear, place };
}
