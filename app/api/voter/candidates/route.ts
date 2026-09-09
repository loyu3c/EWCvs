import { ensureSchema, getDatabase } from "@/lib/database";
import { error, json } from "@/lib/responses";
import { getVoterSession } from "@/lib/session";

export async function GET(request: Request) {
  await ensureSchema();
  const session = await getVoterSession(request);
  if (!session?.employeeId) return error("請先完成身分驗證", 401);
  const db = getDatabase();
  const voter = await db.prepare(
    `SELECT e.id, e.name, e.department, e.unit, e.election_group AS electionGroup,
      EXISTS(SELECT 1 FROM votes v WHERE v.voter_employee_id = e.id) AS has_voted
     FROM employees e WHERE e.id = ?`,
  ).bind(session.employeeId).first<{
    id: number;
    name: string;
    department: string;
    unit: string;
    electionGroup: string;
    has_voted: number;
  }>();
  if (!voter) return error("找不到投票者資料", 404);
  if (!voter.electionGroup) return error("名單尚未設定選舉分組，請聯絡管理者", 409);

  const candidates = await db.prepare(
    `SELECT id, name, employee_number AS employeeNumber, incumbent, former_member AS formerMember
     FROM employees WHERE election_group = ? ORDER BY employee_number ASC`,
  ).bind(voter.electionGroup).all<{
    id: number;
    name: string;
    employeeNumber: string;
    incumbent: number;
    formerMember: number;
  }>();

  return json({
    voter: {
      name: voter.name,
      department: voter.department,
      unit: voter.unit,
      electionGroup: voter.electionGroup,
      hasVoted: Boolean(voter.has_voted),
    },
    candidates: (candidates.results ?? []).map((candidate) => ({
      ...candidate,
      incumbent: Boolean(candidate.incumbent),
      formerMember: Boolean(candidate.formerMember),
    })),
  });
}
