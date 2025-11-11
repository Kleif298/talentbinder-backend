/**
 * LDAP Configuration and Authentication Module
 * 
 * Provides streamlined functions for LDAP authentication.
 * Main entry point: authenticateLdapUser(email, password)
 */

import ldap from 'ldapjs';

const LDAP_CONFIG = {
    url: process.env.LDAP_URL || 'ldap://idm.lab.local',
    baseDN: process.env.LDAP_BASE_DN || 'dc=lab,dc=local',
    usersDN: process.env.LDAP_USERS_DN || 'cn=users,cn=compat,dc=lab,dc=local',
    adminDN: process.env.LDAP_ADMIN_DN,
    adminPassword: process.env.LDAP_ADMIN_PASSWORD,
    searchAttributes: ['uid', 'mail', 'givenName', 'sn', 'cn', 'memberOf', 'department', 
                       'departmentNumber', 'ou', 'title', 'manager', 'employeeType', 
                       'employeeNumber', 'o', 'description']
};

console.log('🔐 LDAP Configuration:', {
    url: LDAP_CONFIG.url,
    baseDN: LDAP_CONFIG.baseDN,
    usersDN: LDAP_CONFIG.usersDN,
    adminDN: LDAP_CONFIG.adminDN,
    adminPasswordSet: !!LDAP_CONFIG.adminPassword
});

/**
 * Helper: Convert LDAP entry attributes array to plain object
 */
function entryToObject(entry) {
    const obj = {};
    entry.attributes.forEach(attr => {
        if (attr.values && attr.values.length > 0) {
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
    if (!LDAP_CONFIG.adminDN || !LDAP_CONFIG.adminPassword) {
        console.error('❌ LDAP admin credentials not configured!');
        throw new Error('LDAP admin credentials not configured. Check .env.ldap file.');
    }

    const client = ldap.createClient({ 
        url: LDAP_CONFIG.url,
        timeout: 5000,
        connectTimeout: 10000
    });
    
    return new Promise((resolve, reject) => {
        client.on('error', (err) => {
            console.error('❌ LDAP client error:', err.message);
            client.unbind();
            reject(new Error(`LDAP connection failed: ${err.message}`));
        });

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

        console.log('🔍 LDAP: Searching for UID with email:', email);

        return await new Promise((resolve, reject) => {
            client.search(LDAP_CONFIG.baseDN, searchOptions, (err, res) => {
                if (err) {
                    return reject(err);
                }

                let uid = null;
                
                res.on('searchEntry', (entry) => {
                    const obj = entryToObject(entry);
                    uid = obj.uid;
                    console.log('✅ LDAP: Found UID:', uid);
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
 * Validate user credentials by attempting LDAP bind
 * 
 * @param {string} uid - User's unique identifier
 * @param {string} password - User's password
 * @returns {Promise<boolean>} True if credentials are valid, false otherwise
 */
async function validateUser(uid, password) {
    const userDN = `uid=${uid},${LDAP_CONFIG.usersDN}`;
    
    console.log('� LDAP: Validating user credentials for UID:', uid);
    
    const client = ldap.createClient({ 
        url: LDAP_CONFIG.url,
        timeout: 5000,
        connectTimeout: 10000
    });

    client.on('error', (err) => {
        console.error('❌ LDAP error during validation:', err.message);
    });

    try {
        return await new Promise((resolve) => {
            client.bind(userDN, password, (err) => {
                if (err) {
                    console.error('❌ LDAP bind failed for user:', uid, '-', err.message);
                    resolve(false);
                } else {
                    console.log('✅ LDAP bind successful for user:', uid);
                    resolve(true);
                }
            });
        });
    } finally {
        client.unbind();
    }
}

/**
 * Get all user data by UID
 * 
 * @param {string} uid - User's unique identifier
 * @returns {Promise<Object>} Object containing all user attributes
 * @throws {Error} If user not found or search fails
 */
async function getAllDataByUid(uid) {
    const client = await _createAdminClient();

    try {
        const searchOptions = {
            filter: `(&(objectClass=person)(uid=${uid}))`,
            scope: 'sub',
            attributes: LDAP_CONFIG.searchAttributes
        };

        console.log('🔍 LDAP: Fetching all data for UID:', uid);

        return await new Promise((resolve, reject) => {
            client.search(LDAP_CONFIG.baseDN, searchOptions, (err, res) => {
                if (err) {
                    return reject(err);
                }

                let userDetails = null;
                
                res.on('searchEntry', (entry) => {
                    userDetails = entryToObject(entry);
                    console.log('✅ LDAP: Retrieved user data:', {
                        uid: userDetails.uid,
                        mail: userDetails.mail,
                        name: userDetails.cn || `${userDetails.givenName} ${userDetails.sn}`
                    });
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
 * Authenticate LDAP user - Main authentication function
 * Combines: getUidByEmail -> validateUser -> getAllDataByUid
 * 
 * @param {string} email - User's email address
 * @param {string} password - User's password
 * @returns {Promise<Object|null>} User data if authentication successful, null otherwise
 */
export async function authenticateLdapUser(email, password) {
    try {
        console.log('🔐 LDAP: Starting authentication for:', email);
        
        // Step 1: Get UID from email
        const uid = await getUidByEmail(email);
        console.log('✅ LDAP: Step 1/3 - Got UID:', uid);
        
        // Step 2: Validate password
        const isValid = await validateUser(uid, password);
        if (!isValid) {
            console.log('❌ LDAP: Step 2/3 - Invalid password');
            return null;
        }
        console.log('✅ LDAP: Step 2/3 - Password validated');
        
        // Step 3: Get all user data
        const userData = await getAllDataByUid(uid);
        console.log('✅ LDAP: Step 3/3 - Retrieved user data');
        
        // Return formatted user object
        return {
            uid: userData.uid,
            email: userData.mail,
            name: userData.cn || `${userData.givenName || ''} ${userData.sn || ''}`.trim(),
            givenName: userData.givenName,
            surname: userData.sn,
            department: userData.department,
            title: userData.title,
            memberOf: userData.memberOf
        };
    } catch (err) {
        console.error('❌ LDAP: Authentication failed:', err.message);
        return null;
    }
}

/**
 * Check if LDAP server is reachable
 * 
 * @returns {Promise<boolean>} True if server is reachable, false otherwise
 */
export async function isLdapServerReachable() {
    return new Promise((resolve) => {
        const client = ldap.createClient({ 
            url: LDAP_CONFIG.url,
            timeout: 3000,
            connectTimeout: 3000
        });

        let resolved = false;

        client.on('connect', () => {
            if (!resolved) {
                resolved = true;
                console.log('✅ LDAP server is reachable:', LDAP_CONFIG.url);
                client.unbind();
                resolve(true);
            }
        });

        client.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                console.log('❌ LDAP server unreachable:', err.message);
                client.unbind();
                resolve(false);
            }
        });

        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                console.log('⏱️ LDAP server check timeout');
                client.unbind();
                resolve(false);
            }
        }, 3500);
    });
}