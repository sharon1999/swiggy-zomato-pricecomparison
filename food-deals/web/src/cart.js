// Swiggy cart state + actions. The cart itself lives on Swiggy (the same cart
// as the Swiggy app); this hook mirrors it and talks to /api/swiggy/*.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, rs } from "./api.js";

export const CartContext = createContext(null);
export const useCart = () => useContext(CartContext);

export function useSwiggyCart({ enabled, toast }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [replaceWith, setReplaceWith] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState("");
  const [menu, setMenu] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuLoading, setMenuLoading] = useState(false);
  const [coupons, setCoupons] = useState(null); // { loading } | { coupons, applied, reason } | { error }
  const panelRef = useRef(null);

  // Re-read the cart. Leaves any error message alone so it stays visible.
  const reload = useCallback(async () => {
    if (!enabled) return setData(null);
    try {
      setData(await api("/api/swiggy/cart"));
    } catch (err) {
      setData(null);
      setError(`Couldn't read your Swiggy cart: ${err.message}`);
    }
  }, [enabled]);

  useEffect(() => {
    setError(null);
    reload();
  }, [reload]);

  // A different restaurant's cart: the open menu no longer applies.
  useEffect(() => {
    if (menu && menu.restaurant.id !== data?.restaurantId) {
      setMenu(null);
      setMenuOpen(false);
    }
  }, [data?.restaurantId, menu]);

  // Coupons depend on the restaurant and what's in the cart: re-read when either changes.
  const cartKey = data?.items?.length
    ? `${data.restaurantId ?? "app"}:${data.items.map((i) => `${i.menuItemId}x${i.quantity}`).join(",")}:${data.coupon ?? ""}`
    : "";
  useEffect(() => {
    if (!enabled || !cartKey) return setCoupons(null);
    let live = true;
    setCoupons((c) => ({ ...c, loading: true }));
    api("/api/swiggy/coupons")
      .then((r) => live && setCoupons(r))
      .catch((err) => live && setCoupons({ error: err.message }));
    return () => {
      live = false;
    };
  }, [enabled, cartKey]);

  const couponNotice = (r) => r.couponDropped && toast(`Coupon ${r.couponDropped} no longer applies to this cart`);

  /** Run one cart change at a time; errors show in the panel. */
  async function run(fn, { scroll = true } = {}) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setConfirming(false);
    setError(null);
    setResult(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
      await reload();
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (scroll) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  const add = (item, replace = false) =>
    run(
      async () => {
        const r = await api("/api/swiggy/cart/add", { ...item, replace });
        setData(r.cart);
        couponNotice(r);
        setReplaceWith(r.needsReplace ? { ...item, reason: r.reason } : null);
        if (!r.needsReplace) toast(`Added ${item.dish ?? "dish"} to your Swiggy cart`);
      },
      { scroll: !menuOpen },
    );

  const setQty = (menuItemId, quantity) =>
    run(
      async () => {
        const r = await api("/api/swiggy/cart/qty", { menuItemId, quantity });
        setData(r.cart);
        couponNotice(r);
      },
      { scroll: false },
    );

  const applyCoupon = (code) =>
    run(
      async () => {
        const r = await api("/api/swiggy/coupon/apply", { code });
        setData(r.cart);
        toast(`Coupon ${code} applied: you save ${rs(r.cart.couponDiscount)}`);
      },
      { scroll: false },
    );

  const removeCoupon = () =>
    run(async () => setData((await api("/api/swiggy/coupon/remove", {})).cart), { scroll: false });

  const clear = () =>
    run(
      async () => {
        setData((await api("/api/swiggy/cart/clear", {})).cart);
        setReplaceWith(null);
        setMenuOpen(false);
      },
      { scroll: false },
    );

  async function toggleMenu() {
    if (menuOpen) return setMenuOpen(false);
    setMenuOpen(true);
    const id = data?.restaurantId;
    if (!id || menu?.restaurant.id === id) return;
    setMenuLoading(true);
    try {
      setMenu(await api(`/api/swiggy/menu/${encodeURIComponent(id)}`));
    } catch (err) {
      setError(`Couldn't load the menu: ${err.message}`);
      setMenuOpen(false);
    }
    setMenuLoading(false);
  }

  async function place() {
    if (busyRef.current || !data?.pricing) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api("/api/swiggy/order", { expectedTotal: data.pricing.toPay, note, confirm: true });
      if (r.priceChanged) {
        setData(r.cart);
        setError(`The total changed to ${rs(r.cart.pricing?.toPay ?? 0)}. Check the bill and place again.`);
      } else if (r.failed) {
        setError(r.error);
      } else {
        setResult(r);
        setNote("");
        setMenuOpen(false);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setConfirming(false);
    }
  }

  return {
    enabled,
    data,
    busy,
    confirming,
    replaceWith,
    result,
    error,
    note,
    menu,
    menuOpen,
    menuLoading,
    coupons,
    applyCoupon,
    removeCoupon,
    panelRef,
    reload,
    add,
    setQty,
    clear,
    toggleMenu,
    place,
    setNote,
    startConfirm: () => {
      setError(null);
      setConfirming(true);
    },
    cancelConfirm: () => setConfirming(false),
    keepCart: () => setReplaceWith(null),
    dismissResult: () => {
      setResult(null);
      reload();
    },
  };
}
