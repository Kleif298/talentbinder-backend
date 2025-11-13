/**
 * Authentication Middleware
 */

import jwt from "jsonwebtoken";

export function authRequired(req, res, next) {
    const token = req.cookies?.user;
    
    if (!token) {
        return res.status(401).json({ success: false, message: "Bitte melden Sie sich an, um fortzufahren." });
    }
    
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: "Ungültiger oder abgelaufener Token." });
    }
}

export function checkAdmin(req, res, next) {
    if (req.user?.role !== 'berufsbilder' || req.user?.role !== 'developer') {
        return res.status(403).json({ success: false, message: "Zugriff verweigert. Nur Administratoren." });
    }
    next();
}

