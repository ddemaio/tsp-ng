const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'tsp.json');

const TABLES = ['users', 'events', 'requests', 'expenses', 'payments', 'state_history', 'comments', 'documents'];

let data = Object.fromEntries(TABLES.map(t => [t, []]));

if (fs.existsSync(DB_PATH)) {
  const persisted = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  for (const t of TABLES) {
    if (Array.isArray(persisted[t])) data[t] = persisted[t];
  }
}

// Load-time migration: ensure user profile/banking keys exist
for (const u of data.users) {
  u.phone ??= '';
  u.city ??= '';
  u.state ??= '';
  u.banking_method ??= null;
  u.bank_iban ??= '';
  u.bank_swift ??= '';
  u.bank_account_no ??= '';
  u.bank_routing_no ??= '';
  u.bank_ifsc ??= '';
}

function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

/**
 * Tokenize a SQL value list into a mix of parameter references (number = param index)
 * and literal values. Handles: ?, NULL, numbers, 'quoted strings', CURRENT_TIMESTAMP.
 */
function tokenizeValues(valuesClause, paramOffset) {
  const values = [];
  let i = 0;
  const n = valuesClause.length;
  while (i < n) {
    const c = valuesClause[i];
    if (c === '?') {
      values.push({ type: 'param', index: paramOffset++ });
      i++;
    } else if (c === "'") {
      let j = i + 1;
      let str = '';
      while (j < n && valuesClause[j] !== "'") {
        str += valuesClause[j];
        j++;
      }
      values.push({ type: 'literal', value: str });
      i = j + 1;
    } else if (/[\d.-]/.test(c)) {
      let j = i;
      while (j < n && /[\d.eE+-]/.test(valuesClause[j])) j++;
      const num = valuesClause.slice(i, j).trim();
      values.push({ type: 'literal', value: num === '' ? null : Number(num) });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(valuesClause[j])) j++;
      const word = valuesClause.slice(i, j).toUpperCase();
      if (word === 'NULL') values.push({ type: 'literal', value: null });
      else if (word === 'CURRENT_TIMESTAMP') values.push({ type: 'literal', value: new Date().toISOString() });
      else values.push({ type: 'literal', value: word });
      i = j;
    } else {
      i++;
    }
  }
  return values;
}

/**
 * Resolve a tokenized value against actual bound params.
 */
function resolveValue(tok, params) {
  if (tok.type === 'param') return params[tok.index];
  return tok.value;
}

const db = {
  prepare(sql) {
    const self = this;
    return {
      get(...params) {
        return self._exec(sql, params, 'get');
      },
      all(...params) {
        return self._exec(sql, params, 'all');
      },
      run(...params) {
        return self._exec(sql, params, 'run');
      },
    };
  },

  _exec(sql, params, mode) {
    const original = sql.trim();
    const s = original.toLowerCase();

    // ── INSERT ──────────────────────────────────────────────
    const insertMatch = original.match(/insert into (\w+)\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)/i);
    if (insertMatch) {
      const table = insertMatch[1].toLowerCase();
      const cols = insertMatch[2].split(',').map(c => c.trim());
      const values = tokenizeValues(insertMatch[3], 0).map(t => resolveValue(t, params));
      const row = {};
      // Positionally pair up the params with the ? in the values clause
      let paramIdx = 0;
      const colRows = tokenizeValues(insertMatch[3], 0);
      cols.forEach((col, i) => {
        row[col] = resolveValue(colRows[i], params);
      });
      row.id = (data[table].length ? Math.max(...data[table].map(r => r.id)) + 1 : 1);
      data[table].push(row);
      save();
      if (mode === 'run') return { lastInsertRowid: row.id, changes: 1 };
      return row;
    }

    // ── SELECT ─────────────────────────────────────────────
    const tableMatch = original.match(/from\s+(\w+)/i);
    if (s.startsWith('select') && tableMatch) {
      const table = tableMatch[1].toLowerCase();
      let rows = [...(data[table] || [])];

      // WHERE clause
      const whereMatch = original.match(/where\s+([\s\S]+?)(?:\s+order by|\s+group by|\s+limit|$)/i);
      if (whereMatch) {
        const conditions = whereMatch[1].split(/\s+and\s+/i).map(c => c.trim());
        // Strip table aliases (r.id -> id, u.name -> name)
        const unqualified = col => {
          const m = col.match(/(?:[\w.]+\.)?(\w+)$/);
          return m ? m[1] : col;
        };
        // Resolve each condition's bound values ONCE, before row filtering
        const condValues = [];
        let paramIdx = 0;
        conditions.forEach(cond => {
          const eqParam = cond.match(/([\w.]+)\s*=\s*\?/);
          const inParam = cond.match(/([\w.]+)\s+in\s*\(([^)]+)\)/i);
          const eqLiteral = cond.match(/([\w.]+)\s*=\s*(?:'([^']*)'|([\d.+-]+))/);
          if (eqParam) {
            condValues.push({ col: unqualified(eqParam[1]), vals: [params[paramIdx++]], match: 'eq' });
          } else if (inParam) {
            const list = inParam[2].split(',').map(v => v.trim());
            const vals = list.map(() => params[paramIdx++]);
            condValues.push({ col: unqualified(inParam[1]), vals, match: 'in' });
          } else if (eqLiteral) {
            const lit = eqLiteral[2] !== undefined ? eqLiteral[2] : eqLiteral[3];
            condValues.push({ col: unqualified(eqLiteral[1]), vals: [isNaN(lit) || lit === '' ? lit : Number(lit)], match: 'eq' });
          }
        });
        rows = rows.filter(row => {
          return condValues.every(cv => {
            if (cv.match === 'eq') return row[cv.col] == cv.vals[0];
            return cv.vals.includes(row[cv.col]);
          });
        });
      }

      // ORDER BY
      const orderMatch = original.match(/order by\s+(\w+)(?:\s+(asc|desc))?/i);
      if (orderMatch) {
        const col = orderMatch[1];
        const dir = (orderMatch[2] || 'asc').toLowerCase();
        rows.sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          const cmp = typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av || '').localeCompare(String(bv || ''));
          return dir === 'asc' ? cmp : -cmp;
        });
      }

      // SUM aggregate (top-level only: `SELECT SUM(col) ...`)
      const sumMatch = s.match(/^select\s+sum\((\w+)\)/i);
      if (sumMatch) {
        const total = rows.reduce((sum, r) => sum + (Number(r[sumMatch[1]]) || 0), 0);
        return mode === 'all' ? [{ total }] : { total };
      }

      // COUNT aggregate
      if (s.includes('count(*)')) {
        return { count: rows.length };
      }

      // JOIN enrichment (denormalized lookups)
      if (s.includes(' join ')) {
        rows = rows.map(row => {
          const enriched = { ...row };
          if (s.includes('users') && row.user_id && /join users/i.test(original)) {
            const u = data.users.find(u => u.id == row.user_id);
            if (u) {
              enriched.requester_name = u.full_name;
              enriched.requester_email = u.email;
              enriched.requester_country = u.country;
              enriched.requester_city = u.city;
              enriched.requester_state = u.state;
              enriched.requester_phone = u.phone;
              enriched.banking_method = u.banking_method;
              enriched.bank_iban = u.bank_iban;
              enriched.bank_swift = u.bank_swift;
              enriched.bank_account_no = u.bank_account_no;
              enriched.bank_routing_no = u.bank_routing_no;
              enriched.bank_ifsc = u.bank_ifsc;
              enriched.user_name = u.full_name;
              enriched.user_role = u.role;
            }
          }
          if (s.includes('events') && row.event_id && /join events/i.test(original)) {
            const e = data.events.find(e => e.id == row.event_id);
            if (e) {
              enriched.event_name = e.name;
              enriched.event_location = e.location;
              enriched.event_date = e.start_date;
              enriched.event_start = e.start_date;
              enriched.event_end = e.end_date;
            }
          }
          return enriched;
        });
      }

      return mode === 'all' ? rows : rows[0];
    }

    // ── UPDATE ─────────────────────────────────────────────
    const updateMatch = original.match(/update (\w+)\s+set\s+([\s\S]+?)\s+where\s+([\s\S]+?)$/i);
    if (updateMatch) {
      const table = updateMatch[1].toLowerCase();
      const setParts = updateMatch[2].split(',').map(p => {
        const m = p.trim().match(/(\w+)\s*=\s*(.+)/);
        return { col: m[1], expr: m[2].trim() };
      });
      const whereCols = updateMatch[3].split(/\s+and\s+/i).map(p => {
        const m = p.trim().match(/(\w+)\s*=\s*\?/);
        return m ? m[1] : null;
      }).filter(Boolean);

      // Params bind in the order ? appears: SET clause first, then WHERE.
      let paramIdx = 0;
      const setValues = setParts.map(sp => {
        if (sp.expr.toUpperCase() === 'CURRENT_TIMESTAMP') return '__CURRENT_TIMESTAMP__';
        if (sp.expr === '?') return params[paramIdx++];
        // literal value (unquoted) or 'quoted string'
        const literal = sp.expr.replace(/^'|'$/g, '').replace(/'/g, '');
        return { _literal: literal };
      });
      const whereValues = whereCols.map(() => params[paramIdx++]);

      let changes = 0;
      data[table].forEach(row => {
        const matches = whereCols.every((col, i) => row[col] == whereValues[i]);
        if (matches) {
          setParts.forEach((sp, si) => {
            const v = setValues[si];
            if (v === '__CURRENT_TIMESTAMP__') {
              row[sp.col] = new Date().toISOString();
            } else if (v && v._literal !== undefined) {
              row[sp.col] = v._literal;
            } else {
              row[sp.col] = v;
            }
          });
          changes++;
        }
      });
      save();
      return { changes };
    }

    // ── DELETE ─────────────────────────────────────────────
    const deleteMatch = original.match(/delete from (\w+)\s+where\s+([\s\S]+?)$/i);
    if (deleteMatch) {
      const table = deleteMatch[1].toLowerCase();
      const whereCols = deleteMatch[2].split(/\s+and\s+/i).map(p => {
        const m = p.trim().match(/(\w+)\s*=\s*\?/);
        return m ? m[1] : null;
      }).filter(Boolean);
      let paramIdx = 0;
      const whereValues = whereCols.map(() => params[paramIdx++]);
      const before = data[table].length;
      data[table] = data[table].filter(row => {
        return !whereCols.every((col, i) => row[col] == whereValues[i]);
      });
      save();
      return { changes: before - data[table].length };
    }

    return mode === 'all' ? [] : null;
  },

  exec(sql) {
    // CREATE TABLE no-ops for JSON persistence
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      if (stmt.toUpperCase().startsWith('CREATE TABLE')) {
        const m = stmt.match(/create table if not exists (\w+)/i);
        if (m && !data[m[1]]) data[m[1]] = [];
      }
    }
  },
};

function seed() {
  if (data.users.length > 0) return;

  data.users = [
    {
      id: 1, username: 'admin', password: 'admin', full_name: 'TSP Admin', role: 'tsp',
      email: 'admin@example.com', phone: '+49 152 1234567', city: 'Nuremberg', state: 'Bavaria', country: 'Germany',
      banking_method: 'iban', bank_iban: 'DE89370400440532013000', bank_swift: 'SOGEDEFFXXX',
      created_at: new Date().toISOString(),
    },
    {
      id: 2, username: 'requester', password: 'requester', full_name: 'Jane Speaker', role: 'requester',
      email: 'jane@example.com', phone: '+91 98765 43210', city: 'Pune', state: 'Maharashtra', country: 'India',
      banking_method: 'india_ifsc', bank_account_no: '50100234567890', bank_ifsc: 'SBIN0001234',
      created_at: new Date().toISOString(),
    },
    {
      id: 3, username: 'finance', password: 'finance', full_name: 'Finance Team', role: 'finance',
      email: 'finance@example.com', phone: '+49 89 5555 0000', city: 'Munich', state: 'Bavaria', country: 'Germany',
      banking_method: 'iban', bank_iban: 'DE12500105170648489890', bank_swift: 'INGDDEFFXXX',
      created_at: new Date().toISOString(),
    },
  ];

  data.events = [
    { id: 1, name: 'openSUSE Conference 2026', location: 'Nuremberg, Germany', start_date: '2026-06-15', end_date: '2026-06-17', accepting_requests: 1, created_at: new Date().toISOString() },
    { id: 2, name: 'FOSDEM 2026', location: 'Brussels, Belgium', start_date: '2026-02-01', end_date: '2026-02-02', accepting_requests: 1, created_at: new Date().toISOString() },
    { id: 3, name: 'LinuxConf.au 2026', location: 'Sydney, Australia', start_date: '2026-01-13', end_date: '2026-01-17', accepting_requests: 1, created_at: new Date().toISOString() },
    { id: 4, name: 'openSUSE Conference 2027', location: 'Prague, Czechia', start_date: '2027-06-14', end_date: '2027-06-16', accepting_requests: 1, created_at: new Date().toISOString() },
  ];

  save();
}

seed();

module.exports = db;
