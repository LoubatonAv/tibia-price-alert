@echo off
title Tibia Trade Manager

:menu
cls
echo ============================
echo     TIBIA TRADE MANAGER
echo ============================
echo.
echo 1. Open Trade
echo 2. Close Trade
echo 3. Trade Stats
echo 4. Git Push
echo 5. Exit
echo.

set /p choice=Choose option: 

if "%choice%"=="1" goto open
if "%choice%"=="2" goto close
if "%choice%"=="3" goto stats
if "%choice%"=="4" goto gitpush
if "%choice%"=="5" exit

goto menu

:open
cls
echo OPEN TRADE
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
echo CLOSE TRADE
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

:gitpush
cls

git add positions.json state.json
git commit -m "update trades"
git push

pause
goto menu