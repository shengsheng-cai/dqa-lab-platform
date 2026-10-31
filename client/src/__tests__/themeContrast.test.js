import { describe, it, expect } from "vitest";
import { C } from "../styles/theme";

// WCAG 2.x 的相對亮度與對比度公式
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// 文字會落在這幾種底色上；最亮的 surfaceHover 最難過關
const SURFACES = ["bg", "surface", "surfaceAlt", "surfaceHover"];

// 停用中的文字 WCAG 不要求對比度，刻意暗下來讓人看得出按不下去
const EXEMPT = ["textDisabled"];

const TEXT_TOKENS = Object.keys(C).filter((k) => k.startsWith("text") && !EXEMPT.includes(k));

describe("對比度公式", () => {
  it("黑配白是 21:1、同色是 1:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#161b22", "#161b22")).toBe(1);
  });

  it("WCAG 常用的臨界灰 #767676 在白底上剛好過 4.5:1", () => {
    expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });
});

describe("主題的文字色在深色底上看得清楚", () => {
  // 以前左欄標籤用的灰色在這些底色上只有 1.8～2.3:1，10px 的字幾乎看不見
  it.each(TEXT_TOKENS.flatMap((t) => SURFACES.map((s) => [t, s])))(
    "%s 疊在 %s 上至少 4.5:1",
    (text, surface) => {
      expect(contrast(C[text], C[surface])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("篩選真的挑到了文字色", () => {
    // token 改名後篩選若變成零筆，上面那組會一條都不跑卻顯示通過
    expect(TEXT_TOKENS).toEqual(expect.arrayContaining(["textPrimary", "textMuted"]));
  });
});
