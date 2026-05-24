#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"

if [[ -z "$MODE" ]]; then
	echo "Usage: $0 docker|pm2" >&2
	exit 1
fi

if [[ ! -f .env ]]; then
	echo "Warning: .env not found — create it from .env.example if needed" >&2
fi

if [[ "$MODE" == "docker" ]]; then
	echo "Pulling latest code…"
	git pull

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

	ENV_FLAG=()
	if [[ -f .env ]]; then
		ENV_FLAG=(--env-file .env)
	fi

	echo "Creating data directory with container user ownership…"
	mkdir -p "$(pwd)/data"
	chown 1000:1000 "$(pwd)/data" 2>/dev/null || true

	echo "Starting container 'wa-bot'…"
	docker run -d --cpus="0.7" "${ENV_FLAG[@]}" --name wa-bot -v "$(pwd)/data:/app/data" wa-bot:latest

	echo "Done."

elif [[ "$MODE" == "pm2" ]]; then
	NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
	echo "Detected Node.js version: $(node --version)"

	if [[ "$NODE_VERSION" -lt 22 ]]; then
		echo "Error: Node.js >= 22 is required" >&2
		echo "Install or upgrade Node.js (e.g. via nvm: nvm install 24)" >&2
		exit 1
	fi

	cat <<-'EOF'

		Make sure these CLI tools are installed on your system:
		  - ffmpeg + ffprobe  (video/image processing)
		  - ghostscript (gs)  (PDF compress, split, encrypt)
		  - yt-dlp            (media download from URLs)
		  - soffice           (LibreOffice, for PDF → DOCX)

	EOF

	echo "Pulling latest code…"
	git pull

	echo "Enabling pnpm…"
	corepack enable

	echo "Installing dependencies…"
	pnpm install --frozen-lockfile

	echo "Installing pm2 globally…"
	pnpm add -g pm2

	ENV_ARGS=()
	if [[ -f .env ]]; then
		ENV_ARGS=(--interpreter-args "--env-file=.env")
	fi

	if pm2 list 2>/dev/null | grep -q 'wa-bot'; then
		echo "Restarting PM2 process 'wa-bot'…"
		pm2 restart wa-bot
	else
		echo "Starting 'wa-bot' with PM2…"
		pm2 start main.ts --interpreter node "${ENV_ARGS[@]}" --name wa-bot
	fi

	pm2 save

	echo ""
	echo "Done. Manage with: pm2 status | pm2 logs wa-bot | pm2 stop wa-bot"

else
	echo "Unknown mode: $MODE (use docker or pm2)" >&2
	exit 1
fi
