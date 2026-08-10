# 福委改選投票系統

以 Next.js 與 PostgreSQL 建置的記名投票系統，可部署於 Zeabur。

## 功能

- 依部門、單位、員工編號及姓名進行簡易身分驗證
- 每位員工限投一票，且只能選擇同部門、同單位候選人
- Excel 匯入姓名、員工編號、部門、單位、是否現任福委
- 現任福委標記、即時票數、同票交由管理者處理
- 後臺投票狀態、結果匯出、管理密碼修改、稽核記錄
- 一鍵產生 100 筆測試資料，以及測試資料／全部資料清空工具

## 必要環境變數

- `DATABASE_URL`: PostgreSQL 連線字串
- `SESSION_SECRET`: 用於簽署登入工作階段的長隨機字串
- `ADMIN_PASSWORD`: 尚未在後臺變更密碼前使用的初始管理密碼

Zeabur 可將 `DATABASE_URL` 設為 `${POSTGRES_CONNECTION_STRING}`。

## 本機執行

```bash
pnpm install
pnpm dev
```

## 驗證與正式執行

```bash
pnpm lint
pnpm build
pnpm start
```

`zbpack.json` 已固定 Zeabur 使用 Node.js 建置與啟動，不會再把伺服器端應用誤判成靜態網站。
