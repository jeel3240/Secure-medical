# Secure Medical — Lead Qualification & Call Center

Medical SMS qualification flow + browser-based call center.

## Quick Start

```bash
# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Start services
cd ..
docker compose up -d

# Migrate database
docker compose exec api npm run migrate

# View logs
docker compose logs -f api
docker compose logs -f worker
```

## Architecture

- **Backend**: Node + Express + Postgres + Redis
- **Frontend**: React + Vite
- **Deployment**: EC2 (Caddy + Docker Compose) + RDS

See `CLAUDE.md` for architecture decisions, data model and the four-week plan.
