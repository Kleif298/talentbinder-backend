import express from 'express';
import { pool } from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { snakeToCamelObj } from '../utils/caseUtils.js';

const router = express.Router();

router.get("/apprenticeships", authRequired, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        apprenticeship_id as id,
        name,
        branch_id as "branchId"
      FROM Apprenticeship
      ORDER BY name ASC;
    `);
    res.status(200).json({
      success: true,
      apprenticeships: result.rows,
    });
  } catch (error) {
    console.error("GET /api/apprenticeships Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/branches", authRequired, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        branch_id as id,
        name
      FROM Branch
      ORDER BY name ASC;
    `);
    res.status(200).json({
      success: true,
      branches: result.rows,
    });
  } catch (error) {
    console.error("GET /api/branches Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
