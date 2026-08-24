/**
 * 治具的保管人只認「連到人員的那一個」。
 *
 * 有些治具的保管人只有一串名字、沒有連到任何人員——來源是舊資料，或是匯入的 Excel 裡
 * 寫了一個系統中查無此人的名字。這種要在畫面上標出來，不能跟正常設定過的保管人長得一樣，
 * 否則沒人知道那個名字其實沒有指向任何人。
 */
export const isUnlinkedKeeper = (fixture) =>
  !!fixture?.keeper_name && !fixture?.keeper_user_id;
