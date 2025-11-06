import express from 'express';
import { pool } from '../config/db.js';
import { authRequired, checkAdmin } from '../middleware/auth.js';
import { auditLog } from '../middleware/logging.js';
import { snakeToCamelObj } from '../utils/caseUtils.js';

const router = express.Router();

router.get("/", authRequired, async (req, res) => {
    const { sort_by, status, search } = req.query; 

    // Debugging: log incoming cookies to verify browser sends the token
    try {
        console.log("[DEBUG] Incoming Request Headers Cookie:", req.headers.cookie);
        console.log("[DEBUG] Parsed req.cookies:", req.cookies);
    } catch (e) {
        console.error("[DEBUG] Error logging cookies:", e);
    }
    
    let query = `
        SELECT 
            c.candidate_id as id, 
            c.first_name, 
            c.last_name, 
            c.email, 
            c.candidate_status as status,
            c.created_at,
            a.name as apprenticeship,
            a.apprenticeship_id
        FROM 
            Candidate c
        LEFT JOIN 
            Candidate_Apprenticeship ca ON c.candidate_id = ca.candidate_id
        LEFT JOIN 
            Apprenticeship a ON ca.apprenticeship_id = a.apprenticeship_id
    `;
    const values = [];
    const conditions = [];

    if (search) {
        const searchPattern = `%${search}%`;
        conditions.push(`(LOWER(c.first_name) LIKE LOWER($${values.length + 1}) OR LOWER(c.last_name) LIKE LOWER($${values.length + 2}) OR LOWER(c.email) LIKE LOWER($${values.length + 3}))`);
        values.push(searchPattern, searchPattern, searchPattern);
    }

    if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
    }

    let orderBy = "c.created_at DESC";
    if (sort_by) {
        switch (sort_by) {
            case "name_asc":
                orderBy = "c.last_name ASC, c.first_name ASC";
                break;
            case "status":
                orderBy = "c.candidate_status ASC, c.created_at DESC";
                break;
            case "created_at_desc":
            default:
                orderBy = "c.created_at DESC";
                break;
        }
    }
    query += ` ORDER BY ${orderBy};`;

    try {
        const result = await pool.query(query, values);

        // Map DB rows (snake_case) to camelCase and merge duplicate candidate rows
        const candidatesMap = new Map();
        result.rows.forEach(row => {
            const r = snakeToCamelObj(row);
            if (!candidatesMap.has(r.id)) {
                candidatesMap.set(r.id, {
                    id: r.id,
                    firstName: r.firstName,
                    lastName: r.lastName,
                    email: r.email,
                    status: r.status,
                    createdAt: r.createdAt,
                    apprenticeships: []
                });
            }

            if (r.apprenticeshipId) {
                candidatesMap.get(r.id).apprenticeships.push({ id: r.apprenticeshipId, name: r.apprenticeship });
            }
        });

        const candidates = Array.from(candidatesMap.values());
        res.status(200).json({ success: true, candidates });
    } catch (error) {
        console.error("GET /api/candidates Error:", error);
        res.status(500).json({ success: false, message: "Fehler beim Abrufen der Kandidaten." });
    }
});

router.post("/", authRequired, checkAdmin, async (req, res) => {
    const { firstName, lastName, email, status, apprenticeshipId, apprenticeshipIds } = req.body || {};
    console.log("[DEBUG] POST /api/candidates body.apprenticeshipIds:", apprenticeshipIds, " apprenticeshipId:", apprenticeshipId);
    const createdByAccountId = req.user.id;

    if (!firstName || !lastName) {
        return res.status(400).json({ success: false, message: "Vor- und Nachname sind erforderlich." });
    }

    if (!apprenticeshipIds || !Array.isArray(apprenticeshipIds) || apprenticeshipIds.length === 0) {
        return res.status(400).json({ success: false, message: "Mindestens ein Lehrberuf ist erforderlich." });
    }

    try {
        await pool.query('BEGIN');

        const candidateResult = await pool.query(
            `INSERT INTO Candidate (first_name, last_name, email, candidate_status, created_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING candidate_id as id, email, first_name;`,
            [firstName, lastName, email || null, status || 'Normal', createdByAccountId]
        );
        const newCandidate = candidateResult.rows[0];

        // Persist one or many apprenticeships if provided
        if (Array.isArray(apprenticeshipIds) && apprenticeshipIds.length > 0) {
            for (const appId of apprenticeshipIds) {
                await pool.query(
                    `INSERT INTO Candidate_Apprenticeship (candidate_id, apprenticeship_id)
                     VALUES ($1, $2);`,
                    [newCandidate.id, appId]
                );
            }
        } else if (apprenticeshipId) {
            await pool.query(
                `INSERT INTO Candidate_Apprenticeship (candidate_id, apprenticeship_id)
                 VALUES ($1, $2);`,
                [newCandidate.id, apprenticeshipId]
            );
        }

        await pool.query('COMMIT');

        await auditLog('CREATE', 'candidate', newCandidate.id, createdByAccountId, {
          firstName,
          lastName,
          email,
          ip: req.ip
        });

        res.status(201).json({ 
            success: true, 
            message: "Kandidat erfolgreich erstellt.", 
            candidate: newCandidate 
        });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("POST /api/candidates Error:", err);
        if (err.code === "23505") { 
            return res.status(409).json({ success: false, message: "E-Mail-Adresse ist bereits registriert." });
        }
        res.status(500).json({ success: false, message: "Serverfehler beim Erstellen des Kandidaten." });
    }
});

router.patch("/:id", authRequired, checkAdmin, async (req, res) => {
    const { id } = req.params;
    const { firstName, lastName, email, status, apprenticeshipId, apprenticeshipIds } = req.body || {};
    console.log(`[DEBUG] PATCH /api/candidates/${id} body.apprenticeshipIds:`, apprenticeshipIds, " apprenticeshipId:", apprenticeshipId);

    const fields = [];
    const values = [];
    let queryIndex = 1;

    if (firstName) {
        fields.push(`first_name = $${queryIndex++}`);
        values.push(firstName);
    }
    if (lastName) {
        fields.push(`last_name = $${queryIndex++}`);
        values.push(lastName);
    }
    if (email) {
        fields.push(`email = $${queryIndex++}`);
        values.push(email);
    }
    if (status) { 
        fields.push(`candidate_status = $${queryIndex++}`);
        values.push(status);
    }
    // apprenticeship associations are handled separately below

    if (fields.length === 0) {
        return res.status(400).json({ success: false, message: "Keine Felder zum Aktualisieren bereitgestellt." });
    }

    values.push(id);
    
    try {
        const result = await pool.query(
            `UPDATE candidate SET ${fields.join(", ")} WHERE candidate_id = $${queryIndex} RETURNING candidate_id as id;`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Kandidat nicht gefunden." });
        }
        
        await auditLog('UPDATE', 'candidate', parseInt(id), req.user.id, {
          fields: Object.keys(req.body),
          ip: req.ip
        });
        
        // If apprenticeshipIds provided, replace existing Candidate_Apprenticeship rows
        if (Array.isArray(apprenticeshipIds)) {
            // remove existing associations
            await pool.query(`DELETE FROM Candidate_Apprenticeship WHERE candidate_id = $1;`, [id]);
            // insert new ones
            for (const appId of apprenticeshipIds) {
                await pool.query(
                    `INSERT INTO Candidate_Apprenticeship (candidate_id, apprenticeship_id) VALUES ($1, $2);`,
                    [id, appId]
                );
            }
        } else if (apprenticeshipId !== undefined) {
            // single id provided: replace existing with single association
            await pool.query(`DELETE FROM Candidate_Apprenticeship WHERE candidate_id = $1;`, [id]);
            if (apprenticeshipId) {
                await pool.query(
                    `INSERT INTO Candidate_Apprenticeship (candidate_id, apprenticeship_id) VALUES ($1, $2);`,
                    [id, apprenticeshipId]
                );
            }
        }

        res.status(200).json({ success: true, message: "Kandidat erfolgreich aktualisiert." });
    } catch (err) {
        console.error(`PATCH /api/candidates/${id} Error:`, err);
        if (err.code === "23505") {
            return res.status(409).json({ success: false, message: "E-Mail-Adresse ist bereits registriert." });
        }
        res.status(500).json({ success: false, message: "Serverfehler beim Aktualisieren des Kandidaten." });
    }
});

router.delete("/:id", authRequired, checkAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            "DELETE FROM candidate WHERE candidate_id = $1 RETURNING candidate_id as id;",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Kandidat nicht gefunden." });
        }

        await auditLog('DELETE', 'candidate', parseInt(id), req.user.id, {
          ip: req.ip
        });

        res.status(200).json({ success: true, message: "Kandidat erfolgreich gelöscht." });
    } catch (err) {
        console.error(`DELETE /api/candidates/${id} Error:`, err);
        res.status(500).json({ success: false, message: "Serverfehler beim Löschen des Kandidaten." });
    }
});

export default router;