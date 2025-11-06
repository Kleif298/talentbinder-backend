/**
 * LDAP Configuration and Authentication Module
 * 
 * Provides functions to interact with LDAP directory for user authentication
 * and information retrieval. Uses admin credentials for searches and user
 * credentials for password validation.
 */

import ldap from 'ldapjs';
import dotenv from "dotenv";

dotenv.config();

const LDAP_CONFIG = {
    url: process.env.LDAP_URL || 'ldap://idm.lab.local',
    baseDN: process.env.LDAP_BASE_DN || 'dc=lab,dc=local',
    usersDN: process.env.LDAP_USERS_DN || 'cn=users,cn=compat,dc=lab,dc=local',
    adminDN: process.env.LDAP_ADMIN_DN,
    adminPassword: process.env.LDAP_ADMIN_PASSWORD,
    searchAttributes: ['uid', 'mail', 'givenName', 'sn', 'memberOf']
};

// Debug: Log LDAP configuration (without password)
console.log('🔐 LDAP Configuration:', {
    url: LDAP_CONFIG.url,
    baseDN: LDAP_CONFIG.baseDN,
    usersDN: LDAP_CONFIG.usersDN,
    adminDN: LDAP_CONFIG.adminDN,
    adminPasswordSet: !!LDAP_CONFIG.adminPassword,
    adminPasswordLength: LDAP_CONFIG.adminPassword?.length
});

/**
 * Helper: Convert LDAP entry attributes array to plain object
 * Similar to Python's entry_attributes_as_dict
 * 
 * @param {Object} entry - LDAP search entry
 * @returns {Object} Plain object with attribute key-value pairs
 */
function entryToObject(entry) {
    const obj = {};
    entry.attributes.forEach(attr => {
        if (attr.values && attr.values.length > 0) {
            // Single value: store as string, multiple values: store as array
            obj[attr.type] = attr.values.length === 1 ? attr.values[0] : attr.values;
        }
    });
    return obj;
}

/**
 * Create authenticated LDAP client with admin credentials
 * Private function - used internally for searches
 * 
 * @returns {Promise<Client>} Authenticated LDAP client
 * @throws {Error} If connection or bind fails
 */
function _createAdminClient() {
    // Validate admin credentials before attempting connection
    if (!LDAP_CONFIG.adminDN || !LDAP_CONFIG.adminPassword) {
        console.error('❌ LDAP admin credentials not configured!');
        console.error('Missing:', {
            adminDN: !LDAP_CONFIG.adminDN ? 'LDAP_ADMIN_DN environment variable' : 'OK',
            adminPassword: !LDAP_CONFIG.adminPassword ? 'LDAP_ADMIN_PASSWORD environment variable' : 'OK'
        });
        throw new Error('LDAP admin credentials not configured. Check .env.ldap file.');
    }

    console.log('🔌 Creating LDAP client connection to:', LDAP_CONFIG.url);
    
    const client = ldap.createClient({ 
        url: LDAP_CONFIG.url,
        timeout: 5000,
        connectTimeout: 10000
    });
    
    return new Promise((resolve, reject) => {
        // Handle connection errors to prevent crashes
        client.on('error', (err) => {
            console.error('❌ LDAP client error:', err.message);
            client.unbind();
            reject(new Error(`LDAP connection failed: ${err.message}`));
        });

        console.log('🔐 Attempting LDAP bind with admin DN:', LDAP_CONFIG.adminDN);
        
        // Authenticate with admin credentials
        client.bind(LDAP_CONFIG.adminDN, LDAP_CONFIG.adminPassword, (err) => {
            if (err) {
                console.error('❌ LDAP admin bind failed:', err.message);
                client.unbind();
                reject(new Error(`LDAP admin bind failed: ${err.message}`));
            } else {
                console.log('✅ LDAP admin bind successful');
                resolve(client);
            }
        });
    });
}

/**
 * Validate user credentials by attempting LDAP bind
 * 
 * @param {string} uid - User's unique identifier
 * @param {string} password - User's password
 * @returns {Promise<boolean>} True if credentials are valid, false otherwise
 */
async function validateUser(uid, password) {
    const userDN = `uid=${uid},${LDAP_CONFIG.usersDN}`;
    const client = ldap.createClient({ 
        url: LDAP_CONFIG.url,
        timeout: 5000,
        connectTimeout: 10000
    });

    // Handle connection errors
    client.on('error', (err) => {
        console.error('LDAP error during validation:', err.message);
    });

    try {
        return await new Promise((resolve) => {
            // Try to bind with user credentials
            client.bind(userDN, password, (err) => {
                if (err) {
                    // Bind failed = invalid password
                    resolve(false);
                } else {
                    // Bind succeeded = valid password
                    resolve(true);
                }
            });
        });
    } finally {
        client.unbind();
    }
}

/**
 * Get user's UID by email address
 * 
 * @param {string} email - User's email address
 * @returns {Promise<string>} User's UID
 * @throws {Error} If user not found or search fails
 */
async function getUidByEmail(email) {
    const client = await _createAdminClient();

    try {
        const searchOptions = {
            filter: `(&(objectClass=person)(mail=${email}))`,
            scope: 'sub',
            attributes: ['uid']
        };

        return await new Promise((resolve, reject) => {
            client.search(LDAP_CONFIG.baseDN, searchOptions, (err, res) => {
                if (err) {
                    return reject(err);
                }

                let uid = null;
                
                res.on('searchEntry', (entry) => {
                    // Convert entry to object and extract UID
                    const obj = entryToObject(entry);
                    uid = obj.uid;
                });

                res.on('end', () => {
                    if (uid) {
                        resolve(uid);
                    } else {
                        reject(new Error('User not found'));
                    }
                });

                res.on('error', reject);
            });
        });
    } finally {
        client.unbind();
    }
}

/**
 * Get detailed user information from LDAP
 * 
 * @param {string} uid - User's unique identifier
 * @returns {Promise<Object>} Object containing user attributes (uid, mail, givenName, sn, memberOf)
 * @throws {Error} If user not found or search fails
 */
async function getUserDetails(uid) {
    const client = await _createAdminClient();

    try {
        const searchOptions = {
            filter: `(&(objectClass=person)(uid=${uid}))`,
            scope: 'sub',
            attributes: LDAP_CONFIG.searchAttributes
        };

        return await new Promise((resolve, reject) => {
            client.search(LDAP_CONFIG.baseDN, searchOptions, (err, res) => {
                if (err) {
                    return reject(err);
                }

                let userDetails = null;
                
                res.on('searchEntry', (entry) => {
                    // Convert LDAP entry to plain object
                    userDetails = entryToObject(entry);
                });

                res.on('end', () => {
                    if (userDetails) {
                        resolve(userDetails);
                    } else {
                        reject(new Error('User not found'));
                    }
                });

                res.on('error', reject);
            });
        });
    } finally {
        client.unbind();
    }
}

/**
 * Check if user is member of a specific group
 * 
 * @param {string} uid - User's unique identifier
 * @param {string} groupName - Group name to check (e.g., 'admins')
 * @returns {Promise<boolean>} True if user is member, false otherwise
 */
async function userIsMemberOf(uid, groupName) {
    const client = await _createAdminClient();

    try {
        const searchOptions = {
            filter: `(&(objectClass=person)(uid=${uid})(memberOf=*cn=${groupName}*))`,
            scope: 'sub',
            attributes: ['uid']
        };

        return await new Promise((resolve, reject) => {
            client.search(LDAP_CONFIG.baseDN, searchOptions, (err, res) => {
                if (err) {
                    return reject(err);
                }

                let found = false;
                
                res.on('searchEntry', () => {
                    found = true;
                });

                res.on('end', () => {
                    resolve(found);
                });

                res.on('error', reject);
            });
        });
    } finally {
        client.unbind();
    }
}

/**
 * Check if user exists in LDAP directory
 * 
 * @param {string} uid - User's unique identifier
 * @returns {Promise<boolean>} True if user exists, false otherwise
 */
async function userExists(uid) {
    const client = await _createAdminClient();

    try {
        const searchOptions = {
            filter: `(&(objectClass=person)(uid=${uid}))`,
            scope: 'sub',
            attributes: ['uid']
        };

        return await new Promise((resolve, reject) => {
            client.search(LDAP_CONFIG.baseDN, searchOptions, (err, res) => {
                if (err) {
                    return reject(err);
                }

                let found = false;
                
                res.on('searchEntry', () => {
                    found = true;
                });

                res.on('end', () => {
                    resolve(found);
                });

                res.on('error', reject);
            });
        });
    } finally {
        client.unbind();
    }
}

export {
    validateUser,
    getUidByEmail,
    getUserDetails,
    userIsMemberOf,
    userExists,
    LDAP_CONFIG
};