# Tenth Dusk

Live at https://tenth-dusk.helikos.dev

## Develop

```bash
npm install
npm run dev
```

## Deploy

Deploys run on Cloudflare Workers Builds. A push to `main` builds and deploys production. A push to any other branch builds a Preview, and its URL is posted on the pull request.

Stack: Vite, React, TypeScript and MUI, served as Worker static assets (see `wrangler.jsonc`).
