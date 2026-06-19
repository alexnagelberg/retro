# Sprint Retro Board

A Next.js sprint retrospective app backed by Redis. Each board lives under a shareable session URL, with a configurable timer and four note columns: went well, needs improvement, action items, and kudos.

Notes can only be added while the timer is running. The UI disables note entry before and after the timer, and the API enforces the same rule server-side.

Sessions are stored in Redis for 30 days. Boards can be exported offline with the Export PDF button, which downloads a PDF snapshot.

## Setup

Install dependencies:

```bash
npm install
```

Create an environment file:

```bash
cp .env.example .env.local
```

Start Redis locally, or point `REDIS_URL` at a hosted Redis instance:

```bash
docker run --rm -p 6379:6379 redis:7
```

Run the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Create a new session from the start screen, or open a shared link such as `http://localhost:3000/team-alpha-retro`.

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```
