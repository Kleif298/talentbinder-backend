import express from 'express';
import { pool } from '../config/db.js';
import { authRequired, checkAdmin } from '../middleware/auth.js';
import { auditLog } from '../middleware/logging.js';
import { snakeToCamelObj } from '../utils/caseUtils.js';

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        e.event_id as id,
        e.title,
        e.description,
        e.starting_at as "startingAt",
        e.duration,
        e.location,
        e.registration_required as "registrationRequired",
        e.invitations_sent as "invitationsSent",
        e.invitations_sending_at as "invitationsSendingAt",
        e.registrations_closing_at as "registrationsClosingAt",
        e.created_at as "createdAt",
        e.created_by as "createdByAccountId",
        a.first_name as "createdByFirstName",
        a.last_name as "createdByLastName"
      FROM Event e
      JOIN Account a ON e.created_by = a.account_id
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
  const { title, description, startingAt, duration, invitationsSendingAt, registrationsClosingAt } = req.body || {};
  console.log("POST /api/events request body:", req.body);

  if (!title || !startingAt) {
    return res.status(400).json({ success: false, message: "title and startingAt are required" });
  }

  const createdByAccountId = req.user.id;

  try {
    const result = await pool.query(
      `INSERT INTO Event (title, description, starting_at, duration, invitations_sending_at, registrations_closing_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING event_id as id, title, duration, invitations_sending_at as "invitationsSendingAt", registrations_closing_at as "registrationsClosingAt";`,
      [title, description || null, startingAt, duration || null, invitationsSendingAt || null, registrationsClosingAt || null, createdByAccountId]
    );
    if (!result.rows || result.rows.length === 0) {
      return res.status(500).json({ success: false, message: "Event wurde nicht gespeichert" });
    }
    
    const newEvent = result.rows[0];
    
    await auditLog('CREATE', 'event', newEvent.id, createdByAccountId, {
      title,
      startingAt,
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

    const isAdmin = req.user.role === 'berufsbilder' && req.user.isAdmin === true;
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
  const { title, description, startingAt, duration, invitationsSendingAt, registrationsClosingAt } = req.body || {};

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

    const result = await pool.query(
      `UPDATE Event
       SET title = $1, description = $2, starting_at = $3, duration = $4, 
           invitations_sending_at = $5, registrations_closing_at = $6
       WHERE event_id = $7
       RETURNING event_id as id, title, duration, 
                invitations_sending_at as "invitationsSendingAt", 
                registrations_closing_at as "registrationsClosingAt";`,
      [title, description || null, startingAt, duration || null, 
       invitationsSendingAt || null, registrationsClosingAt || null, eventId]
    );
    
    const updatedEvent = result.rows[0];
    
    await auditLog('UPDATE', 'event', parseInt(eventId), req.user.id, {
      title,
      startingAt,
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
        a.account_id as id,
        a.first_name,
        a.last_name,
        a.email
      FROM Account a
      JOIN Event_Recruiter er ON a.account_id = er.recruiter_id
      WHERE er.event_id = $1
    `, [eventId]);

    res.json({
      success: true,
      recruiters: result.rows
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
        c.candidate_status as status,
        er.registered_at
      FROM Event_Registration er
      JOIN Candidate c ON er.candidate_id = c.candidate_id
      WHERE er.event_id = $1
      ORDER BY er.registered_at DESC
    `, [eventId]);

    res.json({
      success: true,
      count: result.rows.length,
      registrations: result.rows
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

export default router;
