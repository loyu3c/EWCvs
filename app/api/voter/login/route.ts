import { ensureSchema, getDatabase } from "@/lib/database";
import { error, json, normalizeName } from "@/lib/responses";
import { createSession, sessionCookie } from "@/lib/session";

type LoginBody = {
  department?: string;
  unit?: string;
  employeeNumber?: string;
  name?: string;
};

export async function POST(request: Request) {
  await ensureSchema();
  const body = (await request.json()) as LoginBody;
  const department = body.department?.trim();
  const unit = body.unit?.trim();
  const employeeNumber = body.employeeNumber?.trim();
  const name = body.name ? normalizeName(body.name) : "";
  if (!department || !unit || !employeeNumber || !name) return error("請完整填寫身分資料");

  const db = getDatabase();
  const settings = await db.prepare("SELECT status FROM election_settings WHERE id = 1").first<{ status: string }>();
  if (settings?.status !== "open") return error("目前尚未開放投票", 403);

  const employee = await db.prepare(
    `SELECT e.id, e.name,
      EXISTS(SELECT 1 FROM votes v WHERE v.voter_employee_id = e.id) AS has_voted
     FROM employees e
     WHERE e.employee_number = ? AND e.department = ? AND e.unit = ?`,
  ).bind(employeeNumber, department, unit).first<{ id: number; name: string; has_voted: number }>();

  if (!employee || normalizeName(employee.name) !== name) return error("員工資料不符，請重新確認", 401);
  if (employee.has_voted) return error("此員工編號已完成投票", 409);

  const token = await createSession({ kind: "voter", employeeId: employee.id }, 2);
  return json(
    { ok: true },
    200,
    { "set-cookie": sessionCookie("voter_session", token, 7200) },
  );
}
