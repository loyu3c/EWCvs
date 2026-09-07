"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type ElectionStatus = "setup" | "open" | "paused" | "closed";
type Department = { name: string; units: { name: string; employeeNumbers: string[] }[] };
type Options = { election: { title: string; status: ElectionStatus }; departments: Department[] };
type Candidate = { id: number; name: string; employeeNumber: string; incumbent: boolean };
type Voter = { name: string; department: string; unit: string; electionGroup: string; hasVoted: boolean };

const statusCopy: Record<ElectionStatus, { label: string; message: string }> = {
  setup: { label: "籌備中", message: "名單正在準備，投票入口尚未開放。" },
  open: { label: "投票進行中", message: "請完成身分驗證後投下您的一票。" },
  paused: { label: "暫停投票", message: "投票目前暫停，請稍後再回來。" },
  closed: { label: "投票已結束", message: "本次福委改選投票已經結束。" },
};

async function readJson(response: Response) {
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(data.error ?? "操作未完成，請稍後再試"));
  return data;
}

export function VoteApp() {
  const [options, setOptions] = useState<Options | null>(null);
  const [department, setDepartment] = useState("");
  const [unit, setUnit] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [name, setName] = useState("");
  const [voter, setVoter] = useState<Voter | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadCandidates = async () => {
    const response = await fetch("/api/voter/candidates", { cache: "no-store" });
    if (response.status === 401) return;
    const data = await readJson(response) as unknown as { voter: Voter; candidates: Candidate[] };
    setVoter(data.voter);
    setCandidates(data.candidates);
  };

  useEffect(() => {
    Promise.all([
      fetch("/api/public/options", { cache: "no-store" })
        .then(readJson)
        .then((data) => setOptions(data as unknown as Options))
        .catch((caught) => setError(caught instanceof Error ? caught.message : "無法讀取投票資料")),
      loadCandidates().catch(() => undefined),
    ]);
  }, []);

  const units = useMemo(
    () => options?.departments.find((item) => item.name === department)?.units ?? [],
    [options, department],
  );
  const employeeNumbers = units.find((item) => item.name === unit)?.employeeNumbers ?? [];
  const status = options?.election.status ?? "setup";

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await readJson(await fetch("/api/voter/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ department, unit, employeeNumber, name }),
      }));
      await loadCandidates();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "身分驗證失敗");
    } finally {
      setBusy(false);
    }
  };

  const castVote = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const data = await readJson(await fetch("/api/voter/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ candidateId: selected.id }),
      }));
      setReceipt(String(data.receiptCode));
      setConfirming(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "選票送出失敗");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="voter-shell">
      <header className="public-header">
        <a className="brand" href="/" aria-label="福委改選首頁">
          <span className="brand-mark">福</span>
          <span>福委改選</span>
        </a>
        <div className={`status-pill status-${status}`}>
          <span className="status-dot" />
          {statusCopy[status].label}
        </div>
      </header>

      <section className="vote-hero">
        <div className="hero-copy">
          <p className="eyebrow">EMPLOYEE WELFARE COMMITTEE</p>
          <h1>{options?.election.title ?? "福委改選投票"}</h1>
          <p className="hero-lead">一張選票，一份對工作生活的期待。</p>
        </div>
        <div className="ballot-stamp" aria-hidden="true">
          <span>2026</span>
          <strong>YOUR<br />VOTE</strong>
        </div>
      </section>

      <section className="vote-stage" aria-live="polite">
        {!options && !error && <div className="loading-card">正在準備投票入口…</div>}

        {receipt ? (
          <div className="completion-card">
            <div className="completion-check">✓</div>
            <p className="eyebrow">BALLOT RECEIVED</p>
            <h2>選票已成功送出</h2>
            <p>謝謝您參與本次福委改選。您的選票已安全記錄，送出後無法修改。</p>
            <div className="receipt-box">
              <span>完成編號</span>
              <strong>{receipt}</strong>
            </div>
            <p className="fine-print">完成編號僅供確認投票成功，不會顯示投票內容。</p>
          </div>
        ) : voter?.hasVoted ? (
          <div className="completion-card compact-completion">
            <div className="completion-check muted">✓</div>
            <h2>您已完成投票</h2>
            <p>每位員工僅能投一票，無法再次進入投票畫面。</p>
          </div>
        ) : voter ? (
          <div className="ballot-layout">
            <div className="ballot-heading">
              <div>
                <p className="eyebrow">STEP 2 OF 2 · CAST YOUR VOTE</p>
                <h2>選擇一位候選人</h2>
                <p>{voter.department}・{voter.unit}｜選舉分組：{voter.electionGroup}｜投票人：{voter.name}</p>
              </div>
              <span className="choice-count">單選 1 人</span>
            </div>
            <div className="candidate-grid">
              {candidates.map((candidate, index) => (
                <button
                  className={`candidate-card ${selected?.id === candidate.id ? "selected" : ""}`}
                  key={candidate.id}
                  type="button"
                  onClick={() => setSelected(candidate)}
                  aria-pressed={selected?.id === candidate.id}
                >
                  <span className="candidate-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="candidate-info">
                    <span className="candidate-name">{candidate.name}</span>
                    <span className="employee-code">員編 {candidate.employeeNumber}</span>
                  </span>
                  {candidate.incumbent && <span className="incumbent-badge">現任福委</span>}
                  <span className="radio-mark" aria-hidden="true" />
                </button>
              ))}
            </div>
            {error && <p className="form-error">{error}</p>}
            <div className="ballot-action">
              <p>請確認選擇後再送出，送出後無法修改。</p>
              <button className="primary-button" disabled={!selected} onClick={() => setConfirming(true)}>
                確認我的選擇 <span>→</span>
              </button>
            </div>
          </div>
        ) : options && status === "open" ? (
          <div className="login-layout">
            <div className="step-rail" aria-label="投票步驟">
              <div className="step active"><span>01</span><div><strong>身分驗證</strong><small>確認您的員工資料</small></div></div>
              <div className="rail-line" />
              <div className="step"><span>02</span><div><strong>投下選票</strong><small>選擇一位候選人</small></div></div>
            </div>
            <form className="login-card" onSubmit={submitLogin}>
              <div className="card-heading">
                <p className="eyebrow">STEP 1 OF 2 · VERIFY IDENTITY</p>
                <h2>開始投票</h2>
                <p>請依序選擇所屬單位，並輸入姓名完成驗證。</p>
              </div>
              <label>
                <span>部門</span>
                <select required value={department} onChange={(event) => {
                  setDepartment(event.target.value); setUnit(""); setEmployeeNumber("");
                }}>
                  <option value="">請選擇部門</option>
                  {options.departments.map((item) => <option key={item.name}>{item.name}</option>)}
                </select>
              </label>
              <label>
                <span>單位</span>
                <select required disabled={!department} value={unit} onChange={(event) => {
                  setUnit(event.target.value); setEmployeeNumber("");
                }}>
                  <option value="">請選擇單位</option>
                  {units.map((item) => <option key={item.name}>{item.name}</option>)}
                </select>
              </label>
              <div className="form-row">
                <label>
                  <span>員工編號</span>
                  <select required disabled={!unit} value={employeeNumber} onChange={(event) => setEmployeeNumber(event.target.value)}>
                    <option value="">請選擇員編</option>
                    {employeeNumbers.map((number) => <option key={number}>{number}</option>)}
                  </select>
                </label>
                <label>
                  <span>姓名</span>
                  <input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="請輸入完整姓名" />
                </label>
              </div>
              {error && <p className="form-error">{error}</p>}
              <button className="primary-button full-button" disabled={busy} type="submit">
                {busy ? "驗證中…" : "驗證並進入投票"} <span>→</span>
              </button>
              <p className="privacy-note"><span>i</span> 每位員工僅能投票一次，請勿代替他人投票。</p>
            </form>
          </div>
        ) : options ? (
          <div className="closed-card">
            <span className="closed-index">{status === "setup" ? "準備" : status === "paused" ? "暫停" : "結束"}</span>
            <p className="eyebrow">ELECTION STATUS</p>
            <h2>{statusCopy[status].label}</h2>
            <p>{statusCopy[status].message}</p>
            {options.departments.length === 0 && <p className="fine-print">管理者完成名單匯入後，投票入口將顯示可選資料。</p>}
          </div>
        ) : null}
      </section>

      <footer className="public-footer">
        <span>福委改選投票系統</span>
        <span>每一票，都讓我們的工作生活更好</span>
        <a href="/admin">管理後台</a>
      </footer>

      {confirming && selected && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <p className="eyebrow">FINAL CONFIRMATION</p>
            <h2 id="confirm-title">確認送出這張選票？</h2>
            <p>您選擇的是</p>
            <div className="confirm-choice">
              <strong>{selected.name}</strong>
              {selected.incumbent && <span className="incumbent-badge">現任福委</span>}
            </div>
            <p className="warning-copy">選票送出後無法修改，且您不能再次投票。</p>
            <div className="modal-actions">
              <button className="secondary-button" disabled={busy} onClick={() => setConfirming(false)}>返回修改</button>
              <button className="primary-button" disabled={busy} onClick={castVote}>{busy ? "送出中…" : "確認送出選票"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
