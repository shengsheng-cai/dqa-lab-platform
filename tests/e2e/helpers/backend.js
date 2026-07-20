import { spawn, execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 每個測試檔跑之前，把後端整個重來一次：關掉舊的 → 洗掉資料庫 → 重灌 demo 資料 → 重開。
//
// 為什麼要這麼麻煩：後端不是靜態的，模擬器每秒都在寫感測資料、推設備狀態機，
// 排程也會自己往前跑。前一個檔案留下的排程和設備狀態會讓下一個檔案看到不一樣的畫面
// （實際踩過：多一筆排程就把申請視窗裡的選項擋住，點不到）。
// 光洗資料庫不夠，後端記憶體裡還快取著設備狀態，所以連程序一起重開。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const PORT = process.env.E2E_PORT || "8100";
const DB_PATH = "/tmp/dqa-e2e.db";
const DATABASE_URL = `sqlite:///${DB_PATH}`;
const LOG_PATH = path.join(ROOT, "tests/e2e/.backend.log");
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;

// 這裡自己把 DATABASE_URL 算出來、明確傳給子程序，不從外面繼承。
// 因為直接跑 `playwright test`（config 裡有寫可以這樣 debug）的時候不會經過 run-e2e.sh，
// 沒人設 DATABASE_URL，init_db.py 就會回退去砍 backend/aicm.db——那是開發用的資料庫。
const CHILD_ENV = { ...process.env, DATABASE_URL };

const PYTHON = existsSync(path.join(ROOT, "venv/bin/python"))
  ? path.join(ROOT, "venv/bin/python")
  : "python3";

let child = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tailLog(lines = 30) {
  try {
    return readFileSync(LOG_PATH, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "（讀不到 log）";
  }
}

// 回傳正在「監聽」這個 port 的程序 id。
// 一定要加 -sTCP:LISTEN，不加的話連「有連到這個 port 的客戶端」都會被列出來——
// 包括 Playwright 自己，結果就是測試把自己殺掉（SIGKILL）。
function listeningPids() {
  try {
    const out = execFileSync("lsof", ["-ti", `:${PORT}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out ? out.split("\n").map(Number).filter(Boolean) : [];
  } catch {
    // lsof 找不到東西會回非 0，代表 port 是空的
    return [];
  }
}

async function waitPortFree(timeoutMs = 10_000) {
  // SIGKILL 是非同步的，送出去不代表程序已經死、port 已經放掉。
  // 不等的話會有兩種鬼故事：新的 uvicorn 搶不到 port 而啟動失敗；
  // 或是健康檢查打到「還沒斷氣的舊後端」直接通過，整個測試檔就跑在上一檔的殘留狀態上。
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listeningPids().length === 0) return;
    await sleep(100);
  }
  throw new Error(`port ${PORT} 過了 ${timeoutMs}ms 還是有人佔著，關不掉`);
}

async function waitHealthy(proc, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // 先看程序是不是已經掛了，不然要空等滿 30 秒才知道啟動失敗
    if (proc.exitCode !== null || proc.signalCode !== null) {
      throw new Error(
        `後端啟動就掛了（exit=${proc.exitCode} signal=${proc.signalCode}）\n--- log ---\n${tailLog()}`,
      );
    }
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return;
    } catch {
      // 還沒起來，繼續等
    }
    await sleep(250);
  }
  throw new Error(`後端 ${timeoutMs}ms 內沒有回應 ${HEALTH_URL}\n--- log ---\n${tailLog()}`);
}

export async function stopBackend() {
  // 兩種關法都要留：globalTeardown 跑在主程序，那裡的 child 永遠是 null
  //（後端是 worker 程序開的），只有掃 port 那招有用。
  if (child) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* 已經結束了 */ }
    child = null;
  }
  for (const pid of listeningPids()) {
    try { process.kill(pid, "SIGKILL"); } catch { /* 已經沒了就算了 */ }
  }
  await waitPortFree();
}

export async function resetBackend() {
  // 防呆：會刪資料庫檔，路徑必須在 /tmp 底下。
  // 擋的是「有人改了上面的 DB_PATH 常數卻沒想清楚」——刪錯就是砍掉開發用的資料庫。
  if (!DB_PATH.startsWith("/tmp/")) {
    throw new Error(`測試資料庫不在 /tmp 底下（${DB_PATH}），拒絕刪除`);
  }

  await stopBackend();

  // 連 SQLite 的側邊檔一起刪。硬殺後端如果剛好殺在寫入中間，會留下 -journal，
  // 那個檔案會被當成「有交易要回滾」套用到新建的資料庫上。
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(DB_PATH + suffix, { force: true });
  }

  try {
    execFileSync(PYTHON, ["init_db.py"], {
      cwd: path.join(ROOT, "backend"),
      stdio: ["ignore", "ignore", "pipe"],
      env: CHILD_ENV,
    });
  } catch (err) {
    // 不要讓 seed 失敗只丟一句 Command failed，把 Python 的錯誤原文帶出來
    throw new Error(`重灌測試資料庫失敗：\n${err.stderr?.toString() || err.message}`);
  }

  const log = openSync(LOG_PATH, "a");
  child = spawn(
    PYTHON,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", PORT, "--no-access-log"],
    {
      cwd: path.join(ROOT, "backend"),
      stdio: ["ignore", log, log],
      env: CHILD_ENV,
      detached: true, // 自成一個 process group，收尾時才能連子程序一起殺乾淨
    },
  );
  // 子程序已經拿到自己的一份，父程序這邊要關掉，不然每跑一個測試檔就漏一個
  child.on("spawn", () => closeSync(log));
  child.unref();

  await waitHealthy(child);
}
