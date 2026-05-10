# Tibia Flipper Bot — Quick Start Guide

## 1. Start With No Positions

When starting fresh, your `positions.json` should look like this:

```json
{
  "positions": []
}
```

This means:

- The bot will only send BUY opportunities
- No SELL alerts will appear yet

---

## 2. Wait For Good BUY Signals

Look for:

- Brain Score: `85+`
- Fake Spread Risk: low (`0-20`)
- Good volume/liquidity
- Realistic profit around `5%+`

Example:

```txt
🟢 BUY — collar of blue plasma
```

---

## 3. Place BUY Offers (Do NOT instant buy)

The bot tells you the maximum realistic BUY price.

Example:

```txt
Place BUY offer around 13,435 gp or lower
```

Place a market offer and wait for it to fill.

---

## 4. Add Filled Purchases To positions.json

ONLY after your offer actually fills.

Example:

```json
{
  "positions": [
    {
      "id": 23542,
      "name": "collar of blue plasma",
      "status": "OPEN",
      "quantity": 1,
      "entryPrice": 13435,
      "entryBrainScore": 90,
      "desiredMargin": 0.06
    }
  ]
}
```

---

## 5. Let The Bot Track SELL Opportunities

Once the item exists in `positions.json`, the bot will:

- Stop sending BUY alerts for that item
- Start monitoring SELL opportunities
- Send SELL alerts when targets are reached or risk increases

---

## 6. After Selling

Change:

```json
"status": "OPEN"
```

to:

```json
"status": "CLOSED"
```

This tells the bot:

- You no longer own the item
- SELL alerts should stop
- Future BUY opportunities are allowed again

---

## Important Notes

- BUY alerts are opportunities, not guarantees
- Never chase inflated prices
- Avoid high fake spread risk items
- The bot works best with patience and realistic offers
