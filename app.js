import { Wllama } from "./vendor/wllama/index.js";

const DEFAULT_SYSTEM =
  "You are a helpful assistant. Answer clearly, stay accurate, and say when you are unsure.";

const MODELS = [
  {
    id: "minimind-3",
    label: "MiniMind-3 64M Q8",
    url: "./models/minimind-3.q8.gguf",
    badge: "64M · Q8",
    sizeLabel: "~65 MB",
    nCtx: 2048,
    maxTokens: 1024,
    temperature: 0.7,
    topK: 40,
    topP: 0.9,
    repeatPenalty: 1.2,
    thinkingKey: "open_thinking",
  },
  {
    id: "qwen3-0.6b",
    label: "Qwen3 0.6B Q4",
    url: "https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf",
    badge: "0.6B · Q4",
    sizeLabel: "~378 MB",
    nCtx: 2048,
    maxTokens: 1024,
    temperature: 0.7,
    topK: 20,
    topP: 0.8,
    repeatPenalty: 1.1,
    thinkingKey: "enable_thinking",
  },
];

const wasmUrl = new URL("./vendor/wllama/wllama.wasm", import.meta.url).href;

const badgeEl = document.getElementById("badge");
const modelEl = document.getElementById("model");
const statusEl = document.getElementById("status");
const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const clearBtn = document.getElementById("clear");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const maxTokensEl = document.getElementById("maxTokens");
const temperatureEl = document.getElementById("temperature");
const repeatPenaltyEl = document.getElementById("repeatPenalty");
const thinkingEl = document.getElementById("thinking");
const systemPromptEl = document.getElementById("systemPrompt");
const resetPromptBtn = document.getElementById("resetPrompt");

let wllama = null;
let messages = [];
let generating = false;
let loading = false;
let abort = null;
let runId = 0;
let activeId = MODELS[0].id;

function modelById(id) {
  return MODELS.find((model) => model.id === id) || MODELS[0];
}

function currentModel() {
  return modelById(modelEl.value);
}

function settingsKey(id) {
  return `minimind.settings.v2.${id}`;
}

function defaultSettings(model) {
  return {
    maxTokens: model.maxTokens,
    temperature: model.temperature,
    repeatPenalty: model.repeatPenalty,
    systemPrompt: DEFAULT_SYSTEM,
    thinking: false,
  };
}

function readSettings(model) {
  const defaults = defaultSettings(model);
  try {
    const raw = localStorage.getItem(settingsKey(model.id));
    if (raw) return { ...defaults, ...JSON.parse(raw) };
    const old = localStorage.getItem(`minimind.settings.${model.id}`);
    if (!old) return defaults;
    const parsed = JSON.parse(old);
    delete parsed.maxTokens;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function systemText() {
  const text = systemPromptEl.value.trim();
  return text || DEFAULT_SYSTEM;
}

function writeSettings(id = activeId) {
  localStorage.setItem(
    settingsKey(id),
    JSON.stringify({
      maxTokens: Number(maxTokensEl.value),
      temperature: Number(temperatureEl.value),
      repeatPenalty: Number(repeatPenaltyEl.value),
      systemPrompt: systemPromptEl.value,
      thinking: thinkingEl.checked,
    })
  );
  localStorage.setItem("minimind.modelId", activeId);
}

function applySettings(model) {
  const settings = readSettings(model);
  badgeEl.textContent = model.badge;
  maxTokensEl.value = String(settings.maxTokens);
  temperatureEl.value = String(settings.temperature);
  repeatPenaltyEl.value = String(settings.repeatPenalty);
  systemPromptEl.value = settings.systemPrompt;
  thinkingEl.checked = Boolean(settings.thinking);
}

function setStatus(text, cls = "") {
  statusEl.textContent = text;
  statusEl.className = "status " + cls;
}

function setReady(enabled) {
  modelEl.disabled = !enabled || loading;
  inputEl.disabled = !enabled;
  sendBtn.disabled = !enabled && !generating;
  clearBtn.disabled = !enabled && !generating;
  if (enabled && !generating) sendBtn.textContent = "Send";
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderThink(raw) {
  let html = "";
  let rest = raw;
  while (rest.length) {
    const open = rest.indexOf("<think>");
    if (open === -1) {
      html += escapeHtml(rest);
      break;
    }
    html += escapeHtml(rest.slice(0, open));
    const after = rest.slice(open + "<think>".length);
    const close = after.indexOf("</think>");
    if (close === -1) {
      const think = after.trim();
      if (think) html += `<div class="think">${escapeHtml(think)}</div>`;
      break;
    }
    const think = after.slice(0, close).trim();
    if (think) html += `<div class="think">${escapeHtml(think)}</div>`;
    rest = after.slice(close + "</think>".length);
  }
  return html;
}

function addMessage(role, content) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (role === "assistant") div.innerHTML = renderThink(content);
  else div.textContent = content;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
  return div;
}

function dropLastUserBubble() {
  const nodes = chatEl.querySelectorAll(".msg.user");
  nodes[nodes.length - 1]?.remove();
}

function showIntro() {
  chatEl.innerHTML = "";
  addMessage(
    "system",
    "Chat runs on this device. Other models download once."
  );
}

function resetTranscript() {
  messages = [{ role: "system", content: systemText() }];
  showIntro();
}

function sampling() {
  const model = currentModel();
  const maxTokens = Math.min(1024, Math.max(16, Number(maxTokensEl.value) || model.maxTokens));
  const temperature = Math.min(2, Math.max(0, Number(temperatureEl.value)));
  const repeatPenalty = Math.min(2, Math.max(1, Number(repeatPenaltyEl.value) || 1));
  return {
    max_tokens: maxTokens,
    temperature: Number.isFinite(temperature) ? temperature : model.temperature,
    top_k: model.topK,
    top_p: model.topP,
    repeat_penalty: Number.isFinite(repeatPenalty) ? repeatPenalty : model.repeatPenalty,
    chat_template_kwargs: { [model.thinkingKey]: thinkingEl.checked },
  };
}

async function boot(model) {
  const myLoad = ++runId;
  const previous = wllama;
  wllama = null;
  loading = true;
  generating = false;
  abort = null;
  setReady(false);
  sendBtn.disabled = true;
  clearBtn.disabled = true;
  modelEl.disabled = true;
  progressBar.style.width = "0%";
  progressWrap.classList.add("visible");
  try {
    if (previous) {
      try {
        await previous.exit();
      } catch (err) {
        console.warn(err);
      }
    }
    if (myLoad !== runId) return;
    setStatus("Loading WASM…");
    const engine = new Wllama({ default: wasmUrl });
    wllama = engine;
    setStatus(`Loading ${model.label} (${model.sizeLabel})…`);
    await engine.loadModelFromUrl(model.url, {
      n_ctx: model.nCtx,
      n_batch: 512,
      n_ubatch: 512,
      n_parallel: 1,
      // WebGPU here cannot run flash attention, so each token waits on a CPU/GPU split.
      n_gpu_layers: 0,
      n_threads: navigator.hardwareConcurrency || 4,
      flash_attn: true,
      reasoning: false,
      progressCallback: ({ loaded, total }) => {
        if (myLoad !== runId || total <= 0) return;
        const pct = Math.round((loaded / total) * 100);
        progressBar.style.width = pct + "%";
        setStatus(`Loading… ${pct}%`);
      },
    });
    if (myLoad !== runId || wllama !== engine) {
      try {
        await engine.exit();
      } catch (err) {
        console.warn(err);
      }
      return;
    }
    progressWrap.classList.remove("visible");
    setStatus(`Ready · ${model.label}`, "ready");
    loading = false;
    setReady(true);
    inputEl.focus();
  } catch (err) {
    if (myLoad !== runId) return;
    console.error(err);
    loading = false;
    progressWrap.classList.remove("visible");
    setStatus("Failed: " + (err.message || err), "error");
    addMessage("system", "Load failed. Check that vendor/ and models/ are next to this page.");
  }
}

async function send() {
  const text = inputEl.value.trim();
  if (!text || generating || loading || !wllama) return;

  writeSettings();
  messages[0] = { role: "system", content: systemText() };
  messages.push({ role: "user", content: text });
  inputEl.value = "";
  addMessage("user", text);

  const myRun = runId;
  const assistantDiv = addMessage("assistant", "");
  assistantDiv.textContent = "…";
  let content = "";
  let reasoning = "";
  let reply = "";
  generating = true;
  abort = new AbortController();
  sendBtn.disabled = false;
  sendBtn.textContent = "Stop";
  inputEl.disabled = true;
  setStatus("Generating…");

  const paint = () => {
    reply = (reasoning ? `<think>${reasoning}</think>\n` : "") + content;
    assistantDiv.innerHTML = renderThink(reply) || "…";
    chatEl.scrollTop = chatEl.scrollHeight;
    return reply;
  };

  try {
    const result = await wllama.createChatCompletion({
      messages,
      stream: true,
      abortSignal: abort.signal,
      cache_prompt: true,
      ...sampling(),
      onData(chunk) {
        if (myRun !== runId) return;
        const delta = chunk?.choices?.[0]?.delta || {};
        if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
        if (typeof delta.content === "string") content += delta.content;
        if (reasoning || content) paint();
      },
    });
    const message = result?.choices?.[0]?.message;
    if (!content && !reasoning && message) {
      if (typeof message.reasoning_content === "string") reasoning = message.reasoning_content;
      if (typeof message.content === "string") content = message.content;
    }
    reply = paint();
    if (myRun !== runId) return;
    if (content || reasoning) messages.push({ role: "assistant", content: reply });
    else {
      messages.pop();
      assistantDiv.remove();
      dropLastUserBubble();
      addMessage("system", "No reply.");
    }
    setStatus(`Ready · ${currentModel().label}`, "ready");
  } catch (err) {
    if (myRun !== runId) return;
    if (err?.name === "AbortError") {
      if (content || reasoning) messages.push({ role: "assistant", content: reply });
      else {
        messages.pop();
        assistantDiv.remove();
        dropLastUserBubble();
      }
      setStatus(`Ready · ${currentModel().label}`, "ready");
    } else {
      console.error(err);
      messages.pop();
      assistantDiv.remove();
      dropLastUserBubble();
      addMessage("system", "Error: " + (err.message || err));
      setStatus("Generation error", "error");
    }
  } finally {
    if (myRun !== runId) return;
    generating = false;
    abort = null;
    sendBtn.textContent = "Send";
    inputEl.disabled = false;
    sendBtn.disabled = false;
    clearBtn.disabled = false;
    inputEl.focus();
  }
}

function stop() {
  abort?.abort();
}

function clearChat() {
  runId++;
  abort?.abort();
  abort = null;
  generating = false;
  sendBtn.textContent = "Send";
  messages = [{ role: "system", content: systemText() }];
  chatEl.innerHTML = "";
  addMessage("system", "Conversation cleared.");
  if (!loading && wllama) {
    setReady(true);
    setStatus(`Ready · ${currentModel().label}`, "ready");
  }
}

function fillModels() {
  const saved = localStorage.getItem("minimind.modelId");
  for (const model of MODELS) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    modelEl.appendChild(option);
  }
  activeId = modelById(saved).id;
  modelEl.value = activeId;
}

modelEl.addEventListener("change", () => {
  writeSettings(activeId);
  activeId = modelEl.value;
  const model = currentModel();
  localStorage.setItem("minimind.modelId", activeId);
  abort?.abort();
  abort = null;
  generating = false;
  applySettings(model);
  resetTranscript();
  boot(model);
});

for (const el of [maxTokensEl, temperatureEl, repeatPenaltyEl, thinkingEl, systemPromptEl]) {
  el.addEventListener("change", writeSettings);
}

resetPromptBtn.addEventListener("click", () => {
  systemPromptEl.value = DEFAULT_SYSTEM;
  writeSettings();
});

sendBtn.addEventListener("click", () => {
  if (generating) stop();
  else send();
});

inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!generating) send();
  }
});

clearBtn.addEventListener("click", clearChat);

const settingsToggle = document.getElementById("settingsToggle");
const settingsPanel = document.getElementById("settingsPanel");

function setSettingsOpen(open) {
  settingsPanel.classList.toggle("is-open", open);
  settingsToggle.setAttribute("aria-expanded", String(open));
}

settingsToggle.addEventListener("click", () => {
  setSettingsOpen(!settingsPanel.classList.contains("is-open"));
});

document.addEventListener("click", (event) => {
  if (!settingsPanel.classList.contains("is-open")) return;
  if (event.target.closest("#settingsAnchor")) return;
  setSettingsOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setSettingsOpen(false);
});

fillModels();
applySettings(currentModel());
resetTranscript();
boot(currentModel());
