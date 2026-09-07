import { addAudit, ensureSchema, getDatabase } from "@/lib/database";
import { error, json, normalizeName } from "@/lib/responses";
import { getAdminSession } from "@/lib/session";

type ImportRow = {
  name?: string;
  employeeNumber?: string;
  department?: string;
  unit?: string;
  electionGroup?: string;
  incumbent?: boolean;
};

export async function POST(request: Request) {
  await ensureSchema();
  if (!(await getAdminSession(request))) return error("請先登入管理後台", 401);
  const body = (await request.json()) as { rows?: ImportRow[] };
  if (!Array.isArray(body.rows) || body.rows.length === 0) return error("Excel 內沒有可匯入的員工資料");
  if (body.rows.length > 10000) return error("單次最多匯入 10,000 筆資料");

  const rows = body.rows.map((row, index) => ({
    row: index + 2,
    name: normalizeName(String(row.name ?? "")),
    employeeNumber: String(row.employeeNumber ?? "").trim(),
    department: String(row.department ?? "").trim(),
    unit: String(row.unit ?? "").trim(),
    electionGroup: String(row.electionGroup ?? "").trim(),
    incumbent: Boolean(row.incumbent),
  }));
  const missing = rows.filter((row) => !row.name || !row.employeeNumber || !row.department || !row.unit || !row.electionGroup);
  if (missing.length) return error(`第 ${missing.slice(0, 5).map((row) => row.row).join("、")} 列有必填欄位空白`);
  const seen = new Set<string>();
  const duplicate = rows.find((row) => seen.has(row.employeeNumber) || !seen.add(row.employeeNumber));
  if (duplicate) return error(`員工編號 ${duplicate.employeeNumber} 重複`);

  const db = getDatabase();
  const voteCount = await db.prepare("SELECT COUNT(*) AS count FROM votes").first<{ count: number }>();
  if ((voteCount?.count ?? 0) > 0) return error("已有投票紀錄，為保護選票不能重新匯入名單", 409);

  await db.prepare("DELETE FROM employees").run();
  const now = new Date().toISOString();
  for (let offset = 0; offset < rows.length; offset += 200) {
    const statements = rows.slice(offset, offset + 200).map((row) => db.prepare(
      `INSERT INTO employees (name, employee_number, department, unit, election_group, incumbent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(row.name, row.employeeNumber, row.department, row.unit, row.electionGroup, row.incumbent ? 1 : 0, now));
    await db.batch(statements);
  }
  const groupCount = new Set(rows.map((row) => row.electionGroup)).size;
  await addAudit("employee_import", `${rows.length} employees, ${groupCount} election groups`);
  return json({ ok: true, count: rows.length, groupCount });
}
