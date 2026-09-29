import pool from "../db/database.js";

import { MARKET_CONFIG } from "../config/marketConfig.js";

import { processPriceTick } from "./candleService.js";

const marketPriceState = new Map();

const lastTickState = new Map();

const processingState = new Map();

let producerInterval = null;

/*
 * 서버 시작 시
 * DB의 가장 최근 가격을 가져옴
 */
async function initializePrices() {
  for (const market of Object.keys(MARKET_CONFIG)) {
    const result = await pool.query(
      `
          SELECT close
          FROM candles
          WHERE market = $1
          ORDER BY time DESC
          LIMIT 1
        `,
      [market],
    );

    const lastPrice =
      result.rows.length > 0
        ? Number(result.rows[0].close)
        : (MARKET_CONFIG[market].initialPrice ?? 100);

    marketPriceState.set(market, lastPrice);
  }
}

/*
 * Backend Price Producer 시작
 */
export async function startPriceProducer() {
  if (producerInterval) {
    return;
  }

  await initializePrices();

  console.log("[PRICE PRODUCER] 시작");

  /*
   * 100ms마다 어떤 Market이
   * 가격을 생성할 차례인지 확인
   */
  producerInterval = setInterval(() => {
    const now = Date.now();

    Object.entries(MARKET_CONFIG).forEach(async ([market, config]) => {
      const lastTick = lastTickState.get(market) ?? 0;

      /*
       * market별 tickInterval 적용
       */
      if (now - lastTick < config.tickInterval) {
        return;
      }

      /*
       * 같은 Market 요청이
       * 이전 DB 처리 중이면 skip
       */
      if (processingState.get(market)) {
        return;
      }

      lastTickState.set(market, now);

      processingState.set(market, true);

      try {
        const currentPrice =
          marketPriceState.get(market) ?? config.initialPrice ?? 100;

        /*
         * 테스트용 랜덤 가격
         */
        const newPrice =
          currentPrice + (Math.random() - 0.5) * config.volatility;

        const price = Number(newPrice.toFixed(8));

        /*
         * ⭐ Front가 아니라
         * Backend가 직접 Candle 처리
         */
        await processPriceTick({
          market,
          price,
          sourceClientId: "SERVER",
        });

        /*
         * 다음 Tick의 기준 가격
         */
        marketPriceState.set(market, price);
      } catch (error) {
        console.error("[PRICE PRODUCER ERROR]", market, error);
      } finally {
        processingState.set(market, false);
      }
    });
  }, 100);
}

export function stopPriceProducer() {
  if (!producerInterval) {
    return;
  }

  clearInterval(producerInterval);

  producerInterval = null;

  console.log("[PRICE PRODUCER] 종료");
}
