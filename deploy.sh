#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
PCT="${2:-100}"
CORES=$(nproc)

if [[ "$PCT" -lt 1 || "$PCT" -gt 100 ]]; then
	echo "Error: CPU percentage must be between 1 and 100" >&2
	exit 1
fi

if [[ -z "$MODE" ]]; then
	echo "Usage: $0 docker [pct]|pm2 [pct]" >&2
	echo "  pct — CPU percentage (1-100, default 100)" >&2
	exit 1
fi

if [[ ! -f .env ]]; then
	echo "Warning: .env not found — create it from .env.example if needed" >&2
fi

if [[ "$MODE" == "docker" ]]; then
	CPUS=$(echo "scale=2; $CORES * $PCT / 100" | bc)

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

	echo "Starting container 'wa-bot' with --cpus=\"$CPUS\"…"
	docker run -d --cpus="$CPUS" "${ENV_FLAG[@]}" --name wa-bot -v "$(pwd)/data:/app/data" wa-bot:latest

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
		  - gallery-dl        (fallback for image-only URLs)
		  - pdf2docx          (PDF → DOCX conversion)
		  - cpulimit          (CPU limiting, optional)

	EOF

	echo "Pulling latest code…"
	git pull

	echo "Enabling pnpm…"
	corepack enable

	echo "Installing dependencies…"
	pnpm install --frozen-lockfile --prod --prefer-offline

	echo "Installing pm2 globally…"
	pnpm add -g pm2

	ENV_ARGS=()
	if [[ -f .env ]]; then
		ENV_ARGS=(--interpreter-args "--env-file=.env")
	fi

	if command -v cpulimit &>/dev/null; then
		CPULIMIT_PCT=$(echo "$CORES * $PCT" | bc)
		echo "Using cpulimit -l $CPULIMIT_PCT% for Node.js process tree…"
		INTERPRETER="cpulimit"
		INTERPRETER_ARGS="-l $CPULIMIT_PCT node ${ENV_ARGS[@]+"${ENV_ARGS[@]}"}"
	else
		if [[ "$PCT" -lt 100 ]]; then
			echo "Warning: cpulimit not found — running without CPU limit (install it: sudo apt install cpulimit)" >&2
		fi
		INTERPRETER="node"
		INTERPRETER_ARGS="${ENV_ARGS[@]+"${ENV_ARGS[@]}"}"
	fi

	if pm2 list 2>/dev/null | grep -q 'wa-bot'; then
		echo "Restarting PM2 process 'wa-bot'…"
		pm2 delete wa-bot
	fi

	echo "Starting 'wa-bot' with PM2…"
	pm2 start main.ts --interpreter "$INTERPRETER" --interpreter-args "$INTERPRETER_ARGS" --name wa-bot

	pm2 save

	echo ""
	echo "Done. Manage with: pm2 status | pm2 logs wa-bot | pm2 stop wa-bot"

else
	echo "Unknown mode: $MODE (use docker or pm2)" >&2
	exit 1
fi
