import { rs } from "../api.js";
import { useCart } from "../cart.js";
import { Button, LinkButton, Plat, Status, VegDot, cx } from "./ui.jsx";

const box = "rounded-[10px] px-3 py-2.5 text-[13px]";
const errBox = cx(box, "whitespace-pre-wrap bg-zomato-soft text-zomato");
const warnBox = cx(box, "bg-warn-soft text-ink");

function Title({ count }) {
  const c = useCart();
  return (
    <h2 className="m-0 flex flex-wrap items-center gap-2 text-base font-bold">
      <Plat p="swiggy" /> Your cart
      {c.data?.restaurantName ? ` · ${c.data.restaurantName}` : ""}
      {count ? <span className="text-[13px] font-normal text-muted">({count} item{count === 1 ? "" : "s"})</span> : null}
    </h2>
  );
}

function OrderResult() {
  const c = useCart();
  const r = c.result;
  return (
    <>
      {r.uncertain ? (
        <div className={errBox}>
          <b>Order status unknown.</b> {r.error}
          {r.active ? `\n\nActive orders on Swiggy:\n${r.active}` : ""}
        </div>
      ) : (
        <div className="rounded-[10px] bg-accent-soft px-3 py-2.5 text-sm">
          <b>{r.pending ? "Waiting for payment" : "✅ Swiggy order placed"}</b>
          {r.message && <div className="text-[13px] text-muted">{r.message}</div>}
          {r.orderId && <div className="text-[13px] text-muted">Order ID {r.orderId}</div>}
          <div className="text-[13px] text-muted">Pay on delivery, or pay in the Swiggy app any time before it arrives.</div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {r.trackUrl && (
          <a
            className="flex-1 rounded-xl border border-accent bg-accent px-4 py-2.5 text-center font-semibold text-accent-ink no-underline"
            href={r.trackUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Track order
          </a>
        )}
        <Button className="flex-1" onClick={c.dismissResult}>
          Done
        </Button>
      </div>
    </>
  );
}

function ReplacePrompt() {
  const c = useCart();
  const w = c.replaceWith;
  const items = c.data.items;
  const has = items.map((i, k) => (
    <span key={i.menuItemId}>
      {k ? ", " : ""}
      <b>{i.name}</b>
    </span>
  ));
  const them = items.length > 1 ? "them" : "it";
  return (
    <div className={warnBox}>
      {w.reason === "otherRestaurant" ? (
        <>
          A Swiggy cart holds dishes from <b>one restaurant</b>. Your cart has {has}
          {c.data.restaurantName ? ` from ${c.data.restaurantName}` : ""}. Adding <b>{w.dish}</b> from <b>{w.restaurantName}</b> starts a
          new cart and removes {them}.
        </>
      ) : (
        <>
          Your Swiggy cart already has {has} (added in the Swiggy app). Adding <b>{w.dish}</b> here will replace {them}.
        </>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="primary" className="flex-1" disabled={c.busy} onClick={() => c.add(w, true)}>
          Start new cart
        </Button>
        <Button className="flex-1" disabled={c.busy} onClick={c.keepCart}>
          Keep current cart
        </Button>
      </div>
    </div>
  );
}

function CartItem({ i, editable }) {
  const c = useCart();
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2.5">
      {i.imageUrl ? (
        <img className="size-11 rounded-lg bg-bg object-cover" src={i.imageUrl} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span className="size-11 rounded-lg bg-bg" />
      )}
      <div className="min-w-0">
        <div className="flex gap-1.5 text-sm font-semibold">
          <VegDot veg={i.veg} />
          {i.name}
        </div>
        <div className="text-xs text-muted">
          {i.options.length ? `${i.options.join(", ")} · ` : ""}
          {rs(i.total)}
          {i.inStock ? "" : " · out of stock"}
        </div>
      </div>
      {editable && !i.options.length ? (
        <div className="inline-flex items-center overflow-hidden rounded-lg border border-line">
          <button
            className="h-7 w-7 cursor-pointer border-0 bg-bg font-bold disabled:opacity-50"
            disabled={c.busy}
            aria-label={i.quantity === 1 ? "Remove" : "One less"}
            onClick={() => c.setQty(i.menuItemId, i.quantity - 1)}
          >
            {i.quantity === 1 ? "🗑" : "−"}
          </button>
          <span className="min-w-[26px] text-center text-[13px] font-semibold">{i.quantity}</span>
          <button
            className="h-7 w-7 cursor-pointer border-0 bg-bg font-bold disabled:opacity-50"
            disabled={c.busy || i.quantity >= 10}
            aria-label="One more"
            onClick={() => c.setQty(i.menuItemId, i.quantity + 1)}
          >
            +
          </button>
        </div>
      ) : (
        <span className="text-[13px] text-muted">× {i.quantity}</span>
      )}
    </div>
  );
}

function MenuList() {
  const c = useCart();
  if (c.menuLoading) return <Status>Loading menu…</Status>;
  if (!c.menu) return null;
  const inCart = Object.fromEntries(c.data.items.map((i) => [i.menuItemId, i.quantity]));
  return (
    <div className="grid max-h-[340px] gap-0.5 overflow-y-auto rounded-[10px] border border-line bg-bg px-2.5 py-1.5">
      {!c.menu.restaurant.isOpen && <div className={errBox}>This restaurant looks closed right now.</div>}
      {c.menu.categories.map((cat) => (
        <div key={cat.name}>
          <div className="mb-0.5 mt-2 text-[11px] font-bold uppercase tracking-wider text-muted">{cat.name}</div>
          {cat.items.map((it) => (
            <div key={it.menuItemId} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 py-1 text-[13px]">
              <div className="flex gap-1.5">
                <VegDot veg={it.veg} />
                {it.name}
                {it.bestseller && <span className="text-[11px] text-swiggy">★</span>}
              </div>
              <span className="text-xs text-muted">{rs(it.price)}</span>
              {!it.inStock ? (
                <span className="text-xs text-muted">Sold out</span>
              ) : it.needsChoice ? (
                <span className="text-xs text-muted" title="This dish has sizes to choose. Add it in the Swiggy app.">
                  Sizes · app
                </span>
              ) : (
                <Button
                  variant="swiggyOutline"
                  size="xs"
                  disabled={c.busy}
                  onClick={() =>
                    c.add({ restaurantId: c.data.restaurantId, restaurantName: c.data.restaurantName, menuItemId: it.menuItemId, dish: it.name })
                  }
                >
                  {inCart[it.menuItemId] ? `Add · ${inCart[it.menuItemId]} in cart` : "Add"}
                </Button>
              )}
            </div>
          ))}
        </div>
      ))}
      {!c.menu.categories.length && <div className="text-[13px] text-muted">No dishes found.</div>}
    </div>
  );
}

function Coupons() {
  const c = useCart();
  const s = c.coupons;
  const d = c.data;
  if (!s) return null;
  const applied = d.coupon;
  return (
    <div className="grid gap-1.5 rounded-[10px] border border-line bg-bg px-2.5 py-2">
      <div className="flex items-center justify-between gap-2 text-[13px] font-bold">
        <span>🏷️ Coupons</span>
        {s.loading && <span className="text-xs font-normal text-muted">checking…</span>}
      </div>
      {applied && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-accent-soft px-2 py-1.5 text-[13px]">
          <span>
            <b className="text-accent">{applied}</b> applied · you save <b>{rs(d.couponDiscount)}</b>
          </span>
          {d.restaurantId && (
            <LinkButton disabled={c.busy} onClick={c.removeCoupon}>
              Remove
            </LinkButton>
          )}
        </div>
      )}
      {s.error ? (
        <div className="text-xs text-muted">Couldn't load coupons: {s.error}</div>
      ) : s.reason === "notFromApp" ? (
        <div className="text-xs text-muted">This cart was made in the Swiggy app, so see its coupons there.</div>
      ) : s.coupons?.length ? (
        <div className="grid max-h-[220px] gap-1 overflow-y-auto">
          {s.coupons.map((k, n) => {
            const on = applied && k.code && applied.toUpperCase() === k.code.toUpperCase();
            return (
              <div key={`${k.code ?? k.title}:${n}`} className={cx("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-1 text-[13px]", !k.applicable && !on && "opacity-60")}>
                <div className="min-w-0">
                  <div className="font-semibold">
                    {k.code && <span className="mr-1.5 rounded border border-dashed border-swiggy px-1 text-xs text-swiggy">{k.code}</span>}
                    {k.code ? (k.title !== k.code ? k.title : "") : k.title}
                  </div>
                  {k.description && <div className={cx("text-xs", k.applicable ? "text-accent" : "text-muted")}>{k.description}</div>}
                </div>
                {on ? (
                  <span className="text-xs font-semibold text-accent">Applied</span>
                ) : k.code && k.applicable ? (
                  <Button variant="swiggyOutline" size="xs" disabled={c.busy || s.loading} onClick={() => c.applyCoupon(k.code)}>
                    {k.discount ? `Apply · −${rs(k.discount)}` : "Apply"}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        !s.loading && !applied && <div className="text-xs text-muted">No Pay-on-delivery coupons for this cart right now.</div>
      )}
    </div>
  );
}

function Row({ label, children, strong }) {
  return (
    <div className={cx("flex justify-between gap-2", strong && "text-base font-extrabold text-ink")}>
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Bill({ p, coupon, code }) {
  return (
    <div className="grid gap-0.5 border-t border-dashed border-line pt-2 text-[13px] text-muted">
      <Row label="Item total">{rs(p.itemTotal)}</Row>
      <Row label="Delivery">
        {p.delivery ? (
          rs(p.delivery)
        ) : (
          <>
            FREE {p.deliveryStrike ? <s>{rs(p.deliveryStrike)}</s> : null}
          </>
        )}
      </Row>
      <Row label="Taxes & charges">₹{p.taxes}</Row>
      {coupon ? <Row label={`Coupon${code ? ` (${code})` : ""}`}>− {rs(coupon)}</Row> : null}
      <Row label="To pay" strong>
        {rs(p.toPay)}
      </Row>
    </div>
  );
}

function FilledCart() {
  const c = useCart();
  const d = c.data;
  const p = d.pricing;
  const count = d.items.reduce((n, i) => n + i.quantity, 0);
  const editable = !!d.restaurantId;
  const place = d.deliverTo?.replace(/^.*? to /, "");

  return (
    <>
      <Title count={count} />
      {c.replaceWith && <ReplacePrompt />}
      {d.items.map((i) => (
        <CartItem key={i.menuItemId} i={i} editable={editable} />
      ))}
      {editable ? (
        <>
          <Button variant="dashed" size="sm" disabled={c.busy} onClick={c.toggleMenu}>
            {c.menuOpen ? "Hide menu" : `+ Add more from ${d.restaurantName ?? "this restaurant"}`}
          </Button>
          {c.menuOpen && <MenuList />}
        </>
      ) : (
        <div className="text-xs text-muted">This cart was set up in the Swiggy app, so change its items there, or empty it to start one here.</div>
      )}
      <Coupons />
      {p && <Bill p={p} coupon={d.couponDiscount} code={d.coupon} />}
      {d.deliverTo && <div className="text-xs text-muted">🛵 {d.deliverTo}</div>}
      <input
        className="w-full rounded-lg border border-line bg-bg px-2.5 py-2 text-[13px] outline-none focus:border-accent"
        maxLength={200}
        placeholder="Note to restaurant (optional), e.g. less spicy"
        value={c.note}
        disabled={c.busy}
        onChange={(e) => c.setNote(e.target.value)}
      />
      <div className="text-[13px]">
        💵 <b>Pay on delivery</b> <span className="text-muted">(or pay in the Swiggy app before it arrives)</span>
      </div>
      {c.error && <div className={errBox}>{c.error}</div>}
      {!p ? (
        <div className="text-[13px] text-muted">Swiggy didn't return a bill for this cart.</div>
      ) : c.confirming ? (
        <div className={warnBox}>
          Place a <b>real Swiggy order</b> for{" "}
          <b>
            {count} item{count === 1 ? "" : "s"}
          </b>
          , <b>{rs(p.toPay)}</b>, Pay on delivery
          {place ? (
            <>
              , delivered to <b>{place}</b>
            </>
          ) : null}
          ?
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="primary" className="flex-1" disabled={c.busy} onClick={c.place}>
              {c.busy ? "Placing…" : "Yes, place order"}
            </Button>
            <Button className="flex-1" disabled={c.busy} onClick={c.cancelConfirm}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        !c.replaceWith && (
          <Button variant="primary" disabled={c.busy} onClick={c.startConfirm}>
            Place order · {rs(p.toPay)}
          </Button>
        )
      )}
      <LinkButton disabled={c.busy} onClick={c.clear}>
        Empty cart
      </LinkButton>
      {c.busy && !c.confirming && <Status>Updating your Swiggy cart…</Status>}
    </>
  );
}

export function CartPanel() {
  const c = useCart();
  return (
    <section ref={c.panelRef} className="grid gap-2.5 rounded-[14px] border-2 border-swiggy bg-panel px-4 py-3.5 shadow-card">
      {c.result ? (
        <OrderResult />
      ) : c.data?.items?.length ? (
        <FilledCart />
      ) : (
        <>
          <Title />
          {c.busy ? (
            <Status>Talking to Swiggy…</Status>
          ) : c.error ? (
            <div className={errBox}>{c.error}</div>
          ) : (
            <div className="text-[13px] text-muted">
              Your cart is empty. Search a dish, then tap <b>Order on Swiggy</b> on any live Swiggy result.
            </div>
          )}
        </>
      )}
    </section>
  );
}
