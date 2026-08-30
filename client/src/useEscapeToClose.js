import { useEffect, useRef } from "react";

// 目前開著的視窗，最後一個是最上層的那個。
// 視窗疊視窗時（例如新排程開到一半跳出「確定關閉」），如果每一層都自己聽 Esc，
// 按一下會兩層一起關，使用者填到一半的表單就沒了。所以只有最上層那個處理 Esc。
const openFrames = [];

/**
 * 按 Esc 關掉最上層的視窗。
 *
 * 一般視窗不必直接用這支，`components/ModalFrame.jsx` 已經內建。只有不套整個外框、
 * 但仍要參與 Esc 順序的地方才自己呼叫（目前是 SafetyChecklist：它的遮罩長在
 * SOP 面板裡面，不是蓋滿整頁）。
 *
 * @param {function} onClose - 要關掉這個視窗的動作
 * @param {boolean} active - 視窗開著才註冊；條件渲染的視窗用這個開關
 */
export default function useEscapeToClose(onClose, active = true) {
  // onClose 常常是寫在 JSX 裡的箭頭函式，每次 render 都是新的一個。
  // 放進 ref 才不會讓下面的 effect 重跑——重跑會把自己從順序裡拿掉再放到最後，
  // 於是外層視窗一 render 就變成「最上層」，Esc 就關錯視窗了。
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return undefined;
    const frame = {};
    openFrames.push(frame);

    const handleKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (openFrames[openFrames.length - 1] !== frame) return;
      onCloseRef.current?.();
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const i = openFrames.indexOf(frame);
      if (i !== -1) openFrames.splice(i, 1);
    };
  }, [active]);
}
