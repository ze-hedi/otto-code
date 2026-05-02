import os
from typing import Literal

from fastmcp import FastMCP
from tavily import TavilyClient

mcp = FastMCP(name="tavily-mcp")

_api_key = os.environ.get("TAVILY_API_KEY")
if not _api_key:
    raise RuntimeError("TAVILY_API_KEY environment variable is required")

_client = TavilyClient(api_key=_api_key)


@mcp.tool
def search(
    query: str,
    max_results: int = 5,
    search_depth: Literal["basic", "advanced"] = "basic",
    include_answer: bool = True,
) -> dict:
    """Search the web with Tavily and return ranked results."""
    return _client.search(
        query=query,
        max_results=max_results,
        search_depth=search_depth,
        include_answer=include_answer,
    )


@mcp.tool
def extract(urls: list[str]) -> dict:
    """Fetch and extract the main content of one or more URLs."""
    return _client.extract(urls=urls)


if __name__ == "__main__":
    mcp.run(
        transport="http",
        host=os.environ.get("TAVILY_HOST", "0.0.0.0"),
        port=int(os.environ.get("TAVILY_PORT", "8000")),
    )
