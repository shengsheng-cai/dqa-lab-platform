import { stopBackend } from "./backend.js";

// 全部跑完之後，把測試後端關掉，不要留殭屍程序佔著 port。
export default async function globalTeardown() {
  await stopBackend();
}
