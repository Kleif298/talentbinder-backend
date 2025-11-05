/**
 * Authentication Middleware
 * 
 * Provides JWT token verification and role-based access control
 */

import jwt from "jsonwebtoken";

/**
 * Require valid JWT token
 * 
 * Verifies the token from httpOnly cookie and attaches decoded user to req.user
 * Use this middleware on all protected routes
 */
export function authRequired(req, res, next) {
    if (!req.cookies || !req.cookies.token) {
        return res.status(401).json({ 
            success: false, 
            message: "Authentifizierung erforderlich." 
        });
    }
    
    const token = req.cookies.token;
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Attach user info to request
        next();
    } catch (err) {
        return res.status(401).json({ 
            success: false, 
            message: "Ungültiger oder abgelaufener Token." 
        });
    }
}

/**
 * Require admin role
 * 
 * Must be used AFTER authRequired middleware
 * Checks if authenticated user has admin privileges (role = 'berufsbilder')
 */
export function checkAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'berufsbilder') {
        return res.status(403).json({ 
            success: false, 
            message: "Zugriff verweigert. Nur Administratoren dürfen diese Aktion durchführen." 
        });
    }
    next();
}

