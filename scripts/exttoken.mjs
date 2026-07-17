// usage: node exttoken.mjs <email> <password>
import { execSync } from "node:child_process";
const email = process.argv[2] || "admin@wildjazmine.local";
const pw = process.argv[3] || "";
const login = execSync(
  `curl -s -X POST http://localhost:8787/api/v1/auth/login -H "content-type: application/json" -d "{\\"email\\":\\"${email}\\",\\"password\\":\\"${pw}\\"}"`,
  { encoding: "utf8" }
);
try {
  const t = JSON.parse(login).data.token;
  console.log(t);
} catch (e) {
  console.error("LOGIN FAILED:", login);
  process.exit(1);
}
