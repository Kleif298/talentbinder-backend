# Backend Commands

## Installation
```bash
npm install
```

## Starten

### Produktion (einmalig starten)
```bash
node index.js
```

### Entwicklung (mit Auto-Reload)
```bash
node --watch index.js
```

## Verfügbare API-Endpoints

### Authentication
- `POST /api/login` - Login mit Email/Passwort
- `POST /api/register` - Registrierung neuer Benutzer

### Candidates (alle erfordern authRequired)
- `GET /api/candidates` - Alle Kandidaten abrufen (mit Filter, Search, Sort)
- `POST /api/candidates` - Neuen Kandidaten erstellen (erfordert checkAdmin)
- `PATCH /api/candidates/:id` - Kandidaten aktualisieren (erfordert checkAdmin)
- `DELETE /api/candidates/:id` - Kandidaten löschen (erfordert checkAdmin)

### Events (erfordern authRequired + checkAdmin)
- `GET /api/dashboard/callEvents` - Alle Events abrufen
- `POST /api/dashboard/registerEvents` - Neues Event erstellen
- `PUT /api/dashboard/editEvent/:eventId` - Event aktualisieren
- `DELETE /api/dashboard/deleteEvent/:eventId` - Event löschen

## Environment Variables (.env)
```
DB_HOST=localhost
DB_PORT=5432
DB_USER=your_user
DB_PASS=your_password
DB_NAME=your_database
JWT_SECRET=your_secret_key
PORT=4000
```

## Dependencies
- express - Web Framework
- pg - PostgreSQL Client
- jsonwebtoken - JWT Authentication
- bcryptjs - Password Hashing
- cookie-parser - Cookie Parsing
- cors - Cross-Origin Resource Sharing
- dotenv - Environment Variables
