# Product Requirements Document — TSP-NG

> **Version:** 1.0  
> **Status:** Prototype  
> **License:** AGPL v3  
> **Last updated:** 2026-09-03

---

## Table of Contents

1. [Overview & Background](#1-overview--background)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [User Roles & Personas](#3-user-roles--personas)
4. [System Architecture](#4-system-architecture)
5. [Data Model](#5-data-model)
6. [Request Lifecycle — State Machine](#6-request-lifecycle--state-machine)
7. [Feature Requirements](#7-feature-requirements)
8. [API & Route Reference](#8-api--route-reference)
9. [Authentication & Authorization](#9-authentication--authorization)
10. [Payment Integration — Wise](#10-payment-integration--wise)
11. [Document Management](#11-document-management)
12. [Reporting](#12-reporting)
13. [Known Gaps & Limitations](#13-known-gaps--limitations)
14. [Roadmap](#14-roadmap)

---

## 1. Overview & Background

### 1.1 What is TSP-NG?

TSP-NG (Travel Support Program — Next Generation) is a web application for managing travel sponsorship requests and expense reimbursements for free and open-source software (FOSS) organizations. It is developed by the openSUSE team at SUSE and targets reuse by organizations like GNOME (Conference Travel Subsidy Program) and KDE e.V. (Travel Cost Reimbursement).

### 1.2 Problem Statement

FOSS organizations routinely sponsor contributors to attend conferences, give talks, and represent the community. The existing process is managed through ad-hoc email threads, spreadsheets, and manual bank transfers. This leads to:

- **Opaque status** — requesters don't know where their request is in the pipeline
- **Slow turnaround** — manual handoffs between TSP committee, requester, and finance
- **No audit trail** — state changes and approvals are not systematically logged
- **Payment friction** — international transfers require manual SWIFT/IBAN entry and tracking
- **Reporting gaps** — no aggregate view of spend per event, per country, or over time

TSP-NG replaces the legacy Ruby on Rails application (root of this repository) with a lightweight Node.js prototype that can be iterated on rapidly.

### 1.3 Scope

This PRD covers the **full product vision** — what exists today in the prototype, what is missing, and what the target state looks like. The prototype lives in `prototype/`; the legacy Rails app at the repository root is retained for reference only.

---

## 2. Goals & Non-Goals

### 2.1 Goals

| # | Goal | Success Metric |
|---|---|---|
| G1 | **End-to-end request lifecycle** — from submission through approval, acceptance, document upload, and payment | A requester can complete the full cycle without leaving the app |
| G2 | **Role-based dashboards** — each role sees exactly what they need, nothing more | Three distinct dashboard views with actionable data |
| G3 | **Wise integration** — reduce international payment friction | Transfer creation via API, batch CSV generation, status tracking |
| G4 | **Audit trail** — every state change is logged with actor, timestamp, and notes | Complete state history visible on every request |
| G5 | **Financial reporting** — aggregate spend data by event, status, country, date range | Filterable reports with CSV export |
| G6 | **Portable architecture** — lightweight enough for small FOSS orgs to self-host | Single `npm start` to run; JSON file storage (no external DB required) |
| G7 | **Reusable across orgs** — not hardcoded to openSUSE | Configurable branding, no org-specific logic in core |

### 2.2 Non-Goals (for v1)

| # | Non-Goal | Rationale |
|---|---|---|
| NG1 | Multi-tenant SaaS | Each org runs their own instance |
| NG2 | OAuth/SSO integration | Demo login is sufficient for prototype; SSO is roadmap item |
| NG3 | Email notifications | Not wired up; manual check of dashboard is acceptable for v1 |
| NG4 | Budget caps per event/org | Useful but not blocking core workflow |
| NG5 | Mobile-native app | Responsive web is sufficient |
| NG6 | Multi-currency accounting/reporting | Reports show EUR by default; currency conversion is a roadmap item |

---

## 3. User Roles & Personas

### 3.1 Role Definitions

| Role | Label | Description | Permissions |
|---|---|---|---|
| `requester` | Requester | FOSS contributor applying for travel support | Create/edit own requests, upload documents, accept approved requests, submit for payment, manage profile |
| `tsp` | TSP Committee | Travel Support Program committee member | Review submitted requests, approve/reject with per-expense amounts, cancel requests, view reports, manage profile |
| `finance` | Finance | Payment/accounting team member | Process payments (Wise API, CSV, manual), view banking details, view reports, manage profile |

### 3.2 Personas

**Requester — "Douglas"**
- openSUSE contributor who speaks at conferences worldwide
- Wants to submit a request quickly, track its status, and get reimbursed without email follow-ups
- Needs to upload receipts/invoices after attending the event
- May not check the app daily; needs clear CTAs on dashboard for next actions

**TSP Committee — "Admin"**
- Reviews 5–20 requests per event cycle
- Needs to compare estimated vs. approved amounts across requests
- Wants a queue of pending requests sorted by age
- Needs per-event summaries to allocate budget

**Finance — "Finance Team"**
- Processes payments in batches after events conclude
- Needs to verify that all required documents are uploaded before paying
- Wants one-click Wise batch CSV generation
- Needs to track payment status across multiple transfers

---

## 4. System Architecture

### 4.1 Current (Prototype)

```
┌──────────────────────────────────────────────────┐
│                   Browser (EJS)                  │
│   login → dashboard → request detail → payments  │
└──────────────────────┬───────────────────────────┘
                       │ HTTP
┌──────────────────────▼───────────────────────────┐
│              Express.js (server.js)              │
│  Routes: auth, requests, approvals, payments,    │
│  comments, documents, digital form, events,      │
│  profile, reports                                │
├──────────────────────────────────────────────────┤
│              db.js (JSON-file engine)            │
│  Fake-SQL parser · tsp.json persistence          │
├──────────────────────────────────────────────────┤
│              wise-api.js                         │
│  Mock Wise API · CSV generation · status sim     │
└──────────────────────────────────────────────────┘
```

### 4.2 Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Node.js >= 18 | LTS required |
| Framework | Express 4.21 | Minimal, no abstraction layer |
| Templating | EJS 3.1 | Server-side rendered HTML |
| Session | express-session | Cookie-based, in-memory store |
| File upload | Multer 2.3 | Disk storage in `uploads/<request_id>/` |
| Database | JSON file (`tsp.json`) | Custom SQL-like engine in `db.js` |
| Payments | Wise API (mock) | Real API ready, currently simulated |
| Styling | Custom CSS | No framework; CSS variables design system |
| Auth | Session + role check | No password; click-to-login demo |

### 4.3 Project Structure

```
prototype/
├── server.js          # Express app — all routes (805 lines)
├── db.js              # JSON-file data layer with fake SQL engine
├── wise-api.js        # Wise API integration (mock + real-ready)
├── tsp.json           # Auto-generated data file (delete to reset)
├── package.json       # 4 dependencies: express, ejs, express-session, multer
├── views/             # EJS templates (13 files)
│   ├── partials/
│   │   ├── header.ejs
│   │   └── footer.ejs
│   ├── login.ejs
│   ├── dashboard.ejs
│   ├── new-request.ejs
│   ├── request-detail.ejs
│   ├── accept-request.ejs
│   ├── signed-form.ejs
│   ├── payments.ejs
│   ├── events.ejs
│   ├── new-event.ejs
│   ├── profile.ejs
│   └── reports.ejs
├── public/
│   └── style.css      # Complete design system (~700 lines)
├── uploads/           # Per-request document storage
└── README.md          # User-facing documentation
```

### 4.4 Deployment Model

The prototype is designed for single-machine deployment:

- `npm start` starts the server on port 3000 (configurable via `PORT` env)
- All data persists to `tsp.json` (delete to reset to seed data)
- Documents persist to `uploads/` directory
- No external services required (DB, cache, queue)
- Environment variables: `PORT`, `WISE_API_TOKEN`, `WISE_PROFILE_ID`

---

## 5. Data Model

### 5.1 Entity-Relationship Diagram

```
users ──1:N── requests ──1:N── expenses
                  │
                  ├──1:N── state_history
                  │
                  ├──1:N── comments
                  │
                  ├──1:N── documents
                  │
                  └──1:1── payments

events ──1:N── requests
```

### 5.2 Table Schemas

#### `users`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, auto-increment | Unique user identifier |
| `username` | TEXT | UNIQUE | Login handle (e.g., `admin`, `requester`, `finance`) |
| `password` | TEXT | — | Placeholder (unused in demo mode) |
| `full_name` | TEXT | — | Display name |
| `role` | TEXT | — | `tsp`, `requester`, or `finance` |
| `email` | TEXT | — | Contact email |
| `phone` | TEXT | — | Optional phone |
| `city` | TEXT | — | Optional city |
| `state` | TEXT | — | Optional state/province |
| `country` | TEXT | — | Optional country |
| `banking_method` | TEXT | NULLABLE | `iban`, `us_bank`, or `india_ifsc` |
| `bank_iban` | TEXT | — | IBAN (for `iban` method) |
| `bank_swift` | TEXT | — | SWIFT/BIC (for `iban` method) |
| `bank_account_no` | TEXT | — | Account number (for `us_bank` or `india_ifsc`) |
| `bank_routing_no` | TEXT | — | ABA routing (for `us_bank` method) |
| `bank_ifsc` | TEXT | — | IFSC code (for `india_ifsc` method) |
| `created_at` | TEXT | DEFAULT CURRENT_TIMESTAMP | Account creation time |

#### `events`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, auto-increment | Unique event identifier |
| `name` | TEXT | — | Event name (e.g., "FOSDEM 2026") |
| `location` | TEXT | — | City, Country |
| `start_date` | TEXT | — | ISO date (YYYY-MM-DD) |
| `end_date` | TEXT | — | ISO date (YYYY-MM-DD) |
| `accepting_requests` | INTEGER | 0 or 1 | Whether new requests can be created |
| `created_at` | TEXT | DEFAULT CURRENT_TIMESTAMP | Creation time |

#### `requests`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, auto-increment | Unique request identifier |
| `user_id` | INTEGER | FK → users.id | Requester |
| `event_id` | INTEGER | FK → events.id | Target event |
| `talk_url` | TEXT | NULLABLE | URL of the talk/presentation |
| `talk_title` | TEXT | NULLABLE | Title of the talk/presentation |
| `description` | TEXT | — | Free-text description of the request |
| `state` | TEXT | — | Current lifecycle state (see §6) |
| `approved_at` | TEXT | NULLABLE | Timestamp of TSP approval |
| `accepted_at` | TEXT | NULLABLE | Timestamp of requester acceptance |
| `accepted_by` | INTEGER | NULLABLE, FK → users.id | Who accepted (requester id) |
| `updated_at` | TEXT | — | Last modification timestamp |

#### `expenses`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, auto-increment | Unique expense identifier |
| `request_id` | INTEGER | FK → requests.id | Parent request |
| `category` | TEXT | — | `transportation` or `lodging` |
| `description` | TEXT | — | Free-text description |
| `estimated_amount` | REAL | — | Requester's estimated cost |
| `estimated_currency` | TEXT | DEFAULT 'EUR' | Currency of estimate |
| `approved_amount` | REAL | NULLABLE | TSP-approved amount |
| `approved_currency` | TEXT | NULLABLE | Currency of approval (EUR or USD) |

#### `payments`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, auto-increment | Unique payment identifier |
| `request_id` | INTEGER | FK → requests.id | Associated request |
| `amount` | REAL | — | Payment amount |
| `currency` | TEXT | — | Payment currency |
| `method` | TEXT | — | `wise-api`, `wise-csv`, or `bank-transfer` |
| `wise_transfer_id` | TEXT | NULLABLE | Wise transfer reference |
| `wise_status` | TEXT | NULLABLE | `processing`, `funds_decorrelated`, `success` |
| `recipient_name` | TEXT | — | Payee name |
| `recipient_email` | TEXT | — | Payee email |
| `payment_reference` | TEXT | — | Internal reference (e.g., `TSP-4`) |
| `created_at` | TEXT | DEFAULT CURRENT_TIMESTAMP | Payment initiation time |

#### `state_history`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, auto-increment | Unique entry identifier |
| `request_id` | INTEGER | FK → requests.id | Associated request |
| `from_state` | TEXT | NULLABLE | Previous state (null on creation) |
| `to_state` | TEXT | — | New state |
| `user_id` | INTEGER | FK → users.id | Who made the change |
| `notes` | TEXT | NULLABLE | Optional explanation |
| `created_at` | TEXT | DEFAULT CURRENT_TIMESTAMP | Transition time |

#### `comments`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, auto-increment | Unique comment identifier |
| `request_id` | INTEGER | FK → requests.id | Associated request |
| `user_id` | INTEGER | FK → users.id | Author |
| `body` | TEXT | — | Comment text |
| `created_at` | TEXT | DEFAULT CURRENT_TIMESTAMP | Post time |

#### `documents`

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PK, auto-increment | Unique document identifier |
| `request_id` | INTEGER | FK → requests.id | Associated request |
| `kind` | TEXT | — | `receipt`, `invoice`, or `signed_form` |
| `filename` | TEXT | — | Stored filename on disk |
| `original_name` | TEXT | — | Original upload filename |
| `mimetype` | TEXT | — | MIME type |
| `size` | INTEGER | — | File size in bytes |
| `uploaded_by` | INTEGER | FK → users.id | Who uploaded |
| `created_at` | TEXT | DEFAULT CURRENT_TIMESTAMP | Upload time |

### 5.3 Seed Data

On first run (when `users` table is empty), the system seeds:

**Users:**

| username | role | full_name | country |
|---|---|---|---|
| `admin` | `tsp` | TSP Admin | Germany |
| `requester` | `requester` | Douglas DeMaio | DE |
| `finance` | `finance` | Finance Team | Germany |

**Events:**

| name | location | dates | accepting_requests |
|---|---|---|---|
| openSUSE Conference 2026 | Nuremberg, Germany | 2026-06-15 → 2026-06-17 | yes |
| FOSDEM 2026 | Brussels, Belgium | 2026-02-01 → 2026-02-02 | yes |
| LinuxConf.au 2026 | Sydney, Australia | 2026-01-13 → 2026-01-17 | yes |
| openSUSE Conference 2027 | Prague, Czechia | 2027-06-14 → 2027-06-16 | yes |

To reset: delete `prototype/tsp.json` and restart the server.

---

## 6. Request Lifecycle — State Machine

### 6.1 State Definitions

| State | Owner | Description |
|---|---|---|
| `draft` | Requester | Request is being edited. Fully editable. Not visible to TSP. |
| `submitted` | TSP queue | Requester has submitted for review. Locked from requester edits. |
| `approved` | Requester action needed | TSP has approved with per-expense amounts. Awaiting requester acceptance. |
| `rejected` | Terminal | TSP has rejected the request. No further action possible. |
| `accepted` | Requester action needed | Requester has confirmed attendance, CoC, and TSP rules. Awaiting document uploads. |
| `submitted_for_payment` | Finance queue | All 3 required documents uploaded. Ready for finance to process. |
| `paid` | Terminal | Payment confirmed via Wise API or manual entry. |
| `cancelled` | Terminal | Cancelled by requester (from draft/submitted/approved) or TSP (from submitted/approved). |

### 6.2 State Transitions

```
                  ┌──────────┐
                  │  (new)   │
                  └────┬─────┘
                       │ create
                       ▼
                  ┌──────────┐
          ┌──────│  draft   │──────┐
          │      └────┬─────┘      │
          │ edit      │ submit     │ cancel
          │      ┌────▼─────┐      │
          │      │submitted │      │
          │      └──┬───┬───┘      │
          │  reject │   │ approve  │
          │   ┌─────▼┐  │          │
          │   │rejected│ │          │
          │   └───────┘  ▼          │
          │           ┌──────────┐  │
          │           │ approved │  │
          │           └────┬─────┘  │
          │                │ accept │
          │           ┌────▼──────┐ │
          │           │ accepted  │ │
          │           └────┬──────┘ │
          │                │ submit │
          │           ┌────▼────────────┐
          │           │submitted_for_pay│
          │           └────┬────────────┘
          │                │ pay
          │           ┌────▼─────┐
          │           │   paid   │
          │           └──────────┘
          │
    ┌─────▼──────┐
    │ cancelled  │
    └────────────┘
```

### 6.3 Transition Rules

| From | To | Actor | Trigger | Notes |
|---|---|---|---|---|
| *(create)* | `draft` | Requester | POST `/requests` | Request created with expenses |
| `draft` | `submitted` | Requester (owner) | POST `/requests/:id/submit` | Locks request from edits |
| `draft` | `cancelled` | Requester (owner) or TSP | POST `/requests/:id/cancel` | |
| `submitted` | `approved` | TSP | POST `/requests/:id/approve` | Sets per-expense approved amounts |
| `submitted` | `rejected` | TSP | POST `/requests/:id/reject` | Terminal state |
| `submitted` | `cancelled` | TSP | POST `/requests/:id/cancel` | |
| `approved` | `accepted` | Requester (owner) | POST `/requests/:id/accept` | Requires 4 checkbox confirmations |
| `approved` | `cancelled` | Requester (owner) or TSP | POST `/requests/:id/cancel` | |
| `accepted` | `submitted_for_payment` | Requester (owner) | POST `/requests/:id/submit-for-payment` | Requires all 3 document types |
| `submitted_for_payment` | `paid` | Finance | POST `/payments/create` | Via Wise API or manual |

### 6.4 Editability Rules

| State | Can Requester Edit? | Can TSP Edit? |
|---|---|---|
| `draft` | Yes (full edit) | No (can cancel) |
| `submitted` | Yes (full edit) | No (can approve/reject/cancel) |
| `approved` | No (locked) | No (can cancel) |
| `accepted` | No (locked) | No |
| `submitted_for_payment` | No (locked) | No |
| `paid` | No | No |
| `rejected` | No | No |
| `cancelled` | No | No |

---

## 7. Feature Requirements

### 7.1 Authentication

**Current state:**
- Click-to-login demo: user selects a pre-seeded account from a card grid
- No password verification
- Session-based via `express-session` (cookie, in-memory store)
- Logout destroys session

**Target state:**
- Username/password authentication with bcrypt hashing
- Optional SSO/OAuth integration (Keycloak, GitHub, Google)
- Session persistence to a backing store (Redis or database)
- CSRF protection on all POST routes
- Rate limiting on login attempts

### 7.2 Role-Based Dashboards

**Current state:**

| Role | Dashboard Content |
|---|---|
| Requester | My requests list (cards), action-needed banners for approved/accepted states, "New Request" CTA |
| TSP | Pending review queue (oldest 20, table), event summary for last 90 days, aggregate counts by state, approved funds total |
| Finance | Submitted-for-payment queue (cards with doc counts), recently paid table, summary totals |

**Target state:**
- Pagination on all list views (currently capped at 20)
- Real-time updates via WebSocket or polling (state changes visible without refresh)
- Notification badges for pending actions
- Configurable dashboard widgets per role

### 7.3 Request Creation & Editing

**Current state:**
- Form with 4 sections: Event (dropdown), Talk (title + URL), Expenses (dynamic rows with category/description/amount/currency), Description
- Dynamic expense row add/remove via client-side JS
- Currency selection from 19-option datalist
- Edit mode reuses the same form template
- Requests remain editable through `draft` and `submitted` states

**Target state:**
- Expense categories expanded beyond `transportation` and `lodging` (meals, registration, visa fees, other)
- File attachment during creation (not just post-approval)
- Expense line items with receipt upload per item
- Duplicate request feature (clone a past request for the same event)
- Auto-save drafts
- Validation feedback (inline, not just redirect)

### 7.4 TSP Review & Approval

**Current state:**
- Per-expense approval form with amount and currency (EUR/USD) inputs
- Approve or reject buttons with notes textarea
- Approval locks the request from further edits
- State history logged

**Target state:**
- Batch approve/reject multiple requests at once
- Approval templates (pre-set common approval amounts)
- Conditional approval (approve with conditions noted)
- Budget remaining display during approval
- Email notification to requester on approval/rejection

### 7.5 Requester Acceptance

**Current state:**
- 4 required checkboxes: attendance confirmation, expense accuracy, Code of Conduct, TSP rules
- 6-point guidance box explaining what acceptance means
- 5-step progress timeline visual
- Acceptance moves request to `accepted` state

**Target state:**
- Digital signature capture (canvas-based)
- Acceptance deadline (auto-expire after N days)
- Conditional acceptance (accept with modifications)

### 7.6 Comments & Communication

**Current state:**
- Simple comment thread on request detail page
- Comment form with textarea
- Comments visible to requester, TSP, and finance
- Chronological ordering

**Target state:**
- Internal notes (visible only to TSP/finance, not requester)
- @-mention support
- Email notification on new comment
- Comment editing/deletion
- Rich text formatting

### 7.7 Events Management

**Current state:**
- Event list with date range filter
- Event cards with name, location, dates, "Apply for Travel Support" CTA
- New event form (name, location, start/end dates)
- Past events shown dimmed with "PAST" badge
- `accepting_requests` flag per event

**Target state:**
- Event editing and deletion
- Budget allocation per event
- Event templates (recurring events)
- Event-level request deadlines
- Event archiving

### 7.8 Profile & Banking

**Current state:**
- Profile page with personal info (name, email, phone, city, state, country)
- Banking method selector with conditional field groups:
  - International: IBAN + SWIFT/BIC
  - United States: Account number + ABA routing
  - India: Account number + IFSC code
- Validation (required fields per method)
- `bankingSummary()` helper for display across views

**Target state:**
- Multiple banking methods per user (e.g., IBAN for EUR, US account for USD)
- Banking details encrypted at rest
- IBAN validation (format + checksum)
- Profile picture/avatar upload

### 7.9 Digital Signable Form

**Current state:**
- Printable reimbursement agreement at `/requests/:id/form`
- Branded header ("openSUSE Travel Support Program — Reimbursement Agreement")
- Approved expenses table with per-currency totals
- Signature line with name, total, and date fields
- Print button with print-specific CSS

**Target state:**
- PDF generation (server-side, not just browser print)
- Digital signature capture and embedding
- Template customization per org
- Auto-generated form after approval (no manual trigger)

---

## 8. API & Route Reference

### 8.1 Authentication Routes

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/login` | No | — | Render login page with user cards |
| POST | `/login` | No | — | Set session, redirect to `/` |
| GET | `/logout` | Yes | Any | Destroy session, redirect to `/login` |

### 8.2 Dashboard

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/` | Yes | Any | Role-specific dashboard |

### 8.3 Request Routes

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/requests/new` | Yes | requester, tsp | New request form |
| POST | `/requests` | Yes | requester | Create new request (draft) |
| GET | `/requests/:id` | Yes | Any (owner or staff) | Request detail view |
| GET | `/requests/:id/edit` | Yes | Owner (draft/submitted) | Edit request form |
| POST | `/requests/:id/edit` | Yes | Owner (draft/submitted) | Update request |
| POST | `/requests/:id/submit` | Yes | Owner (draft) | Submit for review |
| POST | `/requests/:id/approve` | Yes | tsp | Approve with amounts |
| POST | `/requests/:id/reject` | Yes | tsp | Reject request |
| POST | `/requests/:id/cancel` | Yes | Owner or tsp | Cancel request |
| GET | `/requests/:id/accept` | Yes | Owner (approved) | Acceptance page |
| POST | `/requests/:id/accept` | Yes | Owner (approved) | Confirm acceptance |
| POST | `/requests/:id/submit-for-payment` | Yes | Owner (accepted) | Submit for payment |
| POST | `/requests/:id/comments` | Yes | Owner or staff | Add comment |
| GET | `/requests/:id/form` | Yes | Owner, tsp, finance | Printable form |

### 8.4 Document Routes

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| POST | `/requests/:id/documents` | Yes | Owner or staff | Upload document |
| GET | `/documents/:id/download` | Yes | Owner, tsp, finance | Download document |

### 8.5 Payment Routes

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/payments` | Yes | finance | Payments dashboard |
| POST | `/payments/create` | Yes | finance | Process payment (Wise/CSV/manual) |
| POST | `/payments/generate-csv` | Yes | finance | Download Wise batch CSV |
| GET | `/payments/:id/status` | Yes | finance | Get Wise transfer status (JSON) |

### 8.6 Event Routes

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/events` | Yes | Any | Event list with filters |
| GET | `/events/new` | Yes | Any | New event form |
| POST | `/events` | Yes | Any | Create event |

### 8.7 Profile Routes

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/profile` | Yes | Any | Profile form |
| POST | `/profile` | Yes | Any | Update profile |

### 8.8 Report Routes

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/reports` | Yes | tsp, finance | Report page with filters |
| GET | `/reports?format=csv` | Yes | tsp, finance | CSV export |

### 8.9 Wise API Routes

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/wise/currencies` | Yes | Any | List supported currencies (JSON) |

---

## 9. Authentication & Authorization

### 9.1 Current Implementation

**Authentication:**
- No credentials required; user selects an account from the login page
- Session cookie set on POST `/login` with `userId`
- `auth` middleware checks `req.session.userId` and loads user from DB
- Unauthenticated users redirected to `/login`

**Authorization:**
- `requireRole(...roles)` middleware checks `req.user.role`
- Route-level enforcement (not model-level)
- Owner checks: `request.user_id === req.user.id` for request-specific routes

### 9.2 Authorization Matrix

| Action | Requester | TSP | Finance |
|---|---|---|---|
| Create request | ✓ (own) | ✓ | — |
| Edit request | ✓ (own, draft/submitted) | — | — |
| Submit for review | ✓ (own, draft) | — | — |
| Approve request | — | ✓ | — |
| Reject request | — | ✓ | — |
| Cancel request | ✓ (own) | ✓ (any) | — |
| Accept request | ✓ (own, approved) | — | — |
| Submit for payment | ✓ (own, accepted) | — | — |
| Upload documents | ✓ (own) | ✓ (any) | ✓ (any) |
| Download documents | ✓ (own) | ✓ (any) | ✓ (any) |
| View printable form | ✓ (own) | ✓ (any) | ✓ (any) |
| Process payment | — | — | ✓ |
| Generate batch CSV | — | — | ✓ |
| View reports | — | ✓ | ✓ |
| Create event | ✓ | ✓ | ✓ |
| Edit profile | ✓ (own) | ✓ (own) | ✓ (own) |

### 9.3 Gaps & Target

| Gap | Impact | Target |
|---|---|---|
| No password auth | Anyone with URL can log in as any user | bcrypt password hashing |
| No CSRF protection | POST routes vulnerable to cross-site requests | `csurf` middleware or double-submit cookie |
| No session store persistence | Server restart kills all sessions | Redis or DB-backed session store |
| Role checks at route level only | Model-layer mutations bypass authorization | Service layer with permission checks |
| No rate limiting | Brute-force login possible (once passwords exist) | `express-rate-limit` on auth routes |

---

## 10. Payment Integration — Wise

### 10.1 Current Implementation

Three payment methods are available:

**1. Wise API Transfer (`wise-api`)**
- Configured via `WISE_API_TOKEN` and `WISE_PROFILE_ID` env vars
- Currently mocked: generates `WISE-{timestamp}-{random}` transfer IDs
- Mock status progression: `processing` → `funds_decorrelated` → `success`
- Each status poll advances by one step (simulates async processing)
- Exchange rate simulated at 0.95

**2. Wise Batch CSV (`wise-csv`)**
- One-click download of `Send-by-email.csv` format
- Includes all submitted-for-payment requests
- Columns: name, recipientEmail, paymentReference, receiverType, amountCurrency, amount, sourceCurrency, targetCurrency, type
- Reference format: `TSP-{request_id}-{timestamp}`

**3. Manual Bank Transfer (`bank-transfer`)**
- No automated processing
- Finance records the payment manually in the system
- No Wise status tracking

### 10.2 Supported Currencies

EUR, USD, GBP, BRL, CZK, PLN, AUD, INR, IDR, JPY

### 10.3 Wise API Endpoints (when real API is enabled)

| Function | Wise Endpoint | Description |
|---|---|---|
| `getCurrencies()` | `GET /v1/currencies` | List supported currencies |
| `createTransfer()` | `POST /v3/transfers` | Create a new transfer |
| `getTransferStatus()` | `GET /v1/transfers/:id` | Check transfer status |

### 10.4 Gaps & Target

| Gap | Impact | Target |
|---|---|---|
| Mock transfers only | No real money movement | Wire to live Wise API with proper auth |
| No transfer cancellation | Cannot undo a payment | Add `cancelTransfer()` API call |
| No exchange rate locking | Rate may change between approval and payment | Lock rate at approval time |
| No payment reconciliation | No way to match Wise confirmations to requests | Webhook endpoint for Wise callbacks |
| No multi-currency reporting | Reports show EUR only | Per-currency totals and conversion |

---

## 11. Document Management

### 11.1 Current Implementation

**Document Types:**

| Kind | Label | Required for Payment | Description |
|---|---|---|---|
| `receipt` | Receipt | Yes | Proof of expense (boarding pass, hotel bill, etc.) |
| `invoice` | Invoice | Yes | Formal invoice from vendor |
| `signed_form` | Signed Form | Yes | Printed and signed reimbursement agreement |

**Storage:**
- Files stored on disk at `uploads/<request_id>/`
- Filenames prefixed with timestamp for uniqueness
- Original filenames preserved in DB for download
- Metadata (kind, size, mimetype, uploader) stored in `documents` table

**Upload Flow:**
1. Requester navigates to request detail
2. Selects document type from dropdown
3. Chooses file via file input
4. POST to `/requests/:id/documents`
5. Multer saves to disk, DB record created
6. Redirect back to request detail

**Download Flow:**
1. User clicks download link in documents table
2. GET `/documents/:id/download`
3. Ownership/role check performed
4. File streamed from disk with original filename

**Payment Gate:**
- "Submit for Payment" button checks for all 3 document types
- Missing types listed in error message
- All 3 required before transition to `submitted_for_payment`

### 11.2 Gaps & Target

| Gap | Impact | Target |
|---|---|---|
| No file type validation | Could upload executable files | Whitelist PDF, JPG, PNG, TIFF |
| No file size limits | Could exhaust disk space | 10MB per file, 50MB per request |
| No virus scanning | Uploaded files could contain malware | ClamAV or similar integration |
| No image preview | Must download to view | Inline preview for images and PDFs |
| No document versioning | Overwriting requires re-upload | Version history per document |
| Disk-only storage | No backup strategy | R2/S3-compatible storage backend |

---

## 12. Reporting

### 12.1 Current Implementation

**Available to:** TSP and finance roles

**Filters:**
- Event date range (from/to)
- Status (all, cancelled, rejected, accepted, submitted_for_payment, paid)

**Report Columns:**
Date, Event (link), Event Location, Recipient, Recipient Country, Status (badge), Approved Amount, Paid Amount, Payment Method

**Summary Cards:**
- Total requests in range
- Total approved (EUR)
- Total paid (EUR)

**Export:**
- CSV download with all columns
- Triggered via "Download CSV" button (adds `format=csv` to query string)

### 12.2 Dashboard-Level Reports

**TSP Dashboard:**
- Per-event status breakdown (counts per state)
- Running approved funds total
- Pending review queue with estimated totals

**Finance Dashboard:**
- Submitted-for-payment queue with approved totals and doc counts
- Recently paid list
- Aggregate paid amount

### 12.3 Gaps & Target

| Gap | Impact | Target |
|---|---|---|
| No budget tracking | Cannot set or monitor per-event budgets | Budget fields on events with remaining calculation |
| No country-level aggregation | Cannot analyze geographic distribution | Pivot tables by country |
| No date-range presets | Must manually enter dates | "This month", "This quarter", "This year" presets |
| No PDF report export | CSV only | PDF with charts and summaries |
| No historical comparison | Cannot compare across events/years | Year-over-year and event-over-event comparisons |
| No approval rate metrics | No visibility into TSP decision patterns | Approval/rejection rates by event, requester, category |

---

## 13. Known Gaps & Limitations

### 13.1 Critical

| # | Gap | Area | Impact | Effort |
|---|---|---|---|---|
| C1 | **No real authentication** | Security | Anyone can impersonate any user | Medium |
| C2 | **JSON file database** | Data | No concurrent access safety; data loss on crash; no transactions | High |
| C3 | **No CSRF protection** | Security | POST routes vulnerable to cross-site request forgery | Low |
| C4 | **In-memory session store** | Reliability | All sessions lost on server restart | Low |

### 13.2 High Priority

| # | Gap | Area | Impact | Effort |
|---|---|---|---|---|
| H1 | **No email notifications** | UX | Users must check dashboard manually for updates | Medium |
| H2 | **No pagination** | UX | Lists capped at 20; cannot handle large datasets | Low |
| H3 | **No file type validation** | Security | Unrestricted file uploads | Low |
| H4 | **No input validation** | Reliability | Malformed data can crash the SQL parser | Medium |
| H5 | **SQL parser fragility** | Reliability | Regex-based SQL parsing; edge cases in WHERE/IN clauses | High |
| H6 | **No API layer** | Architecture | All data access via server-rendered HTML; no mobile/third-party integration | High |

### 13.3 Medium Priority

| # | Gap | Area | Impact | Effort |
|---|---|---|---|---|
| M1 | **No expense categories beyond transportation/lodging** | Feature | Cannot request meals, registration, visa fees | Low |
| M2 | **No event editing/deletion** | Feature | Events cannot be corrected after creation | Low |
| M3 | **No request duplication** | UX | Requesters must re-enter similar requests manually | Low |
| M4 | **No batch operations for TSP** | UX | Must approve/reject one at a time | Medium |
| M5 | **No internal notes** | Feature | TSP/finance cannot communicate privately | Low |
| M6 | **No auto-save drafts** | UX | Long forms lost on browser close | Medium |
| M7 | **Print-only PDF generation** | Feature | No server-side PDF; relies on browser print dialog | Medium |

### 13.4 Low Priority

| # | Gap | Area | Impact | Effort |
|---|---|---|---|---|
| L1 | **No dark mode** | UX | Minor aesthetic preference | Low |
| L2 | **No keyboard navigation** | Accessibility | Power users cannot navigate without mouse | Medium |
| L3 | **No ARIA attributes** | Accessibility | Screen reader support incomplete | Medium |
| L4 | **No i18n** | Feature | English only; limits international org adoption | High |
| L5 | **No test coverage** | Quality | No automated tests exist | High |
| L6 | **No CI/CD** | DevOps | No automated build/test pipeline | Medium |

### 13.5 Technical Debt

| # | Item | Location | Notes |
|---|---|---|---|
| T1 | All routes in single file | `server.js` (805 lines) | Should be split into route modules |
| T2 | No separation of concerns | `server.js` | Business logic mixed with route handlers |
| T3 | Custom SQL parser | `db.js` | Regex-based; should migrate to SQLite or better-sqlite3 |
| T4 | Hardcoded session secret | `server.js:36` | `'tsp-prototype-secret'` should be env var |
| T5 | No error handling middleware | `server.js` | Unhandled errors return raw stack traces |
| T6 | Unused `Gemfile` at root | Root | Legacy Rails app; should be moved to archive branch |

---

## 14. Roadmap

### Phase 1 — Production Readiness (v1.0)

**Goal:** Make the prototype deployable for real use by a small FOSS org.

| Task | Priority | Effort | Notes |
|---|---|---|---|
| Replace JSON DB with SQLite (`better-sqlite3`) | Critical | High | Drop-in replacement for `db.js`; synchronous API matches current patterns |
| Add password authentication (bcrypt) | Critical | Medium | Registration flow + login form with password field |
| Add CSRF protection | Critical | Low | `csurf` middleware or double-submit cookie pattern |
| Redis-backed sessions | High | Low | `connect-redis` for persistent sessions |
| File upload validation | High | Low | Whitelist MIME types, enforce size limits |
| Route modularization | High | Medium | Split `server.js` into `routes/requests.js`, `routes/payments.js`, etc. |
| Error handling middleware | High | Low | Catch-all error handler with safe responses |
| Environment variable config | High | Low | Move all secrets/ports to env vars with `.env` support |
| Pagination on list views | High | Low | Offset/limit on all query routes |
| Input validation library | Medium | Low | `zod` or `joi` for request body validation |

### Phase 2 — Feature Completion (v1.5)

**Goal:** Fill the most-requested feature gaps.

| Task | Priority | Effort | Notes |
|---|---|---|---|
| Email notifications | High | Medium | Transactional email via SMTP or Resend/SendGrid |
| Expense categories expansion | Medium | Low | Add meals, registration, visa, other |
| Event editing and deletion | Medium | Low | CRUD for events |
| Request duplication | Medium | Low | Clone button on request detail |
| Internal notes for TSP/finance | Medium | Low | Separate comment type, hidden from requester |
| Batch approve/reject | Medium | Medium | Checkbox selection + bulk action on pending queue |
| Document type validation | Medium | Low | Server-side MIME check + client-side preview |
| Report date presets | Low | Low | Quick filters: this month, this quarter, this year |
| Auto-save drafts | Low | Medium | Periodic localStorage sync or server-side draft endpoint |

### Phase 3 — Scale & Polish (v2.0)

**Goal:** Support multiple organizations and production-grade operations.

| Task | Priority | Effort | Notes |
|---|---|---|---|
| Multi-org support | High | High | Org-scoped data, configurable branding |
| SSO/OAuth integration | High | Medium | Keycloak, GitHub, Google OAuth |
| Real Wise API integration | High | Medium | Live transfers with webhook callbacks |
| PDF generation (server-side) | Medium | Medium | `pdfkit` or `puppeteer` for signed forms and reports |
| API layer (REST/JSON) | Medium | High | Enable mobile clients and third-party integrations |
| WebSocket real-time updates | Medium | Medium | Live dashboard updates without page refresh |
| i18n support | Low | High | `i18next` for multi-language UI |
| Test suite | High | High | Unit tests for business logic, integration tests for routes |
| CI/CD pipeline | Medium | Medium | GitHub Actions for test + deploy |
| WCAG 2.1 AA compliance | Medium | Medium | ARIA, keyboard nav, color contrast audit |

### Phase 4 — Advanced (v3.0)

| Task | Effort | Notes |
|---|---|---|
| Budget management per event/org | Medium | Set caps, track remaining, alert on overage |
| Multi-currency reporting with conversion | High | Real-time FX rates, per-currency rollups |
| Approval templates | Low | Pre-configured approval amounts for common expense patterns |
| Acceptance deadlines | Low | Auto-expire unaccepted approvals |
| Digital signature capture | Medium | Canvas-based signature embedded in PDF |
| Webhook integrations | Medium | Slack/Discord notifications, Mattermost |
| Mobile-responsive PWA | Medium | Offline-capable, installable |
| Audit log export | Low | Compliance-ready export of all state changes |

---

## Appendix A: Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server listening port |
| `WISE_API_TOKEN` | (mock) | Wise API bearer token |
| `WISE_PROFILE_ID` | (mock) | Wise business profile ID |
| `SESSION_SECRET` | *(hardcoded)* | **To be added:** session signing secret |
| `DATABASE_URL` | *(none)* | **To be added:** SQLite file path or connection string |

## Appendix B: Supported Currencies

EUR, USD, GBP, BRL, CZK, PLN, AUD, INR, IDR, JPY

## Appendix C: Expense Categories

| Category | Label | Description |
|---|---|---|
| `transportation` | Transportation | Flights, trains, buses, taxis, ride-sharing |
| `lodging` | Lodging | Hotel, hostel, Airbnb, other accommodation |
| `meals` | Meals | **Planned:** Food and beverage during event |
| `registration` | Registration | **Planned:** Conference fees, workshop fees |
| `visa` | Visa Fees | **Planned:** Visa application and processing fees |
| `other` | Other | **Planned:** Miscellaneous event-related expenses |
