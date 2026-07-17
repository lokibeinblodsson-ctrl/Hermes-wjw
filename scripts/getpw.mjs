// usage: node getpw.mjs  -> prints the temporary admin password from provision
import { execSync } from "node:child_process";
const prov = execSync(
  `curl -s -X POST http://localhost:8787/api/v1/bootstrap/provision -H "x-bootstrap-token: local-dev-only-bootstrap-replace-in-prod"`,
  { encoding: "utf8" }
);
try {
  const p = JSON.parse(prov).data.temporary_password;
  console.log(p || "NONE_ALREADY_EXISTS");
} catch (e) {
  console.error("PROV FAILED:", prov);
  process.exit(1);
}
