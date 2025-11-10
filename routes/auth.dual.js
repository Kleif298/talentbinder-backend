/**
 * Authentication Routes - Dual Authentication System
 * 
 * Supports both LDAP (when on org network) and local database authentication
 * Only allows @sunrise.net email addresses
 */

import express from 'express';
const router = express.Router();
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
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
 * Dual authentication:
 * 1. Try LDAP first (if configured and accessible)
 * 2. Fall back to local database authentication
 * 3. Only @sunrise.net emails allowed
 */
router.post('/login', async (req, res) => {
    const { email, password, preferredMethod } = req.body;

    console.log('🔵 Backend: Login request received for:', email, 'Preferred method:', preferredMethod);

    // Validate input
    if (!email || !password) {
        console.log('❌ Backend: Missing email or password');
        return res.status(400).json({ 
            success: false, 
            message: 'E-Mail und Passwort sind erforderlich.' 
        });
    }

    // Only allow @sunrise.net emails
    if (!email.endsWith('@sunrise.net')) {
        console.log('❌ Backend: Invalid email domain');
        return res.status(401).json({ 
            success: false, 
            message: 'Nur @sunrise.net E-Mail-Adressen sind erlaubt.' 
        });
    }

    try {
        // Check if LDAP is configured
        const ldapConfigured = process.env.LDAP_ADMIN_DN && process.env.LDAP_ADMIN_PASSWORD;
        
        // If user prefers local authentication, try that first
        if (preferredMethod === 'local') {
            console.log('🔵 Backend: User prefers local authentication, trying local DB first...');
            try {
                const localResult = await authenticateWithLocalDB(email, password);
                if (localResult.success) {
                    console.log('✅ Backend: Local DB authentication successful');
                    
                    // Set HTTP-only cookie
                    res.cookie('token', localResult.token, {
                        httpOnly: true,
                        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
                        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' for cross-origin
                        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                        path: '/'
                    });
                    console.log('🍪 Backend: Cookie set for user:', email);
                    
                    return res.json(localResult);
                }
            } catch (localError) {
                console.log('⚠️  Backend: Local DB authentication failed');
                // If local fails and LDAP is available, try LDAP as fallback
                if (ldapConfigured) {
                    console.log('🔵 Backend: Falling back to LDAP authentication...');
                    try {
                        const ldapResult = await authenticateWithLDAP(email, password);
                        console.log('✅ Backend: LDAP authentication successful');
                        
                        // Set HTTP-only cookie
                        res.cookie('token', ldapResult.token, {
                            httpOnly: true,
                            secure: process.env.NODE_ENV === 'production', // HTTPS only in production
                            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' for cross-origin
                            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                            path: '/'
                        });
                        console.log('🍪 Backend: Cookie set for user:', email);
                        
                        return res.json(ldapResult);
                    } catch (ldapError) {
                        console.log('❌ Backend: Both local and LDAP authentication failed');
                        return res.status(401).json({ 
                            success: false, 
                            message: 'Ungültige Anmeldedaten.' 
                        });
                    }
                }
                throw localError; // Re-throw if no LDAP fallback available
            }
        }
        
        // Default: Try LDAP first if configured
        if (ldapConfigured) {
            console.log('🔵 Backend: LDAP is configured, attempting LDAP authentication...');
            try {
                const ldapResult = await authenticateWithLDAP(email, password);
                console.log('✅ Backend: LDAP authentication successful');
                
                // Set HTTP-only cookie
                res.cookie('token', ldapResult.token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
                    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' for cross-origin
                    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                    path: '/'
                });
                console.log('🍪 Backend: Cookie set for user:', email);
                
                return res.json(ldapResult);
            } catch (ldapError) {
                console.log('⚠️  Backend: LDAP authentication failed, falling back to local DB');
                console.log('⚠️  LDAP Error:', ldapError.message);
                // Continue to local DB authentication
            }
        } else {
            console.log('⚠️  Backend: LDAP not configured, using local DB authentication');
        }

        // Fall back to local database authentication
        console.log('🔵 Backend: Attempting local database authentication...');
        const localResult = await authenticateWithLocalDB(email, password);
        
        if (!localResult.success) {
            return res.status(401).json(localResult);
        }
        
        // Set HTTP-only cookie
        res.cookie('token', localResult.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production', // HTTPS only in production
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' for cross-origin
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            path: '/'
        });
        console.log('🍪 Backend: Cookie set for user:', email);
        
        return res.json(localResult);

    } catch (error) {
        console.error('❌ Login error:', error);
        
        return res.status(500).json({ 
            success: false, 
            message: 'Serverfehler beim Login.' 
        });
    }
});

/**
 * POST /api/auth/register
 * 
 * Register a new local account
 * Only @sunrise.net emails allowed
 */
router.post('/register', async (req, res) => {
    const { email, password } = req.body;

    console.log('🔵 Backend: Registration request received for:', email);
    console.log('🔵 Backend: Request body:', { email, hasPassword: !!password, passwordLength: password?.length });

    // Validate input
    if (!email || !password) {
        console.log('❌ Backend: Missing email or password');
        return res.status(400).json({ 
            success: false, 
            message: 'E-Mail und Passwort sind erforderlich.' 
        });
    }

    // Only allow @sunrise.net emails
    if (!email.endsWith('@sunrise.net')) {
        console.log('❌ Backend: Invalid email domain');
        return res.status(401).json({ 
            success: false, 
            message: 'Nur @sunrise.net E-Mail-Adressen sind erlaubt.' 
        });
    }

    // Validate password strength
    if (password.length < 8) {
        console.log('❌ Backend: Password too short');
        return res.status(400).json({ 
            success: false, 
            message: 'Passwort muss mindestens 8 Zeichen lang sein.' 
        });
    }

    try {
        console.log('🔵 Backend: Checking if user exists...');
        
        // Check if user already exists
        const existingUser = await pool.query(
            'SELECT * FROM Account WHERE email = $1',
            [email]
        );

        if (existingUser.rows.length > 0) {
            console.log('❌ Backend: User already exists');
            return res.status(409).json({ 
                success: false, 
                message: 'Ein Konto mit dieser E-Mail existiert bereits.' 
            });
        }

        // Hash password
        console.log('🔵 Backend: Hashing password...');
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        console.log('✅ Backend: Password hashed');

        // Extract first and last name from email (before @)
        const namePart = email.split('@')[0];
        const nameParts = namePart.split('.');
        const firstName = nameParts[0] ? nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1) : 'User';
        const lastName = nameParts[1] ? nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1) : '';

        console.log('🔵 Backend: Creating user with name:', { firstName, lastName });

        // Create new user
        console.log('🔵 Backend: Inserting into database...');
        const result = await pool.query(
            `INSERT INTO Account (email, first_name, last_name, password_hash, role, created_at) 
             VALUES ($1, $2, $3, $4, $5, NOW()) 
             RETURNING account_id, email, first_name, last_name, role`,
            [email, firstName, lastName, passwordHash, 'recruiter']
        );

        const user = result.rows[0];
        console.log('✅ Backend: User created successfully:', { 
            id: user.account_id, 
            email: user.email 
        });

        // Generate JWT token
        console.log('🔵 Backend: Generating JWT token...');
        const token = jwt.sign(
            { 
                id: user.account_id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                role: user.role,
                isAdmin: user.role === 'berufsbilder',
                authMethod: 'LOCAL'
            },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        console.log('✅ Backend: Token generated');
        console.log('✅ Backend: Registration successful, sending response...');

        // Set HTTP-only cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production', // HTTPS only in production
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' for cross-origin
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            path: '/'
        });
        console.log('🍪 Backend: Cookie set for registration:', email);

        return res.status(201).json({ 
            success: true, 
            message: 'Registrierung erfolgreich!',
            token,
            user: {
                id: user.account_id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                isAdmin: user.role === 'berufsbilder',
                role: user.role,
                authMethod: 'LOCAL'
            }
        });

    } catch (error) {
        console.error('❌ Registration error:', error);
        console.error('❌ Error stack:', error.stack);
        console.error('❌ Error details:', {
            name: error.name,
            message: error.message,
            code: error.code
        });
        
        return res.status(500).json({ 
            success: false, 
            message: 'Serverfehler bei der Registrierung.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * Authenticate user with LDAP
 * @private
 */
async function authenticateWithLDAP(email, password) {
    // Step 1: Get UID from email via LDAP
    console.log('🔵 LDAP: Step 1 - Getting UID from email...');
    const uid = await getUidByEmail(email);
    console.log('✅ LDAP: Found UID:', uid);
    
    // Step 2: Validate password via LDAP bind
    console.log('🔵 LDAP: Step 2 - Validating password...');
    const isValid = await validateUser(uid, password);
    console.log('🔵 LDAP: Password valid:', isValid);
    
    if (!isValid) {
        console.log('❌ LDAP: Invalid password');
        throw new Error('Invalid LDAP credentials');
    }

    // Step 3: Get full user details from LDAP
    console.log('🔵 LDAP: Step 3 - Getting user details...');
    const ldapUser = await getUserDetails(uid);
    console.log('✅ LDAP: User details retrieved');
    
    // Step 4: Check if user is admin
    console.log('🔵 LDAP: Step 4 - Checking admin status...');
    const isAdmin = await userIsMemberOf(uid, process.env.LDAP_ADMIN_GROUP || 'admins');
    console.log('🔵 LDAP: Is admin:', isAdmin);

    // Step 5: Sync user to local database
    console.log('🔵 LDAP: Step 5 - Syncing to database...');
    let dbUser = await pool.query(
        'SELECT * FROM Account WHERE email = $1',
        [email]
    );

    if (dbUser.rows.length === 0) {
        console.log('🔵 LDAP: User not found in DB - Creating new user...');
        const result = await pool.query(
            `INSERT INTO Account (email, first_name, last_name, uid, role, created_at) 
             VALUES ($1, $2, $3, $4, $5, NOW()) 
             RETURNING *`,
            [
                email, 
                ldapUser.givenName || 'Unknown', 
                ldapUser.sn || 'User',
                uid,
                isAdmin ? 'berufsbilder' : 'recruiter'
            ]
        );
        dbUser = result;
        console.log('✅ LDAP: Created new user');
    } else {
        console.log('🔵 LDAP: User exists - Updating from LDAP...');
        await pool.query(
            'UPDATE Account SET role = $1, uid = $2, first_name = $3, last_name = $4, last_ldap_sync = NOW() WHERE email = $5',
            [isAdmin ? 'berufsbilder' : 'recruiter', uid, ldapUser.givenName, ldapUser.sn, email]
        );
        dbUser = await pool.query('SELECT * FROM Account WHERE email = $1', [email]);
        console.log('✅ LDAP: Updated user from LDAP');
    }

    const user = dbUser.rows[0];

    // Generate JWT token
    const token = jwt.sign(
        { 
            id: user.account_id,
            email: user.email, 
            username: ldapUser.uid,
            firstName: ldapUser.givenName,
            lastName: ldapUser.sn,
            role: user.role,
            isAdmin: user.role === 'berufsbilder',
            uid: uid,
            authMethod: 'LDAP'
        },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
    );

    return {
        success: true,
        message: 'Login erfolgreich (LDAP).',
        user: {
            id: user.account_id,
            email: user.email,
            username: ldapUser.uid,
            firstName: ldapUser.givenName,
            lastName: ldapUser.sn,
            role: user.role,
            isAdmin: user.role === 'berufsbilder'
        },
        token,
        authMethod: 'LDAP'
    };
}

/**
 * Authenticate user with local database
 * @private
 */
async function authenticateWithLocalDB(email, password) {
    console.log('🔵 LocalDB: Checking for user in database...');
    
    const result = await pool.query(
        'SELECT * FROM Account WHERE email = $1',
        [email]
    );

    if (result.rows.length === 0) {
        console.log('❌ LocalDB: User not found');
        return {
            success: false,
            message: 'Benutzer nicht gefunden. Bitte kontaktieren Sie einen Administrator.'
        };
    }

    const user = result.rows[0];
    console.log('✅ LocalDB: User found:', { email: user.email, hasPassword: !!user.password_hash });

    // Check if user has a local password set
    if (!user.password_hash) {
        console.log('❌ LocalDB: User has no local password set');
        return {
            success: false,
            message: 'Kein lokales Passwort gesetzt. Bitte verbinden Sie sich mit dem Firmennetzwerk oder kontaktieren Sie einen Administrator.'
        };
    }

    // Verify password
    console.log('🔵 LocalDB: Verifying password...');
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
        console.log('❌ LocalDB: Invalid password');
        return {
            success: false,
            message: 'Ungültige Anmeldedaten.'
        };
    }

    console.log('✅ LocalDB: Password valid');

    // Generate JWT token
    const token = jwt.sign(
        { 
            id: user.account_id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role,
            isAdmin: user.role === 'berufsbilder',
            authMethod: 'LOCAL'
        },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
    );

    console.log('✅ LocalDB: Login successful');

    return {
        success: true,
        message: 'Login erfolgreich (Lokal).',
        user: {
            id: user.account_id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role,
            isAdmin: user.role === 'berufsbilder'
        },
        token,
        authMethod: 'LOCAL'
    };
}

/**
 * POST /api/auth/set-local-password
 * 
 * Set a local password for the current user (requires existing authentication)
 * This allows users to log in when not on the org network
 */
router.post('/set-local-password', async (req, res) => {
    const { email, password, newPassword } = req.body;

    console.log('🔵 Backend: Set local password request for:', email);

    if (!email || !password || !newPassword) {
        return res.status(400).json({ 
            success: false, 
            message: 'E-Mail, aktuelles Passwort und neues Passwort sind erforderlich.' 
        });
    }

    if (!email.endsWith('@sunrise.net')) {
        return res.status(401).json({ 
            success: false, 
            message: 'Nur @sunrise.net E-Mail-Adressen sind erlaubt.' 
        });
    }

    try {
        // First, authenticate with LDAP to verify current password
        const ldapConfigured = process.env.LDAP_ADMIN_DN && process.env.LDAP_ADMIN_PASSWORD;
        
        if (!ldapConfigured) {
            return res.status(503).json({
                success: false,
                message: 'LDAP nicht verfügbar. Bitte verbinden Sie sich mit dem Firmennetzwerk.'
            });
        }

        console.log('🔵 Verifying current password with LDAP...');
        const uid = await getUidByEmail(email);
        const isValid = await validateUser(uid, password);

        if (!isValid) {
            console.log('❌ Invalid current password');
            return res.status(401).json({
                success: false,
                message: 'Ungültiges aktuelles Passwort.'
            });
        }

        // Hash the new password
        console.log('🔵 Hashing new local password...');
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(newPassword, saltRounds);

        // Update user with new password hash
        await pool.query(
            'UPDATE Account SET password_hash = $1 WHERE email = $2',
            [passwordHash, email]
        );

        console.log('✅ Local password set successfully for:', email);

        return res.json({
            success: true,
            message: 'Lokales Passwort erfolgreich gesetzt. Sie können sich jetzt auch außerhalb des Firmennetzwerks anmelden.'
        });

    } catch (error) {
        console.error('❌ Set password error:', error);
        return res.status(500).json({
            success: false,
            message: 'Fehler beim Setzen des lokalen Passworts.'
        });
    }
});

/**
 * POST /api/auth/logout
 * 
 * Clear authentication cookie
 */
router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true, message: 'Logout erfolgreich.' });
});

export default router;
