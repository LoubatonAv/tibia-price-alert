# Tibia Flipper Upgrade Patch

This ZIP is a conservative upgrade patch. It does not rewrite the project flow; it improves the decision layer around the existing scanner/flipper logic.

## What changed

### 1. Normalized volatility
Old volatility compared only the last two history rows and could jump between `0` and huge outlier values. The new version:
- looks across the latest history window
- includes sell price, buy price, and profit-percent movement
- caps per-item spike impact
- weights liquid items slightly more than dead items

New env knobs:
```env
VOLATILITY_HISTORY_WINDOW=6
VOLATILITY_ITEM_SPIKE_CAP=35
VOLATILITY_HIGH_THRESHOLD=12
VOLATILITY_MEDIUM_THRESHOLD=5
```

### 2. BUY signal hierarchy
The flipper now separates:
- `CLEAN_BUY` — strong/medium conviction + passes all filters
- `BUY_CANDIDATE` — low conviction, but strong enough for research
- `WATCH` / `AVOID` — rejected or dangerous setups

Low-conviction candidates are allowed only under conservative requirements:
```env
ENABLE_LOW_CONVICTION_CANDIDATES=true
LOW_CONVICTION_MIN_BRAIN_SCORE=80
LOW_CONVICTION_MIN_TRADEABILITY=55
LOW_CONVICTION_MIN_VOLUME_RATIO=0.8
LOW_CONVICTION_MAX_FAKE_SPREAD_RISK=20
```

### 3. Confidence percentage
BUY alerts now include a confidence percentage based on:
- Brain Score
- tradeability
- volume ratio
- profit percent
- fake spread risk
- market pressure
- conviction level

Low-conviction candidates are capped below clean-buy confidence so they do not look like automatic trades.

### 4. Fill-speed estimate
BUY alerts now show an expected fill speed label:
- VERY FAST
- FAST
- NORMAL
- SLOW
- VERY SLOW
- UNKNOWN

This uses `daySold` and `monthSold` to estimate exit/liquidity quality.

### 5. Rejection summaries
When there are no BUY/SELL signals, Discord can show closest rejected items and the reasons. This prevents the useless “empty” alert problem.

New env knobs:
```env
FLIPS_DEBUG_REJECTIONS=true
EMPTY_SUMMARY_TOP_REJECTIONS=5
SEND_EMPTY_SUMMARY=true
```

### 6. Configurable thresholds
These constants are now env-configurable instead of hardcoded:
```env
MIN_PROFIT=1000
MIN_PROFIT_PERCENT=3
MIN_SIMPLE_BUY_BRAIN_SCORE=70
MIN_SIMPLE_BUY_PROFIT_PERCENT=5
MIN_SIMPLE_BUY_VOLUME_RATIO=0.7
MAX_SIMPLE_BUY_FAKE_SPREAD_RISK=30
```

### 7. Scanner message polish
The scanner Discord header now says `Market heat` and `Normalized volatility`, and includes the run advice message.

### 8. BAT polish
The BAT menu now includes:
- Run Flipper Check
- Run Scanner

So you can test locally without manually typing commands.

## Files included

Replace these in your project:

```txt
check-flips.js
scanner.js
trade-manager.bat
lib/constants.js
lib/scoring.js
lib/state.js
lib/utils.js
lib/discord.js
lib/market.js
lib/pricing.js
lib/profit.js
lib/marketIntelligence.js
package.json
```

The important modified files are:

```txt
check-flips.js
scanner.js
lib/constants.js
trade-manager.bat
```

The other included files are copied for consistency with the version you uploaded.

## Safe test flow

1. Backup your project.
2. Replace the files from this ZIP.
3. Run syntax check:

```bash
node --check check-flips.js
node --check scanner.js
node --check lib/constants.js
```

4. Run locally:

```bash
npm run flips
```

5. Then:

```bash
npm run scanner
```

6. Only after local output looks good, commit and push.

## Suggested starting env

```env
MARKET_INTELLIGENCE_TOP_LIMIT=15
MIN_PROFIT=1000
MIN_SIMPLE_BUY_BRAIN_SCORE=70
MIN_SIMPLE_BUY_PROFIT_PERCENT=5
MIN_SIMPLE_BUY_VOLUME_RATIO=0.7
MAX_SIMPLE_BUY_FAKE_SPREAD_RISK=30
ENABLE_LOW_CONVICTION_CANDIDATES=true
LOW_CONVICTION_MIN_BRAIN_SCORE=80
LOW_CONVICTION_MIN_TRADEABILITY=55
LOW_CONVICTION_MIN_VOLUME_RATIO=0.8
LOW_CONVICTION_MAX_FAKE_SPREAD_RISK=20
FLIPS_DEBUG_REJECTIONS=true
EMPTY_SUMMARY_TOP_REJECTIONS=5
VOLATILITY_HISTORY_WINDOW=6
VOLATILITY_ITEM_SPIKE_CAP=35
VOLATILITY_HIGH_THRESHOLD=12
VOLATILITY_MEDIUM_THRESHOLD=5
```

## Important note

I did not change your `positions.json` or `state.json`. Those are data files and should stay in your project as-is.
