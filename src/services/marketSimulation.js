import { MARKET_CONFIG } from "../config/marketConfig.js";
import pool from "../db/database.js";

import {
  getOrderbook,
  placeOrder,
  removeOrdersBySource,
} from "./orderbookService.js";

import { processTrades } from "./tradeService.js";
import { broadcastOrderbook } from "../realtime/websocket.js";

/*
 * BUY / SELL 각각 유지할 호가 개수
 */
const DEPTH_COUNT = 5;

/*
 * 현재 가격 기준 호가 간격
 *
 * 0.0005 = 0.05%
 *
 * BTC 80,000 기준:
 * 약 40 간격
 */
const PRICE_STEP_RATE = 0.0005;

/*
 * 매 Tick마다 기준 가격이 자연스럽게 움직이는 범위
 *
 * ±0.02%
 */
const MARKET_MOVE_RATE = 0.0002;

/*
 * User 주문 때문에 Simulator 주문이
 * 즉시 계속 체결되는 경우
 * 무한 반복되는 것을 막기 위한 제한
 */
const MAX_LIQUIDITY_ATTEMPTS = 50;

/*
 * Market별 현재 기준가격
 */
const marketPriceState = new Map();

/*
 * Market별 마지막 실행 시간
 */
const lastTickState = new Map();

/*
 * Market별 중복 처리 방지
 */
const processingState = new Map();

let simulatorInterval = null;

/*
 * ============================================
 * 가격 관련 Helper
 * ============================================
 */

function normalizePrice(price) {
  const value = Number(price);

  if (!Number.isFinite(value)) {
    return null;
  }

  return Number(Math.max(value, 0.00000001).toFixed(8));
}

/*
 * 현재 가격 기준
 * 호가 1칸의 간격
 */
function getPriceStep(currentPrice) {
  const price = Number(currentPrice);

  return Math.max(price * PRICE_STEP_RATE, 0.00000001);
}

/*
 * 기준가격을 아주 조금 랜덤하게 움직임
 */
function moveMarketPrice(currentPrice) {
  const movement = (Math.random() * 2 - 1) * MARKET_MOVE_RATE;

  return normalizePrice(currentPrice * (1 + movement));
}

/*
 * Mock 주문 수량
 */
function createQuantity() {
  return Number((0.2 + Math.random() * 1.3).toFixed(4));
}

/*
 * ============================================
 * Trade 결과로 현재 가격 변경
 * ============================================
 */
function updateMarketPriceFromTrades(market, trades) {
  if (!trades?.length) {
    return;
  }

  const lastTrade = trades[trades.length - 1];

  const tradePrice = Number(lastTrade.price);

  if (Number.isFinite(tradePrice) && tradePrice > 0) {
    marketPriceState.set(market, tradePrice);
  }
}

/*
 * ============================================
 * Simulator Order 생성
 * ============================================
 *
 * 현재 기준가격 주변에
 *
 * ASK 5개
 * BID 5개
 *
 * 유지
 */
async function createLiquidity(market, referencePrice) {
  const step = getPriceStep(referencePrice);

  /*
   * ==================================
   * SELL / ASK 생성
   * ==================================
   */

  let askAttempts = 0;

  while (askAttempts < MAX_LIQUIDITY_ATTEMPTS) {
    const book = getOrderbook(market);

    const simulatorAsks = book.asks
      .filter((order) => order.source === "SIMULATOR")
      .sort((a, b) => Number(a.price) - Number(b.price));

    if (simulatorAsks.length >= DEPTH_COUNT) {
      break;
    }

    let price;

    /*
     * 첫 번째 ASK
     */
    if (simulatorAsks.length === 0) {
      price = referencePrice + step;
    } else {
      /*
       * 기존 가장 높은 ASK 뒤에
       * 새로운 호가 추가
       */
      const highestAsk = Math.max(
        ...simulatorAsks.map((order) => Number(order.price)),
      );

      price = highestAsk + step;
    }

    const normalizedPrice = normalizePrice(price);

    if (normalizedPrice === null || normalizedPrice <= 0) {
      break;
    }

    const result = placeOrder({
      market,

      side: "SELL",

      price: normalizedPrice,

      quantity: createQuantity(),

      source: "SIMULATOR",
    });

    /*
     * USER BUY 주문과
     * 바로 체결될 수도 있음
     */
    if (result.trades.length > 0) {
      await processTrades(result.trades, "MARKET_SIMULATOR");

      updateMarketPriceFromTrades(market, result.trades);
    }

    askAttempts += 1;
  }

  /*
   * ==================================
   * BUY / BID 생성
   * ==================================
   */

  let bidAttempts = 0;

  while (bidAttempts < MAX_LIQUIDITY_ATTEMPTS) {
    const book = getOrderbook(market);

    const simulatorBids = book.bids
      .filter((order) => order.source === "SIMULATOR")
      .sort((a, b) => Number(b.price) - Number(a.price));

    if (simulatorBids.length >= DEPTH_COUNT) {
      break;
    }

    let price;

    /*
     * 첫 번째 BID
     */
    if (simulatorBids.length === 0) {
      price = referencePrice - step;
    } else {
      /*
       * 기존 가장 낮은 BID 아래에
       * 새로운 호가 추가
       */
      const lowestBid = Math.min(
        ...simulatorBids.map((order) => Number(order.price)),
      );

      price = lowestBid - step;
    }

    const normalizedPrice = normalizePrice(price);

    if (normalizedPrice === null || normalizedPrice <= 0) {
      break;
    }

    const result = placeOrder({
      market,

      side: "BUY",

      price: normalizedPrice,

      quantity: createQuantity(),

      source: "SIMULATOR",
    });

    /*
     * USER SELL과
     * 바로 체결될 수도 있음
     */
    if (result.trades.length > 0) {
      await processTrades(result.trades, "MARKET_SIMULATOR");

      updateMarketPriceFromTrades(market, result.trades);
    }

    bidAttempts += 1;
  }
}

/*
 * ============================================
 * Best Ask / Best Bid 체결
 * ============================================
 */
async function executeMarketTrade(market) {
  const book = getOrderbook(market);

  if (book.asks.length === 0 || book.bids.length === 0) {
    return;
  }

  /*
   * 50% 확률
   *
   * true  → BUY 발생
   * false → SELL 발생
   */
  const buyDirection = Math.random() >= 0.5;

  let result;

  /*
   * ==================================
   * BUY
   *
   * 가장 싼 SELL
   * 즉 Best Ask 체결
   * ==================================
   */
  if (buyDirection) {
    const bestAsk = book.asks[0];

    result = placeOrder({
      market,

      side: "BUY",

      price: Number(bestAsk.price),

      quantity: Number(bestAsk.quantity),

      source: "SIMULATOR",
    });
  } else {
    /*
     * ==================================
     * SELL
     *
     * 가장 비싼 BUY
     * 즉 Best Bid 체결
     * ==================================
     */
    const bestBid = book.bids[0];

    result = placeOrder({
      market,

      side: "SELL",

      price: Number(bestBid.price),

      quantity: Number(bestBid.quantity),

      source: "SIMULATOR",
    });
  }

  if (result.trades.length === 0) {
    return;
  }

  /*
   * Trade
   *
   * ↓
   *
   * Candle
   * WebSocket trade:update
   */
  await processTrades(result.trades, "MARKET_SIMULATOR");

  /*
   * 마지막 체결가격을
   * 다음 기준가격으로 사용
   */
  updateMarketPriceFromTrades(market, result.trades);
}

/*
 * ============================================
 * 최초 Market 가격 설정
 * ============================================
 *
 * 지금은 DB의 깨진 Candle 가격을
 * 다시 가져오지 않고
 *
 * MARKET_CONFIG.initialPrice로
 * 깨끗하게 시작
 */
async function initializePrices() {
  for (const market of Object.keys(MARKET_CONFIG)) {
    const result = await pool.query(
      `
        SELECT close
        FROM candles
        WHERE market = $1 AND timeframe = '1s'
        ORDER BY time DESC
        LIMIT 1
      `,
      [market],
    );

    const initialPrice = Number(
      result.rows.length > 0
        ? result.rows[0].close
        : MARKET_CONFIG[market]?.initialPrice,
    );

    if (!Number.isFinite(initialPrice) || initialPrice <= 0) {
      console.error(`[SIMULATOR] ${market} 시작 가격 오류`, initialPrice);
      continue;
    }

    marketPriceState.set(market, initialPrice);
    lastTickState.set(market, 0);
    processingState.set(market, false);
  }
}

/*
 * ============================================
 * Market 1회 Simulation
 * ============================================
 */
async function simulateMarket(market) {
  let currentPrice = marketPriceState.get(market);

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    console.error("[SIMULATOR INVALID PRICE]", market, currentPrice);

    return;
  }

  /*
   * ==================================
   * 1.
   * 기준가격 아주 조금 이동
   * ==================================
   */

  currentPrice = moveMarketPrice(currentPrice);

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return;
  }

  marketPriceState.set(market, currentPrice);

  /*
   * ==================================
   * 2.
   *
   * 이전 Simulator 호가 제거
   *
   * USER 주문은 절대 제거 안 함
   * ==================================
   */

  removeOrdersBySource(market, "SIMULATOR");

  /*
   * ==================================
   * 3.
   *
   * 현재가격 주변에
   *
   * SELL 5
   * BUY 5
   *
   * 생성
   * ==================================
   */

  await createLiquidity(market, currentPrice);

  /*
   * ==================================
   * 4.
   *
   * Best Ask 또는
   * Best Bid 하나 체결
   * ==================================
   */

  await executeMarketTrade(market);

  /*
   * ==================================
   * 5.
   *
   * 실제 체결가격
   * ==================================
   */

  currentPrice = marketPriceState.get(market);

  /*
   * ==================================
   * 6.
   *
   * 방금 체결된 호가 때문에
   * 4개가 된 쪽을 다시 5개로 채움
   * ==================================
   */

  await createLiquidity(market, currentPrice);

  /*
   * ==================================
   * 7.
   *
   * 최종 Orderbook
   * WebSocket Broadcast
   * ==================================
   */

  broadcastOrderbook(getOrderbook(market));
}

/*
 * ============================================
 * Simulator 시작
 * ============================================
 */
export async function startMarketSimulator() {
  if (simulatorInterval) {
    return;
  }

  await initializePrices();

  console.log("[MARKET SIMULATOR] 시작");

  simulatorInterval = setInterval(() => {
    const now = Date.now();

    Object.entries(MARKET_CONFIG).forEach(async ([market, config]) => {
      const lastTick = lastTickState.get(market) ?? 0;

      const tickInterval = Number(config.tickInterval) || 1000;

      /*
       * Market마다 지정된
       * tickInterval이 지나지 않았으면
       * 아직 실행하지 않음
       */
      if (now - lastTick < tickInterval) {
        return;
      }

      /*
       * 이전 Tick 처리 중이면
       * 중복 실행 방지
       */
      if (processingState.get(market)) {
        return;
      }

      lastTickState.set(market, now);

      processingState.set(market, true);

      try {
        await simulateMarket(market);
      } catch (error) {
        console.error("[MARKET SIMULATOR ERROR]", market, error);
      } finally {
        processingState.set(market, false);
      }
    });
  }, 100);
}

/*
 * ============================================
 * Simulator 종료
 * ============================================
 */
export function stopMarketSimulator() {
  if (!simulatorInterval) {
    return;
  }

  clearInterval(simulatorInterval);

  simulatorInterval = null;

  console.log("[MARKET SIMULATOR] 종료");
}
