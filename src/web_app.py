"""
Flask web UI for the rental Baseline Chatbot and ReAct Agent.

Run from project root:
    python src/web_app.py
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any, Mapping

from flask import Flask, jsonify, render_template, request


SRC_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SRC_DIR.parent

if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import app as agent_core  # noqa: E402
from providers import get_llm_provider  # noqa: E402


VALID_MODES = {"baseline", "agent"}


class RuntimeState:
    def __init__(self) -> None:
        self.provider: Any = None
        self.tools: dict[str, agent_core.ToolSpec] = {}
        self.init_error: str | None = None
        self.initialized_at = 0.0
        self.initialize()

    def initialize(self) -> None:
        try:
            self.provider = get_llm_provider()
            self.tools = agent_core.discover_tools()
            self.init_error = None
        except Exception as exc:
            self.provider = None
            self.tools = {}
            self.init_error = _safe_error_message(exc)
        self.initialized_at = time.time()

    @property
    def provider_name(self) -> str:
        if self.provider is None:
            return "unavailable"
        return self.provider.__class__.__name__

    @property
    def model_name(self) -> str:
        if self.provider is None:
            return "unavailable"
        return str(getattr(self.provider, "model_name", "unknown"))


def _safe_error_message(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    blocked_fragments = ("api_key", "apikey", "secret", "token", "password")
    if any(fragment in message.casefold() for fragment in blocked_fragments):
        return "Lỗi cấu hình dịch vụ. Vui lòng kiểm tra cấu hình máy chủ."
    return message[:500]


def _json_error(message: str, status_code: int = 400):
    response = jsonify({"success": False, "error": message})
    response.status_code = status_code
    return response


def _get_json_body() -> Mapping[str, Any] | None:
    if not request.is_json:
        return None
    body = request.get_json(silent=True)
    if not isinstance(body, Mapping):
        return None
    return body


def _validate_mode(mode: Any) -> str:
    normalized = str(mode or "").strip().lower()
    if normalized not in VALID_MODES:
        raise ValueError("Chế độ không hợp lệ. Chọn baseline hoặc agent.")
    return normalized


def _require_provider(state: RuntimeState) -> None:
    if state.provider is None:
        raise RuntimeError(
            state.init_error
            or "Provider chưa được cấu hình hoặc không thể khởi tạo."
        )


def _run_mode(
    *,
    mode: str,
    query: str,
    state: RuntimeState,
) -> agent_core.AgentResult:
    _require_provider(state)
    if mode == "baseline":
        return agent_core.run_baseline_chatbot(
            query,
            state.provider,
            verbose=False,
        )
    return agent_core.run_react_agent(
        query,
        state.provider,
        tools=state.tools,
        verbose=False,
    )


def _serialize_result(result: agent_core.AgentResult, state: RuntimeState) -> dict[str, Any]:
    data = result.to_dict()
    if isinstance(data.get("steps"), list):
        data["steps"] = sorted(
            data["steps"],
            key=lambda step: int(step.get("index", 0)) if isinstance(step, dict) else 0,
        )
    data["provider"] = state.provider_name
    data["model"] = state.model_name
    return data


def create_app() -> Flask:
    flask_app = Flask(
        __name__,
        template_folder=str(PROJECT_ROOT / "templates"),
        static_folder=str(PROJECT_ROOT / "static"),
    )
    state = RuntimeState()

    @flask_app.get("/")
    def index():
        try:
            test_cases = agent_core.load_test_cases()
        except Exception:
            test_cases = []
        return render_template(
            "index.html",
            test_cases=test_cases,
            provider=state.provider_name,
            model=state.model_name,
            init_error=state.init_error,
        )

    @flask_app.get("/api/health")
    def health():
        return jsonify(
            {
                "status": "ok" if state.init_error is None else "degraded",
                "provider": state.provider_name,
                "model": state.model_name,
                "tools": sorted(state.tools),
                "error": state.init_error,
            }
        )

    @flask_app.get("/api/test-cases")
    def test_cases():
        try:
            return jsonify({"success": True, "test_cases": agent_core.load_test_cases()})
        except Exception as exc:
            return _json_error(
                "Không thể tải danh sách test case: " + _safe_error_message(exc),
                500,
            )

    @flask_app.post("/api/run")
    def run_query():
        body = _get_json_body()
        if body is None:
            return _json_error("Yêu cầu không hợp lệ. Vui lòng gửi JSON.", 400)

        try:
            mode = _validate_mode(body.get("mode"))
            query = str(body.get("query") or "").strip()
            if not query:
                return _json_error("Vui lòng nhập câu hỏi trước khi chạy.", 400)
            result = _run_mode(mode=mode, query=query, state=state)
            return jsonify(
                {
                    "success": True,
                    "result": _serialize_result(result, state),
                }
            )
        except ValueError as exc:
            return _json_error(str(exc), 400)
        except RuntimeError as exc:
            return _json_error(_safe_error_message(exc), 503)
        except Exception as exc:
            return _json_error(
                "Không thể xử lý yêu cầu: " + _safe_error_message(exc),
                500,
            )

    @flask_app.post("/api/run-case")
    def run_case():
        body = _get_json_body()
        if body is None:
            return _json_error("Yêu cầu không hợp lệ. Vui lòng gửi JSON.", 400)

        try:
            mode = _validate_mode(body.get("mode"))
            if body.get("case_id") in (None, ""):
                return _json_error("Vui lòng chọn test case cần chạy.", 400)
            case_id = int(body.get("case_id"))
            case = agent_core.get_test_case(agent_core.load_test_cases(), case_id)
            result = _run_mode(mode=mode, query=str(case["question"]), state=state)
            return jsonify(
                {
                    "success": True,
                    "test_case": case,
                    "result": _serialize_result(result, state),
                }
            )
        except ValueError as exc:
            return _json_error("Yêu cầu không hợp lệ: " + str(exc), 400)
        except KeyError:
            return _json_error("Test case không tồn tại.", 404)
        except RuntimeError as exc:
            return _json_error(_safe_error_message(exc), 503)
        except Exception as exc:
            return _json_error(
                "Không thể chạy test case: " + _safe_error_message(exc),
                500,
            )

    @flask_app.errorhandler(404)
    def not_found(_exc):
        return _json_error("Không tìm thấy endpoint.", 404)

    @flask_app.errorhandler(500)
    def internal_error(_exc):
        return _json_error("Máy chủ gặp lỗi nội bộ.", 500)

    return flask_app


app = create_app()


if __name__ == "__main__":
    host = os.getenv("WEB_HOST", "127.0.0.1")
    port = int(os.getenv("WEB_PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
    app.run(host=host, port=port, debug=debug)
