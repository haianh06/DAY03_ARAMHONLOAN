# Rental ReAct UI Demo

This folder contains an optional Flask web demo for the Rental ReAct Agent lab. It is intentionally isolated from the core lab implementation so graders can distinguish the demo UI from the required agent files.

## Structure

```text
ui_demo/
├── web_app.py
├── templates/
│   └── index.html
└── static/
    ├── css/
    │   └── style.css
    └── js/
        └── app.js
```

## Installation

Install project dependencies from the project root:

```powershell
pip install -r requirements.txt
```

## Run

```powershell
python ui_demo/web_app.py
```

Open:

```text
http://127.0.0.1:5000
```

## API Routes

- `GET /` renders the UI.
- `GET /api/health` returns provider, model, status, and tools.
- `GET /api/test-cases` returns cases from `config/test_cases.json`.
- `POST /api/run` runs a custom Baseline or Agent query.
- `POST /api/run-case` runs a predefined test case.

## Notes

- The demo imports and reuses `src/app.py`; it does not duplicate the ReAct loop.
- Core CLI behavior remains unchanged.
- The web layer calls core functions with `verbose=False`.
- Errors are returned as short Vietnamese messages without stack traces or secrets.
