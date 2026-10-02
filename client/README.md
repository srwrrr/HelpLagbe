# HelpLagbe Client

The React and Vite frontend uses `http://localhost:4000/api` by default. For the complete local setup, database import, test accounts, troubleshooting, and Render deployment walkthrough, see the repository [README](../README.md).

## Client Commands

```powershell
npm ci
npm run dev -- --host 0.0.0.0 --port 4173
npm run build
npm run lint
npm run preview
```

Set `VITE_API_URL` in `client/.env` for local development or in the static host's build environment for deployment. Its value must end in `/api`, for example `https://your-api-name.onrender.com/api`.
