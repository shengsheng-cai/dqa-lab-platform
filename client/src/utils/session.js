// 登入狀態存在 localStorage 的哪幾個鍵，以及怎麼清乾淨。
//
// 以前這五個鍵在兩個地方各列一次：App.jsx 的登出與 session 過期用一份，
// api.js 收到 401 時用另一份。少清一個鍵不會報錯，只會讓下一次進站
// 從殘留的值判斷身分。

const SESSION_KEYS = [
  "demo_password",
  "demo_login_at",
  "user_token",
  "user_role",
  "user_display_name",
];

/** 清掉所有登入痕跡。不負責導頁，呼叫端自己決定要去哪。 */
export function clearSession() {
  for (const key of SESSION_KEYS) {
    localStorage.removeItem(key);
  }
}
