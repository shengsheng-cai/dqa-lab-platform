# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────
# DQA Lab Platform — Hugging Face Space 單容器部署
# - Stage 1: Node 20 build 前端（Vite）→ client/dist/
# - Stage 2: Python 3.13 + FastAPI runtime，整合前端 dist 為 static
# HF Space 強制 port 7860、UID 1000（user）、/tmp 可寫
# ─────────────────────────────────────────────────────────────

# ═══ Stage 1: 前端 build ═══
FROM node:20-alpine AS frontend-build
WORKDIR /build

# 只先 copy package.json 利用 Docker layer cache
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund

# copy 其餘前端原始碼再 build（含修正 api/fixtures trailing slash）
COPY client/ ./
# 同 origin 部署：API_BASE 走相對路徑（前端請求 /api/... 直接打同一個 host）
ENV VITE_API_URL=""
RUN npm run build


# ═══ Stage 2: Python 後端 + 前端 static ═══
FROM python:3.13-slim
WORKDIR /app

# 後端依賴（利用 layer cache）
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# 後端程式碼
COPY backend/ ./backend/

# 前端 build 產物放到 /app/static（由 FastAPI 掛載）
COPY --from=frontend-build /build/dist ./static/

# Golden snapshot：預先 seed 好的 demo DB，啟動時 copy 到 /tmp
COPY demo.db /app/demo.db

# 環境變數：
#  - DATABASE_URL：HF 免費 Space 只有 /tmp 可寫，reboot 會清空（demo 場景可接受）
#  - PORT：HF 強制 7860
ENV DATABASE_URL=sqlite:////tmp/demo.db \
    PORT=7860 \
    PYTHONUNBUFFERED=1

# HF 要求 container 以非 root 身份跑（UID 1000）
RUN useradd -m -u 1000 user && chown -R user:user /app
USER user

EXPOSE 7860
WORKDIR /app/backend

# 啟動流程：
#   1. copy golden snapshot 到 /tmp（保留 demo 資料，不跑 init_db.py）
#   2. ensure_admin_user（套用 HF Secret 的 ADMIN_PASSWORD）
#   3. uvicorn 啟動 FastAPI
CMD ["sh", "-c", "cp /app/demo.db /tmp/demo.db && python -c 'from app.models import ensure_admin_user; ensure_admin_user()' && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
