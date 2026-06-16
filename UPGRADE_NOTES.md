# Tibia Price Alert — Upgrade Notes

## What changed

### 1. Discord accept command fixed
BUY alerts now include a clean copy-paste block:

```powershell
cd "C:\Users\Avner\Desktop\Projects\tibia-price-alert"
npm run accept-buy -- --item-id ...
```

No more literal `powershell\ncd...` text.

### 2. Accept BUY Signal workflow
New script:

```powershell
npm run accept-buy
```

Use it only after you actually place the Buy Offer inside Tibia Market. It creates a `BUY_ORDER_PLACED` position in `positions.json`.

### 3. Pending BUY Signals viewer and cleanup
New script:

```powershell
npm run pending-buy
```

It shows pending BUY signals, copy-paste commands, and automatically marks signals as `ALREADY_TRACKED` when a matching open position exists.

### 4. Action Dashboard
New script:

```powershell
npm run trade -- dashboard
```

Shows open buy orders, items needing listing, stale listings, suspicious positions, and pending BUY signals.

### 5. Verify old buy order still active
New script:

```powershell
npm run trade -- verify-order "gold token"
```

Use it when Dashboard warns that a buy order is near 30 days, but you checked Tibia and the order still exists. Confirming it suppresses the warning for about 24 hours.

### 6. Better BUY levels
Discord BUY alerts now distinguish:

- Clean BUY signal
- BUY CANDIDATE / RESEARCH
- WATCH ONLY / small test only

### 7. ROI N/A for external/loot items
Stats no longer treat zero-entry external/loot items as absurd ROI trades.

### 8. Split stats
New script:

```powershell
npm run trade -- stats-split
```

Separates real flip profit from loot/external profit.

### 9. Discovery promotion and cleanup
New scripts:

```powershell
npm run promote-discovery
npm run clean-discovery
```

Promotion adds stable discovery candidates to `data/tracked-items.json`. Cleanup removes old weak discovery candidates from `state.json`.

### 10. BAT menu updated
New menu options:

- Action Dashboard
- Pending BUY Signals
- Accept BUY Signal
- Verify Old Buy Order Still Active
- Discovery Promotion
- Clean Discovery Candidates

## Recommended first run

```powershell
npm install
node --check check-flips.js
node --check trade.js
npm run trade -- dashboard
npm run pending-buy
```

## Important rule

`accept-buy` does not buy anything in Tibia. It only records a buy offer that you already placed manually in Tibia Market.
