import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const INTERVAL_OID = 1186;
pg.types.setTypeParser(INTERVAL_OID, (value) => value);

// Support both DB_URL (Render/DAL) and individual DB settings (development)
const poolConfig = process.env.DB_URL 
  ? {
      // Production: Use single connection string (Render, DAL)
      connectionString: process.env.DB_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      // Development: Use individual settings
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    };

const pool = new Pool({
  ...poolConfig,
  max: 20,                    // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,   // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return error if can't connect in 2 seconds
});

// Test connection on startup
pool.on('connect', () => {
  console.log('Connected to the database');
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
});

export { pool };