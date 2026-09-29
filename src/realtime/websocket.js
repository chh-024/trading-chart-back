import { WebSocket, WebSocketServer } from "ws";

let wss = null;

export function initWebSocket(server) {
  wss = new WebSocketServer({
    server,
    path: "/ws",
  });

  wss.on("connection", (socket) => {
    console.log("[WebSocket] Client 연결");

    socket.on("close", () => {
      console.log("[WebSocket] Client 종료");
    });
  });
}

function broadcast(data) {
  if (!wss) return;

  const message = JSON.stringify(data);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

export function broadcastCandle(data) {
  broadcast(data);
}

export function broadcastOrderbook(orderbook) {
  broadcast({
    type: "orderbook:update",

    market: orderbook.market,
    bids: orderbook.bids,
    asks: orderbook.asks,
  });
}

export function broadcastTrade(trade) {
  broadcast({
    type: "trade:update",
    trade,
  });
}
