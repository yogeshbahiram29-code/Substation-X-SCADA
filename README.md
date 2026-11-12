# Office Draft Assistant

An AI app for substation and utility office work. Type a few rough points and it writes a ready-to-send draft:

- Official letters
- Emails
- Replies to a letter or email you paste in
- Office notes / note sheets for approval
- Shutdown and outage requests
- Minutes of meetings
- Reminders and follow-ups
- Notices and circulars

It runs on your own computer and opens in your browser (Chrome, Edge or Firefox). Drafts are written by Claude, Anthropic's AI model.

## What it does

- **Rough points in, finished draft out.** Notes can be short, in broken sentences, or in a mix of languages.
- **English, Hindi, Marathi or any other language.** Type the language name in the Language box.
- **Never invents details.** Anything you did not supply (reference number, date, feeder name) appears as a blank in square brackets, such as `[Ref. No.]`, and the app lists the blanks and jumps you to each one.
- **Change it by asking.** "Make it shorter", "add that work must finish before 30 November", and so on. *Undo change* goes back one step.
- **Edit by hand** directly in the draft box.
- **Copy, Download Word (.docx), or Print.**
- **Office profile.** Save your name, designation and office address once; they are used for the letterhead and signature.
- **Recent drafts.** The last 30 drafts are kept in your browser.

## Setup (one time)

You need two things:

1. **Node.js** version 20.12 or newer. Download the "LTS" installer from <https://nodejs.org> and install it with the default options.
2. **A Claude API key.** Create an account at <https://platform.claude.com>, add billing, and create a key under *API keys*. The key starts with `sk-ant-`. Usage is charged to that account by Anthropic; expect a few rupees per draft.

Then:

1. Download this project (green **Code** button on GitHub, then **Download ZIP**) and unzip it.
2. In the project folder, make a copy of the file `.env.example` and name the copy `.env`.
3. Open `.env` in Notepad and paste your key after `ANTHROPIC_API_KEY=`. Save the file.

## Starting the app

**Windows:** double-click `start.bat`. The first run installs what the app needs, which takes a minute and needs internet.

**Any system, from a terminal in the project folder:**

```
npm install
npm start
```

Then open <http://localhost:3000> in your browser. Keep the black terminal window open while you use the app; close it to stop the app.

## Using it

1. Click **Office profile** (top right) and fill in your details once.
2. Choose the document type, type who it is to, and type your key points.
3. Click **Generate draft**.
4. Fill in any blanks shown in `[brackets]`, and use the *Want it changed?* box to adjust the draft.
5. **Copy**, **Download Word** or **Print**.

Always read the draft and check names, dates, figures and equipment details before sending. The AI writes the wording; you remain responsible for the facts.

## Privacy

- Your API key stays in the `.env` file on your computer. It is never sent to the browser. Do not share the `.env` file.
- What you type is sent to Anthropic's Claude API to write the draft. Do not enter information your office does not allow to leave its systems.
- Your office profile and recent drafts are stored only in your browser on your computer.

## Sharing with colleagues on the office network

By default only your own computer can open the app. To let others on the same network use it, set `HOST=0.0.0.0` in `.env`, restart, and have them open `http://<your-computer-name>:3000`. Everyone will use your API key, and the app has no login, so do this only on a trusted office network.

## Settings (`.env`)

| Setting | Meaning | Default |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Your Claude API key | none (required) |
| `PORT` | Port the app runs on | `3000` |
| `HOST` | `127.0.0.1` for this computer only, `0.0.0.0` for the office network | `127.0.0.1` |

## For developers

```
server.js          Express server: serves the page, streams drafts, exports Word files
src/prompt.js      Instructions given to Claude, document types, input checks
src/docx.js        Plain text to .docx
public/            The page (HTML, CSS, JavaScript; no build step)
test/              Unit tests (npm test)
```

- Drafts come from `claude-opus-5-5` through the official `@anthropic-ai/sdk`, streamed to the browser as server-sent events.
- Each request is self-contained: a revision sends the draft currently in the box plus the requested change, so hand edits are always respected.
- If the model declines a request, the API retries it on Anthropic's recommended fallback model (`fallbacks: "default"`). Remove the `betas` and `fallbacks` lines in `server.js` to turn this off.
- To change the house style or add a document type, edit `src/prompt.js`.
