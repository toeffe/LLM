# LLM

The page at LLM.T-tek.dev runs a chat model in the browser. MiniMind-3 ships with the page and is the model that loads first. Choosing Qwen downloads that file from Hugging Face once, into this browser.

## Quick start

1. The runtime and MiniMind-3 are already in the repo. To download a local copy of Qwen as well:

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
| `models/minimind-3.q8.gguf` | Default chat model, MiniMind-3 64M Q8 (~65 MB), committed |
| Qwen3-0.6B-Q4_K_M.gguf | Optional model (~378 MB), downloaded from [unsloth/Qwen3-0.6B-GGUF](https://huggingface.co/unsloth/Qwen3-0.6B-GGUF) the first time it is selected |

`fetch_assets.py` can also save that Qwen file under `models/`. The page does not read that local copy. Commit `vendor/` and `models/minimind-3.q8.gguf`. Leave the Qwen file out of git.

Context is 2048 tokens for MiniMind-3 and 4096 for Qwen, so the page does not allocate the models' full training cache. Qwen reserves that larger cache when it loads, about 850 MB.

## Chat

- Tokens stream into the reply. Send becomes Stop while a reply is running.
- Stop keeps a partial reply. A failed reply does not leave a dangling user turn.
- Settings cover max tokens, temperature, repeat penalty, a system prompt, Thinking, and TTS.
- TTS speaks a finished reply on this device. It is off until switched on. The first time it runs, the speech model (about 8.5 MB) downloads once and stays in the browser. Voice, speed, and audio output are in Settings.
- MiniMind-3: about 65 MB. Qwen: 378 MB once, then about 850 MB. TTS off: nothing extra. TTS on: 8.5 MB once, then about 25 MB. CPU only while speaking.
- The default system prompt is: "You are a helpful assistant. Answer clearly, stay accurate, and say when you are unsure."
- Thinking opens the model's think channel (`enable_thinking` on Qwen3, `open_thinking` on MiniMind-3). It is off by default. The system prompt does not open that channel.
- Chats in the header lists conversations saved in this browser. Open one to continue it. Clear saves the current chat, then starts a new one. Clear all deletes every saved chat.
- The context line shows how much of that model's window is used. At the limit, older messages stay on screen and the model sees only the newest part. Qwen replies can run to 2048 tokens, which leaves 2048 for the chat. MiniMind replies stay at 1024.

## Deploy

GitHub Pages can serve this repo, including MiniMind-3. It does not send the two headers above, so the browser uses one WASM thread there. A host that sends those headers can use more threads. Qwen is not part of the upload. The browser fetches it from Hugging Face.
