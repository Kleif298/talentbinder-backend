import express from 'express';
import { pool } from '../config/db.js';
import { authRequired, checkAdmin } from '../middleware/auth.js';
import { snakeToCamelObj } from '../utils/caseUtils.js';

const router = express.Router();

router.get('/', authRequired, checkAdmin, async (req, res) => {
  const { page = 1, limit = 50, action, entityType, userId, startDate, endDate } = req.query;
  
  const offset = (page - 1) * limit;
  
  try {
    let query = `
      SELECT 
        al.audit_id as "auditId",
        al.action,
        al.table_name as "entityType",
        al.record_id as "entityId",
        al.account_id as "userId",
        al.new_data as "details",
        al.timestamp as "createdAt",
        CONCAT(a.first_name, ' ', a.last_name) as "userName"
      FROM Audit_Log al
      LEFT JOIN Account a ON al.account_id = a.account_id
    `;
    
    const conditions = [];
    const values = [];
    let paramCount = 1;
    
    if (action) {
      conditions.push(`al.action = $${paramCount++}`);
      values.push(action);
    }
    
    if (entityType) {
      conditions.push(`al.table_name = $${paramCount++}`);
      values.push(entityType);
    }
    
    if (userId) {
      conditions.push(`al.account_id = $${paramCount++}`);
      values.push(userId);
    }
    
    if (startDate) {
      conditions.push(`al.timestamp >= $${paramCount++}`);
      values.push(startDate);
    }
    
    if (endDate) {
      conditions.push(`al.created_at <= $${paramCount++}`);
      values.push(endDate);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ` ORDER BY al.timestamp DESC LIMIT $${paramCount++} OFFSET $${paramCount}`;
    values.push(limit, offset);
    
    const result = await pool.query(query, values);
    
    const countQuery = `SELECT COUNT(*) FROM Audit_Log al` + 
      (conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '');
    const countResult = await pool.query(countQuery, values.slice(0, -2));
    
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);
    
    res.json({
      logs: result.rows,
      total,
      page: parseInt(page),
      totalPages
    });
  } catch (error) {
    console.error('GET /api/logging Error:', error);
    res.status(500).json({ success: false, message: 'Fehler beim Abrufen der Logs' });
  }
});

router.get('/stats', authRequired, checkAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT action, COUNT(*) as count
      FROM Audit_Log
      GROUP BY action
      ORDER BY count DESC
    `);
    
    res.json({ stats: result.rows });
  } catch (error) {
    console.error('GET /api/logging/stats Error:', error);
    res.status(500).json({ success: false, message: 'Fehler beim Abrufen der Statistiken' });
  }
});

router.get('/user/:userId', authRequired, checkAdmin, async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  
  try {
    const result = await pool.query(`
      SELECT 
        al.audit_id as "auditId",
        al.action,
        al.table_name as "entityType",
        al.record_id as "entityId",
        al.account_id as "userId",
        al.new_data as "details",
        al.timestamp as "createdAt",
        CONCAT(a.first_name, ' ', a.last_name) as "userName"
      FROM Audit_Log al
      LEFT JOIN Account a ON al.account_id = a.account_id
      WHERE al.account_id = $1
      ORDER BY al.timestamp DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);
    
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM Audit_Log WHERE account_id = $1`,
      [userId]
    );
    
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);
    
    res.json({
      logs: result.rows,
      total,
      page: parseInt(page),
      totalPages
    });
  } catch (error) {
    console.error('GET /api/logging/user/:userId Error:', error);
    res.status(500).json({ success: false, message: 'Fehler beim Abrufen der User-Logs' });
  }
});

router.get('/entity/:entityType/:entityId', authRequired, checkAdmin, async (req, res) => {
  const { entityType, entityId } = req.params;
  const { page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  
  try {
    const result = await pool.query(`
      SELECT 
        al.audit_id as "auditId",
        al.action,
        al.table_name as "entityType",
        al.record_id as "entityId",
        al.account_id as "userId",
        al.new_data as "details",
        al.timestamp as "createdAt",
        CONCAT(a.first_name, ' ', a.last_name) as "userName"
      FROM Audit_Log al
      LEFT JOIN Account a ON al.account_id = a.account_id
      WHERE al.table_name = $1 AND al.record_id = $2
      ORDER BY al.timestamp DESC
      LIMIT $3 OFFSET $4
    `, [entityType, entityId, limit, offset]);
    
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM Audit_Log WHERE table_name = $1 AND record_id = $2`,
      [entityType, entityId]
    );
    
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);
    
    res.json({
      logs: result.rows,
      total,
      page: parseInt(page),
      totalPages
    });
  } catch (error) {
    console.error('GET /api/logging/entity/:entityType/:entityId Error:', error);
    res.status(500).json({ success: false, message: 'Fehler beim Abrufen der Entity-Logs' });
  }
});

export default router;
