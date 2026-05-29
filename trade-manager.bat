@echo off
title Tibia Trade Manager

:menu
cls
echo ============================
echo     TIBIA TRADE MANAGER
echo ============================
echo.
echo ===== Trade Tracking =====
echo 1. Add Buy Order
echo 2. Receive Items
echo 3. Add Loot / External Items
echo 4. List Items For Sale
echo 5. Sold Items
echo 6. Trade Stats
echo 7. Open Orders / Positions
echo 8. Cancel Buy Order
echo 9. Expire Buy Order
echo.
echo ===== Market Advisor =====
echo 10. Sell Check
echo 11. Buy Price Check
echo 12. Quick Profit Check
echo.
echo ===== Tools =====
echo 13. Run Flipper Check
echo 14. Run Scanner
echo 15. Run Discovery Scanner
echo 16. Git Push
echo 17. Exit
echo.

set /p choice=Choose option: 

if "%choice%"=="1" goto buy
if "%choice%"=="2" goto receive
if "%choice%"=="3" goto addexternal
if "%choice%"=="4" goto list
if "%choice%"=="5" goto sold
if "%choice%"=="6" goto stats
if "%choice%"=="7" goto orders
if "%choice%"=="8" goto cancel
if "%choice%"=="9" goto expire
if "%choice%"=="10" goto inventory
if "%choice%"=="11" goto inventorybuy
if "%choice%"=="12" goto quickcheck
if "%choice%"=="13" goto flips
if "%choice%"=="14" goto runscanner
if "%choice%"=="15" goto rundiscovery
if "%choice%"=="16" goto gitpush
if "%choice%"=="17" exit

goto menu

:buy
cls
echo ADD BUY ORDER
echo.
echo Use this after placing a buy offer in Tibia Market.
echo Target sell is optional. Leave empty and the bot calculates a 6%% target.
echo.

set /p itemInput=Item Name or ID: 
set /p entryPrice=Buy price: 
set /p quantity=Quantity ordered: 
set /p targetSell=Target sell optional: 

call npm run trade -- buy "%itemInput%" %entryPrice% %quantity% %targetSell%

pause
goto menu

:receive
cls
echo RECEIVE ITEMS
echo.

set /p itemInput=Item Name or ID: 
set /p quantity=Quantity Received: 
set /p actualEntryPrice=Actual Entry Price optional: 

call npm run trade -- receive "%itemInput%" %quantity% %actualEntryPrice%

pause
goto menu

:addexternal
cls
echo ADD LOOT / EXTERNAL ITEMS
echo.
echo Use this for loot, drops, manual trades, old stash, or items not bought through the market.
echo.

set /p itemInput=Item Name or ID: 
set /p quantity=Quantity: 
set /p isLoot=Is this loot/drop? Y/N: 

if /I "%isLoot%"=="Y" (
  set cost=0
) else (
  set /p cost=Cost per item, type 0 if free: 
)

call npm run trade -- add "%itemInput%" %quantity% %cost%

pause
goto menu

:list
cls
echo LIST ITEMS FOR SALE
echo.
echo This will first check if your planned sell price makes sense.
echo IMPORTANT:
echo - Buy/entry price = the price YOU paid per item.
echo - Planned sell price = the price you want to list your item for.
echo - Current lowest sell = the cheapest sell offer you see right now in Tibia Market.
echo - Quantity at current lowest = how many items are listed at that cheapest price.
echo.

set "ITEM="
set "QTY="
set "LIST_PRICE="
set "ENTRY_PRICE="
set "LOWEST_SELL="
set "LOWEST_SELL_QTY="
set "CONFIRM_LIST="

set /p "ITEM=Item name or ID, example silver token: "
set /p "QTY=How many items do you want to list? Example 10: "

echo.
echo YOUR TRADE:
set /p "ENTRY_PRICE=How much did YOU pay per item? Example 50010: "
set /p "LIST_PRICE=What price do you want to list EACH item for? Example 59999: "

if not defined ENTRY_PRICE set "ENTRY_PRICE=0"
if not defined LIST_PRICE set "LIST_PRICE=0"

echo.
echo LIVE TIBIA MARKET - SELL OFFERS:
echo Look at the SELL OFFERS side in Tibia Market right now.
set /p "LOWEST_SELL=What is the cheapest current sell price? Example 60000: "
set /p "LOWEST_SELL_QTY=How many items are listed at that cheapest price? Example 150: "

if not defined LOWEST_SELL set "LOWEST_SELL=0"
if not defined LOWEST_SELL_QTY set "LOWEST_SELL_QTY=0"

echo.
echo ============================
echo Running sell advisor first...
echo ============================
echo.
echo Checking:
echo Item: %ITEM%
echo Quantity: %QTY%
echo Your entry price: %ENTRY_PRICE%
echo Your planned sell price: %LIST_PRICE%
echo Current lowest sell price: %LOWEST_SELL%
echo Quantity at current lowest price: %LOWEST_SELL_QTY%
echo.
echo node inventory.js sell "%ITEM%" %QTY% %LIST_PRICE% --entry-price "%ENTRY_PRICE%" --lowest-sell "%LOWEST_SELL%" --lowest-sell-qty "%LOWEST_SELL_QTY%"
echo.

call node inventory.js sell "%ITEM%" %QTY% %LIST_PRICE% --entry-price "%ENTRY_PRICE%" --lowest-sell "%LOWEST_SELL%" --lowest-sell-qty "%LOWEST_SELL_QTY%"

if errorlevel 1 (
  echo.
  echo Sell check failed. Position was NOT updated.
  pause
  goto menu
)

echo.
echo ============================
echo Confirm listing
echo ============================
echo.
echo Only type Y if you ACTUALLY placed this sell offer inside Tibia Market.
echo This will update your local position as LISTED_FOR_SALE.
echo.

set /p "CONFIRM_LIST=Did you place this sell offer in Tibia Market now? Y/N: "

if /I "%CONFIRM_LIST%"=="Y" (
  echo.
  echo Updating trade position...
  call npm run trade -- list "%ITEM%" %QTY% %LIST_PRICE%
) else (
  echo.
  echo Cancelled. Position was NOT updated.
)

pause
goto menu

:sold
cls
echo SOLD ITEMS
echo.

set /p itemInput=Item Name or ID: 
set /p quantity=Quantity Sold: 
echo If you listed this item first, leave sell price empty to use the last listed price.
echo If this was an instant sell or custom price, enter the actual sell price.
echo.

set /p sellPrice=Sell Price optional: 

call npm run trade -- sold "%itemInput%" %quantity% %sellPrice%

pause
goto menu

:stats
cls
call npm run trade -- stats
pause
goto menu

:orders
cls
call npm run trade -- orders
pause
goto menu

:cancel
cls
echo CANCEL BUY ORDER
echo.
echo Use only for a buy order that did not receive items.
echo This does NOT close a trade. It only marks the order cancelled and records the lost fee.
echo.
set /p itemInput=Item Name or ID: 
set /p reason=Reason optional: 
call npm run trade -- cancel "%itemInput%" "%reason%"
pause
goto menu

:expire
cls
echo EXPIRE BUY ORDER
echo.
echo Use when a buy order expired after about 30 days without filling.
echo.
set /p itemInput=Item Name or ID: 
call npm run trade -- expire "%itemInput%"
pause
goto menu

:inventory
cls
echo SELL CHECK / SELL PRICE ADVISOR
echo.
echo This checks if selling is worth it and suggests a sell price.
echo IMPORTANT:
echo - Buy/entry price = the price YOU paid per item.
echo - Planned sell price = the price you are thinking about listing for.
echo - Current lowest sell = the cheapest sell offer you see now in Tibia Market.
echo - Quantity at current lowest = how many items are listed at that cheapest price.
echo.
echo This does NOT update your position.
echo.

set "ITEM="
set "QTY="
set "YOUR_LIST_PRICE="
set "ENTRY_PRICE="
set "LOWEST_SELL="
set "LOWEST_SELL_QTY="

set /p "ITEM=Item name or ID, example silver token: "
set /p "QTY=How many items do you have? Example 10: "

echo.
echo YOUR TRADE:
set /p "ENTRY_PRICE=How much did YOU pay per item? Example 50010: "
set /p "YOUR_LIST_PRICE=What price are you thinking to sell EACH item for? Press Enter if you want only a suggestion: "

if not defined ENTRY_PRICE set "ENTRY_PRICE=0"
if not defined YOUR_LIST_PRICE set "YOUR_LIST_PRICE=0"

echo.
echo LIVE TIBIA MARKET - SELL OFFERS:
echo Look at the SELL OFFERS side in Tibia Market right now.
set /p "LOWEST_SELL=What is the cheapest current sell price? Example 60000: "
set /p "LOWEST_SELL_QTY=How many items are listed at that cheapest price? Example 150: "

if not defined LOWEST_SELL set "LOWEST_SELL=0"
if not defined LOWEST_SELL_QTY set "LOWEST_SELL_QTY=0"

echo.
echo ============================
echo Running sell advisor...
echo ============================
echo.
echo Checking:
echo Item: %ITEM%
echo Quantity: %QTY%
echo Your entry price: %ENTRY_PRICE%
echo Your planned sell price: %YOUR_LIST_PRICE%
echo Current lowest sell price: %LOWEST_SELL%
echo Quantity at current lowest price: %LOWEST_SELL_QTY%
echo.
echo node inventory.js sell "%ITEM%" %QTY% %YOUR_LIST_PRICE% --entry-price "%ENTRY_PRICE%" --lowest-sell "%LOWEST_SELL%" --lowest-sell-qty "%LOWEST_SELL_QTY%"
echo.

call node inventory.js sell "%ITEM%" %QTY% %YOUR_LIST_PRICE% --entry-price "%ENTRY_PRICE%" --lowest-sell "%LOWEST_SELL%" --lowest-sell-qty "%LOWEST_SELL_QTY%"

pause
goto menu

:inventorybuy
cls
echo BUY OFFER ADVISOR
echo.
echo This helps you decide where to place a BUY offer.
echo.
echo Look only at the BUY OFFERS side in Tibia Market.
echo.
echo Highest buy offer = the top buy offer.
echo Lowest relevant buy = the lowest buy offer in the crowded/range area you care about.
echo Estimated quantity in range = about how many items are competing between those prices.
echo.
echo You can leave "Your planned buy price" empty if you want the bot to suggest one.
echo.

set "ITEM="
set "QTY="
set "BUY_PRICE="
set "LIVE_BUY="
set "LOW_BUY_ABOVE="
set "BUY_AHEAD="

set /p "ITEM=Item Name or ID: "
set /p "QTY=Quantity you want to buy: "
set /p "BUY_PRICE=Your planned buy price optional, press Enter for advisor mode: "

if not defined BUY_PRICE set "BUY_PRICE=0"

echo.
echo BUY OFFERS side:
set /p "LIVE_BUY=Highest buy offer: "
set /p "LOW_BUY_ABOVE=Lowest relevant buy offer in this range: "
set /p "BUY_AHEAD=Estimated total quantity in this range: "

echo.
echo Running advisor...
echo node inventory.js buy "%ITEM%" %QTY% %BUY_PRICE% --live-buy "%LIVE_BUY%" --buy-range-low "%LOW_BUY_ABOVE%" --buy-ahead "%BUY_AHEAD%"
echo.

call node inventory.js buy "%ITEM%" %QTY% %BUY_PRICE% --live-buy "%LIVE_BUY%" --buy-range-low "%LOW_BUY_ABOVE%" --buy-ahead "%BUY_AHEAD%"

pause
goto menu

:quickcheck
cls
echo QUICK PROFIT CHECK
echo.
echo Use this BEFORE buying or listing when you want a simple yes/no profit check.
echo This does NOT update your position. It only checks profit after fees.
echo.
echo Example:
echo Item: stone skin amulet
echo Buy price: 8199
echo Sell price: 9500
echo Quantity: 10
echo.

set "ITEM="
set "ENTRY_PRICE="
set "SELL_PRICE="
set "QTY="

set /p "ITEM=Item name or ID: "
set /p "ENTRY_PRICE=Buy / entry price per item: "
set /p "SELL_PRICE=Expected sell price per item: "
set /p "QTY=Quantity, press Enter for 1: "

if not defined QTY set "QTY=1"

echo.
echo ============================
echo Running quick profit check...
echo ============================
echo.
echo node trade.js check "%ITEM%" %ENTRY_PRICE% %SELL_PRICE% %QTY%
echo.

call npm run trade -- check "%ITEM%" %ENTRY_PRICE% %SELL_PRICE% %QTY%

pause
goto menu

:flips
cls
echo RUN FLIPPER CHECK
echo.
set SCANNER_MODE=tracked
call npm run flips
echo.
echo Finished. Press any key to return to menu.
pause >nul
goto menu

:runscanner
cls
echo RUN SCANNER
echo.
echo This runs npm run scanner locally for tracked items / regular flips.
echo.
set SCANNER_MODE=tracked
call npm run scanner
pause
goto menu

:rundiscovery
cls
echo RUN DISCOVERY SCANNER
echo.
echo This checks a larger research pool and suggests IDs to add to watch/experimental.
echo It does NOT send BUY/SELL alerts.
echo.
set SCANNER_MODE=discovery
call npm run scanner
pause
goto menu

:gitpush
cls
git add positions.json state.json inventory.json tracked-items.json data/tracked-items.json data/discovery-items.json
git commit -m "update tibia trading data"
git push
pause
goto menu
