'use strict';

// claude-sonnet-5 の標準価格（USD / 1Mトークン）。2026-08-31までの導入価格($2/$10)より高い方の
// 標準価格で見積もることで、budgetの見積もりを安全側（過小評価しない方向）に倒す。
const SONNET_PRICE_PER_MTOK = { input: 3.0, output: 15.0 };

function usdToJpy(usd, rate = Number(process.env.USD_JPY_RATE) || 150) {
  return usd * rate;
}

function calcCostJpy(usage, rate) {
  const inputTokens = usage?.input_tokens || 0;
  const outputTokens = usage?.output_tokens || 0;
  const usd =
    (inputTokens / 1e6) * SONNET_PRICE_PER_MTOK.input +
    (outputTokens / 1e6) * SONNET_PRICE_PER_MTOK.output;
  return usdToJpy(usd, rate);
}

// 1日のAPI課金上限（DAILY_API_BUDGET_JPY）を超えたら停止するための集計器（仕様書§10）。
function createBudgetTracker(dailyBudgetJpy = Number(process.env.DAILY_API_BUDGET_JPY) || Infinity) {
  let spentJpy = 0;
  return {
    add(usage) {
      const costJpy = calcCostJpy(usage);
      spentJpy += costJpy;
      return costJpy;
    },
    get spentJpy() {
      return spentJpy;
    },
    get dailyBudgetJpy() {
      return dailyBudgetJpy;
    },
    isOverBudget() {
      return spentJpy >= dailyBudgetJpy;
    },
  };
}

module.exports = { calcCostJpy, createBudgetTracker, SONNET_PRICE_PER_MTOK };
