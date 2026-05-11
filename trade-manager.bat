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
echo 3. List Items For Sale
echo 4. Sold Items
echo 5. Trade Stats
echo.
echo ===== Market Advisor =====
echo 6. Sell Advisor
echo 7. Buy Advisor
echo.
echo ===== Tools =====
echo 8. Git Push
echo 9. Exit
echo.

set /p choice=Choose option: 

if "%choice%"=="1" goto buy
if "%choice%"=="2" goto receive
if "%choice%"=="3" goto list
if "%choice%"=="4" goto sold
if "%choice%"=="5" goto stats
if "%choice%"=="6" goto inventory
if "%choice%"=="7" goto inventorybuy
if "%choice%"=="8" goto gitpush
if "%choice%"=="9" exit

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
set /p sellPrice=Sell Price: 

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
echo The bot will fetch liquidity, day/month sold, averages, trend, spread, and market offers automatically.
echo.

set /p itemInput=Item Name or ID: 
set /p quantity=Quantity you have: 
set /p yourSell=Your sell/list price: 
set /p minSell=Minimum price optional, press Enter for none: 
set /p yourCost=Your cost optional, press Enter for none/drop: 

call node inventory.js sell "%itemInput%" %quantity% %yourSell% %minSell% %yourCost%

pause
goto menu

:inventorybuy
cls
echo BUY ADVISOR
echo.
echo Enter only your item, quantity, and planned buy offer.
echo The bot will fetch liquidity, day/month sold, averages, trend, spread, and market offers automatically.
echo.

set /p itemInput=Item Name or ID: 
set /p quantity=Quantity you want to buy: 
set /p plannedBuy=Your planned buy offer price: 

call node inventory.js buy "%itemInput%" %quantity% %plannedBuy%

pause
goto menu

:gitpush
cls

git add positions.json state.json inventory.json
git commit -m "update trades"
git push

pause
goto menu
