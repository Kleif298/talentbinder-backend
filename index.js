import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

import authRouter from "./routes/auth.js";
import eventsRouter from "./routes/events.js";
import candidatesRouter from "./routes/candidates.js";
import accountRouter from "./routes/account.js";
import lookupRouter from "./routes/lookup.js";
import loggingRouter from "./routes/logging.js";

import { requestLogger } from "./middleware/logging.js";

dotenv.config();
const app = express();

app.use(cors({ 
  origin: ["http://localhost:5173", "http://localhost:4173"], 
  credentials: true 
}));
app.use(express.json());
app.use(cookieParser());
app.use(requestLogger);

app.get("/api/data", (req, res) => {
  res.json({ message: "Backend läuft!" });
});

app.use("/api/auth", authRouter);
app.use("/api/events", eventsRouter);
app.use("/api/candidates", candidatesRouter);
app.use("/api/lookups", lookupRouter);
app.use("/api/users", accountRouter);
app.use("/api/logging", loggingRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
