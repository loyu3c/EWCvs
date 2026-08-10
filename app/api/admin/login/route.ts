import { error, json } from "@/lib/responses";
import { createSession, passwordMatches, sessionCookie } from "@/lib/session";

export async function POST(request: Request) {
  const body = (await request.json()) as { password?: string };
  if (!body.password || !(await passwordMatches(body.password))) return error("管理密碼不正確", 401);
  const token = await createSession({ kind: "admin" }, 8);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("admin_session", token) });
}
