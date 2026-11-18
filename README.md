# LLM

The page at LLM.T-tek.dev runs a chat model in the browser. MiniMind-3 ships with the page and is the model that loads first. The other models download from Hugging Face the first time they are selected.

## Quick start

1. The runtime and MiniMind-3 are already in the repo. `fetch_assets.py` can also save a local Qwen file that the page does not use:

```bash
python fetch_assets.py
```

2. Serve this folder with the isolation headers:

```bash
python server.py
```

3. Open http://127.0.0.1:8080

`server.py` sends:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Those headers let the WASM runtime use threads. `python -m http.server` does not send them.

## What the page loads

| File | Role |
| --- | --- |
| `vendor/wllama/index.js` | wllama 3.13.0 |
| `vendor/wllama/wllama.wasm` | llama.cpp WASM (~10.2 MB) |
| `models/minimind-3.q8.gguf` | Default chat model, committed |

Commit `vendor/` and `models/minimind-3.q8.gguf`. Leave every other GGUF out of git.

The model list is ordered by reserved memory: file size, plus the f16 key/value cache at that model's context length, plus 80 MB of runtime. Gemma 3 keeps a 512-token sliding window on 22 layers and the full window on every 6th layer. The page cannot read free RAM. Where the browser reports `navigator.deviceMemory`, the header shows that coarse bucket (capped at 8 GB). A model that reserves more than half of the bucket is marked `tight fit` and can still be selected.

- MiniMind-3 64M Q8, local, 2048 context, ~170 MB
- SmolLM2 135M Instruct Q4, 2048 context, ~230 MB
- SmolLM2 360M Instruct Q4, 2048 context, ~420 MB
- Qwen2.5 0.5B Instruct Q4, 2048 context, ~480 MB
- Gemma 3 1B Instruct Q4, 4096 context, ~880 MB
- Qwen3 0.6B Q4, 4096 context, ~910 MB
- Llama 3.2 1B Instruct Q4, 4096 context, ~980 MB
- Qwen2.5 1.5B Instruct Q4, 4096 context, ~1.1 GB
- Qwen3 1.7B Q4, 4096 context, ~1.5 GB
- SmolLM2 1.7B Instruct Q4, 4096 context, ~1.8 GB
- Llama 3.2 3B Instruct Q4, 4096 context, ~2.4 GB

## Chat

- Tokens stream into the reply. Send becomes Stop while a reply is running.
- Stop keeps a partial reply and silences the voice. A failed reply does not leave a dangling user turn.
- Settings cover max tokens, temperature, repeat penalty, a system prompt, Thinking, and TTS.
- TTS speaks each finished sentence while the rest of the reply is still generating. Interrupt stops the voice and leaves the reply running. TTS is off until switched on. The first time it runs, the speech model (about 8.5 MB) downloads once and stays in the browser. Voice, speed, and audio output are in Settings.
- TTS off: nothing extra. TTS on: 8.5 MB once, then about 25 MB. CPU only while speaking. Model memory is the reserved figure in the model list.
- The default system prompt is: "You are a helpful assistant. Answer clearly, stay accurate, and say when you are unsure."
- Thinking opens the think channel on MiniMind-3 (`open_thinking`) and Qwen3 (`enable_thinking`). Other models ignore that checkbox. It is off by default. The system prompt does not open that channel.
- Chats in the header lists conversations saved in this browser. Open one to continue it. Clear saves the current chat, then starts a new one. Clear all deletes every saved chat.
- The context line shows how much of that model's window is used. At the limit, older messages stay on screen and the model sees only the newest part. A 4096-token model can reply with up to 2048 tokens. A 2048-token model stays at 1024.

## Deploy

GitHub Pages can serve this repo, including MiniMind-3. It does not send the two headers above, so the browser uses one WASM thread there. A host that sends those headers can use more threads. The other models are not part of the upload. The browser fetches them from Hugging Face.
