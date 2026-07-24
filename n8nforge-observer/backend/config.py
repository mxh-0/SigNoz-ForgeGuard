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


settings = Settings()
