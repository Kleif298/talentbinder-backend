import express from 'express';
import { pool } from '../config/db.js';
import { authRequired, checkAdmin } from '../middleware/auth.js';
import { auditLog } from '../middleware/logging.js';
import { snakeToCamelObj, snakeToCamelArray } from '../utils/caseUtils.js';

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        e.event_id as id,
        e.title,
        e.description,
        e.branch_id as "branchId",
        e.template_id as "templateId",
        e.location_id as "locationId",
        e.registration_required as "registrationRequired",
        e.invitations_sent as "invitationsSent",
        e.invitations_sending_at as "invitationsSendingAt",
        e.registrations_closing_at as "registrationsClosingAt",
        e.created_at as "createdAt",
        e.created_by as "createdByAccountId",
        a.first_name as "createdByFirstName",
        a.last_name as "createdByLastName",
        es.date_at as "dateAt",
        es.starting_at as "startingAt",
        es.ending_at as "endingAt",
        l.name as "locationName",
        l.address as "locationAddress",
        l.city as "locationCity",
        l.plz as "locationPlz"
      FROM Event e
      JOIN Account a ON e.created_by = a.account_id
      LEFT JOIN Event_Session es ON e.event_id = es.event_id
      LEFT JOIN Location l ON e.location_id = l.location_id
      ORDER BY e.created_at DESC;
    `);
    res.status(200).json({
      success: true,
      events: result.rows,
    });
  } catch (error) {
    console.error("GET /api/events Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/", authRequired, async (req, res) => {
  const { title, description, branchId, templateId, locationId, registrationRequired, dateAt, startingAt, endingAt, invitationsSendingAt, registrationsClosingAt } = req.body || {};
  console.log("POST /api/events request body:", req.body);

  if (!title || !locationId || !dateAt || !startingAt) {
    return res.status(400).json({ success: false, message: "title, locationId, dateAt, and startingAt are required" });
  }

  // If endingAt is not provided, calculate it as startingAt + 2 hours
  const finalEndingAt = endingAt || (() => {
    const [hours, minutes] = startingAt.split(':');
    const totalMinutes = parseInt(hours) * 60 + parseInt(minutes) + 120;
    const newHours = Math.floor(totalMinutes / 60);
    const newMinutes = totalMinutes % 60;
    return `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
  })();

  const createdByAccountId = req.user.id;

  try {
    // Create the Event (metadata)
    const eventResult = await pool.query(
      `INSERT INTO Event (title, description, branch_id, template_id, location_id, registration_required, invitations_sending_at, registrations_closing_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING event_id as id, title;`,
      [title, description || null, branchId || null, templateId || null, locationId, registrationRequired || false, invitationsSendingAt || null, registrationsClosingAt || null, createdByAccountId]
    );

    if (!eventResult.rows || eventResult.rows.length === 0) {
      return res.status(500).json({ success: false, message: "Event wurde nicht gespeichert" });
    }

    const eventId = eventResult.rows[0].id;

    // Create the Event_Session with date and time data
    const sessionResult = await pool.query(
      `INSERT INTO Event_Session (event_id, date_at, starting_at, ending_at)
       VALUES ($1, $2, $3, $4)
       RETURNING session_id;`,
      [eventId, dateAt, startingAt, finalEndingAt]
    );

    if (!sessionResult.rows || sessionResult.rows.length === 0) {
      // Rollback the event creation if session creation fails
      await pool.query("DELETE FROM Event WHERE event_id = $1", [eventId]);
      return res.status(500).json({ success: false, message: "Event-Session konnte nicht erstellt werden" });
    }

    const newEvent = {
      id: eventResult.rows[0].id,
      title: eventResult.rows[0].title,
      dateAt,
      startingAt,
      endingAt: finalEndingAt,
      invitationsSendingAt,
      registrationsClosingAt,
    };
    
    await auditLog('CREATE', 'event', eventId, createdByAccountId, {
      title,
      dateAt,
      startingAt,
      endingAt: finalEndingAt,
      ip: req.ip
    });
    
    res.status(201).json({ success: true, event: newEvent });
  } catch (error) {
    console.error("POST /api/events Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete("/:eventId", authRequired, async (req, res) => {
  const { eventId } = req.params;
  console.log("Delete Event request for ID:", eventId);

  try {
    const checkResult = await pool.query(
      "SELECT created_by, title FROM Event WHERE event_id = $1",
      [eventId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Event nicht gefunden" });
    }
    
    const eventData = checkResult.rows[0];
    const eventCreatorId = eventData.created_by;
    const eventTitle = eventData.title;

    const isAdmin = req.user.isAdmin;
    const isCreator = eventCreatorId === req.user.id;
    
    if (!isAdmin && !isCreator) {
      return res.status(403).json({ 
        success: false, 
        message: "Zugriff verweigert. Sie können nur Ihre eigenen Events löschen." 
      });
    }

    await pool.query("DELETE FROM Event WHERE event_id = $1", [eventId]);
    
    await auditLog('DELETE', 'event', parseInt(eventId), req.user.id, {
      title: eventTitle,
      ip: req.ip
    });
    
    res.status(200).json({ 
      success: true, 
      message: `Event "${eventTitle}" wurde erfolgreich gelöscht.` 
    });
  } catch (error) {
    console.error("DELETE /api/events/:id Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put("/:eventId", authRequired, async (req, res) => {
  const { eventId } = req.params;
  const { title, description, branchId, templateId, locationId, registrationRequired, dateAt, startingAt, endingAt, invitationsSendingAt, registrationsClosingAt } = req.body || {};

  try {
    const checkResult = await pool.query(
      "SELECT created_by FROM Event WHERE event_id = $1",
      [eventId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Event nicht gefunden" });
    }
    
    const eventCreatorId = checkResult.rows[0].created_by;
    const isAdmin = req.user.role === 'berufsbilder' && req.user.isAdmin === true;
    const isCreator = eventCreatorId === req.user.id;
    
    if (!isAdmin && !isCreator) {
      return res.status(403).json({ 
        success: false, 
        message: "Zugriff verweigert. Sie können nur Ihre eigenen Events bearbeiten." 
      });
    }

    // Update Event table (metadata)
    const eventUpdate = await pool.query(
      `UPDATE Event
       SET title = COALESCE($1, title), 
           description = COALESCE($2, description),
           branch_id = COALESCE($3, branch_id),
           template_id = COALESCE($4, template_id),
           location_id = COALESCE($5, location_id),
           registration_required = COALESCE($6, registration_required),
           invitations_sending_at = COALESCE($7, invitations_sending_at), 
           registrations_closing_at = COALESCE($8, registrations_closing_at)
       WHERE event_id = $9
       RETURNING event_id as id, title;`,
      [title || null, description || null, branchId || null, templateId || null, locationId || null, registrationRequired || null, invitationsSendingAt || null, registrationsClosingAt || null, eventId]
    );

    // Update Event_Session table (date and timing data)
    if (dateAt || startingAt || endingAt) {
      await pool.query(
        `UPDATE Event_Session
         SET date_at = COALESCE($1, date_at),
             starting_at = COALESCE($2, starting_at),
             ending_at = COALESCE($3, ending_at)
         WHERE event_id = $4;`,
        [dateAt || null, startingAt || null, endingAt || null, eventId]
      );
    }

    const updatedEvent = {
      id: eventUpdate.rows[0]?.id,
      title: eventUpdate.rows[0]?.title,
      dateAt,
      startingAt,
      endingAt,
      invitationsSendingAt,
      registrationsClosingAt,
    };
    
    await auditLog('UPDATE', 'event', parseInt(eventId), req.user.id, {
      title,
      dateAt,
      startingAt,
      endingAt,
      ip: req.ip
    });
    
    res.status(200).json({ success: true, event: updatedEvent });
  } catch (error) {
    console.error("PUT /api/events/:id Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/:eventId/recruiters", authRequired, async (req, res) => {
  const { eventId } = req.params;

  try {
    const result = await pool.query(`
      SELECT 
        a.account_id,
        a.first_name,
        a.last_name,
        a.email
      FROM Account a
      JOIN Event_Recruiter er ON a.account_id = er.recruiter_id
      WHERE er.event_id = $1
    `, [eventId]);

    // Convert snake_case to camelCase before sending to frontend
    const camelCaseRecruiters = snakeToCamelArray(result.rows);

    res.json({
      success: true,
      recruiters: camelCaseRecruiters
    });
  } catch (error) {
    console.error("Fehler beim Abrufen der Recruiter:", error);
    res.status(500).json({
      success: false,
      message: "Fehler beim Abrufen der Recruiter"
    });
  }
});

router.post("/:eventId/recruiters", authRequired, async (req, res) => {
  const { eventId } = req.params;
  const { recruiter_id } = req.body;

  if (!recruiter_id) {
    return res.status(400).json({
      success: false,
      message: "recruiter_id ist erforderlich"
    });
  }

  try {
    const existsResult = await pool.query(`
      SELECT 1 FROM Event_Recruiter 
      WHERE event_id = $1 AND recruiter_id = $2
    `, [eventId, recruiter_id]);

    if (existsResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Dieser Recruiter ist bereits dem Event zugewiesen"
      });
    }

    await pool.query(`
      INSERT INTO Event_Recruiter (event_id, recruiter_id)
      VALUES ($1, $2)
    `, [eventId, recruiter_id]);

    res.json({
      success: true,
      message: "Recruiter erfolgreich hinzugefügt"
    });
  } catch (error) {
    console.error("Fehler beim Hinzufügen des Recruiters:", error);
    res.status(500).json({
      success: false,
      message: "Fehler beim Hinzufügen des Recruiters"
    });
  }
});

router.delete("/:eventId/recruiters/:recruiterId", authRequired, async (req, res) => {
  const { eventId, recruiterId } = req.params;

  try {
    const result = await pool.query(`
      DELETE FROM Event_Recruiter 
      WHERE event_id = $1 AND recruiter_id = $2
    `, [eventId, recruiterId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Recruiter-Zuordnung nicht gefunden"
      });
    }

    res.json({
      success: true,
      message: "Recruiter erfolgreich entfernt"
    });
  } catch (error) {
    console.error("Fehler beim Entfernen des Recruiters:", error);
    res.status(500).json({
      success: false,
      message: "Fehler beim Entfernen des Recruiters"
    });
  }
});

router.get("/:eventId/registrations", authRequired, async (req, res) => {
  const { eventId } = req.params;

  try {
    const result = await pool.query(`
      SELECT 
        er.registration_id,
        er.candidate_id,
        c.first_name,
        c.last_name,
        c.email,
        c.candidate_status,
        er.registered_at
      FROM Event_Registration er
      JOIN Candidate c ON er.candidate_id = c.candidate_id
      WHERE er.event_id = $1
      ORDER BY er.registered_at DESC
    `, [eventId]);

    // Convert snake_case to camelCase before sending to frontend
    const camelCaseRegistrations = snakeToCamelArray(result.rows);

    res.json({
      success: true,
      count: camelCaseRegistrations.length,
      registrations: camelCaseRegistrations
    });
  } catch (error) {
    console.error("Fehler beim Abrufen der Registrierungen:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

router.post("/:eventId/registrations", authRequired, async (req, res) => {
  const { eventId } = req.params;
  const { candidate_id } = req.body;

  if (!candidate_id) {
    return res.status(400).json({
      success: false,
      message: "candidate_id ist erforderlich"
    });
  }

  try {
    const candidateCheck = await pool.query(
      "SELECT candidate_id FROM Candidate WHERE candidate_id = $1",
      [candidate_id]
    );

    if (candidateCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Kandidat nicht gefunden"
      });
    }

    const result = await pool.query(
      `INSERT INTO Event_Registration (event_id, candidate_id)
       VALUES ($1, $2)
       RETURNING registration_id, candidate_id, registered_at`,
      [eventId, candidate_id]
    );

    res.status(201).json({
      success: true,
      message: "Kandidat erfolgreich registriert",
      registration: result.rows[0]
    });
  } catch (error) {
    console.error("Fehler beim Registrieren des Kandidaten:", error);
    
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Kandidat ist bereits für dieses Event registriert"
      });
    }

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

router.delete("/:eventId/registrations/:candidateId", authRequired, checkAdmin, async (req, res) => {
  const { eventId, candidateId } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM Event_Registration 
       WHERE event_id = $1 AND candidate_id = $2
       RETURNING registration_id`,
      [eventId, candidateId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Registrierung nicht gefunden"
      });
    }

    res.json({
      success: true,
      message: "Registrierung erfolgreich entfernt"
    });
  } catch (error) {
    console.error("Fehler beim Entfernen der Registrierung:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * POST /:eventId/attendance - Create attendance report for a candidate at an event
 * Saves feedback (status, attendance, comment) about a candidate after an event
 * Multiple users can create reports for the same candidate, but each user can only have one report per candidate
 */
router.post("/:eventId/attendance", authRequired, async (req, res) => {
  const { eventId } = req.params;
  const { candidate_id, status, attendance, comment } = req.body;
  const accountId = req.user.id;

  if (!candidate_id || !status || !attendance) {
    return res.status(400).json({
      success: false,
      message: "candidate_id, status, and attendance are required"
    });
  }

  try {
    // Check if this user already has a report for this candidate at this event
    const existsResult = await pool.query(
      `SELECT attendance_id FROM Event_Attendance 
       WHERE event_id = $1 AND candidate_id = $2 AND created_by = $3`,
      [eventId, candidate_id, accountId]
    );

    if (existsResult.rows.length > 0) {
      // User already has a report - return error to prevent duplicates
      return res.status(409).json({
        success: false,
        message: "Sie haben bereits einen Report für diesen Kandidaten erstellt. Bitte bearbeiten Sie stattdessen Ihren existierenden Report."
      });
    }

    // Insert new record
    const result = await pool.query(
      `INSERT INTO Event_Attendance (event_id, candidate_id, attendance, status, comment, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING 
         attendance_id,
         event_id,
         candidate_id,
         attendance,
         status,
         comment,
         created_at,
         created_by`,
      [eventId, candidate_id, attendance, status, comment || null, accountId]
    );

    const report = snakeToCamelObj(result.rows[0]);

    res.status(201).json({
      success: true,
      message: "Attendance report created successfully",
      report
    });
  } catch (error) {
    console.error("Fehler beim Speichern des Attendance Reports:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /:eventId/attendance - Get all attendance reports for an event
 * Returns all reports for all candidates with creator information
 */
router.get("/:eventId/attendance", authRequired, async (req, res) => {
  const { eventId } = req.params;

  try {
    const result = await pool.query(`
      SELECT 
        ea.attendance_id,
        ea.event_id,
        ea.candidate_id,
        ea.attendance,
        ea.status,
        ea.comment,
        ea.created_at,
        ea.created_by,
        c.first_name as candidate_first_name,
        c.last_name as candidate_last_name,
        c.email as candidate_email,
        a.first_name as creator_first_name,
        a.last_name as creator_last_name,
        a.email as creator_email
      FROM Event_Attendance ea
      JOIN Candidate c ON ea.candidate_id = c.candidate_id
      JOIN Account a ON ea.created_by = a.account_id
      WHERE ea.event_id = $1
      ORDER BY ea.candidate_id ASC, ea.created_at DESC
    `, [eventId]);

    // Convert snake_case to camelCase
    const camelCaseReports = snakeToCamelArray(result.rows);

    res.json({
      success: true,
      count: camelCaseReports.length,
      reports: camelCaseReports
    });
  } catch (error) {
    console.error("Fehler beim Abrufen der Attendance Reports:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * GET /:eventId/attendance/:candidateId - Get all reports for a specific candidate at an event
 * Returns all reports from all users for this candidate
 */
router.get("/:eventId/attendance/:candidateId", authRequired, async (req, res) => {
  const { eventId, candidateId } = req.params;

  try {
    const result = await pool.query(`
      SELECT 
        ea.attendance_id,
        ea.event_id,
        ea.candidate_id,
        ea.attendance,
        ea.status,
        ea.comment,
        ea.created_at,
        ea.created_by,
        a.first_name as creator_first_name,
        a.last_name as creator_last_name,
        a.email as creator_email
      FROM Event_Attendance ea
      JOIN Account a ON ea.created_by = a.account_id
      WHERE ea.event_id = $1 AND ea.candidate_id = $2
      ORDER BY ea.created_at DESC
    `, [eventId, candidateId]);

    // Convert snake_case to camelCase
    const camelCaseReports = snakeToCamelArray(result.rows);

    res.json({
      success: true,
      count: camelCaseReports.length,
      reports: camelCaseReports
    });
  } catch (error) {
    console.error("Fehler beim Abrufen der Candidate Reports:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * PUT /:eventId/attendance/:candidateId - Update your own attendance report for a candidate
 * You can only edit reports that you created
 */
router.put("/:eventId/attendance/:candidateId", authRequired, async (req, res) => {
  const { eventId, candidateId } = req.params;
  const { status, attendance, comment } = req.body;
  const accountId = req.user.id;

  if (!status || !attendance) {
    return res.status(400).json({
      success: false,
      message: "status and attendance are required"
    });
  }

  try {
    // Check if user owns this report
    const ownershipCheck = await pool.query(
      `SELECT attendance_id FROM Event_Attendance 
       WHERE event_id = $1 AND candidate_id = $2 AND created_by = $3`,
      [eventId, candidateId, accountId]
    );

    if (ownershipCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Sie können nur Ihre eigenen Reports bearbeiten"
      });
    }

    const result = await pool.query(
      `UPDATE Event_Attendance 
       SET attendance = $1, status = $2, comment = $3, created_at = NOW()
       WHERE event_id = $4 AND candidate_id = $5 AND created_by = $6
       RETURNING 
         attendance_id,
         event_id,
         candidate_id,
         attendance,
         status,
         comment,
         created_at,
         created_by`,
      [attendance, status, comment || null, eventId, candidateId, accountId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Report nicht gefunden"
      });
    }

    const report = snakeToCamelObj(result.rows[0]);

    res.json({
      success: true,
      message: "Report erfolgreich aktualisiert",
      report
    });
  } catch (error) {
    console.error("Fehler beim Aktualisieren des Attendance Reports:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * DELETE /:eventId/attendance/:candidateId - Delete your own attendance report
 * You can only delete reports that you created
 */
router.delete("/:eventId/attendance/:candidateId", authRequired, async (req, res) => {
  const { eventId, candidateId } = req.params;
  const accountId = req.user.id;

  try {
    const result = await pool.query(
      `DELETE FROM Event_Attendance 
       WHERE event_id = $1 AND candidate_id = $2 AND created_by = $3
       RETURNING attendance_id`,
      [eventId, candidateId, accountId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Sie können nur Ihre eigenen Reports löschen"
      });
    }

    res.json({
      success: true,
      message: "Report erfolgreich gelöscht"
    });
  } catch (error) {
    console.error("Fehler beim Löschen des Attendance Reports:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

export default router;
