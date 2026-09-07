"""
部署設定不得再無聲消失。

HF 在容器前面有一層轉送。uvicorn 預設只信任 127.0.0.1，所以不告訴它「前面那層是
自己人」的話，X-Forwarded-For 會被整個忽略，每個請求看起來都來自同一個內網位址。
登入失敗鎖定是以來源位址計數的，於是全站共用一個計數器：任何人失敗 5 次，所有訪客
一起被鎖 10 分鐘（行為本身由 test_login_rate_limit.py 守著）。

這個參數原本在 backend/railway.toml，移除 Railway 時整個檔案被刪掉，接上 HF 時沒有
補回來。CI 不 build image，所以這支測試是整個 repo 裡唯一會看它一眼的東西。
"""
import ipaddress
import pathlib
import re

DOCKERFILE = pathlib.Path(__file__).resolve().parents[2] / "Dockerfile"

# uvicorn 兩種寫法都吃：--forwarded-allow-ips=X 與 --forwarded-allow-ips X
_ALLOW_IPS = re.compile(r'--forwarded-allow-ips[=\s]+([^\s"]+)')

# 拿來試信任範圍的兩個位址：一個是外面的訪客，一個是平台的代理
A_PUBLIC_VISITOR = ipaddress.ip_address("203.0.113.7")  # TEST-NET-3，永遠不該算自己人
THE_PLATFORM_PROXY = ipaddress.ip_address("10.1.2.3")


def _start_command() -> str:
    for line in DOCKERFILE.read_text(encoding="utf-8").splitlines():
        if line.startswith("CMD"):
            return line
    raise AssertionError("Dockerfile 找不到 CMD；啟動方式換了寫法就要回頭確認這支測試")


def test_start_command_still_runs_uvicorn():
    """換掉 server 的話，下面那條會安靜地不再成立。

    gunicorn 同樣收 --forwarded-allow-ips，但不吃 10.0.0.0/8 這種網段寫法，
    所以字串留著、保護卻沒了，而測試不會有任何反應。
    """
    assert "uvicorn" in _start_command()


def test_start_command_trusts_the_platform_proxy_and_nobody_else():
    """驗的是這個值實際信任誰，不是它怎麼拼。

    只比對字串的話，有人為了讓別的平台能動而改成 0.0.0.0/0 會照樣綠——但那跟寫成
    * 是同一件事：所有位址都被信任時，uvicorn 取的是 X-Forwarded-For 最左邊的值，
    而最左邊是呼叫端自己塞的，鎖定會被綁在攻擊者挑的字串上。
    """
    match = _ALLOW_IPS.search(_start_command())
    assert match, (
        "Dockerfile 的啟動指令少了 --forwarded-allow-ips："
        "uvicorn 會忽略 X-Forwarded-For，登入鎖定將把所有訪客算成同一個來源"
    )

    value = match.group(1)
    assert value != "*", "不可以是 *：等於信任呼叫端自己填的來源，比不設還糟"

    networks = [
        ipaddress.ip_network(part.strip(), strict=False) for part in value.split(",")
    ]
    assert not any(A_PUBLIC_VISITOR in net for net in networks), (
        f"{value} 把公網位址也算成自己人，鎖定會被綁在呼叫端自己填的值上"
    )
    assert any(THE_PLATFORM_PROXY in net for net in networks), (
        f"{value} 沒有涵蓋平台代理所在的網段，X-Forwarded-For 會被忽略"
    )


def test_proxy_headers_not_disabled():
    """proxy_headers 預設就是開的，但明著關掉會讓上面那個設定被整個忽略。"""
    assert "--no-proxy-headers" not in _start_command()
