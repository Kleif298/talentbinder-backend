import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Client } = pg;

const INTERVAL_OID = 1186;
pg.types.setTypeParser(INTERVAL_OID, (value) => value);

const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

client
  .connect()
  .then(() => console.log("Connected to the database"))
  .catch((err) => console.error("Database connection error", err.stack));

export default client;