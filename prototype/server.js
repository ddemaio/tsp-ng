const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('./db');
const wise = require('./wise-api');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\- ]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage });
const DOC_KINDS = ['receipt', 'invoice', 'signed_form'];
const DOC_LABELS = { receipt: 'Receipt', invoice: 'Invoice', signed_form: 'Signed Form' };

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'tsp-prototype-secret',
  resave: false,
  saveUninitialized: false,
}));

// Simple auth middleware
function auth(req, res, next) {
  if (req.session.userId) {
    req.user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    return next();
  }
  res.redirect('/login');
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.user.role)) return next();
    res.status(403).send('Forbidden');
  };
}

function getRequestView(id) {
  const request = db.prepare(`
    SELECT r.*, e.name as event_name, e.location as event_location, e.start_date as event_start, e.end_date as event_end,
           u.full_name as requester_name, u.email as requester_email, u.country as requester_country
    FROM requests r
    JOIN events e ON r.event_id = e.id
    JOIN users u ON r.user_id = u.id
    WHERE r.id = ?
  `).get(id);
  if (!request) return null;

  const expenses = db.prepare('SELECT * FROM expenses WHERE request_id = ?').all(request.id);
  const history = db.prepare(`
    SELECT sh.*, u.full_name as user_name
    FROM state_history sh JOIN users u ON sh.user_id = u.id
    WHERE sh.request_id = ? ORDER BY sh.created_at DESC
  `).all(request.id);
  const payment = db.prepare('SELECT * FROM payments WHERE request_id = ?').get(request.id);
  const comments = db.prepare(`
    SELECT c.*, u.full_name as user_name, u.role as user_role
    FROM comments c JOIN users u ON c.user_id = u.id
    WHERE c.request_id = ? ORDER BY c.created_at ASC
  `).all(request.id);
  const documents = db.prepare(`
    SELECT d.*, u.full_name as uploaded_by_name
    FROM documents d JOIN users u ON d.uploaded_by = u.id
    WHERE d.request_id = ? ORDER BY d.created_at ASC
  `).all(request.id);

  return { request, expenses, history, payment, comments, documents, docKinds: documents.map(d => d.kind) };
}

function normalizeExpenses(expenses) {
  if (!expenses || !Array.isArray(expenses)) return [];
  const rows = [];
  for (const exp of expenses) {
    if (exp && exp.category && exp.amount) {
      rows.push({
        category: exp.category,
        description: exp.description || '',
        amount: parseFloat(exp.amount),
        currency: (exp.currency || 'EUR').toUpperCase(),
      });
    }
  }
  return rows;
}

function replaceExpenses(requestId, expenses) {
  db.prepare('DELETE FROM expenses WHERE request_id = ?').run(requestId);
  const insertExpense = db.prepare(`
    INSERT INTO expenses (request_id, category, description, estimated_amount, estimated_currency)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const exp of expenses) {
    insertExpense.run(requestId, exp.category, exp.description, exp.amount, exp.currency);
  }
}

function roleLabel(role) {
  return { tsp: 'TSP committee', requester: 'Requester', finance: 'Finance' }[role] || role;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

const BANKING_METHODS = ['iban', 'us_bank', 'india_ifsc'];
const BANKING_LABELS = {
  iban: 'International (IBAN + SWIFT/BIC)',
  us_bank: 'United States (bank account + routing number)',
  india_ifsc: 'India (account number + IFSC code)',
};
const BANKING_FIELDS = {
  iban: [
    { key: 'bank_iban', label: 'IBAN' },
    { key: 'bank_swift', label: 'SWIFT / BIC' },
  ],
  us_bank: [
    { key: 'bank_account_no', label: 'Bank account number' },
    { key: 'bank_routing_no', label: 'ABA routing number' },
  ],
  india_ifsc: [
    { key: 'bank_account_no', label: 'Bank account number' },
    { key: 'bank_ifsc', label: 'IFSC code' },
  ],
};
function bankingSummary(u) {
  if (!u || !u.banking_method) return 'Not set';
  const m = u.banking_method;
  if (m === 'iban') return `IBAN ${u.bank_iban || '—'} · SWIFT ${u.bank_swift || '—'}`;
  if (m === 'us_bank') return `${u.bank_account_no || '—'} · Routing ${u.bank_routing_no || '—'}`;
  if (m === 'india_ifsc') return `Acct ${u.bank_account_no || '—'} · IFSC ${u.bank_ifsc || '—'}`;
  return 'Not set';
}

function eventApprovedTotals(requestId) {
  const row = db.prepare('SELECT SUM(approved_amount) as total FROM expenses WHERE request_id = ?').get(requestId);
  return row.total || 0;
}

// ─── Auth Routes ──────────────────────────────────────────────

app.get('/login', (req, res) => {
  const users = db.prepare('SELECT * FROM users').all();
  res.render('login', { users });
});

app.post('/login', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.body.userId);
  if (user) {
    req.session.userId = user.id;
    return res.redirect('/');
  }
  res.redirect('/login');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ─── Dashboard (role-specific overviews) ──────────────────────

app.get('/', auth, (req, res) => {
  const dash = { myRequests: [], pendingReview: [], eventSummary: [], windowSince: isoDaysAgo(90), totals: {} };
  const maxRows = 20;

  if (req.user.role === 'requester') {
    dash.myRequests = db.prepare(`
      SELECT r.*, e.name as event_name, e.start_date as event_date
      FROM requests r JOIN events e ON r.event_id = e.id
      WHERE r.user_id = ? ORDER BY r.created_at DESC
    `).all(req.user.id);
  }

  if (req.user.role === 'tsp') {
    const allRequests = db.prepare(`
      SELECT r.*, e.name as event_name, e.start_date as event_date, e.location as event_location,
             u.full_name as requester_name, u.country as requester_country
      FROM requests r
      JOIN events e ON r.event_id = e.id
      JOIN users u ON r.user_id = u.id
    `).all();

    // Up to 20 submitted requests, oldest first, for quick review
    dash.pendingReview = allRequests
      .filter(r => r.state === 'submitted')
      .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
      .slice(0, maxRows);
    for (const r of dash.pendingReview) {
      r.estimated_total = db.prepare('SELECT SUM(estimated_amount) as total FROM expenses WHERE request_id = ?').get(r.id).total || 0;
    }

    // Per-event status for events from the last 90 days (plus a running approved-funds total)
    const events = db.prepare('SELECT * FROM events').all()
      .filter(e => e.start_date && e.start_date >= isoDaysAgo(90))
      .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));

    const STATUSES = ['submitted', 'approved', 'accepted', 'submitted_for_payment', 'rejected', 'cancelled', 'paid'];
    dash.totals = Object.fromEntries(STATUSES.map(s => [s, 0]));

    let runningApproved = 0;
    for (const ev of events) {
      const reqs = allRequests.filter(r => Number(r.event_id) === ev.id);
      const summary = {
        event: ev,
        counts: Object.fromEntries(STATUSES.map(s => [s, 0])),
        approvedTotal: 0,
        runningApproved: 0,
      };
      for (const r of reqs) {
        if (summary.counts[r.state] !== undefined) summary.counts[r.state]++;
        if (dash.totals[r.state] !== undefined) dash.totals[r.state]++;
        if (['approved', 'accepted', 'submitted_for_payment', 'paid'].includes(r.state)) {
          summary.approvedTotal += eventApprovedTotals(r.id);
        }
      }
      runningApproved += summary.approvedTotal;
      summary.runningApproved = runningApproved;
      dash.eventSummary.push(summary);
    }
    dash.totals.approvedFunds = dash.eventSummary.reduce((s, es) => s + es.approvedTotal, 0);
  }

  if (req.user.role === 'finance') {
    const submittedForPayment = db.prepare(`
      SELECT r.*, e.name as event_name, e.location as event_location, e.start_date as event_date,
             u.full_name as requester_name, u.email as requester_email, u.country as requester_country
      FROM requests r
      JOIN events e ON r.event_id = e.id
      JOIN users u ON r.user_id = u.id
      WHERE r.state = 'submitted_for_payment'
      ORDER BY r.updated_at ASC
    `).all();

    dash.submittedForPayment = submittedForPayment.slice(0, maxRows);
    dash.sfpTotal = submittedForPayment.length;
    dash.sfpAmount = submittedForPayment.reduce((s, r) => s + eventApprovedTotals(r.id), 0);
    for (const r of dash.submittedForPayment) {
      r.approved_total = eventApprovedTotals(r.id);
      r.docCount = db.prepare('SELECT COUNT(*) as count FROM documents WHERE request_id = ?').get(r.id).count;
      r.wise = bankingSummary(r);
    }

    const allPaid = db.prepare(`
      SELECT r.*, e.name as event_name, u.full_name as requester_name
      FROM requests r
      JOIN events e ON r.event_id = e.id
      JOIN users u ON r.user_id = u.id
      WHERE r.state = 'paid'
      ORDER BY r.updated_at DESC
    `).all();
    dash.recentPaid = allPaid.slice(0, maxRows);

    dash.paidCount = allPaid.length;
    const paidRequestIds = new Set(allPaid.map(r => Number(r.id)));
    dash.paidAmount = db.prepare('SELECT * FROM payments').all()
      .filter(p => paidRequestIds.has(Number(p.request_id)) && p.wise_status === 'success')
      .reduce((s, p) => s + Number(p.amount), 0);
  }

  res.render('dashboard', { user: req.user, dash, maxRows, bankingSummary,
    eventApprovedMap: Object.fromEntries(dash.recentPaid ? dash.recentPaid.map(r => [r.id, eventApprovedTotals(r.id)]) : []) });
});

// ─── Request Routes ───────────────────────────────────────────

app.get('/requests/new', auth, (req, res) => {
  const events = db.prepare('SELECT * FROM events WHERE accepting_requests = 1').all();
  const preselected = req.query.event ? Number(req.query.event) : null;
  res.render('new-request', { user: req.user, events, preselected });
});

app.post('/requests', auth, (req, res) => {
  const { event_id, description, talk_url, talk_title, expenses } = req.body;

  const result = db.prepare(`
    INSERT INTO requests (user_id, event_id, description, talk_url, talk_title, state)
    VALUES (?, ?, ?, ?, ?, 'draft')
  `).run(req.user.id, event_id, description, talk_url || null, talk_title || null);

  const requestId = result.lastInsertRowid;

  if (expenses && Array.isArray(expenses)) {
    const insertExpense = db.prepare(`
      INSERT INTO expenses (request_id, category, description, estimated_amount, estimated_currency)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const exp of expenses) {
      if (exp.category && exp.amount) {
        insertExpense.run(requestId, exp.category, exp.description || '', parseFloat(exp.amount), exp.currency || 'EUR');
      }
    }
  }

  db.prepare('INSERT INTO state_history (request_id, from_state, to_state, user_id) VALUES (?, NULL, ?, ?)')
    .run(requestId, 'draft', req.user.id);

  res.redirect(`/requests/${requestId}`);
});

app.get('/requests/:id', auth, (req, res) => {
  const view = getRequestView(req.params.id);
  if (!view) return res.status(404).send('Not found');
  res.render('request-detail', { user: req.user, docLabels: DOC_LABELS, roleLabel, ...view });
});

app.post('/requests/:id/submit', auth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request || request.user_id !== req.user.id || request.state !== 'draft') {
    return res.redirect('/');
  }
  db.prepare('UPDATE requests SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('submitted', request.id);
  db.prepare('INSERT INTO state_history (request_id, from_state, to_state, user_id, notes) VALUES (?, ?, ?, ?, ?)')
    .run(request.id, 'draft', 'submitted', req.user.id, req.body.notes || null);
  res.redirect(`/requests/${request.id}`);
});

// Requests stay editable until approval; locking happens at 'approved'.
app.get('/requests/:id/edit', auth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request || request.user_id !== req.user.id) return res.redirect('/');
  if (request.state !== 'draft' && request.state !== 'submitted') {
    return res.redirect(`/requests/${request.id}`);
  }
  const events = db.prepare('SELECT * FROM events WHERE accepting_requests = 1 OR id = ?').all(request.event_id);
  const expenses = db.prepare('SELECT * FROM expenses WHERE request_id = ?').all(request.id);
  res.render('new-request', { user: req.user, events, request, expenses, isEdit: true });
});

app.post('/requests/:id/edit', auth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request || request.user_id !== req.user.id) return res.redirect('/');
  if (request.state !== 'draft' && request.state !== 'submitted') {
    return res.redirect(`/requests/${request.id}`);
  }
  const { event_id, description, talk_url, talk_title, expenses } = req.body;
  db.prepare(`UPDATE requests SET event_id = ?, description = ?, talk_url = ?, talk_title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(event_id, description, talk_url || null, talk_title || null, request.id);
  replaceExpenses(request.id, normalizeExpenses(expenses));
  res.redirect(`/requests/${request.id}`);
});

// ─── TSP Review Routes ────────────────────────────────────────

app.post('/requests/:id/approve', auth, requireRole('tsp'), (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request || request.state !== 'submitted') return res.redirect('/');

  const { approved_amounts, approved_currencies } = req.body;
  if (approved_amounts) {
    const expenses = db.prepare('SELECT * FROM expenses WHERE request_id = ?').all(request.id);
    const updateExpense = db.prepare('UPDATE expenses SET approved_amount = ?, approved_currency = ? WHERE id = ?');
    expenses.forEach((exp, idx) => {
      const amt = approved_amounts[idx];
      if (amt !== undefined && amt !== '') {
        const currency = (approved_currencies && approved_currencies[idx]) || 'EUR';
        updateExpense.run(parseFloat(amt), currency, exp.id);
      }
    });
  }

  db.prepare('UPDATE requests SET state = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('approved', request.id);
  db.prepare('INSERT INTO state_history (request_id, from_state, to_state, user_id, notes) VALUES (?, ?, ?, ?, ?)')
    .run(request.id, 'submitted', 'approved', req.user.id, req.body.notes || null);

  res.redirect(`/requests/${request.id}`);
});

app.post('/requests/:id/reject', auth, requireRole('tsp'), (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request || request.state !== 'submitted') return res.redirect('/');

  db.prepare('UPDATE requests SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('rejected', request.id);
  db.prepare('INSERT INTO state_history (request_id, from_state, to_state, user_id, notes) VALUES (?, ?, ?, ?, ?)')
    .run(request.id, 'submitted', 'rejected', req.user.id, req.body.notes || 'Request rejected');

  res.redirect(`/requests/${request.id}`);
});

app.post('/requests/:id/cancel', auth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.redirect('/');
  const isRequester = request.user_id === req.user.id;
  const isTsp = req.user.role === 'tsp';
  const cancellable = ['draft', 'submitted', 'approved'];
  if (!cancellable.includes(request.state) || (!isRequester && !isTsp)) {
    return res.redirect(`/requests/${request.id}`);
  }

  db.prepare('UPDATE requests SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('cancelled', request.id);
  db.prepare('INSERT INTO state_history (request_id, from_state, to_state, user_id, notes) VALUES (?, ?, ?, ?, ?)')
    .run(request.id, request.state, 'cancelled', req.user.id, req.body.notes || 'Request cancelled');

  res.redirect(`/requests/${request.id}`);
});

// ─── Requester Acceptance ─────────────────────────────────────

app.get('/requests/:id/accept', auth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request || request.user_id !== req.user.id || request.state !== 'approved') {
    return res.redirect('/');
  }
  const expenses = db.prepare('SELECT * FROM expenses WHERE request_id = ?').all(request.id);
  const totalApproved = expenses.reduce((sum, e) => sum + (e.approved_amount || 0), 0);
  res.render('accept-request', { user: req.user, request, expenses, totalApproved });
});

app.post('/requests/:id/accept', auth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request || request.user_id !== req.user.id || request.state !== 'approved') {
    return res.redirect('/');
  }

  if (!req.body.confirm_attendance || !req.body.confirm_details || !req.body.confirm_coc || !req.body.confirm_rules) {
    const expenses = db.prepare('SELECT * FROM expenses WHERE request_id = ?').all(request.id);
    const totalApproved = expenses.reduce((sum, e) => sum + (e.approved_amount || 0), 0);
    return res.render('accept-request', {
      user: req.user, request, expenses, totalApproved,
      error: 'Please confirm all four statements (attendance, expenses, openSUSE Code of Conduct, and TSP rules) to accept the approved request.',
    });
  }

  db.prepare('UPDATE requests SET state = ?, accepted_at = CURRENT_TIMESTAMP, accepted_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('accepted', req.user.id, request.id);
  db.prepare('INSERT INTO state_history (request_id, from_state, to_state, user_id, notes) VALUES (?, ?, ?, ?, ?)')
    .run(request.id, 'approved', 'accepted', req.user.id, 'Requester accepted the approved request and agreed to the Code of Conduct and TSP rules');

  res.redirect(`/requests/${request.id}`);
});

// ─── Submit for Payment (closes the loop after documents are uploaded) ──

app.post('/requests/:id/submit-for-payment', auth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request || request.user_id !== req.user.id || request.state !== 'accepted') {
    return res.redirect('/');
  }

  const uploadedKinds = db.prepare('SELECT DISTINCT kind FROM documents WHERE request_id = ?').all(request.id).map(d => d.kind);
  const missing = ['receipt', 'invoice', 'signed_form'].filter(k => !uploadedKinds.includes(k));

  if (missing.length > 0) {
    const view = getRequestView(request.id);
    return res.status(400).render('request-detail', {
      user: req.user, docLabels: DOC_LABELS, roleLabel, ...view,
      submitPaymentError: `Upload your ${missing.map(k => DOC_LABELS[k]).join(', ')} before submitting for payment.`,
    });
  }

  db.prepare('UPDATE requests SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('submitted_for_payment', request.id);
  db.prepare('INSERT INTO state_history (request_id, from_state, to_state, user_id, notes) VALUES (?, ?, ?, ?, ?)')
    .run(request.id, 'accepted', 'submitted_for_payment', req.user.id, 'Requester uploaded all required documents and submitted the request for payment');

  res.redirect(`/requests/${request.id}`);
});

// ─── Comments (requester ⇄ approver communication) ────────────

app.post('/requests/:id/comments', auth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.redirect('/');
  const isRequester = request.user_id === req.user.id;
  const isStaff = ['tsp', 'finance'].includes(req.user.role);
  if (!isRequester && !isStaff) return res.status(403).send('Forbidden');

  const body = (req.body.body || '').trim();
  if (body) {
    db.prepare('INSERT INTO comments (request_id, user_id, body) VALUES (?, ?, ?)')
      .run(request.id, req.user.id, body);
  }
  res.redirect(`/requests/${request.id}#comments`);
});

// ─── Digital signable form + documents ────────────────────────

app.get('/requests/:id/form', auth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).send('Not found');
  const isOwner = request.user_id === req.user.id;
  const canView = ['tsp', 'finance'].includes(req.user.role) || isOwner;
  if (!canView) return res.status(403).send('Forbidden');

  const expenses = db.prepare('SELECT * FROM expenses WHERE request_id = ?').all(request.id);
  const approved = expenses.filter(e => e.approved_amount);
  const totals = {};
  approved.forEach(e => {
    if (!totals[e.approved_currency]) totals[e.approved_currency] = 0;
    totals[e.approved_currency] += e.approved_amount;
  });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(request.user_id);
  res.render('signed-form', { user: req.user, request, requester: user, approved, totals });
});

app.post('/requests/:id/documents', auth, upload.single('file'), (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.redirect('/');
  const isRequester = request.user_id === req.user.id;
  const isStaff = ['tsp', 'finance'].includes(req.user.role);
  if (!isRequester && !isStaff) return res.status(403).send('Forbidden');
  if (!req.file || !DOC_KINDS.includes(req.body.kind)) return res.redirect(`/requests/${request.id}`);

  db.prepare(`
    INSERT INTO documents (request_id, kind, filename, original_name, mimetype, size, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(request.id, req.body.kind, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.id);

  res.redirect(`/requests/${request.id}#documents`);
});

app.get('/documents/:id/download', auth, (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).send('Not found');
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(doc.request_id);
  const isOwner = request.user_id === req.user.id;
  const canView = ['tsp', 'finance'].includes(req.user.role) || isOwner;
  if (!canView) return res.status(403).send('Forbidden');

  const filePath = path.join(UPLOAD_DIR, String(request.id), doc.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('File missing');
  res.download(filePath, doc.original_name);
});

// ─── Payment Routes (Wise Integration) ────────────────────────

app.get('/payments', auth, requireRole('finance'), (req, res) => {
  const readyForPayment = db.prepare(`
    SELECT r.*, e.name as event_name, u.full_name as requester_name, u.email as requester_email
    FROM requests r
    JOIN events e ON r.event_id = e.id
    JOIN users u ON r.user_id = u.id
    WHERE r.state = 'submitted_for_payment'
    ORDER BY r.updated_at ASC
  `).all();

  for (const r of readyForPayment) {
    const totals = db.prepare('SELECT SUM(approved_amount) as total FROM expenses WHERE request_id = ?').get(r.id);
    r.total_approved = totals.total || 0;
  }

  const documentsByRequest = {};
  for (const r of readyForPayment) {
    documentsByRequest[r.id] = db.prepare(
      'SELECT * FROM documents WHERE request_id = ? ORDER BY created_at ASC'
    ).all(r.id);
  }

  const processedPayments = db.prepare(`
    SELECT p.*, r.id as request_id, e.name as event_name, u.full_name as requester_name
    FROM payments p
    JOIN requests r ON p.request_id = r.id
    JOIN events e ON r.event_id = e.id
    JOIN users u ON r.user_id = u.id
    ORDER BY p.created_at DESC
  `).all();

  res.render('payments', { user: req.user, readyForPayment, processedPayments, documentsByRequest, docLabels: DOC_LABELS, bankingSummary });
});

app.post('/payments/create', auth, requireRole('finance'), async (req, res) => {
  const { request_id, amount, currency, recipient_name, recipient_email, method } = req.body;

  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(request_id);
  if (!request || request.state !== 'submitted_for_payment') return res.redirect('/payments');

  let wiseTransferId = null;
  let wiseStatus = null;

  if (method === 'wise-api') {
    const result = await wise.createTransfer({
      recipient_name,
      recipient_email,
      amount: parseFloat(amount),
      currency,
      reference: `TSP Reimbursement #${request_id}`,
    });
    wiseTransferId = result.id;
    wiseStatus = result.status;
  }

  db.prepare(`
    INSERT INTO payments (request_id, amount, currency, method, wise_transfer_id, wise_status, recipient_name, recipient_email, payment_reference)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(request_id, parseFloat(amount), currency, method, wiseTransferId, wiseStatus, recipient_name, recipient_email, `TSP-${request_id}`);

  if (method === 'wise-api' && wiseStatus === 'success') {
    db.prepare('UPDATE requests SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('paid', request.id);
    db.prepare('INSERT INTO state_history (request_id, from_state, to_state, user_id, notes) VALUES (?, ?, ?, ?, ?)')
      .run(request.id, 'submitted_for_payment', 'paid', req.user.id, `Payment confirmed via Wise (${wiseTransferId})`);
  }

  res.redirect('/payments');
});

app.post('/payments/generate-csv', auth, requireRole('finance'), (req, res) => {
  let ids = req.body.request_ids;
  if (!ids) return res.redirect('/payments');
  if (!Array.isArray(ids)) ids = String(ids).split(',').map(s => s.trim()).filter(Boolean).map(Number);
  if (ids.length === 0) return res.redirect('/payments');

  const placeholders = ids.map(() => '?').join(',');
  const requests = db.prepare(`
    SELECT r.*, u.full_name as requester_name, u.email as requester_email
    FROM requests r JOIN users u ON r.user_id = u.id
    WHERE r.id IN (${placeholders}) AND r.state = 'submitted_for_payment'
  `).all(...ids);

  const payments = requests.map((r) => ({
    request_id: r.id,
    recipient_name: r.requester_name,
    recipient_email: r.requester_email,
    currency: 'EUR',
    amount: db.prepare('SELECT SUM(approved_amount) as total FROM expenses WHERE request_id = ?').get(r.id).total || 0,
  }));

  const csv = wise.generateBatchCSV(payments);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=wise-batch-payment.csv');
  res.send(csv);
});

app.get('/payments/:id/status', auth, requireRole('finance'), async (req, res) => {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
  if (!payment || !payment.wise_transfer_id) return res.json({ error: 'No Wise transfer' });

  const status = await wise.getTransferStatus(payment.wise_transfer_id);
  if (status) {
    db.prepare('UPDATE payments SET wise_status = ? WHERE id = ?').run(status.status, payment.id);
    if (status.status === 'success') {
      const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(payment.request_id);
      if (request && request.state === 'submitted_for_payment') {
        db.prepare('UPDATE requests SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('paid', request.id);
        db.prepare('INSERT INTO state_history (request_id, from_state, to_state, user_id, notes) VALUES (?, ?, ?, ?, ?)')
          .run(request.id, 'submitted_for_payment', 'paid', req.user.id, `Payment confirmed via Wise (${payment.wise_transfer_id})`);
      }
    }
  }
  res.json(status);
});

app.get('/wise/currencies', auth, async (req, res) => {
  const currencies = await wise.getCurrencies();
  res.json(currencies);
});

// ─── Events (created by admins AND requesters) ────────────────

app.get('/events', auth, (req, res) => {
  const events = db.prepare('SELECT * FROM events').all();
  const { from, to } = req.query;
  const searching = !!(from || to);

  let visible;
  if (searching) {
    visible = events
      .filter(e => (!from || (e.start_date && e.start_date >= from)) && (!to || (e.start_date && e.start_date <= to)))
      .sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));
  } else {
    visible = events
      .filter(e => !e.end_date || e.end_date >= todayISO())
      .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
  }

  res.render('events', { user: req.user, events: visible, from: from || '', to: to || '', searching });
});

app.get('/events/new', auth, (req, res) => {
  res.render('new-event', { user: req.user });
});

app.post('/events', auth, (req, res) => {
  const { name, location, start_date, end_date } = req.body;
  if (!name || !name.trim()) return res.redirect('/events/new');
  db.prepare('INSERT INTO events (name, location, start_date, end_date, accepting_requests) VALUES (?, ?, ?, ?, 1)')
    .run(name.trim(), location?.trim() || '', start_date || null, end_date || null);
  res.redirect('/events');
});

// ─── Profile (name, contact, banking) ──────────────────────────

app.get('/profile', auth, (req, res) => {
  res.render('profile', { user: req.user, bankLabels: BANKING_LABELS, bankFields: BANKING_FIELDS, saved: false, error: null });
});

app.post('/profile', auth, (req, res) => {
  const { full_name, email, phone, city, state, country, banking_method } = req.body;
  const method = BANKING_METHODS.includes(banking_method) ? banking_method : null;

  const renderWithError = (error) => res.status(400).render('profile', {
    user: req.user, bankLabels: BANKING_LABELS, bankFields: BANKING_FIELDS, saved: false, error,
  });

  if (!full_name || !full_name.trim()) return renderWithError('Name is required.');
  if (!email || !email.trim()) return renderWithError('Email is required.');
  if (method) {
    for (const f of BANKING_FIELDS[method]) {
      if (!req.body[f.key] || !String(req.body[f.key]).trim()) {
        return renderWithError(`Please fill in the banking details for the selected method (${f.label} is missing).`);
      }
    }
  }

  db.prepare(`
    UPDATE users SET full_name = ?, email = ?, phone = ?, city = ?, state = ?, country = ?,
      banking_method = ?, bank_iban = ?, bank_swift = ?, bank_account_no = ?, bank_routing_no = ?, bank_ifsc = ?
    WHERE id = ?
  `).run(
    full_name.trim(), email.trim(),
    (phone || '').trim(), (city || '').trim(), (state || '').trim(), (country || '').trim(),
    method,
    (req.body.bank_iban || '').trim(), (req.body.bank_swift || '').trim(),
    (req.body.bank_account_no || '').trim(), (req.body.bank_routing_no || '').trim(), (req.body.bank_ifsc || '').trim(),
    req.user.id,
  );

  res.render('profile', {
    user: db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id),
    bankLabels: BANKING_LABELS, bankFields: BANKING_FIELDS, saved: true, error: null,
  });
});

// ─── Financial Report (TSP + finance) ──────────────────────────

app.get('/reports', auth, requireRole('tsp', 'finance'), (req, res) => {
  const { from, to, status } = req.query;
  const allowedStatuses = ['all', 'cancelled', 'rejected', 'accepted', 'submitted_for_payment', 'paid'];
  const statusFilter = allowedStatuses.includes(status) ? status : 'all';
  const csv = req.query.format === 'csv';

  let rows = db.prepare(`
    SELECT r.*, e.name as event_name, e.location as event_location, e.start_date as event_start, e.end_date as event_end,
           u.full_name as requester_name, u.country as requester_country
    FROM requests r
    JOIN events e ON r.event_id = e.id
    JOIN users u ON r.user_id = u.id
  `).all();

  if (from) rows = rows.filter(r => r.event_start >= from);
  if (to) rows = rows.filter(r => r.event_start <= to);
  if (statusFilter !== 'all') rows = rows.filter(r => r.state === statusFilter);

  rows = rows.sort((a, b) => (a.event_start || '').localeCompare(b.event_start || ''));

  for (const r of rows) {
    r.approved_total = eventApprovedTotals(r.id);
    const payment = db.prepare('SELECT * FROM payments WHERE request_id = ?').get(r.id);
    r.paid_amount = payment ? payment.amount : null;
    r.payment_method = payment ? payment.method : null;
  }

  const totalCount = rows.length;
  const totalApproved = rows.reduce((s, r) => s + r.approved_total, 0);
  const totalPaid = rows.filter(r => r.paid_amount).reduce((s, r) => s + r.paid_amount, 0);

  if (csv) {
    const lines = [
      ['request_id', 'event', 'event_location', 'event_start', 'event_end', 'recipient', 'recipient_country', 'state', 'approved_amount', 'paid_amount', 'payment_method'],
      ...rows.map(r => [r.id, r.event_name, r.event_location, r.event_start, r.event_end, r.requester_name, r.requester_country, r.state, r.approved_total, r.paid_amount ?? '', r.payment_method ?? '']),
    ];
    const csvText = lines.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=tsp-report.csv');
    return res.send(csvText);
  }

  res.render('reports', {
    user: req.user, rows, from: from || '', to: to || '', statusFilter,
    totalCount, totalApproved, totalPaid,
  });
});

// ─── Start ────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  Travel Support Program Prototype`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  Running at http://localhost:${PORT}`);
  console.log(`\n  Demo accounts (click to login):`);
  console.log(`    admin   (TSP committee member)`);
  console.log(`    requester (Travel support requester)`);
  console.log(`    finance  (Finance/payment team)\n`);
});
