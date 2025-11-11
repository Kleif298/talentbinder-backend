import express from 'express';
const router = express.Router();
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';
import { authenticateAndCreateToken } from '../utils/auth.js';

// ldap-funktionen dynamisch importieren, wegen initialisierungsreihenfolge
// Würde man die Funktionen normal importieren, wurden die funktionen ohne env-data geladen werden
let ldapFunctions = null;

async function initLdapFunctions() {
    if (!ldapFunctions) {
        try {
            const ldapModule = await import("../config/ldap.js");
            ldapFunctions = ldapModule;
            console.log('✅ LDAP module loaded successfully');
        } catch (err) {
            console.error('⚠️ LDAP module could not be loaded:', err.message);
            ldapFunctions = null;
        }
    }
    return ldapFunctions;
}

await initLdapFunctions();

// prüft, ob der ldap-server erreichbar ist
router.get('/ldap-status', async (req, res) => {
    try {
        const isReachable = ldapFunctions 
            ? await ldapFunctions.isLdapServerReachable() 
            : false;
        
        return res.json({
            success: true,
            ldapAvailable: isReachable
        });
    } catch (err) {
        console.error('❌ Error checking LDAP status:', err);
        return res.json({
            success: true,
            ldapAvailable: false
        });
    }
});

router.post('/login', async (req, res) => {
    const { email, password, preferredMethod } = req.body;

    console.log('🔵 Backend: Login request received:', { email, preferredMethod });

    // Validate input
    if (!email || !password) {
        return res.status(400).json({ 
            success: false,
            message: 'E-Mail und Passwort sind erforderlich.' 
        });
    }

    if (!email.endsWith('@sunrise.net')) {
        return res.status(400).json({ 
            success: false,
            message: 'Bitte verwenden Sie eine @sunrise.net E-Mail-Adresse.' 
        });
    }

    try {
        if (preferredMethod === 'ldap') {
            // LDAP Authentication
            if (!ldapFunctions) {
                console.log('❌ Backend: LDAP module not loaded');
                return res.status(503).json({ 
                    success: false,
                    message: 'LDAP-Server ist nicht verfügbar.' 
                });
            }

            const ldapReachable = await ldapFunctions.isLdapServerReachable();
            if (!ldapReachable) {
                console.log('❌ Backend: LDAP server unreachable');
                return res.status(503).json({ 
                    success: false,
                    message: 'LDAP-Server ist nicht erreichbar. Bitte verbinden Sie sich mit dem DAL-Netzwerk oder nutzen Sie den lokalen Login.' 
                });
            }

            // Authenticate via LDAP
            console.log('🔵 Backend: Attempting LDAP authentication');
            const ldapUser = await ldapFunctions.authenticateLdapUser(email, password);
            
            if (!ldapUser) {
                console.log('❌ Backend: Invalid LDAP credentials');
                return res.status(401).json({
                    success: false,
                    message: 'Ungültige LDAP-Anmeldedaten.'
                });
            }

            console.log('✅ Backend: LDAP authentication successful');
            
            // Sync to database and create token
            const authResponse = await authenticateAndCreateToken(ldapUser);
            
            return res.json(authResponse);

        } else if (preferredMethod === 'local') {
            // Local Authentication
            console.log('🔵 Backend: Attempting local authentication');
            
            const result = await pool.query(
                'SELECT account_id, first_name, last_name, email, password_hash, role FROM account WHERE email = $1',
                [email]
            );
            
            if (result.rows.length === 0) {
                console.log('❌ Backend: User not found in database');
                return res.status(401).json({
                    success: false,
                    message: 'Benutzer nicht gefunden.'
                });
            }

            const user = result.rows[0];
            
            if (!user.password_hash) {
                console.log('❌ Backend: User has no local password (LDAP-only user)');
                return res.status(401).json({
                    success: false,
                    message: 'Dieser Account hat kein lokales Passwort. Bitte nutzen Sie LDAP-Login.'
                });
            }

            const passwordMatch = await bcrypt.compare(password, user.password_hash);
            
            if (!passwordMatch) {
                console.log('❌ Backend: Invalid local password');
                return res.status(401).json({
                    success: false,
                    message: 'Ungültiges Passwort.'
                });
            }

            console.log('✅ Backend: Local authentication successful');
            
            // Create JWT token
            const token = jwt.sign(
                { 
                    id: user.account_id,
                    email: user.email,
                    name: `${user.first_name} ${user.last_name}`,
                    role: user.role
                },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );
            
            return res.json({
                success: true,
                token,
                user: {
                    id: user.account_id,
                    email: user.email,
                    name: `${user.first_name} ${user.last_name}`,
                    isAdmin: user.role === 'berufsbilder'
                }
            });

        } else {
            return res.status(400).json({
                success: false,
                message: 'Ungültige Login-Methode. Nutzen Sie "ldap" oder "local".'
            });
        }
    } catch (err) {
        console.error('❌ Backend: Login error:', err);
        return res.status(500).json({ 
            success: false,
            message: 'Ein Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.' 
        });
    }
});

export default router;