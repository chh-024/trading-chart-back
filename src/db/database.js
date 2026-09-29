import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

export default pool;

// import Database from "better-sqlite3";

// const db = new Database("market.db");

// db.exec(`
//   CREATE TABLE IF NOT EXISTS candles (
//     id INTEGER PRIMARY KEY AUTOINCREMENT,
//     market TEXT NOT NULL,
//     time INTEGER NOT NULL,
//     open REAL NOT NULL,
//     high REAL NOT NULL,
//     low REAL NOT NULL,
//     close REAL NOT NULL,

//     UNIQUE(market, time)
//   )
// `);

// export default db;
