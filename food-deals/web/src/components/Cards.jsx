import { rs } from "../api.js";
import { useCart } from "../cart.js";
import { Button, Meta, Plat, SourceTag, VegDot, card, cx } from "./ui.jsx";

function Badge({ children }) {
  return (
    <span className="absolute -top-2.5 left-3 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">{children}</span>
  );
}

function Offer({ text, locked }) {
  return (
    <span
      className={cx(
        "self-start rounded-lg px-2 py-1 text-xs font-semibold",
        locked ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent",
      )}
    >
      {text}
    </span>
  );
}

const canOrder = (i) => i.platform === "swiggy" && i.source === "live" && i.restaurantId && i.menuItemId;

export function ItemCard({ i, best = false, mini = false }) {
  const cart = useCart();
  const p = i.pricing;
  const live = i.feesKnown === false;
  const plat = i.platform === "zomato" ? "Zomato" : "Swiggy";
  const offer = p.offerApplied
    ? { text: `${p.offerApplied}${i.offer?.code ? ` · ${i.offer.code}` : ""}` }
    : i.offer?.estimated
      ? { text: p.offerNote }
      : p.offerNote
        ? { text: p.offerNote, locked: true }
        : null;

  return (
    <div className={cx(card, best && "border-accent", mini && "gap-1 p-2.5")}>
      {best && <Badge>Best pick</Badge>}
      {i.imageUrl && !mini && (
        <img className="h-[110px] w-full rounded-[10px] bg-bg object-cover" src={i.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-start gap-1.5 text-[15px] font-bold">
          <VegDot veg={i.veg} />
          {i.dish}
        </div>
        <Plat p={i.platform} />
      </div>
      <div className="text-[13px] text-muted">
        {i.restaurant}
        {i.area ? ` · ${i.area}` : ""}
      </div>
      <div>
        <span className={cx("font-extrabold tracking-tight", mini ? "text-[17px]" : "text-[22px]")}>{rs(p.total)}</span>
        <small className="ml-1 text-xs text-muted">
          {p.units > 1 ? `${rs(p.perUnit)}/item · ${p.units} items` : live ? "item price" : "final price"}
        </small>
        {i.originalPrice ? <span className="ml-1.5 text-[13px] text-muted line-through">{rs(i.originalPrice)}</span> : null}
      </div>
      {offer && <Offer {...offer} />}
      {!mini && (
        <div className="text-xs text-muted">
          {live
            ? `${i.offer?.estimated ? "Min. order for the offer & delivery fee" : "Delivery fee & offers"} shown at ${plat} checkout${i.bestseller ? " · Bestseller" : ""}`
            : `Item ${rs(p.itemTotal)}${p.discount ? ` − offer ${rs(p.discount)}` : ""} + fees ${rs(p.fees)}${p.savings ? ` · you save ${rs(p.savings)}` : ""}`}
        </div>
      )}
      <Meta>
        <span>★ {i.rating ?? "–"}</span>
        <span>{i.etaMins ? `${i.etaMins} min` : ""}</span>
        <SourceTag source={i.source} />
      </Meta>
      {!mini && cart.enabled && canOrder(i) && (
        <Button
          variant="swiggy"
          size="sm"
          disabled={cart.busy}
          onClick={() => cart.add({ restaurantId: i.restaurantId, restaurantName: i.restaurant, menuItemId: i.menuItemId, dish: i.dish })}
        >
          Order on Swiggy
        </Button>
      )}
    </div>
  );
}

function Side({ i, win }) {
  if (!i) {
    return (
      <div className="border-l border-line px-3.5 py-3 max-sm:[&:nth-child(2)]:border-l-0">
        <span className="text-[13px] text-muted">Not listed</span>
      </div>
    );
  }
  const p = i.pricing;
  return (
    <div className={cx("border-l border-line px-3.5 py-3 max-sm:[&:nth-child(2)]:border-l-0", win && "bg-accent-soft")}>
      <div className="flex items-center justify-between gap-2">
        <Plat p={i.platform} />
        {win && <span className="text-[13px] font-bold text-accent">Cheaper</span>}
      </div>
      <div className="text-[22px] font-extrabold tracking-tight">{rs(p.total)}</div>
      <div className="text-xs text-muted">
        {p.offerApplied ?? p.offerNote ?? (i.feesKnown === false ? "Offers at checkout" : "No offer")}
      </div>
      <Meta>
        <span>★ {i.rating ?? "–"}</span>
        <span>{i.etaMins ?? ""} min</span>
      </Meta>
    </div>
  );
}

export function CompareCard({ row }) {
  const s = row.byPlatform.swiggy;
  const z = row.byPlatform.zomato;
  return (
    <div className={cx(card, "col-span-full grid grid-cols-[1.2fr_1fr_1fr] items-stretch gap-0 overflow-hidden p-0 max-sm:grid-cols-2")}>
      <div className="px-3.5 py-3 max-sm:col-span-2 max-sm:border-b max-sm:border-line">
        <div className="flex items-start gap-1.5 text-[15px] font-bold">
          <VegDot veg={row.veg} />
          {row.dish}
        </div>
        <div className="text-[13px] text-muted">{row.restaurant}</div>
        <div className="mt-1.5 text-[13px]">
          {!s || !z ? (
            <span className="text-muted">Only on {s ? "Swiggy" : "Zomato"}</span>
          ) : row.youSave > 0 ? (
            <span className="font-bold text-accent">
              Save {rs(row.youSave)} on {row.cheapestPlatform}
            </span>
          ) : (
            <span className="text-muted">Same price{z?.offer ? ", but Zomato has an offer" : ""}</span>
          )}
        </div>
      </div>
      <Side i={s} win={s && row.cheapestPlatform === "swiggy" && row.youSave > 0} />
      <Side i={z} win={z && row.cheapestPlatform === "zomato" && row.youSave > 0} />
    </div>
  );
}

export function OfferCard({ o, first = false }) {
  const d = o.bestDish;
  const est = d.pricing.estTotal != null;
  return (
    <div className={cx(card, first && "border-accent")}>
      {first && <Badge>Biggest offer</Badge>}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[15px] font-bold">{o.restaurant}</div>
        <Plat p={o.platform} />
      </div>
      <Offer text={`${o.offer.label}${o.offer.code ? ` · ${o.offer.code}` : ""}`} />
      <div className="text-[13px] text-muted">Best value: {d.dish}</div>
      <div>
        <span className="text-[22px] font-extrabold tracking-tight">
          {est ? "≈" : ""}
          {rs(d.pricing.estTotal ?? d.pricing.total)}
        </span>
        <small className="ml-1 text-xs text-muted">
          {d.pricing.valueSavingsPct}% off{est ? ` · was ${rs(d.pricing.total)}, if eligible` : ""}
        </small>
      </div>
      <Meta>
        <span>★ {o.rating ?? "–"}</span>
        <span>{d.etaMins ?? ""} min</span>
        {d.source === "demo" && <SourceTag source="demo" />}
      </Meta>
    </div>
  );
}
