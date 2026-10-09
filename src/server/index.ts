import "./env.js";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createApp } from "./app.js";

const PORT = Number(process.env.PORT ?? 3000);
const DB_PATH = resolve(process.env.DATABASE_PATH ?? "data/lab.sqlite");
let passcode = process.env.INSTRUCTOR_PASSCODE ?? "";
if (!passcode) {
  passcode = randomBytes(4).toString("hex");
  console.warn(`\n  INSTRUCTOR_PASSCODE is not set. A one-time passcode was generated for this run:\n\n      ${passcode}\n\n  Set INSTRUCTOR_PASSCODE in your environment (or .env) to choose your own.\n`);
}

const { app, hub } = createApp({ dbPath: DB_PATH, passcode, clientDir: resolve(process.env.CLIENT_DIR ?? "dist/client"), disableSse: process.env.DISABLE_SSE === "1" });
const server = app.listen(PORT, () => {
  console.log(`Apophenia Perception Lab listening on http://localhost:${PORT}`);
  console.log(`  Instructor: http://localhost:${PORT}/host     Database: ${DB_PATH}`);
});
const shutdown = () => { hub.closeAll(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
