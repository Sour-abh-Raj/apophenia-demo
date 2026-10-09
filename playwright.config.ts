import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 240_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: "node --no-warnings dist/server/server/index.js",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), INSTRUCTOR_PASSCODE: "e2e-pass", DATABASE_PATH: `.e2e/e2e-${Date.now()}.sqlite` },
  },
});
