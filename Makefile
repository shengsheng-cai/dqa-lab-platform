# DQA Lab Digital Twin 控制中心
.PHONY: dev clean install help logs

# 預設顯示幫助資訊
help:
	@echo "🛠️  DQA Lab 控制指令："
	@echo "  make install - 1. 自動安裝後端、模擬器與前端依賴"
	@echo "  make dev     - 2. 一鍵啟動 (自動處理虛擬串口與所有服務)"
	@echo "  make clean   - 3. 強制關閉所有服務並清理殘留連線"
	@echo "  make logs    - 4. 查看串口連線狀態日誌"

# 1. 安裝流程
install:
	@echo "📦 正在檢查並安裝後端依賴 (Python)..."
	pip install -r backend/requirements.txt
	@echo "📦 正在檢查並安裝模擬器依賴 (Python)..."
	pip install -r simulator/requirements.txt
	@echo "📦 正在檢查並安裝前端依賴 (Node.js)..."
	cd client && npm install
	@echo "✅ [SUCCESS] 所有依賴已就緒！"

# 2. 啟動流程：呼叫啟動腳本
dev:
	@echo "🚀 系統全面啟動中..."
	@bash dev_start.sh

# 3. 清理流程：更強準終止程序與回收資源
clean:
	@echo "🧹 正在執行深度清理..."
	# 終止後端 uvicorn 與所有 python 程序
	-@pkill -9 -f "uvicorn" || true
	-@pkill -9 -f "python3 simulator/main.py" || true
	# 終止前端 Vite 服務 (node)
	-@pkill -9 -f "node.*vite" || true
	# 終止虛擬串口 socat
	-@pkill -9 -f "socat" || true
	# 刪除暫存日誌與暫存檔
	@rm -f .socat_info.log .serial_ports.tmp .backend.log
	@echo "✨ 清理完成，開發環境已重置。"

# 4. 日誌追蹤：查看串口底層資訊
logs:
	@echo "📋 追蹤虛擬串口 (socat) 連線日誌..."
	@tail -f .socat_info.log