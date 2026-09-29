import express from "express";
import pool from "../db/database.js";

import { MARKET_CONFIG } from "../config/marketConfig.js";
import { runMarketTask } from "../services/marketLock.js";
import { broadcastCandle } from "../realtime/websocket.js";
import { TIMEFRAME_SECONDS } from "../config/timeframeConfig.js";
import { processPriceTick } from "../services/candleService.js";

const router = express.Router();

/*
 * 동일 eventId 재처리 방지
 *
 * 지금은 메모리 기반.
 * 나중에는 DB 테이블로 옮기는 게 좋음.
 */
const processedEvents = new Set();

/*
 * 가격 Tick 처리
 *
 * POST /candles/tick
 */
router.post("/tick", async (req, res) => {
  const clientId = req.get("X-Client-Id");

  const eventId = req.get("X-Event-Id");

  const { market, price } = req.body;

  if (!clientId || !eventId) {
    return res.status(400).json({
      message: "clientId와 eventId가 필요합니다.",
    });
  }

  try {
    const data = await processPriceTick({
      market,
      price,
      sourceClientId: clientId,
      eventId,
    });

    return res.json({
      message: "가격 반영 완료",

      data,
    });
  } catch (error) {
    console.error("POST /candles/tick ERROR:", error);

    return res.status(500).json({
      message: "가격 처리 실패",

      error: error.message,
    });
  }
});

router.get("/", async (req, res) => {
  const { market, timeframe, before } = req.query;

  console.log("[GET CANDLES]", {
    market,
    timeframe,
    before,
  });

  const limit = Math.min(Number(req.query.limit) || 200, 1000);

  if (!market) {
    return res.status(400).json({
      message: "market은 필수입니다.",
    });
  }

  if (!timeframe || !TIMEFRAME_SECONDS[timeframe]) {
    return res.status(400).json({
      message: `지원하지 않는 timeframe: ${timeframe}`,
    });
  }

  try {
    const params = [market, timeframe];

    let beforeCondition = "";

    if (before) {
      params.push(Number(before));

      beforeCondition = `AND time < $${params.length}`;
    }

    params.push(limit + 1);

    const limitIndex = params.length;

    const result = await pool.query(
      `
        SELECT
          market,
          timeframe,
          time,
          open,
          high,
          low,
          close

        FROM candles

        WHERE market = $1
          AND timeframe = $2

          ${beforeCondition}

        ORDER BY time DESC

        LIMIT $${limitIndex}
      `,
      params,
    );

    const hasMore = result.rows.length > limit;

    const rows = result.rows.slice(0, limit);

    const data = rows
      .map((row) => ({
        market: row.market,

        timeframe: row.timeframe,

        time: Number(row.time),

        open: Number(row.open),

        high: Number(row.high),

        low: Number(row.low),

        close: Number(row.close),
      }))
      .reverse();

    return res.json({
      data,
      hasMore,
    });
  } catch (error) {
    console.error("GET /candles ERROR:", error);

    return res.status(500).json({
      message: "캔들 조회 실패",

      error: error.message,
    });
  }
});

export default router;
