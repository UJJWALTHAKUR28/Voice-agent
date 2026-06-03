"""
tools/server_tools.py
─────────────────────
All server-side tool implementations for the Voice AI Agent.

These are Python functions that the LLM can call via LiveKit's function-calling
mechanism. They run inside the Python agent process and return structured results
that the LLM then converts into natural spoken language.

Design principles:
  - Every tool is an async function (agent event loop is asyncio)
  - Every tool has a 5-second timeout to prevent blocking the pipeline
  - Every tool returns a plain dict — the LLM formats it into speech
  - Errors are returned as {"error": "..."} — the LLM handles gracefully
  - No global state — tools are stateless and idempotent

Tools:
  1. get_weather(city)      → live weather from OpenWeatherMap
  2. search_wikipedia(query) → Wikipedia article summary
  3. get_news(topic)        → Top headlines from NewsAPI
  4. calculate(expression)  → Safe math expression evaluator
"""

from __future__ import annotations

import ast
import math
import operator
import asyncio
from typing import Any

import httpx
from tenacity import AsyncRetrying, stop_after_attempt, wait_fixed, retry_if_exception_type

from livekit.agents import RunContext, function_tool

from config.settings import get_settings
from utils.logging import get_logger

logger = get_logger(__name__)

# Shared HTTP client — reused across tool calls (connection pooling)
_http_client: httpx.AsyncClient | None = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(8.0, connect=3.0),
            follow_redirects=True,
            headers={"User-Agent": "VoiceAIAgent/1.0"},
        )
    return _http_client


async def close_http_client() -> None:
    """Call on agent shutdown to cleanly close the connection pool."""
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()


# ─────────────────────────────────────────────────────────────────────────────
# Tool 1: get_weather
# ─────────────────────────────────────────────────────────────────────────────

@function_tool()
async def get_weather(context: RunContext, city: str) -> dict[str, Any]:
    """
    Fetch current weather conditions for a city using OpenWeatherMap API.

    Args:
        city: City name (e.g. "London", "New York", "Tokyo")

    Returns:
        {
            "city": "London, GB",
            "temperature_c": 18.4,
            "temperature_f": 65.1,
            "feels_like_c": 17.0,
            "description": "light rain",
            "humidity_pct": 78,
            "wind_kmh": 21,
            "visibility_km": 9.0,
            "weather_emoji": "🌧"
        }
        or {"error": "reason"} on failure.
    """
    settings = get_settings()

    if not city or not city.strip():
        return {"error": "No city name provided."}

    city = city.strip()
    logger.info("tool.get_weather", city=city)

    try:
        client = _get_http_client()
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(2),
            wait=wait_fixed(0.5),
            retry=retry_if_exception_type(httpx.TransportError),
            reraise=True,
        ):
            with attempt:
                resp = await client.get(
                    "https://api.openweathermap.org/data/2.5/weather",
                    params={
                        "q": city,
                        "appid": settings.openweather_api_key,
                        "units": "metric",
                    },
                )

        if resp.status_code == 404:
            return {"error": f"City '{city}' not found. Please check the spelling."}

        resp.raise_for_status()
        data = resp.json()

        temp_c = round(data["main"]["temp"], 1)
        feels_like_c = round(data["main"]["feels_like"], 1)
        description = data["weather"][0]["description"]
        weather_id = data["weather"][0]["id"]

        result = {
            "city": f"{data['name']}, {data['sys']['country']}",
            "temperature_c": temp_c,
            "temperature_f": round(temp_c * 9 / 5 + 32, 1),
            "feels_like_c": feels_like_c,
            "description": description,
            "humidity_pct": data["main"]["humidity"],
            "wind_kmh": round(data["wind"].get("speed", 0) * 3.6, 1),
            "visibility_km": round(data.get("visibility", 0) / 1000, 1),
            "weather_emoji": _weather_emoji(weather_id),
        }

        logger.info("tool.get_weather.success", city=result["city"], temp=temp_c)
        return result

    except httpx.HTTPStatusError as e:
        logger.error("tool.get_weather.http_error", status=e.response.status_code)
        return {"error": f"Weather service returned an error ({e.response.status_code})."}
    except Exception as e:
        logger.error("tool.get_weather.error", error=str(e))
        return {"error": "Unable to fetch weather data at the moment."}


def _weather_emoji(weather_id: int) -> str:
    """Map OpenWeatherMap condition codes to emojis."""
    if weather_id < 300:
        return "⛈"   # Thunderstorm
    elif weather_id < 400:
        return "🌧"   # Drizzle
    elif weather_id < 600:
        return "🌧"   # Rain
    elif weather_id < 700:
        return "❄️"   # Snow
    elif weather_id < 800:
        return "🌫"   # Atmosphere (fog/mist)
    elif weather_id == 800:
        return "☀️"   # Clear sky
    elif weather_id == 801:
        return "🌤"   # Few clouds
    elif weather_id <= 804:
        return "☁️"   # Overcast
    return "🌡"


# ─────────────────────────────────────────────────────────────────────────────
# Tool 2: search_wikipedia
# ─────────────────────────────────────────────────────────────────────────────

@function_tool()
async def search_wikipedia(context: RunContext, query: str) -> dict[str, Any]:
    """
    Search Wikipedia and return the first 3 sentences of the most relevant article.

    Uses the Wikipedia API's search endpoint first, then fetches the extract
    for the top result. This two-step approach is more accurate than direct
    title lookup.

    Args:
        query: Search query (e.g. "Alexander Graham Bell", "French Revolution")

    Returns:
        {
            "title": "Alexander Graham Bell",
            "summary": "Alexander Graham Bell was a...",
            "url": "https://en.wikipedia.org/wiki/Alexander_Graham_Bell"
        }
        or {"error": "reason"} on failure.
    """
    if not query or not query.strip():
        return {"error": "No search query provided."}

    query = query.strip()
    logger.info("tool.search_wikipedia", query=query)

    try:
        client = _get_http_client()

        # Step 1: Search for the best matching article title
        search_resp = await client.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "list": "search",
                "srsearch": query,
                "srlimit": 1,
                "format": "json",
                "utf8": 1,
            },
        )
        search_resp.raise_for_status()
        search_data = search_resp.json()

        results = search_data.get("query", {}).get("search", [])
        if not results:
            return {"error": f"No Wikipedia article found for '{query}'."}

        title = results[0]["title"]

        # Step 2: Fetch the intro summary for the top result
        summary_resp = await client.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "query",
                "prop": "extracts",
                "exintro": True,
                "explaintext": True,
                "titles": title,
                "format": "json",
                "utf8": 1,
            },
        )
        summary_resp.raise_for_status()
        summary_data = summary_resp.json()

        pages = summary_data.get("query", {}).get("pages", {})
        if not pages:
            return {"error": "Failed to retrieve article content."}

        page = next(iter(pages.values()))
        extract = page.get("extract", "")

        if not extract:
            return {"error": f"Article '{title}' has no readable content."}

        # Truncate to first 3 sentences for voice response (avoid overwhelming TTS)
        sentences = _split_sentences(extract)
        summary = " ".join(sentences[:3])

        result = {
            "title": title,
            "summary": summary,
            "url": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
        }

        logger.info("tool.search_wikipedia.success", title=title)
        return result

    except Exception as e:
        logger.error("tool.search_wikipedia.error", error=str(e))
        return {"error": "Unable to search Wikipedia at the moment."}


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences. Simple but good enough for Wikipedia intros."""
    import re
    # Split on '. ', '! ', '? ' but keep the punctuation
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    return [s for s in sentences if s]


# ─────────────────────────────────────────────────────────────────────────────
# Tool 3: get_news (BONUS — extra tool beyond the minimum 2)
# ─────────────────────────────────────────────────────────────────────────────

@function_tool()
async def get_news(context: RunContext, topic: str, count: int = 3) -> dict[str, Any]:
    """
    Fetch top news headlines for a topic using NewsAPI.

    Args:
        topic: News topic (e.g. "artificial intelligence", "climate change", "sports")
        count: Number of headlines to return (default 3, max 5)

    Returns:
        {
            "topic": "artificial intelligence",
            "headlines": [
                {"title": "...", "source": "TechCrunch", "url": "..."},
                ...
            ]
        }
        or {"error": "reason"} on failure.
    """
    settings = get_settings()

    if not topic or not topic.strip():
        return {"error": "No news topic provided."}

    topic = topic.strip()
    count = max(1, min(5, count))  # Clamp between 1 and 5
    logger.info("tool.get_news", topic=topic, count=count)

    try:
        client = _get_http_client()
        resp = await client.get(
            "https://newsapi.org/v2/everything",
            params={
                "q": topic,
                "apiKey": settings.news_api_key,
                "pageSize": count,
                "sortBy": "publishedAt",
                "language": "en",
            },
        )
        resp.raise_for_status()
        data = resp.json()

        articles = data.get("articles", [])
        if not articles:
            return {"error": f"No recent news found for '{topic}'."}

        headlines = [
            {
                "title": article["title"],
                "source": article.get("source", {}).get("name", "Unknown"),
                "url": article.get("url", ""),
            }
            for article in articles[:count]
            if article.get("title") and "[Removed]" not in article["title"]
        ]

        if not headlines:
            return {"error": f"No readable news found for '{topic}'."}

        result = {"topic": topic, "headlines": headlines}
        logger.info("tool.get_news.success", topic=topic, count=len(headlines))
        return result

    except Exception as e:
        logger.error("tool.get_news.error", error=str(e))
        return {"error": "Unable to fetch news at the moment."}


# ─────────────────────────────────────────────────────────────────────────────
# Tool 4: calculate (BONUS)
# ─────────────────────────────────────────────────────────────────────────────

# Safe AST-based math evaluator — NEVER eval() user input
_SAFE_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.FloorDiv: operator.floordiv,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

_SAFE_FUNCTIONS = {
    "sqrt": math.sqrt,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "log": math.log10,
    "ln": math.log,
    "abs": abs,
    "ceil": math.ceil,
    "floor": math.floor,
    "round": round,
    "pi": math.pi,
    "e": math.e,
}


def _safe_eval(node: ast.AST) -> float:
    """Recursively evaluate a safe subset of Python AST math nodes."""
    if isinstance(node, ast.Num):
        # Python 3.8+ uses ast.Constant
        return float(node.n)
    elif isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    elif isinstance(node, ast.Name):
        if node.id in _SAFE_FUNCTIONS:
            val = _SAFE_FUNCTIONS[node.id]
            return val if not callable(val) else val  # type: ignore
        raise ValueError(f"Unknown name: {node.id}")
    elif isinstance(node, ast.BinOp):
        op = _SAFE_OPERATORS.get(type(node.op))
        if op is None:
            raise ValueError(f"Unsupported operator: {type(node.op)}")
        left = _safe_eval(node.left)
        right = _safe_eval(node.right)
        return op(left, right)
    elif isinstance(node, ast.UnaryOp):
        op = _SAFE_OPERATORS.get(type(node.op))
        if op is None:
            raise ValueError(f"Unsupported operator: {type(node.op)}")
        return op(_safe_eval(node.operand))
    elif isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise ValueError("Only simple function calls allowed")
        func = _SAFE_FUNCTIONS.get(node.func.id)
        if func is None:
            raise ValueError(f"Unknown function: {node.func.id}")
        args = [_safe_eval(arg) for arg in node.args]
        return func(*args)
    else:
        raise ValueError(f"Unsupported expression type: {type(node)}")


@function_tool()
async def calculate(context: RunContext, expression: str) -> dict[str, Any]:
    """
    Safely evaluate a mathematical expression without using eval().

    Supports: +, -, *, /, **, %, //, sqrt(), sin(), cos(), tan(),
              log(), ln(), abs(), ceil(), floor(), round(), pi, e

    Args:
        expression: Math expression as a string, e.g. "sqrt(144) + 2^8"

    Returns:
        {
            "expression": "sqrt(144) + 256",
            "result": 268.0,
            "formatted": "268"
        }
        or {"error": "reason"} on failure.
    """
    if not expression or not expression.strip():
        return {"error": "No expression provided."}

    # Normalise: ^ is common shorthand for ** in spoken math
    normalised = expression.strip().replace("^", "**")
    logger.info("tool.calculate", expression=normalised)

    try:
        tree = ast.parse(normalised, mode="eval")
        result = _safe_eval(tree.body)

        # Format nicely: remove trailing .0 for integers
        if result == int(result) and abs(result) < 1e15:
            formatted = str(int(result))
        else:
            formatted = f"{result:.6g}"  # Up to 6 significant figures

        logger.info("tool.calculate.success", result=formatted)
        return {
            "expression": normalised,
            "result": result,
            "formatted": formatted,
        }

    except ZeroDivisionError:
        return {"error": "Division by zero."}
    except ValueError as e:
        return {"error": f"Invalid expression: {e}"}
    except Exception as e:
        logger.error("tool.calculate.error", error=str(e))
        return {"error": "Could not evaluate expression."}