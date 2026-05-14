# Tibia Price Alert — Market Intelligence Patch

This patch adds a safe enrichment layer for the Scanner and Flipper.

## What changed

### New file
- `lib/marketIntelligence.js`

### Updated files
- `lib/market.js`
- `lib/constants.js`
- `scanner.js`
- `check-flips.js`

## What it adds

The scanner/flipper still use `market_values` as the wide/cheap scan.

After the normal scan, only the top candidates are enriched with:

- `/item_history` — checks recent stability, weakening prices, spread persistence, unstable spread.
- `/item_activity` — checks verified activity/offers on Harmonia.
- `/events` — cached macro market context stored in `state.json`.

It does NOT call `market_board` for every scanner item.

## API safety

Defaults:

```env
MARKET_INTELLIGENCE_TOP_LIMIT=5
ITEM_HISTORY_DAYS=30
EVENTS_REFRESH_DAYS=21
ENABLE_MARKET_INTELLIGENCE=true
ENABLE_ITEM_ACTIVITY=true
ENABLE_ITEM_HISTORY=true
ENABLE_EVENTS_CONTEXT=true
```

This means per scanner/flipper run:

- `market_values` works as before.
- only top 5 candidates get history/activity calls.
- events are refreshed only when stale according to `EVENTS_REFRESH_DAYS`.

## Disable if needed

```env
ENABLE_MARKET_INTELLIGENCE=false
```

Or disable only parts:

```env
ENABLE_ITEM_ACTIVITY=false
ENABLE_ITEM_HISTORY=false
ENABLE_EVENTS_CONTEXT=false
```

## Test commands

```powershell
node --check .\lib\market.js
node --check .\lib\marketIntelligence.js
node --check .\scanner.js
node --check .\check-flips.js

npm run scanner
npm run flips
```

## Important

Do not overwrite:

- `.env`
- `state.json`
- `positions.json`
- `inventory.json`

This ZIP does not include those files.
