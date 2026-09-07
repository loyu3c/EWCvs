import postgres from "postgres";

export interface DatabaseResult<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta?: { changes?: number };
}

type DatabaseValue = string | number | boolean | null | Date;

export interface DatabaseStatement {
  bind(...values: DatabaseValue[]): DatabaseStatement;
  run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>>;
}

export interface DatabaseLike {
  prepare(sql: string): DatabaseStatement;
  batch<T = DatabaseResult>(statements: DatabaseStatement[]): Promise<T[]>;
}

type RuntimeBindings = {
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
};

export function getBindings(): RuntimeBindings {
  return {
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    SESSION_SECRET: process.env.SESSION_SECRET,
  };
}

const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_CONNECTION_STRING ??
  process.env.POSTGRES_URI;

const client = connectionString
  ? postgres(connectionString, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
    })
  : null;

const normalizedKeys: Record<string, string> = {
  createdat: "createdAt",
  electiongroup: "electionGroup",
  employeenumber: "employeeNumber",
  passwordhash: "passwordHash",
  passwordsalt: "passwordSalt",
  sessionversion: "sessionVersion",
  testemployees: "testEmployees",
  updatedat: "updatedAt",
};

const numericKeys = new Set([
  "candidate_id",
  "count",
  "employees",
  "id",
  "iterations",
  "sessionversion",
  "testemployees",
  "total",
  "voted",
  "voter_id",
  "votes",
]);

function normalizeRow<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      normalizedKeys[key] ?? key,
      numericKeys.has(key) && typeof value === "string" ? Number(value) : value,
    ]),
  ) as T;
}

function postgresQuery(sql: string) {
  let parameter = 0;
  return sql.replace(/\?/g, () => `$${++parameter}`);
}

class PostgresStatement implements DatabaseStatement {
  readonly sql: string;
  readonly values: DatabaseValue[];

  constructor(sql: string, values: DatabaseValue[] = []) {
    this.sql = postgresQuery(sql);
    this.values = values;
  }

  bind(...values: DatabaseValue[]) {
    return new PostgresStatement(this.sql, values);
  }

  async run<T = Record<string, unknown>>(): Promise<DatabaseResult<T>> {
    const rows = await execute(this);
    return { success: true, results: rows.map(normalizeRow<T>), meta: { changes: rows.count } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const rows = await execute(this);
    return rows[0] ? normalizeRow<T>(rows[0]) : null;
  }

  async all<T = Record<string, unknown>>(): Promise<DatabaseResult<T>> {
    const rows = await execute(this);
    return { success: true, results: rows.map(normalizeRow<T>) };
  }
}

function requireClient() {
  if (!client) {
    throw new Error(
      "Database connection is unavailable. Set DATABASE_URL to the Zeabur PostgreSQL connection string.",
    );
  }
  return client;
}

function execute(statement: PostgresStatement) {
  return requireClient().unsafe<Record<string, unknown>[]>(statement.sql, statement.values);
}

const database: DatabaseLike = {
  prepare(sql: string) {
    return new PostgresStatement(sql);
  },
  async batch<T = DatabaseResult>(statements: DatabaseStatement[]): Promise<T[]> {
    const committed = await requireClient().begin(async (transaction) => {
      const results: DatabaseResult[] = [];
      for (const item of statements) {
        const statement = item as PostgresStatement;
        const rows = await transaction.unsafe<Record<string, unknown>[]>(statement.sql, statement.values);
        results.push({
          success: true,
          results: rows.map((row) => normalizeRow<Record<string, unknown>>(row)),
          meta: { changes: rows.count },
        });
      }
      return results;
    });
    return committed as unknown as T[];
  },
};

export function getDatabase(): DatabaseLike {
  requireClient();
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
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      employee_number TEXT NOT NULL,
      department TEXT NOT NULL,
      unit TEXT NOT NULL,
      election_group TEXT NOT NULL DEFAULT '',
      incumbent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_employee_number ON employees(employee_number)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_employees_department_unit ON employees(department, unit)"),
    db.prepare("ALTER TABLE employees ADD COLUMN IF NOT EXISTS election_group TEXT NOT NULL DEFAULT ''"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_employees_election_group ON employees(election_group)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS votes (
      id BIGSERIAL PRIMARY KEY,
      voter_employee_id BIGINT NOT NULL UNIQUE REFERENCES employees(id),
      candidate_employee_id BIGINT NOT NULL REFERENCES employees(id),
      receipt_code TEXT NOT NULL UNIQUE,
      cast_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_votes_candidate ON votes(candidate_employee_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS election_settings (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('setup', 'open', 'paused', 'closed')),
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS admin_credentials (
      id INTEGER PRIMARY KEY,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      iterations INTEGER NOT NULL,
      session_version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    )`),
  ]);
  await db.prepare(
    `INSERT INTO election_settings (id, title, status, updated_at)
     VALUES (1, ?, 'setup', ?)
     ON CONFLICT (id) DO NOTHING`,
  ).bind("2026 年度福委改選", new Date().toISOString()).run();
}

export async function addAudit(action: string, details?: string) {
  const db = getDatabase();
  await db.prepare("INSERT INTO audit_logs (action, details, created_at) VALUES (?, ?, ?)")
    .bind(action, details ?? null, new Date().toISOString())
    .run();
}
