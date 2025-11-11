/**
 * Authentication Utilities
 * 
 * Reusable functions for user management and JWT token creation
 * Used by LDAP authentication to sync users to PostgreSQL
 */

import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

/**
 * Get or create user in PostgreSQL database
 * If user doesn't exist (first LDAP login), creates them
 * 
 * @param {string} email - User's email address
 * @param {string} firstName - User's first name
 * @param {string} lastName - User's last name
 * @param {string} uid - LDAP UID
 * @returns {Promise<Object>} User object from database
 */
export async function getOrCreateUser(email, firstName, lastName, uid) {
    try {
        console.log(`🔍 Checking if user exists: ${email}`);
        
        // Check if user exists (by email or uid)
        const result = await pool.query(
            'SELECT account_id, first_name, last_name, email, role FROM account WHERE email = $1 OR uid = $2',
            [email, uid]
        );

        if (result.rows.length > 0) {
            console.log('✅ User found in database:', email);
            const user = result.rows[0];
            return {
                id: user.account_id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                name: `${user.first_name} ${user.last_name}`,
                role: user.role
            };
        }

        // User doesn't exist - create new entry (first LDAP login)
        console.log('🆕 Creating new user in database:', email);
        const insertResult = await pool.query(
            'INSERT INTO account (email, first_name, last_name, uid, last_ldap_sync) VALUES ($1, $2, $3, $4, NOW()) RETURNING account_id, email, first_name, last_name, role',
            [email, firstName, lastName, uid]
        );

        const newUser = insertResult.rows[0];
        return {
            id: newUser.account_id,
            email: newUser.email,
            firstName: newUser.first_name,
            lastName: newUser.last_name,
            name: `${newUser.first_name} ${newUser.last_name}`,
            role: newUser.role
        };
    } catch (err) {
        console.error('❌ Database error in getOrCreateUser:', err);
        throw new Error('Failed to get or create user in database');
    }
}

/**
 * Create JWT token with user data from PostgreSQL
 * 
 * @param {Object} user - User object with id, email, name, role
 * @returns {string} JWT token
 */
export function createAuthToken(user) {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET not configured');
    }

    const token = jwt.sign(
        { 
            id: user.id,
            email: user.email, 
            name: user.name,
            role: user.role
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );

    console.log('✅ JWT token created for user:', user.email);
    return token;
}

/**
 * Complete authentication flow: sync LDAP user to DB and create token
 * 
 * @param {Object} ldapUser - LDAP user data (email, uid, givenName, surname)
 * @returns {Promise<Object>} Object with token and user data
 */
export async function authenticateAndCreateToken(ldapUser) {
    try {
        console.log(`🔐 Starting authentication flow for: ${ldapUser.email}`);
        
        // 1. Get or create user in database
        const user = await getOrCreateUser(
            ldapUser.email,
            ldapUser.givenName || ldapUser.name.split(' ')[0],
            ldapUser.surname || ldapUser.name.split(' ')[1] || '',
            ldapUser.uid
        );
        
        // 2. Create JWT token
        const token = createAuthToken(user);
        
        // 3. Return complete auth response
        return {
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                isAdmin: user.role === 'berufsbilder'
            }
        };
    } catch (err) {
        console.error('❌ Authentication flow error:', err);
        throw err;
    }
}
