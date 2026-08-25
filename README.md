# audio.cpp Studio

Self-contained Electron studio for **audio.cpp** — TTS, voice cloning, music generation & ASR. Pure dark, sleek UI. No Python, no Docker.

![License](https://img.shields.io/badge/license-MIT-black) ![Electron](https://img.shields.io/badge/Electron-30-black) ![ggml](https://img.shields.io/badge/powered_by-ggml-black)

> Built on [0xShug0/audio.cpp](https://github.com/0xShug0/audio.cpp) — pure C++ inference via `ggml`, CUDA / Metal / Vulkan / CPU.

## Features
- **TTS** — natural speech, voice cloning (drop a 10–30s wav), long-form split & merge, language presets
- **Music** — text-to-song (ACE-Step, Stable Audio, MiniMax Music 3) with lyrics
- **ASR** — transcribe any audio (Qwen3-ASR, Parakeet, Whisper-style VAD chunking)
- **Model Manager** — curated 25+ GGUF models, searchable, install/remove, `From URL` (HF)
- **Self-contained data folder** — choose where `models/ backend/ outputs/ voices/` live (external drive OK)
- **Backend manager** — import `audio.cpp` ZIP or **download directly from GitHub Releases** inside the app (updates existing `backend/current`)
- **Dark sleek UI** — pure dark `#050507`, searchable model picker, aesthetic clone dropzone

## Quick Start
```powershell
# 1. Install deps
npm install

# 2. Dev (Vite + Electron with HMR)
npx vite --port 5173          # terminal 1
npx electron . --no-sandbox   # terminal 2

# 3. Prod build
npm run build:main
npm run build:renderer
$env:NODE_ENV="production"; npx electron . --no-sandbox
```

## Backend
- **Import ZIP**: Settings → `📦 Import ZIP` (pick a release ZIP from https://github.com/0xShug0/audio.cpp/releases — must contain `audiocpp_cli` / `audiocpp_server`)
- **GitHub fetch**: Settings → `↻ Fetch releases` → list ZIP assets → `Download` (first install) or `Update →` (overwrites `backend/<version>` + `current`). Progress shown, auto-imported.
- Verify: `Test --help` runs `audiocpp_cli --help`

Binary discovery: `audiocpp_cli{.exe}`, `audiocpp_server{.exe}` (also `bin/` or one subdir deep).

## Data Folder
Default: `Documents/audio.cpp Studio`. Change in sidebar or Settings. Subfolders auto-created:
```
models/   # GGUFs per model id
backend/  # backend/<version> + current + _downloads/
outputs/  # generated wav/txt
voices/   # reference wavs
```

## Model Manager
Downloads to `models/<id>/`. Drop a `.gguf` manually and hit Refresh. Real HF example:
```
https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/main/pocket_tts/pocket_tts_q8.gguf
```

## Tech
- Electron 30 + Vite 5 + React 18 + TypeScript
- `adm-zip` for backend ZIP import, Node `https` for GitHub API / downloads
- IPC via `preload` (`window.api`)

## Build Release
```powershell
npm run build
npm run dist   # electron-builder → release/
```

## License
MIT — see `LICENSE` (add your own if needed).
