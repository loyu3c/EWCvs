import { addAudit, ensureSchema } from "@/lib/database";
import { error, json } from "@/lib/responses";
import { clearCookie, getAdminSession, passwordMatches, updateAdminPassword } from "@/lib/session";

export async function POST(request: Request) {
  await ensureSchema();
  if (!(await getAdminSession(request))) return error("請先登入管理後台", 401);
  const body = (await request.json()) as { currentPassword?: string; newPassword?: string };
  if (!body.currentPassword || !(await passwordMatches(body.currentPassword))) {
    return error("目前密碼不正確", 401);
  }
  const newPassword = body.newPassword ?? "";
  if (newPassword.length < 12) return error("新密碼至少需要 12 個字元");
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return error("新密碼必須同時包含英文字母與數字");
  }
  if (await passwordMatches(newPassword)) return error("新密碼不能與目前密碼相同");
  await updateAdminPassword(newPassword);
  await addAudit("admin_password_changed", "all admin sessions revoked");
  return json(
    { ok: true },
    200,
    { "set-cookie": clearCookie("admin_session") },
  );
}
