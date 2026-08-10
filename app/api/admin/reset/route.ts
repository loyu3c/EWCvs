import { ensureSchema, getDatabase } from "@/lib/database";
import { error, json } from "@/lib/responses";
import { getAdminSession } from "@/lib/session";

type ResetScope = "test" | "all";

export async function POST(request: Request) {
  await ensureSchema();
  if (!(await getAdminSession(request))) return error("請先登入管理後台", 401);
  const body = (await request.json()) as { scope?: ResetScope; confirmation?: string };
  const expected = body.scope === "test" ? "清空測試資料" : body.scope === "all" ? "清空全部資料" : "";
  if (!expected || body.confirmation !== expected) return error(`請完整輸入「${expected || "確認文字"}」`);

  const db = getDatabase();
  const settings = await db.prepare("SELECT status FROM election_settings WHERE id = 1").first<{ status: string }>();
  if (settings?.status === "open") return error("投票進行中不能清空資料，請先暫停或結束投票", 409);

  const now = new Date().toISOString();
  if (body.scope === "test") {
    const testCount = await db.prepare(
      "SELECT COUNT(*) AS count FROM employees WHERE employee_number LIKE 'TEST%'",
    ).first<{ count: number }>();
    await db.batch([
      db.prepare(`DELETE FROM votes WHERE voter_employee_id IN (
        SELECT id FROM employees WHERE employee_number LIKE 'TEST%'
      ) OR candidate_employee_id IN (
        SELECT id FROM employees WHERE employee_number LIKE 'TEST%'
      )`),
      db.prepare("DELETE FROM employees WHERE employee_number LIKE 'TEST%'"),
      db.prepare("INSERT INTO audit_logs (action, details, created_at) VALUES ('test_data_cleared', ?, ?)")
        .bind(`${testCount?.count ?? 0} employees`, now),
    ]);
    return json({ ok: true, count: testCount?.count ?? 0 });
  }

  const total = await db.prepare("SELECT COUNT(*) AS count FROM employees").first<{ count: number }>();
  await db.batch([
    db.prepare("DELETE FROM votes"),
    db.prepare("DELETE FROM employees"),
    db.prepare("DELETE FROM audit_logs"),
    db.prepare("UPDATE election_settings SET status = 'setup', updated_at = ? WHERE id = 1").bind(now),
    db.prepare("INSERT INTO audit_logs (action, details, created_at) VALUES ('all_data_cleared', ?, ?)")
      .bind(`${total?.count ?? 0} employees`, now),
  ]);
  return json({ ok: true, count: total?.count ?? 0 });
}
