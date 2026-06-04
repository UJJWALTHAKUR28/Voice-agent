"""
tools/server_tools.py
─────────────────────
Server-side tool implementations for the Voice AI Agent.

FIX APPLIED (livekit-agents v1.5.x + Groq llama-3.3-70b):
  ► All tool parameters are REQUIRED (no defaults).
  ► Root cause: optional params (e.g. count: int = 3) cause livekit-agents
    to emit "type": ["integer", "null"] in strict OpenAI schema mode.
    Groq silently rejects this and outputs raw "<function=...>" text instead
    of actually invoking the tool.
  ► Fix: remove all default values from @function_tool signatures.
    The LLM is guided via docstring to always supply a value.

Tools:
  1. get_weather(city)             → OpenWeatherMap current conditions
  2. get_news(topic, count)        → NewsAPI.org latest headlines
  3. calculate(expression)         → Safe AST math evaluator (no eval())

API keys are read from settings (pydantic-settings / .env):
  OPENWEATHER_API_KEY  — free tier sufficient
  NEWS_API_KEY         — free tier: 100 req/day (newsapi.org)

HTTP client is module-level (eager init) — no cold-start penalty.
Call close_http_client() on agent shutdown to drain the connection pool.
"""

from __future__ import annotations

import ast
import asyncio
import math
import operator
from typing import Any

import httpx
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_fixed,
)

from livekit.agents import RunContext, function_tool

from config.settings import get_settings
from utils.logging import get_logger

logger = get_logger(__name__)

# Hard cap for every external HTTP call — keeps voice latency predictable
TOOL_TIMEOUT = 5.0  # seconds

# Eager init — shared across all tool calls, no per-call setup cost
_http_client: httpx.AsyncClient = httpx.AsyncClient(
    timeout=httpx.Timeout(TOOL_TIMEOUT, connect=2.0),
    follow_redirects=True,
    headers={"User-Agent": "VoiceAIAgent/1.0"},
)


async def close_http_client() -> None:
    """Drain the shared HTTP connection pool. Call this on agent shutdown."""
    if not _http_client.is_closed:
        await _http_client.aclose()


# ─────────────────────────────────────────────────────────────────────────────
# Tool 1 — get_weather
# ─────────────────────────────────────────────────────────────────────────────

@function_tool()
async def get_weather(context: RunContext, city: str) -> dict[str, Any]:
    """
    Fetch current weather conditions for a city from OpenWeatherMap.

    Args:
        city: City name to get weather for, e.g. London, New York, Mumbai, Tokyo
    """
    settings = get_settings()

    if not city or not city.strip():
        return {"error": "No city name provided."}

    city = city.strip()
    logger.info("tool.get_weather", city=city)

    try:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(2),
            wait=wait_fixed(0.3),
            retry=retry_if_exception_type(httpx.TransportError),
            reraise=True,
        ):
            with attempt:
                resp = await asyncio.wait_for(
                    _http_client.get(
                        "https://api.openweathermap.org/data/2.5/weather",
                        params={
                            "q":     city,
                            "appid": settings.openweather_api_key,
                            "units": "metric",
                        },
                    ),
                    timeout=TOOL_TIMEOUT,
                )

        if resp.status_code == 404:
            return {"error": f"City '{city}' not found. Please check the spelling."}

        resp.raise_for_status()
        data = resp.json()

        temp_c       = round(data["main"]["temp"],       1)
        feels_like_c = round(data["main"]["feels_like"], 1)
        description  = data["weather"][0]["description"]
        weather_id   = data["weather"][0]["id"]

        result = {
            "city":           f"{data['name']}, {data['sys']['country']}",
            "temperature_c":  temp_c,
            "temperature_f":  round(temp_c * 9 / 5 + 32, 1),
            "feels_like_c":   feels_like_c,
            "description":    description,
            "humidity_pct":   data["main"]["humidity"],
            "wind_kmh":       round(data["wind"].get("speed", 0) * 3.6, 1),
            "visibility_km":  round(data.get("visibility", 0) / 1000, 1),
            "weather_emoji":  _weather_emoji(weather_id),
        }

        logger.info("tool.get_weather.success", city=result["city"], temp=temp_c)
        return result

    except asyncio.TimeoutError:
        logger.warning("get_weather timeout city=%s", city)
        return {"error": "Weather service timed out. Try again in a moment."}
    except httpx.HTTPStatusError as exc:
        logger.warning("get_weather HTTP %s city=%s", exc.response.status_code, city)
        return {"error": f"Weather service error ({exc.response.status_code})."}
    except Exception as exc:
        logger.error("get_weather failed city=%s: %s", city, exc)
        return {"error": "Unable to fetch weather right now."}


def _weather_emoji(weather_id: int) -> str:
    if weather_id < 300:  return "⛈"
    if weather_id < 400:  return "🌧"
    if weather_id < 600:  return "🌧"
    if weather_id < 700:  return "❄️"
    if weather_id < 800:  return "🌫"
    if weather_id == 800: return "☀️"
    if weather_id == 801: return "🌤"
    if weather_id <= 804: return "☁️"
    return "🌡"


# ─────────────────────────────────────────────────────────────────────────────
# Tool 2 — get_news
#
# FIX: count parameter has NO default value.
# Previously `count: int = 3` caused livekit-agents strict schema builder to
# emit "type": ["integer", "null"] — Groq rejects this and outputs raw text.
# Now count is required; LLM is told to always pass 3 if the user doesn't specify.
# ─────────────────────────────────────────────────────────────────────────────

@function_tool()
async def get_news(context: RunContext, topic: str, count: int) -> dict[str, Any]:
    """
    Fetch the latest news headlines for a topic using NewsAPI.org.

    Args:
        topic: Topic to search for, e.g. Spider-Man, artificial intelligence, cricket, stock market
        count: Number of headlines to return, must be between 1 and 5, use 3 if the user did not specify
    """
    settings = get_settings()

    if not topic or not topic.strip():
        return {"error": "No news topic provided."}

    topic = topic.strip()
    count = max(1, min(5, count))   # clamp defensively — LLM might send out-of-range
    logger.info("tool.get_news", topic=topic, count=count)

    try:
        resp = await asyncio.wait_for(
            _http_client.get(
                "https://newsapi.org/v2/everything",
                params={
                    "q":        topic,
                    "apiKey":   settings.news_api_key,  # capital K — NewsAPI requirement
                    "language": "en",
                    "pageSize": count,                  # NewsAPI uses pageSize, not size
                    "sortBy":   "publishedAt",          # newest first
                },
            ),
            timeout=TOOL_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()

        # NewsAPI top-level status gate
        if data.get("status") != "ok":
            msg = data.get("message", "Unknown error")
            logger.warning("get_news API error topic=%s: %s", topic, msg)
            return {"error": f"News API error: {msg}"}

        articles = data.get("articles", [])
        if not articles:
            return {"error": f"No recent news found for '{topic}'."}

        headlines = []
        for article in articles[:count]:
            title = article.get("title", "")
            if not title or "[Removed]" in title:
                continue
            headlines.append({
                "title":  title,
                "source": article.get("source", {}).get("name", "Unknown"),
                "url":    article.get("url", ""),
            })

        if not headlines:
            return {"error": f"No readable news found for '{topic}'."}

        result = {"topic": topic, "headlines": headlines}
        logger.info("tool.get_news.success", topic=topic, count=len(headlines))
        return result

    except asyncio.TimeoutError:
        logger.warning("get_news timeout topic=%s", topic)
        return {"error": "News service timed out. Try again in a moment."}
    except httpx.HTTPStatusError as exc:
        logger.warning("get_news HTTP %s topic=%s", exc.response.status_code, topic)
        return {"error": f"News service error ({exc.response.status_code})."}
    except Exception as exc:
        logger.error("get_news failed topic=%s: %s", topic, exc)
        return {"error": "Unable to fetch news right now."}


# ─────────────────────────────────────────────────────────────────────────────
# Tool 3 — calculate
#
# Uses Python's AST module to safely parse and evaluate math expressions.
# Never calls eval() — only whitelisted operators and functions are allowed.
# ─────────────────────────────────────────────────────────────────────────────

_SAFE_OPERATORS: dict[type, Any] = {
    ast.Add:      operator.add,
    ast.Sub:      operator.sub,
    ast.Mult:     operator.mul,
    ast.Div:      operator.truediv,
    ast.Pow:      operator.pow,
    ast.Mod:      operator.mod,
    ast.FloorDiv: operator.floordiv,
    ast.USub:     operator.neg,
    ast.UAdd:     operator.pos,
}

_SAFE_FUNCTIONS: dict[str, Any] = {
    "sqrt":  math.sqrt,
    "sin":   math.sin,
    "cos":   math.cos,
    "tan":   math.tan,
    "log":   math.log10,
    "ln":    math.log,
    "abs":   abs,
    "ceil":  math.ceil,
    "floor": math.floor,
    "round": round,
    "pi":    math.pi,
    "e":     math.e,
}


def _safe_eval(node: ast.AST) -> float:
    """Recursively evaluate a whitelisted AST node."""
    # Numeric literal
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    # Python < 3.8 compatibility
    if isinstance(node, ast.Num):
        return float(node.n)  # type: ignore[attr-defined]
    # Named constant (pi, e)
    if isinstance(node, ast.Name):
        if node.id in _SAFE_FUNCTIONS:
            v = _SAFE_FUNCTIONS[node.id]
            if not callable(v):
                return float(v)
        raise ValueError(f"Unknown name: {node.id!r}")
    # Binary operation: a + b, a * b, etc.
    if isinstance(node, ast.BinOp):
        op = _SAFE_OPERATORS.get(type(node.op))
        if op is None:
            raise ValueError(f"Unsupported operator: {type(node.op).__name__}")
        return op(_safe_eval(node.left), _safe_eval(node.right))
    # Unary operation: -x, +x
    if isinstance(node, ast.UnaryOp):
        op = _SAFE_OPERATORS.get(type(node.op))
        if op is None:
            raise ValueError(f"Unsupported operator: {type(node.op).__name__}")
        return op(_safe_eval(node.operand))
    # Function call: sqrt(x), sin(x), etc.
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise ValueError("Only simple function calls are allowed.")
        func = _SAFE_FUNCTIONS.get(node.func.id)
        if func is None or not callable(func):
            raise ValueError(f"Unknown function: {node.func.id!r}")
        return func(*[_safe_eval(a) for a in node.args])
    raise ValueError(f"Unsupported expression node: {type(node).__name__}")


@function_tool()
async def calculate(context: RunContext, expression: str) -> dict[str, Any]:
    """
    Safely evaluate a mathematical expression without using eval.

    Supports arithmetic operators: + - * / ** % //
    Supports functions: sqrt, sin, cos, tan, log, ln, abs, ceil, floor, round
    Supports constants: pi, e
    Use ** for exponentiation, or ^ which is automatically converted.

    Args:
        expression: The math expression to evaluate, e.g. sqrt(144) + 2**8, sin(pi/2), 1024 / 32
    """
    if not expression or not expression.strip():
        return {"error": "No expression provided."}

    # Normalise: ^ → ** so users can write 2^8 naturally
    normalised = expression.strip().replace("^", "**")
    logger.info("tool.calculate", expression=normalised)

    try:
        tree   = ast.parse(normalised, mode="eval")
        result = _safe_eval(tree.body)

        # Format cleanly: integer if possible, scientific notation otherwise
        if result == int(result) and abs(result) < 1e15:
            formatted = str(int(result))
        else:
            formatted = f"{result:.6g}"

        logger.info("tool.calculate.success", result=formatted)
        return {
            "expression": normalised,
            "result":     result,
            "formatted":  formatted,
        }

    except ZeroDivisionError:
        return {"error": "Division by zero."}
    except ValueError as exc:
        return {"error": f"Invalid expression: {exc}"}
    except Exception as exc:
        logger.error("calculate failed expr=%s: %s", normalised, exc)
        return {"error": "Could not evaluate that expression."}