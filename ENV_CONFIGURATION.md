# Environment Configuration Guide 🌍

## Overview

This application uses multiple `.env` files for different deployment scenarios:

```
.env              → Base config (always loaded)
.env.ldap         → LDAP config (always loaded, separate concern)
.env.development  → Local development (Docker database)
.env.render       → Your cloud (Render.com)
.env.dal          → Final production (DAL organization)
```

## File Loading Priority

```javascript
1. .env            (base: PORT, JWT_SECRET)
2. .env.ldap       (LDAP settings - always loaded)
3. Environment-specific:
   ├─ .env.development  (if NODE_ENV=development)
   ├─ .env.render       (if NODE_ENV=render)
   └─ .env.dal          (if NODE_ENV=production)
```

**Later files override earlier ones for duplicate variables.**

---

## 🚀 How to Use Different Environments

### **Option 1: NPM Scripts (Recommended)**

```powershell
# Development (Local Docker Database)
npm run dev

# Render Cloud (Your Server)
npm run start:render

# DAL Production (Final Release)
npm run start:production
```

### **Option 2: VS Code Debugger**

1. Press `F5` or click **Run and Debug** icon (▶️)
2. Select environment:
   - `🟢 Development (Local Docker DB)`
   - `☁️ Render (Your Cloud)`
   - `🚀 Production (DAL Final)`
3. Click **Start Debugging** (green play button)
4. Set breakpoints and debug!

### **Option 3: Manual Terminal**

```powershell
# PowerShell
$env:NODE_ENV="development"; node index.js
$env:NODE_ENV="render"; node index.js
$env:NODE_ENV="production"; node index.js

# CMD
set NODE_ENV=development&& node index.js
set NODE_ENV=render&& node index.js
set NODE_ENV=production&& node index.js
```

---

## 📁 Environment Files Explained

### `.env` (Base Configuration)
```env
PORT=3023
NODE_ENV=development
JWT_SECRET=your_secret_key
JWT_EXPIRE=60m
```
**Always loaded first. Contains settings shared across all environments.**

### `.env.ldap` (LDAP Configuration)
```env
LDAP_URL=ldap://idm.lab.local
LDAP_BASE_DN=dc=lab,dc=local
LDAP_USERS_DN=cn=users,cn=compat,dc=lab,dc=local
LDAP_ADMIN_DN=uid=admin,cn=users,cn=compat,dc=lab,dc=local
LDAP_ADMIN_PASSWORD=your_password
LDAP_ADMIN_GROUP=admins
LDAP_USER_GROUP=users
```
**Always loaded. Separate file because it's a different concern (authentication).**

### `.env.development` (Local Development)
```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=user
DB_NAME=talentBinder_db
DB_PASS=pass
FRONTEND_URL=http://localhost:5173,http://localhost:4173
```
**Loaded when `NODE_ENV=development`. Uses local Docker PostgreSQL.**

### `.env.render` (Your Cloud Server)
```env
DB_URL=postgresql://user:password@host.render.com/database
FRONTEND_URL=https://talentbinder-frontend.onrender.com
```
**Loaded when `NODE_ENV=render`. Uses single connection URL (Render format).**

### `.env.dal` (Final Production)
```env
DB_URL=postgresql://user:password@production-host.dal.com/database
FRONTEND_URL=https://talentbinder.dal.com
JWT_SECRET=STRONG_PRODUCTION_SECRET_HERE
```
**Loaded when `NODE_ENV=production`. For DAL organization's final deployment.**

---

## 🔄 Database Connection Logic

The app automatically detects whether to use `DB_URL` or individual settings:

```javascript
// If DB_URL exists (Render, DAL) → use connection string
DB_URL=postgresql://user:password@host:5432/database

// Otherwise (Development) → use individual settings
DB_HOST=localhost
DB_PORT=5432
DB_USER=user
DB_PASS=password
DB_NAME=database
```

---

## 🛡️ Security Best Practices

### ✅ DO:
- Keep all `.env*` files in `.gitignore` (already configured)
- Use strong, unique secrets in production (`.env.dal`, `.env.render`)
- Share credentials securely (password manager, encrypted channels)
- Rotate secrets regularly

### ❌ DON'T:
- Commit `.env` files to Git
- Use same `JWT_SECRET` in all environments
- Share `.env` files via email/Slack
- Use weak passwords in production

---

## 🎯 Environment Summary

| Environment | `NODE_ENV` | Database | Use Case |
|------------|------------|----------|----------|
| **Development** | `development` | Local Docker | Your laptop coding |
| **Render** | `render` | Render Cloud | Your personal cloud server |
| **Production** | `production` | DAL Server | Final organization deployment |

---

## 🔍 Debugging

Check which environment is active:

```javascript
// In your code
console.log(process.env.NODE_ENV);
console.log(process.env.DB_HOST || 'Using DB_URL');

// Terminal output shows:
// 🟢 Development mode - Local database
// 📌 Environment: development
// 💾 Database: localhost:5432/talentBinder_db
```

---

## 📝 Quick Reference

```bash
# Install dependencies
npm install

# Run development
npm run dev
# → Loads: .env + .env.ldap + .env.development

# Run on Render cloud
npm run start:render
# → Loads: .env + .env.ldap + .env.render

# Run DAL production
npm run start:production
# → Loads: .env + .env.ldap + .env.dal
```

---

## 🆘 Troubleshooting

**Problem: "Cannot connect to database"**
- Check if Docker is running (development)
- Verify `DB_URL` or individual DB settings
- Check firewall/network access (cloud)

**Problem: "LDAP authentication failed"**
- Verify `.env.ldap` settings
- Check VPN connection (if LDAP is on local network)
- Test LDAP server accessibility: `ping idm.lab.local`

**Problem: "CORS error from frontend"**
- Verify `FRONTEND_URL` matches your frontend domain
- Check if frontend is actually running on that URL

---

## 🔗 Related Files

- `index.js` - Environment loading logic
- `config/db.js` - Database connection handling
- `config/ldap.js` - LDAP authentication
- `package.json` - NPM scripts
- `.vscode/launch.json` - Debug configurations
