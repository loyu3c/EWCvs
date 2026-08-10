import { addAudit, ensureSchema, getDatabase } from "@/lib/database";
import { error, json } from "@/lib/responses";
import { getAdminSession } from "@/lib/session";

const allowed = new Set(["setup", "open", "paused", "closed"]);

export async function POST(request: Request) {
  await ensureSchema();
  if (!(await getAdminSession(request))) return error("請先登入管理後台", 401);
  const body = (await request.json()) as { status?: string };
  if (!body.status || !allowed.has(body.status)) return error("不支援的投票狀態");
  const db = getDatabase();
  if (body.status === "open") {
    const count = await db.prepare("SELECT COUNT(*) AS count FROM employees").first<{ count: number }>();
    if (!count?.count) return error("請先匯入員工名單");
  }
  await db.prepare("UPDATE election_settings SET status = ?, updated_at = ? WHERE id = 1")
    .bind(body.status, new Date().toISOString()).run();
  await addAudit("status_change", body.status);
  return json({ ok: true, status: body.status });
}
