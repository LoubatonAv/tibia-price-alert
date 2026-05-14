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
echo.
echo ===== Market Advisor =====
echo 7. Sell Advisor
echo 8. Buy Price Check
echo.
echo ===== Tools =====
echo 9. Git Push
echo 10. Exit
echo.

set /p choice=Choose option: 

if "%choice%"=="1" goto buy
if "%choice%"=="2" goto receive
if "%choice%"=="3" goto addexternal
if "%choice%"=="4" goto list
if "%choice%"=="5" goto sold
if "%choice%"=="6" goto stats
if "%choice%"=="7" goto inventory
if "%choice%"=="8" goto inventorybuy
if "%choice%"=="9" goto gitpush
if "%choice%"=="10" exit

goto menu

:buy
cls
echo ADD BUY ORDER
echo.
echo Use this after placing a buy offer in Tibia Market.
echo.

set /p itemInput=Item Name or ID: 
set /p entryPrice=Buy price: 
set /p quantity=Quantity ordered: 

call npm run trade -- buy "%itemInput%" %entryPrice% %quantity% 0

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
echo If this item dropped from a monster, choose Y and cost will be 0 automatically.
echo.

set /p itemInput=Item Name or ID: 
set /p quantity=Quantity: 
set /p isLoot=Is this loot/drop? Y/N: 

if /I "%isLoot%"=="Y" (
  set cost=0
) else (
  echo.
  echo Enter acquisition cost per item.
  echo If the item was free, type 0.
  set /p cost=Cost per item: 
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

:inventory
cls
echo SELL CHECK
echo.
echo Look at the Offers tab in Tibia Market.
echo.
echo Sell Offers = people selling the item.
echo Buy Offers  = people willing to buy instantly.
echo.
echo This compares:
echo 1. Listing on market
echo 2. Instant sell to buy offer
echo 3. NPC sell
echo.

set /p itemInput=Item Name or ID: 
set /p quantity=Quantity you have: 
set /p liveSell=Lowest sell offer price: 
set /p sellAhead=How many items are listed at or below that sell price: 
set /p liveBuy=Highest buy offer price: 
set /p buyAvailable=How many items can you instant-sell at that buy price: 

call node inventory.js sell "%itemInput%" %quantity% %liveSell% 0 0 --live-sell %liveSell% --live-buy %liveBuy% --sell-ahead %sellAhead% --buy-available %buyAvailable%

pause
goto menu

:inventorybuy
cls
echo BUY PRICE CHECK
echo.
echo Enter the buy price you are thinking of paying.
echo Optional: paste the visible buy ladder for better price suggestions.
echo Example buy ladder: 43620:8,43615:51,43614:81
echo.

set /p ITEM=Item Name or ID: 
set /p QTY=Quantity you want to buy: 
set /p BUY_PRICE=Buy price: 
set /p LIVE_SELL=Lowest sell listing optional, press Enter to use API: 
set /p BUY_LADDER=Visible buy ladder optional, price:amount comma-separated: 

call node inventory.js buy "%ITEM%" %QTY% %BUY_PRICE% --live-sell "%LIVE_SELL%" --buy-ladder "%BUY_LADDER%"

pause
goto menu

:gitpush
cls

git add positions.json state.json inventory.json
git commit -m "update trades"
git push

pause
goto menu