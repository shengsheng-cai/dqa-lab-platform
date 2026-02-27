# backend/init_db.py
from app.models import Base, engine

print("正在建立資料表...")
Base.metadata.create_all(bind=engine)
print("✅ 資料表建立完成！")