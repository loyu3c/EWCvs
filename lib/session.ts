import { getBindings, getDatabase } from "./database";

type SessionPayload = {
  kind: "voter" | "admin";
  employeeId?: number;
  adminVersion?: number;
  exp: number;
};

const encoder = new TextEncoder();

function toBase64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function getSecret() {
  return getBindings().SESSION_SECRET ?? "local-development-session-secret-change-before-publish";
}

async function signingKey() {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSession(payload: Omit<SessionPayload, "exp">, hours = 8) {
  const data = toBase64Url(JSON.stringify({
    ...payload,
    exp: Date.now() + hours * 60 * 60 * 1000,
  }));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(data));
  return `${data}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const [data, signature] = token.split(".");
  if (!data || !signature) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      fromBase64Url(signature),
      encoder.encode(data),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(data))) as SessionPayload;
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string) {
  const value = request.headers.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return value ? decodeURIComponent(value.slice(name.length + 1)) : undefined;
}

export async function getVoterSession(request: Request) {
  const session = await verifySession(readCookie(request, "voter_session"));
  return session?.kind === "voter" && session.employeeId ? session : null;
}

export async function getAdminSession(request: Request) {
  const session = await verifySession(readCookie(request, "admin_session"));
  if (session?.kind !== "admin") return null;
  const currentVersion = await getAdminCredentialVersion();
  return (session.adminVersion ?? 0) === currentVersion ? session : null;
}

export function sessionCookie(name: string, value: string, maxAge = 28800) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${maxAge}`;
}

export function clearCookie(name: string) {
  return `${name}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`;
}

export async function passwordMatches(input: string) {
  const credential = await getDatabase().prepare(
    "SELECT password_hash AS passwordHash, password_salt AS passwordSalt, iterations FROM admin_credentials WHERE id = 1",
  ).first<{ passwordHash: string; passwordSalt: string; iterations: number }>();
  if (credential) {
    const actual = await derivePasswordHash(input, credential.passwordSalt, credential.iterations);
    if (constantTimeEqual(actual, credential.passwordHash)) return true;

    // Allow the operator-controlled recovery credential exactly once.
    const recoveryPassword = getBindings().ADMIN_PASSWORD;
    if (!recoveryPassword) return false;
    const recoveryUsed = await getDatabase().prepare(
      "SELECT id FROM audit_logs WHERE action = ? LIMIT 1",
    ).bind("admin_password_env_recovery_consumed_v1").first<{ id: number }>();
    if (recoveryUsed) return false;

    const [inputDigest, recoveryDigest] = await Promise.all([
      crypto.subtle.digest("SHA-256", encoder.encode(input)),
      crypto.subtle.digest("SHA-256", encoder.encode(recoveryPassword)),
    ]);
    if (!constantTimeEqual(
      toBase64Url(new Uint8Array(inputDigest)),
      toBase64Url(new Uint8Array(recoveryDigest)),
    )) return false;

    await updateAdminPassword(input);
    await getDatabase().prepare(
      "INSERT INTO audit_logs (action, details, created_at) VALUES (?, ?, ?)",
    ).bind(
      "admin_password_env_recovery_consumed_v1",
      "One-time environment recovery credential consumed",
      new Date().toISOString(),
    ).run();
    return true;
  }
  const expected = getBindings().ADMIN_PASSWORD ?? "ewc-demo-admin";
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(input)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actual = new Uint8Array(actualHash);
  const reference = new Uint8Array(expectedHash);
  let difference = actual.length ^ reference.length;
  for (let index = 0; index < Math.min(actual.length, reference.length); index += 1) {
    difference |= actual[index] ^ reference[index];
  }
  return difference === 0;
}

const passwordIterations = 120000;

function bytesToBase64Url(bytes: Uint8Array) {
  return toBase64Url(bytes);
}

function base64UrlToBytes(value: string) {
  return fromBase64Url(value);
}

function constantTimeEqual(actual: string, expected: string) {
  const actualBytes = encoder.encode(actual);
  const expectedBytes = encoder.encode(expected);
  let difference = actualBytes.length ^ expectedBytes.length;
  for (let index = 0; index < Math.min(actualBytes.length, expectedBytes.length); index += 1) {
    difference |= actualBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

async function derivePasswordHash(password: string, salt: string, iterations: number) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: base64UrlToBytes(salt), iterations },
    keyMaterial,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

export async function getAdminCredentialVersion() {
  const credential = await getDatabase().prepare(
    "SELECT session_version AS sessionVersion FROM admin_credentials WHERE id = 1",
  ).first<{ sessionVersion: number }>();
  return credential?.sessionVersion ?? 0;
}

export async function updateAdminPassword(newPassword: string) {
  const saltBytes = new Uint8Array(18);
  crypto.getRandomValues(saltBytes);
  const salt = bytesToBase64Url(saltBytes);
  const passwordHash = await derivePasswordHash(newPassword, salt, passwordIterations);
  const currentVersion = await getAdminCredentialVersion();
  await getDatabase().prepare(
    `INSERT INTO admin_credentials (id, password_hash, password_salt, iterations, session_version, updated_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       password_hash = excluded.password_hash,
       password_salt = excluded.password_salt,
       iterations = excluded.iterations,
       session_version = excluded.session_version,
       updated_at = excluded.updated_at`,
  ).bind(passwordHash, salt, passwordIterations, currentVersion + 1, new Date().toISOString()).run();
}
