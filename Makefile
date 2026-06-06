# DQA Lab Platform 控制中心
.PHONY: dev clean install help ngrok test lint test-e2e

PYTHON := $(shell if [ -f venv/bin/python ]; then echo venv/bin/python; else echo python3; fi)

# 預設顯示幫助資訊
help:
	@echo "🛠️  DQA Lab 控制指令："
	@echo "  make install - 安裝後端與前端依賴"
	@echo "  make dev     - 一鍵啟動所有服務（含 HF 本地預覽 + ngrok 自動更新 LINE Webhook）"
	@echo "  make test    - 執行後端 + 前端測試"
	@echo "  make lint    - 執行 PEP 8 檢查（ruff）"
	@echo "  make clean   - 關閉所有服務並清理殘留程序"
	@echo "  make ngrok   - 單獨啟動 ngrok（通常不需要）"

# 1. 安裝流程
install:
	@echo "📦 正在安裝後端依賴 (Python)..."
	$(PYTHON) -m pip install -r backend/requirements.txt
	@echo "📦 正在安裝前端依賴 (Node.js)..."
	cd client && npm install
	@echo "✅ 所有依賴已就緒！"

# 2. 啟動流程
dev:
	@echo "🚀 系統全面啟動中..."
	@bash dev_start.sh

# 3. 清理流程
clean:
	@echo "🧹 正在清理所有服務..."
	-@pkill -9 -f "uvicorn" 2>/dev/null
	-@pkill -9 -f "node.*vite" 2>/dev/null
	-@pkill -9 -f "ngrok" 2>/dev/null
	@rm -f .backend.log .frontend.log .ngrok.log .hf-preview.log
	@echo "✨ 清理完成。"

# 4. 測試
test:
	@echo "🧪 執行後端測試..."
	cd backend && ../$(PYTHON) -m pytest
	@echo "🧪 執行前端測試..."
	cd client && npm test
	@echo "✅ 測試完成。"

# 5. E2E UI 測試（playwright，需先 make dev）
# 用法：make test-e2e SCRIPT=/tmp/my_test.mjs
test-e2e:
	@if [ -z "$(SCRIPT)" ]; then echo "❌ 請指定腳本：make test-e2e SCRIPT=/tmp/xxx.mjs"; exit 1; fi
	@echo "🎭 執行 E2E 測試：$(SCRIPT)"
	@PW=$$(ls -d $(HOME)/.npm/_npx/*/node_modules/playwright 2>/dev/null | head -1); \
	if [ -z "$$PW" ]; then echo "❌ Playwright not in npx cache. Run: npx playwright --version"; exit 1; fi; \
	PLAYWRIGHT_PATH=$$PW \
	ADMIN_PASSWORD=$$(grep -m1 'ADMIN_PASSWORD' backend/.env 2>/dev/null | cut -d= -f2-) \
	node $(SCRIPT)
	@echo "✅ E2E 測試完成。"

# 6. PEP 8 檢查
lint:
	@echo "🔍 執行 PEP 8 檢查（ruff）..."
	$(PYTHON) -m ruff check backend/
	@echo "✅ 檢查完成。"

# 6. ngrok 單獨啟動（通常不需要，make dev 已包含）
ngrok:
	@echo "🌐 單獨啟動 ngrok..."
	ngrok http 8000
