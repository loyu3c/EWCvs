import { addAudit, ensureSchema, getDatabase } from "@/lib/database";
import { error, json } from "@/lib/responses";
import { getAdminSession } from "@/lib/session";

const units = [
  ["營運部", "行政組"], ["營運部", "客服組"],
  ["業務部", "北區業務組"], ["業務部", "南區業務組"],
  ["研發部", "產品組"], ["研發部", "平台組"],
  ["財務部", "會計組"], ["財務部", "採購組"],
  ["人資部", "招募組"], ["人資部", "教育訓練組"],
] as const;

export async function POST(request: Request) {
  await ensureSchema();
  if (!(await getAdminSession(request))) return error("請先登入管理後台", 401);
  const db = getDatabase();
  const [settings, count] = await Promise.all([
    db.prepare("SELECT status FROM election_settings WHERE id = 1").first<{ status: string }>(),
    db.prepare("SELECT COUNT(*) AS count FROM employees").first<{ count: number }>(),
  ]);
  if (settings?.status === "open") return error("投票進行中不能產生測試資料", 409);
  if ((count?.count ?? 0) > 0) return error("名單已有資料，請先清空後再產生測試資料", 409);

  const now = new Date().toISOString();
  const statements = Array.from({ length: 100 }, (_, index) => {
    const [department, unit] = units[Math.floor(index / 10)];
    const number = String(index + 1).padStart(4, "0");
    return db.prepare(
      `INSERT INTO employees (name, employee_number, department, unit, incumbent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(`測試員工${number}`, `TEST${number}`, department, unit, index % 10 === 0 ? 1 : 0, now);
  });
  await db.batch(statements);
  await addAudit("test_data_generated", "100 employees");
  return json({ ok: true, count: 100 });
}
