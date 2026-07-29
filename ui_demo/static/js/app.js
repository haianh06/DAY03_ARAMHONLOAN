const state = {
  mode: localStorage.getItem("rental-demo-mode") || "agent",
  cases: Array.isArray(window.__TEST_CASES__) ? window.__TEST_CASES__ : [],
  selectedCaseId: null,
  activeFilter: "all",
  health: window.__INITIAL_HEALTH__ || {},
  currentController: null,
  isRunning: false,
  lastAnswer: "",
  showRaw: false,
};

const els = {};

const quickPrompts = [
  "Tìm phòng trọ ở Cầu Giấy dưới 4 triệu",
  "Xem chi tiết phòng PROP-0001",
  "Cần lưu ý gì trước khi đặt cọc?",
];

const loadingMessages = {
  baseline: ["Đang tạo câu trả lời...", "Đang kiểm tra ngữ cảnh...", "Đang tổng hợp phản hồi..."],
  agent: [
    "Agent đang phân tích yêu cầu...",
    "Đang chọn công cụ...",
    "Đang thực thi công cụ...",
    "Đang tổng hợp kết quả...",
  ],
};

let loadingTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  setMode(state.mode);
  renderHealth(state.health);
  renderQuickPrompts();
  renderCaseList();
  autoResizeTextarea();
  updateCounter();
});

function bindElements() {
  Object.assign(els, {
    sidebar: document.getElementById("sidebar"),
    openSidebarBtn: document.getElementById("openSidebarBtn"),
    closeSidebarBtn: document.getElementById("closeSidebarBtn"),
    sidebarBackdrop: document.getElementById("sidebarBackdrop"),
    healthPanel: document.getElementById("healthPanel"),
    healthStatus: document.getElementById("healthStatus"),
    providerLabel: document.getElementById("providerLabel"),
    mobileStatus: document.getElementById("mobileStatus"),
    modeButtons: document.querySelectorAll(".mode-option"),
    selectedModeText: document.getElementById("selectedModeText"),
    composerModeBadge: document.getElementById("composerModeBadge"),
    caseSearch: document.getElementById("caseSearch"),
    caseFilters: document.getElementById("caseFilters"),
    caseList: document.getElementById("caseList"),
    caseCount: document.getElementById("caseCount"),
    runCaseBtn: document.getElementById("runCaseBtn"),
    quickPrompts: document.getElementById("quickPrompts"),
    emptyExamples: document.getElementById("emptyExamples"),
    queryInput: document.getElementById("queryInput"),
    charCounter: document.getElementById("charCounter"),
    runBtn: document.getElementById("runBtn"),
    clearBtn: document.getElementById("clearBtn"),
    refreshHealthBtn: document.getElementById("refreshHealthBtn"),
    emptyState: document.getElementById("emptyState"),
    loadingPanel: document.getElementById("loadingPanel"),
    loadingTitle: document.getElementById("loadingTitle"),
    errorBanner: document.getElementById("errorBanner"),
    answerCard: document.getElementById("answerCard"),
    answerModeBadge: document.getElementById("answerModeBadge"),
    answerStatusBadge: document.getElementById("answerStatusBadge"),
    answerPerf: document.getElementById("answerPerf"),
    answerText: document.getElementById("answerText"),
    copyAnswerBtn: document.getElementById("copyAnswerBtn"),
    metadataGrid: document.getElementById("metadataGrid"),
    traceCard: document.getElementById("traceCard"),
    traceTimeline: document.getElementById("traceTimeline"),
    expandTraceBtn: document.getElementById("expandTraceBtn"),
    collapseTraceBtn: document.getElementById("collapseTraceBtn"),
    toggleRawBtn: document.getElementById("toggleRawBtn"),
    hideTraceBtn: document.getElementById("hideTraceBtn"),
    toastStack: document.getElementById("toastStack"),
  });
}

function bindEvents() {
  els.openSidebarBtn?.addEventListener("click", openSidebar);
  els.closeSidebarBtn?.addEventListener("click", closeSidebar);
  els.sidebarBackdrop?.addEventListener("click", closeSidebar);

  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  els.caseSearch.addEventListener("input", renderCaseList);
  els.caseFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.activeFilter = button.dataset.filter;
    els.caseFilters.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.classList.toggle("active", chip === button);
    });
    renderCaseList();
  });

  els.queryInput.addEventListener("input", () => {
    autoResizeTextarea();
    updateCounter();
  });
  els.queryInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      runQuery();
    }
  });

  els.runBtn.addEventListener("click", runQuery);
  els.runCaseBtn.addEventListener("click", runTestCase);
  els.clearBtn.addEventListener("click", clearInput);
  els.refreshHealthBtn.addEventListener("click", refreshHealth);
  els.copyAnswerBtn.addEventListener("click", copyAnswer);
  els.expandTraceBtn.addEventListener("click", () => setTraceCollapsed(false));
  els.collapseTraceBtn.addEventListener("click", () => setTraceCollapsed(true));
  els.hideTraceBtn.addEventListener("click", () => els.traceCard.classList.add("hidden"));
  els.toggleRawBtn.addEventListener("click", toggleRawJson);
}

function setMode(mode) {
  state.mode = mode === "baseline" ? "baseline" : "agent";
  localStorage.setItem("rental-demo-mode", state.mode);
  const label = state.mode === "baseline" ? "Baseline" : "ReAct Agent";
  els.selectedModeText.textContent = label;
  els.composerModeBadge.textContent = label;
  els.modeButtons.forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderQuickPrompts() {
  const sidebarButtons = quickPrompts.map((prompt) => promptButton(prompt, "quick-prompt"));
  const exampleButtons = quickPrompts.map((prompt) => promptButton(prompt, "example-button"));
  els.quickPrompts.replaceChildren(...sidebarButtons);
  els.emptyExamples.replaceChildren(...exampleButtons);
}

function promptButton(prompt, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = prompt;
  button.addEventListener("click", () => fillPrompt(prompt));
  return button;
}

function fillPrompt(prompt) {
  els.queryInput.value = prompt;
  autoResizeTextarea();
  updateCounter();
  els.queryInput.focus();
  showToast("Đã đưa gợi ý vào ô nhập.");
}

function renderCaseList() {
  const query = normalize(els.caseSearch.value);
  const filtered = state.cases.filter((item) => {
    const type = caseType(item.category);
    const matchesFilter = state.activeFilter === "all" || state.activeFilter === type;
    const haystack = normalize(`${item.id} ${item.question} ${item.category}`);
    return matchesFilter && (!query || haystack.includes(query));
  });

  els.caseCount.textContent = String(filtered.length);
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "case-question";
    empty.textContent = "Không tìm thấy test case phù hợp.";
    els.caseList.replaceChildren(empty);
    return;
  }

  els.caseList.replaceChildren(...filtered.slice(0, 18).map(createCaseItem));
}

function createCaseItem(item) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "case-item";
  if (Number(item.id) === Number(state.selectedCaseId)) {
    button.classList.add("active");
  }
  button.addEventListener("click", () => {
    state.selectedCaseId = item.id;
    renderCaseList();
    showToast(`Đã chọn test case #${item.id}.`);
  });

  const meta = document.createElement("div");
  meta.className = "case-meta";
  const id = document.createElement("span");
  id.className = "property-id";
  id.textContent = `#${item.id}`;
  const badge = document.createElement("span");
  badge.className = `case-badge ${caseType(item.category)}`;
  badge.textContent = readableCaseType(item.category);
  meta.append(id, badge);

  const question = document.createElement("p");
  question.className = "case-question";
  question.textContent = truncate(item.question, 116);

  const details = document.createElement("details");
  details.className = "case-expected";
  const summary = document.createElement("summary");
  summary.textContent = "Expected behavior";
  const expected = document.createElement("p");
  expected.textContent = item.expected_behavior || "Không có mô tả.";
  details.append(summary, expected);

  button.append(meta, question, details);
  return button;
}

async function runQuery() {
  const query = els.queryInput.value.trim();
  if (!query) {
    showError("Vui lòng nhập câu hỏi trước khi chạy.");
    els.queryInput.focus();
    return;
  }
  await runRequest("/api/run", {mode: state.mode, query});
}

async function runTestCase() {
  const item = state.cases.find((testCase) => Number(testCase.id) === Number(state.selectedCaseId));
  if (!item) {
    showError("Vui lòng chọn test case cần chạy.");
    return;
  }
  els.queryInput.value = item.question;
  autoResizeTextarea();
  updateCounter();
  closeSidebar();
  await runRequest("/api/run-case", {mode: state.mode, case_id: item.id});
}

async function runRequest(url, payload) {
  if (state.isRunning) return;
  if (state.currentController) state.currentController.abort();

  state.currentController = new AbortController();
  const timeoutId = window.setTimeout(() => state.currentController.abort(), 70000);
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
    showToast(data.result.guardrail ? "Guardrail đã chặn yêu cầu." : "Chạy hoàn tất.");
  } catch (error) {
    const message = error.name === "AbortError"
      ? "Không thể kết nối backend hoặc yêu cầu đã quá thời gian chờ."
      : error.message || "Yêu cầu không hợp lệ.";
    showError(message);
    showToast(message);
  } finally {
    window.clearTimeout(timeoutId);
    setLoading(false);
    state.currentController = null;
  }
}

function renderResult(result, testCase) {
  els.emptyState.classList.add("hidden");
  renderFinalAnswer(result, testCase);
  renderMetadata(result);
  renderSteps(result);
}

function renderFinalAnswer(result, testCase) {
  state.lastAnswer = result.answer || "";
  els.answerCard.classList.remove("hidden");
  els.answerModeBadge.textContent = result.mode === "baseline" ? "Baseline" : "ReAct Agent";
  const statusText = result.guardrail ? guardrailLabel(result.guardrail) : result.status || "unknown";
  els.answerStatusBadge.textContent = statusText;
  els.answerStatusBadge.className = `status-badge ${statusClass(result.status, result.guardrail)}`;
  els.answerPerf.textContent = `${formatLatency(result.latency_ms)} · ${result.tool_calls || 0} tools`;
  els.answerText.replaceChildren();
  if (testCase) {
    const note = document.createElement("p");
    note.className = "case-question answer-note";
    note.textContent = `Test case #${testCase.id}: ${testCase.question}`;
    els.answerText.appendChild(note);
  }
  els.answerText.appendChild(textBlock(result.answer || "Không có nội dung trả lời."));
}

function renderMetadata(result) {
  const guardrail = result.guardrail ? `${guardrailLabel(result.guardrail)}: ${guardrailExplanation(result.guardrail)}` : "Không";
  const items = [
    ["Provider", result.provider || state.health.provider || "unknown"],
    ["Model", result.model || state.health.model || "unknown"],
    ["Mode", result.mode === "baseline" ? "Baseline" : "ReAct Agent"],
    ["Status", result.status || "unknown"],
    ["Tool calls", String(result.tool_calls || 0)],
    ["Latency", formatLatency(result.latency_ms)],
    ["Guardrail", guardrail],
  ];
  els.metadataGrid.replaceChildren(...items.map(([label, value]) => {
    const tile = document.createElement("article");
    tile.className = "stat";
    const title = document.createElement("span");
    title.textContent = label;
    const body = document.createElement("strong");
    body.textContent = value;
    tile.append(title, body);
    return tile;
  }));
  els.metadataGrid.classList.remove("hidden");
}

function renderSteps(result) {
  els.traceTimeline.replaceChildren();
  els.traceCard.classList.remove("hidden");
  els.traceCard.classList.toggle("show-raw", state.showRaw);

  if (result.mode === "baseline") {
    const note = document.createElement("div");
    note.className = "trace-text";
    note.textContent = "Baseline không sử dụng tool nên không có ReAct trace.";
    els.traceTimeline.appendChild(note);
    return;
  }

  const steps = Array.isArray(result.steps)
    ? [...result.steps].sort((left, right) => Number(left.index || 0) - Number(right.index || 0))
    : [];

  if (!steps.length) {
    const card = createSyntheticStep(result.guardrail ? "guardrail" : "done", result.guardrail
      ? guardrailExplanation(result.guardrail)
      : "Agent không ghi nhận bước trung gian.");
    els.traceTimeline.appendChild(card);
    return;
  }

  els.traceTimeline.replaceChildren(...steps.map(createStepCard));
}

function createSyntheticStep(type, message) {
  const step = document.createElement("article");
  step.className = `step-card ${type === "guardrail" ? "guardrail" : ""}`;
  const marker = document.createElement("div");
  marker.className = "step-marker";
  marker.textContent = type === "guardrail" ? "!" : "✓";
  const content = document.createElement("div");
  content.className = "step-content";
  const body = document.createElement("div");
  body.className = "step-body";
  body.appendChild(traceText("Trạng thái", message, type === "guardrail" ? "error" : ""));
  content.appendChild(body);
  step.append(marker, content);
  return step;
}

function createStepCard(step) {
  const parsed = parseRawOutput(step.raw_model_output || "");
  const card = document.createElement("article");
  card.className = `step-card ${step.error ? "error" : ""}`;

  const marker = document.createElement("div");
  marker.className = "step-marker";
  marker.textContent = step.error ? "!" : "✓";

  const content = document.createElement("div");
  content.className = "step-content";

  const head = document.createElement("button");
  head.type = "button";
  head.className = "step-head";
  head.setAttribute("aria-expanded", "true");
  head.addEventListener("click", () => {
    const collapsed = card.classList.toggle("collapsed");
    head.setAttribute("aria-expanded", String(!collapsed));
  });

  const title = document.createElement("div");
  title.className = "step-title";
  const strong = document.createElement("strong");
  strong.textContent = `Step ${step.index}`;
  const subtitle = document.createElement("span");
  subtitle.textContent = step.action || (parsed.finalAnswer ? "Final Answer" : "Parser / Provider");
  title.append(strong, subtitle);

  const latency = document.createElement("span");
  latency.className = "step-latency";
  latency.textContent = formatLatency(step.latency_ms);
  head.append(title, latency);

  const body = document.createElement("div");
  body.className = "step-body";
  body.appendChild(traceText("Thought", parsed.thought || "Không ghi nhận."));

  if (step.action) body.appendChild(traceText("Action", step.action));
  if (step.action_input && Object.keys(step.action_input).length) {
    body.appendChild(actionInputTable(step.action_input));
  }
  if (step.observation !== null && step.observation !== undefined) {
    body.appendChild(observationBlock(step.observation));
  }
  if (step.error) body.appendChild(traceText("Error", step.error, "error"));
  if (parsed.finalAnswer) body.appendChild(traceText("Final Answer", parsed.finalAnswer, "observation"));

  const raw = traceText("Raw JSON", JSON.stringify(step, null, 2));
  raw.classList.add("raw-json");
  body.appendChild(raw);

  content.append(head, body);
  card.append(marker, content);
  return card;
}

function traceText(label, value, variant = "") {
  const wrap = document.createElement("section");
  wrap.className = "trace-section";
  const title = document.createElement("span");
  title.className = "trace-label";
  title.textContent = label;
  const text = document.createElement("div");
  text.className = `trace-text ${variant}`.trim();
  text.textContent = String(value || "");
  wrap.append(title, text);
  return wrap;
}

function actionInputTable(input) {
  const wrap = document.createElement("section");
  wrap.className = "trace-section";
  const title = document.createElement("span");
  title.className = "trace-label";
  title.textContent = "Action Input";
  const table = document.createElement("div");
  table.className = "kv-table";

  Object.entries(input).forEach(([key, value]) => {
    const row = document.createElement("div");
    row.className = "kv-row";
    const keyNode = document.createElement("span");
    keyNode.className = "kv-key";
    keyNode.textContent = key;
    const valueNode = document.createElement("span");
    valueNode.appendChild(formatArgValue(key, value));
    row.append(keyNode, valueNode);
    table.appendChild(row);
  });

  wrap.append(title, table);
  return wrap;
}

function formatArgValue(key, value) {
  const span = document.createElement("span");
  if (key.includes("price") && !Number.isNaN(Number(value))) {
    span.textContent = formatCurrency(Number(value));
    return span;
  }
  if (String(value).match(/^PROP-\d+$/i)) span.className = "property-id";
  span.textContent = Array.isArray(value) ? value.join(", ") : String(value);
  return span;
}

function observationBlock(observation) {
  const text = typeof observation === "string" ? observation : JSON.stringify(observation, null, 2);
  const rentals = parseRentalCards(text);
  if (!rentals.length) {
    return traceText("Observation", text, String(text).startsWith("LỖI:") ? "error" : "observation");
  }

  const wrap = document.createElement("section");
  wrap.className = "trace-section";
  const title = document.createElement("span");
  title.className = "trace-label";
  title.textContent = "Observation";
  const grid = document.createElement("div");
  grid.className = "rental-grid";
  rentals.forEach((rental) => grid.appendChild(createRentalCard(rental)));

  const original = document.createElement("details");
  original.className = "trace-section";
  const summary = document.createElement("summary");
  summary.className = "trace-label";
  summary.textContent = "Xem thêm";
  const full = document.createElement("div");
  full.className = "trace-text observation";
  full.textContent = text;
  original.append(summary, full);
  wrap.append(title, grid, original);
  return wrap;
}

function createRentalCard(rental) {
  const card = document.createElement("article");
  card.className = "rental-card";
  const id = document.createElement("span");
  id.className = "property-id";
  id.textContent = rental.id;
  const title = document.createElement("strong");
  title.textContent = rental.title || "Rental listing";
  const details = document.createElement("div");
  details.className = "rental-details";
  [rental.location, rental.area, rental.price, rental.status].filter(Boolean).forEach((item) => {
    const chip = document.createElement("span");
    chip.textContent = item;
    details.appendChild(chip);
  });
  card.append(id, title, details);
  return card;
}

function parseRentalCards(text) {
  const lines = String(text).split(/\r?\n/);
  const cards = [];
  for (const line of lines) {
    const listMatch = line.match(/-\s+\[(PROP-\d+)\]\s+(.+?)\s+\|\s+(.+?)\s+\|\s+(.+?)\s+\|\s+(.+)/);
    if (listMatch) {
      cards.push({
        id: listMatch[1],
        title: listMatch[2],
        location: listMatch[3],
        area: listMatch[4],
        price: listMatch[5],
      });
      continue;
    }
    const detailMatch = line.match(/^Chi tiết tin \[(PROP-\d+)\]\s+-\s+(.+):/);
    if (detailMatch) cards.push({id: detailMatch[1], title: detailMatch[2], status: "Chi tiết"});
  }
  return cards;
}

function textBlock(text) {
  const block = document.createElement("div");
  block.textContent = text;
  return block;
}

function setLoading(isLoading) {
  state.isRunning = isLoading;
  els.loadingPanel.classList.toggle("hidden", !isLoading);
  [els.runBtn, els.runCaseBtn, els.clearBtn].forEach((button) => {
    button.disabled = isLoading;
  });
  els.runBtn.querySelector(".run-label").textContent = isLoading ? "Đang xử lý..." : "Chạy trợ lý";

  window.clearInterval(loadingTimer);
  if (isLoading) {
    let index = 0;
    const messages = loadingMessages[state.mode];
    els.loadingTitle.textContent = messages[index];
    loadingTimer = window.setInterval(() => {
      index = (index + 1) % messages.length;
      els.loadingTitle.textContent = messages[index];
    }, 1400);
  }
}

function showError(message) {
  els.errorBanner.textContent = message || "Yêu cầu không hợp lệ.";
  els.errorBanner.classList.remove("hidden");
}

function hideError() {
  els.errorBanner.textContent = "";
  els.errorBanner.classList.add("hidden");
}

async function refreshHealth() {
  try {
    const response = await fetch("/api/health", {headers: {"Accept": "application/json"}});
    const health = await response.json();
    state.health = health;
    renderHealth(health);
    showToast(health.status === "ok" ? "Kết nối backend ổn định." : "Backend đang ở trạng thái degraded.");
  } catch (_error) {
    showError("Không thể kết nối backend.");
    showToast("Không thể kết nối backend.");
  }
}

function renderHealth(health) {
  const degraded = Boolean(health.error) || health.status === "degraded";
  els.healthPanel.classList.toggle("degraded", degraded);
  els.healthStatus.textContent = degraded ? "Degraded" : "Connected";
  els.mobileStatus.textContent = degraded ? "Degraded" : "Connected";
  els.providerLabel.textContent = `${health.provider || "unknown"} · ${health.model || "unknown"}`;
}

function clearInput() {
  els.queryInput.value = "";
  autoResizeTextarea();
  updateCounter();
  els.queryInput.focus();
}

function autoResizeTextarea() {
  els.queryInput.style.height = "auto";
  els.queryInput.style.height = `${Math.min(320, els.queryInput.scrollHeight)}px`;
}

function updateCounter() {
  els.charCounter.textContent = `${els.queryInput.value.length} ký tự`;
}

async function copyAnswer() {
  try {
    await navigator.clipboard.writeText(state.lastAnswer);
    els.copyAnswerBtn.textContent = "Đã sao chép";
    showToast("Đã sao chép câu trả lời.");
    window.setTimeout(() => {
      els.copyAnswerBtn.textContent = "Sao chép";
    }, 1300);
  } catch (_error) {
    showToast("Không thể sao chép.");
  }
}

function setTraceCollapsed(collapsed) {
  document.querySelectorAll(".step-card").forEach((card) => {
    card.classList.toggle("collapsed", collapsed);
    const head = card.querySelector(".step-head");
    if (head) head.setAttribute("aria-expanded", String(!collapsed));
  });
}

function toggleRawJson() {
  state.showRaw = !state.showRaw;
  els.traceCard.classList.toggle("show-raw", state.showRaw);
  els.toggleRawBtn.textContent = state.showRaw ? "Ẩn JSON" : "Raw JSON";
}

function openSidebar() {
  els.sidebar.classList.add("open");
  els.sidebarBackdrop.classList.add("open");
}

function closeSidebar() {
  els.sidebar.classList.remove("open");
  els.sidebarBackdrop.classList.remove("open");
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  els.toastStack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3000);
}

function parseRawOutput(raw) {
  const thought = raw.match(/Thought\s*:\s*([\s\S]*?)(?:\n\s*(?:Action|Final Answer)\s*:|$)/i);
  const finalAnswer = raw.match(/Final Answer\s*:\s*([\s\S]+)/i);
  return {
    thought: thought ? thought[1].trim() : "",
    finalAnswer: finalAnswer ? finalAnswer[1].trim() : "",
  };
}

function formatCurrency(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatLatency(ms) {
  const value = Number(ms || 0);
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

function statusClass(status, guardrail) {
  if (guardrail) return "guarded";
  if (status === "success") return "success";
  if (status === "error" || status === "guarded") return "error";
  return "";
}

function guardrailLabel(value) {
  if (value === "prompt_injection") return "Prompt Injection bị chặn";
  if (value === "repeated_action") return "Chặn lặp tool";
  if (value === "max_iterations") return "Chạm giới hạn vòng lặp";
  return value || "Guardrail";
}

function guardrailExplanation(value) {
  if (value === "prompt_injection") return "Yêu cầu cố thay đổi vai trò hệ thống đã bị từ chối.";
  if (value === "repeated_action") return "Agent cố gọi lại cùng một tool với cùng tham số.";
  if (value === "max_iterations") return "Agent đã dùng hết số vòng xử lý an toàn.";
  return "Guardrail đã được kích hoạt.";
}

function caseType(category) {
  const value = normalize(category);
  if (value.includes("multi")) return "multi";
  if (value.includes("edge") || value.includes("guard") || value.includes("bay")) return "guardrail";
  return "llm";
}

function readableCaseType(category) {
  const type = caseType(category);
  if (type === "multi") return "Multi-step";
  if (type === "guardrail") return "Guardrail";
  return "LLM";
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function truncate(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
