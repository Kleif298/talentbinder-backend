// ============================================
// EVENT RECRUITER & REGISTRATION ROUTES
// ============================================

/**
 * GET /api/events/:eventId/recruiters
 * Liefert alle Recruiter, die einem Event zugewiesen sind
 */
app.get("/api/events/:eventId/recruiters", authRequired, async (req, res) => {
  const { eventId } = req.params;

  try {
    const result = await client.query(`
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

/**
 * GET /api/events/:eventId/registrations
 * Liefert die Anzahl und Details der Event-Anmeldungen
 */
app.get("/api/events/:eventId/registrations", authRequired, async (req, res) => {
  const { eventId } = req.params;

  try {
    const result = await client.query(`
      SELECT 
        COUNT(*) as count,
        json_agg(json_build_object(
          'candidate_id', c.candidate_id,
          'first_name', c.first_name,
          'last_name', c.last_name,
          'email', c.email,
          'status', er.attendance_status
        )) as registrations
      FROM Event_Registration er
      JOIN Candidate c ON er.candidate_id = c.candidate_id
      WHERE er.event_id = $1
    `, [eventId]);

    const countRow = result.rows[0];
    
    res.json({
      success: true,
      count: parseInt(countRow.count || 0),
      registrations: countRow.registrations || []
    });
  } catch (error) {
    console.error("Fehler beim Abrufen der Registrierungen:", error);
    res.status(500).json({
      success: false,
      message: "Fehler beim Abrufen der Registrierungen"
    });
  }
});
