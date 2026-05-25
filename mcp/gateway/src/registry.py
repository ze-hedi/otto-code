from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(frozen=True)
class Upstream:
    name: str
    prefix: str
    url: str


@dataclass(frozen=True)
class GatewayConfig:
    name: str
    upstreams: tuple[Upstream, ...]


def load_config(path: Path) -> GatewayConfig:
    raw = yaml.safe_load(path.read_text())
    upstreams = tuple(
        Upstream(name=u["name"], prefix=u["prefix"], url=u["url"])
        for u in raw.get("upstreams", [])
    )
    return GatewayConfig(name=raw.get("name", "mcp-gateway"), upstreams=upstreams)
