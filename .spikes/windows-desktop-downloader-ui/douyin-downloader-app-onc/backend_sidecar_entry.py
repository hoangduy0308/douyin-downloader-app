import argparse
import asyncio
from pathlib import Path

from config import ConfigLoader
from server.app import run_server


def main() -> None:
    parser = argparse.ArgumentParser(description="Douyin backend sidecar spike")
    parser.add_argument("--config")
    parser.add_argument("--path")
    parser.add_argument("--serve-host", default="127.0.0.1")
    parser.add_argument("--serve-port", type=int, default=8000)
    args = parser.parse_args()

    config = ConfigLoader(args.config if args.config else None)
    if args.path:
        config.update(path=str(Path(args.path).resolve()))

    asyncio.run(run_server(config, host=args.serve_host, port=args.serve_port))


if __name__ == "__main__":
    main()
