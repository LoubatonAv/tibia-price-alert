@echo off
setlocal EnableExtensions
title Tibia Trade Manager

:menu
cls
echo ============================
echo     TIBIA TRADE MANAGER
echo ============================
echo.
echo 1. Dashboard / What should I do now
echo 2. Receive filled buy order
echo 3. List ready items for sale
echo 4. Listed items - sold / cancel
echo 5. Add loot / external items
echo 6. Buy orders / signals
echo 7. Find trades / market tools
echo 8. Stats
echo 9. Git push data
echo 0. Exit
echo.
set /p choice=Choose option: 

if "%choice%"=="1" goto dashboard
if "%choice%"=="2" goto receive
if "%choice%"=="3" goto listready
if "%choice%"=="4" goto soldlisting
if "%choice%"=="5" goto addloot
if "%choice%"=="6" goto buyorders
if "%choice%"=="7" goto markettools
if "%choice%"=="8" goto stats
if "%choice%"=="9" goto gitpush
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

:listready
cls
call npm run flow-list
pause
goto menu

:soldlisting
cls
echo ============================
echo        LISTED ITEMS
echo ============================
echo.
echo 1. Mark listed item as SOLD
echo    - Use after someone bought your sell offer.
echo.
echo 2. Cancel / remove listed sell offer
echo    - Use after you cancel a listing in Tibia Market.
echo    - Item becomes ready to list again at a new price.
echo.
echo 0. Back
echo.
set /p listedchoice=Choose option: 

if "%listedchoice%"=="1" call npm run flow-sold
if "%listedchoice%"=="2" call npm run flow-cancel-listing
if "%listedchoice%"=="0" goto menu
pause
goto soldlisting

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
echo    - Add repeated good Discovery finds into tracked-items.
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
echo     - Finds profitable Powerful imbuement scrolls.
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
if "%toolchoice%"=="10" goto scrollcraft
if "%toolchoice%"=="0" goto menu
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
set /p runPromo=Run Discovery Promotion now? Y/N: 
if /I "%runPromo%"=="Y" call npm run promote-discovery
pause
goto markettools

:promotediscovery
cls
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


:scrollcraft
cls
echo ============================
echo    SCROLL CRAFTING SCANNER
echo ============================
echo.
echo 1. Best Powerful scrolls
echo    - Scans all enabled Powerful scrolls and shows the best by profit.
echo.
echo 2. All Powerful scrolls
echo    - Scans all enabled Powerful scrolls and shows the full list.
echo.
echo 3. Send best Powerful scrolls to Discord
echo    - Scans Powerful scrolls and sends the best results to Discord.
echo.
echo 0. Back
echo.
set /p scrollchoice=Choose option:

if "%scrollchoice%"=="1" call npm run scrolls
if "%scrollchoice%"=="2" call npm run scrolls-all
if "%scrollchoice%"=="3" call npm run scrolls-discord
if "%scrollchoice%"=="0" goto markettools
pause
goto scrollcraft
