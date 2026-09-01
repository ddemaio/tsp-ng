# Travel Support Program ## Proposed Content

### 1. Header
- Title: `# TSP-NG — Travel Support Program (Next Generation)`
- AGPL v3 badge

### 2. About
- What it does: travel sponsorship request & reimbursement management for FOSS orgs (openSUSE, GNOME, KDE)
- Who it's for: TSP committees, requesters, finance teams
- The `prototype/` directory is the new Node.js rewrite replacing the legacy Rails app at root

### 3. Architecture
- `prototype/` — Express + EJS + JSON-file DB, 3 roles, Wise integration
- Root — legacy Rails app (reference only), `doc/` has its guides

### 4. Requirements
- Node.js >= 18
- npm
- (Optional) Wise API credentials for real payments

### 5. Quick Start
```bash
cd prototype
npm install
npm start
# Open http://localhost:3000
```

Demo accounts table:
| Account | Role | Password | What they do |
|---|---|---|---|
| admin | TSP committee | admin | Review requests, approve/reject, set amounts |
| requester | Requester | requester | Submit requests, upload docs, accept grants |
| finance | Finance | finance | Pay via Wise or batch CSV, view banking |

### 6. User Roles (expanded)
- **requester** — submit travel sponsorship requests with expenses, upload receipts/invoices/signed forms, accept approved grants, submit for payment
- **tsp** — review submitted requests, set approved amounts per expense (EUR/USD), approve or reject, cancel
- **finance** — process payments via Wise API or batch CSV, view payout banking details, mark as paid

### 7. Request Lifecycle (State Flow)
```
draft → submitted → approved → accepted → submitted_for_payment → paid
                      ↓                      ↓
                   rejected              cancelled
```
- `draft`: requester edits freely
- `submitted`: locked, awaiting TSP review
- `approved`: TSP sets approved amounts
- `accepted`: requester confirms attendance, CoC, TSP rules (4 confirmations required)
- `submitted_for_payment`: all 3 documents uploaded, ready for finance
- `paid`: payment confirmed via Wise or manual

Also: `rejected` (TSP rejects from submitted), `cancelled` (requester or TSP cancels from draft/submitted/approved)

### 8. Wise Payment Integration
Three options wired into the UI:
1. **Wise API Transfer** — set `WISE_API_TOKEN` and `WISE_PROFILE_ID` env vars, creates transfer programmatically
2. **Wise Batch CSV** — one-click download of `Send-by-email.csv` format for all submitted-for-payment requests
3. **Manual bank transfer** — fallback option

### 9. Documents & Digital Form
- Every request has a documents section
- Upload types: **Receipt**, **Invoice**, **Signed Form**
- Stored in `prototype/uploads/<request_id>/`
- Printable digital form at `/requests/:id/form` — states TSP purpose, approved total, requester name, signature line
- All 3 document types required before "Submit for Payment"
- Finance can view and download all documents

### 10. Profile & Banking
Every user has `/profile` with:
- Name, email, phone, city, state, country
- Banking method selection:
  - **International** — IBAN + SWIFT/BIC
  - **United States** — bank account + ABA routing number
  - **India** — bank account + IFSC code

### 11. Financial Reports (`/reports`)
- Available to TSP and finance roles
- Filter by date range (event dates) and status
- Shows: amount spent, event location, recipient country
- Summary totals (approved + paid)
- One-click CSV export

### 12. Configuration
| Variable | Purpose |
|---|---|
| `PORT` | Server port (default: 3000) |
| `WISE_API_TOKEN` | Wise API bearer token for real transfers |
| `WISE_PROFILE_ID` | Wise business profile ID |

- Data: `prototype/tsp.json` (delete to reset to seed data)
- Uploads: `prototype/uploads/` (per-request document storage)

### 13. Project Structure
```
prototype/
  server.js      Express app: auth, requests, approvals, payments, comments,
                 documents, digital form, events, profile, reports
  db.js          JSON-file data layer (SQL-like engine, auto-seeding)
  wise-api.js    Wise integration (currencies, transfers, batch CSV, status)
  tsp.json       Auto-generated data file (delete to reset)
  views/         EJS templates: login, dashboard, new-request, request-detail,
                 accept-request, signed-form, payments, events, new-event,
                 profile, reports
  public/        Static CSS
  uploads/       Request documents (receipts, invoices, signed forms)
```

### 14. Maintenance & Troubleshooting
- **Reset data**: delete `prototype/tsp.json`, restart server
- **Add new state transitions**: edit state flow in `server.js` (POST routes for `/requests/:id/submit`, `/approve`, `/reject`, `/accept`, `/cancel`, `/submit-for-payment`)
- **Add new document types**: update `DOC_KINDS` and `DOC_LABELS` arrays in `server.js`
- **Wise API setup**: obtain API token from wise.com, set profile ID, uncomment real API calls in `wise-api.js`
- **Change port**: set `PORT` env var
- **File uploads**: stored in `uploads/<request_id>/`, manually manageable on disk

### 15. Legacy Rails App
The original Ruby on Rails application remains at the repository root for reference.
See documentation in `doc/`:
- `doc/ABOUT.md` — detailed "6 Ws" explanation
- `doc/INSTALL.md` — Rails installation guide
- `doc/DOCKER.md` — Docker development setup
- `doc/USERGUIDE.md` — end-user guide

### 16. License
GNU Affero General Public License v3 (AGPL v3). See the [LICENSE](LICENSE) file for more info
