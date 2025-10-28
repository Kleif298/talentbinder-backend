import client from '../config/db.js';

export function requestLogger(req, res, next) {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    const ms = Date.now() - start;
    console.log(`Response ${req.method} ${req.path} (${ms}ms)`);
    return originalJson(data);
  };
  
  next();
}

export async function auditLog(action, entityType, entityId, userId, details = null) {
  try {
    await client.query(
      `INSERT INTO Audit_Log (action, entity_type, entity_id, user_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
      [action, entityType, entityId, userId, details ? JSON.stringify(details) : null]
    );
  } catch (error) {
    console.error('Audit Log Error:', error);
  }
}

export default { requestLogger, auditLog };
