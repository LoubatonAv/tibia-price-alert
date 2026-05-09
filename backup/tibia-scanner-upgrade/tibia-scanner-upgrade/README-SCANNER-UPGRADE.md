# Tibia Flipper Scanner Upgrade

## What changed

- Normal mode is still normal:

```powershell
node check-flips.js
```

It still uses only:

```json
core + watch
```

- Scanner mode is separate:

```powershell
$env:SCANNER_MODE="true"
node check-flips.js
```

It sends only a scanner report. It does not send BUY/SELL alerts.

## New tracked-items.json structure

```json
{
  "core": [],
  "watch": [],
  "scanner": {
    "safe": [],
    "watch": [],
    "experimental": [],
    "blacklist": []
  }
}
```

Normal mode uses only `core + watch`.

Scanner mode uses:

```txt
core + watch + scanner.safe + scanner.watch + scanner.experimental
```

minus anything in `scanner.blacklist`.

## Optional scanner controls

Run only safe scanner pool:

```powershell
$env:SCANNER_MODE="true"
$env:SCANNER_POOL="scanner.safe"
node check-flips.js
```

Run safe + watch pools:

```powershell
$env:SCANNER_MODE="true"
$env:SCANNER_POOL="scanner.safe,scanner.watch"
node check-flips.js
```

Change report size:

```powershell
$env:SCANNER_MODE="true"
$env:SCANNER_TOP_LIMIT="10"
node check-flips.js
```

Change API batch size:

```powershell
$env:SCANNER_MODE="true"
$env:SCANNER_BATCH_SIZE="50"
node check-flips.js
```

## New scanner logic

The scanner now rewards:

- real profit after tax
- month liquidity
- daily volume
- stable price vs month average
- undervalued price vs month average
- useful history signals

The scanner now heavily punishes:

- no sales today
- very low month sales
- negative profit after tax
- fake spread risk
- huge profit percent with weak liquidity
- missing buy/sell offers

## New report labels

Scanner tier:

- SAFE
- WATCH
- SPECULATIVE
- AVOID

Market class:

- FAST FLIP
- SAFE FLIP
- SLOW FLIP
- RISKY
- FAKE SPREAD
- DEAD MARKET
- NO PROFIT AFTER TAX
- NO MARKET

Exit confidence:

- HIGH
- MEDIUM
- LOW
- VERY LOW

## Install

1. Backup current files:

```powershell
copy .\check-flips.js .\check-flips.backup.js
copy .\data\tracked-items.json .\data\tracked-items.backup.json
```

2. Replace:

```txt
check-flips.js
```

3. Optional but recommended: replace:

```txt
data/tracked-items.json
```

with `tracked-items.scalable.json` from this zip.

4. Test normal mode first:

```powershell
node --check .\check-flips.js
node check-flips.js
```

5. Test scanner:

```powershell
$env:SCANNER_MODE="true"
node check-flips.js
```

6. Clear scanner env when done:

```powershell
Remove-Item Env:SCANNER_MODE
Remove-Item Env:SCANNER_POOL -ErrorAction SilentlyContinue
Remove-Item Env:SCANNER_TOP_LIMIT -ErrorAction SilentlyContinue
Remove-Item Env:SCANNER_BATCH_SIZE -ErrorAction SilentlyContinue
```

## Notes for future upgrades

Ideas that are not included yet:

- auto-discovery mode that tests random item IDs and promotes good ones into scanner pools
- scanner state separate from buy/sell state
- per-item cooldown for scanner reports so the same item does not dominate every report
- category-based scanner generation from items.json
- budget-aware scoring, for example only show flips under 500k, 1kk, 5kk
- Discord command integration later, for example `/scan safe`, `/scan imbues`, `/scan rings`
