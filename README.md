# Ai-Agent

Ai-Agent is a full-stack AI chat application with:

- `backend_nodejs`: Node.js + Express + Socket.IO backend
- `frontend`: Vue 3 frontend

This repository is prepared for open-source release and excludes sensitive local configuration files.

## Features

- Multi-model AI chat routing (OpenAI / Anthropic / Azure / others via config)
- Real-time chat updates with Socket.IO
- Markdown rendering in chat responses
- File/image handling utilities (backend side)
- MySQL-based persistence for conversation and model metadata

## Tech Stack

- Backend: Node.js, Express, Socket.IO, MySQL2
- Frontend: Vue 3, Axios, Socket.IO Client
- Runtime: Node.js >= 18

## Project Structure

```text
Ai-Agent/
	backend_nodejs/
		app.js
		config/
		database/
		routes/
		services/
		socket/
	frontend/
		src/
		public/
```

## Quick Start

### 1. Clone

```bash
git clone https://github.com/Simon136/Ai-Agent.git
cd Ai-Agent
```

### 2. Setup Backend

```bash
cd backend_nodejs
npm install
copy .env.example .env
```

Edit `.env` with your own values (database, API keys, cloud credentials).

Run backend:

```bash
npm run dev
```

### 3. Setup Frontend

```bash
cd ../frontend
npm install
npm run serve
```

Default frontend dev server is configured to run on port `8082`.

## Environment Variables

Use `backend_nodejs/.env.example` as template.

Common variables include:

- Database connection (`SQLALCHEMY_DATABASE_*` style fields)
- Model provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)
- Cloud storage keys (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)

Never commit real secrets to Git.

## Scripts

Backend (`backend_nodejs/package.json`):

- `npm run dev`: run with nodemon
- `npm run start`: run production-like server
- `npm run production`: start via PM2
- `npm run repair-db`: run DB repair script

Frontend (`frontend/package.json`):

- `npm run serve`: start dev server
- `npm run build`: build production assets

## Security Notes

- `.env` and log files are ignored by `.gitignore`
- Rotate keys immediately if you suspect any exposure
- Prefer using scoped, least-privilege API/cloud credentials

## License

MIT License. See `LICENSE`.
