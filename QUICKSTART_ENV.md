# 🎯 Quick Start Guide - Environment Configuration

## 🚀 How to Run Your App in Different Environments

### **1️⃣ Development (Your Laptop)**

```powershell
npm run dev
```

**What happens:**
```
┌─────────────────────────────────────────┐
│ 1. Loads .env (PORT, JWT_SECRET)       │
│ 2. Loads .env.ldap (LDAP config)       │
│ 3. Loads .env.development (local DB)   │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│ Result:                                 │
│ ✅ PORT: 4000                           │
│ ✅ JWT_SECRET: from .env                │
│ ✅ DB: localhost/talentBinder_db        │
│ ✅ LDAP: ldap://idm.lab.local           │
│ ✅ Frontend: http://localhost:5173     │
└─────────────────────────────────────────┘
```

---

### **2️⃣ Render Cloud (Your Server)**

```powershell
npm run start:render
```

**What happens:**
```
┌─────────────────────────────────────────┐
│ 1. Loads .env (PORT, JWT_SECRET)       │
│ 2. Loads .env.ldap (LDAP config)       │
│ 3. Loads .env.render (cloud DB_URL)    │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│ Result:                                 │
│ ✅ PORT: 4000                           │
│ ✅ JWT_SECRET: from .env                │
│ ✅ DB_URL: postgresql://render...       │
│ ✅ LDAP: ldap://idm.lab.local           │
│ ✅ Frontend: https://talentbinder-...   │
└─────────────────────────────────────────┘
```

---

### **3️⃣ DAL Production (Final Release)**

```powershell
npm run start:production
```

**What happens:**
```
┌─────────────────────────────────────────┐
│ 1. Loads .env (PORT, default JWT)      │
│ 2. Loads .env.ldap (LDAP config)       │
│ 3. Loads .env.dal (production DB_URL)  │
│    ⚠️  Overrides JWT_SECRET!           │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│ Result:                                 │
│ ✅ PORT: 4000                           │
│ ✅ JWT_SECRET: PRODUCTION_SECRET!       │
│ ✅ DB_URL: postgresql://dal...          │
│ ✅ LDAP: ldap://idm.lab.local           │
│ ✅ Frontend: https://talentbinder.dal   │
└─────────────────────────────────────────┘
```

---

## 🎨 Visual Environment Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        YOUR APP                              │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐   │
│  │ index.js   │→ │ config/    │→ │ Routes & API        │   │
│  │ (loads env)│  │ db.js      │  │ (use env vars)      │   │
│  └────────────┘  │ ldap.js    │  └─────────────────────┘   │
│        ↓         └────────────┘           ↓                 │
│        ↓                                  ↓                 │
│   Reads from:                        Uses:                  │
│   • .env                             • process.env.PORT     │
│   • .env.ldap                        • process.env.DB_URL   │
│   • .env.[environment]               • process.env.JWT...   │
└──────────────────────────────────────────────────────────────┘
                            ↓
        ┌───────────────────┼───────────────────┐
        ↓                   ↓                   ↓
┌───────────────┐   ┌───────────────┐   ┌──────────────┐
│ Development   │   │ Render Cloud  │   │ DAL Prod     │
│               │   │               │   │              │
│ Local Docker  │   │ Your Server   │   │ Final Deploy │
│ DB            │   │ DB_URL        │   │ DB_URL       │
└───────────────┘   └───────────────┘   └──────────────┘
```

---

## 📋 Checklist Before Deployment

### Before Deploying to Render:
- [ ] `.env.render` has correct `DB_URL`
- [ ] `.env.render` has production `FRONTEND_URL`
- [ ] Tested locally with `npm run start:render`
- [ ] `.env` files NOT committed to Git

### Before Deploying to DAL Production:
- [ ] `.env.dal` created with strong `JWT_SECRET`
- [ ] `.env.dal` has correct production `DB_URL`
- [ ] `.env.dal` has correct production `FRONTEND_URL`
- [ ] LDAP accessible from production server (or override in `.env.dal`)
- [ ] Tested connection to production database
- [ ] Security review completed
- [ ] `.env` files NOT committed to Git

---

## 🔐 Security Reminder

```
⚠️  NEVER commit these files to Git:
   .env
   .env.development
   .env.render
   .env.dal
   .env.ldap

✅  ONLY commit:
   .env.example (template without secrets)
```

---

## 💡 Pro Tips

1. **Different JWT secrets** for different environments increases security
2. **LDAP is always loaded** because it's needed in all environments
3. **DB_URL format** is used by cloud providers (Render, Heroku, Railway)
4. **Individual DB settings** are easier for local development

---

## ❓ Common Questions

**Q: Why separate `.env.ldap`?**  
A: LDAP is a separate concern (authentication) and needed in all environments.

**Q: Can I test production config locally?**  
A: Yes! `$env:NODE_ENV="production"; node index.js` - but use test credentials!

**Q: What if LDAP isn't accessible from cloud?**  
A: Override LDAP settings in `.env.render` or `.env.dal`:
```env
# In .env.render
LDAP_URL=ldap://cloud-accessible-ldap.com
LDAP_ADMIN_PASSWORD=cloud_ldap_password
```

**Q: How do I switch environments quickly?**  
A: Use VS Code debugger (F5) and select from dropdown!

---

## 🎓 Summary

| Command | Environment | Database | Use For |
|---------|-------------|----------|---------|
| `npm run dev` | development | localhost | Daily coding |
| `npm run start:render` | render | Render cloud | Your cloud testing |
| `npm run start:production` | production | DAL server | Final release |

**Need help?** Check `ENV_CONFIGURATION.md` for full details!
