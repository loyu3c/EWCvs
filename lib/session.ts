import { getBindings } from "./database";

type SessionPayload = {
  kind: "voter" | "admin";
  employeeId?: number;
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
  return session?.kind === "admin" ? session : null;
}

export function sessionCookie(name: string, value: string, maxAge = 28800) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${maxAge}`;
}

export function clearCookie(name: string) {
  return `${name}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0`;
}

export async function passwordMatches(input: string) {
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
