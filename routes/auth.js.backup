/**
 * Authentication Routes
 * 
 * Handles user login, logout, and token verification using LDAP authentication
 * and local database synchronization.
 */

import express from 'express';
const router = express.Router();
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { 
    validateUser, 
    getUidByEmail, 
    getUserDetails, 
    userIsMemberOf 
} from '../config/ldap.js';

/**
 * POST /api/auth/login
 * 
 * Authenticate user with LDAP and create session
 * 
 * Flow:
 * 1. Get UID from email (LDAP search)
 * 2. Validate password (LDAP bind)
 * 3. Get user details (LDAP search)
 * 4. Check admin status (LDAP memberOf)
 * 5. Sync to local database
 * 6. Generate JWT token
 * 7. Set httpOnly cookie
 */
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    console.log('🔵 Backend: Login request received for:', email);

    // Validate input
    if (!email || !password) {
        console.log('❌ Backend: Missing email or password');
        return res.status(400).json({ 
            success: false, 
            message: 'E-Mail und Passwort sind erforderlich.' 
        });
    }

    try {
        // Step 1: Get UID from email via LDAP
        console.log('🔵 Backend: Step 1 - Getting UID from email...');
        const uid = await getUidByEmail(email);
        console.log('✅ Backend: Found UID:', uid);
        
        // Step 2: Validate password via LDAP bind
        console.log('🔵 Backend: Step 2 - Validating password...');
        const isValid = await validateUser(uid, password);
        console.log('🔵 Backend: Password valid:', isValid);
        
        if (!isValid) {
            console.log('❌ Backend: Invalid password');
            return res.status(401).json({ 
                success: false, 
                message: 'Ungültige Anmeldedaten.' 
            });
        }

        // Step 3: Get full user details from LDAP
        console.log('🔵 Backend: Step 3 - Getting user details...');
        const ldapUser = await getUserDetails(uid);
        console.log('✅ Backend: LDAP user details:', ldapUser);
        
        // Step 4: Check if user is admin
        console.log('🔵 Backend: Step 4 - Checking admin status...');
        const isAdmin = await userIsMemberOf(uid, process.env.LDAP_ADMIN_GROUP || 'admins');
        console.log('🔵 Backend: Is admin:', isAdmin);

        // Step 5: Sync user to local database
        console.log('🔵 Backend: Step 5 - Syncing to database...');
        let dbUser = await pool.query(
            'SELECT * FROM Account WHERE email = $1',
            [email]
        );

        if (dbUser.rows.length === 0) {
            console.log('🔵 Backend: User not found in DB - Creating new user...');
            // Create new user in database
            // Map LDAP admin status to database role: admin → 'berufsbilder', user → 'recruiter'
            const result = await pool.query(
                `INSERT INTO Account (email, first_name, last_name, uid, role, created_at) 
                 VALUES ($1, $2, $3, $4, $5, NOW()) 
                 RETURNING *`,
                [
                    email, 
                    ldapUser.givenName || 'Unknown', 
                    ldapUser.sn || 'User',
                    uid, // Store LDAP uid
                    isAdmin ? 'berufsbilder' : 'recruiter'
                ]
            );
            dbUser = result;
            console.log('✅ Backend: Created new user:', dbUser.rows[0]);
        } else {
            console.log('🔵 Backend: User exists - Updating role and uid...');
            // Update role and uid if changed in LDAP
            await pool.query(
                'UPDATE Account SET role = $1, uid = $2, last_ldap_sync = NOW() WHERE email = $3',
                [isAdmin ? 'berufsbilder' : 'recruiter', uid, email]
            );
            console.log('✅ Backend: Updated user role and uid');
        }

        const user = dbUser.rows[0];
        console.log('🔵 Backend: DB user record:', user);

        // Step 6: Create JWT token
        console.log('🔵 Backend: Step 6 - Creating JWT token...');
        const token = jwt.sign(
            { 
                id: user.account_id, // Changed from user.id to user.account_id
                email: user.email, 
                username: ldapUser.uid,
                firstName: ldapUser.givenName,
                lastName: ldapUser.sn,
                role: user.role, // 'berufsbilder' or 'recruiter'
                isAdmin: user.role === 'berufsbilder', // Convenience flag for frontend
                uid: uid 
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );
        console.log('✅ Backend: JWT token created');

        // Step 7: Set secure httpOnly cookie
        console.log('🔵 Backend: Step 7 - Setting cookie...');
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 8 * 60 * 60 * 1000 // 8 hours
        });

        const responseData = {
            success: true,
            message: 'Login erfolgreich.',
            user: {
                id: user.account_id,
                email: user.email,
                username: ldapUser.uid,
                firstName: ldapUser.givenName,
                lastName: ldapUser.sn,
                role: user.role,
                isAdmin: user.role === 'berufsbilder'
            }
        };

        console.log('✅ Backend: Sending response:', responseData);

        // Send success response
        return res.json(responseData);

    } catch (error) {
        console.error('Login error:', error);
        
        // Handle specific errors
        if (error.message === 'User not found') {
            return res.status(404).json({ 
                success: false, 
                message: 'Benutzer nicht gefunden.' 
            });
        }
        
        if (error.message.includes('LDAP connection failed')) {
            return res.status(503).json({ 
                success: false, 
                message: 'LDAP-Server nicht erreichbar. Bitte später erneut versuchen.' 
            });
        }
        
        // Generic error response
        res.status(500).json({ 
            success: false, 
            message: 'Serverfehler beim Login.' 
        });
    }
});

/**
 * POST /api/auth/register
 * 
 * Registration disabled - users managed via LDAP
 */
router.post('/register', async (req, res) => {
    res.status(403).json({ 
        success: false, 
        message: 'Registrierung nicht verfügbar. Benutzer werden über LDAP verwaltet.' 
    });
});

/**
 * POST /api/auth/logout
 * 
 * Clear user session and log the event
 * Always succeeds even if token is invalid
 */
router.post('/logout', async (req, res) => {
    try {
        const token = req.cookies.token;
        
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            // Log logout event for audit trail
            await pool.query(
                `INSERT INTO Audit_Log (table_name, record_id, action, account_id, old_data, new_data) 
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                ['Account', decoded.id, 'LOGOUT', decoded.id, null, JSON.stringify({ email: decoded.email })]
            );
        }

        // Clear cookie
        res.clearCookie('token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });

        res.json({
            success: true,
            message: 'Erfolgreich abgemeldet.'
        });

    } catch (error) {
        // Even if token is invalid, clear cookie and succeed
        res.clearCookie('token', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });

        console.error('Logout error:', error);
        res.json({
            success: true,
            message: 'Erfolgreich abgemeldet.'
        });
    }
});

/**
 * GET /api/auth/verify
 * 
 * Verify if current token is valid
 * Used by frontend to check authentication status
 */
router.get('/verify', async (req, res) => {
    const token = req.cookies.token;
    
    if (!token) {
        return res.status(401).json({ 
            success: false, 
            message: 'Nicht authentifiziert' 
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        res.json({ 
            success: true, 
            user: decoded 
        });
    } catch (error) {
        res.status(401).json({ 
            success: false, 
            message: 'Ungültiges oder abgelaufenes Token' 
        });
    }
});

export default router;