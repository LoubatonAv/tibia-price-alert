Tibia Market Realism update
===========================

Replace these files in your tibia-price-alert project:

- inventory.js
- trade.js
- trade-manager.bat
- lib/paths.js  (only if you do not already have it)

What changed:

1. Buy Advisor is now Buy Price Check.
   It answers: "am I buying this item for a fair/cheap/expensive price?"
   It no longer behaves only like a flip calculator.

2. Highest Buy Offer is treated as real instant demand.
   That means: people are currently willing to buy at that price.

3. Listed Sell Offers are treated as useful but less reliable.
   The advisor now warns about stale listings / undercut traps.

4. NPC value is checked from items.json npc_buy.
   If the item can be sold to NPC, the advisor shows NPC value and profit after buy-offer fee.

5. Liquidity and confidence are now more human-readable:
   Demand, Resell speed, Confidence, Item behavior, Undercut risk.

6. Creature products are handled more patiently.
   They can be slow but repeatable because of quests/addons/imbuements/tasks.

7. Tracking suggestion is safer.
   It only asks to track if the item looks repeatable, has enough monthly volume, and is not a high undercut trap.

8. trade.js printPosition was cleaned.
   BUY_ORDER_PLACED now shows Ordered quantity instead of misleading Remaining quantity.

Quick tests:

node inventory.js buy 9631 100 1998
node inventory.js sell 3081 5 9200
node trade.js buy 3081 8150 15 9200
node trade.js receive 3081 5 8150
node trade.js list 3081 5 9200
node trade.js sold 3081 1 9200

Notes:
- This ZIP intentionally does not include positions.json, state.json, tracked-items.json, or items.json to avoid overwriting your runtime data.
- Keep your existing package.json/package-lock.json.
