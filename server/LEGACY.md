# RETIRED — do not run or deploy

`server/` (Express) and `client/` (Vite) are the original prototype. The only production backend is the Next.js API in `../web` (`web/app/api/**`).
The `start`/`dev` scripts here deliberately fail so this server cannot be started by accident against the same database. Nothing in the
Dockerfile, `docker-compose.yml`, Netlify or CI builds or runs it. See `../docs/ARCHITECTURE_V1.md`.
