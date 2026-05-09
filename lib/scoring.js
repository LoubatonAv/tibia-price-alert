export function analyzeHistory(history) {
  if (!history || history.length < 3) {
    return {
      historySignal: "NOT ENOUGH HISTORY",
      historyAdvice: "Need more bot runs before making a timing call.",
      historyScore: 0,
      bottomSignal: false,
      firstGreenSignal: false,
      fallingHard: false,
    };
  }

  const last3 = history.slice(-3);
  const prices = last3.map((h) => h.sellOffer);

  const falling = prices[0] > prices[1] && prices[1] > prices[2];

  const rising = prices[0] < prices[1] && prices[1] < prices[2];

  const previous = history[history.length - 2];
  const current = history[history.length - 1];

  const recovering =
    previous.sellOffer < previous.dayAverageSell &&
    current.sellOffer > previous.sellOffer;

  const stoppedFalling =
    history.length >= 4 &&
    history[history.length - 4].sellOffer >
      history[history.length - 3].sellOffer &&
    history[history.length - 3].sellOffer >
      history[history.length - 2].sellOffer &&
    current.sellOffer >= previous.sellOffer;

  const firstGreenAfterDrop =
    history.length >= 4 &&
    history[history.length - 4].sellOffer >
      history[history.length - 3].sellOffer &&
    history[history.length - 3].sellOffer >
      history[history.length - 2].sellOffer &&
    current.sellOffer > previous.sellOffer;

  if (firstGreenAfterDrop) {
    return {
      historySignal: "FIRST GREEN AFTER DROP",
      historyAdvice: "Price dropped and just bounced.",
      historyScore: 25,
      bottomSignal: true,
      firstGreenSignal: true,
      fallingHard: false,
    };
  }

  if (stoppedFalling) {
    return {
      historySignal: "FALLING STOPPED",
      historyAdvice: "Price stopped falling.",
      historyScore: 15,
      bottomSignal: true,
      firstGreenSignal: false,
      fallingHard: false,
    };
  }

  if (falling) {
    return {
      historySignal: "FALLING FOR 3 RUNS",
      historyAdvice: "Price is still dropping.",
      historyScore: -20,
      bottomSignal: false,
      firstGreenSignal: false,
      fallingHard: true,
    };
  }

  if (recovering) {
    return {
      historySignal: "POSSIBLE BOTTOM",
      historyAdvice: "Price may be recovering.",
      historyScore: 15,
      bottomSignal: true,
      firstGreenSignal: false,
      fallingHard: false,
    };
  }

  if (rising) {
    return {
      historySignal: "RISING FOR 3 RUNS",
      historyAdvice: "Good momentum, but avoid chasing inflated prices.",
      historyScore: 10,
      bottomSignal: false,
      firstGreenSignal: false,
      fallingHard: false,
    };
  }

  return {
    historySignal: "UNCERTAIN",
    historyAdvice: "No clear direction.",
    historyScore: 0,
    bottomSignal: false,
    firstGreenSignal: false,
    fallingHard: false,
  };
}

export function analyzeSellMomentum(history) {
  if (!history || history.length < 4) {
    return {
      sellMomentumSignal: "NOT ENOUGH SELL HISTORY",
      sellMomentumAdvice: "Need more runs before judging exit momentum.",
      momentumDropping: false,
      momentumBad: false,
    };
  }

  const last4 = history.slice(-4);

  const prices = last4.map((h) => h.sellOffer);

  const profits = last4.map((h) => h.profitPercent || 0);

  const wasRisingThenDropped =
    prices[0] < prices[1] && prices[1] <= prices[2] && prices[3] < prices[2];

  const fallingFor3 = prices[1] > prices[2] && prices[2] > prices[3];

  const profitFallingFor3 = profits[1] > profits[2] && profits[2] > profits[3];

  if (fallingFor3 || profitFallingFor3) {
    return {
      sellMomentumSignal: "MOMENTUM FALLING HARD",
      sellMomentumAdvice: "Sell pressure is increasing.",
      momentumDropping: true,
      momentumBad: true,
    };
  }

  if (wasRisingThenDropped) {
    return {
      sellMomentumSignal: "MOMENTUM STARTED DROPPING",
      sellMomentumAdvice: "Price was rising and now pulled back.",
      momentumDropping: true,
      momentumBad: false,
    };
  }

  return {
    sellMomentumSignal: "SELL MOMENTUM OK",
    sellMomentumAdvice: "No strong exit signal.",
    momentumDropping: false,
    momentumBad: false,
  };
}
