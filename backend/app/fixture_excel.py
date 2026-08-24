"""治具 Excel 匯入、匯出與範本 adapter。"""

import asyncio
import io

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from .audit_log import log_audit
from .auth import current_user, require_admin
from .fixture_lifecycle import require_nonnegative_quantity, set_fixture_quantity
from .fixtures import keeper_name_map
from .models import Fixture, SessionLocal, User

try:
    import pandas as pd
except ImportError:
    pd = None

router = APIRouter(prefix="/api/fixtures", tags=["fixtures"])

COLUMN_ALIASES = {
    "interface_type": ["介面", "interface", "interface_type", "接口"],
    "form_factor": ["型態", "form factor", "form_factor", "formfactor"],
    "priority": ["優先度", "priority"],
    "size": ["尺寸", "size"],
    "purpose": ["用途", "purpose"],
    "estimated_usage": ["預估用量", "estimated usage", "estimated_usage"],
    "total_quantity": [
        "現有數量",
        "數量",
        "quantity",
        "total_quantity",
        "total quantity",
    ],
    "shortage": ["缺貨數", "shortage"],
    "usage_frequency": ["使用頻率", "使用率", "usage frequency", "usage_frequency"],
    "replacement_years": [
        "汰換年限",
        "汰換時間",
        "replacement years",
        "replacement_years",
    ],
    "note": ["備註", "note"],
    "keeper_name": ["保管人", "keeper", "keeper_name"],
    "deputy_name": ["代理人", "deputy", "deputy_name"],
    "vendor": ["廠商", "vendor"],
    "model_number": ["型號", "model", "model_number", "model number"],
    "unit_price": ["單價", "price", "unit price", "unit_price"],
}

EXCEL_COLUMNS = [
    "介面",
    "型態",
    "現有數量",
    "缺貨數",
    "優先度",
    "尺寸",
    "用途",
    "預估用量",
    "使用頻率",
    "汰換年限",
    "備註",
    "保管人",
    "代理人",
    "廠商",
    "型號",
    "單價",
]


def _require_excel_dependencies() -> None:
    if pd is None:
        raise HTTPException(status_code=500, detail="需要安裝 pandas 和 openpyxl")


def _fixture_excel_row(fixture: Fixture, keeper_names: dict[int, str] | None = None) -> dict:
    # 保管人要匯出「那個人現在叫什麼」，不是連結當下存下來的快照。匯出的檔案會被改一改
    # 再匯入回來，那時是拿名字去對人；匯出舊名字的話，改過名的人會對不回自己。
    keeper_name = (keeper_names or {}).get(fixture.keeper_user_id, fixture.keeper_name)
    return {
        "介面": fixture.interface_type,
        "型態": fixture.form_factor,
        "現有數量": fixture.total_quantity,
        "缺貨數": fixture.shortage,
        "優先度": fixture.priority or "",
        "尺寸": fixture.size or "",
        "用途": fixture.purpose or "",
        "預估用量": fixture.estimated_usage or "",
        "使用頻率": fixture.usage_frequency or "",
        "汰換年限": fixture.replacement_years or "",
        "備註": fixture.note or "",
        "保管人": keeper_name or "",
        "代理人": fixture.deputy_name or "",
        "廠商": fixture.vendor or "",
        "型號": fixture.model_number or "",
        "單價": fixture.unit_price or "",
    }


def _excel_response(df, filename: str) -> StreamingResponse:
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="治具資料")
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/template")
def download_template():
    _require_excel_dependencies()
    example = [
        "USB-C",
        "轉接頭",
        10,
        0,
        1,
        "",
        "連接測試設備",
        "",
        "",
        "5年",
        "",
        "",
        "",
        "",
        "",
        "",
    ]
    return _excel_response(
        pd.DataFrame([example], columns=EXCEL_COLUMNS),
        "fixture_template.xlsx",
    )


@router.get("/export")
def export_fixtures(_: None = Depends(require_admin)):
    _require_excel_dependencies()
    with SessionLocal() as db:
        fixtures = (
            db.query(Fixture)
            .filter(Fixture.is_active)
            .order_by(Fixture.interface_type)
            .all()
        )
        keeper_names = keeper_name_map(db, fixtures)
        return _excel_response(
            pd.DataFrame([_fixture_excel_row(f, keeper_names) for f in fixtures]),
            "fixtures_export.xlsx",
        )


def _safe_str(row, col_map, field):
    column = col_map.get(field)
    if column is None:
        return None
    try:
        value = row[column]
        if pd.isna(value):
            return None
        result = str(value).strip()
        return result if result and result.lower() != "nan" else None
    except (KeyError, TypeError):
        return None


def _safe_int(row, col_map, field, default=None):
    column = col_map.get(field)
    if column is None:
        return default
    try:
        value = row[column]
        if pd.isna(value):
            return default
        return int(float(value))
    except (KeyError, ValueError, TypeError):
        return default


def _safe_float(row, col_map, field):
    column = col_map.get(field)
    if column is None:
        return None
    try:
        value = row[column]
        if pd.isna(value):
            return None
        return float(value)
    except (KeyError, ValueError, TypeError):
        return None


def _run_import_db(df, col_map, actor, role):
    imported = 0
    updated = 0
    skipped = 0

    with SessionLocal() as db:
        try:
            # Excel 的保管人只有名字。剛好對到一個人才連上去，對不到就照原文留著，畫面會
            # 標成「未連結人員」——不要偷偷丟掉，那是對方表格裡真的有寫的資訊。
            #
            # 顯示名稱沒有唯一限制，同名的人可以有兩個。這種時候不猜：連了就等於替使用者
            # 決定是哪一個王小明，而這整件事要修的就是「保管人到底指誰說不清楚」。
            users_by_name: dict[str, int] = {}
            if "keeper_name" in col_map:
                name_counts: dict[str, int] = {}
                name_to_id: dict[str, int] = {}
                for u in db.query(User).filter(User.is_active).all():
                    if not u.display_name:
                        continue
                    name_counts[u.display_name] = name_counts.get(u.display_name, 0) + 1
                    name_to_id[u.display_name] = u.id
                users_by_name = {
                    name: user_id
                    for name, user_id in name_to_id.items()
                    if name_counts[name] == 1
                }

            for row_number, (_, row) in enumerate(df.iterrows(), start=2):
                interface_type = _safe_str(row, col_map, "interface_type") or ""
                form_factor = _safe_str(row, col_map, "form_factor") or ""
                if not interface_type or not form_factor:
                    skipped += 1
                    continue

                total_quantity = require_nonnegative_quantity(
                    _safe_int(row, col_map, "total_quantity", 0),
                    f"第 {row_number} 列現有數量",
                )
                shortage = require_nonnegative_quantity(
                    _safe_int(row, col_map, "shortage", 0),
                    f"第 {row_number} 列缺貨數",
                )
                # 只放進表格裡真的有的欄位。以前是整份覆蓋，所以拿一份只有數量的表格來更新
                # 庫存，會順手把備註、廠商、保管人全部清空——沒有人會預期匯入是這個意思。
                # 保管人另外處理：它由「保管人」那一欄推導出兩個欄位。
                fields = {
                    key: value
                    for key, value in {
                        "priority": _safe_int(row, col_map, "priority"),
                        "size": _safe_str(row, col_map, "size"),
                        "purpose": _safe_str(row, col_map, "purpose"),
                        "estimated_usage": _safe_float(row, col_map, "estimated_usage"),
                        "shortage": shortage,
                        "usage_frequency": _safe_int(row, col_map, "usage_frequency"),
                        "replacement_years": _safe_str(row, col_map, "replacement_years"),
                        "note": _safe_str(row, col_map, "note"),
                        "deputy_name": _safe_str(row, col_map, "deputy_name"),
                        "vendor": _safe_str(row, col_map, "vendor"),
                        "model_number": _safe_str(row, col_map, "model_number"),
                        "unit_price": _safe_float(row, col_map, "unit_price"),
                    }.items()
                    if key in col_map
                }
                if "keeper_name" in col_map:
                    keeper_name = _safe_str(row, col_map, "keeper_name")
                    fields["keeper_name"] = keeper_name
                    fields["keeper_user_id"] = users_by_name.get(keeper_name)
                existing = (
                    db.query(Fixture)
                    .filter(
                        Fixture.interface_type == interface_type,
                        Fixture.form_factor == form_factor,
                        Fixture.is_active,
                    )
                    .first()
                )
                if existing is not None:
                    for key, value in fields.items():
                        setattr(existing, key, value)
                    # 同理：表格沒有「現有數量」這欄時不要把庫存改成 0
                    if "total_quantity" in col_map:
                        set_fixture_quantity(existing, total_quantity)
                    updated += 1
                else:
                    db.add(
                        Fixture(
                            interface_type=interface_type,
                            form_factor=form_factor,
                            total_quantity=total_quantity,
                            **fields,
                        )
                    )
                    imported += 1

            log_audit(
                db,
                actor,
                role,
                "IMPORT",
                "fixture",
                "import",
                f"Excel 匯入治具：新增 {imported}、更新 {updated}、略過 {skipped}",
            )
            db.commit()
            return {
                "status": "success",
                "imported": imported,
                "updated": updated,
                "skipped": skipped,
            }
        except HTTPException:
            db.rollback()
            raise
        except Exception as error:
            db.rollback()
            raise HTTPException(status_code=500, detail=str(error)) from error


@router.post("/import")
async def import_fixtures(
    request: Request,
    file: UploadFile = File(...),
    _: None = Depends(require_admin),
):
    _require_excel_dependencies()
    user = current_user(request)
    contents = await file.read()
    dataframe = pd.read_excel(io.BytesIO(contents), header=0)

    normalized_columns = {str(column).strip().lower(): column for column in dataframe.columns}
    column_map = {}
    for field, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            key = alias.strip().lower()
            if key in normalized_columns:
                column_map[field] = normalized_columns[key]
                break

    return await asyncio.to_thread(
        _run_import_db,
        dataframe,
        column_map,
        str(user.user_id or "unknown"),
        user.role,
    )
