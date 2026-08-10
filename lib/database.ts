import { env } from "cloudflare:workers";

export interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta?: { changes?: number };
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1Statement;
  batch<T = D1Result>(statements: D1Statement[]): Promise<T[]>;
}

type RuntimeBindings = {
  DB?: D1DatabaseLike;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
};

export function getBindings(): RuntimeBindings {
  return env as unknown as RuntimeBindings;
}

export function getDatabase(): D1DatabaseLike {
  const database = getBindings().DB;
  if (!database) throw new Error("投票資料庫尚未設定");
  return database;
}

let schemaReady: Promise<void> | null = null;

export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = initializeSchema().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function initializeSchema() {
  const db = getDatabase();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      employee_number TEXT NOT NULL,
      department TEXT NOT NULL,
      unit TEXT NOT NULL,
      incumbent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_employee_number ON employees(employee_number)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_employees_department_unit ON employees(department, unit)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voter_employee_id INTEGER NOT NULL UNIQUE,
      candidate_employee_id INTEGER NOT NULL,
      receipt_code TEXT NOT NULL UNIQUE,
      cast_at TEXT NOT NULL,
      FOREIGN KEY(voter_employee_id) REFERENCES employees(id),
      FOREIGN KEY(candidate_employee_id) REFERENCES employees(id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_votes_candidate ON votes(candidate_employee_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS election_settings (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('setup', 'open', 'paused', 'closed')),
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)"),
  ]);
  await db.prepare(
    "INSERT OR IGNORE INTO election_settings (id, title, status, updated_at) VALUES (1, ?, 'setup', ?)",
  ).bind("2026 年福委改選", new Date().toISOString()).run();
  await db.prepare("PRAGMA optimize").run();
}

export async function addAudit(action: string, details?: string) {
  const db = getDatabase();
  await db.prepare("INSERT INTO audit_logs (action, details, created_at) VALUES (?, ?, ?)")
    .bind(action, details ?? null, new Date().toISOString())
    .run();
}
