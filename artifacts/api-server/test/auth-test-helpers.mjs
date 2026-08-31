import { createHmac } from "node:crypto";

const issuer = "recovery-housing-operations";

export function authHeaders({
  sub = `authorization-test-${process.pid}`,
  role = "owner_admin",
  houseNames = [],
  residentId,
  now = Math.floor(Date.now() / 1000),
  ttlSeconds = 3600,
} = {}) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for authenticated API tests.");
  const payload = {
    iss: issuer,
    sub,
    role,
    organizationId: "redeemer-house",
    houseNames,
    active: true,
    ...(residentId === undefined ? {} : { residentId }),
    iat: now,
    exp: now + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return { authorization: `Bearer ${encoded}.${signature}` };
}
