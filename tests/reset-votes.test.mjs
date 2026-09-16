import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("vote-only reset preserves the employee roster", async () => {
  const route = await readFile(new URL("app/api/admin/reset/route.ts", root), "utf8");
  const start = route.indexOf('if (body.scope === "votes")');
  const end = route.indexOf("const total =", start);
  const voteReset = route.slice(start, end);

  assert.ok(start >= 0 && end > start, "vote-only reset branch should exist");
  assert.match(voteReset, /DELETE FROM votes/);
  assert.match(voteReset, /DELETE FROM audit_logs WHERE action = 'vote_cast'/);
  assert.match(voteReset, /UPDATE election_settings SET status = 'setup'/);
  assert.match(voteReset, /vote_data_cleared/);
  assert.doesNotMatch(voteReset, /DELETE FROM employees/);
});

test("admin tools clearly distinguish vote-only reset from full reset", async () => {
  const admin = await readFile(new URL("app/components/AdminApp.tsx", root), "utf8");

  assert.match(admin, /只清空投票資料/);
  assert.match(admin, /員工名單、選舉分組及候選資格都會保留/);
  assert.match(admin, /confirmation: "清空投票資料"/);
  assert.match(admin, /setResetScope\("votes"\)/);
});
