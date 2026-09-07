# HelpLagbe Client

The client is a React 19 application built with Vite. It uses the API at `http://localhost:4000/api` by default.

## Commands

```powershell
npm install
npm run dev -- --host 0.0.0.0 --port 4173
npm run build
npm run lint
npm run preview
```

Set `VITE_API_URL` in `client/.env` when the API is hosted somewhere other than `http://localhost:4000/api`.

## Routes

The application uses hash routes: `/#/login`, `/#/requests`, `/#/technicians`, `/#/customer`, `/#/technician`, and `/#/admin`.

## Verified test logins

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@helplagbe.com` | `admin123` |
| Customer | `demo.customer@helplagbe.com` | `DemoCustomer123!` |
| Technician | `demo.technician@helplagbe.com` | `DemoTechnician123!` |

See the repository [README](../README.md) for full-stack setup, demo credentials, features, and deployment guidance.
