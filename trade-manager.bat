@echo off
setlocal EnableExtensions
title Tibia Trade Manager
cd /d "%~dp0"

if /i "%~1"=="accept-scroll" goto arg_accept_scroll
if /i "%~1"=="mark-scroll-listed" goto arg_mark_scroll_listed
if not "%~1"=="" goto arg_unknown

:menu
cls
echo ============================
echo     TIBIA TRADE MANAGER
echo ============================
echo.
echo 1. What should I do now?
echo 2. BUY - orders and signals
echo 3. RECEIVE - buy order filled
echo 4. SELL OFFERS - create / manage offers
echo 5. LOOT / external items
echo 6. MARKET tools / scanners
echo 7. Stats
echo 8. Git push data
echo 0. Exit
echo.
set /p choice=Choose option: 

if "%choice%"=="1" goto dashboard
if "%choice%"=="2" goto buyorders
if "%choice%"=="3" goto receive
if "%choice%"=="4" goto selloffers
if "%choice%"=="5" goto addloot
if "%choice%"=="6" goto markettools
if "%choice%"=="7" goto stats
if "%choice%"=="8" goto gitpush
if "%choice%"=="0" exit
goto menu

:dashboard
cls
call npm run trade -- dashboard
pause
goto menu

:receive
cls
call npm run flow-receive
pause
goto menu

:selloffers
cls
echo ============================
echo          SELL OFFERS
echo ============================
echo.
echo 1. List existing ready position
echo    - Use for items already tracked and owned.
echo.
echo 2. Create new loot / external sell offer
echo    - Use for loot, drops, or manual items.
echo.
echo 3. Create new flip sell offer
echo    - Use when you bought an item and want to list it immediately.
echo.
echo 4. Create crafted scroll sell offer
echo    - Requires ingredient costs, blank scroll cost, craft fee, and list price.
echo.
echo 5. Mark active sell offer as SOLD
echo.
echo 6. Cancel / remove active sell offer
echo.
echo 0. Back
echo.
set /p sellchoice=Choose option: 

if "%sellchoice%"=="1" call npm run flow-list
if "%sellchoice%"=="2" call npm run flow-sell-manual
if "%sellchoice%"=="3" call npm run flow-sell-flip
if "%sellchoice%"=="4" call npm run flow-sell-scroll
if "%sellchoice%"=="5" call npm run flow-sold
if "%sellchoice%"=="6" call npm run flow-cancel-listing
if "%sellchoice%"=="0" goto menu
pause
goto selloffers

:addloot
cls
call npm run flow-add-loot
pause
goto menu

:stats
cls
echo ============================
echo           STATS
echo ============================
echo.
echo 1. Split stats - flips vs loot/external
echo 2. Full stats
echo 3. Open orders / positions
echo 0. Back
echo.
set /p statchoice=Choose option: 
if "%statchoice%"=="1" call npm run trade -- stats-split
if "%statchoice%"=="2" call npm run trade -- stats
if "%statchoice%"=="3" call npm run trade -- orders
if "%statchoice%"=="0" goto menu
pause
goto stats

:buyorders
cls
echo ============================
echo      BUY ORDERS / SIGNALS
echo ============================
echo.
echo 1. Pending BUY signals
echo 2. Accept BUY signal after placing buy offer
echo 3. Manual add buy order
echo 4. Cancel buy order
echo 5. Expire buy order
echo 6. Verify old buy order still active
echo 0. Back
echo.
set /p buychoice=Choose option: 
if "%buychoice%"=="1" goto pendingbuy
if "%buychoice%"=="2" goto acceptbuy
if "%buychoice%"=="3" goto manualbuy
if "%buychoice%"=="4" goto cancelorder
if "%buychoice%"=="5" goto expireorder
if "%buychoice%"=="6" goto verifyorder
if "%buychoice%"=="0" goto menu
goto buyorders

:pendingbuy
cls
call npm run pending-buy
pause
goto buyorders

:acceptbuy
cls
echo Only use this AFTER you actually placed the Buy Offer in Tibia Market.
echo.
call npm run accept-buy
pause
goto buyorders

:manualbuy
cls
echo MANUAL ADD BUY ORDER
echo Use this only after placing a buy offer in Tibia Market.
echo.
set /p itemInput=Item Name or ID: 
set /p entryPrice=Buy price: 
set /p quantity=Quantity ordered: 
set /p targetSell=Target sell optional: 
call npm run trade -- buy "%itemInput%" %entryPrice% %quantity% %targetSell%
pause
goto buyorders

:cancelorder
cls
call npm run flow-cancel-order
pause
goto buyorders

:expireorder
cls
call npm run flow-expire-order
pause
goto buyorders

:verifyorder
cls
set /p itemInput=Item Name or ID: 
call npm run trade -- verify-order "%itemInput%"
pause
goto buyorders

:markettools
cls
echo ============================
echo    FIND TRADES / MARKET TOOLS
echo ============================
echo.
echo 1. Run Flipper check - BUY/SELL alerts
echo    - What is worth buying or selling right now from tracked items.
echo.
echo 2. Run Scanner - research tracked pool
echo    - Research view: what might be worth adding, watching, or testing.
echo.
echo 3. Promote Scanner candidates to Flipper
echo    - Add good Scanner finds into tracked-items so Flipper can alert on them.
echo.
echo 4. Run Discovery scanner - find new items
echo    - Search wider item pool for new flip candidates not already tracked.
echo.
echo 5. Promote Discovery candidates to Flipper
echo    - Run historical promotion check for repeated good Discovery finds.
echo.
echo 6. Clean old Discovery candidates
echo    - Remove weak or old Discovery noise so promotion stays clean.
echo.
echo 7. Sell price advisor
echo    - Helps choose a listing price before you place a sell offer.
echo.
echo 8. Buy price advisor
echo    - Helps choose a buy offer price before you place a buy offer.
echo.
echo 9. Quick profit check
echo    - Manual profit/ROI check for one item and one sell price.
echo.
echo 10. Scroll Crafting Scanner
echo     - Finds profitable Powerful imbuement scroll crafts.
echo.
echo 11. Send Scroll Crafting Scanner to Discord
echo.
echo 0. Back
echo.
set /p toolchoice=Choose option: 
if "%toolchoice%"=="1" goto flips
if "%toolchoice%"=="2" goto runscanner
if "%toolchoice%"=="3" goto promotescanner
if "%toolchoice%"=="4" goto rundiscovery
if "%toolchoice%"=="5" goto promotediscovery
if "%toolchoice%"=="6" goto cleandiscovery
if "%toolchoice%"=="7" goto selladvisor
if "%toolchoice%"=="8" goto buyadvisor
if "%toolchoice%"=="9" goto quickcheck
if "%toolchoice%"=="10" call npm run scrolls
if "%toolchoice%"=="11" call npm run scrolls-discord
if "%toolchoice%"=="0" goto menu
if "%toolchoice%"=="10" pause
if "%toolchoice%"=="11" pause
goto markettools

:flips
cls
set SCANNER_MODE=tracked
call npm run flips
pause
goto markettools

:runscanner
cls
set SCANNER_MODE=tracked
call npm run scanner
pause
goto markettools

:promotescanner
cls
call npm run promote-scanner
pause
goto markettools

:rundiscovery
cls
set SCANNER_MODE=discovery
call npm run scanner
echo.
echo ============================
echo Discovery scan finished.
echo ============================
echo.
call npm run promote-discovery -- --from-current-run --prompt
pause
goto markettools

:promotediscovery
cls
echo HISTORICAL DISCOVERY PROMOTION CHECK
echo Uses repeated good snapshots from previous Discovery runs.
echo.
call npm run promote-discovery
pause
goto markettools

:cleandiscovery
cls
call npm run clean-discovery
pause
goto markettools

:selladvisor
cls
set "ITEM="
set "QTY="
set "YOUR_LIST_PRICE="
set "ENTRY_PRICE="
set "LOWEST_SELL="
set "LOWEST_SELL_QTY="
echo SELL PRICE ADVISOR - does NOT update positions.
echo.
set /p "ITEM=Item name or ID: "
set /p "QTY=Quantity: "
set /p "ENTRY_PRICE=Entry price per item, 0 for loot: "
set /p "YOUR_LIST_PRICE=Planned sell price, Enter for 0/suggestion: "
if not defined ENTRY_PRICE set "ENTRY_PRICE=0"
if not defined YOUR_LIST_PRICE set "YOUR_LIST_PRICE=0"
set /p "LOWEST_SELL=Current lowest sell price: "
set /p "LOWEST_SELL_QTY=Quantity at current lowest: "
if not defined LOWEST_SELL set "LOWEST_SELL=0"
if not defined LOWEST_SELL_QTY set "LOWEST_SELL_QTY=0"
call node inventory.js sell "%ITEM%" %QTY% %YOUR_LIST_PRICE% --entry-price "%ENTRY_PRICE%" --lowest-sell "%LOWEST_SELL%" --lowest-sell-qty "%LOWEST_SELL_QTY%"
pause
goto markettools

:buyadvisor
cls
set "ITEM="
set "QTY="
set "BUY_PRICE="
set "LIVE_BUY="
set "LOW_BUY_ABOVE="
set "BUY_AHEAD="
echo BUY PRICE ADVISOR - does NOT update positions.
echo.
set /p "ITEM=Item name or ID: "
set /p "QTY=Quantity you want to buy: "
set /p "BUY_PRICE=Planned buy price, Enter for 0/advisor: "
if not defined BUY_PRICE set "BUY_PRICE=0"
set /p "LIVE_BUY=Highest buy offer: "
set /p "LOW_BUY_ABOVE=Lowest relevant buy offer in range: "
set /p "BUY_AHEAD=Estimated quantity in range: "
call node inventory.js buy "%ITEM%" %QTY% %BUY_PRICE% --live-buy "%LIVE_BUY%" --buy-range-low "%LOW_BUY_ABOVE%" --buy-ahead "%BUY_AHEAD%"
pause
goto markettools

:quickcheck
cls
set /p "ITEM=Item name or ID: "
set /p "ENTRY_PRICE=Buy / entry price per item: "
set /p "SELL_PRICE=Expected sell price per item: "
set /p "QTY=Quantity, Enter for 1: "
if not defined QTY set "QTY=1"
call npm run trade -- check "%ITEM%" %ENTRY_PRICE% %SELL_PRICE% %QTY%
pause
goto markettools

:gitpush
cls
git add positions.json state.json inventory.json pending-buy-signals.json scanner-candidates.json tracked-items.json data/tracked-items.json data/discovery-items.json
git commit -m "update tibia trading data"
git push
pause
goto menu

:arg_accept_scroll
if "%~2"=="" goto arg_usage
set "SCROLL_NAME=%~2"
set "SCROLL_QTY=%~3"
if not defined SCROLL_QTY set "SCROLL_QTY=1"
echo(%SCROLL_QTY%| findstr /r "^[1-9][0-9]*$" >nul
if errorlevel 1 goto arg_usage
shift
shift
shift
set "EXTRA_ARGS="
:arg_accept_extra
if "%~1"=="" goto arg_accept_run
set EXTRA_ARGS=%EXTRA_ARGS% "%~1"
shift
goto arg_accept_extra
:arg_accept_run
call npm run accept-scroll -- --scroll "%SCROLL_NAME%" --qty %SCROLL_QTY% %EXTRA_ARGS%
exit /b %ERRORLEVEL%

:arg_mark_scroll_listed
if "%~2"=="" goto arg_usage
set "SCROLL_NAME=%~2"
set "SCROLL_QTY=%~3"
if not defined SCROLL_QTY set "SCROLL_QTY=1"
echo(%SCROLL_QTY%| findstr /r "^[1-9][0-9]*$" >nul
if errorlevel 1 goto arg_usage
set "LIST_PRICE=%~4"
shift
shift
shift
shift
set "EXTRA_ARGS="
:arg_mark_extra
if "%~1"=="" goto arg_mark_run
set EXTRA_ARGS=%EXTRA_ARGS% "%~1"
shift
goto arg_mark_extra
:arg_mark_run
if defined LIST_PRICE (
  call npm run accept-scroll -- --scroll "%SCROLL_NAME%" --mark-listed --qty %SCROLL_QTY% --list-price %LIST_PRICE% %EXTRA_ARGS%
) else (
  call npm run accept-scroll -- --scroll "%SCROLL_NAME%" --mark-listed --qty %SCROLL_QTY% %EXTRA_ARGS%
)
exit /b %ERRORLEVEL%

:arg_unknown
echo Unknown command: %~1
echo.
goto arg_usage

:arg_usage
echo Usage:
echo   "%~f0" accept-scroll "Powerful Epiphany Scroll" [qty] [extra args]
echo   "%~f0" mark-scroll-listed "Powerful Epiphany Scroll" [qty] [list price] [extra args]
echo.
echo Examples:
echo   "%~f0" accept-scroll "Powerful Epiphany Scroll" 1
echo   "%~f0" accept-scroll "Powerful Epiphany Scroll" 2 --dry-run
echo   "%~f0" mark-scroll-listed "Powerful Epiphany Scroll" 1 950000 --dry-run
exit /b 1
