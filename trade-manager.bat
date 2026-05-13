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

set /p itemInput=Item Name or ID: 
set /p entryPrice=Buy Offer / Entry Price: 
set /p quantity=Quantity Ordered: 
set /p targetSell=Target Sell: 
set /p brainScore=Brain Score optional: 

call npm run trade -- buy "%itemInput%" %entryPrice% %quantity% %targetSell% %brainScore%

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
echo SELL ADVISOR
echo.
echo Enter only your item, quantity, and the price you are thinking of listing/selling for.
echo The bot checks real buy demand, realistic listing area, liquidity, undercut risk, and NPC value automatically.
echo.

set /p itemInput=Item Name or ID: 
set /p quantity=Quantity you have: 
set /p yourSell=Your sell/list price: 
set /p minSell=Minimum price optional, press Enter for none: 
set /p yourCost=Your cost optional, press Enter for none/drop: 
set /p liveSell=Live lowest sell offer optional, press Enter to use API: 
set /p liveBuy=Live highest buy offer optional, press Enter to use API: 

call node inventory.js sell "%itemInput%" %quantity% %yourSell% %minSell% %yourCost% --live-sell %liveSell% --live-buy %liveBuy%

pause
goto menu

:inventorybuy
cls
echo BUY PRICE CHECK
echo.
echo Enter item, quantity, and the price you are thinking of paying.
echo The bot checks real buy demand, listings, liquidity, undercut risk, and NPC value automatically.
echo.

set /p itemInput=Item Name or ID: 
set /p quantity=Quantity you want to buy: 
set /p plannedBuy=Your planned buy price: 
set /p liveSell=Live lowest sell offer optional, press Enter to use API: 
set /p liveBuy=Live highest buy offer optional, press Enter to use API: 
set /p buyAhead=How many items are ahead of your buy price optional, press Enter if unknown: 

call node inventory.js buy "%itemInput%" %quantity% %plannedBuy% --live-sell %liveSell% --live-buy %liveBuy% --buy-ahead %buyAhead%

pause
goto menu

:gitpush
cls

git add positions.json state.json inventory.json
git commit -m "update trades"
git push

pause
goto menu