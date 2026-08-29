import { describe, it, expect } from "vitest";
import { describeLoadError, describeResponseError } from "../utils/loadError";
import { GENERIC_ERROR } from "../errorMessages";

describe("describeLoadError", () => {
  it("says the server is unreachable when there is no response at all", () => {
    expect(describeLoadError(new Error("Network Error")))
      .toBe("連不到伺服器，請確認後端是否正常運行");
    expect(describeLoadError(undefined))
      .toBe("連不到伺服器，請確認後端是否正常運行");
  });

  it("uses the backend detail when there is one", () => {
    // api.js 的攔截器已經把 detail 翻成中文，這裡直接用
    expect(describeLoadError({ response: { status: 403, data: { detail: "需要管理者權限" } } }))
      .toBe("需要管理者權限");
  });

  it("falls back to the status code when detail is missing or blank", () => {
    expect(describeLoadError({ response: { status: 403, data: {} } }))
      .toBe("需要管理者權限才能查看");
    expect(describeLoadError({ response: { status: 404, data: { detail: "   " } } }))
      .toBe("找不到資料");
    expect(describeLoadError({ response: { status: 400, data: null } }))
      .toBe("請求內容有誤");
  });

  it("ignores the generic fallback the interceptor leaves behind", () => {
    // api.js 翻不出來時會把 detail 換成 GENERIC_ERROR。真的 500 通常長這樣
    // （後端回 "Internal Server Error"，對照表認不出來），照收的話使用者只會看到
    // 「操作失敗，請稍後重試」，永遠看不到是幾號錯誤。
    expect(describeLoadError({ response: { status: 500, data: { detail: GENERIC_ERROR } } }))
      .toBe("伺服器錯誤（500），請稍後重試");
  });

  it("names the status code for server errors and unmapped ones", () => {
    expect(describeLoadError({ response: { status: 500, data: {} } }))
      .toBe("伺服器錯誤（500），請稍後重試");
    expect(describeLoadError({ response: { status: 503, data: {} } }))
      .toBe("伺服器錯誤（503），請稍後重試");
    expect(describeLoadError({ response: { status: 418, data: {} } }))
      .toBe("讀取失敗（418）");
  });

  it("handles a blob body, which is what a failed download returns", () => {
    // 下載走 responseType: "blob"，連錯誤回應的 body 都是 Blob，取不到 detail 字串。
    // 以前報告下載就是讀 detail 讀不到，所以權限不足也顯示「請確認後端連線」。
    const blobBody = new Blob(['{"detail":"需要管理者權限"}'], { type: "application/json" });
    expect(describeLoadError({ response: { status: 403, data: blobBody } }))
      .toBe("需要管理者權限才能查看");
  });
});

// AI 串流要邊收邊顯示，走的是原生 fetch，沒有 axios 攔截器，上面那支吃的 e.response
// 也不存在。這支負責從 Response 把後端那句話拿出來。
describe("describeResponseError", () => {
  const jsonResponse = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  it("uses the backend detail when there is one", async () => {
    // AI 沒設定時後端回的就是這句，它本來就是寫給使用者看的
    const res = jsonResponse(503, { detail: "AI 服務未設定，請聯絡管理員" });
    await expect(describeResponseError(res)).resolves.toBe("AI 服務未設定，請聯絡管理員");
  });

  it("falls back to the status code when the body has no detail", async () => {
    await expect(describeResponseError(jsonResponse(403, {}))).resolves
      .toBe("需要管理者權限才能查看");
    await expect(describeResponseError(jsonResponse(500, { detail: "   " }))).resolves
      .toBe("伺服器錯誤（500），請稍後重試");
    await expect(describeResponseError(jsonResponse(418, {}))).resolves
      .toBe("讀取失敗（418）");
  });

  it("ignores the generic fallback so the status code still gets through", async () => {
    await expect(describeResponseError(jsonResponse(500, { detail: GENERIC_ERROR }))).resolves
      .toBe("伺服器錯誤（500），請稍後重試");
  });

  it("survives a body that is not JSON", async () => {
    // 代理伺服器或 nginx 擋下來時回的是 HTML，不能讓解析失敗變成沒有訊息
    const res = new Response("<html>502 Bad Gateway</html>", { status: 502 });
    await expect(describeResponseError(res)).resolves.toBe("伺服器錯誤（502），請稍後重試");
  });
});
