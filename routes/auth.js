import express from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';
import { getOrCreateUser, createAuthToken } from '../utils/auth.js';
import { authRequired } from '../middleware/auth.js';

const router = express.Router();
let ldapFunctions = null;

async function initLdapFunctions() {
    if (!ldapFunctions) {
        try {
            ldapFunctions = await import("../config/ldap.js");
            console.log('✅ LDAP module loaded');
        } catch (err) {
            console.error('⚠️ LDAP module load failed:', err.message);
        }
    }
    return ldapFunctions;
}

router.get('/ldap-status', async (req, res) => {
    await initLdapFunctions();
    const isReachable = ldapFunctions ? await ldapFunctions.isLdapServerReachable() : false;
    res.json({ success: true, ldapAvailable: isReachable });
});

router.post('/login', async (req, res) => {
    const { email, password, preferredMethod } = req.body;

    console.log('🔵 Login:', { email, preferredMethod });

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'E-Mail und Passwort erforderlich.' });
    }

    if (!email.endsWith('@sunrise.net')) {
        return res.status(400).json({ success: false, message: 'Bitte @sunrise.net E-Mail verwenden.' });
    }

    try {
        let user, token;

        if (preferredMethod === 'ldap') {
            await initLdapFunctions();
            
            if (!ldapFunctions || !(await ldapFunctions.isLdapServerReachable())) {
                return res.status(503).json({ 
                    success: false, 
                    message: 'LDAP-Server nicht erreichbar. Bitte DAL-Netzwerk verbinden oder lokalen Login nutzen.' 
                });
            }

            console.log('🔵 LDAP authentication...');
            const ldapUser = await ldapFunctions.authenticateLdapUser(email, password);
            
            if (!ldapUser) {
                return res.status(401).json({ success: false, message: 'Ungültige LDAP-Anmeldedaten.' });
            }

            console.log('✅ LDAP success');
            user = await getOrCreateUser(
                ldapUser.email,
                ldapUser.givenName || ldapUser.name.split(' ')[0],
                ldapUser.surname || ldapUser.name.split(' ')[1] || '',
                ldapUser.uid
            );

        } else if (preferredMethod === 'local') {
            console.log('🔵 Local authentication...');
            
            const result = await pool.query(
                'SELECT account_id, first_name, last_name, email, password_hash, role FROM account WHERE email = $1',
                [email]
            );
            
            if (result.rows.length === 0) {
                return res.status(401).json({ success: false, message: 'Benutzer nicht gefunden.' });
            }

            const dbUser = result.rows[0];
            
            if (!dbUser.password_hash) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Kein lokales Passwort. Bitte LDAP-Login nutzen.' 
                });
            }

            if (!(await bcrypt.compare(password, dbUser.password_hash))) {
                return res.status(401).json({ success: false, message: 'Ungültiges Passwort.' });
            }

            console.log('✅ Local success');
            user = {
                id: dbUser.account_id,
                email: dbUser.email,
                name: `${dbUser.first_name} ${dbUser.last_name}`,
                role: dbUser.role
            };

        } else {
            return res.status(400).json({ success: false, message: 'Ungültige Login-Methode.' });
        }

        // Create token and send ONLY as cookie
        token = createAuthToken(user);
        
        res.cookie('user', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 3600000
        });
        
        return res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                isAdmin: user.role === 'berufsbilder'
            }
        });

    } catch (err) {
        console.error('❌ Login error:', err);
        return res.status(500).json({ success: false, message: 'Ein Fehler ist aufgetreten.' });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('user', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
    });
    
    console.log('✅ User logged out');
    res.json({ success: true, message: 'Erfolgreich abgemeldet.' });
});

router.get('/me', authRequired, (req, res) => {
    return res.json({
        success: true,
        user: {
            id: req.user.id,
            email: req.user.email,
            name: req.user.name,
            role: req.user.role,
            isAdmin: req.user.role === 'berufsbilder' || req.user.role === 'dev' || false
        }
    });
});

export default router;