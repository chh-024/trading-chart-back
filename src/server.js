import express from "express";
import cors from "cors";
import http from "http";

import candleRoutes from "./routes/candleRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";

import { initWebSocket } from "./realtime/websocket.js";
// import { startPriceProducer } from "./services/priceProducer.js";
import { startMarketSimulator } from "./services/marketSimulation.js";

const app = express();

app.use(cors());

app.use(express.json());

app.use("/candles", candleRoutes);
app.use("/orders", orderRoutes);

const PORT = 3001;

const server = http.createServer(app);

initWebSocket(server);

server.listen(PORT, async () => {
  console.log(`Backend Server : ${PORT}`);

  await startMarketSimulator();
});
