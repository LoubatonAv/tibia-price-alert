# Direct instructions — Tibia Trade Manager fixed build

## What changed

### Money accuracy improvements

- Scanner now shows a simpler action plan:
  - **Action**: BUY OFFER OK / BUY ONLY CHEAP / DO NOT CHASE / WAIT
  - **Buy range**
  - **Hard max buy** — do not bid above this
  - **Suggested quantity** — avoids buying too many slow-moving items
  - **Expected sell**
  - **Style** — FAST FLIP / PATIENT FLIP / WATCH FIRST / DISCOUNT ONLY
- Added `lib/edge.js`:
  - calculates practical money edge
  - limits quantity by liquidity
  - warns when the current buy offer is too expensive
- Snipe mode is now more conservative:
  - it compares against the safer of daily/monthly average sell prices
  - this reduces false “cheap” alerts when the price is actually falling

### Trade tracking fixes

- Fixed `node trade.js add ...` crash.
- Fixed manual listing flow so buy-offer fee is saved when you say you paid it.
- Fixed relist event so previous list price is recorded correctly.
- Fixed multi-word item names for commands like:
  - `node trade.js sold stone skin amulet 10 9500`
  - `node trade.js receive stone skin amulet 10`
  - `node trade.js buy stone skin amulet 8199 10`
- Added a guard so `receive` cannot receive more items than were ordered.
- Improved `sold/close` errors so selling too much gives a clean message instead of a crash.
- `state.json` and `positions.json` are now saved more safely using temp file + rename.

### New manual check command

Use this before buying if you want a quick answer:

```powershell
node trade.js check stone skin amulet 8199 9500 10
```

It tells you:

- total fees
- real net profit
- ROI after fees
- direct read: buy / thin / avoid

## How to use — direct flow

### 1. Run scanner

```powershell
npm run scanner
```

Read the scanner like this:

- **BUY OFFER OK** = can place a buy offer, but stay under Hard max buy.
- **BUY ONLY CHEAP** = only buy if you can get a discount. Do not fight other buyers.
- **DO NOT CHASE** = item may be good, but current entry is too expensive.
- **WAIT** = not clean enough.

Most important lines:

1. **Hard max buy** — never bid above it.
2. **Suggested quantity** — do not buy more than this.
3. **Expected sell** — realistic sell area, not greedy fantasy price.
4. **Style** — tells you whether to flip fast or be patient.

### 2. Before buying, optional quick check

```powershell
node trade.js check ITEM_NAME BUY_PRICE SELL_PRICE QUANTITY
```

Example:

```powershell
node trade.js check stone skin amulet 8199 9500 10
```

### 3. Record a buy offer

```powershell
node trade.js buy stone skin amulet 8199 10
```

You can still use quotes if you want:

```powershell
node trade.js buy "stone skin amulet" 8199 10
```

### 4. When items arrive

```powershell
node trade.js receive stone skin amulet 10
```

If you got them at a different real price:

```powershell
node trade.js receive stone skin amulet 10 8150
```

### 5. When you list them

```powershell
node trade.js list stone skin amulet 10 9500
```

If the bot asks whether you paid a buy-offer fee, answer correctly. It now saves that fee.

### 6. When they sell

```powershell
node trade.js sold stone skin amulet 10 9500
```

### 7. See open positions

```powershell
node trade.js orders
```

### 8. See profit stats

```powershell
node trade.js stats
```

## Simple rules to follow

- Do not buy above **Hard max buy**.
- Do not buy more than **Suggested quantity**.
- If it says **DO NOT CHASE**, wait.
- If it says **BUY ONLY CHEAP**, place a lower offer, not the top offer.
- For FAST FLIP, sell quickly and do not get greedy.
- For PATIENT FLIP, use smaller quantity and expect slower selling.

## Important security note

The fixed ZIP does not include your `.env` file. Copy `.env.example` to `.env` and put your webhook URLs back in locally.
