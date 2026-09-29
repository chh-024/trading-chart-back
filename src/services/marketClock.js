const marketClock = new Map();

export async function getCandleTime({ market, pool, config }) {
  let state = marketClock.get(market);

  const timeStep = config.timeStep ?? 60;
  const candleDuration = config.candleDuration ?? 1000;

  if (!state) {
    const result = await pool.query(
      `
        SELECT time
        FROM candles
        WHERE market = $1
        ORDER BY time DESC
        LIMIT 1
      `,
      [market],
    );

    const lastTime =
      result.rows.length > 0 ? Number(result.rows[0].time) : null;

    const now = Math.floor(Date.now() / 1000);

    const baseTime =
      lastTime ?? Math.floor(now / timeStep) * timeStep - timeStep;

    state = {
      baseTime,
      startedAt: Date.now(),
    };

    marketClock.set(market, state);
  }

  const slot = Math.floor((Date.now() - state.startedAt) / candleDuration);

  return state.baseTime + (slot + 1) * timeStep;
}
