/**
 * Migration: Add password_hash column to Account table
 * 
 * Run this script once to add local password support
 * Usage: node migrations/add-password-hash.js
 */

import { pool } from '../config/db.js';

async function migrate() {
    try {
        console.log('🔄 Checking if password_hash column exists...');
        
        // Check if column exists
        const checkColumn = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'account' 
            AND column_name = 'password_hash'
        `);

        if (checkColumn.rows.length > 0) {
            console.log('✅ password_hash column already exists');
            return;
        }

        console.log('➕ Adding password_hash column to Account table...');
        
        await pool.query(`
            ALTER TABLE Account 
            ADD COLUMN password_hash VARCHAR(255) NULL
        `);

        console.log('✅ Migration complete! password_hash column added');
        console.log('');
        console.log('Users can now set local passwords using the /api/auth/set-local-password endpoint');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

migrate();
