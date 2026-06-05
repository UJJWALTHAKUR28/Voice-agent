"""
utils/logging.py
────────────────
Structured JSON logging for the Voice AI Agent.

Uses structlog for machine-readable, context-rich logs that are easy to
grep, ship to a log aggregator, or tail locally in dev mode.

In development (LOG_LEVEL=DEBUG), output is colorised console format.
In production (LOG_LEVEL=INFO+), output is compact JSON per line.

Usage:
    from utils.logging import get_logger, configure_logging

    configure_logging()                    # Call once at startup (main.py)
    logger = get_logger(__name__)
    logger.info("tool.called", tool="get_weather", city="London")
    logger.error("pipeline.error", error=str(exc))
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog


def minimal_exception_formatter(sio: Any, exc_info: Any) -> None:
    """One-line exception summary — no traceback in dev output."""
    if exc_info and len(exc_info) >= 2 and exc_info[0] and exc_info[1]:
        sio.write(f" [{exc_info[0].__name__}: {exc_info[1]}]")


def configure_logging(level: str = "INFO") -> None:
    """
    Set up structlog + stdlib logging.

    Call this ONCE at the very start of main.py before anything else.

    Args:
        level: Log level string — "DEBUG", "INFO", "WARNING", "ERROR"
    """
    log_level = getattr(logging, level.upper(), logging.INFO)

    # Shared processors for all log entries
    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]

    is_dev = level.upper() == "DEBUG"

    if is_dev:
        # Human-readable coloured output for local development
        # Use a minimal exception formatter to avoid massive tracebacks in dev
        renderer = structlog.dev.ConsoleRenderer(
            colors=True,
            exception_formatter=minimal_exception_formatter,
        )
    else:
        # Compact JSON for production / log aggregators
        renderer = structlog.processors.JSONRenderer()

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(log_level)

    # Quiet down noisy libraries
    for noisy in ("httpx", "httpcore", "asyncio", "websockets"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    # Keep livekit logs at INFO unless we're in debug
    lk_level = logging.DEBUG if is_dev else logging.INFO
    logging.getLogger("livekit").setLevel(lk_level)


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """
    Return a structlog logger bound to the given module name.

    Args:
        name: Typically __name__ of the calling module.

    Returns:
        A structlog BoundLogger with key=value style logging.

    Example:
        logger = get_logger(__name__)
        logger.info("agent.started", room="my-room", agent="Jocasta")
    """
    return structlog.get_logger(name)