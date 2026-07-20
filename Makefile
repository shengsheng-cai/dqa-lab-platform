# DQA Lab Platform 控制中心
.PHONY: dev clean install help ngrok test lint test-e2e test-e2e-script

PYTHON := $(shell if [ -f venv/bin/python ]; then echo venv/bin/python; else echo python3; fi)

# 預設顯示幫助資訊
help:
	@echo "🛠️  DQA Lab 控制指令："
	@echo "  make install   - 安裝後端與前端依賴"
	@echo "  make dev       - 啟動所有服務（含 HF 預覽 + ngrok）"
	@echo "  make test      - 後端 + 前端單元測試"
	@echo "  make test-e2e  - E2E 瀏覽器測試（會自己開測試後端）"
	@echo "  make lint      - PEP 8 檢查（ruff）"
	@echo "  make clean     - 關閉服務並清理殘留程序"
	@echo "  make ngrok     - 單獨啟動 ngrok"

# 安裝流程
install:
	@echo "📦 正在安裝後端依賴 (Python)..."
	$(PYTHON) -m pip install -r backend/requirements.txt
	@echo "📦 正在安裝前端依賴 (Node.js)..."
	cd client && npm install
	@echo "✅ 所有依賴已就緒！"

# 啟動流程
dev:
	@echo "🚀 系統全面啟動中..."
	@bash dev_start.sh

# 清理流程
# 只關 make dev 開的那幾個 port，不用 pkill 掃全部程序——
# 以前是 pkill uvicorn，會連 E2E 測試或其他專案的後端一起殺掉。
# 5174/5175 也要列：5173 被占用時 vite 會自動往上找下一個 port。
DEV_PORTS := 8000 5173 5174 5175 7861

clean:
	@echo "🧹 正在關閉 make dev 開的服務..."
	@for p in $(DEV_PORTS); do \
		pids=$$(lsof -ti:$$p 2>/dev/null); \
		if [ -n "$$pids" ]; then \
			echo "  port $$p → 關閉"; \
			echo "$$pids" | xargs kill -9 2>/dev/null || true; \
		fi; \
	done
	-@pkill -9 -f "ngrok http 8000" 2>/dev/null
	@rm -f .backend.log .frontend.log .ngrok.log .hf-preview.log
	@echo "✨ 清理完成。"

# 單元測試（後端 pytest + 前端 vitest）
test:
	@echo "🧪 執行後端測試..."
	cd backend && ../$(PYTHON) -m pytest
	@echo "🧪 執行前端測試..."
	cd client && npm test
	@echo "✅ 測試完成。"

# E2E UI 測試（Playwright，自己開測試後端，不需要先 make dev）
# 用法：make test-e2e                                 跑全部
#      make test-e2e ARGS="--headed"                 開視窗看它在點什麼
#      make test-e2e ARGS="specs/smoke.spec.js"      只跑某一支
test-e2e:
	@bash tests/e2e/run-e2e.sh $(ARGS)

# 臨時探索腳本（舊用法，需先 make dev；跑的是開發環境的資料）
# 用法：make test-e2e-script SCRIPT=tests/e2e/test_xxx.mjs
# 副檔名要用 .mjs 或 .cjs：tests/e2e/package.json 設了 "type": "module"，
# 放在那底下的 .js 會被當成 ESM，用 require() 寫的腳本會掛掉。
test-e2e-script:
	@if [ -z "$(SCRIPT)" ]; then echo "❌ 請指定腳本：make test-e2e-script SCRIPT=tests/e2e/xxx.mjs"; exit 1; fi
	@[ -d tests/e2e/node_modules/playwright ] || { echo "❌ 請先執行：npm install --prefix tests/e2e"; exit 1; }
	@echo "🎭 執行探索腳本：$(SCRIPT)"
	@PLAYWRIGHT_PATH=$(CURDIR)/tests/e2e/node_modules/playwright \
	ADMIN_PASSWORD=$$(grep -m1 'ADMIN_PASSWORD' backend/.env 2>/dev/null | cut -d= -f2-) \
	node $(SCRIPT)
	@echo "✅ 完成。"

# PEP 8 檢查
lint:
	@echo "🔍 執行 PEP 8 檢查（ruff）..."
	$(PYTHON) -m ruff check backend/
	@echo "✅ 檢查完成。"

# ngrok 單獨啟動（通常不需要，make dev 已包含）
ngrok:
	@echo "🌐 單獨啟動 ngrok..."
	ngrok http 8000
