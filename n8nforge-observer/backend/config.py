from __future__ import annotations
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # LLM — Groq (OpenAI-compatible)
    llm_api_key: str = ""
    llm_base_url: str = "https://api.groq.com/openai/v1"
    llm_model: str = "llama-3.3-70b-versatile"
    llm_temperature: float = 0.3

    # Copilot
    max_auto_fix_attempts: int = 2
    semantic_score_threshold: float = 0.6

    # Server
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000

    # SigNoz / OpenTelemetry
    otel_exporter_otlp_endpoint: str = "http://localhost:4318"
    signoz_query_url: str = "http://localhost:3301"  # SigNoz Query Service (mapped port)
    service_name: str = "signozforge-observer"


settings = Settings()
