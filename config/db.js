import pg from "pg";

const { Pool } = pg;

const INTERVAL_OID = 1186;
pg.types.setTypeParser(INTERVAL_OID, (value) => value);

let poolInstance = null;

// Lazy initialization - pool is created on first access
function getPool() {
  if (poolInstance) {
    return poolInstance;
  }

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

  // Debug logging
  console.log('🔧 Database Configuration:', {
    mode: process.env.DB_URL ? 'Connection String' : 'Individual Settings',
    host: poolConfig.host || 'from connection string',
    port: poolConfig.port || 'from connection string',
    user: poolConfig.user || 'from connection string',
    database: poolConfig.database || 'from connection string',
    hasPassword: !!poolConfig.password || !!poolConfig.connectionString,
    passwordLength: poolConfig.password?.length || 'N/A',
    passwordType: typeof poolConfig.password,
  });

  poolInstance = new Pool({
    ...poolConfig,
    max: 20,                    // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,   // Close idle clients after 30 seconds
    connectionTimeoutMillis: 2000, // Return error if can't connect in 2 seconds
  });

  // Test connection on startup
  poolInstance.on('connect', () => {
    console.log('✅ Connected to the database');
  });

  poolInstance.on('error', (err) => {
    console.error('❌ Unexpected database error:', err);
  });

  return poolInstance;
}

// Export a Proxy that creates the pool on first property access
export const pool = new Proxy({}, {
  get(target, prop) {
    return getPool()[prop];
  }
});