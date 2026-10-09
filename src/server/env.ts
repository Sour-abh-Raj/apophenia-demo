/** Loads ./.env if present (Node's built-in loader). Imported first so every module sees the variables. */
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
