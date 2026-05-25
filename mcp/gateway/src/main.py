import logging
import os
from pathlib import Path

from fastmcp import Client, FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse

from src.registry import GatewayConfig, load_config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("gateway")


def build_gateway(config: GatewayConfig) -> FastMCP:
    gateway = FastMCP(name=config.name)

    for upstream in config.upstreams:
        log.info("registering upstream name=%s prefix=%s url=%s",
                 upstream.name, upstream.prefix, upstream.url)
        client = Client(upstream.url)
        proxy = FastMCP.as_proxy(client, name=upstream.name)
        gateway.mount(proxy, prefix=upstream.prefix)

    @gateway.custom_route("/healthz", methods=["GET"])
    async def healthz(_: Request) -> JSONResponse:
        return JSONResponse({"status": "ok", "upstreams": [u.name for u in config.upstreams]})

    return gateway


def main() -> None:
    config_path = Path(os.environ.get("GATEWAY_CONFIG", "/app/config.yaml"))
    config = load_config(config_path)
    gateway = build_gateway(config)

    host = os.environ.get("GATEWAY_HOST", "0.0.0.0")
    port = int(os.environ.get("GATEWAY_PORT", "9000"))

    log.info("starting gateway %s on %s:%d", config.name, host, port)
    gateway.run(transport="http", host=host, port=port)


if __name__ == "__main__":
    main()
