# Travel Support Program — Prototype

A working prototype of a rethought Travel Support Program (TSP), replacing the
legacy Rails app with a modern, maintainable flow and Wise-integrated payments.

## Run it

```bash
cd prototype
npm install
npm start
```

Open http://localhost:3000 and pick a demo account:

| Account | Role | What they do |
|---|---|---|
| `admin`    | TSP committee | Review requests, set approved amounts, approve/reject |
| `requester`| Speaker       | Submit requests with talk URL, accept approved grants |
| `finance`  | Payments      | Pay via Wise API or batch CSV |

The prototype stores data in `tsp.json` (auto-seeded). Delete it to reset.

## What's different from the Rails app

### Simpler, clearer model
- No STI hierarchy, no state_machine gem, no 7 roles. One `requests` table with a
  plain state string (`draft → submitted → approved → accepted →
  submitted_for_payment → paid`) plus a state-history timeline.
- Three roles only: **requester** (anyone), **tsp** (committee), **finance** (payments).

### Wise payment automation (`wise-api.js`)
Three integration options, all wired into the UI:
1. **Wise API Transfer** — create a transfer programmatically. Swap the mock
   `createTransfer` for the real `POST /v1/transfers` call (set `WISE_API_TOKEN`
   and `WISE_PROFILE_ID`). Payment status is pollable via `/payments/:id/status`.
2. **Wise Batch CSV** — one click downloads a `Send-by-email` batch CSV for all
   submitted-for-payment requests, matching the format in the repo's `Send-by-email.csv`.
3. **Bank transfer** — manual fallback.

### Requester inputs
- **Talk URL** — optional link plus talk title on every request. Surfaced to
  reviewers on the dashboard card (with a "View Talk" link) and the detail page.
- **Editable until approved** — requesters can edit drafts and submitted requests
  at `/requests/:id/edit`; requests lock once approved.
- **Comments** — requesters and reviewers (TSP committee + finance) can exchange
  comments on a request before/after approval.
- **Clear acceptance flow** — when approved, the requester lands on a dedicated
  page with the "Before You Accept" checklist, a step-by-step "What Happens Next"
  timeline, the approved amounts, and four explicit confirmations (attendance,
  expense details, the openSUSE **Code of Conduct**, and the **TSP rules**) before
  the grant is accepted.
- **Event input by anyone** — TSP committee AND requesters can add events via
  `/events/new`; events default to accepting requests.

### Documents & digital form
- Every request has a **documents** section: uploads are typed as **Receipt**,
  **Invoice**, or **Signed Form** (saved under `uploads/<request_id>/`).
- A printable **digital form** (`/requests/:id/form`) states the TSP purpose,
  the approved total, and the requester's name with a signature line — it is
  signed, saved as PDF, and uploaded as the Signed Form.
- **Finance sees and downloads all documents** from the payments page and the
  request detail page (TSP and the owner can also download).

### Request types fixed
- Expenses are restricted to exactly two categories: **Transportation**
  (plane/train/bus) and **Lodging** (hotel/Airbnb). Taxis, meals, registration,
  etc. are not covered.

### Currency handling
- Requesters enter expenses in **their local currency** (free-form ISO code with
  suggestions — BRL, INR, IDR, JPY, etc.).
- Approvals are made only in **EUR or USD** — the TSP reviewer sets each approved
  amount and picks EUR or USD.

### Events (past hidden, searchable)
- The events page shows **upcoming events only** by default; **past events are
  hidden** and can be searched by date range (from/to).
- Available to requesters, TSP committee, and finance. Events can be added by
  **TSP committee and requesters** (`/events/new`).

### Profile & banking
- Every user has a profile (`/profile`) with name, email, phone, city, state,
  and country.
- Banking details support the systems used in different countries:
  - **International** — IBAN + SWIFT/BIC
  - **United States** — bank account + ABA routing number
  - **India** — bank account + **IFSC code** (India's specific bank identifier)
- The finance team sees payout banking details on each accepted request.

### Cancellations
- Requesters can cancel their own draft/submitted requests; TSP can cancel
  submitted or approved ones. Cancelled requests stay on record for reporting.

### Submit for payment (closes the loop)
- After an accepted request has all three required documents uploaded
  (**receipt**, **invoice**, **signed form**), the requester explicitly presses
  **Submit for payment**, moving the request from `accepted` to
  `submitted_for_payment`. Submitting without all documents shows which ones are
  missing; documents can still be added afterwards.

### Role dashboards (`/`)
- **TSP** — up to 20 oldest pending (submitted) requests at a glance, plus a
  per-event status overview for events in the last 90 days: counts per state and
  a running total of approved funds.
- **Finance** — a "submitted for payment" queue (with document count and payout
  banking details), the amount awaiting payment, and recently paid requests with
  the total paid out.
- **Requester** — their requests with an "action needed" hint when a request
  needs acceptance or submission for payment.

### Financial reports (`/reports` — TSP + finance)
- Generate a report by selecting a **date range** (event dates) and a status
  filter: **cancelled, rejected, accepted, submitted for payment, or accepted & paid**.
- The report shows **amount spent**, **event location**, and the **recipient's
  country**, with summary totals (approved + paid) and one-click **CSV export**.

## File map

```
server.js      Express app: auth, request/approval/accept/payment routes,
               comments, documents, digital form, events, profile, reports
db.js          JSON-file data layer (auto-seeding, profile/banking migration)
wise-api.js    Wise integration (currencies, transfers, batch CSV, status)
views/         EJS templates: login, dashboard, new-request, request-detail,
               accept-request, signed-form, payments, events, new-event,
               profile, reports
public/        CSS
uploads/       Request documents (receipts, invoices, signed forms)
```