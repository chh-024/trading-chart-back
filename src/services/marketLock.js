const marketQueues = new Map();

export function runMarketTask(market, task) {
  const previous = marketQueues.get(market) ?? Promise.resolve();

  const current = previous.catch(() => {}).then(task);

  marketQueues.set(market, current);

  return current.finally(() => {
    if (marketQueues.get(market) === current) {
      marketQueues.delete(market);
    }
  });
}
