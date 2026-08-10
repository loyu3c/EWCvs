import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const employees = sqliteTable(
  "employees",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    employeeNumber: text("employee_number").notNull(),
    department: text("department").notNull(),
    unit: text("unit").notNull(),
    incumbent: integer("incumbent", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_employees_employee_number").on(table.employeeNumber),
    index("idx_employees_department_unit").on(table.department, table.unit),
  ],
);

export const votes = sqliteTable(
  "votes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    voterEmployeeId: integer("voter_employee_id").notNull().unique().references(() => employees.id),
    candidateEmployeeId: integer("candidate_employee_id").notNull().references(() => employees.id),
    receiptCode: text("receipt_code").notNull().unique(),
    castAt: text("cast_at").notNull(),
  },
  (table) => [index("idx_votes_candidate").on(table.candidateEmployeeId)],
);

export const electionSettings = sqliteTable("election_settings", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    action: text("action").notNull(),
    details: text("details"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_audit_logs_created_at").on(table.createdAt)],
);
