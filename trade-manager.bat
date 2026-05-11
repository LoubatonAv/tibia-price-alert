@echo off
title Tibia Trade Manager

:menu
cls
echo ============================
echo     TIBIA TRADE MANAGER
echo ============================
echo.
echo 1. Add Buy Order
echo 2. Receive Items
echo 3. List Items For Sale
echo 4. Sold Items
echo 5. Trade Stats
echo 6. Inventory Advisor
echo 7. Legacy Open Trade
echo 8. Legacy Close Trade
echo 9. Git Push
echo 10. Exit
echo.

set /p choice=Choose option: 

if "%choice%"=="1" goto buy
if "%choice%"=="2" goto receive
if "%choice%"=="3" goto list
if "%choice%"=="4" goto sold
if "%choice%"=="5" goto stats
if "%choice%"=="6" goto inventory
if "%choice%"=="7" goto open
if "%choice%"=="8" goto close
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

:open
cls
echo LEGACY OPEN TRADE
echo.

set /p itemInput=Item Name or ID: 
set /p entryPrice=Entry Price: 
set /p quantity=Quantity: 
set /p targetSell=Target Sell: 
set /p brainScore=Brain Score: 

call npm run trade -- open "%itemInput%" %entryPrice% %quantity% %targetSell% %brainScore%

pause
goto menu

:close
cls
echo LEGACY CLOSE TRADE
echo.

set /p itemInput=Item Name or ID: 
set /p sellPrice=Sell Price: 

call npm run trade -- close "%itemInput%" %sellPrice%

pause
goto menu

:stats
cls

call npm run trade -- stats

pause
goto menu

:inventory
cls

call npm run inventory

pause
goto menu

:gitpush
cls

git add positions.json state.json inventory.json
git commit -m "update trades"
git push

pause
goto menu
