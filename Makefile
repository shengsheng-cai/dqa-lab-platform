# DQA Lab Digital Twin 控制中心
.PHONY: dev clean install help logs ngrok

# 預設顯示幫助資訊
help:
	@echo "🛠️  DQA Lab 控制指令："
	@echo "  make install - 安裝後端、模擬器與前端依賴"
	@echo "  make dev     - 一鍵啟動所有服務（含 ngrok 自動更新 LINE Webhook）"
	@echo "  make clean   - 關閉所有服務並清理殘留程序"
	@echo "  make logs    - 查看虛擬串口連線日誌"
	@echo "  make ngrok   - 單獨啟動 ngrok（通常不需要）"

# 1. 安裝流程
install:
	@echo "📦 正在安裝後端依賴 (Python)..."
	pip install -r backend/requirements.txt
	@echo "📦 正在安裝模擬器依賴 (Python)..."
	pip install -r simulator/requirements.txt
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
	-@pkill -9 -f "uvicorn"
	-@pkill -9 -f "python3 simulator/main.py"
	-@pkill -9 -f "node.*vite"
	-@pkill -9 -f "socat"
	-@pkill -9 -f "ngrok"
	@rm -f .socat_info.log .serial_ports.tmp .backend.log
	@echo "✨ 清理完成。"

# 4. 日誌追蹤
logs:
	@echo "📋 追蹤虛擬串口日誌..."
	@tail -f .socat_info.log

# 5. ngrok 單獨啟動（通常不需要，make dev 已包含）
ngrok:
	@echo "🌐 單獨啟動 ngrok..."
	ngrok http 8000