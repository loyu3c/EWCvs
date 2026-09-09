"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type Status = "setup" | "open" | "paused" | "closed";
type ImportRow = {
  name: string;
  employeeNumber: string;
  department: string;
  unit: string;
  electionGroup: string;
  incumbent: boolean;
  formerMember: boolean;
};
type ImportGroupSummary = { name: string; count: number; incumbents: number; formerMembers: number };
type Dashboard = {
  settings: { title: string; status: Status; updatedAt: string };
  totals: { employees: number; votes: number; testEmployees: number };
  units: { department: string; unit: string; total: number; voted: number }[];
  candidates: {
    id: number; name: string; employeeNumber: string; department: string; unit: string; electionGroup: string; incumbent: boolean; formerMember: boolean; votes: number;
  }[];
  logs: { action: string; details: string | null; createdAt: string }[];
};

const statusLabel: Record<Status, string> = { setup: "籌備中", open: "投票中", paused: "已暫停", closed: "已結束" };

async function readJson(response: Response) {
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(data.error ?? "操作失敗"));
  return data;
}

function truthy(value: unknown) {
  return ["是", "現任", "現任福委", "曾任", "當過", "yes", "true", "1", "y", "v"].includes(String(value ?? "").trim().toLowerCase());
}

function cellText(row: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function AdminApp() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [importIssues, setImportIssues] = useState<string[]>([]);
  const [importGroups, setImportGroups] = useState<ImportGroupSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activePanel, setActivePanel] = useState<"overview" | "import" | "results" | "logs" | "tools">("overview");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [resetScope, setResetScope] = useState<"test" | "all" | null>(null);
  const [resetConfirmation, setResetConfirmation] = useState("");

  const loadDashboard = useCallback(async (silent = false) => {
    try {
      const response = await fetch("/api/admin/dashboard", { cache: "no-store" });
      if (response.status === 401) { setAuthenticated(false); return; }
      const data = await readJson(response);
      setDashboard(data as unknown as Dashboard);
      setAuthenticated(true);
    } catch (caught) {
      if (!silent) setError(caught instanceof Error ? caught.message : "無法讀取管理資料");
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    const timer = window.setInterval(() => loadDashboard(true), 5000);
    return () => window.clearInterval(timer);
  }, [loadDashboard]);

  const login = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await readJson(await fetch("/api/admin/login", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }),
      }));
      setPassword(""); await loadDashboard();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "登入失敗"); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    setAuthenticated(false); setDashboard(null);
  };

  const parseExcel = async (file: File) => {
    setError(""); setMessage(""); setRows([]); setImportIssues([]); setImportGroups([]);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      if (!workbook.SheetNames.includes("清冊")) throw new Error("找不到「清冊」工作表");
      const groupSheetNames = workbook.SheetNames.filter((name) => name !== "清冊");
      if (!groupSheetNames.length) throw new Error("清冊後方至少需要一個選舉分組工作表");

      const masterRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["清冊"], { defval: "" });
      const masterRows = masterRaw.map((item) => ({
        name: cellText(item, ["中文姓名", "姓名"]),
        employeeNumber: cellText(item, ["員編", "員工編號"]),
        department: cellText(item, ["部門"]),
        unit: cellText(item, ["單位"]),
        electionGroup: "",
        incumbent: false,
        formerMember: false,
      })).filter((row) => row.name || row.employeeNumber || row.department || row.unit);

      if (!masterRows.length) throw new Error("「清冊」工作表沒有員工資料");

      const issues: string[] = [];
      const masterById = new Map<string, ImportRow>();
      for (const row of masterRows) {
        if (!row.name || !row.employeeNumber || !row.department || !row.unit) {
          issues.push("清冊有必填欄位空白：" + (row.employeeNumber || row.name || "無法辨識的資料列"));
          continue;
        }
        if (masterById.has(row.employeeNumber)) {
          issues.push("清冊員編重複：" + row.employeeNumber);
          continue;
        }
        masterById.set(row.employeeNumber, row);
      }

      const assigned = new Map<string, ImportRow>();
      const membership = new Map<string, string>();
      const summaries: ImportGroupSummary[] = [];

      for (const groupName of groupSheetNames) {
        const groupSheet = workbook.Sheets[groupName];
        const headerRow = XLSX.utils.sheet_to_json<unknown[]>(groupSheet, { header: 1, range: 0, blankrows: false })[0] ?? [];
        const groupHeaders = new Set(headerRow.map((value) => String(value ?? "").trim()));
        const missingColumns = ["部門", "單位", "員編", "中文姓名", "現任", "當過"].filter((column) => !groupHeaders.has(column));
        if (missingColumns.length) issues.push(`「${groupName}」缺少欄位：${missingColumns.join("、")}`);

        const groupRaw = XLSX.utils.sheet_to_json<Record<string, unknown>>(groupSheet, { defval: "" });
        const seenInGroup = new Set<string>();
        let incumbents = 0;
        let formerMembers = 0;

        for (const item of groupRaw) {
          const employeeNumber = cellText(item, ["員編", "員工編號"]);
          if (!employeeNumber) continue;
          if (seenInGroup.has(employeeNumber)) {
            issues.push(groupName + " 內員編重複：" + employeeNumber);
            continue;
          }
          seenInGroup.add(employeeNumber);

          const master = masterById.get(employeeNumber);
          if (!master) {
            issues.push(groupName + " 有清冊外員工：" + employeeNumber);
            continue;
          }
          const previousGroup = membership.get(employeeNumber);
          if (previousGroup) {
            issues.push("員工 " + employeeNumber + " 同時出現在「" + previousGroup + "」與「" + groupName + "」");
            continue;
          }

          const groupNameValue = cellText(item, ["中文姓名", "姓名"]);
          const groupDepartment = cellText(item, ["部門"]);
          const groupUnit = cellText(item, ["單位"]);
          if (
            (groupNameValue && groupNameValue !== master.name) ||
            (groupDepartment && groupDepartment !== master.department) ||
            (groupUnit && groupUnit !== master.unit)
          ) {
            issues.push(groupName + " 與清冊資料不一致：" + employeeNumber);
            continue;
          }

          const incumbent = truthy(item["現任"] ?? item["是否現任福委"] ?? item["現任福委"]);
          const formerMember = truthy(item["當過"] ?? item["是否當過福委"] ?? item["曾任福委"]);
          if (incumbent) incumbents += 1;
          if (formerMember) formerMembers += 1;
          membership.set(employeeNumber, groupName);
          assigned.set(employeeNumber, { ...master, electionGroup: groupName, incumbent, formerMember });
        }
        summaries.push({ name: groupName, count: seenInGroup.size, incumbents, formerMembers });
      }

      for (const [employeeNumber, master] of masterById) {
        if (!membership.has(employeeNumber)) issues.push("未分配選舉分組：" + employeeNumber + " " + master.name);
      }

      const parsed = Array.from(masterById, ([employeeNumber, master]) =>
        assigned.get(employeeNumber) ?? master
      );
      setRows(parsed);
      setImportIssues(issues);
      setImportGroups(summaries);
      setFileName(file.name);
    } catch (caught) {
      setRows([]); setImportIssues([]); setImportGroups([]); setFileName("");
      setError(caught instanceof Error ? caught.message : "Excel 讀取失敗");
    }
  };

  const importRows = async () => {
    if (importIssues.length) { setError("請先修正匯入檢查列出的問題"); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await readJson(await fetch("/api/admin/import", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows }),
      }));
      setMessage(`已成功匯入 ${data.count} 位員工，共 ${data.groupCount} 個選舉分組`); setRows([]); setImportIssues([]); setImportGroups([]); setFileName(""); await loadDashboard();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "匯入失敗"); }
    finally { setBusy(false); }
  };

  const changeStatus = async (status: Status) => {
    setBusy(true); setError(""); setMessage("");
    try {
      await readJson(await fetch("/api/admin/status", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
      }));
      setMessage(`投票狀態已更新為「${statusLabel[status]}」`); await loadDashboard();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "狀態更新失敗"); }
    finally { setBusy(false); }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setMessage("");
    if (newPassword !== confirmPassword) { setError("兩次輸入的新密碼不一致"); return; }
    setBusy(true);
    try {
      await readJson(await fetch("/api/admin/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      }));
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setPasswordChanged(true); setDashboard(null); setAuthenticated(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "密碼修改失敗"); }
    finally { setBusy(false); }
  };

  const generateTestData = async () => {
    if (!window.confirm("確定要產生 100 筆測試員工資料嗎？")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await readJson(await fetch("/api/admin/test-data", { method: "POST" }));
      setMessage(`已產生 ${data.count} 筆測試資料`); await loadDashboard();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "測試資料產生失敗"); }
    finally { setBusy(false); }
  };

  const resetData = async () => {
    if (!resetScope) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await readJson(await fetch("/api/admin/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: resetScope, confirmation: resetConfirmation }),
      }));
      setMessage(resetScope === "test" ? `已清除 ${data.count} 筆測試資料` : `已清除全部 ${data.count} 筆員工資料`);
      setResetScope(null); setResetConfirmation(""); await loadDashboard();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "資料清除失敗"); }
    finally { setBusy(false); }
  };

  const groupedResults = useMemo(() => {
    const groups = new Map<string, Dashboard["candidates"]>();
    for (const candidate of dashboard?.candidates ?? []) {
      const key = candidate.electionGroup || "未分組";
      groups.set(key, [...(groups.get(key) ?? []), candidate]);
    }
    return groups;
  }, [dashboard]);

  const downloadTemplate = () => {
    const book = XLSX.utils.book_new();
    const headers = [["部門", "單位", "員編", "中文姓名"]];
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ...headers,
      ["營運部", "行政組", "E0001", "王小明"],
    ]), "清冊");
    const groupNames = ["餐飲", "廚務", "房務", "客務", "後勤", "管理部", "休開", "工程部"];
    for (const groupName of groupNames) {
      const rows = [["部門", "單位", "員編", "中文姓名", "現任", "當過"]];
      if (groupName === "餐飲") rows.push(["營運部", "行政組", "E0001", "王小明", "v", ""]);
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), groupName);
    }
    XLSX.writeFile(book, "福委改選分組名單範本.xlsx");
  };

  const exportResults = () => {
    if (!dashboard) return;
    const records = dashboard.candidates.map((candidate) => ({
      選舉分組: candidate.electionGroup, 部門: candidate.department, 單位: candidate.unit, 姓名: candidate.name,
      員工編號: candidate.employeeNumber, 是否現任福委: candidate.incumbent ? "是" : "否",
      是否當過福委: candidate.formerMember ? "是" : "否", 得票數: candidate.votes,
    }));
    const sheet = XLSX.utils.json_to_sheet(records);
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "開票結果");
    XLSX.writeFile(book, "福委改選開票結果.xlsx");
  };

  if (authenticated === null) return <main className="admin-login-shell"><div className="loading-card">正在開啟管理後台…</div></main>;
  if (!authenticated) return (
    <main className="admin-login-shell">
      <a className="brand admin-login-brand" href="/"><span className="brand-mark">福</span><span>福委改選</span></a>
      <form className="admin-login-card" onSubmit={login}>
        <p className="eyebrow">ADMINISTRATION</p>
        <h1>管理者登入</h1>
        <p>請輸入管理密碼，進入名單、投票與開票管理。</p>
        {passwordChanged && <div className="login-success">密碼已更新，請使用新密碼重新登入。</div>}
        <label><span>管理密碼</span><input type="password" autoFocus required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="輸入管理密碼" /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button full-button" disabled={busy}>{busy ? "登入中…" : "進入管理後台"}</button>
        <a className="back-link" href="/">← 返回投票入口</a>
      </form>
    </main>
  );

  const turnout = dashboard?.totals.employees ? Math.round((dashboard.totals.votes / dashboard.totals.employees) * 100) : 0;

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <a className="brand" href="/"><span className="brand-mark light">福</span><span>福委改選</span></a>
        <p className="sidebar-caption">管理控制台</p>
        <nav>
          <button className={activePanel === "overview" ? "active" : ""} onClick={() => setActivePanel("overview")}><span>⌂</span>總覽</button>
          <button className={activePanel === "import" ? "active" : ""} onClick={() => setActivePanel("import")}><span>⇧</span>名單匯入</button>
          <button className={activePanel === "results" ? "active" : ""} onClick={() => setActivePanel("results")}><span>▥</span>即時票數</button>
          <button className={activePanel === "logs" ? "active" : ""} onClick={() => setActivePanel("logs")}><span>≡</span>操作紀錄</button>
          <button className={activePanel === "tools" ? "active" : ""} onClick={() => setActivePanel("tools")}><span>⚙</span>系統工具</button>
        </nav>
        <div className="sidebar-bottom">
          <a href="/" target="_blank">開啟投票頁 ↗</a>
          <button onClick={logout}>登出管理後台</button>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div><p className="eyebrow">ELECTION CONTROL CENTER</p><h1>{dashboard?.settings.title ?? "福委改選"}</h1></div>
          <div className="live-indicator"><span /> 每 5 秒更新</div>
        </header>
        {error && <div className="notice error-notice">{error}<button onClick={() => setError("")}>×</button></div>}
        {message && <div className="notice success-notice">{message}<button onClick={() => setMessage("")}>×</button></div>}

        {activePanel === "overview" && dashboard && (
          <div className="admin-panel-stack">
            <section className="control-card">
              <div><p className="section-kicker">投票狀態</p><h2>{statusLabel[dashboard.settings.status]}</h2><p>管理投票入口的開放狀態。暫停與結束後，員工將無法送出選票。</p></div>
              <div className="status-controls">
                <button disabled={busy || dashboard.settings.status === "open"} onClick={() => changeStatus("open")}>▶ 開放投票</button>
                <button disabled={busy || dashboard.settings.status === "paused"} onClick={() => changeStatus("paused")}>Ⅱ 暫停投票</button>
                <button className="close-control" disabled={busy || dashboard.settings.status === "closed"} onClick={() => changeStatus("closed")}>■ 結束投票</button>
              </div>
            </section>
            <section className="metric-grid">
              <article><span className="metric-label">名單總人數</span><strong>{dashboard.totals.employees}</strong><small>位具投票資格員工</small></article>
              <article className="accent-metric"><span className="metric-label">已完成投票</span><strong>{dashboard.totals.votes}</strong><small>張有效選票</small></article>
              <article><span className="metric-label">目前投票率</span><strong>{turnout}<em>%</em></strong><div className="progress"><span style={{ width: `${turnout}%` }} /></div></article>
            </section>
            <section className="admin-card">
              <div className="panel-heading"><div><p className="section-kicker">TURNOUT BY UNIT</p><h2>各單位投票進度</h2></div><button className="text-button" onClick={() => setActivePanel("results")}>查看即時票數 →</button></div>
              <div className="unit-table">
                <div className="table-row table-head"><span>部門／單位</span><span>已投票</span><span>投票率</span></div>
                {dashboard.units.map((item) => {
                  const percentage = item.total ? Math.round((item.voted / item.total) * 100) : 0;
                  return <div className="table-row" key={`${item.department}-${item.unit}`}><span><strong>{item.unit}</strong><small>{item.department}</small></span><span>{item.voted} / {item.total}</span><span className="table-progress"><i><b style={{ width: `${percentage}%` }} /></i><strong>{percentage}%</strong></span></div>;
                })}
              </div>
            </section>
          </div>
        )}

        {activePanel === "import" && (
          <div className="admin-panel-stack">
            <section className="admin-card import-card">
              <div className="panel-heading"><div><p className="section-kicker">EMPLOYEE ROSTER</p><h2>匯入員工名單</h2><p>第一個頁籤須為「清冊」，後續每個頁籤代表一個選舉分組。</p></div><button className="secondary-button" onClick={downloadTemplate}>下載 Excel 範本</button></div>
              <label className="drop-zone">
                <input type="file" accept=".xlsx,.xls" onChange={(event) => event.target.files?.[0] && parseExcel(event.target.files[0])} />
                <span className="upload-icon">⇧</span><strong>{fileName || "選擇 Excel 名單"}</strong><small>點擊選擇檔案，名單不會在確認前寫入系統</small>
              </label>
              <div className="required-columns"><span>清冊欄位</span>{["部門", "單位", "員編", "中文姓名"].map((column) => <b key={column}>{column}</b>)}<span>分組頁籤另加</span><b>現任</b><b>當過</b></div>
            </section>
            {rows.length > 0 && <section className="admin-card preview-card">
              <div className="panel-heading"><div><p className="section-kicker">IMPORT PREVIEW</p><h2>匯入預覽</h2><p>共讀取 {rows.length} 筆、{importGroups.length} 個選舉分組，以下顯示前 8 筆。</p></div><button className="primary-button" disabled={busy || importIssues.length > 0} onClick={importRows}>{busy ? "匯入中…" : importIssues.length ? "請先修正資料" : `確認匯入 ${rows.length} 筆`}</button></div>
              <div className="import-summary">{importGroups.map((group) => <div key={group.name}><strong>{group.name}</strong><span>{group.count} 人</span><small>現任 {group.incumbents} 人・曾任 {group.formerMembers} 人</small></div>)}</div>
              {importIssues.length > 0 && <div className="import-issues" role="alert"><strong>發現 {importIssues.length} 個問題，尚未匯入</strong><ul>{importIssues.slice(0, 30).map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul>{importIssues.length > 30 && <p>另有 {importIssues.length - 30} 個問題未顯示。</p>}</div>}
              <div className="preview-table"><div className="preview-row preview-head"><span>姓名</span><span>員工編號</span><span>部門</span><span>單位</span><span>選舉分組</span><span>現任</span><span>當過</span></div>{rows.slice(0, 8).map((row, index) => <div className="preview-row" key={`${row.employeeNumber}-${index}`}><span>{row.name || "—"}</span><span>{row.employeeNumber || "—"}</span><span>{row.department || "—"}</span><span>{row.unit || "—"}</span><span>{row.electionGroup || "未分組"}</span><span>{row.incumbent ? "是" : "否"}</span><span>{row.formerMember ? "是" : "否"}</span></div>)}</div>
            </section>}
          </div>
        )}

        {activePanel === "results" && dashboard && (
          <div className="admin-panel-stack">
            <section className="results-header"><div><p className="section-kicker">LIVE RESULTS</p><h2>即時票數</h2><p>票數僅供管理者查看；結果不顯示個別員工的投票選擇。</p></div><button className="secondary-button" onClick={exportResults}>匯出開票結果</button></section>
            {Array.from(groupedResults, ([key, candidates]) => {
              const eligibleCandidates = candidates.filter((candidate) => !candidate.incumbent && !candidate.formerMember);
              const max = Math.max(0, ...eligibleCandidates.map((candidate) => Number(candidate.votes)));
              const leaders = eligibleCandidates.filter((candidate) => Number(candidate.votes) === max && max > 0);
              const tied = leaders.length > 1;
              return <section className="admin-card result-group" key={key}>
                <div className="result-group-title"><div><p>{eligibleCandidates.length} 位可選／{candidates.length} 位名單</p><h3>{key}</h3></div>{tied && <span className="tie-badge">最高票同票・待管理者處理</span>}</div>
                <div className="result-list">{candidates.map((candidate, index) => {
                  const votes = Number(candidate.votes);
                  const leader = !candidate.incumbent && !candidate.formerMember && votes === max && max > 0;
                  return <div className={`result-row ${leader ? "leader" : ""}`} key={candidate.id}><span className="rank">{String(index + 1).padStart(2, "0")}</span><span className="result-person"><strong>{candidate.name}</strong><small>{candidate.employeeNumber}{candidate.incumbent ? " · 現任福委" : candidate.formerMember ? " · 曾任福委" : ""}</small></span><span className="vote-bar"><i><b style={{ width: max ? `${(votes / max) * 100}%` : "0%" }} /></i></span><strong className="vote-number">{votes}<small>票</small></strong>{leader && <span className="leader-label">最高票</span>}</div>;
                })}</div>
              </section>;
            })}
            {dashboard.candidates.length === 0 && <div className="empty-admin-state">尚未匯入候選人名單。</div>}
          </div>
        )}

        {activePanel === "logs" && dashboard && (
          <section className="admin-card">
            <div className="panel-heading"><div><p className="section-kicker">AUDIT TRAIL</p><h2>操作紀錄</h2><p>記錄名單匯入、狀態調整與投票送出，不在此顯示投票內容。</p></div></div>
            <div className="log-list">{dashboard.logs.map((log, index) => {
              const actionLabel: Record<string, string> = {
                employee_import: "匯入員工名單", status_change: "調整投票狀態", vote_cast: "收到一張選票",
                admin_password_changed: "修改管理密碼", test_data_generated: "產生測試資料",
                test_data_cleared: "清空測試資料", all_data_cleared: "清空全部資料",
              };
              return <div className="log-item" key={`${log.createdAt}-${index}`}><span className="log-dot" /><div><strong>{actionLabel[log.action] ?? log.action}</strong><small>{new Date(log.createdAt).toLocaleString("zh-TW", { hour12: false })}</small></div><span>{log.action === "vote_cast" ? "投票成功" : log.details}</span></div>;
            })}</div>
          </section>
        )}

        {activePanel === "tools" && dashboard && (
          <div className="admin-panel-stack">
            <section className="results-header tools-header">
              <div><p className="section-kicker">SYSTEM TOOLS</p><h2>系統工具</h2><p>管理後台密碼、建立測試名單，以及安全地重設選舉資料。</p></div>
            </section>
            <div className="tools-grid">
              <form className="admin-card tool-card" onSubmit={changePassword}>
                <span className="tool-index">01</span>
                <div><p className="section-kicker">ACCOUNT SECURITY</p><h2>修改後台密碼</h2><p>修改後，所有已登入的管理者都必須使用新密碼重新登入。</p></div>
                <label><span>目前密碼</span><input type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
                <label><span>新密碼</span><input type="password" required minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 12 字元，包含英文與數字" /></label>
                <label><span>再次輸入新密碼</span><input type="password" required minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
                <button className="primary-button" disabled={busy}>儲存新密碼</button>
              </form>

              <section className="admin-card tool-card">
                <span className="tool-index">02</span>
                <div><p className="section-kicker">TEST DATA</p><h2>測試資料</h2><p>在空白名單中建立 100 位測試員工，分布於 5 個部門、10 個單位。</p></div>
                <div className="tool-summary"><span>目前測試資料</span><strong>{dashboard.totals.testEmployees}<small> 筆</small></strong></div>
                <button className="primary-button" disabled={busy || dashboard.settings.status === "open" || dashboard.totals.employees > 0} onClick={generateTestData}>產生 100 筆測試資料</button>
                {dashboard.totals.employees > 0 && <p className="tool-hint">名單已有資料；清空後才能產生測試資料。</p>}
                <button className="secondary-button" disabled={busy || dashboard.settings.status === "open" || dashboard.totals.testEmployees === 0} onClick={() => { setResetScope("test"); setResetConfirmation(""); }}>清空測試資料</button>
              </section>

              <section className="admin-card tool-card danger-card">
                <span className="tool-index">03</span>
                <div><p className="section-kicker">DANGER ZONE</p><h2>清空全部資料</h2><p>刪除所有員工名單、選票與操作紀錄，並將選舉重設為籌備中。</p></div>
                <div className="danger-note">此動作無法復原。正式資料清除前，請先匯出開票結果。</div>
                <button className="danger-button" disabled={busy || dashboard.settings.status === "open" || dashboard.totals.employees === 0} onClick={() => { setResetScope("all"); setResetConfirmation(""); }}>清空全部資料</button>
                {dashboard.settings.status === "open" && <p className="tool-hint">請先暫停或結束投票。</p>}
              </section>
            </div>
          </div>
        )}
      </section>

      {resetScope && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-modal reset-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title">
            <p className="eyebrow">DESTRUCTIVE ACTION</p>
            <h2 id="reset-title">{resetScope === "test" ? "清空測試資料？" : "清空全部資料？"}</h2>
            <p>{resetScope === "test" ? "所有 TEST 開頭的員工及相關選票將被刪除。" : "所有員工、選票與統計資料都將被永久刪除。"}</p>
            <label><span>請輸入「{resetScope === "test" ? "清空測試資料" : "清空全部資料"}」確認</span><input autoFocus value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} /></label>
            <div className="modal-actions">
              <button className="secondary-button" disabled={busy} onClick={() => { setResetScope(null); setResetConfirmation(""); }}>取消</button>
              <button className="danger-button" disabled={busy || resetConfirmation !== (resetScope === "test" ? "清空測試資料" : "清空全部資料")} onClick={resetData}>{busy ? "處理中…" : "確認清空"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
