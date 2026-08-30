import { useEffect, useRef, useState } from "react";
import useEscapeToClose from "../useEscapeToClose";

/**
 * 站內所有彈出視窗的共用外框。
 *
 * 以前每支視窗各自寫一份「背景 div + 擋冒泡」，於是三件事沒人做：按 Esc 關不掉、
 * 視窗跳出來時焦點還留在被蓋住的那顆按鈕上、關掉之後焦點也回不去。這支把那三件事
 * 收在一個地方，並把版面固定成「標題不動、內容捲、底部操作區不動」，
 * 長表單的送出鈕才不會跟著內容捲出畫面。
 *
 * 外觀不在這裡決定：背景色、邊框、寬度由呼叫端用 boxStyle 給，標題列與操作區
 * 用 header / footer 傳進來。這支只管行為與三段結構。
 *
 * @param {string} title - 視窗名稱。螢幕閱讀器會唸它，E2E 也用它定位，必填。
 * @param {React.ReactNode} header - 固定在最上面、不捲的區塊（通常是標題列）
 * @param {React.ReactNode} footer - 固定在最下面、不捲的區塊（通常是取消／送出）
 * @param {Object} boxStyle - 視窗本體的外觀
 * @param {Object} bodyStyle - 內容區的外觀（padding、gap 這類）
 * @param {string} maxHeight - 高度上限。一律要有：沒有的話內容一長就往視窗外溢出，
 *   而且不會有捲軸，等於按鈕根本到不了
 * @param {number} zIndex - 疊在誰上面。確認視窗要蓋住開它的那個視窗，所以給得比較高
 * @param {string} backdrop - 背景遮罩顏色
 * @param {boolean} closeOnBackdrop - 點背景要不要關掉。原本就沒這個行為的視窗傳 false：
 *   換外框不該多一條「按到空白處把填到一半的東西丟掉」的路。Esc 不受這個旗標管，
 *   那是使用者明確要關；點到背景多半是手滑，兩件事不一樣
 * @param {function} onClose - Esc、點背景、以及 header 的關閉鈕都走這支
 */

export default function ModalFrame({
  title,
  header,
  footer,
  boxStyle,
  bodyStyle,
  maxHeight = "88vh",
  zIndex = 1000,
  backdrop = "rgba(0,0,0,0.6)",
  closeOnBackdrop = true,
  onClose,
  children,
}) {
  const boxRef = useRef(null);
  // 備案：視窗裡有 autoFocus 欄位時，effect 跑到的時候焦點已經在視窗裡面了，
  // 那時再問「是誰開的」就問不到，所以 render 階段先記一份。
  const [openerAtRender] = useState(() => document.activeElement);

  useEscapeToClose(onClose);

  // 這兩個只在第一次掛載時算。開發模式的 StrictMode 會把 effect 再跑一次，
  // 那時焦點已經被上一輪的收尾動過，重算會得到不一樣的答案——autoFocus 的欄位
  // 就是這樣被搶走的（正式版沒有第二次，所以只有本機開發看得到）。
  const openerRef = useRef(null);
  const focusTargetRef = useRef(null);

  useEffect(() => {
    const box = boxRef.current;

    if (!openerRef.current) {
      const active = document.activeElement;
      const alreadyInside = box?.contains(active);
      // 掛載當下的焦點就是來源，除非它已經在視窗裡（autoFocus），才改用 render 那份。
      //
      // 要在這裡問而不是在 render 問，是為了「一個視窗換成另一個視窗」那條路：
      // 排程按下確認之後詳情視窗會換成結果視窗，舊視窗卸載時已經把焦點還給原本那一列，
      // 這時問到的才是那一列；在 render 問會問到舊視窗裡那顆即將消失的按鈕，
      // 結果就是關掉之後焦點掉回頁面最上面。
      openerRef.current = alreadyInside ? openerAtRender : active;
      focusTargetRef.current = alreadyInside ? active : box;
    }

    focusTargetRef.current?.focus();

    return () => {
      // 來源可能跟著操作一起消失了，還在才把焦點還回去
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [openerAtRender]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: backdrop,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex,
      }}
      // eslint-disable-next-line no-restricted-syntax -- 點背景關掉是滑鼠的便利；鍵盤有 Esc，測試在 keyboard-navigation.spec.js
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          display: "flex",
          flexDirection: "column",
          maxHeight,
          maxWidth: "92vw",
          ...boxStyle,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {header}
        {/* minHeight:0 少不得：flex 子元素的最小高度預設是內容高度，
            沒有它的話這一格不會縮，捲軸長不出來，footer 一樣會被推出去 */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, ...bodyStyle }}>
          {children}
        </div>
        {footer}
      </div>
    </div>
  );
}
