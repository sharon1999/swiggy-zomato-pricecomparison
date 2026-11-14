# Food Deals

Stop scrolling Swiggy and Zomato. Search a dish or just ask, for example "lowest price burgers today" or "which shop has the highest offer today?", and the app checks both platforms, works out what you'll **actually pay** after offers and fees, and picks for you.

## Run it

```bash
npm install
cp .env.example .env      # then paste your ANTHROPIC_API_KEY
npm run build             # build the React UI into dist/
npm start                 # http://localhost:3000
```

While working on the UI, run `npm run dev` instead and open http://localhost:5173. It starts the API on :3000 and the Vite dev server with hot reload, and sends you back to :5173 after signing in to Swiggy or Zomato.

## What it does

| Feature | How |
|---|---|
| **Cheapest** tab | Every matching dish ranked by final price: item price, minus the offer, plus delivery, packaging and platform fees. Buy-1-Get-1 is ranked per item. |
| **Swiggy vs Zomato** tab | The same dish at the same restaurant, side by side, showing which app is cheaper and by how much. |
| **Top offers today** tab | Restaurants ranked by the real savings % of today's offer. |
| **Ask the deal finder** | Claude (Opus 5.5) calls the search, compare and offers tools, then gives you at most 3 picks and why #1 wins. |
| Filters | Veg/non-veg, max price, minimum rating, delivery time. |

## Real data: connecting Swiggy and Zomato

Click **Connect** at the top. You sign in on the platform's own page (official OAuth through their MCP servers). This app never sees your password, and the token stays in `data/tokens.json` on your machine.

- **Swiggy Food** (`mcp.swiggy.com/food`): **works.** Sign in with your phone number and OTP, then choose a delivery address under the search bar. Live search uses Swiggy's `search_menu` (no AI key needed) and returns real dish prices, ratings, delivery time and distance. Swiggy only shows offers, coupons and delivery fees once a cart exists, so live cards show the item price plus "fees & offers at checkout". The app never fills your real cart just to check.
- **Zomato** (`mcp-server.zomato.com/mcp`): **works.** Click Connect, agree on Zomato's permission page and sign in. Live search uses `get_restaurants_for_keyword`, which returns each restaurant's matching dishes **and its current offer** ("Flat ₹75 OFF", "60% OFF up to ₹120"). Zomato doesn't say the offer's minimum order, so the app shows "≈₹X if eligible" and never bakes the offer into the price. Zomato marks this connection as "for testing purposes".

**Pick the same place for both.** Each platform has its own address picker under the search bar. Zomato defaults to the address in the same city as Swiggy, and the app warns you if the two cities differ. The compare tab only matches the exact same dish at the same restaurant, never a burger against its combo or a bigger size.

When a platform isn't connected, the app uses **demo data** (marked "demo"). The demo offers change every day.

## Ordering safety

When you're connected, the AI can use the platform's own cart and order tools. Any action that **places, pays for, books or cancels** an order is never run automatically: the chat shows a **Confirm / Cancel** card first. Swiggy currently supports cash on delivery only, and Zomato uses a payment QR that you pay yourself.

## Project layout

```
server.js            Express routes, OAuth callback, streaming chat
engine/pricing.js    final price after offers + fees
engine/matcher.js    same dish across platforms
engine/catalog.js    search / compare / top offers (live or demo)
providers/demo.js    daily demo data
providers/mcp.js     Swiggy / Zomato MCP connection + OAuth
providers/swiggyOrder.js  Swiggy cart, menu and Pay-on-delivery ordering
ai/dealFinder.js     Claude tool loop with order confirmation
ai/normalize.js      turns live results into the common format
web/                 React + Tailwind UI (Vite); `npm run build` → dist/
  src/cart.js        Swiggy cart state and actions (React hook)
  src/components/    Header, SearchPanel, Cards, CartPanel, Chat, …
public/              old plain-JS page, served only if dist/ isn't built
test/                npm test
```
