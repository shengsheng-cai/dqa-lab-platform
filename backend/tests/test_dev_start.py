from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]


def test_hf_preview_uses_configured_gemini_key_instead_of_dummy_key():
    script = (ROOT_DIR / "dev_start.sh").read_text()

    assert 'PREVIEW_GEMINI_API_KEY="${GEMINI_API_KEY:-$(read_env_value GEMINI_API_KEY)}"' in script
    assert 'export GEMINI_API_KEY="$PREVIEW_GEMINI_API_KEY"' in script
    assert "hf_preview_dummy_key" not in script
