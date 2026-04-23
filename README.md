# Connect.com Backend Setup & API Documentation

This Node.js/Express backend provides a robust REST API for the Connect.com freelance marketplace, featuring Supabase PostgreSQL for data/auth/storage and Stripe for escrow and subscriptions.

## 🛠 Pre-requisites & Environment Setup

1. **Node.js** v16+
2. **Supabase Account**: You must create a new Supabase project.
3. **Stripe Account**: You must create a Stripe account and access developer keys.

### Local Initialization

```bash
cd backend
npm install
```

### Environment Variables (.env)

Duplicate the `.env.example` file to create a `.env` file in the root of the `backend/` directory and populate it with your production/development keys:

```env
PORT=5000
NODE_ENV=development

# Supabase details
SUPABASE_URL=https://<your-project>.supabase.co
# IMPORTANT: Use the SERVICE_ROLE_KEY to allow backend admin operations (secure backend only)
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-jwt>

# Stripe details
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Supabase Initialization

1. Connect to your Supabase project's SQL Editor.
2. Open `supabase/db_schema.sql`.
3. Copy-paste everything and run it to create your entire database schema and custom tables (`users`, `profiles`, `jobs`, `proposals`, `contracts`, `messages`, `payments`, `subscriptions`, `teams`, `notifications`, `violations`).
4. Ensure your Supabase Auth is enabled, with Email/Password sign-ins turned on in your dashboard.
5. Create two Storage buckets manually in Supabase: `avatars` and `documents`. Ensure they are set to Public if you want them easily accessible to your frontend.

### Stripe Initialization

1. Obtain your `STRIPE_SECRET_KEY` from the Stripe dashboard.
2. For local testing of webhooks, install Stripe CLI and run:
   ```bash
   stripe listen --forward-to localhost:5000/api/payments/webhook
   ```
   Copy the `whsec_...` output and put it in `.env` under `STRIPE_WEBHOOK_SECRET`.

---

## 🚀 Running the Server

```bash
# Development mode (with nodemon)
npm run start:dev  # (add "start:dev": "nodemon server.js" in package.json)

# Standard (production)
node server.js
```

The server should log: `Server is running on port 5000 in development mode.`

---

## 📖 Main API Endpoint Overview

All endpoints return JSON responses conforming to this format:
```json
{
  "success": true,   // or false
  "data": { ... },   // actual response object or null
  "message": "..."   // contextual string
}
```

Most routes require an `Authorization` header containing a valid Supabase JWT Bearer token:
`Authorization: Bearer <your-jwt-token-from-login>`

### Auth (`/api/auth`)
- `POST /register`: Request body: `{ email, password, role ('CLIENT' or 'FREELANCER'), name }`
- `POST /login`: Request body: `{ email, password }`
- `POST /logout`: Header Auth required.
- `POST /reset-password`: Request body: `{ email }`

### Users/Profiles (`/api/users`) - **Requires Auth**
- `GET /profile`: Fetch your comprehensive profile.
- `PUT /profile`: Update arbitrary fields based on role (e.g., `bio`, `company_name`, `skills`, `hourly_rate`).
- `POST /upload-avatar`: Send `multipart/form-data` with an `avatar` file field.
- `POST /upload-document`: Send `multipart/form-data` with a `document` file field.

### Jobs (`/api/jobs`)
- `GET /all`: Fetch all OPEN jobs. Queries supported: `?skill=React&status=OPEN`.
- `GET /:id`: Fetch a specific job's details & associated proposals.
- `POST /create`: (CLIENT only) Body: `{ title, description, skills_required, budget, project_type }`.
- `PUT /update/:id`: (CLIENT only) Update existing job attributes.
- `DELETE /delete/:id`: (CLIENT only) Delete job.

### Proposals (`/api/proposals`) - **Requires Auth**
- `POST /create`: (FREELANCER only) Submit proposition. Body: `{ job_id, cover_letter, proposed_rate, estimated_duration }`.
- `DELETE /:id`: (FREELANCER only) Withdraw proposition.
- `PUT /:id/accept`: (CLIENT only) Client marks proposal as accepted.

### Contracts (`/api/contracts`) - **Requires Auth**
- `POST /create`: (CLIENT only) Body: `{ proposal_id, job_id, freelancer_id, agreed_rate, start_date, end_date }`. Transition job to IN_PROGRESS.
- `GET /user`: Fetches active, completed, or canceled contracts involving the invoking user.

### Escrow Payments (`/api/payments`)
- `POST /webhook`: (PUBLIC) Exclusively for Stripe Event handling.
- `POST /create-intent`: (CLIENT only) Triggers Stripe API intent creation pointing to escrow. Body: `{ contract_id, amount }`. Returns a `clientSecret`.
- `POST /escrow-deposit`: (CLIENT only) Registers that funds have been loaded into Stripe logic.
- `POST /release`: (CLIENT only) Body: `{ payment_id }`. Tells Stripe to capture/release held escrow funds to the payee.
- `POST /refund`: Drops or returns the Stripe Hold.

### Subscriptions (`/api/subscriptions`) - **Requires Auth**
- `POST /create`: Body: `{ plan: 'BASIC' | 'PLUS' | 'BUSINESS', payment_method_id }`. Sets up continuous Stripe Billing.
- `GET /status`: Checks DB for active Sub records.
- `POST /cancel`: Halts subscription.

### Real-Time Chat System (`/api/messages`) - **Requires Auth**
- `POST /send`: Send message to receiver IDs. `multipart/form-data` allows an `attachment`. Form fields: `receiver_id`, `contract_id`, `content`.
- `GET /:conversationId`: Fetch all messages passing between the logged-in user and the targeted `conversationId` (the ID of another user). Results auto-mark as read.

### Notifications & Teams & Health - **Requires Auth**
- `GET /api/notifications/`: Review unread/read alerts.
- `PUT /api/notifications/read`: Mark array of notification `id`s or universally mark all read.
- `POST /api/teams/create`: Create multi-user client agencies.
- `GET /api/account/health`: Measure violations.
