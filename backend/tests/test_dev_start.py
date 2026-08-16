from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]


def read_project_file(path: str) -> str:
    return (ROOT_DIR / path).read_text()


def test_hf_preview_uses_configured_gemini_key_instead_of_dummy_key():
    script = read_project_file("dev_start.sh")

    assert 'PREVIEW_GEMINI_API_KEY="${GEMINI_API_KEY:-$(read_env_value GEMINI_API_KEY)}"' in script
    assert 'export GEMINI_API_KEY="$PREVIEW_GEMINI_API_KEY"' in script
    assert "hf_preview_dummy_key" not in script


def test_dev_start_uses_fixed_frontend_port_and_readiness_checks():
    script = read_project_file("dev_start.sh")

    assert "npm run dev -- --port 5173 --strictPort" in script
    assert 'wait_http "http://localhost:8000/health" "$BACK_PID" 30' in script
    assert 'wait_http "http://localhost:5173" "$CLIENT_PID" 30' in script
    assert 'while kill -0 "$BACK_PID"' in script


def test_dev_cleanup_targets_listeners_and_verifies_ports_are_released():
    makefile = read_project_file("Makefile")

    assert "-sTCP:LISTEN" in makefile
    assert "4040" in makefile
    assert 'echo "❌ port $$p 仍有服務監聽，清理未完成"' in makefile
    assert '-@pkill -9 -f "ngrok http 8000"' not in makefile


def test_optional_services_are_reported_from_actual_readiness():
    script = read_project_file("dev_start.sh")

    assert 'if [ "$HF_PREVIEW_READY" -eq 1 ]; then' in script
    assert 'if [ -n "$NGROK_URL" ]; then' in script
    assert "✅ 核心服務已啟動！" in script
    assert "✅ 系統已全面啟動！" not in script
