import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dist-e2e']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    // 失效的 eslint-disable 要當錯誤：那些註解是「這裡刻意例外」的宣告，
    // 底下的程式碼改掉之後如果沒人發現，逃生門就會留在原地誤導下一個人。
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      // 可存取性的幾條底線。用內建的 no-restricted-syntax 擋，不另外裝 a11y 外掛。
      // 這層只看得到語法：能擋「又寫了一個可點的方框」，但擋不到「那一列裡真的有一顆能用的
      // 鍵盤入口」——後者只有 tests/e2e/specs/keyboard-navigation.spec.js 驗得到。
      'no-restricted-syntax': ['error',
        {
          // 排除互動標籤（含大寫開頭的自訂元件）與純擋冒泡的那層
          selector:
            "JSXOpeningElement[name.name=/^[a-z]/]:not([name.name=/^(button|a|input|select|textarea)$/])" +
            " > JSXAttribute[name.name=/^(onClick|onDoubleClick|onMouseDown|onMouseUp|onPointerDown)$/]" +
            ":not([value.expression.body.callee.property.name='stopPropagation'])",
          message:
            '這個標籤綁了滑鼠事件卻不是按鈕：Tab 停不上去、Enter 按不動。改用 <button>，' +
            '或依 .claude/rules/frontend.md 加 disable 註解寫出鍵盤入口是哪一顆。',
        },
        {
          selector: "JSXOpeningElement[name.name='a']:not(:has(JSXAttribute[name.name='href']))",
          message: '<a> 沒有 href 一樣 Tab 停不上去。純動作用 <button>，要導向才用 <a href>。',
        },
        {
          selector: "JSXElement[openingElement.name.name='button'] JSXElement[openingElement.name.name='button']",
          message: '按鈕不能包按鈕：瀏覽器與螢幕閱讀器會分不清按的是哪一顆。外層改回容器，裡面留一顆按鈕當鍵盤入口。',
        },
        {
          selector: "Property[key.name='outline'][value.value='none']",
          message: 'inline style 蓋得過樣式表，寫了 outline:"none" 那個欄位就再也沒有焦點指示。焦點外框由 index.css 的全域 :focus-visible 提供。',
        },
      ],
    },
  },
])
