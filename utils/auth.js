/**
 * Authentication Utilities
 */

import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

export async function getOrCreateUser(email, firstName, lastName, uid) {
    const result = await pool.query(
        'SELECT account_id, first_name, last_name, email, role FROM account WHERE email = $1 OR uid = $2',
        [email, uid]
    );

    if (result.rows.length > 0) {
        console.log('✅ User found:', email);
        const user = result.rows[0];
        return {
            id: user.account_id,
            email: user.email,
            name: `${user.first_name} ${user.last_name}`,
            role: user.role
        };
    }

    console.log('🆕 Creating user:', email);
    const insertResult = await pool.query(
        'INSERT INTO account (email, first_name, last_name, uid, last_ldap_sync) VALUES ($1, $2, $3, $4, NOW()) RETURNING account_id, email, first_name, last_name, role',
        [email, firstName, lastName, uid]
    );

    const newUser = insertResult.rows[0];
    return {
        id: newUser.account_id,
        email: newUser.email,
        name: `${newUser.first_name} ${newUser.last_name}`,
        role: newUser.role
    };
}

export function createAuthToken(user) {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET not configured');

    const token = jwt.sign(
        { id: user.id, email: user.email, name: user.name, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );

    console.log('✅ Token created:', user.email);
    return token;
}