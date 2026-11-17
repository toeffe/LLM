import { Wllama } from "./vendor/wllama/index.js";
import { loadEngine, synthesize } from "./vendor/speech/tts.js";

const SPEECH_KEY = "minimind.speech";
const VOICES = [
  ["af_heart", "Heart · English"],
  ["am_puck", "Puck · English"],
  ["bf_isabella", "Isabella · English (UK)"],
  ["bm_fable", "Fable · English (UK)"],
  ["ff_siwis", "Siwis · French"],
  ["em_alex", "Alex · Spanish"],
  ["hf_alpha", "Alpha · Hindi"],
  ["hm_omega", "Omega · Hindi"],
];

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
    nCtx: 4096,
    maxTokens: 2048,
    temperature: 0.7,
    topK: 20,
    topP: 0.8,
    repeatPenalty: 1.1,
    thinkingKey: "enable_thinking",
  },
];

const wasmUrl = new URL("./vendor/wllama/wllama.wasm", import.meta.url).href;

const badgeEl = document.getElementById("badge");
const modelNoteEl = document.getElementById("modelNote");
const modelEl = document.getElementById("model");
const statusEl = document.getElementById("status");
const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const clearBtn = document.getElementById("clear");
const contextLabel = document.getElementById("contextLabel");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const maxTokensEl = document.getElementById("maxTokens");
const temperatureEl = document.getElementById("temperature");
const repeatPenaltyEl = document.getElementById("repeatPenalty");
const thinkingEl = document.getElementById("thinking");
const ttsEl = document.getElementById("tts");
const ttsVoiceEl = document.getElementById("ttsVoice");
const ttsSpeedEl = document.getElementById("ttsSpeed");
const ttsOutputEl = document.getElementById("ttsOutput");
const systemPromptEl = document.getElementById("systemPrompt");
const resetPromptBtn = document.getElementById("resetPrompt");

let wllama = null;
const CHATS_KEY = "minimind.chats";
let messages = [];
let contextWarned = false;
let chatId = null;
let pendingChat = null;
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
    let settings = defaults;
    const raw = localStorage.getItem(settingsKey(model.id));
    if (raw) settings = { ...defaults, ...JSON.parse(raw) };
    else {
      const old = localStorage.getItem(`minimind.settings.${model.id}`);
      if (old) {
        const parsed = JSON.parse(old);
        delete parsed.maxTokens;
        settings = { ...defaults, ...parsed };
      }
    }
    const capKey = `minimind.maxTokensCap.${model.id}`;
    const cap = Number(localStorage.getItem(capKey) || 1024);
    if (model.maxTokens > cap && Number(settings.maxTokens) === cap) {
      settings.maxTokens = model.maxTokens;
      localStorage.setItem(settingsKey(model.id), JSON.stringify(settings));
    }
    if (model.maxTokens > cap) localStorage.setItem(capKey, String(model.maxTokens));
    return settings;
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
  modelNoteEl.hidden = model.id !== "minimind-3";
  maxTokensEl.max = String(model.maxTokens);
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

let speechEngine = null;
let speechLoad = null;
let speechRun = null;
let speechAudio = null;
let speechUrl = null;

function readSpeech() {
  const defaults = { enabled: false, voice: "af_heart", speed: 1, output: "" };
  try {
    const raw = localStorage.getItem(SPEECH_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

function writeSpeech() {
  localStorage.setItem(
    SPEECH_KEY,
    JSON.stringify({
      enabled: ttsEl.checked,
      voice: ttsVoiceEl.value,
      speed: Number(ttsSpeedEl.value) || 1,
      output: ttsOutputEl.value === "choose" ? readSpeech().output : ttsOutputEl.value,
    })
  );
}

function applySpeech() {
  const speech = readSpeech();
  ttsEl.checked = speech.enabled;
  ttsVoiceEl.value = VOICES.some(([id]) => id === speech.voice) ? speech.voice : "af_heart";
  ttsSpeedEl.value = String(speech.speed);
}

function speechElement() {
  if (!speechAudio) speechAudio = new Audio();
  return speechAudio;
}

function unlockAudio() {
  const audio = speechElement();
  if (audio.dataset.ready === "1") return;
  audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
  const pending = audio.play();
  audio.dataset.ready = "1";
  if (pending) pending.then(() => audio.pause()).catch(() => { audio.dataset.ready = ""; });
}

function stopSpeech() {
  if (speechRun) speechRun.cancelled = true;
  if (speechAudio) {
    speechAudio.pause();
    speechAudio.removeAttribute("src");
    speechAudio.load();
  }
  if (speechUrl) {
    URL.revokeObjectURL(speechUrl);
    speechUrl = null;
  }
}

function addOutputOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  ttsOutputEl.appendChild(option);
}

let outputRefresh = 0;

async function refreshOutputs() {
  const token = ++outputRefresh;
  const saved = readSpeech().output || "";
  const chosen = ttsOutputEl.value && ttsOutputEl.value !== "choose" ? ttsOutputEl.value : saved;
  let devices = [];
  try {
    if (navigator.mediaDevices?.enumerateDevices) {
      devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audiooutput");
    }
  } catch { /* Default still works */ }
  if (token !== outputRefresh) return;
  ttsOutputEl.replaceChildren();
  addOutputOption("", "Default");
  let blank = 0;
  for (const device of devices) {
    if (!device.deviceId) continue;
    if (!device.label) blank += 1;
    addOutputOption(device.deviceId, device.label || `Speaker ${blank}`);
  }
  if (saved && ![...ttsOutputEl.options].some((option) => option.value === saved)) {
    addOutputOption(saved, "Saved speaker");
  }
  if (navigator.mediaDevices?.selectAudioOutput) addOutputOption("choose", "Choose speaker…");
  ttsOutputEl.value = [...ttsOutputEl.options].some((option) => option.value === chosen) ? chosen : "";
}

async function useOutput(audio) {
  const id = ttsOutputEl.value;
  if (!id || id === "choose" || typeof audio.setSinkId !== "function") return;
  try {
    await audio.setSinkId(id);
  } catch (err) {
    console.warn(err);
    ttsOutputEl.value = "";
    writeSpeech();
  }
}

const SMILEY =
  /(?<![\w])(?::['’]-?\(|[:;=8][-^']?[)\]DdpP3/\\(|*]|[)\](/\\][-^']?[:;=8]|<3|<\/3|\^_+\^|>_+<|>\.<|[xX][Dd])(?![\w])/g;

function speechText(raw) {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<think>[\s\S]*$/gi, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[\u200D\uFE0F\uFE0E]/g, " ")
    .replace(SMILEY, " ")
    .replace(/\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function speakReply(raw, myRun) {
  const text = speechText(raw);
  if (!text || !ttsEl.checked || myRun !== runId) return;
  stopSpeech();
  const run = { cancelled: false };
  speechRun = run;
  try {
    if (!speechEngine) {
      speechLoad = speechLoad || loadEngine(({ text: label, progress }) => {
        if (run.cancelled || myRun !== runId) return;
        setStatus(progress == null ? label : `Speech… ${progress}%`);
      });
      speechEngine = await speechLoad;
    }
    if (run.cancelled || !ttsEl.checked || myRun !== runId) return;
    const { blob } = await synthesize(
      speechEngine,
      [{ text, voice: ttsVoiceEl.value, speed: Number(ttsSpeedEl.value) || 1 }],
      null,
      run
    );
    if (run.cancelled || !ttsEl.checked || myRun !== runId) return;
    const audio = speechElement();
    await useOutput(audio);
    if (run.cancelled || !ttsEl.checked || myRun !== runId) return;
    if (speechUrl) URL.revokeObjectURL(speechUrl);
    speechUrl = URL.createObjectURL(blob);
    audio.src = speechUrl;
    await audio.play();
    if (!generating) setStatus(`Ready`, "ready");
  } catch (err) {
    if (run.cancelled || err?.cancelled) return;
    console.error(err);
    setStatus("Speech failed", "error");
  }
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

const scroller = document.querySelector("main");
let followChat = true;

scroller.addEventListener("scroll", () => {
  const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  followChat = gap < 80;
});

function scrollChatToEnd(force = false) {
  if (force) followChat = true;
  if (!followChat) return;
  requestAnimationFrame(() => {
    if (followChat) scroller.scrollTop = scroller.scrollHeight;
  });
}

function addMessage(role, content) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (role === "assistant") div.innerHTML = renderThink(content);
  else div.textContent = content;
  chatEl.appendChild(div);
  scrollChatToEnd(true);
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
    "Chat runs on this device. Other models download once.\n\nMiniMind-3: about 65 MB.\nQwen: 378 MB once, then about 850 MB.\nTTS off: nothing extra.\nTTS on: 8.5 MB once, then about 25 MB. CPU only while speaking."
  );
}

function readChats() {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeChats(chats) {
  let list = chats.slice(0, 30);
  while (list.length) {
    try {
      localStorage.setItem(CHATS_KEY, JSON.stringify(list));
      return;
    } catch {
      list.pop();
    }
  }
  localStorage.removeItem(CHATS_KEY);
}

function chatTitle(list) {
  const user = list.find((message) => message.role === "user");
  const text = String(user?.content || "New chat").replace(/\s+/g, " ").trim();
  return text.length > 48 ? text.slice(0, 47) + "…" : text || "New chat";
}

function saveCurrentChat() {
  const turns = messages.filter((message) => message.role !== "system");
  if (!turns.length) return false;
  if (!chatId) chatId = crypto.randomUUID();
  const chats = readChats().filter((chat) => chat.id !== chatId);
  chats.unshift({
    id: chatId,
    title: chatTitle(messages),
    modelId: activeId,
    updated: Date.now(),
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
  });
  writeChats(chats);
  return true;
}

function renderChatList() {
  const chatListEl = document.getElementById("chatList");
  chatListEl.replaceChildren();
  const chats = readChats();
  if (!chats.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Saved chats show up here.";
    chatListEl.appendChild(empty);
    return;
  }
  for (const chat of chats) {
    const row = document.createElement("div");
    row.className = "chat-row";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "text chat-open";
    open.textContent = chat.title;
    open.addEventListener("click", () => openSavedChat(chat.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      writeChats(readChats().filter((item) => item.id !== chat.id));
      if (chat.id === chatId) chatId = null;
      renderChatList();
    });
    row.append(open, remove);
    chatListEl.appendChild(row);
  }
}

function restoreChat(chat) {
  chatId = chat.id;
  messages = chat.messages.map((message) => ({ role: message.role, content: message.content }));
  if (!messages.length || messages[0].role !== "system") {
    messages.unshift({ role: "system", content: systemText() });
  }
  contextWarned = false;
  chatEl.innerHTML = "";
  const turns = messages.filter((message) => message.role !== "system");
  if (!turns.length) showIntro();
  else {
    for (const message of turns) addMessage(message.role, message.content);
  }
  updateContext();
}

function openSavedChat(id) {
  const chat = readChats().find((item) => item.id === id);
  if (!chat) return;
  if (chat.id !== chatId) saveCurrentChat();
  stopSpeech();
  abort?.abort();
  abort = null;
  generating = false;
  setChatsOpen(false);
  if (chat.modelId !== activeId && MODELS.some((model) => model.id === chat.modelId)) {
    pendingChat = chat;
    modelEl.value = chat.modelId;
    modelEl.dispatchEvent(new Event("change"));
    return;
  }
  pendingChat = null;
  restoreChat(chat);
  if (!loading && wllama) {
    setReady(true);
    setStatus(`Ready`, "ready");
  }
}

function resetTranscript() {
  messages = [{ role: "system", content: systemText() }];
  contextWarned = false;
  chatId = null;
  showIntro();
  updateContext();
}

function tokensOf(text) {
  return Math.ceil(String(text || "").length / 4) + 6;
}

function usedTokens(extra = "") {
  let total = 4;
  for (const message of messages) total += tokensOf(message.content);
  if (extra) total += tokensOf(extra);
  return total;
}

function updateContext(extra = "") {
  const limit = currentModel().nCtx;
  const pct = Math.min(100, Math.round((usedTokens(extra) / limit) * 100));
  contextLabel.textContent = `Context ${pct}%`;
  contextLabel.className = "context" + (pct >= 100 ? " full" : pct >= 85 ? " warn" : "");
}

function messagesForModel(reserve) {
  const limit = Math.max(32, currentModel().nCtx - reserve);
  const head = messages[0];
  const kept = [];
  let used = tokensOf(head.content) + 4;
  for (let i = messages.length - 1; i >= 1; i--) {
    const cost = tokensOf(messages[i].content);
    if (used + cost > limit && kept.length) break;
    kept.push(messages[i]);
    used += cost;
  }
  kept.reverse();
  return { payload: [head, ...kept], dropped: messages.length - 1 - kept.length };
}

function sampling() {
  const model = currentModel();
  const maxTokens = Math.min(model.maxTokens, Math.max(16, Number(maxTokensEl.value) || model.maxTokens));
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
    setStatus(`Ready`, "ready");
    loading = false;
    setReady(true);
    if (pendingChat && pendingChat.modelId === model.id) {
      const chat = pendingChat;
      pendingChat = null;
      restoreChat(chat);
    }
    updateContext();
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
  stopSpeech();
  if (ttsEl.checked) unlockAudio();
  messages[0] = { role: "system", content: systemText() };
  messages.push({ role: "user", content: text });
  inputEl.value = "";
  addMessage("user", text);
  const sample = sampling();
  const fitted = messagesForModel(sample.max_tokens);
  if (fitted.dropped > 0 && !contextWarned) {
    contextWarned = true;
    addMessage(
      "system",
      `This chat reached the ${currentModel().nCtx}-token limit. The model can see only the newest part. Older messages stay on screen.`
    );
  }
  updateContext();

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
    updateContext(reply);
    scrollChatToEnd();
    return reply;
  };

  try {
    const result = await wllama.createChatCompletion({
      messages: fitted.payload,
      stream: true,
      abortSignal: abort.signal,
      cache_prompt: true,
      ...sample,
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
    if (content || reasoning) {
      messages.push({ role: "assistant", content: reply });
      void speakReply(reply, myRun);
    } else {
      messages.pop();
      assistantDiv.remove();
      dropLastUserBubble();
      addMessage("system", "No reply.");
    }
    setStatus(`Ready`, "ready");
  } catch (err) {
    if (myRun !== runId) return;
    if (err?.name === "AbortError") {
      if (content || reasoning) messages.push({ role: "assistant", content: reply });
      else {
        messages.pop();
        assistantDiv.remove();
        dropLastUserBubble();
      }
      setStatus(`Ready`, "ready");
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
    updateContext();
    saveCurrentChat();
    inputEl.focus();
  }
}

function stop() {
  abort?.abort();
}

function clearChat() {
  runId++;
  stopSpeech();
  const saved = saveCurrentChat();
  abort?.abort();
  abort = null;
  generating = false;
  sendBtn.textContent = "Send";
  messages = [{ role: "system", content: systemText() }];
  contextWarned = false;
  chatId = null;
  chatEl.innerHTML = "";
  addMessage("system", saved ? "Saved. This is a new chat." : "New chat.");
  updateContext();
  if (!loading && wllama) {
    setReady(true);
    setStatus(`Ready`, "ready");
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
  if (!pendingChat) saveCurrentChat();
  writeSettings(activeId);
  activeId = modelEl.value;
  const model = currentModel();
  localStorage.setItem("minimind.modelId", activeId);
  stopSpeech();
  abort?.abort();
  abort = null;
  generating = false;
  applySettings(model);
  if (!pendingChat) {
    chatId = null;
    resetTranscript();
  }
  boot(model);
});

for (const el of [maxTokensEl, temperatureEl, repeatPenaltyEl, thinkingEl, systemPromptEl]) {
  el.addEventListener("change", () => writeSettings());
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

for (const [id, label] of VOICES) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = label;
  ttsVoiceEl.appendChild(option);
}
applySpeech();
refreshOutputs();

for (const el of [ttsEl, ttsVoiceEl, ttsSpeedEl]) {
  el.addEventListener("change", () => {
    writeSpeech();
    if (el === ttsEl) {
      if (ttsEl.checked) unlockAudio();
      else stopSpeech();
    }
  });
}

const settingsToggle = document.getElementById("settingsToggle");
const settingsPanel = document.getElementById("settingsPanel");

const chatsToggle = document.getElementById("chatsToggle");
const chatsPanel = document.getElementById("chatsPanel");

function setChatsOpen(open) {
  chatsPanel.classList.toggle("is-open", open);
  chatsToggle.setAttribute("aria-expanded", String(open));
  if (open) {
    setSettingsOpen(false);
    renderChatList();
  }
}

function setSettingsOpen(open) {
  settingsPanel.classList.toggle("is-open", open);
  settingsToggle.setAttribute("aria-expanded", String(open));
  if (open) setChatsOpen(false);
}

settingsToggle.addEventListener("click", () => {
  const open = !settingsPanel.classList.contains("is-open");
  setSettingsOpen(open);
  if (open) refreshOutputs();
});

chatsToggle.addEventListener("click", () => {
  setChatsOpen(!chatsPanel.classList.contains("is-open"));
});

document.getElementById("newChat").addEventListener("click", () => {
  clearChat();
  setChatsOpen(false);
});

document.getElementById("clearChats").addEventListener("click", () => {
  if (!readChats().length) return;
  if (!confirm("Delete all saved chats?")) return;
  writeChats([]);
  chatId = null;
  renderChatList();
});

ttsOutputEl.addEventListener("change", async () => {
  if (ttsOutputEl.value === "choose") {
    try {
      const picked = await navigator.mediaDevices.selectAudioOutput();
      await refreshOutputs();
      ttsOutputEl.value = picked.deviceId;
    } catch {
      ttsOutputEl.value = readSpeech().output || "";
    }
  }
  writeSpeech();
});

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  if (settingsPanel.classList.contains("is-open")) refreshOutputs();
});

document.addEventListener("click", (event) => {
  if (settingsPanel.classList.contains("is-open") && !event.target.closest("#settingsAnchor")) {
    setSettingsOpen(false);
  }
  if (chatsPanel.classList.contains("is-open") && !event.target.closest("#chatsAnchor")) {
    setChatsOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  setSettingsOpen(false);
  setChatsOpen(false);
});

fillModels();
applySettings(currentModel());
resetTranscript();
boot(currentModel());
