import jwt from "jsonwebtoken";

export function authRequired(req, res, next) {
    if (!req.cookies || !req.cookies.token) {
        return res.status(401).json({ success: false, message: "Authentifizierung erforderlich." });
    }
    const token = req.cookies.token;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: "Ungültiger oder abgelaufener Token." });
    }
}

export function checkAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'berufsbilder' || req.user.isAdmin !== true) {
        return res.status(403).json({ success: false, message: "Zugriff verweigert. Nur Administratoren dürfen diese Aktion durchführen." });
    }
    next();
}

