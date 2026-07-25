# n8nForge Observer — Deployment Guide

## Quick Start (Local Development)

### Prerequisites
- Python 3.11+
- Node.js 18+
- Groq API key ([get one free](https://console.groq.com))

### 1. Backend
```bash
cd n8nforge-observer

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set up environment
cp .env.example .env
# Edit .env and add your LLM_API_KEY

# Run backend
python -m uvicorn backend.main:app --reload --port 8000
```

### 2. Frontend
```bash
cd frontend

# Install dependencies
npm install

# Run dev server
npm run dev
```

Access:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000

---

## Docker Deployment

### Option A: Simple (App Only)
Runs just the backend and frontend — no SigNoz observability.

```bash
# Make sure .env has your LLM_API_KEY
docker compose -f docker-compose.simple.yml up -d --build
```

Access:
- Frontend: http://localhost:5173
- Backend: http://localhost:8000

### Option B: Full Stack (with SigNoz)
Includes complete observability with SigNoz.

```bash
# Make sure .env has your LLM_API_KEY
docker compose up -d --build
```

Access:
- Frontend: http://localhost:5173
- Backend: http://localhost:8000
- SigNoz Dashboard: http://localhost:3301

### Docker Commands
```bash
# View logs
docker compose logs -f backend
docker compose logs -f frontend

# Stop everything
docker compose down

# Stop and remove volumes (fresh start)
docker compose down -v

# Rebuild after code changes
docker compose up -d --build
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_API_KEY` | Yes | — | Groq API key |
| `LLM_BASE_URL` | No | `https://api.groq.com/openai/v1` | LLM API endpoint |
| `LLM_MODEL` | No | `llama-3.3-70b-versatile` | Model to use |
| `LLM_TEMPERATURE` | No | `0.2` | Response randomness |
| `BACKEND_HOST` | No | `0.0.0.0` | Backend bind address |
| `BACKEND_PORT` | No | `8000` | Backend port |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | — | SigNoz collector URL |

---

## SigNoz Integration

When running with the full Docker Compose:

1. **View Traces**: Open http://localhost:3301 → Traces
2. **Service Name**: `n8nforge-observer`
3. **What's Captured**:
   - All HTTP requests to the API
   - LLM calls to Groq
   - Agent execution spans

### Without Docker
To send traces to an external SigNoz:
```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.{region}.signoz.cloud:443
# Then run the backend
```

---

## Production Checklist

- [ ] Set a strong, unique `LLM_API_KEY`
- [ ] Consider rate limits (Groq free tier: 12k tokens/min)
- [ ] For high traffic: upgrade to Groq paid or switch to OpenAI
- [ ] Enable HTTPS (use a reverse proxy like Caddy or nginx)
- [ ] Set up proper CORS origins (currently allows all)
- [ ] Back up SigNoz data if using (ClickHouse volume)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Browser                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Frontend (React + Vite)                         │
│                  Served by nginx on :5173                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ /api/* proxy
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Backend (FastAPI) :8000                        │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Coordinator │→ │  Researcher  │→ │  Coder  │→  Reviewer   │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│                           ↓                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              SRE Copilot (2-strike healing)                │  │
│  │  Error/Low Score → Auto-fix (2x) → Manual Mode             │  │
│  └────────────────────────────────────────────────────────────┘  │
│                           ↓                                      │
│  ┌───────────────┐  ┌─────────────────────────────────────────┐  │
│  │ RAM Context   │  │  Groq LLM (llama-3.3-70b-versatile)     │  │
│  │ Store         │  │  Rate-limited async client              │  │
│  └───────────────┘  └─────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ (optional) OTLP
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SigNoz (Observability)                        │
│  OTel Collector → ClickHouse → Query Service → Dashboard :3301  │
└─────────────────────────────────────────────────────────────────┘
```
