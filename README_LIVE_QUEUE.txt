Tibia Live Queue Update

Replace these files in your project:
- inventory.js
- trade-manager.bat

New optional flags:
- --live-sell PRICE  = current live lowest sell listing from the Tibia market UI
- --live-buy PRICE   = current live highest buy offer from the Tibia market UI

Examples:
node inventory.js sell 3081 5 9200 --live-sell 9233 --live-buy 8222
node inventory.js buy 9631 100 1998 --live-sell 1996 --live-buy 711

Why:
The API is useful for strategy/history/liquidity, but it can be delayed.
Live values should control execution decisions like list price and queue position.
