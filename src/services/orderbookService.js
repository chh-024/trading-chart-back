import { randomUUID } from "node:crypto";

import { MARKET_CONFIG } from "../config/marketConfig.js";

const orderbooks = new Map();

function getBook(market) {
  if (!orderbooks.has(market)) {
    orderbooks.set(market, {
      bids: [],
      asks: [],
    });
  }

  return orderbooks.get(market);
}

function sortBook(book) {
  // BUY: 높은 가격 우선 → 같은 가격이면 먼저 들어온 주문 우선
  book.bids.sort((a, b) => b.price - a.price || a.createdAt - b.createdAt);

  // SELL: 낮은 가격 우선 → 같은 가격이면 먼저 들어온 주문 우선
  book.asks.sort((a, b) => a.price - b.price || a.createdAt - b.createdAt);
}

export function removeOrdersBySource(market, source) {
  const book = getBook(market);

  book.bids = book.bids.filter((order) => order.source !== source);

  book.asks = book.asks.filter((order) => order.source !== source);

  sortBook(book);
}

export function placeOrder({ market, side, price, quantity, source = "USER" }) {
  if (!MARKET_CONFIG[market]) {
    throw new Error(`지원하지 않는 market입니다: ${market}`);
  }

  if (!["BUY", "SELL"].includes(side)) {
    throw new Error("side는 BUY 또는 SELL이어야 합니다.");
  }

  const orderPrice = Number(price);
  const orderQuantity = Number(quantity);

  if (
    !Number.isFinite(orderPrice) ||
    orderPrice <= 0 ||
    !Number.isFinite(orderQuantity) ||
    orderQuantity <= 0
  ) {
    throw new Error("price / quantity가 올바르지 않습니다.");
  }

  const book = getBook(market);

  const order = {
    id: randomUUID(),
    market,
    side,
    price: orderPrice,
    quantity: orderQuantity,
    remainingQuantity: orderQuantity,
    source,
    createdAt: Date.now(),
  };

  const trades = [];

  /*
   * BUY가 들어오면 SELL과 비교
   * SELL이 들어오면 BUY와 비교
   */
  const oppositeOrders = side === "BUY" ? book.asks : book.bids;

  while (order.remainingQuantity > 0 && oppositeOrders.length > 0) {
    const bestOrder = oppositeOrders[0];

    const canMatch =
      side === "BUY"
        ? order.price >= bestOrder.price
        : order.price <= bestOrder.price;

    if (!canMatch) {
      break;
    }

    const tradeQuantity = Math.min(
      order.remainingQuantity,
      bestOrder.remainingQuantity,
    );

    /*
     * 기존에 Orderbook에 있던 주문의 가격으로 체결
     */
    const tradePrice = bestOrder.price;

    order.remainingQuantity -= tradeQuantity;
    bestOrder.remainingQuantity -= tradeQuantity;

    trades.push({
      id: randomUUID(),

      market,

      price: tradePrice,
      quantity: tradeQuantity,

      buyOrderId: side === "BUY" ? order.id : bestOrder.id,

      sellOrderId: side === "SELL" ? order.id : bestOrder.id,

      createdAt: Date.now(),
    });

    /*
     * 기존 주문이 전부 체결됐으면 Orderbook에서 제거
     */
    if (bestOrder.remainingQuantity <= 0) {
      oppositeOrders.shift();
    }
  }

  /*
   * 신규 주문이 전부 체결되지 않았다면
   * Orderbook에 남김
   */
  if (order.remainingQuantity > 0) {
    if (side === "BUY") {
      book.bids.push(order);
    } else {
      book.asks.push(order);
    }
  }

  sortBook(book);

  return {
    order,
    trades,
    orderbook: getOrderbook(market),
  };
}

export function getOrderbook(market) {
  const book = getBook(market);

  return {
    market,

    bids: book.bids.map((order) => ({
      id: order.id,

      price: order.price,

      quantity: order.remainingQuantity,

      source: order.source,
    })),

    asks: book.asks.map((order) => ({
      id: order.id,

      price: order.price,

      quantity: order.remainingQuantity,

      source: order.source,
    })),
  };
}
