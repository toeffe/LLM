# LLM

The page at LLM.T-tek.dev runs a chat model in the browser. The engine and the weights are files next to the page. The browser does not call a CDN.

## Quick start

1. Download the runtime and both models once:

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
| `models/Qwen3-0.6B-Q4_K_M.gguf` | Default chat model, Qwen3 0.6B Q4 (~378 MB) |
| `models/minimind-3.q8.gguf` | MiniMind-3 64M Q8 (~65 MB) |

`fetch_assets.py` gets the Qwen file from [unsloth/Qwen3-0.6B-GGUF](https://huggingface.co/unsloth/Qwen3-0.6B-GGUF) and MiniMind-3 from [jingyaogong/minimind-3-gguf](https://huggingface.co/jingyaogong/minimind-3-gguf). Commit `vendor/`. Do not commit the GGUFs. Upload both folders together when you deploy.

Context is fixed at 2048 tokens so the page does not allocate the models' full training cache.

## Chat

- Tokens stream into the reply. Send becomes Stop while a reply is running.
- Stop keeps a partial reply. A failed reply does not leave a dangling user turn.
- Settings cover max tokens, temperature, repeat penalty, a system prompt, and Thinking.
- The default system prompt is: "You are a helpful assistant. Answer clearly, stay accurate, and say when you are unsure."
- Thinking opens the model's think channel (`enable_thinking` on Qwen3, `open_thinking` on MiniMind-3). It is off by default. The system prompt does not open that channel.
- Clear starts a new transcript with the current system prompt.

## Deploy

Upload this folder, including `vendor/` and `models/`, to any static host that can send the two headers above.
