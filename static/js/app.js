const state = {
  mode: localStorage.getItem("rental-ui-mode") || "agent",
  testCases: Array.isArray(window.__TEST_CASES__) ? window.__TEST_CASES__ : [],
  health: window.__INITIAL_HEALTH__ || {},
  currentController: null,
  lastAnswer: "",
};

const els = {};

const examples = [
  "Tìm phòng trọ ở Cầu Giấy, Hà Nội giá dưới 4 triệu/tháng.",
  "Tìm phòng trọ ở Quận 10, TP.HCM giá dưới 3.5 triệu, sau đó xem chi tiết phòng PROP-0020.",
  "Mô hình Sleepbox là gì?",
];

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  initializeModes();
  renderExamples();
  renderTestCases();
  updateCharacterCounter();
  updateHealthLabel(state.health);
  bindEvents();
});

function bindElements() {
  Object.assign(els, {
    modeCards: document.querySelectorAll(".mode-card"),
    queryInput: document.getElementById("queryInput"),
    charCounter: document.getElementById("charCounter"),
    runBtn: document.getElementById("runBtn"),
    clearBtn: document.getElementById("clearBtn"),
    runCaseBtn: document.getElementById("runCaseBtn"),
    caseSelect: document.getElementById("caseSelect"),
    casePreview: document.getElementById("casePreview"),
    caseCount: document.getElementById("caseCount"),
    exampleList: document.getElementById("exampleList"),
    emptyExamples: document.getElementById("emptyExamples"),
    loadingState: document.getElementById("loadingState"),
    emptyState: document.getElementById("emptyState"),
    errorState: document.getElementById("errorState"),
    answerCard: document.getElementById("answerCard"),
    answerText: document.getElementById("answerText"),
    modeBadge: document.getElementById("modeBadge"),
    statusBadge: document.getElementById("statusBadge"),
    copyAnswerBtn: document.getElementById("copyAnswerBtn"),
    metadataGrid: document.getElementById("metadataGrid"),
    traceSection: document.getElementById("traceSection"),
    traceTimeline: document.getElementById("traceTimeline"),
    traceSubtitle: document.getElementById("traceSubtitle"),
    expandTraceBtn: document.getElementById("expandTraceBtn"),
    collapseTraceBtn: document.getElementById("collapseTraceBtn"),
    hideTraceBtn: document.getElementById("hideTraceBtn"),
    refreshHealthBtn: document.getElementById("refreshHealthBtn"),
    connectionStatus: document.getElementById("connectionStatus"),
    providerLabel: document.getElementById("providerLabel"),
  });
}

function bindEvents() {
  els.modeCards.forEach((card) => {
    card.addEventListener("click", () => setMode(card.dataset.mode));
  });

  els.queryInput.addEventListener("input", updateCharacterCounter);
  els.queryInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      runQuery();
    }
  });

  els.runBtn.addEventListener("click", runQuery);
  els.clearBtn.addEventListener("click", clearQuery);
  els.runCaseBtn.addEventListener("click", runTestCase);
  els.caseSelect.addEventListener("change", updateCasePreview);
  els.copyAnswerBtn.addEventListener("click", copyAnswer);
  els.expandTraceBtn.addEventListener("click", () => setTraceCollapsed(false));
  els.collapseTraceBtn.addEventListener("click", () => setTraceCollapsed(true));
  els.hideTraceBtn.addEventListener("click", () => els.traceSection.classList.add("hidden"));
  els.refreshHealthBtn.addEventListener("click", refreshHealth);
}

function initializeModes() {
  setMode(state.mode);
}

function setMode(mode) {
  state.mode = mode === "baseline" ? "baseline" : "agent";
  localStorage.setItem("rental-ui-mode", state.mode);
  els.modeCards.forEach((card) => {
    const isActive = card.dataset.mode === state.mode;
    card.classList.toggle("active", isActive);
    card.setAttribute("aria-pressed", String(isActive));
  });
}

function renderExamples() {
  els.exampleList.replaceChildren(...examples.map(createExampleButton));
  els.emptyExamples.replaceChildren(...examples.map(createExampleButton));
}

function createExampleButton(text) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "example-button";
  button.textContent = text;
  button.addEventListener("click", () => {
    els.queryInput.value = text;
    updateCharacterCounter();
    els.queryInput.focus();
  });
  return button;
}

function renderTestCases() {
  els.caseSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Chọn test case...";
  els.caseSelect.appendChild(placeholder);

  state.testCases.forEach((testCase) => {
    const option = document.createElement("option");
    option.value = String(testCase.id);
    option.textContent = `#${testCase.id} · ${cleanCategory(testCase.category)} · ${testCase.question}`;
    els.caseSelect.appendChild(option);
  });

  els.caseCount.textContent = `${state.testCases.length} case`;
  updateCasePreview();
}

function updateCasePreview() {
  const testCase = getSelectedCase();
  els.casePreview.replaceChildren();
  if (!testCase) {
    const empty = document.createElement("span");
    empty.textContent = "Chọn một test case để xem mô tả.";
    els.casePreview.appendChild(empty);
    return;
  }

  const chip = document.createElement("span");
  chip.className = `case-chip ${categoryClass(testCase.category)}`;
  chip.textContent = cleanCategory(testCase.category);

  const question = document.createElement("p");
  question.textContent = `#${testCase.id}: ${testCase.question}`;

  const expected = document.createElement("p");
  expected.textContent = `Expected: ${testCase.expected_behavior}`;

  els.casePreview.append(chip, question, expected);
}

function getSelectedCase() {
  const id = Number(els.caseSelect.value);
  return state.testCases.find((testCase) => Number(testCase.id) === id);
}

async function runQuery() {
  const query = els.queryInput.value.trim();
  if (!query) {
    showError("Vui lòng nhập câu hỏi trước khi chạy.");
    return;
  }

  await runRequest("/api/run", {
    mode: state.mode,
    query,
  });
}

async function runTestCase() {
  const testCase = getSelectedCase();
  if (!testCase) {
    showError("Vui lòng chọn test case cần chạy.");
    return;
  }

  els.queryInput.value = testCase.question;
  updateCharacterCounter();

  await runRequest("/api/run-case", {
    mode: state.mode,
    case_id: testCase.id,
  });
}

async function runRequest(url, payload) {
  if (state.currentController) {
    state.currentController.abort();
  }
  state.currentController = new AbortController();
  const timeoutId = window.setTimeout(() => state.currentController.abort(), 60000);

  setLoading(true);
  hideError();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload),
      signal: state.currentController.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.success === false) {
      throw new Error(data?.error || "Không thể kết nối backend.");
    }
    renderResult(data.result, data.test_case);
  } catch (error) {
    if (error.name === "AbortError") {
      showError("Không thể kết nối backend hoặc yêu cầu đã quá thời gian chờ.");
    } else {
      showError(error.message || "Yêu cầu không hợp lệ.");
    }
  } finally {
    window.clearTimeout(timeoutId);
    setLoading(false);
    state.currentController = null;
  }
}

function renderResult(result, testCase) {
  els.emptyState.classList.add("hidden");
  renderAnswer(result, testCase);
  renderMetadata(result);
  renderSteps(result);
}

function renderAnswer(result, testCase) {
  state.lastAnswer = result.answer || "";
  els.answerCard.classList.remove("hidden");
  els.modeBadge.textContent = result.mode === "baseline" ? "Baseline Chatbot" : "ReAct Agent";
  els.statusBadge.textContent = result.guardrail ? `guardrail: ${result.guardrail}` : result.status || "unknown";
  els.statusBadge.className = `badge ${statusClass(result.status, result.guardrail)}`;

  const prefix = testCase ? `Test case #${testCase.id}\n\n` : "";
  els.answerText.textContent = prefix + (result.answer || "Không có nội dung trả lời.");
}

function renderMetadata(result) {
  const items = [
    ["Provider", result.provider || state.health.provider || "unknown"],
    ["Model", result.model || state.health.model || "unknown"],
    ["Status", result.status || "unknown"],
    ["Tool calls", String(result.tool_calls ?? 0)],
    ["Latency", `${Math.round(result.latency_ms || 0)} ms`],
    ["Guardrail", result.guardrail || "Không"],
  ];

  els.metadataGrid.replaceChildren(...items.map(([label, value]) => {
    const tile = document.createElement("div");
    tile.className = "stat-tile";
    const labelNode = document.createElement("span");
    labelNode.textContent = label;
    const valueNode = document.createElement("strong");
    valueNode.textContent = value;
    tile.append(labelNode, valueNode);
    return tile;
  }));
  els.metadataGrid.classList.remove("hidden");
}

function renderSteps(result) {
  els.traceTimeline.replaceChildren();
  if (result.mode === "baseline") {
    els.traceSection.classList.remove("hidden");
    els.traceSubtitle.textContent = "Baseline không sử dụng tool.";
    const note = document.createElement("div");
    note.className = "trace-value";
    note.textContent = "Baseline Chatbot trả lời trực tiếp, không có ReAct trace.";
    els.traceTimeline.appendChild(note);
    return;
  }

  const steps = Array.isArray(result.steps)
    ? [...result.steps].sort((left, right) => Number(left.index || 0) - Number(right.index || 0))
    : [];
  els.traceSection.classList.remove("hidden");
  els.traceSubtitle.textContent = steps.length
    ? "Thought, Action, Action Input và Observation."
    : "Không có bước trace nào được ghi nhận.";

  if (!steps.length) {
    const note = document.createElement("div");
    note.className = "trace-value";
    note.textContent = result.guardrail
      ? "Guardrail đã chặn yêu cầu trước khi gọi tool."
      : "Agent không ghi nhận bước trung gian.";
    els.traceTimeline.appendChild(note);
    return;
  }

  els.traceTimeline.replaceChildren(...steps.map(createStepCard));
}

function createStepCard(step) {
  const card = document.createElement("article");
  card.className = `step-card ${step.error ? "error" : ""}`;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "step-toggle";
  toggle.addEventListener("click", () => card.classList.toggle("collapsed"));

  const title = document.createElement("span");
  title.className = "step-title";
  title.textContent = step.action ? `Step ${step.index}: ${step.action}` : `Step ${step.index}: Final/Parser`;

  const latency = document.createElement("span");
  latency.textContent = `${Math.round(step.latency_ms || 0)} ms`;
  toggle.append(title, latency);

  const body = document.createElement("div");
  body.className = "step-body";

  const parsed = parseRawOutput(step.raw_model_output || "");
  body.appendChild(traceBlock("Thought", parsed.thought || "Không ghi nhận."));

  if (step.action) {
    const action = document.createElement("div");
    action.className = "trace-block";
    const label = document.createElement("span");
    label.className = "trace-label";
    label.textContent = "Action";
    const value = document.createElement("span");
    value.className = "badge";
    value.textContent = step.action;
    action.append(label, value);
    body.appendChild(action);
  }

  if (step.action_input && Object.keys(step.action_input).length) {
    const details = document.createElement("details");
    details.className = "trace-block";
    const summary = document.createElement("summary");
    summary.className = "trace-label";
    summary.textContent = "Action Input";
    const value = document.createElement("pre");
    value.className = "trace-value";
    value.textContent = JSON.stringify(step.action_input, null, 2);
    details.append(summary, value);
    body.appendChild(details);
  }

  if (step.observation !== null && step.observation !== undefined) {
    body.appendChild(traceBlock("Observation", formatValue(step.observation), "observation"));
  }

  if (step.error) {
    body.appendChild(traceBlock("Error", step.error, "error"));
  }

  if (parsed.finalAnswer) {
    body.appendChild(traceBlock("Final Answer", parsed.finalAnswer, "observation"));
  }

  card.append(toggle, body);
  return card;
}

function traceBlock(labelText, valueText, variant = "") {
  const block = document.createElement("div");
  block.className = "trace-block";
  const label = document.createElement("span");
  label.className = "trace-label";
  label.textContent = labelText;
  const value = document.createElement("pre");
  value.className = `trace-value ${variant}`.trim();
  value.textContent = valueText;
  block.append(label, value);
  return block;
}

function renderMetadataOnlyHealth(health) {
  updateHealthLabel(health);
}

function setLoading(isLoading) {
  els.loadingState.classList.toggle("hidden", !isLoading);
  [els.runBtn, els.runCaseBtn, els.clearBtn].forEach((button) => {
    button.disabled = isLoading;
  });
}

function showError(message) {
  els.errorState.textContent = message || "Yêu cầu không hợp lệ.";
  els.errorState.classList.remove("hidden");
}

function hideError() {
  els.errorState.classList.add("hidden");
  els.errorState.textContent = "";
}

function clearQuery() {
  els.queryInput.value = "";
  updateCharacterCounter();
  els.queryInput.focus();
}

function updateCharacterCounter() {
  els.charCounter.textContent = `${els.queryInput.value.length} ký tự`;
}

async function refreshHealth() {
  try {
    const response = await fetch("/api/health", {headers: {"Accept": "application/json"}});
    const health = await response.json();
    state.health = health;
    renderMetadataOnlyHealth(health);
  } catch (_error) {
    showError("Không thể kết nối backend.");
  }
}

function updateHealthLabel(health) {
  const provider = health.provider || "unknown";
  const model = health.model || "unknown";
  els.providerLabel.textContent = `${provider} · ${model}`;
  const degraded = Boolean(health.error) || health.status === "degraded";
  els.connectionStatus.classList.toggle("degraded", degraded);
  els.connectionStatus.querySelector("strong").textContent = degraded ? "Degraded" : "Connected";
}

function setTraceCollapsed(collapsed) {
  document.querySelectorAll(".step-card").forEach((card) => {
    card.classList.toggle("collapsed", collapsed);
  });
}

async function copyAnswer() {
  try {
    await navigator.clipboard.writeText(state.lastAnswer);
    els.copyAnswerBtn.textContent = "Copied";
    window.setTimeout(() => {
      els.copyAnswerBtn.textContent = "Copy answer";
    }, 1200);
  } catch (_error) {
    showError("Không thể copy câu trả lời.");
  }
}

function parseRawOutput(raw) {
  const thoughtMatch = raw.match(/Thought\s*:\s*([\s\S]*?)(?:\n\s*(?:Action|Final Answer)\s*:|$)/i);
  const finalMatch = raw.match(/Final Answer\s*:\s*([\s\S]+)/i);
  return {
    thought: thoughtMatch ? thoughtMatch[1].trim() : "",
    finalAnswer: finalMatch ? finalMatch[1].trim() : "",
  };
}

function formatValue(value) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function statusClass(status, guardrail) {
  if (guardrail) {
    return "guarded";
  }
  if (status === "success") {
    return "success";
  }
  if (status === "error" || status === "guarded") {
    return "error";
  }
  return "";
}

function categoryClass(category) {
  const normalized = String(category || "").toLowerCase();
  if (normalized.includes("multi")) {
    return "case-multi";
  }
  if (normalized.includes("edge") || normalized.includes("guard") || normalized.includes("khó")) {
    return "case-edge";
  }
  return "case-simple";
}

function cleanCategory(category) {
  return String(category || "Không phân loại")
    .replace(/[^\p{L}\p{N}\s()/-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
