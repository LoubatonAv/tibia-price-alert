# Tibia price alert — auto market board update

World: Harmonia

## What changed

### lib/market.js
- Added `getMarketBoard(itemId)`.
- It calls TibiaMarket `/market_board` and normalizes:
  - `sellers` sorted from cheapest to most expensive.
  - `buyers` sorted from highest buy offer to lowest.
- It tries a few parameter variants (`server/world`, `item_id/id`) so it is less likely to break if the API expects a slightly different parameter name.

### inventory.js
- Imports `getMarketBoard`.
- Sell Check and Buy Price Check now try to fetch the live market board automatically.
- Manual flags still work as fallback:
  - `--live-sell`
  - `--live-buy`
  - `--sell-ahead`
  - `--buy-available`
  - `--buy-ahead`
- Sell Check now calculates from the board:
  - lowest sell offer
  - sell listing queue
  - highest buy offer
  - instant-sell quantity
  - weighted average instant-sell value across the buy ladder
- Buy Check now calculates from the board:
  - top buy offer
  - lowest sell offer
  - buy queue ahead of your planned buy price
  - price suggestions from the visible buy ladder

### trade-manager.bat
- Sell Check now asks only:
  - item
  - quantity
- Buy Price Check now asks only:
  - item
  - quantity
  - buy price you are thinking of paying
- The board API fills the rest automatically.

## How to test

```powershell
node inventory.js sell 3081 14 0
node inventory.js buy 9633 10 10100
```

If the API fails, manual fallback still works:

```powershell
node inventory.js sell 3081 14 9233 --live-sell 9233 --sell-ahead 220 --live-buy 8222 --buy-available 9
node inventory.js buy 9633 10 10100 --live-buy 10208 --live-sell 7025 --buy-ahead 200
```

## Important

Do not overwrite your `.env`, `state.json`, `positions.json`, or `inventory.json` with anything from this zip. This zip does not include those files.
