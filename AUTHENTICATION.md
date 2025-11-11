# TalentBinder Authentication System

## Overview

TalentBinder uses a **dual authentication system** with both LDAP and Local login methods:
- **LDAP authentication** - Primary method for account creation and network-based login
- **Local authentication** - Fallback method using bcrypt password hashes stored in PostgreSQL
- **PostgreSQL as single source of truth** - All JWT tokens generated from database records
- **Smart UI** - Automatic LDAP availability detection with mode switcher

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                         │
│  - LDAP status check on page load                              │
│  - Mode switcher (LDAP ↔ Local)                                │
│  - Visual indicators for LDAP availability                      │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ POST /api/auth/login
                         │ { email, password, preferredMethod }
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (Express.js)                         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   routes/auth.js                        │   │
│  │  • /api/auth/ldap-status - Check LDAP availability     │   │
│  │  • /api/auth/login - Dual auth endpoint                │   │
│  └───────────────────┬─────────────────────────────────────┘   │
│                      │                                          │
│           ┌──────────┴──────────┐                              │
│           ↓                     ↓                              │
│  ┌────────────────┐    ┌────────────────┐                     │
│  │  LDAP Path     │    │  Local Path    │                     │
│  │ (Account       │    │  (Existing     │                     │
│  │  Creation)     │    │   Users Only)  │                     │
│  └────────┬───────┘    └────────┬───────┘                     │
│           │                     │                              │
│           ↓                     ↓                              │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │         config/ldap.js                                  │  │
│  │  authenticateLdapUser(email, password)                  │  │
│  │    1. Search LDAP for UID by email                      │  │
│  │    2. Bind with user DN to validate password            │  │
│  │    3. Retrieve full user data                           │  │
│  │    → Returns: { uid, email, givenName, sn, ... }        │  │
│  └───────────────────────┬─────────────────────────────────┘  │
│                          │                                     │
│                          ↓                                     │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │         utils/auth.js                                   │  │
│  │  authenticateAndCreateToken(ldapUser)                   │  │
│  │    1. Check if user exists (by email or uid)            │  │
│  │    2. Create account if first login (password_hash=NULL)│  │
│  │    3. Update last_ldap_sync timestamp                   │  │
│  │    4. Create JWT from PostgreSQL data                   │  │
│  └───────────────────────┬─────────────────────────────────┘  │
│                          │                                     │
│           ┌──────────────┴──────────────┐                     │
│           ↓                             ↓                     │
│  ┌────────────────────┐      ┌──────────────────────┐        │
│  │  PostgreSQL        │      │  bcrypt.compare()    │        │
│  │  - Store/sync user │      │  - Validate local    │        │
│  │  - Generate JWT    │      │    password_hash     │        │
│  └────────────────────┘      └──────────────────────┘        │
│                                                                │
│  Returns: { token, user: { id, email, name, role, ... } }    │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend                                 │
│  - Store JWT in localStorage                                   │
│  - Store user data in localStorage                             │
│  - Redirect based on role (admin → /candidates, user → /events)│
└─────────────────────────────────────────────────────────────────┘
```

---

## Authentication Flow

### 1. LDAP Login (Account Creation Method)

**Primary authentication method - Creates new accounts automatically**

**Endpoint:** `POST /api/auth/login`

**Request:**
```json
{
  "email": "user@sunrise.net",
  "password": "ldap_password",
  "preferredMethod": "ldap"
}
```

**Backend Process:**

```javascript
// Step 1: Authenticate against LDAP
const ldapUser = await authenticateLdapUser(email, password);
// → Searches FreeIPA: (mail=user@sunrise.net)
// → Binds with user DN to validate password
// → Returns: { uid, email, givenName, sn, memberOf, ... }

// Step 2: Sync to PostgreSQL and create JWT
const { token, user } = await authenticateAndCreateToken(ldapUser);
// → Checks if user exists (by email or uid)
// → Creates account if first login (password_hash = NULL)
// → Updates last_ldap_sync timestamp
// → Generates JWT from PostgreSQL data

// JWT contains:
{
  account_id: user.account_id,
  email: user.email,
  first_name: user.first_name,
  last_name: user.last_name,
  role: user.role,  // 'berufsbilder' (admin) or 'recruiter'
  uid: user.uid
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login erfolgreich",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "account_id": 1,
    "email": "user@sunrise.net",
    "first_name": "John",
    "last_name": "Doe",
    "role": "recruiter",
    "isAdmin": false
  }
}
```

---

### 2. Local Login (Existing Users Only)

**Fallback method - Requires existing account with password_hash**

**Endpoint:** `POST /api/auth/login`

**Request:**
```json
{
  "email": "user@sunrise.net",
  "password": "local_password",
  "preferredMethod": "local"
}
```

**Backend Process:**

```javascript
// Step 1: Query PostgreSQL
const result = await pool.query(
  'SELECT * FROM account WHERE email = $1',
  [email]
);

// Step 2: Validate password_hash exists
if (!user.password_hash) {
  return res.status(401).json({
    message: 'Lokale Anmeldung für diesen Benutzer nicht verfügbar'
  });
}

// Step 3: Verify password with bcrypt
const isValid = await bcrypt.compare(password, user.password_hash);

// Step 4: Create JWT from PostgreSQL data
const token = jwt.sign({
  account_id: user.account_id,
  email: user.email,
  first_name: user.first_name,
  last_name: user.last_name,
  role: user.role,
  uid: user.uid
}, JWT_SECRET, { expiresIn: '8h' });
```

**Key Differences from LDAP:**
- ❌ Does NOT create new accounts
- ✅ Requires password_hash to be set (not NULL)
- ✅ Works when LDAP server unavailable
- ✅ Password validated against PostgreSQL only

---

### 3. LDAP Status Check

**Endpoint:** `GET /api/auth/ldap-status`

**Purpose:** Frontend checks LDAP server availability on page load

**Response:**
```json
{
  "ldapAvailable": true  // or false
}
```

**Frontend Behavior:**
- If `true`: LDAP button enabled by default
- If `false`: LDAP button shows ❌ indicator, Local selected by default

---

## Key Implementation Files

### `backend/config/ldap.js`
**Streamlined LDAP authentication interface**

```javascript
export async function authenticateLdapUser(email, password) {
  // 1. Search for user by email (using admin credentials)
  const uid = await getUidByEmail(email);
  
  // 2. Validate password by binding with user DN
  await validateUser(uid, password);
  
  // 3. Retrieve full user data
  const userData = await getAllDataByUid(uid);
  
  return {
    uid,
    email: userData.mail,
    givenName: userData.givenName,
    surname: userData.sn,
    department: userData.ou,
    title: userData.title,
    memberOf: userData.memberOf
  };
}
```

**Benefits:**
- Single function for complete LDAP authentication
- Clean interface for route handlers
- Handles all LDAP operations internally

---

### `backend/utils/auth.js`
**LDAP-to-PostgreSQL synchronization**

```javascript
export async function authenticateAndCreateToken(ldapUser) {
  // 1. Check if user exists
  let result = await pool.query(
    'SELECT * FROM account WHERE email = $1 OR uid = $2',
    [ldapUser.email, ldapUser.uid]
  );
  
  let user;
  
  if (result.rows.length === 0) {
    // 2. Create new user (first LDAP login)
    result = await pool.query(
      `INSERT INTO account (first_name, last_name, email, uid, password_hash, role, last_ldap_sync)
       VALUES ($1, $2, $3, $4, NULL, 'recruiter', CURRENT_TIMESTAMP)
       RETURNING *`,
      [ldapUser.givenName, ldapUser.surname, ldapUser.email, ldapUser.uid]
    );
    user = result.rows[0];
  } else {
    // 3. Update existing user
    result = await pool.query(
      `UPDATE account 
       SET last_ldap_sync = CURRENT_TIMESTAMP,
           first_name = $1,
           last_name = $2
       WHERE account_id = $3
       RETURNING *`,
      [ldapUser.givenName, ldapUser.surname, result.rows[0].account_id]
    );
    user = result.rows[0];
  }
  
  // 4. Create JWT from PostgreSQL data
  const token = jwt.sign({
    account_id: user.account_id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    uid: user.uid
  }, JWT_SECRET, { expiresIn: '8h' });
  
  return { token, user };
}
```

---

### `backend/routes/auth.js`
**Dual authentication endpoint**

```javascript
router.post('/login', async (req, res) => {
  const { email, password, preferredMethod } = req.body;
  
  try {
    if (preferredMethod === 'ldap') {
      // LDAP Path: Create/sync user
      const ldapUser = await authenticateLdapUser(email, password);
      const { token, user } = await authenticateAndCreateToken(ldapUser);
      
      return res.json({
        success: true,
        message: 'LDAP-Anmeldung erfolgreich',
        token,
        user
      });
      
    } else if (preferredMethod === 'local') {
      // Local Path: Validate existing user
      const result = await pool.query(
        'SELECT * FROM account WHERE email = $1',
        [email]
      );
      
      if (result.rows.length === 0) {
        return res.status(401).json({
          message: 'Ungültige Anmeldedaten'
        });
      }
      
      const user = result.rows[0];
      
      // Check password_hash exists
      if (!user.password_hash) {
        return res.status(401).json({
          message: 'Lokale Anmeldung für diesen Benutzer nicht verfügbar'
        });
      }
      
      // Validate password
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({
          message: 'Ungültige Anmeldedaten'
        });
      }
      
      // Create JWT
      const token = jwt.sign({
        account_id: user.account_id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        uid: user.uid
      }, JWT_SECRET, { expiresIn: '8h' });
      
      return res.json({
        success: true,
        message: 'Lokale Anmeldung erfolgreich',
        token,
        user
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      message: 'Anmeldefehler'
    });
  }
});

// LDAP status check
router.get('/ldap-status', async (req, res) => {
  try {
    const client = ldap.createClient({ url: LDAP_URL });
    await client.bind(LDAP_ADMIN_DN, LDAP_ADMIN_PASSWORD);
    client.unbind();
    
    res.json({ ldapAvailable: true });
  } catch (error) {
    res.json({ ldapAvailable: false });
  }
});
```

---

### `frontend/src/pages/Login/Login.tsx`
**Smart login UI with mode switcher**

```tsx
const Login: React.FC = () => {
  const [loginMode, setLoginMode] = useState<'ldap' | 'local'>('ldap');
  const [ldapAvailable, setLdapAvailable] = useState<boolean | null>(null);
  
  // Check LDAP status on mount
  useEffect(() => {
    fetch('/api/auth/ldap-status')
      .then(res => res.json())
      .then(data => setLdapAvailable(data.ldapAvailable));
  }, []);
  
  const handleSubmit = async (e: React.FormEvent) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        preferredMethod: loginMode  // 'ldap' or 'local'
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = data.user.role === 'berufsbilder' 
        ? '/candidates' 
        : '/events';
    }
  };
  
  return (
    <div>
      {/* Mode Switcher */}
      <div className="login-mode-switcher">
        <button 
          className={loginMode === 'ldap' ? 'active' : ''}
          onClick={() => setLoginMode('ldap')}
        >
          LDAP {ldapAvailable === false && '❌'}
        </button>
        <button 
          className={loginMode === 'local' ? 'active' : ''}
          onClick={() => setLoginMode('local')}
        >
          Lokal
        </button>
      </div>
      
      {/* Login Form */}
      <form onSubmit={handleSubmit}>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} />
        <input 
          type="password" 
          placeholder={loginMode === 'ldap' ? 'LDAP-Passwort' : 'Lokales Passwort'}
          value={password} 
          onChange={e => setPassword(e.target.value)} 
        />
        <button type="submit">Einloggen</button>
      </form>
    </div>
  );
};
```

---

## Configuration

### Environment Variables

```bash
# Database
DB_URL=postgresql://user:password@host:port/talent_binder

# JWT
JWT_SECRET=your_jwt_secret_here

# LDAP Server (FreeIPA)
LDAP_URL=ldap://idm.lab.local:389
LDAP_BASE_DN=dc=lab,dc=local
LDAP_USERS_DN=cn=users,cn=compat,dc=lab,dc=local
LDAP_ADMIN_DN=uid=admin,cn=users,cn=accounts,dc=lab,dc=local
LDAP_ADMIN_PASSWORD=your_ldap_admin_password
```

---

## Database Schema

### Account Table
```sql
CREATE TABLE account (
    account_id SERIAL PRIMARY KEY,
    first_name VARCHAR(64) NOT NULL,
    last_name VARCHAR(64) NOT NULL,
    email TEXT UNIQUE NOT NULL,
    uid VARCHAR(100) UNIQUE,  -- LDAP UID (e.g., 'john.doe')
    password_hash VARCHAR(100),  -- NULL for LDAP-only, bcrypt hash for local auth
    role account_role NOT NULL DEFAULT 'recruiter',
    last_ldap_sync TIMESTAMP,  -- Updated on each LDAP login
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE account_role AS ENUM ('berufsbilder', 'recruiter');
-- berufsbilder = Admin/Trainer with full privileges
-- recruiter = Regular user with limited access
```

**Password Hash Values:**
- `NULL` = LDAP-only user (cannot use local login)
- `bcrypt hash` = Can use local login (dual-auth capable)

**Account Creation:**
- New accounts created ONLY via LDAP first login
- No self-registration endpoint
- Admin can set `password_hash` to enable local login

---

## Admin Tasks

### Setting Local Password for Users

**Generate bcrypt hash:**
```javascript
// Node.js
import bcrypt from 'bcryptjs';
const hash = await bcrypt.hash('password123', 10);
console.log(hash);  // $2b$10$...
```

**Update database:**
```sql
UPDATE account 
SET password_hash = '$2b$10$...'  -- Paste bcrypt hash
WHERE email = 'user@sunrise.net';
```

**Result:** User can now login with both LDAP and Local methods

---

### Checking User Authentication Methods

```sql
SELECT 
  account_id,
  email,
  first_name,
  last_name,
  CASE 
    WHEN password_hash IS NULL THEN 'LDAP only'
    WHEN uid IS NOT NULL THEN 'LDAP + Local'
    ELSE 'Local only'
  END as auth_methods,
  role,
  last_ldap_sync,
  created_at
FROM account
ORDER BY created_at DESC;
```

---

### Revoking Local Access

```sql
-- Remove local login capability
UPDATE account 
SET password_hash = NULL 
WHERE email = 'user@sunrise.net';
```

---

## Security Features

### 1. Dual Authentication Options
- **LDAP:** Direct authentication against FreeIPA server
- **Local:** Bcrypt-hashed passwords in PostgreSQL
- **Flexibility:** Users can have both methods enabled

### 2. JWT Token Security
- **8-hour expiration** - Users re-login after expiration
- **Stored in localStorage** - Accessible by frontend
- **Contains minimal data** - Only ID, email, name, role
- **PostgreSQL as source** - Always generated from database records

### 3. Password Security
- **LDAP passwords:** Never stored locally, validated by FreeIPA
- **Local passwords:** Bcrypt hashed with salt rounds = 10
- **No plaintext:** Passwords never logged or stored unhashed

### 4. Role-Based Access Control (RBAC)
- **Two roles:** `berufsbilder` (admin) and `recruiter` (user)
- **Middleware protected:** `authRequired` and `checkAdmin`
- **Frontend routing:** Admins → `/candidates`, Users → `/events`

### 5. LDAP Connection Management
- **Admin bind for searches:** Uses service account credentials
- **User bind for validation:** Validates with user's own credentials
- **Proper cleanup:** Connections unbind after operations
- **Error handling:** Graceful fallback to local auth if LDAP unavailable

---

## Frontend Integration

### Login Example
```typescript
const handleLogin = async (email: string, password: string, mode: 'ldap' | 'local') => {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, preferredMethod: mode })
  });

  if (response.ok) {
    const data = await response.json();
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    
    // Redirect based on role
    window.location.href = data.user.role === 'berufsbilder' 
      ? '/candidates' 
      : '/events';
  } else {
    const error = await response.json();
    alert(error.message);
  }
};
```

### Protected API Calls
```typescript
const fetchProtectedData = async () => {
  const token = localStorage.getItem('token');
  
  const response = await fetch('/api/candidates', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (response.status === 401) {
    // Token expired or invalid
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
  }
  
  return response.json();
};
```

### Logout
```typescript
const handleLogout = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
};
```

---

## Troubleshooting

### LDAP Server Unavailable
**Symptoms:**
- LDAP button shows ❌ in UI
- LDAP login fails with connection error

**Solutions:**
1. Check VPN connection (must be on DAL network)
2. Verify LDAP server is running: `ping idm.lab.local`
3. Test LDAP connection: `ldapsearch -x -H ldap://idm.lab.local -b "dc=lab,dc=local"`
4. Use Local login as fallback

---

### User Cannot Login Locally
**Symptoms:**
- Error: "Lokale Anmeldung für diesen Benutzer nicht verfügbar"

**Cause:** User's `password_hash` is NULL

**Solution:**
```sql
-- Check current status
SELECT email, password_hash FROM account WHERE email = 'user@sunrise.net';

-- Set local password (using bcrypt hash)
UPDATE account 
SET password_hash = '$2b$10$...'  -- Generate with bcrypt
WHERE email = 'user@sunrise.net';
```

---

### Token Expired
**Symptoms:**
- API returns 401 Unauthorized
- User redirected to login

**Cause:** JWT token expired after 8 hours

**Solution:** User must login again (no refresh tokens implemented)

---

### LDAP User Not Found
**Symptoms:**
- Error: "Ungültige Anmeldedaten"

**Causes:**
1. Email doesn't exist in LDAP directory
2. LDAP_BASE_DN or LDAP_USERS_DN incorrect
3. User not in correct organizational unit

**Debugging:**
```bash
# Test LDAP search manually
ldapsearch -x -H ldap://idm.lab.local \
  -D "uid=admin,cn=users,cn=accounts,dc=lab,dc=local" \
  -w "admin_password" \
  -b "dc=lab,dc=local" \
  "(mail=user@sunrise.net)"
```

---

### Invalid LDAP Credentials
**Symptoms:**
- Login fails even with correct email/password

**Causes:**
1. LDAP admin credentials incorrect (LDAP_ADMIN_DN/PASSWORD)
2. User password expired in LDAP
3. User account locked/disabled in LDAP

**Check:**
```javascript
// Test admin bind
const client = ldap.createClient({ url: LDAP_URL });
client.bind(LDAP_ADMIN_DN, LDAP_ADMIN_PASSWORD, (err) => {
  if (err) console.error('Admin bind failed:', err);
  else console.log('Admin bind successful');
});
```

---

## Best Practices

### 1. Password Management
- ✅ Never log passwords (even hashed)
- ✅ Use bcrypt with salt rounds ≥ 10
- ✅ Validate password strength before setting
- ✅ Consider password expiration policy

### 2. Token Handling
- ✅ Store JWT in localStorage (not cookies for SPA)
- ✅ Include token in Authorization header
- ✅ Clear token on logout
- ✅ Handle 401 errors globally (redirect to login)

### 3. LDAP Connection Management
- ✅ Always unbind after operations
- ✅ Use try/finally blocks
- ✅ Implement connection timeouts
- ✅ Handle connection errors gracefully

### 4. Error Messages
- ✅ Generic messages to frontend ("Ungültige Anmeldedaten")
- ✅ Detailed logs on backend (console.error)
- ✅ Never expose LDAP structure to users
- ✅ Use German for user-facing messages

### 5. Security
- ✅ Validate email format before LDAP queries
- ✅ Rate limit login endpoint (prevent brute force)
- ✅ Monitor failed login attempts
- ✅ Use HTTPS in production
- ✅ Keep JWT_SECRET secure (environment variable)

---

## Development vs Production

### Development
```bash
NODE_ENV=development
# - Detailed error messages
# - Console logging enabled
# - LDAP may be unavailable (use local auth)
```

### Production
```bash
NODE_ENV=production
# - Generic error messages
# - Structured logging to file
# - HTTPS required
# - Rate limiting on /login
# - Monitor LDAP availability
# - Backup local admin account
```

---

## Testing Checklist

### Backend Tests
- [ ] LDAP login creates new user on first login
- [ ] LDAP login updates existing user (last_ldap_sync)
- [ ] Local login validates bcrypt password_hash
- [ ] Local login fails if password_hash is NULL
- [ ] LDAP status endpoint returns correct availability
- [ ] JWT token contains correct user data
- [ ] Token expires after 8 hours
- [ ] Both auth methods return same JWT structure

### Frontend Tests
- [ ] LDAP status check runs on page load
- [ ] Mode switcher toggles between LDAP/Local
- [ ] LDAP button shows ❌ when unavailable
- [ ] Login redirects based on role
- [ ] Token stored in localStorage
- [ ] Expired token redirects to login
- [ ] Logout clears token and redirects

### Integration Tests
- [ ] LDAP → Local fallback works seamlessly
- [ ] Dual-auth users can login with both methods
- [ ] Admin can set password_hash via database
- [ ] Role-based routing works correctly
- [ ] Protected routes require valid token

---

## Quick Reference

### Login Flow Decision Tree
```
User enters email/password
         ↓
    Selects method
         ↓
    ┌────┴────┐
    │         │
  LDAP      Local
    │         │
    ↓         ↓
Validate   Query DB
on FreeIPA    │
    │         ↓
    │    Check password_hash
    │         │
    ↓         ↓
Create/Sync  Validate bcrypt
  User         │
    │         │
    └────┬────┘
         ↓
   Generate JWT
   from PostgreSQL
         ↓
    Return token
```

### Error Response Codes
| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Process response |
| 400 | Bad request | Check request format |
| 401 | Unauthorized | Invalid credentials or expired token |
| 403 | Forbidden | Admin access required |
| 500 | Server error | Check backend logs |
| 503 | LDAP unavailable | Use local login |

### Environment Variables Required
```bash
DB_URL=postgresql://...
JWT_SECRET=...
LDAP_URL=ldap://idm.lab.local
LDAP_BASE_DN=dc=lab,dc=local
LDAP_USERS_DN=cn=users,cn=compat,dc=lab,dc=local
LDAP_ADMIN_DN=uid=admin,cn=users,cn=accounts,dc=lab,dc=local
LDAP_ADMIN_PASSWORD=...
```

---

## Summary

**TalentBinder authentication system provides:**
- ✅ Dual authentication (LDAP + Local)
- ✅ Automatic account creation via LDAP
- ✅ Fallback to local auth when LDAP unavailable
- ✅ PostgreSQL as single source of truth
- ✅ Role-based access control
- ✅ Smart UI with availability detection
- ✅ Secure password handling (bcrypt + LDAP)
- ✅ 8-hour JWT sessions

**For new developers:**
1. Review authentication flow diagrams
2. Check environment variables are set
3. Test LDAP connection with ldapsearch
4. Understand dual auth paths in routes/auth.js
5. Test both login methods
6. Review error handling and troubleshooting section
