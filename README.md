# HelpLagbe

HelpLagbe is a local service marketplace connecting customers with verified technicians. Customers can create service requests and compare bids; technicians can apply, bid, message customers, and manage accepted work; administrators oversee the marketplace. The public site includes a service-focused homepage, a directory of approved technicians, and contact links in the footer.

**Live website:** [helplagbe-client.onrender.com](https://helplagbe-client.onrender.com)

The original [Software Requirements Specification (PDF)](SRS_Documents/Software%20Requirements%20Specification%20(SRS)%20for%20HelpLagbe.pdf) describes the project's initial scope. See the [implementation addendum](SRS_Documents/Implementation%20Addendum.md) for requirements aligned with the current application and notes on features that remain out of scope.

## Stack

- React 19 and Vite 8 frontend in `client/`
- Node.js and Express 5 API in `server/`
- MySQL or MariaDB database
- JWT authentication and bcrypt password hashing
- Hash-based client routes for static hosting
- Installable as an app on phones (web app manifest and a small service worker)
- Hand-built SVG charts with no charting library

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

Optional settings in `server/.env` (both have safe defaults):

- `APP_TIME_ZONE` - time zone used to check technician working hours. Default `Asia/Dhaka`.
- `API_RATE_LIMIT` - requests per 15 minutes allowed from one address across the API. Default `200`. Raise it only for load or automated tests.

Install dependencies and start the API:

```powershell
npm ci
npm start
```

Leave this terminal open. The API listens on `http://localhost:4000` and, on startup, creates its supporting tables and adds any columns newer versions need to an existing database, so pulling an update does not require re-importing the schema. Check the database connection in another PowerShell window:

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

Register at `/#/register` and choose whether to create a customer or technician account. Technician applications require administrator approval before technicians can bid; `/#/register-technician` opens registration with Technician selected.

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
- `/#/register` - registration; choose Customer or Technician
- `/#/register-technician` - registration with Technician preselected
- `/#/requests` - service marketplace
- `/#/technicians` - directory of approved technicians and their skills, completed jobs, and ratings
- `/#/customer` - customer workspace
- `/#/technician` - technician workspace
- `/#/admin` - administrator workspace

Each workspace has a sidebar. Besides Overview, Messages and Edit profile, the newer screens are **Analytics** for every role and **History** for customers and technicians. A section can be opened directly with `?section=`, for example `/#/customer?section=customer-history`.

## Features

- Customer requests with optional JPG, PNG, or WebP images up to 5MB
- Request-specific service addresses with optional building and flat details; exact location and either party's optional phone number are shared only with the selected match after acceptance
- Customer request editing before acceptance, legacy address completion, and reasoned request closure that declines pending offers and notifies bidders
- Technician withdrawal of pending offers with a reason, customer notification, and preserved task timeline
- Public request and pre-accept history descriptions automatically redact common email, Bangladesh phone, and street-address patterns; customers are advised to keep contact/location details out of descriptions
- Marketplace search and category filters
- Customer or technician account selection during registration; optional phone number at signup and editable later from the profile
- Technician applications, administrator approval, and bidding
- Public homepage with customer and technician entry points
- Approved technician directory with location/availability filters, skills, ratings, completed jobs, and typical first-offer response time
- Customer bid management with proposed appointments, mutual scheduling confirmation, reschedule/cancel reasons, a task timeline, and task-only messaging
- Actionable notifications for offers, messages, appointment changes, and task events; selecting one marks it read and opens the related dashboard task or conversation when a task link is available
- Technician offers include a clear scope note for labor, parts, call-out fees, and price flexibility; later agreed-price changes require an explanation and approval from the other participant
- Customer pre-accept technician overview with work history, completed-task count, ratings, and recent reviews
- Confirmation-based payment records with an agreed amount and receipt reference; no online payment processing or escrow
- User reporting for technician profiles, messages, tasks, and disputes, with an admin review queue
- Technician opportunity matching by service area, plus rating and response-time sorting
- Per-completed-task interactive reviews with star ratings, selectable compliments, optional written feedback, notification dropdown with unread count, and private messaging for accepted tasks
- Customer, technician, and admin dashboards with sidebar navigation and editable account profiles, including validated profile-photo uploads
- Admin user management, audit log, and two-stage account deletion: archiving removes the user from the active system while preserving a recoverable snapshot; the Archived accounts panel refreshes after archiving and supports restore or confirmed permanent deletion
- Public contact links, persistent light/dark mode, and responsive layouts

### Analytics and history

- **Analytics for every role**, with a 3, 6 or 12 month range. Every chart has hover details and a table view.
  - Customers: paid and unpaid spending by month, jobs by category, most-hired technicians, average job cost and rating given, time to first offer, and what happened to their requests.
  - Technicians: earnings and jobs by month, offers sent, hired and completed, share of offers accepted, ratings received, response time, repeat customers, and how often they cancel.
  - Admins: completion and cancellation rates, requests against completed jobs, paid job value, new members, open reports, technician account counts, and unmet demand by category and Dhaka area.
- **History for customers and technicians**: finished jobs with search, status and date filters, paging and CSV export. Each row opens to receipts and the job's payment, warranty, review and timeline actions. Technicians also see offers that were not taken, without the customer's identity.

### Trust and safety

- Technician status follows fixed rules: pending can become approved or rejected, approved can be suspended or rejected, suspended can return to approved or be rejected, and rejected can be approved again. An approved technician can never go back to pending.
- Suspending or rejecting needs a written reason, which is sent to the technician and saved in the audit log. It also withdraws the technician's open offers and tells the affected customers. Rejection is blocked while the technician has active jobs; suspension is allowed and tells the admin how many remain. Technicians who are not approved see a banner on their dashboard.
- Technicians rate customers after a completed job, and customers' average ratings are shown to technicians on open requests.
- Users can block each other. A block stops messages and offers in both directions and hides each person's requests from the other.
- A customer can report a problem with a finished job for 7 days. The technician accepts, declines or resolves it with a note, and the customer is notified at each step.
- Dispute reports accept a photo as evidence. When resolving a report an admin can send a warning or suspend the reported technician; both are recorded and the user is notified.
- A technician profile shows an "ID verified" badge when a national ID and document are on file. It means the documents exist, not that an admin has reviewed them.

### Convenience

- **Dhaka area list.** Requests and technician service areas are chosen from a fixed list of Dhaka areas, so matching is exact and misspellings cannot cause misses. To cover another city, extend the `SERVICE_AREAS` list in `server/src/server.js`. On startup, existing free-text areas and addresses are mapped to the list where they clearly name a listed area; older entries that do not are left as they were and keep the older text matching.
- Technicians in the area of a new request get a notification and can turn alerts off in their availability settings.
- Technicians set weekly working hours. Offers and appointment times outside those hours are refused for both sides, and customers see a summary such as "Mon-Fri 09:00-18:00" on the technician's profile.
- Customers can save up to five addresses, mark favourite technicians, and rebook a past request. Technicians can tell a customer they are running late, and either side can attach photos to messages.
- Technicians see a profile checklist until their profile is complete.

### Archived account lifecycle

Administrators archive users from the Users section. The account and its marketplace data are saved for recovery, and the archive appears in the Archived accounts section without requiring a page reload. From there, an administrator can restore the account or permanently delete its saved archive. Permanent deletion cannot be undone; personal details are removed from the relevant archive/restore audit entries while a non-personal deletion record is retained.

## Tests and Production Build

```powershell
Set-Location 'C:\path\to\HelpLagbe\server'
npm test
node --check .\src\server.js

Set-Location 'C:\path\to\HelpLagbe\client'
npm run build
npm run lint
```

`npm test` runs the checks that do not need a database. The integration tests in `server/tests/marketplace.integration.test.js` and `server/tests/phases.integration.test.js` run the real API against a real database. They create and delete test users, requests, offers, payments, reports, messages and uploaded images. Run them only against a disposable database, never one that holds real data. They are skipped unless both variables below are set, and they refuse to run with `NODE_ENV=production`.

The test database needs the schema imported once and at least one administrator account, which `helplagbe.sql` provides. Point the server at it with environment variables, which take priority over `server/.env`:

```powershell
Set-Location 'C:\path\to\HelpLagbe\server'
$env:DB_HOST = '127.0.0.1'; $env:DB_PORT = '3306'; $env:DB_NAME = 'helplagbe_test'
$env:DB_USER = 'root'; $env:DB_PASSWORD = ''; $env:DB_SSL = 'false'
$env:DB_SSL_CA_PATH = ''; $env:DATABASE_URL = ''; $env:NODE_ENV = 'test'
$env:API_RATE_LIMIT = '100000'
$env:RUN_DATABASE_INTEGRATION_TESTS = '1'
$env:INTEGRATION_DB_IS_DISPOSABLE = '1'
node --test tests/auth-validation.test.js tests/marketplace.integration.test.js tests/phases.integration.test.js
```

Close that PowerShell window afterwards, or remove those variables, so a later `npm start` does not use the test database. If your `server/.env` points at a hosted database, the empty `DATABASE_URL` and `DB_SSL_CA_PATH` values above stop it being used by accident.

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
- **Import prints "Foreign key constraint is incorrectly formed" for `task_lifecycle_events` or `marketplace_reports`:** The dump creates these two tables before the keys they point to exist. The API creates both itself on startup, so the errors are harmless. To avoid them, import with `SET FOREIGN_KEY_CHECKS=0;` at the top of the file.
- **Offers or appointments are refused as outside working hours:** Check the technician's weekly availability and the `APP_TIME_ZONE` setting.
- **"Too many requests" during testing:** Raise `API_RATE_LIMIT` in the environment. Sign-in has its own limit of 10 attempts per 15 minutes.
- **`npm ci` reports a lockfile error:** Run `npm install` in that app folder to regenerate its lockfile, then retry `npm ci`.
