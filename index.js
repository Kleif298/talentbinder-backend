import express from "express";
import cors from "cors";
import pkg from "pg";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import pg from "pg"; // Import the full pg object

dotenv.config();

const { Client } = pg;
const app = express();

// --- NEW: Add a custom type parser for PostgreSQL intervals ---
// The 'pg' library parses interval types into a complex object.
// This parser overrides that behavior to return a simple string like "HH:MI:SS".
const INTERVAL_OID = 1186;
pg.types.setTypeParser(INTERVAL_OID, (value) => {
  return value; // The raw value is already a string in the desired format
});

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  const startTime = Date.now();
  
  console.log(`\n📥 [${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log(`   Body:`, req.body);

  const originalJson = res.json;
  res.json = function (data) {
    const duration = Date.now() - startTime;
    console.log(`📤 Response (${duration}ms):`, data);
    return originalJson.call(this, data);
  };

  next();
});

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
  .catch((err) => console.error("Connection error", err.stack));


function authRequired(req, res, next) {
    if (!req.cookies || !req.cookies.token) {
        return res.status(401).json({ success: false, message: "Authentifizierung erforderlich." });
    }
    const token = req.cookies.token;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: "Ungültiger oder abgelaufener Token." });
    }
}

function checkAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'berufsbilder' || req.user.isAdmin !== true) {
        return res.status(403).json({ success: false, message: "Zugriff verweigert. Nur Administratoren dürfen diese Aktion durchführen." });
    }
    next();
}

app.get("/api/data", async (req, res) => {
  res.json({ message: "Backend ist ume!" });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await client.query(
      "SELECT account_id as id, email, password_hash, role, email FROM account WHERE email = $1;",
      [email]
    );
    const account = result.rows[0];
    const isAdmin = ["berufsbilder"].includes(account.role);
    console.log("Login Debug:", { email, accountRole: account?.role, isAdmin });
    if (account && bcrypt.compareSync(password, account.password_hash)) {
      const token = jwt.sign(
        { id: account.id, email: account.email, role: account.role, isAdmin: isAdmin },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      res.cookie("token", token, {
        /*development settings*/
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
        maxAge: 3600000
        /*production settings*/
        /*
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
        maxAge: 3600000,
        */
      });

      res.json({
        success: true,
        token: token,
        account: { id: account.id, email: account.email, role: account.role },
      });
    } else {
      res.json({
        success: false,
        message:
          "Login ist fehlgeschlagen. Überprüfe dein Passwort oder Email.",
      });
    }
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/register", async (req, res) => {
  console.log("Register request body:", req.body);
  const { email, password, first_name, last_name } = req.body; 
  
  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email und Passwort sind erforderlich." });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  
  try {
    const result = await client.query(`
      INSERT INTO account (email, password_hash, first_name, last_name) 
      VALUES ($1, $2, $3, $4) 
      RETURNING account_id AS id, email, role;
    `, [email, hashedPassword, first_name, last_name]
    );
    
    const account = result.rows[0];
    
    const isAdmin = ["berufsbilder"].includes(account.role);
    const token = jwt.sign(
      { id: account.id, email: account.email, role: account.role, isAdmin: isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    
    res.cookie("token", token, {
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
        maxAge: 3600000
    });

    res.json({
      success: true,
      token: token,
      account: { id: account.id, email: account.email, role: account.role },
    });
  } catch (err) {
    console.error("Registration error:", err);
    if (err.code === "23505") {
      return res.status(409).json({ success: false, message: "Die E-Mail-Adresse ist bereits registriert." });
    }

    res.status(500).json({ success: false, message: "Serverfehler bei der Registrierung." });
  }
});



app.get("/api/candidates", authRequired, checkAdmin, async (req, res) => {
    const { sort_by, status, search } = req.query; 
    
    let query = `
        SELECT 
            c.candidate_id as id, 
            c.first_name, 
            c.last_name, 
            c.email, 
            c.candidate_status as status,
            c.created_at,
            COALESCE(a.name, 'Nicht zugeordnet') as apprenticeship,
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
        conditions.push(`(LOWER(c.first_name) LIKE LOWER($${conditions.length + 1}) OR LOWER(c.last_name) LIKE LOWER($${conditions.length + 2}) OR LOWER(c.email) LIKE LOWER($${conditions.length + 3}))`);
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
        const result = await client.query(query, values);
        res.status(200).json({ success: true, candidates: result.rows });
    } catch (error) {
        console.error("GET /api/candidates Error:", error);
        res.status(500).json({ success: false, message: "Fehler beim Abrufen der Kandidaten." });
    }
});


app.post("/api/candidates", authRequired, checkAdmin, async (req, res) => {
    const { firstName, lastName, email, status, apprenticeshipId } = req.body || {};
    const createdByAccountId = req.user.id;

    if (!firstName || !email) {
        return res.status(400).json({ success: false, message: "Vorname und E-Mail sind erforderlich." });
    }

    try {
        // Start a transaction
        await client.query('BEGIN');

        // 1. Insert the candidate
        const candidateResult = await client.query(
            `INSERT INTO Candidate (first_name, last_name, email, candidate_status, created_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING candidate_id as id, email, first_name;`,
            [firstName, lastName, email, status || 'Normal', createdByAccountId]
        );
        const newCandidate = candidateResult.rows[0];

        // 2. If an apprenticeshipId is provided, link it in the bridge table
        if (apprenticeshipId) {
            await client.query(
                `INSERT INTO Candidate_Apprenticeship (candidate_id, apprenticeship_id)
                 VALUES ($1, $2);`,
                [newCandidate.id, apprenticeshipId]
            );
        }

        // Commit the transaction
        await client.query('COMMIT');

        res.status(201).json({ 
            success: true, 
            message: "Kandidat erfolgreich erstellt.", 
            candidate: newCandidate 
        });
    } catch (err) {
        // Rollback in case of error
        await client.query('ROLLBACK');
        console.error("POST /api/candidates Error:", err);
        if (err.code === "23505") { 
            return res.status(409).json({ success: false, message: "E-Mail-Adresse ist bereits registriert." });
        }
        res.status(500).json({ success: false, message: "Serverfehler beim Erstellen des Kandidaten." });
    }
});


app.patch("/api/candidates/:id", authRequired, checkAdmin, async (req, res) => {
    const { id } = req.params;
    const { firstName, lastName, email, status, apprenticeshipId } = req.body || {};

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
    if (apprenticeshipId !== undefined) {
        fields.push(`apprenticeship_id = $${queryIndex++}`);
        values.push(apprenticeshipId); 
    }

    if (fields.length === 0) {
        return res.status(400).json({ success: false, message: "Keine Felder zum Aktualisieren bereitgestellt." });
    }

    values.push(id); 
    
    try {
        const result = await client.query(
            `UPDATE candidate SET ${fields.join(", ")} WHERE candidate_id = $${queryIndex} RETURNING candidate_id as id;`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Kandidat nicht gefunden." });
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


app.delete("/api/candidates/:id", authRequired, checkAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        const result = await client.query(
            "DELETE FROM candidate WHERE candidate_id = $1 RETURNING candidate_id as id;",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Kandidat nicht gefunden." });
        }

        res.status(200).json({ success: true, message: "Kandidat erfolgreich gelöscht." });
    } catch (err) {
        console.error(`DELETE /api/candidates/${id} Error:`, err);
        res.status(500).json({ success: false, message: "Serverfehler beim Löschen des Kandidaten." });
    }
});

app.get("/api/events", async (req, res) => {
  try {
    const result = await client.query(`
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
      FROM event e
      JOIN account a ON e.created_by = a.account_id
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

app.post("/api/events", authRequired, async (req, res) => {
  const { title, description, startingAt, duration, invitationsSendingAt, registrationsClosingAt } = req.body || {};
  console.log("POST /api/events request body:", req.body);

  if (!title || !description || !startingAt) {
    return res.status(400).json({ success: false, message: "title, description, and startingAt are required" });
  }

  const createdByAccountId = req.user.id;

  try {
    const result = await client.query(
      `INSERT INTO event (title, description, starting_at, duration, invitations_sending_at, registrations_closing_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING event_id as id, title, duration, invitations_sending_at as "invitationsSendingAt", registrations_closing_at as "registrationsClosingAt";`,
      [title, description, startingAt, duration || null, invitationsSendingAt || null, registrationsClosingAt || null, createdByAccountId]
    );
    console.log("Event insert result:", result.rows);
    if (!result.rows || result.rows.length === 0) {
      return res.status(500).json({ success: false, message: "Event wurde nicht gespeichert" });
    }
    res.status(201).json({ success: true, event: result.rows[0] });
  } catch (error) {
    console.error("POST /api/events Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete("/api/events/:eventId", authRequired, async (req, res) => {
  const { eventId } = req.params;
  console.log("Delete Event request for ID:", eventId);

  try {
    // Prüfe zuerst, ob das Event existiert und wer es erstellt hat
    const checkResult = await client.query(
      "SELECT created_by FROM event WHERE event_id = $1",
      [eventId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }
    
    const eventCreatorId = checkResult.rows[0].created_by;
    const isAdmin = req.user.role === 'berufsbilder' && req.user.isAdmin === true;
    const isCreator = eventCreatorId === req.user.id;
    
    // Nur Admin oder Ersteller darf löschen
    if (!isAdmin && !isCreator) {
      return res.status(403).json({ 
        success: false, 
        message: "Zugriff verweigert. Sie können nur Ihre eigenen Events löschen." 
      });
    }

    const result = await client.query("DELETE FROM event WHERE event_id = $1 RETURNING event_id as id;", [eventId]);
    res.status(200).json({ success: true, message: "Event deleted" });
  } catch (error) {
    console.error("DELETE /api/events/:id Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.put("/api/events/:eventId", authRequired, async (req, res) => {
  const { eventId } = req.params;
  const { title, description, startingAt, duration, invitationsSendingAt, registrationsClosingAt } = req.body || {};
  console.log("PUT /api/events/:id request for ID:", eventId, req.body);

  try {
    // Prüfe zuerst, ob das Event existiert und wer es erstellt hat
    const checkResult = await client.query(
      "SELECT created_by FROM event WHERE event_id = $1",
      [eventId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }
    
    const eventCreatorId = checkResult.rows[0].created_by;
    const isAdmin = req.user.role === 'berufsbilder' && req.user.isAdmin === true;
    const isCreator = eventCreatorId === req.user.id;
    
    // Nur Admin oder Ersteller darf bearbeiten
    if (!isAdmin && !isCreator) {
      return res.status(403).json({ 
        success: false, 
        message: "Zugriff verweigert. Sie können nur Ihre eigenen Events bearbeiten." 
      });
    }

    const result = await client.query(
      `UPDATE event
       SET title = $1, description = $2, starting_at = $3, duration = $4, invitations_sending_at = $5, registrations_closing_at = $6
       WHERE event_id = $7
       RETURNING event_id as id, title, duration, invitations_sending_at as "invitationsSendingAt", registrations_closing_at as "registrationsClosingAt";`,
      [title, description, startingAt, duration || null, invitationsSendingAt || null, registrationsClosingAt || null, eventId]
    );
    res.status(200).json({ success: true, event: result.rows[0] });
  } catch (error) {
    console.error("PUT /api/events/:id Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// NEW ROUTES: Lookup Tables für Frontend
// ============================================

/**
 * GET /api/apprenticeships
 * Liefert alle Lehrstellen mit ihren IDs und Namen
 * Wird vom Frontend genutzt um Lookup-Tabellen zu bauen
 */
app.get("/api/apprenticeships", authRequired, async (req, res) => {
  try {
    const result = await client.query(`
      SELECT 
        apprenticeship_id as id,
        name,
        branch_id as "branchId"
      FROM apprenticeship
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

/**
 * GET /api/branches
 * Liefert alle Branchen mit ihren IDs und Namen
 */
app.get("/api/branches", authRequired, async (req, res) => {
  try {
    const result = await client.query(`
      SELECT 
        branch_id as id,
        name
      FROM branch
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

// ============================================
// EVENT RECRUITER & REGISTRATION ROUTES
// ============================================

/**
 * GET /api/accounts
 * Liefert alle verfügbaren Accounts für die Recruiter-Auswahl
 */
app.get("/api/accounts", authRequired, async (req, res) => {
  try {
    const result = await client.query(`
      SELECT account_id as id, first_name, last_name, email 
      FROM Account 
      ORDER BY first_name, last_name
    `);

    res.json({
      success: true,
      accounts: result.rows || []
    });
  } catch (error) {
    console.error("Fehler beim Abrufen der Accounts:", error);
    res.status(500).json({
      success: false,
      message: "Fehler beim Abrufen der Accounts",
      accounts: []
    });
  }
});

/**
 * GET /api/events/:eventId/recruiters
 * Liefert alle Recruiter, die einem Event zugewiesen sind
 */
app.get("/api/events/:eventId/recruiters", authRequired, async (req, res) => {
  const { eventId } = req.params;

  try {
    const result = await client.query(`
      SELECT a.account_id as id, a.first_name, a.last_name, a.email
      FROM Account a
      JOIN Event_Recruiter er ON a.account_id = er.recruiter_id
      WHERE er.event_id = $1
      ORDER BY a.first_name, a.last_name
    `, [eventId]);

    res.json({
      success: true,
      recruiters: result.rows || []
    });
  } catch (error) {
    console.error("Fehler beim Abrufen der Recruiter:", error);
    // Fallback: Leere Liste wenn Tabelle nicht existiert
    res.json({
      success: true,
      recruiters: []
    });
  }
});

/**
 * POST /api/events/:eventId/recruiters
 * Fügt einen Recruiter zu einem Event hinzu
 * Body: { recruiter_id: number }
 */
app.post("/api/events/:eventId/recruiters", authRequired, async (req, res) => {
  const { eventId } = req.params;
  const { recruiter_id } = req.body;

  if (!recruiter_id) {
    return res.status(400).json({
      success: false,
      message: "recruiter_id ist erforderlich"
    });
  }

  try {
    // Prüfe, ob die Verbindung bereits existiert
    const existsResult = await client.query(`
      SELECT 1 FROM Event_Recruiter 
      WHERE event_id = $1 AND recruiter_id = $2
    `, [eventId, recruiter_id]);

    if (existsResult.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Dieser Recruiter ist bereits dem Event zugewiesen"
      });
    }

    // Füge Recruiter hinzu
    await client.query(`
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

/**
 * DELETE /api/events/:eventId/recruiters/:recruiterId
 * Entfernt einen Recruiter von einem Event
 */
app.delete("/api/events/:eventId/recruiters/:recruiterId", authRequired, async (req, res) => {
  const { eventId, recruiterId } = req.params;

  try {
    const result = await client.query(`
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

/**
 * GET /api/events/:eventId/registrations
 * Liefert die Anzahl und Details der Event-Anmeldungen
 */
app.get("/api/events/:eventId/registrations", authRequired, async (req, res) => {
  const { eventId } = req.params;

  try {
    const result = await client.query(`
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

/**
 * POST /api/events/:eventId/registrations
 * Registriert einen Kandidaten für ein Event
 * Body: { candidate_id: number }
 */
app.post("/api/events/:eventId/registrations", authRequired, checkAdmin, async (req, res) => {
  const { eventId } = req.params;
  const { candidate_id } = req.body;

  if (!candidate_id) {
    return res.status(400).json({
      success: false,
      message: "candidate_id ist erforderlich"
    });
  }

  try {
    // Prüfe ob Kandidat existiert
    const candidateCheck = await client.query(
      "SELECT candidate_id FROM Candidate WHERE candidate_id = $1",
      [candidate_id]
    );

    if (candidateCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Kandidat nicht gefunden"
      });
    }

    // Registriere Kandidaten
    const result = await client.query(
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

/**
 * DELETE /api/events/:eventId/registrations/:candidateId
 * Entfernt die Registrierung eines Kandidaten von einem Event
 */
app.delete("/api/events/:eventId/registrations/:candidateId", authRequired, checkAdmin, async (req, res) => {
  const { eventId, candidateId } = req.params;

  try {
    const result = await client.query(
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
 * GET /api/users
 * Gibt alle Benutzer zurück (nur für Admins)
 */
app.get("/api/users", authRequired, checkAdmin, async (req, res) => {
  try {
    const result = await client.query(`
      SELECT 
        account_id as id,
        email,
        first_name as "firstName",
        last_name as "lastName",
        role,
        created_at as "createdAt"
      FROM account
      ORDER BY created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Fehler beim Abrufen der Benutzer:", error);
    res.status(500).json({
      success: false,
      message: "Fehler beim Abrufen der Benutzer"
    });
  }
});

/**
 * DELETE /api/users/:userId
 * Löscht einen Benutzer (nur für Admins)
 */
app.delete("/api/users/:userId", authRequired, checkAdmin, async (req, res) => {
  const { userId } = req.params;

  // Verhindere, dass Admin sich selbst löscht
  if (parseInt(userId) === req.user.id) {
    return res.status(400).json({
      success: false,
      message: "Sie können Ihren eigenen Account nicht löschen"
    });
  }

  try {
    const result = await client.query(
      `DELETE FROM account WHERE account_id = $1 RETURNING account_id`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Benutzer nicht gefunden"
      });
    }

    res.json({
      success: true,
      message: "Benutzer erfolgreich gelöscht"
    });
  } catch (error) {
    console.error("Fehler beim Löschen des Benutzers:", error);
    res.status(500).json({
      success: false,
      message: "Fehler beim Löschen des Benutzers"
    });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
