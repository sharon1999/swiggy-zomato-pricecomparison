// Matches "the same dish" across platforms, even when names differ slightly
// ("Chicken Dum Biryani" vs "Chkn Dum Biryani").

const STOP = new Set(["the", "a", "of", "with", "and", "&", "+", "pc", "medium", "regular"]);
const ALIASES = { chkn: "chicken", chk: "chicken", veggie: "veg", vegetable: "veg", burgr: "burger" };

export function tokens(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t))
    .map((t) => ALIASES[t] ?? t);
}

// Words that make it a different item: "Burger" vs "Burger Combo" or "Large".
const VARIANT = new Set([
  "combo", "meal", "meals", "large", "small", "medium", "xl", "jumbo", "double", "triple", "mini", "bucket",
  "family", "party", "half", "full", "pack", "box", "bowl", "platter", "fries", "drink", "coke", "pepsi",
  "2", "3", "4", "5", "6", "two", "three", "serves", "kg",
]);

/** True when two dish names are the same item (not a combo/size variant of it). */
export function sameDish(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  for (const t of A) if (!B.has(t) && VARIANT.has(t)) return false;
  for (const t of B) if (!A.has(t) && VARIANT.has(t)) return false;
  return similarity(a, b) >= 0.6;
}

export function similarity(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter); // Jaccard
}

const restKey = (name) => tokens(name).join(" ");

/**
 * Group priced listings from all platforms into comparison rows.
 * Each row = one dish at one restaurant, with an entry per platform.
 */
export function groupAcrossPlatforms(listings) {
  const groups = [];
  for (const l of listings) {
    const g = groups.find(
      (g) =>
        restKey(g.restaurant) === restKey(l.restaurant) &&
        !g.byPlatform[l.platform] &&
        sameDish(g.dish, l.dish),
    );
    if (g) g.byPlatform[l.platform] = l;
    else groups.push({ restaurant: l.restaurant, dish: l.dish, veg: l.veg, byPlatform: { [l.platform]: l } });
  }

  return groups.map((g) => {
    const entries = Object.values(g.byPlatform);
    entries.sort((x, y) => x.pricing.total - y.pricing.total);
    const best = entries[0];
    const other = entries[1];
    return {
      ...g,
      cheapestPlatform: best.platform,
      cheapestTotal: best.pricing.total,
      youSave: other ? other.pricing.total - best.pricing.total : 0,
      bestRating: Math.max(...entries.map((e) => e.rating ?? 0)),
    };
  });
}
