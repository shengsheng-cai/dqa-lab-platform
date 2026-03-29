import asyncio
import datetime
import logging
from .models import SessionLocal, FixtureLoan, Fixture, User
from .line import push_to_user
from .utils import today_utc_window

logger = logging.getLogger("fixture_notifications")


async def notify_loan_created(loan_id: int):
    """借出登記後立即推播借用人確認訊息 + 通知保管人"""
    try:
        with SessionLocal() as db:
            loan = db.query(FixtureLoan).filter(FixtureLoan.id == loan_id).first()
            if not loan:
                return

            fixture = db.query(Fixture).filter(Fixture.id == loan.fixture_id).first()
            borrower_user = None
            if loan.borrower_user_id:
                borrower_user = db.query(User).filter(User.id == loan.borrower_user_id).first()

            fixture_name = (
                f"{fixture.interface_type} {fixture.form_factor}" if fixture else "未知治具"
            )
            due_str = loan.due_date.strftime("%Y/%m/%d") if loan.due_date else "未設定"

            # 推播借用人
            if borrower_user and borrower_user.line_user_id:
                text = (
                    f"📦 治具借出確認\n"
                    f"━━━━━━━━━━━━━━\n"
                    f"治具：{fixture_name}\n"
                    f"借出數量：{loan.quantity} 件\n"
                    f"應還日期：{due_str}\n"
                    f"專案：{loan.project_name or '—'}\n"
                    f"設備：{loan.device_id or '—'}\n"
                    f"━━━━━━━━━━━━━━\n"
                    f"請於到期前歸還，謝謝！"
                )
                await push_to_user(borrower_user.line_user_id, text)
                logger.info(
                    f"[Notify] 借出通知已推播給借用人 {borrower_user.display_name}（loan_id={loan_id}）"
                )
            else:
                logger.info(f"[Notify] 借用人無 LINE ID，跳過推播（loan_id={loan_id}）")

            # 推播保管人
            if fixture and fixture.keeper_user_id:
                keeper = db.query(User).filter(User.id == fixture.keeper_user_id).first()
                if keeper and keeper.line_user_id:
                    borrower_name = borrower_user.display_name if borrower_user else (loan.borrower_name or "未知")
                    keeper_text = (
                        f"🔔 治具已借出通知\n"
                        f"━━━━━━━━━━━━━━\n"
                        f"治具：{fixture_name}\n"
                        f"借用人：{borrower_name}\n"
                        f"借出數量：{loan.quantity} 件\n"
                        f"應還日期：{due_str}\n"
                        f"專案：{loan.project_name or '—'}\n"
                        f"━━━━━━━━━━━━━━"
                    )
                    await push_to_user(keeper.line_user_id, keeper_text)
                    logger.info(
                        f"[Notify] 借出通知已推播給保管人 {keeper.display_name}（loan_id={loan_id}）"
                    )
    except Exception as e:
        logger.error(f"[Notify] notify_loan_created 失敗：{e}")


async def scan_overdue_loans():
    """每日 08:00 掃描逾期與即將到期治具，依規則推播通知"""
    logger.info("[Notify] 開始每日掃描...")
    try:
        with SessionLocal() as db:
            now, today_start, today_end = today_utc_window()
            two_days_later_end = (today_start + datetime.timedelta(days=2)).replace(
                hour=23, minute=59, second=59
            )

            active_loans = (
                db.query(FixtureLoan).filter(FixtureLoan.status == "loaned").all()
            )

            # 保管人今日到期彙整表：keeper_user_id -> 清單
            keeper_due_today: dict = {}

            for loan in active_loans:
                if not loan.due_date:
                    continue

                fixture = (
                    db.query(Fixture).filter(Fixture.id == loan.fixture_id).first()
                )
                fixture_name = (
                    f"{fixture.interface_type} {fixture.form_factor}"
                    if fixture
                    else "未知治具"
                )
                due_str = loan.due_date.strftime("%Y/%m/%d")

                # 計算逾期天數
                overdue_days = max(0, (now - loan.due_date).days) if loan.due_date < now else 0

                # --- 逾期 >= 1 天：推播借用人 ---
                if overdue_days >= 1 and loan.borrower_user_id:
                    borrower = (
                        db.query(User).filter(User.id == loan.borrower_user_id).first()
                    )
                    if borrower and borrower.line_user_id:
                        await push_to_user(
                            borrower.line_user_id,
                            f"⚠️ 治具逾期提醒\n"
                            f"治具：{fixture_name}\n"
                            f"應還日：{due_str}\n"
                            f"已逾期：{overdue_days} 天\n"
                            f"請盡快歸還至治具室！",
                        )

                # --- 逾期 >= 3 天：推播保管人 ---
                if overdue_days >= 3 and fixture and fixture.keeper_user_id:
                    keeper = (
                        db.query(User).filter(User.id == fixture.keeper_user_id).first()
                    )
                    if keeper and keeper.line_user_id:
                        await push_to_user(
                            keeper.line_user_id,
                            f"🔴 治具嚴重逾期\n"
                            f"治具：{fixture_name}\n"
                            f"借用人：{loan.borrower_name}\n"
                            f"應還日：{due_str}\n"
                            f"已逾期：{overdue_days} 天\n"
                            f"請通知借用人儘速歸還。",
                        )

                # --- 逾期 >= 7 天：推播管理者 ---
                if overdue_days >= 7:
                    admins = (
                        db.query(User)
                        .filter(User.role == "admin", User.is_active == True)
                        .all()
                    )
                    for admin in admins:
                        if admin.line_user_id:
                            await push_to_user(
                                admin.line_user_id,
                                f"🚨 治具超期未還（>7天）\n"
                                f"治具：{fixture_name}\n"
                                f"借用人：{loan.borrower_name}\n"
                                f"應還日：{due_str}\n"
                                f"已逾期：{overdue_days} 天\n"
                                f"請介入處理。",
                            )

                # --- 到期前 2 天：推播借用人提醒 ---
                if (
                    overdue_days == 0
                    and loan.due_date >= today_end
                    and loan.due_date <= two_days_later_end
                    and loan.borrower_user_id
                ):
                    borrower = (
                        db.query(User).filter(User.id == loan.borrower_user_id).first()
                    )
                    if borrower and borrower.line_user_id:
                        days_left = (loan.due_date.date() - now.date()).days
                        await push_to_user(
                            borrower.line_user_id,
                            f"📅 治具到期提醒\n"
                            f"治具：{fixture_name}\n"
                            f"應還日：{due_str}\n"
                            f"距到期：{days_left} 天\n"
                            f"請記得準時歸還！",
                        )

                # --- 今日到期：收集給保管人彙整 ---
                if (
                    today_start <= loan.due_date <= today_end
                    and fixture
                    and fixture.keeper_user_id
                ):
                    keeper_id = fixture.keeper_user_id
                    keeper_due_today.setdefault(keeper_id, []).append(
                        f"• {fixture_name}（借用人：{loan.borrower_name}）"
                    )

            # --- 每日彙整：推播保管人今日到期清單 ---
            for keeper_id, items in keeper_due_today.items():
                keeper = db.query(User).filter(User.id == keeper_id).first()
                if keeper and keeper.line_user_id:
                    await push_to_user(
                        keeper.line_user_id,
                        f"📋 今日到期治具清單\n"
                        f"━━━━━━━━━━━━━━\n"
                        + "\n".join(items)
                        + f"\n━━━━━━━━━━━━━━\n"
                        f"共 {len(items)} 件，請確認是否已歸還。",
                    )

        logger.info("[Notify] 每日掃描完成")
    except Exception as e:
        logger.error(f"[Notify] scan_overdue_loans 失敗：{e}")


async def scan_replacement_reminders():
    """每週一次掃描 30 天內即將汰換的治具，推播保管人"""
    import re
    logger.info("[Notify] 開始汰換提醒掃描...")
    try:
        with SessionLocal() as db:
            now = datetime.datetime.now(datetime.timezone.utc)
            today = now.date()
            warn_date = today + datetime.timedelta(days=30)

            fixtures = (
                db.query(Fixture)
                .filter(
                    Fixture.is_active == True,
                    Fixture.replacement_years.isnot(None),
                    Fixture.created_at.isnot(None),
                )
                .all()
            )

            # keeper_user_id -> [(fixture_name, due_date, status)]
            keeper_items: dict = {}

            for f in fixtures:
                try:
                    years = float(re.search(r"[\d.]+", str(f.replacement_years)).group())
                except Exception:
                    continue

                created = f.created_at
                if created.tzinfo is not None:
                    created = created.replace(tzinfo=None)
                due_date = (created + datetime.timedelta(days=int(years * 365))).date()

                if due_date > warn_date:
                    continue  # 超過 30 天不處理

                fixture_name = f"{f.interface_type} {f.form_factor}"
                days_left = (due_date - today).days
                if days_left < 0:
                    status = f"已逾期 {abs(days_left)} 天"
                elif days_left == 0:
                    status = "今日到期"
                else:
                    status = f"剩 {days_left} 天"

                if f.keeper_user_id:
                    keeper_items.setdefault(f.keeper_user_id, []).append(
                        (fixture_name, due_date.strftime("%Y/%m/%d"), status)
                    )

            for keeper_id, items in keeper_items.items():
                keeper = db.query(User).filter(User.id == keeper_id).first()
                if not keeper or not keeper.line_user_id:
                    continue
                lines = "\n".join(
                    f"• {name}（{due}，{st}）" for name, due, st in items
                )
                await push_to_user(
                    keeper.line_user_id,
                    f"🔧 治具汰換提醒\n"
                    f"━━━━━━━━━━━━━━\n"
                    f"以下治具預計汰換日期在 30 天內：\n"
                    f"{lines}\n"
                    f"━━━━━━━━━━━━━━\n"
                    f"請安排採購或汰換作業。",
                )

        logger.info("[Notify] 汰換提醒掃描完成")
    except Exception as e:
        logger.error(f"[Notify] scan_replacement_reminders 失敗：{e}")


async def notify_monthly_inventory():
    """每月 1 日 08:00 推播保管人進行月盤點"""
    logger.info("[Notify] 推播月盤點提醒...")
    try:
        with SessionLocal() as db:
            keepers = (
                db.query(User)
                .filter(User.role.in_(["keeper", "admin"]), User.is_active == True)
                .all()
            )
            now = datetime.datetime.now(datetime.timezone.utc)
            month_str = now.strftime("%Y年%m月")

            for keeper in keepers:
                if keeper.line_user_id:
                    await push_to_user(
                        keeper.line_user_id,
                        f"📦 {month_str} 月盤點提醒\n"
                        f"━━━━━━━━━━━━━━\n"
                        f"本月盤點時間到！\n"
                        f"請登入 DQALab 系統進行治具實際數量回填。\n"
                        f"━━━━━━━━━━━━━━\n"
                        f"系統數量異常將自動標記，感謝配合。",
                    )
        logger.info("[Notify] 月盤點提醒推播完成")
    except Exception as e:
        logger.error(f"[Notify] notify_monthly_inventory 失敗：{e}")
