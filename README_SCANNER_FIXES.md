# Scanner fixes — direct guide

This patch makes the scanner output safer and less confusing.

## What changed

1. SPECULATIVE items no longer show `BUY OFFER OK`.
   - They now show `WATCH ONLY`.
   - Meaning: do not open a normal buy offer just because it appeared in the scanner.

2. WATCH items are more conservative.
   - If a WATCH item looks good, it shows `BUY ONLY CHEAP`.
   - Meaning: only buy with a discounted entry, not aggressively.

3. Suggested quantity is capped by risk.
   - SAFE can still suggest up to 10.
   - WATCH is capped around 5.
   - SPECULATIVE is capped to 1–3.
   - AVOID stays effectively test/avoid only.

4. Buy ranges are always displayed low-to-high.
   - Fixes weird output like `51,200–48,300`.

## How to read the new output

### BUY OFFER OK
Cleanest signal. You can place a buy offer, but still do not go above Hard max buy.

### BUY ONLY CHEAP
Possible trade, but only if you can enter at the low side of the range. Use smaller quantity.

### WATCH ONLY
Research only. Do not treat this as a real buy signal. Maybe test 1 unit manually if you really want.

### DO NOT CHASE
The item may be good, but the entry price is bad right now. Wait.

### AVOID
Skip it.

## Simple rule

- SAFE + BUY OFFER OK = real candidate
- WATCH + BUY ONLY CHEAP = small/discounted candidate
- SPECULATIVE + WATCH ONLY = research, not a normal buy
- AVOID = skip
