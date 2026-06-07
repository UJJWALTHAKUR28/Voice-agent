# Jocasta — Neural Voice Intelligence

> A production-grade, real-time voice AI assistant built on LiveKit WebRTC, Deepgram, Cartesia, and GPT-4.1 Mini — with multi-provider fallback at every layer, live tool execution, and a rich React frontend.

<p align="center">
  <img alt="Jocasta" src="https://img.shields.io/badge/status-alpha-gold?style=flat-square&color=c8922a" />
  <img alt="Python" src="https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" />
  <img alt="LiveKit" src="https://img.shields.io/badge/LiveKit-1.5-00bfff?style=flat-square" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
</p>

---

## Table of Contents

1. [What Is Jocasta?](#what-is-jocasta)
2. [Architecture Overview](#architecture-overview)
3. [Pipeline: Five Layers, Three Fallbacks](#pipeline)
4. [Project Structure](#project-structure)
5. [Prerequisites](#prerequisites)
6. [Local Setup — Backend](#local-setup--backend)
7. [Local Setup — Frontend](#local-setup--frontend)
8. [Environment Variables Reference](#environment-variables-reference)
9. [Running in Development](#running-in-development)
10. [Running in Production](#running-in-production)
11. [Tool System](#tool-system)
12. [Known Limitations](#known-limitations)
13. [What I'd Improve With More Time](#what-id-improve-with-more-time)
14. [Key Technical Decisions](#key-technical-decisions)

---

## What Is Jocasta?

Jocasta is an always-on, low-latency voice AI assistant that runs in the browser. Unlike push-to-talk bots, Jocasta maintains a persistent WebRTC audio session — Silero VAD detects when you speak, Deepgram Nova-3 transcribes in real-time, GPT-4.1 Mini reasons and calls live tools (weather, news, math), and Cartesia Sonic-3 streams synthesised speech back within ~500ms end-to-end.

**What makes it different:**
- **Multi-provider fallback** — every layer (STT, LLM, TTS) has 2-3 failover providers; no single point of failure
- **Live tool execution mid-conversation** — weather cards, calculator results, and news summaries appear as animated UI cards while the agent speaks
- **Pre-warmed ML models** — Silero VAD and the MultilingualModel turn detector load at worker startup, not at first session (eliminates 2–4 minute cold-start delays)
- **Interruption handling** — adaptive interruption detection resumes false interruptions; card deduplication prevents duplicate UI cards when the agent restarts after being interrupted

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (Next.js)                           │
│                                                                     │
│   VoiceAgent.tsx ──► LiveKitRoom ──► WebRTC audio/data channel     │
│        │                                                            │
│   hooks/useAgentEvents  ←── agent-event DataPackets                │
│   ClientToolHandler     ←── client-tool DataPackets                │
│   CardOverlay           ←── animated weather / calc cards          │
└──────────────────────────────────────┬──────────────────────────────┘
                                       │  WebRTC (DTLS-SRTP)
                                       │  LiveKit Cloud
                                       │
┌──────────────────────────────────────▼──────────────────────────────┐
│                       Python Agent (LiveKit Agents v1.5)            │
│                                                                     │
│  main.py ──► AgentServer ──► voice_agent_session()                 │
│                                    │                               │
│              ┌─────────────────────▼───────────────────────┐       │
│              │           pipeline.py / AgentSession         │       │
│              │                                             │       │
│  VAD         │  Silero (ONNX, local CPU, pre-warmed)       │       │
│  Turn detect │  MultilingualModel (pre-warmed at startup)  │       │
│              │                                             │       │
│  STT chain   │  lk/deepgram/nova-3                         │       │
│              │    └─► lk/deepgram/flux-general-en          │       │
│              │          └─► lk/cartesia/ink-whisper        │       │
│              │                └─► deepgram plugin direct   │       │
│              │                                             │       │
│  LLM chain   │  lk/openai/gpt-4.1-mini  (6s timeout)      │       │
│              │    └─► groq/llama-3.3-70b-versatile          │       │
│              │          └─► groq/llama-3.1-8b-instant       │       │
│              │                                             │       │
│  TTS chain   │  lk/cartesia/sonic-3                        │       │
│              │    └─► lk/cartesia/sonic-turbo              │       │
│              │          └─► lk/deepgram/aura-2             │       │
│              │                └─► cartesia plugin direct   │       │
│              └─────────────────────────────────────────────┘       │
│                                                                     │
│  Tools:  get_weather  get_news  calculate  send_frontend_action     │
└─────────────────────────────────────────────────────────────────────┘
```

### Data flow

```
User speaks
  └─► Silero VAD detects speech onset
        └─► Deepgram Nova-3 transcribes (streaming)
              └─► MultilingualModel predicts turn end
                    └─► GPT-4.1 Mini generates reply + tool calls
                          ├─► Tool results pushed to frontend (DataPacket, topic="client-tool")
                          └─► Cartesia Sonic-3 synthesises speech
                                └─► Audio streamed back over WebRTC
                                      └─► Browser plays + transcript published (topic="agent-event")
```

---

## Pipeline

| Layer | Primary | Fallback 1 | Fallback 2 | Last Resort |
|-------|---------|-----------|-----------|-------------|
| **STT** | lk / deepgram nova-3 | lk / deepgram flux-general-en | lk / cartesia ink-whisper | deepgram plugin (direct key) |
| **LLM** | lk / openai gpt-4.1-mini | groq llama-3.3-70b-versatile | groq llama-3.1-8b-instant | — |
| **TTS** | lk / cartesia sonic-3 | lk / cartesia sonic-turbo | lk / deepgram aura-2 | cartesia plugin (direct key) |
| **VAD** | Silero (local ONNX) | — | — | — |
| **Turn** | MultilingualModel (ML) | Endpointing fallback (0.3–2.5s) | — | — |

All LLM fallbacks use a **6-second attempt timeout** so voice latency stays predictable even when primary providers are slow. Provider switches are logged but not surfaced to the user.

---

## Project Structure

```
.
├── voiceBackend/                  # Python LiveKit agent
│   ├── main.py                    # Entry point, AgentServer, pre-warm
│   ├── agent/
│   │   ├── pipeline.py            # STT / LLM / TTS / VAD wiring
│   │   ├── apiHealth.py           # Startup API key health checks
│   │   ├── prompts/
│   │   │   └── system_prompt.txt  # Jocasta personality + tool guidance
│   │   ├── tools/
│   │   │   ├── server_tools.py    # get_weather, get_news, calculate
│   │   │   └── client_tool_handler.py  # send_frontend_action
│   │   └── tts/
│   │       └── cartesia_tts.py    # Custom WebSocket TTS plugin
│   ├── config/
│   │   └── settings.py            # pydantic-settings, all env vars
│   ├── utils/
│   │   └── logging.py             # structlog JSON / console logging
│   └── requirements.txt
│
└── voicefrontend/                 # Next.js 16 frontend
    ├── app/
    │   ├── layout.tsx             # Root layout, theme init, Navbar
    │   ├── page.tsx               # Landing page (JARVIS sphere)
    │   ├── chat/page.tsx          # Chat page wrapper
    │   ├── globals.css            # CSS variables, dark/light themes
    │   └── api/token/route.ts     # LiveKit JWT + RoomAgentDispatch
    ├── components/
    │   ├── VoiceAgent.tsx         # Main session component
    │   ├── Navbar.tsx             # Navigation bar
    │   ├── ClientToolHandler.tsx  # Handles client-tool DataPackets
    │   ├── ChatTranscript.tsx     # Conversation transcript
    │   ├── StatusIndicator.tsx    # Agent state display
    │   ├── TextInput.tsx          # Typed message input
    │   └── Themetoast.tsx         # Toast notification system
    ├── hooks/
    │   ├── useAgentEvents.tsx     # LiveKit DataPacket event subscription
    │   ├── useTranscript.tsx      # Transcript state + deduplication
    │   └── useTextInput.tsx       # Text → DataPacket publisher
    ├── utils/
    │   └── theme.ts               # Dark/light theme manager
    └── package.json
```

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.11+ | 3.12 recommended |
| Node.js | 20+ | LTS |
| npm / yarn | any | |
| LiveKit Cloud account | — | Free tier sufficient for dev |
| Deepgram account | — | Free $200 credit on signup |
| Cartesia account | — | Free tier: 100k chars/month |
| Groq account | — | Free tier: generous rate limits |
| OpenWeatherMap account | — | Free tier: 1000 calls/day |
| NewsAPI account | — | Free tier: 100 calls/day |

**Note:** GPT-4.1 Mini is accessed via LiveKit Inference (you need a LiveKit Cloud project with inference enabled). The Groq fallback works without this.

---

## Local Setup — Backend

### 1. Clone and enter the backend directory

```bash
git clone <repo-url>
cd voiceBackend
```

### 2. Create a virtual environment

```bash
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

This installs:
- `livekit-agents[deepgram,cartesia,silero,turn-detector,groq,openai]` — the core agent framework with all plugins
- `httpx`, `tenacity` — async HTTP with retry logic for tool calls
- `pydantic-settings` — typed, validated configuration
- `structlog` — structured JSON logging

### 4. Create `.env`

Copy the template and fill in your keys:

```bash
cp .env.example .env   # or create from scratch:
```

```env
# LiveKit — get from console.livekit.io
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# LLM — primary via LiveKit Inference, fallbacks via Groq
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GROQ_MODEL=llama-3.3-70b-versatile

# STT — Deepgram
DEEPGRAM_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# TTS — Cartesia
CARTESIA_API_KEY=sk-car-xxxxxxxxxxxxxxxxxxxxxxxxxxxx
CARTESIA_VOICE_ID=694f9389-aac1-45b6-b726-9d9369183238

# Tools
OPENWEATHER_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NEWS_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 5. Verify API keys

```bash
python -c "import asyncio; from agent.apiHealth import check_all_keys; asyncio.run(check_all_keys())"
```

You should see a table with ✅ for all required services.

---

## Local Setup — Frontend

### 1. Enter the frontend directory

```bash
cd ../voicefrontend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create `.env.local`

```env
# Must match the backend .env exactly
LIVEKIT_API_KEY=APIxxxxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
```

**Critical:** The `NEXT_PUBLIC_LIVEKIT_URL` value must be the same WebSocket URL as `LIVEKIT_URL` in the backend `.env`. The agent name in `api/token/route.ts` (`AGENT_NAME = 'voice-agent'`) must match the agent name registered in `main.py`.

---

## Environment Variables Reference

### Backend (`voiceBackend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LIVEKIT_URL` | ✅ | — | LiveKit server WebSocket URL (`wss://...`) |
| `LIVEKIT_API_KEY` | ✅ | — | LiveKit API key |
| `LIVEKIT_API_SECRET` | ✅ | — | LiveKit API secret |
| `GROQ_API_KEY` | ✅ | — | Groq API key (LLM fallback) |
| `GROQ_MODEL` | ❌ | `llama-3.3-70b-versatile` | Groq model for first fallback |
| `DEEPGRAM_API_KEY` | ✅ | — | Deepgram API key (STT) |
| `DEEPGRAM_MODEL` | ❌ | `nova-3` | Deepgram STT model |
| `CARTESIA_API_KEY` | ✅ | — | Cartesia API key (TTS) |
| `CARTESIA_MODEL` | ❌ | `sonic-2` | Cartesia TTS model |
| `CARTESIA_VOICE_ID` | ❌ | Helpful Woman | Cartesia voice UUID |
| `CARTESIA_SAMPLE_RATE` | ❌ | `24000` | PCM sample rate (8000–48000) |
| `OPENWEATHER_API_KEY` | ✅ | — | OpenWeatherMap API key |
| `NEWS_API_KEY` | ✅ | — | NewsAPI.org API key |
| `LOG_LEVEL` | ❌ | `INFO` | `DEBUG` / `INFO` / `WARNING` / `ERROR` |
| `AGENT_NAME` | ❌ | `Jocasta` | Display name in logs |

### Frontend (`voicefrontend/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `LIVEKIT_API_KEY` | ✅ | Same as backend |
| `LIVEKIT_API_SECRET` | ✅ | Same as backend |
| `NEXT_PUBLIC_LIVEKIT_URL` | ✅ | LiveKit server URL (exposed to browser) |

---

## Running in Development

**Terminal 1 — Backend agent:**

```bash
cd voiceBackend
source .venv/bin/activate
python main.py dev
```

The `dev` subcommand starts the agent in development mode — it auto-creates rooms and connects immediately. You'll see:

```
┌──────────────────────────────────────────────────────┐
│  API Key Health Check                                │
├──────────────┬──────────────┬──────────────────────┤
│  livekit     │  ✅ ok       │                      │
│  groq        │  ✅ ok       │                      │
│  deepgram    │  ✅ ok       │                      │
│  cartesia    │  ✅ ok       │                      │
│  openweather │  ✅ ok       │                      │
│  newsapi     │  ✅ ok       │                      │
└──────────────┴──────────────┴──────────────────────┘
  ✅  All required API keys OK

pre-warming inference models...
  ✓ MultilingualModel loaded (12.3s)
  ✓ Silero VAD loaded (13.1s)
pre-warm complete — total 13.1s
```

**Terminal 2 — Frontend:**

```bash
cd voicefrontend
npm run dev
```

Open `http://localhost:3000`. Click **Begin Voice Session** — the page will request microphone permission and connect.

**Console mode (no browser needed):**

```bash
python main.py console
```

Type text directly in the terminal to interact with the agent.

---

## Running in Production

### Backend

```bash
# In voiceBackend/
python main.py start
```

For production deployments, wrap in a process manager:

```bash
# With gunicorn-style workers:
python main.py start --num-idle-processes 2

# With systemd:
[Unit]
Description=Jocasta Voice Agent
After=network.target

[Service]
WorkingDirectory=/opt/jocasta/voiceBackend
ExecStart=/opt/jocasta/.venv/bin/python main.py start
Restart=always
EnvironmentFile=/opt/jocasta/voiceBackend/.env

[Install]
WantedBy=multi-user.target
```

### Frontend

```bash
cd voicefrontend
npm run build
npm run start      # or deploy to Vercel / Netlify
```

The frontend is a standard Next.js 16 app — deploy to any platform that supports Node.js serverless functions (needed for the `/api/token` JWT route).

**Vercel (recommended):**
```bash
vercel --prod
# Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, NEXT_PUBLIC_LIVEKIT_URL in Vercel dashboard
```

---

## Tool System

Jocasta has four tools available at runtime:

### Server-side tools (Python, execute on backend)

#### `get_weather(city: str)`
Calls OpenWeatherMap `/data/2.5/weather`. Returns temperature (C/F), feels-like, humidity, wind speed, visibility, and a weather emoji. Automatically pushes a `weather_card` DataPacket to the frontend — the card appears as an animated overlay without the agent needing to call `send_frontend_action`.

```python
# Example result
{
  "city": "London, GB",
  "temperature_c": 14.2,
  "temperature_f": 57.6,
  "feels_like_c": 12.8,
  "description": "light rain",
  "humidity_pct": 78,
  "wind_kmh": 18.4,
  "visibility_km": 9.0,
  "weather_emoji": "🌧"
}
```

**Error handling:** 2-retry with 0.3s wait on transport errors; returns `{"error": "..."}` on 404 (city not found) or timeout.

#### `get_news(topic: str, count: int)`
Calls NewsAPI.org `/v2/everything`. Filters out `[Removed]` articles. Returns up to 5 headlines with source and URL.

**Note:** Free tier is limited to 100 requests/day and articles older than 30 days. The agent is prompted to summarise naturally rather than reading headlines verbatim.

#### `calculate(expression: str)`
Safe AST-based math evaluator — **never uses `eval()`**. Parses the expression into an AST, then recursively evaluates only whitelisted node types (arithmetic operators, `sqrt`, `sin`, `cos`, `tan`, `log`, `ln`, `abs`, `ceil`, `floor`, `round`, `pi`, `e`). Automatically pushes a `calculator_card` to the frontend.

```python
# Supports:
calculate("sqrt(144) + 2**8")    # → 268
calculate("sin(pi/2)")            # → 1.0
calculate("1024 / 32")            # → 32
calculate("15% of 340")           # LLM translates to → 340 * 0.15
```

### Client-side tools (execute in browser via DataPacket)

#### `send_frontend_action(action_type, payload)`
Sends a JSON DataPacket on topic `client-tool` to the browser. Supported actions:

| `action_type` | Effect | Payload |
|--------------|--------|---------|
| `change_theme` | Toggle dark/light mode | `{"theme": "dark"}` |
| `show_notification` | Toast notification | `{"title": "...", "message": "...", "type": "info"}` |
| `open_url` | Open URL in new tab | `{"url": "https://..."}` |
| `play_sound` | Synthesised audio cue | `{"sound": "notification"}` |
| `weather_card` | Animated weather card | Full weather result JSON |
| `calculator_card` | Animated calc result | `{"expression": "...", "result": 42, "formatted": "42"}` |

**Note:** `weather_card` and `calculator_card` are sent automatically by the server tools — the agent doesn't need to call `send_frontend_action` for these.

---

## Known Limitations

### 1. LiveKit Inference dependency
The primary STT/LLM/TTS providers (`lk_inference.*`) require a LiveKit Cloud project with inference enabled. Without it, the pipeline falls back to Groq LLaMA + direct Deepgram/Cartesia plugins, which works fine but loses the unified fallback chain.

### 2. NewsAPI free tier restrictions
The free NewsAPI tier only serves articles up to 30 days old and limits to 100 requests/day. "What happened today?" will often return nothing or stale results. Upgrading to a paid plan or replacing with a different news source (e.g., GDELT, The Guardian API) is the fix.

### 3. No conversation memory between sessions
Each session starts fresh — there is no persistent memory, user history, or cross-session context. The agent only remembers what happened in the current WebRTC room session.

### 4. Single-participant design
The current token route creates a room per user and dispatches one agent per room. Multi-participant rooms (e.g., a call with two humans and one agent) are not supported.

### 5. Cartesia custom TTS plugin not used in primary path
`agent/tts/cartesia_tts.py` implements a custom WebSocket TTS client, but the primary pipeline uses the official `livekit-plugins-cartesia` plugin via LiveKit Inference. The custom implementation is available as a fallback but isn't wired into the default FallbackAdapter.

### 6. Tool parameter schema with Groq (resolved)
Earlier versions had an issue where optional tool parameters (e.g., `count: int = 3`) caused Groq to output raw `<function=...>` text instead of calling the tool. This was fixed by making all tool parameters required and guiding the LLM via docstrings. **Do not re-introduce default values in `@function_tool` signatures when using Groq.**

### 7. Card duplication on interruption (partially mitigated)
When the user interrupts the agent mid-speech, the LLM may restart and re-call the same tool, sending a duplicate `weather_card` or `calculator_card` DataPacket. The frontend `ClientToolHandler` now deduplicates cards within a 60-second window using a stable key (city name + minute-window for weather, expression + minute-window for calculator). This covers the common case but won't catch edge cases like asking for weather in two different cities within the same minute.

---

## What I'd Improve With More Time

### Short-term (1–2 weeks)

**1. Persistent conversation memory**
Integrate a lightweight vector store (e.g., Chroma, Qdrant) to maintain a rolling summary of past sessions per user identity. The agent could recall "last time you asked about X" for a much more personal experience.

**2. Streaming TTS word timing**
Cartesia's WebSocket API returns word-level timestamps. Wiring these into the frontend would allow the transcript to highlight words in sync with speech — significantly improving UX when reading along.

**3. Proper interruption recovery**
When the user interrupts, the agent currently may restart the same tool call. The fix is to track in-flight tool calls on the agent side and skip re-execution if the same call was recently completed.

**4. End-to-end latency measurement**
Add `performance.now()` instrumentation from "user stops speaking" to "first audio byte received" — exported as a Prometheus metric or logged to a dashboard. This is essential for tuning the pipeline.

**5. Mobile PWA**
The frontend is desktop-optimised. A responsive mobile layout + PWA manifest + service worker would make Jocasta useful on phones (where voice UX is most natural).

### Medium-term (1 month)

**6. Replace NewsAPI with a reliable source**
NewsAPI's free tier is too limited for production. The Guardian API, GDELT, or a self-hosted RSS aggregator would provide better coverage without rate limits.

**7. Voice activity visualisation**
Show a real-time audio waveform (using the Web Audio API's `AnalyserNode`) so users know the microphone is picking up their voice. Currently the orb animation is not tied to actual audio levels.

**8. Multi-agent rooms**
Support rooms with multiple participants where Jocasta facilitates or takes notes. Would require changes to the token route and session logic.

**9. Tool plugin architecture**
Abstract `server_tools.py` into a plugin system so new tools can be added without touching the core pipeline. A YAML config defining tool metadata + a Python file per tool would be the right structure.

**10. Test suite**
The project has no automated tests. Priority areas: tool evaluation (does `calculate` handle edge cases?), integration tests for the WebRTC session setup, and E2E tests using LiveKit's local testing mode.

### Architectural improvements

**11. Replace custom Cartesia TTS plugin**
The `cartesia_tts.py` custom implementation predates the official plugin. It should be removed and consolidated with the official `livekit-plugins-cartesia` plugin to reduce maintenance surface.

**12. Edge deployment for the agent**
The Python agent runs as a single process. For scale, LiveKit supports deploying agents as stateless workers via their cloud dispatch system. Each room gets its own worker process — this design already exists but the Docker image, CI/CD pipeline, and horizontal scaling config are missing.

**13. Graceful key rotation**
API keys are read at startup. A secrets manager integration (Vault, AWS Secrets Manager, or GCP Secret Manager) with live rotation and re-injection without restarts would be production-critical.

---

## Key Technical Decisions

### Why LiveKit?
LiveKit handles the hard parts of real-time audio: WebRTC signalling, DTLS-SRTP encryption, adaptive bitrate, and NAT traversal. The Python Agents SDK provides a clean pipeline abstraction that wires STT → LLM → TTS with fallback adapters. The alternative (building raw WebRTC in Python) would have taken weeks.

### Why Deepgram Nova-3 for STT?
Nova-3 has the best word error rate for conversational English at ~200ms latency, and its streaming API works well with LiveKit's inference proxy. Whisper-based models (faster-whisper, whisperX) have lower WER on clean audio but higher latency and require GPU for real-time use.

### Why Cartesia for TTS?
Cartesia Sonic-3 achieves ~80ms time-to-first-byte on their streaming WebSocket API — fast enough that there's no audible gap between the LLM finishing and speech starting. ElevenLabs is higher quality but ~3× the cost and ~200ms TTFB. Kokoro is free but requires local GPU.

### Why GPT-4.1 Mini as primary LLM?
It has a 1M-token context window (large enough for any conversation history), strong function-calling reliability, and very low latency (~300ms for a typical voice reply). The Groq LLaMA fallback covers the (common) case of rate limits.

### Why pre-warming?
Without pre-warming, the first caller in each worker process would wait 2–4 minutes for `MultilingualModel` and Silero VAD to load from disk. Pre-warming at `_prewarm()` (called once per worker at startup, not per session) moves this wait to before any user connects.

### Why `@function_tool` parameters must be required (not optional)?
`livekit-agents` serialises tool schemas to OpenAI-compatible JSON. Optional parameters produce `"type": ["integer", "null"]` (union types). Groq's LLaMA models silently reject this schema and output raw text instead of calling the tool. Making all parameters required — and guiding the LLM via docstrings on what values to supply — is the stable fix.

### Why AST-based calculator instead of `eval()`?
`eval()` executes arbitrary Python, creating a code execution vulnerability if the LLM ever passes a non-mathematical expression (intentionally or through prompt injection). The AST evaluator whitelists exactly the node types and functions we want to support and raises `ValueError` on anything outside the whitelist.

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Credits

Built with:
- [LiveKit Agents](https://docs.livekit.io/agents/) — real-time voice pipeline
- [Deepgram](https://deepgram.com) — speech-to-text
- [Cartesia](https://cartesia.ai) — text-to-speech
- [Groq](https://groq.com) — LLaMA inference
- [OpenWeatherMap](https://openweathermap.org/api) — weather data
- [NewsAPI](https://newsapi.org) — news headlines
- [Next.js](https://nextjs.org) — React framework
- [Motion](https://motion.dev) — animations
