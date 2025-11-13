import express from 'express';
import { pool } from '../config/db.js';
import { authRequired } from '../middleware/auth.js';
import { snakeToCamelArray } from '../utils/caseUtils.js';

const router = express.Router();

router.get("/apprenticeships", authRequired, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        apprenticeship_id,
        name,
        branch_id
      FROM Apprenticeship
      ORDER BY name ASC;
    `);
    
    // Convert snake_case to camelCase before sending to frontend
    const camelCaseApprenticeships = snakeToCamelArray(result.rows);
    
    res.status(200).json({
      success: true,
      apprenticeships: camelCaseApprenticeships,
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
        branch_id,
        name
      FROM Branch
      ORDER BY name ASC;
    `);
    
    // Convert snake_case to camelCase before sending to frontend
    const camelCaseBranches = snakeToCamelArray(result.rows);
    
    res.status(200).json({
      success: true,
      branches: camelCaseBranches,
    });
  } catch (error) {
    console.error("GET /api/branches Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/locations", authRequired, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        location_id,
        name,
        address,
        city,
        plz
      FROM Location
      ORDER BY name ASC;
    `);
    
    // Convert snake_case to camelCase before sending to frontend
    const camelCaseLocations = snakeToCamelArray(result.rows);
    
    res.status(200).json({
      success: true,
      locations: camelCaseLocations,
    });
  } catch (error) {
    console.error("GET /api/locations Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/event-types", authRequired, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        et.template_id,
        et.title,
        et.description,
        et.location_id,
        et.registrations_required,
        et.starting_at,
        et.ending_at,
        et.multiple_sessions,
        l.name as location_name,
        l.address as location_address,
        l.city as location_city,
        l.plz as location_plz
      FROM Event_Type et
      LEFT JOIN Location l ON et.location_id = l.location_id
      ORDER BY et.title ASC;
    `);
    
    // Convert snake_case to camelCase before sending to frontend
    const camelCaseEventTypes = snakeToCamelArray(result.rows);
    
    res.status(200).json({
      success: true,
      eventTypes: camelCaseEventTypes,
    });
  } catch (error) {
    console.error("GET /api/event-types Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
