import { addAudit, ensureSchema, getDatabase } from "@/lib/database";
import { error, json } from "@/lib/responses";
import { clearCookie, getVoterSession } from "@/lib/session";

export async function POST(request: Request) {
  await ensureSchema();
  const session = await getVoterSession(request);
  if (!session?.employeeId) return error("投票階段已逾時，請重新登入", 401);
  const body = (await request.json()) as { candidateId?: number };
  if (!Number.isInteger(body.candidateId)) return error("請選擇一位候選人");

  const db = getDatabase();
  const settings = await db.prepare("SELECT status FROM election_settings WHERE id = 1").first<{ status: string }>();
  if (settings?.status !== "open") return error("目前投票已暫停或結束", 403);

  const match = await db.prepare(
    `SELECT voter.id AS voter_id, candidate.id AS candidate_id
     FROM employees voter
     JOIN employees candidate ON candidate.id = ?
       AND candidate.election_group = voter.election_group
     WHERE voter.id = ? AND voter.election_group <> ''`,
  ).bind(body.candidateId!, session.employeeId).first<{ voter_id: number; candidate_id: number }>();
  if (!match) return error("候選人不屬於您的選舉分組", 400);

  const receiptCode = crypto.randomUUID().split("-")[0].toUpperCase();
  try {
    await db.prepare(
      "INSERT INTO votes (voter_employee_id, candidate_employee_id, receipt_code, cast_at) VALUES (?, ?, ?, ?)",
    ).bind(match.voter_id, match.candidate_id, receiptCode, new Date().toISOString()).run();
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    const postgresCode = typeof caught === "object" && caught !== null && "code" in caught
      ? String(caught.code)
      : "";
    if (postgresCode === "23505") return error("此員工編號已完成投票", 409);
    if (message.includes("UNIQUE")) return error("此員工編號已完成投票", 409);
    throw caught;
  }
  await addAudit("vote_cast", `voter:${match.voter_id}`);
  return json(
    { ok: true, receiptCode },
    200,
    { "set-cookie": clearCookie("voter_session") },
  );
}
