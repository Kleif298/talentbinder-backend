# TalentBinder Authentication System

## Overview

TalentBinder uses **LDAP-based authentication** with JWT sessions and local database synchronization. Users authenticate against an LDAP directory server, and their information is synced to a local PostgreSQL database for application-specific data.

---

## Architecture

```
┌─────────────┐
│   Frontend  │
│  (React)    │
└──────┬──────┘
       │ 1. POST /api/auth/login
       │    { email, password }
       ↓
┌─────────────────────────────────────────┐
│         Backend (Express.js)            │
│  ┌───────────────────────────────────┐  │
│  │  routes/auth.js                   │  │
│  │  - Login endpoint                 │  │
│  │  - Logout endpoint                │  │
│  │  - Verify endpoint                │  │
│  └────────┬──────────────────────────┘  │
│           │                              │
│           ↓                              │
│  ┌───────────────────────────────────┐  │
│  │  config/ldap.js                   │  │
│  │  2. getUidByEmail(email)          │──┐
│  │     → LDAP search                 │  │
│  │  3. validateUser(uid, password)   │  │
│  │     → LDAP bind                   │  │
│  │  4. getUserDetails(uid)           │  │
│  │     → LDAP search                 │  │
│  │  5. userIsMemberOf(uid, 'admins') │  │
│  │     → LDAP search                 │  │
│  └───────────────────────────────────┘  │
│           │                              │
│           ↓                              │
│  ┌───────────────────────────────────┐  │
│  │  Local Database (PostgreSQL)      │  │
│  │  6. Sync user data                │  │
│  │     - Create if new               │  │
│  │     - Update admin status         │  │
│  └───────────────────────────────────┘  │
│           │                              │
│           ↓                              │
│  ┌───────────────────────────────────┐  │
│  │  JWT Token Generation             │  │
│  │  7. Create token with user data   │  │
│  │  8. Set httpOnly cookie           │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
       │
       │ Response: { success: true, user: {...} }
       │ Cookie: token=<JWT>
       ↓
┌─────────────┐
│   Frontend  │
│  Stores user│
│  in localStorage
└─────────────┘
```

---

## Authentication Flow

### 1. User Login

**Endpoint:** `POST /api/auth/login`

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Process:**

```javascript
// Step 1: Get UID from email
const uid = await getUidByEmail(email);
// LDAP Search: (&(objectClass=person)(mail=user@example.com))
// Returns: "john.doe"

// Step 2: Validate password
const isValid = await validateUser(uid, password);
// LDAP Bind: uid=john.doe,cn=users,cn=compat,dc=lab,dc=local
// Returns: true/false

// Step 3: Get user details
const ldapUser = await getUserDetails(uid);
// LDAP Search: (&(objectClass=person)(uid=john.doe))
// Returns: { uid: 'john.doe', mail: 'user@example.com', givenName: 'John', sn: 'Doe', memberOf: [...] }

// Step 4: Check admin status
const isAdmin = await userIsMemberOf(uid, 'admins');
// LDAP Search: (&(objectClass=person)(uid=john.doe)(memberOf=*cn=admins*))
// Returns: true/false

// Step 5: Sync to database
// Map LDAP admin to database role
const role = isAdmin ? 'berufsbilder' : 'recruiter';

// INSERT or UPDATE in Account table
// Note: password_hash is set to 'ldap_managed' (not used for authentication)

// Step 6: Create JWT token
const token = jwt.sign({
  id: user.account_id,
  email: user.email,
  username: ldapUser.uid,
  firstName: ldapUser.givenName,
  lastName: ldapUser.sn,
  role: user.role,  // 'berufsbilder' or 'recruiter'
  isAdmin: user.role === 'berufsbilder',  // Convenience flag
  uid: uid
}, JWT_SECRET, { expiresIn: '8h' });

// Step 7: Set httpOnly cookie
res.cookie('token', token, {
  httpOnly: true,
  secure: NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 8 * 60 * 60 * 1000
});
```

**Response:**
```json
{
  "success": true,
  "message": "Login erfolgreich.",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "john.doe",
    "firstName": "John",
    "lastName": "Doe",
    "role": "recruiter",
    "isAdmin": false
  }
}
```

---

### 2. Protected Routes

**Middleware:** `authRequired` + `checkAdmin`

```javascript
import { authRequired, checkAdmin } from './middleware/auth.js';

// Require authentication
app.use('/api/candidates', authRequired, candidatesRouter);

// Require admin role
app.use('/api/users', authRequired, checkAdmin, usersRouter);
```

**Flow:**
1. Extract token from `req.cookies.token`
2. Verify JWT signature and expiration
3. Attach decoded user to `req.user`
4. (Optional) Check if `req.user.isAdmin === true`

---

### 3. User Logout

**Endpoint:** `POST /api/auth/logout`

**Process:**
1. Extract token from cookie
2. Decode token to get user info
3. Log logout event in audit_log table
4. Clear cookie
5. Return success (always succeeds even if token invalid)

---

### 4. Token Verification

**Endpoint:** `GET /api/auth/verify`

**Used by frontend to:**
- Check if user is still authenticated
- Refresh user data
- Redirect to login if expired

---

## LDAP Configuration

### Environment Variables

```bash
# LDAP Server
LDAP_URL=ldap://idm.lab.local:389

# Base DN for searches
LDAP_BASE_DN=dc=lab,dc=local

# Users container
LDAP_USERS_DN=cn=users,cn=compat,dc=lab,dc=local

# Admin credentials for searches
LDAP_ADMIN_DN=uid=sysbind,cn=users,cn=compat,dc=lab,dc=local
LDAP_ADMIN_PASSWORD=your_password

# Group for admin privileges
LDAP_ADMIN_GROUP=admins

# JWT Secret
JWT_SECRET=your_jwt_secret_here
```

---

## LDAP Functions

### `getUidByEmail(email)`
- **Purpose:** Convert email to UID
- **LDAP Operation:** Search
- **Credentials:** Admin
- **Filter:** `(&(objectClass=person)(mail=${email}))`
- **Returns:** UID string (e.g., "john.doe")

### `validateUser(uid, password)`
- **Purpose:** Verify password
- **LDAP Operation:** Bind
- **Credentials:** User's own (not admin!)
- **DN:** `uid=${uid},${LDAP_USERS_DN}`
- **Returns:** Boolean (bind success = valid password)

### `getUserDetails(uid)`
- **Purpose:** Get full user profile
- **LDAP Operation:** Search
- **Credentials:** Admin
- **Filter:** `(&(objectClass=person)(uid=${uid}))`
- **Returns:** Object with uid, mail, givenName, sn, memberOf

### `userIsMemberOf(uid, groupName)`
- **Purpose:** Check group membership
- **LDAP Operation:** Search
- **Credentials:** Admin
- **Filter:** `(&(objectClass=person)(uid=${uid})(memberOf=*cn=${groupName}*))`
- **Returns:** Boolean

### `userExists(uid)`
- **Purpose:** Check if user exists
- **LDAP Operation:** Search
- **Credentials:** Admin
- **Filter:** `(&(objectClass=person)(uid=${uid}))`
- **Returns:** Boolean

---

## Database Schema

### Account Table
```sql
CREATE TABLE Account (
    account_id SERIAL PRIMARY KEY,
    first_name VARCHAR(64) NOT NULL,
    last_name VARCHAR(64) NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,  -- Set to 'ldap_managed' for LDAP users
    role account_role NOT NULL DEFAULT 'recruiter',  -- 'berufsbilder' or 'recruiter'
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE account_role AS ENUM ('berufsbilder', 'recruiter');
-- berufsbilder = Admin/Trainer with full privileges
-- recruiter = Regular user (apprentice) with limited access
```

### Audit Log Table
```sql
CREATE TABLE Audit_Log (
    audit_id BIGSERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INT,
    user_id INT REFERENCES Account(account_id),
    method VARCHAR(10),
    endpoint VARCHAR(255),
    ip_address INET,
    details JSONB,
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## Security Features

### 1. httpOnly Cookies
- Token stored in httpOnly cookie (not accessible via JavaScript)
- Protects against XSS attacks
- SameSite=strict prevents CSRF

### 2. JWT Expiration
- Tokens expire after 8 hours
- Users must re-login after expiration

### 3. LDAP Password Validation
- Passwords never stored locally
- Validated directly against LDAP via bind
- Password changes in LDAP immediately effective

### 4. Role-Based Access Control
- Admin status synced from LDAP groups
- LDAP 'admins' group → Database 'berufsbilder' role
- Checked on every request via middleware
- Can be revoked by removing from LDAP group

### 5. Audit Logging
- All logins/logouts logged
- Includes timestamp, user ID, action, details
- Useful for security audits

---

## Error Handling

### LDAP Errors
- **Connection timeout:** LDAP server unreachable
- **Bind failure:** Invalid admin credentials or user password
- **User not found:** Email doesn't exist in LDAP

### HTTP Status Codes
- **400:** Bad request (missing email/password)
- **401:** Unauthorized (invalid credentials or token)
- **403:** Forbidden (admin required)
- **404:** User not found
- **500:** Server error
- **503:** LDAP service unavailable

---

## Frontend Integration

### Login
```typescript
const response = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include', // Important for cookies
  body: JSON.stringify({ email, password })
});

const data = await response.json();
if (response.ok) {
  localStorage.setItem('user', JSON.stringify(data.user));
  navigate('/dashboard');
}
```

### Logout
```typescript
await fetch('/api/auth/logout', {
  method: 'POST',
  credentials: 'include'
});

localStorage.removeItem('user');
navigate('/login');
```

### Protected API Calls
```typescript
const response = await fetch('/api/candidates', {
  credentials: 'include' // Send cookie with request
});
```

---

## Troubleshooting

### LDAP Connection Timeout
- Check if LDAP server is running
- Verify network connectivity (ping idm.lab.local)
- Check firewall rules (port 389)
- Verify VPN connection if on internal network

### Invalid Credentials
- Check LDAP_ADMIN_DN format
- Verify LDAP_ADMIN_PASSWORD is correct
- Test with ldapsearch command line tool

### User Not Found
- Verify email exists in LDAP
- Check LDAP_BASE_DN is correct
- Ensure objectClass=person filter matches

### Token Expired
- User needs to login again
- Consider implementing refresh tokens for longer sessions

---

## Best Practices

1. **Never log passwords**
2. **Always use httpOnly cookies** for tokens
3. **Validate input** before LDAP queries
4. **Handle LDAP errors gracefully** (don't expose LDAP details to frontend)
5. **Sync admin status on every login** (reflects LDAP changes)
6. **Use try/finally** to ensure LDAP connections are closed
7. **Monitor audit logs** for suspicious activity

---

## Development vs Production

### Development
- Set `NODE_ENV=development`
- Cookies sent over HTTP (secure=false)
- Detailed error messages
- Console logging enabled

### Production
- Set `NODE_ENV=production`
- Cookies only over HTTPS (secure=true)
- Generic error messages
- Structured logging to file/service
- Consider rate limiting on /login endpoint

---

## Future Enhancements

1. **Refresh Tokens** - Extend sessions without re-login
2. **Rate Limiting** - Prevent brute force attacks
3. **2FA** - Two-factor authentication
4. **Password Reset** - Via LDAP admin tools
5. **Session Management** - View/revoke active sessions
6. **LDAP Connection Pool** - Reuse connections for performance
7. **Caching** - Cache LDAP lookups with TTL
