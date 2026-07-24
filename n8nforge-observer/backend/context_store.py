"""
In-memory RAM context store. One entry per active task.
Cleared on success or manual resolution. No database.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


class StepInfo(BaseModel):
    name: str
    agent: str
    status: str = "pending"  # pending | running | done | failed
    output: str = ""
    tokens: int = 0
    latency_ms: float = 0


class FixAttempt(BaseModel):
    attempt: int
    strategy: str
    action: str
    result: str = "pending"  # pending | success | fail
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class TaskContext(BaseModel):
    task_id: str
    prompt: str
    mode: str = "automatic"  # automatic | manual
    steps: list[StepInfo] = Field(default_factory=list)
    retry_count: int = 0
    fix_history: list[FixAttempt] = Field(default_factory=list)
    final_output: str = ""
    total_tokens: int = 0
    status: str = "running"  # running | success | manual_mode | error
    error: str = ""
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ContextStore:
    def __init__(self):
        self._store: dict[str, TaskContext] = {}
        self._lock = asyncio.Lock()

    async def create(self, task_id: str, prompt: str) -> TaskContext:
        ctx = TaskContext(task_id=task_id, prompt=prompt)
        async with self._lock:
            self._store[task_id] = ctx
        return ctx

    async def get(self, task_id: str) -> TaskContext | None:
        return self._store.get(task_id)

    async def update(self, task_id: str, **kwargs) -> None:
        async with self._lock:
            ctx = self._store.get(task_id)
            if ctx:
                for k, v in kwargs.items():
                    setattr(ctx, k, v)

    async def add_step(self, task_id: str, step: StepInfo) -> None:
        async with self._lock:
            ctx = self._store.get(task_id)
            if ctx:
                ctx.steps.append(step)

    async def update_step(self, task_id: str, step_name: str, **kwargs) -> None:
        async with self._lock:
            ctx = self._store.get(task_id)
            if ctx:
                for s in ctx.steps:
                    if s.name == step_name:
                        for k, v in kwargs.items():
                            setattr(s, k, v)
                        break

    async def add_fix(self, task_id: str, fix: FixAttempt) -> None:
        async with self._lock:
            ctx = self._store.get(task_id)
            if ctx:
                ctx.fix_history.append(fix)
                if fix.strategy != "manual":
                    ctx.retry_count += 1

    async def clear(self, task_id: str) -> TaskContext | None:
        async with self._lock:
            return self._store.pop(task_id, None)

    async def list_active(self) -> list[str]:
        return list(self._store.keys())

    async def snapshot(self, task_id: str) -> dict[str, Any] | None:
        ctx = self._store.get(task_id)
        return ctx.model_dump() if ctx else None


store = ContextStore()


def new_task_id() -> str:
    return f"task_{uuid4().hex[:12]}"
