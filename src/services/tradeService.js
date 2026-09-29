import { processPriceTick } from "./candleService.js";
import { broadcastTrade } from "../realtime/websocket.js";

export async function processTrades(
  trades,
  sourceClientId = "MATCHING_ENGINE",
) {
  for (const trade of trades) {
    await processPriceTick({
      market: trade.market,
      price: trade.price,
      sourceClientId,
      eventId: trade.id,
    });

    broadcastTrade(trade);

    console.log(`[TRADE] ${trade.market} ${trade.price} / ${trade.quantity}`);
  }
}
