# Personal WhatsApp Bot

## Development

```bash

# install dependencies
pnpm i

# install puppeteer browser/chrome
pnpm dlx puppeteer browsers install

```

See browser/chrome path from the output of command above and set it to `.env` file.

```bash
cp .env.example .env
```

Edit `.env` file:

```conf
# set here
CHROME_PATH=your-browser-path

# bot command default to !plz
BOT_CMD=!mstf

# bot owner numbers starts with 62 and split by comma
OWNER_NUMBERS=6285300001111,6289600001111
```

Start the bot by simply using `pnpm start` command or run it as service with `pm2`:

```bash

# install pm2 globally if not already exists
pnpm add -g pm2

# create service
pm2 start app.js --node-args="--env-file=.env"
```

Make sure there is `ffmpeg` cli in your system.
