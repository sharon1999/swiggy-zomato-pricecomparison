// Turns every kind of offer into one comparable number: what you actually pay.

const round = (n) => Math.round(n);

/**
 * Work out the real cost of ordering `qty` of a listing.
 * Returns the bill breakdown plus savings vs. the menu price with no offer.
 */
export function finalPrice(listing, qty = 1) {
  const itemTotal = listing.price * qty;
  const offer = listing.offer;
  let discount = 0;
  let deliveryFee = listing.deliveryFee ?? 0;
  let offerApplied = null;
  let offerNote = null;

  if (offer?.estimated) {
    // Offer shown on the restaurant but its minimum order isn't known:
    // don't bake it into the price, show what it would be if eligible.
    let est = 0;
    if (offer.type === "percent") est = Math.min((itemTotal * offer.pct) / 100, offer.max ?? Infinity);
    else if (offer.type === "flat") est = Math.min(offer.amount, itemTotal);
    else if (offer.type === "bogo") est = listing.price; // a free second item
    const fees = deliveryFee + (listing.packagingFee ?? 0) + (listing.platformFee ?? 0);
    const total = round(itemTotal + fees);
    const estTotal = round(Math.max(0, itemTotal - (offer.type === "bogo" ? 0 : est)) + fees);
    const pct = itemTotal > 0 ? round((est / (itemTotal + (offer.type === "bogo" ? listing.price : 0))) * 100) : 0;
    return {
      itemTotal: round(itemTotal),
      discount: 0,
      fees: round(fees),
      total,
      perUnit: total,
      units: qty,
      savings: 0,
      savingsPct: 0,
      valueSavingsPct: pct,
      estTotal,
      estSavings: round(est),
      offerApplied: null,
      offerNote:
        offer.type === "other"
          ? offer.label
          : `${offer.label} · ≈₹${estTotal}${offer.type === "bogo" ? " for 2" : ""} if eligible`,
    };
  }

  if (offer) {
    const meetsMin = itemTotal >= (offer.minOrder ?? 0);
    if (!meetsMin) {
      offerNote = `Add ₹${offer.minOrder - itemTotal} more to unlock "${offer.label}"`;
    } else if (offer.type === "percent") {
      discount = Math.min((itemTotal * offer.pct) / 100, offer.max ?? Infinity);
      offerApplied = offer.label;
    } else if (offer.type === "flat") {
      discount = Math.min(offer.amount, itemTotal);
      offerApplied = offer.label;
    } else if (offer.type === "bogo") {
      // You pay for one, get two: per-unit cost halves. Treat as qty 2 for 1.
      offerApplied = `${offer.label} (2 for the price of 1)`;
    } else if (offer.type === "freeDelivery") {
      discount = deliveryFee;
      offerApplied = offer.label;
    }
  }

  const fees = deliveryFee + (listing.packagingFee ?? 0) + (listing.platformFee ?? 0);
  const total = round(itemTotal - discount + fees);
  const strikeSavings = listing.originalPrice ? (listing.originalPrice - listing.price) * qty : 0;
  const totalSavings = round(discount + strikeSavings);
  const before = total + totalSavings;
  const units = offer?.type === "bogo" && offerApplied ? qty * 2 : qty;

  return {
    itemTotal: round(itemTotal),
    discount: round(discount),
    fees: round(fees),
    total,
    perUnit: round(total / units),
    units,
    savings: totalSavings,
    savingsPct: before > 0 ? round((totalSavings / before) * 100) : 0,
    // BOGO doubles what you get; count the free item's value as savings too.
    valueSavingsPct:
      offer?.type === "bogo" && offerApplied
        ? round(((listing.price * qty) / (before + listing.price * qty)) * 100)
        : before > 0
          ? round((totalSavings / before) * 100)
          : 0,
    offerApplied,
    offerNote,
  };
}

/** Attach pricing to each listing. */
export function priceAll(listings) {
  return listings.map((l) => ({ ...l, pricing: finalPrice(l) }));
}
