# HelpLagbe

HelpLagbe is a local service marketplace connecting customers with verified technicians. Customers can post jobs and compare bids; technicians can apply, bid, message customers, and manage accepted work; administrators oversee the marketplace.

## Stack

- React 19 + Vite 8 frontend in `client/`
- Node.js + Express 5 REST API in `server/`
- MySQL/MariaDB with `mysql2/promise`
- JWT authentication and bcrypt password hashing
- Hash-based frontend routes for reliable Vite development and static hosting

## Requirements

- Node.js 20 or newer
- MySQL or MariaDB
- A database named `helplagbe`

## Setup

1. Import `helplagbe.sql` into MySQL/MariaDB.
2. Configure `server/.env` with the database values and a strong `JWT_SECRET`.
3. Start the API:

```powershell
cd server
npm install
npm start
```

4. Start the client in another terminal:

```powershell
cd client
npm install
npm run dev -- --host 0.0.0.0 --port 4173
```

To populate a fresh database with repeatable marketplace demo data:

```powershell
cd server
npm run seed:demo
```

The seed creates 20 demo customers, 8 approved technicians, 40 service requests, and 93 bids/tasks. It detects an existing seed marker and will not create duplicates when run again. Seeded customers use `DemoData123!`; seeded technicians use `DemoTech123!`.

Open `http://localhost:4173/#/login`. The API health check is available at `http://localhost:4000/api/health`.

The API automatically creates supporting tables for notifications, admin controls, audit history, task messages, and archived users when it starts.

## Frontend routes

- `/#/` - public home page
- `/#/login` - login
- `/#/register` - customer registration
- `/#/register-technician` - technician application
- `/#/requests` - privacy-safe service marketplace
- `/#/technicians` - approved technician directory
- `/#/customer` - customer workspace
- `/#/technician` - technician workspace
- `/#/admin` - administrator workspace

## Features

- Customer requests with optional JPG, PNG, or WebP images up to 5MB
- Marketplace search, category filters, and date sorting
- Technician applications with admin approval
- Verified technician directory with skills, ratings, and completed jobs
- Customer bid acceptance/rejection
- Technician pending-bid editing and task lifecycle updates
- Reviews for completed tasks
- In-app notifications with unread counts
- Private messaging for accepted tasks only
- Admin user suspension/reactivation and audit log
- Archive-first account deletion with retained account history
- Persistent light/dark mode
- Loading states, error boundary, responsive layouts, and reduced-motion support

## Verified test logins

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@helplagbe.com` | `admin123` |
| Customer | `demo.customer@helplagbe.com` | `DemoCustomer123!` |
| Technician | `demo.technician@helplagbe.com` | `DemoTechnician123!` |

Change demo passwords before sharing a deployed environment.

## Validation

```powershell
cd client
npm run build
npm run lint

cd ../server
node --check src/server.js
```

## Legacy files

The original PHP files remain as legacy/reference material. The active application uses the React client and Express API.

## Deployment notes

- Use strong production secrets and HTTPS.
- Restrict `CLIENT_ORIGIN` to the deployed frontend origin.
- Serve the client with SPA fallback.
- Protect `/uploads` with appropriate storage and access controls.
- Use database backups, rate limiting, and log monitoring in production.
