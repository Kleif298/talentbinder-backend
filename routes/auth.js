import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import client from '../config/db.js';
import { auditLog } from '../middleware/logging.js';

const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await client.query(
      "SELECT account_id as id, email, password_hash, role, email FROM account WHERE email = $1;",
      [email]
    );
    const account = result.rows[0];
    const isAdmin = ["berufsbilder"].includes(account.role);
    console.log("Login Debug:", { email, accountRole: account?.role, isAdmin });
    
    if (account && bcrypt.compareSync(password, account.password_hash)) {
      const token = jwt.sign(
        { id: account.id, email: account.email, role: account.role, isAdmin: isAdmin },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: "None",
        maxAge: 3600000
      });

      await auditLog('LOGIN', 'account', account.id, account.id, { 
        email,
        ip: req.ip 
      });

      res.json({
        success: true,
        token: token,
        account: { id: account.id, email: account.email, role: account.role },
      });
    } else {
      await auditLog('LOGIN_FAILED', 'account', null, null, { 
        email, 
        reason: account ? 'Invalid password' : 'User not found',
        ip: req.ip 
      });

      res.json({
        success: false,
        message: "Login ist fehlgeschlagen. Überprüfe dein Passwort oder Email.",
      });
    }
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/register", async (req, res) => {
  const { email, password, first_name, last_name } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email und Passwort sind erforderlich." });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  
  try {
    const result = await client.query(`
      INSERT INTO account (email, password_hash, first_name, last_name) 
      VALUES ($1, $2, $3, $4) 
      RETURNING account_id AS id, email, role;
    `, [email, hashedPassword, first_name, last_name]
    );
    
    const account = result.rows[0];
    const isAdmin = ["berufsbilder"].includes(account.role);
    const token = jwt.sign(
      { id: account.id, email: account.email, role: account.role, isAdmin: isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    
    res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: "None",
        maxAge: 3600000
    });

    await auditLog('REGISTER', 'account', account.id, account.id, { 
      email,
      role: account.role,
      ip: req.ip 
    });

    res.json({
      success: true,
      token: token,
      account: { id: account.id, email: account.email, role: account.role },
    });
  } catch (err) {
    console.error("Registration error:", err);
    if (err.code === "23505") {
      return res.status(409).json({ success: false, message: "Die E-Mail-Adresse ist bereits registriert." });
    }
    res.status(500).json({ success: false, message: "Serverfehler bei der Registrierung." });
  }
});

export default router;
