export const C = {
  // text
  textPrimary:   "#cdd9e5",
  // 一般文字最暗只到這一階：這幾種深色底上要達到 4.5:1，再暗就看不清楚（themeContrast.test.js 守著）
  textMuted:     "#8b949e",
  // 停用中的文字刻意暗下來，讓人看得出按不下去；WCAG 不要求停用元件的對比度。
  // 也給不是文字的細框線用。一般文字不要用它
  textDisabled:  "#484f58",

  // accent
  accent:        "#58a6ff",
  accentLight:   "#79c0ff",
  accentLighter: "#a5d6ff",
  accentDark:    "#1f6feb",
  accentLink:    "#388bfd",

  // status
  success:       "#3fb950",
  successMid:    "#57ab5a",
  successDark:   "#238636",
  successBg:     "#0f2318",
  successBgMid:  "#1a2d1a",
  successBgDeep: "#1a3828",
  successText:   "#7ee787",
  reserved:      "#76e3ea",
  warning:       "#f0a500",
  warningAlt:    "#e3b341",
  warningBg:     "#2d2200",
  error:         "#f85149",
  errorLight:    "#ff7b72",
  errorDark:     "#da3633",
  errorBg:       "#2d0f0f",
  // 深色底面（選中的分頁、狀態色塊、危險提示底）— 命名照色相，與下面 violet/magenta 同一軸
  accentSurface:     "#1c3a5e",
  errorSurface:      "#2d1a1a",
  errorSurfaceDark:  "#1a0a0a",
  // 已完成（紫）、異常（洋紅）— 與 success/error 明顯區隔，避免計數撞色
  violet:        "#6e40c9",
  violetText:    "#bc8cff",
  violetBg:      "#1e1a2e",
  magenta:       "#db61a2",
  magentaText:   "#ff9bce",
  magentaBg:     "#2d1524",

  // surface
  bg:            "#0d1117",
  surface:       "#161b22",
  surfaceAlt:    "#1c2128",
  surfaceHover:  "#21262d",

  // border
  border:        "#30363d",

  white:         "#fff",
}
