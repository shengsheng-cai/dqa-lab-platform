import { defineConfig, devices } from "@playwright/test";

// 後端位址由 run-e2e.sh 傳進來，這裡的預設值只是備援。
// 注意：請用 `make test-e2e` 執行。直接跑 playwright 會少掉 STATIC_DIR 等環境變數，
// 後端不會吐前端頁面，測試會在「找不到登入框」的地方掛掉。
const BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:8100";

export default defineConfig({
  testDir: "./specs",

  // 後端由每個測試檔的 beforeAll 各自重開（見 helpers/backend.js），
  // 這裡負責全部跑完之後收乾淨。
  globalTeardown: "./helpers/global-teardown.js",

  // 不平行跑。後端是有狀態的（設備狀態機、模擬器、共用一個 DB），
  // 同時跑會互相踩到，測出來的紅燈不是真的 bug。
  fullyParallel: false,
  workers: 1,

  // 失敗不自動重跑。E2E 用 retry 蓋過去會養出「偶爾會過」的爛測試，
  // 這個專案的重點就是抓真問題，寧可紅在那邊。
  retries: 0,

  timeout: 30_000,
  expect: { timeout: 10_000 },

  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],

  use: {
    baseURL: BASE_URL,
    // 失敗才留證據，成功的不留，免得垃圾檔案一直長。
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      // 用 Playwright 自帶的 Chromium，不是系統上的 Chrome/Brave。
      // 版本跟著 package.json 鎖死，今天跑跟三個月後跑結果一樣。
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
