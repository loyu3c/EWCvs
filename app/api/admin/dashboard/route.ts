import { ensureSchema, getDatabase } from "@/lib/database";
import { error, json } from "@/lib/responses";
import { getAdminSession } from "@/lib/session";

export async function GET(request: Request) {
  await ensureSchema();
  if (!(await getAdminSession(request))) return error("請先登入管理後台", 401);
  const db = getDatabase();
  const [settings, totals, units, candidates, logs] = await Promise.all([
    db.prepare("SELECT title, status, updated_at AS updatedAt FROM election_settings WHERE id = 1")
      .first<{ title: string; status: string; updatedAt: string }>(),
    db.prepare(
      `SELECT (SELECT COUNT(*) FROM employees) AS employees,
        (SELECT COUNT(*) FROM votes) AS votes,
        (SELECT COUNT(*) FROM employees WHERE employee_number LIKE 'TEST%') AS testEmployees`,
    ).first<{ employees: number; votes: number; testEmployees: number }>(),
    db.prepare(
      `SELECT e.department, e.unit, COUNT(*) AS total,
        SUM(CASE WHEN v.id IS NOT NULL THEN 1 ELSE 0 END) AS voted
       FROM employees e LEFT JOIN votes v ON v.voter_employee_id = e.id
       GROUP BY e.department, e.unit ORDER BY e.department, e.unit`,
    ).all<{ department: string; unit: string; total: number; voted: number }>(),
    db.prepare(
      `SELECT e.id, e.name, e.employee_number AS employeeNumber, e.department, e.unit, e.election_group AS electionGroup, e.incumbent,
        COUNT(v.id) AS votes
       FROM employees e LEFT JOIN votes v ON v.candidate_employee_id = e.id
       GROUP BY e.id ORDER BY e.election_group, votes DESC, e.name`,
    ).all<{
      id: number;
      name: string;
      employeeNumber: string;
      department: string;
      unit: string;
      electionGroup: string;
      incumbent: number;
      votes: number;
    }>(),
    db.prepare(
      "SELECT action, details, created_at AS createdAt FROM audit_logs ORDER BY id DESC LIMIT 12",
    ).all<{ action: string; details: string | null; createdAt: string }>(),
  ]);

  return json({
    settings,
    totals: totals ?? { employees: 0, votes: 0, testEmployees: 0 },
    units: units.results ?? [],
    candidates: (candidates.results ?? []).map((candidate) => ({
      ...candidate,
      incumbent: Boolean(candidate.incumbent),
    })),
    logs: logs.results ?? [],
  });
}
