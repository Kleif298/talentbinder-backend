import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
dotenv.config();

import "./config/db.js";

import authRouter from "./routes/auth.js";
import eventsRouter from "./routes/events.js";
import candidatesRouter from "./routes/candidates.js";
import lookupRouter from "./routes/lookup.js";
import accountRouter from "./routes/account.js";

const app = express();

app.use(cors({ 
  origin: ["http://localhost:5173", "http://localhost:4173"], 
  credentials: true 
}));
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    const ms = Date.now() - start;
    console.log(`Response ${req.method} ${req.path} (${ms}ms)`);
    return originalJson(data);
  };
  next();
});

app.get("/api/data", (req, res) => {
  res.json({ message: "Backend ist ume!" });
});

app.use("/api/auth", authRouter);
app.use("/api/events", eventsRouter);
app.use("/api/candidates", candidatesRouter);
app.use("/api/lookups", lookupRouter);
app.use("/api/users", accountRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
