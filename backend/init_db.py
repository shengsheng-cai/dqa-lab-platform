# backend/init_db.py
# ⚠️ 注意：此檔案僅供首次建立資料庫使用。
# 後續 DB 結構變更請使用 Alembic：
#   alembic revision --autogenerate -m "描述變更"
#   alembic upgrade head
from app.models import Base, engine

print("正在建立資料表...")
Base.metadata.create_all(bind=engine)
print("✅ 資料表建立完成！")
