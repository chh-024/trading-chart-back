import express from "express";

import { placeOrder, getOrderbook } from "../services/orderbookService.js";
import { processTrades } from "../services/tradeService.js";
import { broadcastOrderbook } from "../realtime/websocket.js";

const router = express.Router();

/*
 * 주문 등록
 *
 * POST /orders
 */
router.post("/", async (req, res) => {
  try {
    const { market, side, price, quantity } = req.body;

    const result = placeOrder({
      market,
      side,
      price,
      quantity,
    });

    await processTrades(result.trades, "USER_ORDER");

    broadcastOrderbook(result.orderbook);

    return res.json({
      message: "주문 처리 완료",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      message: "주문 처리 실패",
      error: error.message,
    });
  }
});

/*
 * Orderbook 조회
 *
 * GET /orders/book?market=BTC-STOC
 */
router.get("/book", (req, res) => {
  try {
    const { market } = req.query;

    if (!market) {
      return res.status(400).json({
        message: "market은 필수입니다.",
      });
    }

    const data = getOrderbook(market);

    return res.json({
      data,
    });
  } catch (error) {
    return res.status(400).json({
      message: "Orderbook 조회 실패",
      error: error.message,
    });
  }
});

export default router;
