import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // 釘住時區：formatLocal / parseDateOnlyLocal 的正確性就是「UTC 轉本地」，
    // 不釘的話本機（+08）跟 CI（UTC）會得到不同字串，測試會時紅時綠。
    //
    // 這裡設的只在 forks（vitest 目前的預設）有效——它是行程啟動後才塞
    // process.env.TZ，換成 threads 那類共用行程的模式就吃不到。真正的釘子在
    // package.json 的 test script（TZ=... 在行程啟動前就設好，每種模式都有效），
    // 這行是給繞過 npm script 的跑法（編輯器外掛之類）補的。
    env: { TZ: "Asia/Taipei" },
  },
})
