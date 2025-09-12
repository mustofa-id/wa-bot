# Personal WhatsApp Bot

## Development

```bash

# install dependencies
pnpm i

# install puppeteer browser/chrome
pnpm dlx puppeteer browsers install

```

Find the browser/chrome path from the output of the command above and set it in the `.env` file.

```bash
cp .env.example .env
```

Edit `.env` file:

```conf
# set here
CHROME_PATH=your-browser-path

# bot owner numbers starts with 62 and split by comma
OWNER_NUMBERS=6285300001111,6289600001111
```

Start the bot by simply using the `pnpm start` command, or run it as a service with `pm2`:

```bash

# install pm2 globally if not already exists
pnpm add -g pm2

# create service
pm2 start app.js --name=wa-bot --node-args="--env-file=.env"
```

On the first run, the bot will print a QR code that you can use to link your account. When using `pm2`, you can use this command to view it:

```bash
pm2 logs wa-bot --out --lines 100
```

> Make sure there is [`ffmpeg`](https://ffmpeg.org/download.html) cli in your system.
