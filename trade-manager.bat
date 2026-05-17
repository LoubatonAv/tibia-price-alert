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
echo.
echo ===== Tools =====
echo 12. Run Flipper Check
echo 13. Run Scanner
echo 14. Git Push
echo 15. Exit
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
if "%choice%"=="12" goto runflips
if "%choice%"=="13" goto runscanner
if "%choice%"=="14" goto gitpush
if "%choice%"=="15" exit

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

set /p itemInput=Item Name or ID: 
set /p quantity=Quantity Listed: 
set /p listPrice=List Price: 

call npm run trade -- list "%itemInput%" %quantity% %listPrice%

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
echo SELL CHECK
echo.
echo This compares:
echo 1. Listing on market
echo 2. Instant sell to buy offer
echo 3. NPC sell
echo.
echo You can usually enter only item + quantity + 0. The bot tries to fetch the market board automatically.
echo.

set /p itemInput=Item Name or ID: 
set /p quantity=Quantity you have: 

call node inventory.js sell "%itemInput%" %quantity% 0

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


:runflips
cls
echo RUN FLIPPER CHECK
echo.
echo This runs npm run flips locally, so you can see BUY/SELL candidates and rejection reasons.
echo.
call npm run flips
pause
goto menu

:runscanner
cls
echo RUN SCANNER
echo.
echo This runs npm run scanner locally for research-only ranked opportunities.
echo.
call npm run scanner
pause
goto menu

:gitpush
cls
git add positions.json state.json inventory.json tracked-items.json data/tracked-items.json
git commit -m "update tibia trading data"
git push
pause
goto menu
