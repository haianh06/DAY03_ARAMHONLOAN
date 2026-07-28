"""
Isolated Flask demo UI for the Rental ReAct Agent.

Run from the project root:
    python ui_demo/web_app.py
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any, Mapping

from flask import Flask, jsonify, render_template, request


UI_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = UI_DIR.parent
SRC_DIR = PROJECT_ROOT / "src"

for path in (str(SRC_DIR), str(PROJECT_ROOT)):
    if path not in sys.path:
        sys.path.insert(0, path)

import app as agent_core  # noqa: E402
from providers import get_llm_provider  # noqa: E402


VALID_MODES = {"baseline", "agent"}


class RuntimeState:
    def __init__(self) -> None:
        self.provider: Any = None
        self.tools: dict[str, agent_core.ToolSpec] = {}
        self.init_error: str | None = None
        self.started_at = time.time()
        self.initialize()

    def initialize(self) -> None:
        try:
            self.provider = get_llm_provider()
            self.tools = agent_core.discover_tools()
            self.init_error = None
        except Exception as exc:
            self.provider = None
            self.tools = {}
            self.init_error = safe_error(exc)

    @property
    def provider_name(self) -> str:
        return self.provider.__class__.__name__ if self.provider else "unavailable"

    @property
    def model_name(self) -> str:
        return str(getattr(self.provider, "model_name", "unavailable"))


def safe_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    sensitive = ("api_key", "apikey", "secret", "token", "password", ".env", "\\", "/")
    if any(part in message.casefold() for part in sensitive):
        return "Lỗi cấu hình hoặc dịch vụ. Vui lòng kiểm tra backend."
    return message[:360]


def json_error(message: str, status_code: int = 400):
    response = jsonify({"success": False, "error": message})
    response.status_code = status_code
    return response


def get_json_body() -> Mapping[str, Any] | None:
    if not request.is_json:
        return None
    body = request.get_json(silent=True)
    return body if isinstance(body, Mapping) else None


def validate_mode(value: Any) -> str:
    mode = str(value or "").strip().lower()
    if mode not in VALID_MODES:
        raise ValueError("Chế độ không hợp lệ. Hãy chọn Baseline hoặc ReAct Agent.")
    return mode


def require_provider(state: RuntimeState) -> None:
    if state.provider is None:
        raise RuntimeError(state.init_error or "Provider chưa được cấu hình.")


def run_core(state: RuntimeState, mode: str, query: str) -> agent_core.AgentResult:
    require_provider(state)
    if mode == "baseline":
        return agent_core.run_baseline_chatbot(query, state.provider, verbose=False)
    return agent_core.run_react_agent(
        query,
        state.provider,
        tools=state.tools,
        verbose=False,
    )


def serialize_result(result: agent_core.AgentResult, state: RuntimeState) -> dict[str, Any]:
    data = result.to_dict()
    if isinstance(data.get("steps"), list):
        data["steps"] = sorted(
            data["steps"],
            key=lambda item: int(item.get("index", 0)) if isinstance(item, dict) else 0,
        )
    data["provider"] = state.provider_name
    data["model"] = state.model_name
    return data


def create_app() -> Flask:
    flask_app = Flask(
        __name__,
        template_folder=str(UI_DIR / "templates"),
        static_folder=str(UI_DIR / "static"),
    )
    state = RuntimeState()

    @flask_app.get("/")
    def index():
        try:
            cases = agent_core.load_test_cases()
        except Exception:
            cases = []
        return render_template(
            "index.html",
            test_cases=cases,
            provider=state.provider_name,
            model=state.model_name,
            init_error=state.init_error,
        )

    @flask_app.get("/api/health")
    def health():
        status = "ok" if state.init_error is None else "degraded"
        return jsonify(
            {
                "success": state.init_error is None,
                "status": status,
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
            return json_error("Không thể tải test case: " + safe_error(exc), 500)

    @flask_app.post("/api/run")
    def run_query():
        body = get_json_body()
        if body is None:
            return json_error("Yêu cầu không hợp lệ. Vui lòng gửi JSON.", 400)
        try:
            mode = validate_mode(body.get("mode"))
            query = str(body.get("query") or "").strip()
            if not query:
                return json_error("Vui lòng nhập câu hỏi trước khi chạy.", 400)
            result = run_core(state, mode, query)
            return jsonify({"success": True, "result": serialize_result(result, state)})
        except ValueError as exc:
            return json_error(str(exc), 400)
        except RuntimeError as exc:
            return json_error(safe_error(exc), 503)
        except Exception as exc:
            return json_error("Không thể xử lý yêu cầu: " + safe_error(exc), 500)

    @flask_app.post("/api/run-case")
    def run_case():
        body = get_json_body()
        if body is None:
            return json_error("Yêu cầu không hợp lệ. Vui lòng gửi JSON.", 400)
        try:
            mode = validate_mode(body.get("mode"))
            if body.get("case_id") in (None, ""):
                return json_error("Vui lòng chọn test case.", 400)
            case = agent_core.get_test_case(
                agent_core.load_test_cases(),
                int(body.get("case_id")),
            )
            result = run_core(state, mode, str(case["question"]))
            return jsonify(
                {
                    "success": True,
                    "test_case": case,
                    "result": serialize_result(result, state),
                }
            )
        except KeyError:
            return json_error("Test case không tồn tại.", 404)
        except ValueError as exc:
            return json_error("Yêu cầu không hợp lệ: " + str(exc), 400)
        except RuntimeError as exc:
            return json_error(safe_error(exc), 503)
        except Exception as exc:
            return json_error("Không thể chạy test case: " + safe_error(exc), 500)

    @flask_app.errorhandler(404)
    def not_found(_exc):
        return json_error("Không tìm thấy endpoint.", 404)

    @flask_app.errorhandler(500)
    def internal_error(_exc):
        return json_error("Máy chủ gặp lỗi nội bộ.", 500)

    return flask_app


app = create_app()


if __name__ == "__main__":
    host = os.getenv("WEB_HOST", "127.0.0.1")
    port = int(os.getenv("WEB_PORT", "5000"))
    debug = os.getenv("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
    app.run(host=host, port=port, debug=debug)
