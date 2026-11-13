// Demo provider: realistic sample restaurants, dishes and offers for both
// platforms. Offers are re-rolled every day (seeded by date) so "today's
// deals" actually changes, the way it does on the real apps.

const RESTAURANTS = [
  { id: "r1", name: "Burger Barn", cuisine: ["Burgers", "American"], area: "Indiranagar", rating: 4.3 },
  { id: "r2", name: "Bun & Patty Co.", cuisine: ["Burgers", "Fast Food"], area: "Koramangala", rating: 4.1 },
  { id: "r3", name: "Smash Street", cuisine: ["Burgers", "Shakes"], area: "HSR Layout", rating: 4.5 },
  { id: "r4", name: "Biryani Bhavan", cuisine: ["Biryani", "Hyderabadi"], area: "BTM Layout", rating: 4.2 },
  { id: "r5", name: "Dum Pukht House", cuisine: ["Biryani", "Mughlai"], area: "Jayanagar", rating: 4.4 },
  { id: "r6", name: "Slice Republic", cuisine: ["Pizza", "Italian"], area: "Indiranagar", rating: 4.0 },
  { id: "r7", name: "Wood Fire Works", cuisine: ["Pizza", "Pasta"], area: "Whitefield", rating: 4.6 },
  { id: "r8", name: "Dosa Junction", cuisine: ["South Indian"], area: "Malleshwaram", rating: 4.5 },
  { id: "r9", name: "Wok This Way", cuisine: ["Chinese", "Asian"], area: "Koramangala", rating: 3.9 },
  { id: "r10", name: "Roll Call", cuisine: ["Rolls", "North Indian"], area: "HSR Layout", rating: 4.2 },
  { id: "r11", name: "Punjab Da Dhaba", cuisine: ["North Indian", "Thali"], area: "Marathahalli", rating: 4.1 },
  { id: "r12", name: "Sweet Tooth", cuisine: ["Desserts", "Shakes"], area: "Jayanagar", rating: 4.4 },
];

// [restaurantId, dish, basePrice, veg, category]
const MENU = [
  ["r1", "Classic Veg Burger", 129, true, "burger"],
  ["r1", "Crispy Chicken Burger", 189, false, "burger"],
  ["r1", "Double Cheese Burger", 229, true, "burger"],
  ["r1", "Peri Peri Fries", 99, true, "sides"],
  ["r2", "Aloo Tikki Burger", 89, true, "burger"],
  ["r2", "Chicken Zinger Burger", 169, false, "burger"],
  ["r2", "Paneer Makhani Burger", 159, true, "burger"],
  ["r2", "Burger + Fries + Coke Combo", 249, false, "burger"],
  ["r3", "Smashed Double Patty Burger", 299, false, "burger"],
  ["r3", "Truffle Mushroom Burger", 279, true, "burger"],
  ["r3", "Oreo Thick Shake", 179, true, "dessert"],
  ["r4", "Chicken Dum Biryani", 249, false, "biryani"],
  ["r4", "Veg Biryani", 189, true, "biryani"],
  ["r4", "Mutton Biryani", 349, false, "biryani"],
  ["r5", "Lucknowi Chicken Biryani", 299, false, "biryani"],
  ["r5", "Paneer Tikka Biryani", 249, true, "biryani"],
  ["r5", "Egg Biryani", 199, false, "biryani"],
  ["r6", "Margherita Pizza (Medium)", 249, true, "pizza"],
  ["r6", "Pepperoni Pizza (Medium)", 349, false, "pizza"],
  ["r6", "Farmhouse Pizza (Medium)", 299, true, "pizza"],
  ["r7", "Neapolitan Margherita", 399, true, "pizza"],
  ["r7", "Spicy Chicken Pizza", 449, false, "pizza"],
  ["r7", "Penne Arrabbiata", 289, true, "pasta"],
  ["r8", "Masala Dosa", 89, true, "south indian"],
  ["r8", "Ghee Roast Dosa", 119, true, "south indian"],
  ["r8", "Idli Vada Combo", 79, true, "south indian"],
  ["r9", "Chicken Hakka Noodles", 199, false, "chinese"],
  ["r9", "Veg Fried Rice", 169, true, "chinese"],
  ["r9", "Chilli Paneer Dry", 219, true, "chinese"],
  ["r10", "Chicken Tikka Roll", 149, false, "rolls"],
  ["r10", "Paneer Kathi Roll", 129, true, "rolls"],
  ["r10", "Egg Roll", 99, false, "rolls"],
  ["r11", "Veg Thali", 199, true, "thali"],
  ["r11", "Butter Chicken + 2 Naan", 299, false, "north indian"],
  ["r11", "Dal Makhani + Jeera Rice", 219, true, "north indian"],
  ["r12", "Chocolate Brownie Sundae", 159, true, "dessert"],
  ["r12", "Gulab Jamun (2 pc)", 69, true, "dessert"],
  ["r12", "Mango Cheesecake", 189, true, "dessert"],
];

// Small deterministic PRNG so the same day gives the same offers.
function seeded(seedStr) {
  let h = 2166136261;
  for (const ch of seedStr) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

const OFFER_TEMPLATES = {
  swiggy: [
    () => ({ type: "percent", pct: 60, max: 120, minOrder: 159, code: "TRYNEW", label: "60% OFF up to ₹120" }),
    () => ({ type: "percent", pct: 50, max: 100, minOrder: 149, code: "SWIGGYIT", label: "50% OFF up to ₹100" }),
    () => ({ type: "flat", amount: 75, minOrder: 199, code: "FLAT75", label: "Flat ₹75 OFF above ₹199" }),
    () => ({ type: "flat", amount: 125, minOrder: 349, code: "FEAST", label: "Flat ₹125 OFF above ₹349" }),
    () => ({ type: "percent", pct: 20, max: 50, minOrder: 0, code: null, label: "20% OFF up to ₹50" }),
    () => ({ type: "freeDelivery", minOrder: 0, code: null, label: "Free delivery (One)" }),
    () => ({ type: "bogo", minOrder: 0, code: null, label: "Buy 1 Get 1 Free" }),
    () => null,
  ],
  zomato: [
    () => ({ type: "percent", pct: 50, max: 100, minOrder: 159, code: "ZOMATO", label: "50% OFF up to ₹100" }),
    () => ({ type: "percent", pct: 40, max: 80, minOrder: 129, code: "GOURMET", label: "40% OFF up to ₹80" }),
    () => ({ type: "flat", amount: 100, minOrder: 299, code: "TREAT", label: "Flat ₹100 OFF above ₹299" }),
    () => ({ type: "flat", amount: 50, minOrder: 149, code: "SAVE50", label: "Flat ₹50 OFF above ₹149" }),
    () => ({ type: "percent", pct: 15, max: 40, minOrder: 0, code: null, label: "15% OFF up to ₹40" }),
    () => ({ type: "freeDelivery", minOrder: 0, code: null, label: "Free delivery (Gold)" }),
    () => ({ type: "bogo", minOrder: 0, code: null, label: "Buy 1 Get 1 Free" }),
    () => null,
  ],
};

const FEES = {
  swiggy: { platformFee: 10, packaging: [10, 25], delivery: [25, 55] },
  zomato: { platformFee: 12, packaging: [10, 30], delivery: [20, 60] },
};

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** All demo listings for one platform, for the given day. */
export function demoListings(platform, date = new Date()) {
  const day = todayKey(date);
  const fees = FEES[platform];
  const byId = Object.fromEntries(RESTAURANTS.map((r) => [r.id, r]));

  // One restaurant-level offer per restaurant per day.
  const restOffer = {};
  const restFees = {};
  for (const r of RESTAURANTS) {
    const rnd = seeded(`${day}:${platform}:${r.id}`);
    restOffer[r.id] = pick(rnd, OFFER_TEMPLATES[platform])();
    restFees[r.id] = {
      delivery: Math.round(fees.delivery[0] + rnd() * (fees.delivery[1] - fees.delivery[0])),
      packaging: Math.round(fees.packaging[0] + rnd() * (fees.packaging[1] - fees.packaging[0])),
      eta: Math.round(20 + rnd() * 30),
      ratingDelta: Math.round((rnd() - 0.5) * 4) / 10,
    };
  }

  return MENU.map(([rid, dish, base, veg, category], i) => {
    const r = byId[rid];
    const rnd = seeded(`${day}:${platform}:${rid}:${i}`);
    // Menu prices differ slightly between platforms (they often do in reality).
    const markup = platform === "zomato" ? 1 + (rnd() * 0.12 - 0.03) : 1 + (rnd() * 0.1 - 0.02);
    const price = Math.round((base * markup) / 5) * 5 - 1;
    // Occasionally a dish-level discount (strike-through price).
    const itemDisc = rnd() < 0.18 ? Math.round(price * (0.1 + rnd() * 0.2)) : 0;
    const f = restFees[rid];
    return {
      id: `${platform}-${rid}-${i}`,
      platform,
      source: "demo",
      restaurant: r.name,
      restaurantId: rid,
      area: r.area,
      cuisine: r.cuisine,
      dish,
      category,
      veg,
      price: price - itemDisc,
      originalPrice: itemDisc ? price : null,
      offer: restOffer[rid],
      deliveryFee: f.delivery,
      packagingFee: f.packaging,
      platformFee: fees.platformFee,
      rating: Math.min(5, Math.max(3.2, +(r.rating + f.ratingDelta).toFixed(1))),
      etaMins: f.eta,
    };
  });
}

export const demoProvider = (platform) => ({
  platform,
  mode: "demo",
  async search(query) {
    const all = demoListings(platform);
    if (!query) return all;
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (hay) => terms.every((t) => hay.includes(t) || hay.includes(t.replace(/s$/, "")));
    // Match the dish itself first ("burger" -> burgers, not fries at Burger Barn).
    const byDish = all.filter((l) => matches(`${l.dish} ${l.category}`.toLowerCase()));
    if (byDish.length) return byDish;
    // Otherwise the user probably typed a restaurant or cuisine name.
    return all.filter((l) => matches(`${l.restaurant} ${l.cuisine.join(" ")}`.toLowerCase()));
  },
});
