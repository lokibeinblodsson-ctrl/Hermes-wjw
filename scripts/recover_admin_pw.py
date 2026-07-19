import os, base64, hashlib, json, urllib.request, urllib.error, datetime

ACCT = "274c13cfc3476cfe884ae08648d73cb4"
DB   = "a6a68f29-e6f9-49d6-b081-bee3a92cfc3e"
TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
USER_ID = "usr_7c8ffe803faa0ec67ca207cf"

b64u = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")

# Generate a fresh password
rnd = b64u(os.urandom(9))
pw = rnd + "Wjw!2026"          # >8 chars, mixed

# Build the salt EXACTLY like src/lib/crypto.ts hashPassword():
#   useSalt = base64url(16 random bytes)   <-- stored as the salt field
#   deriveBits salt = utf8(useSalt)         <-- NOT the decoded bytes!
salt_str = b64u(os.urandom(16))
dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt_str.encode("utf-8"), 100000, dklen=32)
stored = f"pbkdf2$100000${salt_str}${b64u(dk)}"

# Verify exactly like verifyPassword(): candidate = hashPassword(pw, salt_str)
cand_dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt_str.encode("utf-8"), 100000, dklen=32)
assert b64u(cand_dk) == b64u(dk), "verify mismatch"

now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
sql = ("UPDATE users SET password_hash=?, token_version=0, force_reset=1, "
       "failed_logins=0, locked_until=NULL, updated_at=? WHERE id=?")
body = json.dumps({"sql": sql, "params": [stored, now, USER_ID]}).encode()

req = urllib.request.Request(
    f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/d1/database/{DB}/query",
    data=body,
    headers={"Authorization": f"Bearer {TOKEN}", "content-type": "application/json"})
try:
    r = urllib.request.urlopen(req, timeout=30)
    resp = r.read().decode()
except urllib.error.HTTPError as e:
    resp = e.read().decode()
meta = json.loads(resp)["result"][0]["meta"]
print("HTTP", resp.split('"success":')[0])
print("CHANGES:", meta.get("changes"))
if meta.get("changes") == 1:
    print("NEW_ADMIN_PASSWORD:", pw)
else:
    print("NO ROWS UPDATED")
