import { json } from "@/lib/responses";
import { clearCookie } from "@/lib/session";

export async function POST() {
  return json({ ok: true }, 200, { "set-cookie": clearCookie("admin_session") });
}
