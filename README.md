# HelpLagbe

HelpLagbe is a local service marketplace connecting customers with verified technicians. Customers can post jobs and compare bids; technicians can apply, bid, message customers, and manage accepted work; administrators oversee the marketplace.

## Stack

- React 19 and Vite 8 frontend in `client/`
- Node.js and Express 5 API in `server/`
- MySQL or MariaDB database
- JWT authentication and bcrypt password hashing
- Hash-based client routes for static hosting

## Requirements

- Node.js 22 LTS (22.12 or newer recommended)
- npm (included with Node.js)
- MySQL or MariaDB running locally
- Windows PowerShell commands below; adjust paths for your installation

## Setup

### 1. Get the project and install the database

Open PowerShell in the project folder:

```powershell
Set-Location 'C:\path\to\HelpLagbe'
```

Install MariaDB or MySQL if needed. The following examples use this MariaDB client path; change it if your installation differs:

```powershell
$mysql = 'C:\Program Files\MariaDB 13.0\bin\mysql.exe'
```

### 2. Start the database server

If MariaDB is installed as a Windows service, find and start it. Use an elevated PowerShell window if Windows requests administrator permission:

```powershell
Get-Service *MariaDB*
Start-Service MariaDB
```

Use the service name returned by `Get-Service` if it is not `MariaDB`. If no service exists, open a separate PowerShell window and run the server in the foreground; leave that window open while using HelpLagbe:

```powershell
& 'C:\Program Files\MariaDB 13.0\bin\mysqld.exe' --console --standalone
```

### 3. Create and import the database

Back in PowerShell at the project folder, create the local database:

```powershell
& $mysql -u root -e "CREATE DATABASE IF NOT EXISTS helplagbe CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

Import the schema and its included starting data:

```powershell
Get-Content -Raw .\helplagbe.sql | & $mysql -u root helplagbe
```

If your database root account has a password, add `-p` after `-u root` in both commands and enter the password when prompted. Import into a new or empty database. Re-importing over existing tables can fail; back up data before replacing a database.

### 4. Configure and start the API

In a new PowerShell terminal:

```powershell
Set-Location 'C:\path\to\HelpLagbe\server'
Copy-Item .env.example .env
notepad .env
```

For local development, use `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_NAME=helplagbe`, `DB_SSL=false`, and `NODE_ENV=development`. Set `DB_PASSWORD` to your local database root password, or leave it empty if that account has no password. Keep `.env` private; Git ignores it.

Install dependencies and start the API:

```powershell
npm ci
npm start
```

Leave this terminal open. The API listens on `http://localhost:4000` and creates its supporting tables on first startup. Check the database connection in another PowerShell window:

```powershell
Invoke-RestMethod 'http://localhost:4000/api/health'
```

The response should show `ok: true` and `database: connected`.

### 5. Start the frontend

In another PowerShell terminal:

```powershell
Set-Location 'C:\path\to\HelpLagbe\client'
Copy-Item .env.example .env
npm ci
npm run dev -- --host 0.0.0.0 --port 4173
```

Open [http://localhost:4173](http://localhost:4173). The API URL defaults to `http://localhost:4000/api`; `client/.env.example` contains that value. Keep the database and API terminals running while using the site.

### 6. Sign in and test

Register a customer at `/#/register` or apply as a technician at `/#/register-technician`. Technician applications require administrator approval before technicians can bid.

The following accounts are for local testing with the matching initial or seeded data:

| Role       | Email                          | Password          | Availability                                        |
| ---------- | ------------------------------ | ----------------- | --------------------------------------------------- |
| Admin      | `admin@helplagbe.com`          | `admin123`        | Included with the supplied local test data          |
| Customer   | `ayesha.rahman@helplagbe.com`  | `AyeshaHome123!`  | Created by the optional realistic seed              |
| Technician | `mahmudul.islam@helplagbe.com` | `MahmudulPro123!` | Created and approved by the optional realistic seed |

Do not use these credentials or the local database for public deployment. Change or remove test accounts before sharing the application.

### Optional: Add realistic sample marketplace data

Only run this against a disposable local database. The script removes accounts tagged or named as demo/realistic and associated sample requests/tasks, then adds 20 customers, 8 technicians, 40 requests, and bids. It is not a production migration and must not be run against data you need to keep.

```powershell
Set-Location 'C:\path\to\HelpLagbe\server'
npm run seed:realistic
```

## Frontend routes

- `/#/` - public home
- `/#/login` - sign in
- `/#/register` - customer registration
- `/#/register-technician` - technician application
- `/#/requests` - service marketplace
- `/#/technicians` - approved technician directory
- `/#/customer` - customer workspace
- `/#/technician` - technician workspace
- `/#/admin` - administrator workspace

## Features

- Customer requests with optional JPG, PNG, or WebP images up to 5MB
- Marketplace search and category filters
- Technician applications, approval, and bidding
- Customer bid management and technician task lifecycle
- Reviews, notifications, and private messaging for accepted tasks
- Admin user management, audit log, archive, and restore workflows
- Persistent light/dark mode and responsive layouts

## Tests and Production Build

```powershell
Set-Location 'C:\path\to\HelpLagbe\server'
npm test
node --check .\src\server.js

Set-Location 'C:\path\to\HelpLagbe\client'
npm run build
npm run lint
```

The optional database integration test creates and deletes test users, posts, bids, notifications, and archive entries. Run it only against a disposable test database, never a live customer database:

```powershell
Set-Location 'C:\path\to\HelpLagbe\server'
$env:RUN_DATABASE_INTEGRATION_TESTS = '1'
$env:INTEGRATION_DB_IS_DISPOSABLE = '1'
npm run test:integration
Remove-Item Env:RUN_DATABASE_INTEGRATION_TESTS,Env:INTEGRATION_DB_IS_DISPOSABLE
```

## Legacy files

The original PHP files remain as legacy/reference material. The active application uses the React client and Express API.

## Deploy on Render Free Tier

The repository includes `render.yaml`, which describes a static frontend and a Node API. The API requires a separately hosted MySQL-compatible database; Render does not provide that database through this Blueprint. Free-plan availability and limits vary by provider and can change.

This Blueprint pins the API to Render's free compute plan, and Render static sites are free. TiDB Cloud Starter's documented free tier does not require a payment card; it includes a monthly usage quota and blocks new connections if a free instance exceeds its quota. Do not add a payment method, select a paid/scalable database plan, or enable paid overages. If a provider asks you for a card to continue, stop rather than entering payment details.

### Before you begin

1. Push the project to a GitHub repository. Do not commit either `.env` file or database credentials.
2. Choose a MySQL/MariaDB-compatible database provider. Confirm its plan permits connections from Render and check its TLS requirements and backup limits.
3. Create a database named `helplagbe` and import `helplagbe.sql` using the provider's import tool or a MySQL client.

### Create the Render services

1. Sign in to Render, select **New +** then **Blueprint**, connect the GitHub repository, and use its `render.yaml`.
2. When prompted for environment values, enter the database provider's `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. For TiDB Starter use port `4000`, `DB_SSL=true`, and the TiDB CA certificate in `DB_SSL_CA`. If you do not yet know the generated service URLs, enter temporary values for `CLIENT_ORIGIN` and `VITE_API_URL` and replace them in the next steps. Render generates `JWT_SECRET`; keep it private and do not replace it with a short/example value.
3. Apply the Blueprint. Render builds the API and static client; the first deploy can take several minutes.
4. In the API service settings, set `CLIENT_ORIGIN` to the exact static-site origin shown by Render, for example `https://your-client-name.onrender.com`. Use only the origin, with no path or trailing slash, then save and redeploy the API.
5. In the static site's settings, set the build environment variable `VITE_API_URL` to the API URL ending in `/api`, for example `https://your-api-name.onrender.com/api`. Save and redeploy the static site so Vite includes the hosted API URL in its build.
6. Open `https://your-api-name.onrender.com/api/health`. It should return `ok: true` and `database: connected`. Open the static site and test customer registration and sign-in.

The API also accepts a provider's `DATABASE_URL` instead of separate `DB_*` values. Set `DB_SSL=true` if that database requires TLS.

Free API services may sleep while idle. The API filesystem is ephemeral, so uploaded images can disappear after restarts or redeploys; use S3-compatible object storage for durable uploads. Free database plans may limit storage, connections, backups, and uptime. Keep separate backups and do not rely on this setup for business-critical data without reviewing the provider's terms and recovery guarantees.

## Troubleshooting

- **Connection refused on port 3306:** Start the database service/server and check `DB_HOST` and `DB_PORT` in `server/.env`.
- **Database access denied:** Correct `DB_USER`/`DB_PASSWORD` and verify the same account with the MySQL client.
- **Unknown database `helplagbe`:** Create the database and import `helplagbe.sql` before starting the API.
- **API health reports the database unavailable:** Check the API terminal and confirm the database is still running.
- **CORS error after deployment:** Set API `CLIENT_ORIGIN` to the exact static-site origin, save, and redeploy the API.
- **Deployed frontend still calls localhost:** Set static-site `VITE_API_URL` to the deployed API URL ending in `/api`, then rebuild/redeploy the static site.
- **`npm ci` reports a lockfile error:** Run `npm install` in that app folder to regenerate its lockfile, then retry `npm ci`.
