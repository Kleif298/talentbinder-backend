import express from 'express';
import client from '../config/db.js';
import { authRequired, checkAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authRequired, async (req, res) => {
	try {
		const result = await client.query(`
			SELECT 
				account_id as id,
				email,
				first_name,
				last_name,
				role,
				created_at as "createdAt"
			FROM account
			ORDER BY last_name, first_name ASC;
		`);

		res.json(result.rows);
	} catch (error) {
		console.error('GET /api/users error:', error);
		res.status(500).json({ success: false, message: 'Fehler beim Abrufen der Benutzer' });
	}
});

router.delete('/:userId', authRequired, checkAdmin, async (req, res) => {
	const { userId } = req.params;

	if (parseInt(userId, 10) === req.user.id) {
		return res.status(400).json({ success: false, message: 'Sie können Ihren eigenen Account nicht löschen' });
	}

	try {
		const result = await client.query(
			`DELETE FROM account WHERE account_id = $1 RETURNING account_id`,
			[userId]
		);

		if (result.rows.length === 0) {
			return res.status(404).json({ success: false, message: 'Benutzer nicht gefunden' });
		}

		res.json({ success: true, message: 'Benutzer erfolgreich gelöscht' });
	} catch (error) {
		console.error('DELETE /api/users/:userId error:', error);
		res.status(500).json({ success: false, message: 'Fehler beim Löschen des Benutzers' });
	}
});

export default router;
