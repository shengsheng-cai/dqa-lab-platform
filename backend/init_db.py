# backend/init_db.py
# ⚠️ 注意：此檔案僅供首次建立資料庫使用。
# 後續 DB 結構變更請使用 Alembic：
#   alembic revision --autogenerate -m "描述變更"
#   alembic upgrade head
import os
from app.models import Base, engine, SessionLocal, User
from app.auth import hash_password

print("正在建立資料表...")
Base.metadata.create_all(bind=engine)
print("✅ 資料表建立完成！")

_pwd = os.getenv("ADMIN_PASSWORD", "")
if _pwd:
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.username == "admin").first():
            db.add(User(username="admin", display_name="Admin", hashed_password=hash_password(_pwd), role="admin"))
            db.commit()
            print("✅ Admin 帳號建立完成！")
    finally:
        db.close()
