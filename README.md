
# TalentBinder Backend

## Deployment-Konfiguration

### Repository
- **Standort**: GitLab (oder dein Git-Provider)
- **Default Branch**: `main`

### Web-Adressen
- **Produktion**: `https://talentbinder.com/api` (ausgeliefert über Nginx Reverse Proxy)

### JavaScript-Skripte
Die folgenden Skripte sind in der `package.json` definiert:

```json
{
  "scripts": {
    "start": "node index.js",
    "dev": "node --watch index.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  }
}
```

### Globale Abhängigkeiten
- **Node.js**: Version 18 oder höher
- **npm**: Wird automatisch mit Node.js installiert

### Projekt-Abhängigkeiten

**Laufzeit-Abhängigkeiten:**
- `bcryptjs`: ^3.0.2
- `cookie-parser`: ^1.4.7
- `cors`: ^2.8.5
- `dotenv`: ^17.2.2
- `express`: ^5.1.0
- `jsonwebtoken`: ^9.0.2
- `pg`: ^8.16.3

### Dateistruktur
Alle wichtigen Dateien befinden sich im `backend`-Verzeichnis:
- `index.js` (Haupt-Anwendungsdatei)
- `package.json`
- `docker-compose.yml` (Für die lokale Entwicklung)
- `README.md`

### Framework
- **Typ**: Node.js Server-Anwendung mit Express.js
- **Datenbank**: PostgreSQL

---

## Lokale Entwicklung (mit Docker)

Für eine konsistente und einfache lokale Entwicklung wird Docker empfohlen.

1.  **Umgebungsvariablen prüfen:**
    Stelle sicher, dass eine `.env`-Datei mit den Entwicklungsvariablen existiert. Die `docker-compose.yml` ist darauf ausgelegt.

2.  **Container starten:**
    ```bash
    docker-compose up --build
    ```
    Der Service startet (standardmäßig auf Port 4000) und verbindet sich mit der PostgreSQL-Datenbank, die ebenfalls im Docker-Container läuft.

---

## Produktions-Deployment (ohne Docker)

Diese Anleitung beschreibt das Deployment auf einem Server, auf dem Node.js, PM2 und Nginx bereits installiert sind.

### 1. Repository klonen und Abhängigkeiten installieren
```bash
# Repository auf den Server klonen
git clone <your-repo-url>
cd talentbinder-backend

# Nur Produktions-Abhängigkeiten installieren
npm ci --only=production
```

### 2. Umgebungsvariablen für die Produktion
Erstelle eine `.env`-Datei im Root-Verzeichnis des Backends. **Diese Datei darf niemals im Git-Repository landen!**

```ini
# .env in der Produktion
NODE_ENV=production
PORT=4000
DATABASE_URL="postgresql://user:pass@localhost:5432/talentBinder_db"
JWT_SECRET="DEIN_SEHR_SICHERES_PRODUKTIONS_SECRET"
```

### 3. Anwendung mit PM2 starten
PM2 startet die Anwendung, überwacht sie und sorgt für einen automatischen Neustart.

```bash
# App starten und benennen
pm2 start index.js --name talentbinder-backend

# Konfiguration speichern, damit die App nach einem Server-Reboot neu startet
pm2 startup
pm2 save
```

### 4. Nginx als Reverse Proxy
Der Nginx-Server (wie im Frontend-README beschrieben) leitet Anfragen von `https://talentbinder.com/api` an den lokalen Port `4000` weiter, auf dem die PM2-Anwendung läuft.
