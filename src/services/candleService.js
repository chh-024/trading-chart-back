import pool from "../db/database.js";
import { TIMEFRAME_SECONDS } from "../config/timeframeConfig.js";
import { runMarketTask } from "./marketLock.js";
import { broadcastCandle } from "../realtime/websocket.js";

const KST_OFFSET_SEC = 9 * 60 * 60;

function getCandleTime(nowSec, timeframe, intervalSec) {
  /*
   * 1일봉
   *
   * 한국시간 00:00 기준
   */
  if (timeframe === "1d") {
    return (
      Math.floor((nowSec + KST_OFFSET_SEC) / 86400) * 86400 - KST_OFFSET_SEC
    );
  }

  /*
   * 1초 / 1분 / 3분 / 5분 ...
   * 1시간 / 4시간
   */
  return Math.floor(nowSec / intervalSec) * intervalSec;
}

export async function processPriceTick({
  market,
  price,
  sourceClientId = "SERVER",
  eventId = crypto.randomUUID(),
}) {
  const currentPrice = Number(price);

  if (!market || !Number.isFinite(currentPrice)) {
    throw new Error("market / price가 올바르지 않습니다.");
  }

  return runMarketTask(market, async () => {
    /*
     * 모든 timeframe에서 동일한 기준 시각 사용
     */
    const nowSec = Math.floor(Date.now() / 1000);

    const updatedCandles = [];

    const db = await pool.connect();

    try {
      await db.query("BEGIN");

      /*
       * 가격 Tick 하나로
       * 모든 timeframe 갱신
       */
      for (const [timeframe, intervalSec] of Object.entries(
        TIMEFRAME_SECONDS,
      )) {
        const candleTime = getCandleTime(nowSec, timeframe, intervalSec);

        const result = await db.query(
          `
            INSERT INTO candles (
              market,
              timeframe,
              time,
              open,
              high,
              low,
              close
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $4,
              $4,
              $4
            )

            ON CONFLICT (
              market,
              timeframe,
              time
            )

            DO UPDATE SET
              high = GREATEST(
                candles.high,
                EXCLUDED.high
              ),

              low = LEAST(
                candles.low,
                EXCLUDED.low
              ),

              close = EXCLUDED.close

            RETURNING
              market,
              timeframe,
              time,
              open,
              high,
              low,
              close
          `,
          [market, timeframe, candleTime, currentPrice],
        );

        const row = result.rows[0];

        updatedCandles.push({
          market: row.market,

          timeframe: row.timeframe,

          candle: {
            time: Number(row.time),
            open: Number(row.open),
            high: Number(row.high),
            low: Number(row.low),
            close: Number(row.close),
          },
        });
      }

      /*
       * 모든 timeframe 성공해야 확정
       */
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");

      throw error;
    } finally {
      db.release();
    }

    /*
     * ⭐ DB COMMIT 이후 Broadcast
     */
    updatedCandles.forEach(({ market, timeframe, candle }) => {
      broadcastCandle({
        type: "candle:update",

        market,
        timeframe,
        candle,

        sourceClientId,
        eventId,
      });
    });

    return updatedCandles;
  });
}
