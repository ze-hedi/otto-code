"""Minimal OpenAlex MCP server (HTTP transport)."""

import asyncio
import os
from typing import Literal

import httpx
from dotenv import find_dotenv, load_dotenv
from fastmcp import FastMCP
from tavily import AsyncTavilyClient

BASE_URL = "https://api.openalex.org"
SELECT = (
    "id,doi,title,publication_year,authorships,abstract_inverted_index,"
    "cited_by_count,best_oa_location,referenced_works_count"
)
MAX_RETRIES = 5

# Scientific sources the Tavily search is restricted to.
SCIENCE_DOMAINS = [
    "arxiv.org",
    "semanticscholar.org",
    "openalex.org",
    "openreview.net",
    "aclanthology.org",
    "proceedings.neurips.cc",
    "proceedings.mlr.press",
    "papers.nips.cc",
    "jmlr.org",
    "nature.com",
    "science.org",
    "pubmed.ncbi.nlm.nih.gov",
    "ncbi.nlm.nih.gov",
    "biorxiv.org",
    "medrxiv.org",
    "ieeexplore.ieee.org",
    "dl.acm.org",
    "link.springer.com",
    "sciencedirect.com",
    "paperswithcode.com",
    "huggingface.co",
]

mcp = FastMCP("openalex")

# Read .env from the directory the server is launched from (e.g. otto_code/).
load_dotenv(find_dotenv(usecwd=True))


async def _get(path: str, params: dict) -> dict:
    if api_key := os.getenv("OPENALEX_API_KEY"):
        params = {**params, "api_key": api_key}

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        for attempt in range(MAX_RETRIES):
            resp = await client.get(path, params=params)
            if resp.status_code != 429:
                resp.raise_for_status()
                return resp.json()
            await asyncio.sleep(2**attempt)
    raise RuntimeError("OpenAlex rate limit exceeded, try again later")


def _abstract(inverted: dict | None) -> str | None:
    # OpenAlex ships abstracts as {word: [positions]}; rebuild the plain text.
    if not inverted:
        return None
    words = sorted((pos, word) for word, positions in inverted.items() for pos in positions)
    return " ".join(word for _, word in words)


def _slim(work: dict) -> dict:
    oa = work.get("best_oa_location") or {}
    out = {
        "id": work["id"].rsplit("/", 1)[-1],
        "doi": work.get("doi"),
        "title": work.get("title"),
        "year": work.get("publication_year"),
        "authors": [a["author"]["display_name"] for a in work.get("authorships") or []],
        "abstract": _abstract(work.get("abstract_inverted_index")),
        "citationCount": work.get("cited_by_count"),
        "referenceCount": work.get("referenced_works_count"),
        "pdfUrl": oa.get("pdf_url") or oa.get("landing_page_url"),
    }
    if "relevance_score" in work:
        out["relevanceScore"] = work["relevance_score"]
    return out


def _work_path(paper_id: str) -> str:
    """Map "W123", "DOI:10.x", "ARXIV:2106.15928" or a URL to an OpenAlex works path."""
    prefix, _, rest = paper_id.partition(":")
    if prefix.upper() == "DOI":
        return f"/works/doi:{rest}"
    if prefix.upper() == "ARXIV":
        return f"/works/doi:10.48550/arXiv.{rest}"
    return f"/works/{paper_id}"


def _year_filter(year: str | None) -> dict:
    return {"filter": f"publication_year:{year}"} if year else {}


@mcp.tool
async def search_papers(
    query: str, limit: int = 10, year: str | None = None, semantic: bool = False
) -> dict:
    """Search papers in OpenAlex.

    Args:
        query: Free-text search query.
        limit: Number of results (max 100, or 50 when semantic).
        year: Optional year or range, e.g. "2023" or "2020-2024".
        semantic: Embedding-based search that finds conceptually related papers even
            when the wording differs. Slower (1 request/sec), so prefer keyword search
            for exact terms or titles.
    """
    if semantic:
        params = {"search.semantic": query, "per_page": min(limit, 50), "select": SELECT + ",relevance_score"}
    else:
        params = {"search": query, "per_page": min(limit, 100), "select": SELECT}
    data = await _get("/works", params | _year_filter(year))
    return {"total": data["meta"]["count"], "data": [_slim(w) for w in data["results"]]}


@mcp.tool
async def web_search_science(
    query: str,
    max_results: int = 5,
    search_depth: Literal["basic", "advanced"] = "advanced",
    extra_domains: list[str] | None = None,
) -> dict:
    """Web search (Tavily) restricted to scientific sources: arXiv, OpenReview, ACL,
    NeurIPS/PMLR, Nature, PubMed, IEEE, ACM, etc. Use it for very recent work or
    content not indexed by OpenAlex (blog posts by labs, benchmarks, code).

    Args:
        query: Free-text search query.
        max_results: Number of results (max 20).
        search_depth: "advanced" gives better relevance, "basic" is cheaper.
        extra_domains: Additional domains to include in the search.
    """
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        raise RuntimeError("TAVILY_API_KEY environment variable is required")

    client = AsyncTavilyClient(api_key=api_key)
    return await client.search(
        query=query,
        max_results=min(max_results, 20),
        search_depth=search_depth,
        include_domains=SCIENCE_DOMAINS + (extra_domains or []),
        include_answer=True,
    )


@mcp.tool
async def get_paper(paper_id: str) -> dict:
    """Get details of one paper.

    Args:
        paper_id: OpenAlex ID like "W2626778328", or prefixed ID like "DOI:10.xxx"
            or "ARXIV:1706.03762".
    """
    return _slim(await _get(_work_path(paper_id), {"select": SELECT}))


@mcp.tool
async def get_citations(
    paper_id: str,
    direction: Literal["citations", "references"] = "citations",
    limit: int = 20,
) -> dict:
    """Follow the citation graph of a paper, most cited first.

    Args:
        paper_id: Same formats as get_paper.
        direction: "citations" = papers citing this one, "references" = papers it cites.
        limit: Number of results (max 100).
    """
    work = await _get(_work_path(paper_id), {"select": "id"})
    openalex_id = work["id"].rsplit("/", 1)[-1]
    relation = "cites" if direction == "citations" else "cited_by"
    data = await _get(
        "/works",
        {
            "filter": f"{relation}:{openalex_id}",
            "sort": "cited_by_count:desc",
            "per_page": min(limit, 100),
            "select": SELECT,
        },
    )
    return {"total": data["meta"]["count"], "data": [_slim(w) for w in data["results"]]}


if __name__ == "__main__":
    mcp.run(
        transport="http",
        host=os.getenv("OPENALEX_HOST", "0.0.0.0"),
        port=int(os.getenv("OPENALEX_PORT", "8000")),
    )
