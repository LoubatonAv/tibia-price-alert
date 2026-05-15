# Tibia Price Alert — Order Manager + Ladder Advisor + Snipe Patch

This patch is designed to be safe and incremental. It does not replace your state/positions data. Do not overwrite your real `.env`, `state.json`, `positions.json`, or `inventory.json` unless you intentionally want to.

## What changed

### 1. Buy Ladder Advisor v2
`trade-manager.bat` now lets you enter visible buy offers one by one:

```text
BUY offer price: 50011
Amount at this price: 69
BUY offer price: 50010
Amount at this price: 33
BUY offer price: [Enter to finish]
```

This becomes:

```text
50011:69,50010:33
```

`inventory.js` now understands this manual live ladder and uses it as the execution source before delayed snapshots.

### 2. Order Manager
`trade.js` now supports:

```powershell
node trade.js orders
node trade.js cancel "gold token" "reason optional"
node trade.js expire "gold token"
```

Cancel/expire does not count as a closed trade. It marks the order lifecycle and records the lost buy-offer fee.

### 3. Optional target sell on buy order
You can now do:

```powershell
node trade.js buy "silver token" 50010 10
```

If target sell is empty, the bot calculates a default 6% target after tax.

### 4. Personal trade learning
`lib/marketMemory.js` now has `updateMarketMemoryFromTrades(state)`. Scanner applies your real trade history into market memory.

This means that after you have enough real trades, the bot can show personal confidence like:

```text
Personal confidence HIGH: 7/9 wins, avg ROI 4.2%.
```

### 5. Snipe Watch
Scanner now has a simple Snipe Watch layer for expensive discounted listings.

Default settings:

```env
SNIPE_MIN_SELL_PRICE=1000000
SNIPE_MIN_DISCOUNT_PERCENT=20
SNIPE_TOP_LIMIT=5
```

It is manual-check only. It does not create automatic BUY alerts.

### 6. Safer market intelligence
`item_history` and `item_activity` enrichment are throttled and catch 429 rate limits.

Recommended `.env`:

```env
MARKET_INTELLIGENCE_TOP_LIMIT=2
MARKET_INTELLIGENCE_DELAY_MS=2500
EVENTS_REFRESH_DAYS=21
```

## Test commands

```powershell
node --check .\inventory.js
node --check .\trade.js
node --check .\scanner.js
node --check .\lib\market.js
node --check .\lib\marketIntelligence.js
node --check .\lib\marketMemory.js
npm run scanner
```

## Suggested workflow

```text
Scanner finds idea
↓
Buy Price Check with live ladder
↓
Add Buy Order
↓
Use Orders screen to monitor it
↓
Receive Items if filled
↓
Sell Check
↓
List / instant sell / NPC
↓
Sold Items
↓
Stats + market memory learns over time
```

## Important

Do not chase +1gp wars blindly. The ladder advisor is meant to tell you if the queue is actually scary, not just whether you can become first.
