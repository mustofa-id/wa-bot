#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f .env ]]; then
	echo "Error: .env not found" >&2
	exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -q '^wa-bot$'; then
	echo "Stopping and removing existing container 'wa-bot'…"
	docker stop wa-bot
	docker rm wa-bot
fi

if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q '^wa-bot:latest$'; then
	echo "Removing existing image 'wa-bot:latest'…"
	docker rmi wa-bot:latest
fi

echo "Building image 'wa-bot:latest'…"
docker build -t wa-bot:latest .

echo "Starting container 'wa-bot'…"
docker run -d --cpus="0.7" --env-file .env --name wa-bot -v "$(pwd)/data:/app/data" wa-bot:latest

echo "Done."
