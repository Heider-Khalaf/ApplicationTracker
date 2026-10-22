'use strict';

/* =========================================================
   Application Tracker
   All data lives in this browser's localStorage only.
   ========================================================= */

const STORAGE_KEY = 'applicationTracker.applications.v1';
const FILTER_KEY = 'applicationTracker.filter';
const VIEW_KEY = 'applicationTracker.view';
const BACKUP_KEY = 'applicationTracker.lastBackup';

const FOLLOW_UP_DAYS = 14;      // highlight "Sent" applications with no reply for longer than this
const FOLLOW_UP_SOON_DAYS = 5;  // show follow-ups in "Coming up" this many days early
const LOOKAHEAD_DAYS = 14;      // show deadlines and interviews this far ahead
const UPCOMING_MAX = 6;
const BACKUP_REMIND_DAYS = 30;

const STATUSES = [
  { id: 'planned', label: 'To apply' },
  { id: 'sent', label: 'Sent' },
  { id: 'replied', label: 'Replied' },
  { id: 'interview', label: 'Interview' },
  { id: 'offer', label: 'Offer' },
  { id: 'rejected', label: 'Rejected' },
];
const STATUS_IDS = STATUSES.map((s) => s.id);
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
const RESPONSE_STATUSES = ['replied', 'interview', 'offer', 'rejected'];

const TYPES = {
  job: 'Job',
  trainee: 'Trainee program',
  bachelor: 'Bachelor project',
};

const ACTIVITY_TEXT = {
  planned: 'Added to To apply',
  sent: 'Application sent',
  replied: 'Got a reply',
  interview: 'Moved to Interview',
  offer: 'Received an offer',
  rejected: 'Rejected',
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const board = $('board');
const statusTiles = $('statusTiles');
const listView = $('listView');
const tableHead = $('tableHead');
const tableBody = $('tableBody');
const hint = $('hint');
const ledger = $('ledger');
const donut = $('donut');
const donutTotal = $('donutTotal');
const donutLabel = $('donutLabel');
const avgReply = $('avgReply');
const upcomingList = $('upcoming');
const upcomingCount = $('upcomingCount');
const filterGroup = $('filter');
const viewToggle = $('viewToggle');
const searchInput = $('search');
const storageNote = $('storageNote');
const backupStatus = $('backupStatus');
const importInput = $('importInput');
const toast = $('toast');
const cardTemplate = $('cardTemplate');
const dialog = $('appDialog');
const form = $('appForm');
const dialogTitle = $('dialogTitle');
const formError = $('formError');
const deleteBtn = $('deleteBtn');
const statusSelect = $('statusSelect');
const dateSentField = $('dateSentField');
const activity = $('activity');
const activityList = $('activityList');
const activitySummary = $('activitySummary');
const logFollowUpBtn = $('logFollowUpBtn');

/* ---------- State ---------- */
let applications = [];
let activeFilter = 'all';
let activeView = 'board';
let searchQuery = '';
let sort = { key: 'activity', dir: 'desc' };
let editingId = null;
let mobileStatus = 'sent'; // which status is shown on phones

const mobileQuery = window.matchMedia('(max-width: 760px)');
const isMobile = () => mobileQuery.matches;

/* =========================================================
   Dates
   ========================================================= */

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayISO() {
  return toISODate(new Date());
}

function isoDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

// Parse "YYYY-MM-DD" as a local date (new Date("2026-10-01") would be UTC).
function parseISODate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function daysSince(iso) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today - parseISODate(iso.slice(0, 10))) / 86_400_000);
}

function daysBetween(fromIso, toIso) {
  return Math.round((parseISODate(toIso) - parseISODate(fromIso)) / 86_400_000);
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const shortDateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const interviewFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

const formatDate = (iso) => dateFormatter.format(parseISODate(iso));
const formatShortDate = (iso) => shortDateFormatter.format(parseISODate(iso));
const formatInterview = (value) => interviewFormatter.format(new Date(value)); // "YYYY-MM-DDTHH:MM" is local time

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// days: positive = in the past, negative = in the future
function relativeDays(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days === -1) return 'tomorrow';
  if (days < 0) return `in ${plural(-days, 'day')}`;
  return `${plural(days, 'day')} ago`;
}

/* =========================================================
   Helpers
   ========================================================= */

function makeId() {
  if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Accept "example.com/jobs" as well as full URLs, but only ever link to http(s).
function normalizeLink(value) {
  const v = value.trim();
  if (!v) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function isSafeLink(link) {
  return typeof link === 'string' && /^https?:\/\//i.test(link);
}

function findApp(id) {
  return applications.find((a) => a.id === id);
}

// The follow-up clock starts when the application was sent, and restarts on every follow-up
function followUpBase(app) {
  return app.lastFollowUp && app.lastFollowUp > app.dateSent ? app.lastFollowUp : app.dateSent;
}

function daysWaiting(app) {
  return daysSince(followUpBase(app));
}

function needsFollowUp(app) {
  return app.status === 'sent' && Boolean(app.dateSent) && daysWaiting(app) > FOLLOW_UP_DAYS;
}

function lastActivity(app) {
  return app.history.length ? app.history[app.history.length - 1] : null;
}

// Days from sending to the first reply of any kind (null if no reply yet)
function responseDays(app) {
  const sent = app.history.find((h) => h.kind === 'status' && h.status === 'sent');
  if (!sent) return null;
  const reply = app.history.find((h) => h.kind === 'status' && RESPONSE_STATUSES.includes(h.status) && h.at >= sent.at);
  return reply ? daysBetween(sent.at, reply.at) : null;
}

/* =========================================================
   Data cleaning (used for stored data, older versions and imports)
   ========================================================= */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const cleanDate = (value) => (typeof value === 'string' && ISO_DATE.test(value) ? value : '');

function dateFromTimestamp(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? todayISO() : toISODate(d);
}

function cleanHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const at = cleanDate(entry.at);
  if (!at) return null;
  if (entry.kind === 'followup') return { at, kind: 'followup' };
  if (STATUS_IDS.includes(entry.status)) return { at, kind: 'status', status: entry.status };
  return null;
}

// Rebuild a plausible history for applications saved before history existed
function initialHistory(app, statusDate = todayISO()) {
  if (app.status === 'planned') return [{ at: statusDate, kind: 'status', status: 'planned' }];
  const history = [{ at: app.dateSent, kind: 'status', status: 'sent' }];
  if (app.status !== 'sent') {
    const at = statusDate > app.dateSent ? statusDate : app.dateSent;
    history.push({ at, kind: 'status', status: app.status });
  }
  return history;
}

function normalizeApp(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const company = cleanText(raw.company, 100);
  if (!company) return null;

  const status = STATUS_IDS.includes(raw.status) ? raw.status : 'sent';
  const now = new Date().toISOString();
  const app = {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : makeId(),
    company,
    type: Object.hasOwn(TYPES, raw.type) ? raw.type : 'job',
    status,
    dateSent: status === 'planned' ? '' : cleanDate(raw.dateSent) || todayISO(),
    deadline: cleanDate(raw.deadline),
    interviewAt: typeof raw.interviewAt === 'string' && ISO_DATETIME.test(raw.interviewAt) ? raw.interviewAt.slice(0, 16) : '',
    contact: cleanText(raw.contact, 100),
    link: isSafeLink(raw.link) ? raw.link.slice(0, 500) : '',
    notes: cleanText(raw.notes, 2000),
    lastFollowUp: cleanDate(raw.lastFollowUp),
    history: Array.isArray(raw.history) ? raw.history.map(cleanHistoryEntry).filter(Boolean).slice(-200) : [],
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
  };
  if (!app.history.length) app.history = initialHistory(app, dateFromTimestamp(app.updatedAt));
  return app;
}

function normalizeList(list) {
  const seen = new Set();
  const result = [];
  for (const raw of list) {
    const app = normalizeApp(raw);
    if (!app) continue;
    if (seen.has(app.id)) app.id = makeId();
    seen.add(app.id);
    result.push(app);
  }
  return result;
}

/* =========================================================
   Storage
   ========================================================= */

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    storageNote.hidden = false;
    return false;
  }
}

function loadApplications() {
  const raw = storageGet(STORAGE_KEY);
  // Nothing stored yet → first visit, so load the demo data.
  // (After that an empty list stays empty, even if you delete everything.)
  if (raw === null) {
    const demo = createDemoData();
    storageSet(STORAGE_KEY, JSON.stringify(demo));
    return demo;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeList(parsed) : [];
  } catch {
    return [];
  }
}

function saveApplications() {
  storageSet(STORAGE_KEY, JSON.stringify(applications));
}

/* =========================================================
   Demo data (made-up companies)
   ========================================================= */

function createDemoData() {
  const d = isoDaysFromNow;
  const demo = [
    {
      company: 'Copperleaf Health',
      type: 'job',
      status: 'planned',
      deadline: d(6),
      link: 'https://example.com/copperleaf-careers',
      notes: 'Junior developer role. Tailor the CV towards the healthcare angle.',
      history: [{ at: d(-2), kind: 'status', status: 'planned' }],
    },
    {
      company: 'Fjordbyte Robotics',
      type: 'bachelor',
      status: 'sent',
      dateSent: d(-21),
      contact: 'Ingrid Solberg',
      link: 'https://example.com/fjordbyte',
      notes: 'Proposed a bachelor project on path planning for warehouse robots.',
      history: [{ at: d(-21), kind: 'status', status: 'sent' }],
    },
    {
      company: 'Lumenvale Energy',
      type: 'trainee',
      status: 'sent',
      dateSent: d(-11),
      link: 'https://example.com/lumenvale-trainee',
      notes: 'Graduate trainee program, 2-year rotation. Starts in August.',
      history: [{ at: d(-11), kind: 'status', status: 'sent' }],
    },
    {
      company: 'Quillstack Software',
      type: 'job',
      status: 'interview',
      dateSent: d(-19),
      interviewAt: `${d(2)}T10:00`,
      contact: 'Martin Holt',
      notes: 'Second interview — prepare a short system design walkthrough.',
      history: [
        { at: d(-19), kind: 'status', status: 'sent' },
        { at: d(-12), kind: 'status', status: 'replied' },
        { at: d(-6), kind: 'status', status: 'interview' },
      ],
    },
    {
      company: 'Brightmoss Analytics',
      type: 'job',
      status: 'offer',
      dateSent: d(-35),
      contact: 'Sara Lind',
      link: 'https://example.com/brightmoss',
      notes: 'Part-time data analyst position. Answer by the end of the month.',
      history: [
        { at: d(-35), kind: 'status', status: 'sent' },
        { at: d(-28), kind: 'status', status: 'replied' },
        { at: d(-18), kind: 'status', status: 'interview' },
        { at: d(-5), kind: 'status', status: 'offer' },
      ],
    },
    {
      company: 'Tidewell Logistics',
      type: 'bachelor',
      status: 'rejected',
      dateSent: d(-28),
      notes: 'No capacity to supervise student projects this semester. Try again next year.',
      history: [
        { at: d(-28), kind: 'status', status: 'sent' },
        { at: d(-16), kind: 'status', status: 'rejected' },
      ],
    },
  ];
  return normalizeList(demo);
}

/* =========================================================
   Filtering & sorting
   ========================================================= */

function matchesSearch(app) {
  if (!searchQuery) return true;
  const haystack = `${app.company} ${app.contact} ${app.notes} ${TYPES[app.type]}`.toLowerCase();
  return searchQuery.split(/\s+/).every((word) => haystack.includes(word));
}

function visibleApplications() {
  return applications.filter((a) => (activeFilter === 'all' || a.type === activeFilter) && matchesSearch(a));
}

// Board order: "To apply" by nearest deadline, everything else newest first
function boardOrder(a, b) {
  if (a.status === 'planned') {
    return (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.company.localeCompare(b.company);
  }
  return b.dateSent.localeCompare(a.dateSent) || a.company.localeCompare(b.company);
}

/* =========================================================
   Rendering
   ========================================================= */

function buildBoard() {
  board.innerHTML = '';
  for (const status of STATUSES) {
    const column = document.createElement('section');
    column.className = 'column';
    column.dataset.status = status.id;
    column.id = `column-${status.id}`;

    const head = document.createElement('header');
    head.className = 'column-head';
    head.innerHTML = '<h2></h2><span class="count">0</span>';
    head.querySelector('h2').textContent = status.label;

    const list = document.createElement('div');
    list.className = 'card-list';

    column.append(head, list);
    board.append(column);

    const option = document.createElement('option');
    option.value = status.id;
    option.textContent = status.label;
    statusSelect.append(option);
  }
}

function render() {
  const visible = visibleApplications();

  board.hidden = activeView !== 'board';
  listView.hidden = activeView !== 'list';
  statusTiles.hidden = activeView !== 'board';
  if (activeView === 'board') {
    hint.textContent = isMobile()
      ? 'Tap a card to open it. Press and hold a card, then drop it on a status to move it.'
      : 'Click a card to open it. Drag cards between columns to change their status.';
  } else {
    hint.textContent = isMobile()
      ? 'Tap an application to open it, or change its status right here.'
      : 'Click a row to open it. Click a column title to sort, or change the status right in the table.';
  }

  if (activeView === 'board') renderBoard(visible);
  else renderTable(visible);

  renderOverview(visible);
  renderBackupStatus();

  // Filter tabs (counts are always across all applications)
  for (const btn of filterGroup.querySelectorAll('button')) {
    const type = btn.dataset.filter;
    btn.setAttribute('aria-pressed', String(type === activeFilter));
    btn.querySelector('.tab-count').textContent =
      type === 'all' ? applications.length : applications.filter((a) => a.type === type).length;
  }
  for (const btn of viewToggle.querySelectorAll('button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.view === activeView));
  }
}

function renderBoard(visible) {
  for (const status of STATUSES) {
    const column = board.querySelector(`.column[data-status="${status.id}"]`);
    const apps = visible.filter((a) => a.status === status.id).sort(boardOrder);
    column.querySelector('.card-list').replaceChildren(...apps.map(renderCard));
    column.querySelector('.count').textContent = apps.length;
    column.classList.toggle('is-current', status.id === mobileStatus);
  }
  renderStatusTiles(visible);
}

// Phones show one status at a time; these tiles switch between them
function renderStatusTiles(visible) {
  statusTiles.replaceChildren(...STATUSES.map((status) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'status-tile';
    tile.dataset.status = status.id;
    tile.setAttribute('aria-pressed', String(status.id === mobileStatus));
    tile.innerHTML = '<span class="tile-name"><i class="swatch"></i><span></span></span><span class="tile-count"></span>';
    tile.querySelector('.tile-name span').textContent = status.label;
    tile.querySelector('.tile-count').textContent = visible.filter((a) => a.status === status.id).length;
    return tile;
  }));
}

function showMobileStatus(status) {
  mobileStatus = status;
  render();
}

function metaLine(text, className = '') {
  const p = document.createElement('p');
  p.className = `meta ${className}`.trim();
  p.textContent = text;
  return p;
}

function renderCard(app) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.id = app.id;
  card.dataset.status = app.status;
  card.setAttribute('aria-label', `${app.company}, ${STATUS_LABEL[app.status]}`);

  card.querySelector('.card-type').textContent = TYPES[app.type];
  card.querySelector('.company').textContent = app.company;

  const meta = card.querySelector('.card-meta');
  if (app.status === 'planned') {
    if (app.deadline) {
      const until = -daysSince(app.deadline);
      const text = until < 0
        ? `Deadline passed ${formatShortDate(app.deadline)}`
        : `Deadline ${formatShortDate(app.deadline)} · ${relativeDays(-until)}`;
      meta.append(metaLine(text, until <= 3 ? 'urgent' : ''));
    } else {
      meta.append(metaLine('Not sent yet'));
    }
  } else {
    meta.append(metaLine(`Sent ${formatDate(app.dateSent)} · ${relativeDays(daysSince(app.dateSent))}`));
  }

  if (app.interviewAt && app.status !== 'rejected') {
    const until = -daysSince(app.interviewAt);
    if (until >= 0) meta.append(metaLine(`Interview ${formatInterview(app.interviewAt)}`, until <= 1 ? 'highlight urgent' : 'highlight'));
    else meta.append(metaLine(`Interviewed ${formatShortDate(app.interviewAt.slice(0, 10))}`));
  }
  if (app.status === 'sent' && app.lastFollowUp) {
    meta.append(metaLine(`Followed up ${formatShortDate(app.lastFollowUp)}`));
  }
  if (app.contact) meta.append(metaLine(`Contact · ${app.contact}`));

  const notes = card.querySelector('.notes');
  if (app.notes) notes.textContent = app.notes;
  else notes.remove();

  const link = card.querySelector('.link');
  if (isSafeLink(app.link)) link.href = app.link;
  else link.remove();

  const followupBar = card.querySelector('.followup-bar');
  if (needsFollowUp(app)) {
    card.classList.add('needs-followup');
    followupBar.querySelector('.followup-text').textContent = `No reply in ${daysWaiting(app)} days`;
    followupBar.querySelector('.followup-btn').setAttribute('aria-label', `Mark ${app.company} as followed up`);
  } else {
    followupBar.remove();
  }

  card.querySelector('[data-action="edit"]').setAttribute('aria-label', `Edit ${app.company}`);
  card.querySelector('[data-action="delete"]').setAttribute('aria-label', `Delete ${app.company}`);
  return card;
}

/* ---------- List view ---------- */

const COLUMNS = [
  { key: 'company', label: 'Company', value: (a) => a.company.toLowerCase() },
  { key: 'type', label: 'Type', value: (a) => TYPES[a.type] },
  { key: 'status', label: 'Status', value: (a) => STATUS_IDS.indexOf(a.status) },
  { key: 'dateSent', label: 'Sent', value: (a) => a.dateSent },
  { key: 'deadline', label: 'Deadline', value: (a) => a.deadline },
  { key: 'interview', label: 'Interview', value: (a) => a.interviewAt },
  { key: 'activity', label: 'Last activity', value: (a) => lastActivity(a)?.at || '' },
];

function buildTableHead() {
  tableHead.replaceChildren(...COLUMNS.map((col) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.dataset.key = col.key;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.sort = col.key;
    btn.innerHTML = '<span></span><i class="sort-arrow" aria-hidden="true"></i>';
    btn.querySelector('span').textContent = col.label;
    th.append(btn);
    return th;
  }));
}

function sortedForTable(list) {
  const col = COLUMNS.find((c) => c.key === sort.key) || COLUMNS[0];
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = col.value(a);
    const vb = col.value(b);
    // Empty values always go last
    if (va === '' && vb !== '') return 1;
    if (vb === '' && va !== '') return -1;
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return a.company.localeCompare(b.company);
  });
}

function cell(text, className, label) {
  const td = document.createElement('td');
  if (className) td.className = className;
  if (label) td.dataset.label = label;
  if (text === '—') td.classList.add('is-empty');
  td.textContent = text;
  return td;
}

function renderTable(visible) {
  for (const th of tableHead.children) {
    const active = th.dataset.key === sort.key;
    if (active) th.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  }

  if (!visible.length) {
    const tr = document.createElement('tr');
    const td = cell(applications.length ? 'No applications match your search or filter.' : 'No applications yet.', 'table-empty');
    td.colSpan = COLUMNS.length;
    tr.append(td);
    tableBody.replaceChildren(tr);
    return;
  }

  tableBody.replaceChildren(...sortedForTable(visible).map((app) => {
    const tr = document.createElement('tr');
    tr.dataset.id = app.id;
    tr.tabIndex = 0;
    if (needsFollowUp(app)) tr.classList.add('needs-followup');

    const company = document.createElement('th');
    company.scope = 'row';
    company.className = 'col-company';
    company.textContent = app.company;

    const statusTd = document.createElement('td');
    statusTd.className = 'status-cell';
    const pill = document.createElement('label');
    pill.className = 'status-pill';
    pill.dataset.status = app.status;
    pill.innerHTML = '<i class="swatch"></i>';
    const select = document.createElement('select');
    select.className = 'status-select';
    select.setAttribute('aria-label', `Status for ${app.company}`);
    for (const s of STATUSES) select.add(new Option(s.label, s.id, false, s.id === app.status));
    pill.append(select);
    statusTd.append(pill);

    const last = lastActivity(app);
    const lastText = last
      ? `${last.kind === 'followup' ? 'Followed up' : STATUS_LABEL[last.status]} · ${formatShortDate(last.at)}`
      : '—';

    const deadlineTd = cell(app.deadline ? formatDate(app.deadline) : '—', '', 'Deadline');
    if (app.status === 'planned' && app.deadline && -daysSince(app.deadline) <= 3) deadlineTd.classList.add('urgent');

    tr.append(
      company,
      cell(TYPES[app.type], 'muted', 'Type'),
      statusTd,
      cell(app.dateSent ? formatDate(app.dateSent) : '—', '', 'Sent'),
      deadlineTd,
      cell(app.interviewAt ? formatInterview(app.interviewAt) : '—', '', 'Interview'),
      cell(lastText, 'muted', 'Last activity'),
    );
    return tr;
  }));
}

/* ---------- Overview ---------- */

function renderOverview(visible) {
  const total = visible.length;
  const counts = {};
  for (const status of STATUSES) counts[status.id] = visible.filter((a) => a.status === status.id).length;

  ledger.replaceChildren(...STATUSES.map((status) => {
    const pct = total ? Math.round((counts[status.id] / total) * 100) : 0;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ledger-cell';
    item.dataset.status = status.id;
    item.title = `Go to ${status.label}`;
    item.innerHTML = `
      <span class="ledger-name"><i class="swatch"></i><span></span></span>
      <span class="ledger-num"></span>
      <span class="ledger-pct"></span>
      <span class="ledger-bar"><i></i></span>`;
    item.querySelector('.ledger-name span').textContent = status.label;
    item.querySelector('.ledger-num').textContent = counts[status.id];
    item.querySelector('.ledger-pct').textContent = `${pct}%`;
    item.querySelector('.ledger-bar i').style.width = `${pct}%`;
    return item;
  }));

  renderDonut(counts, total);

  const replies = visible.map(responseDays).filter((d) => d !== null);
  avgReply.textContent = replies.length
    ? `Companies reply after ${Math.round(replies.reduce((s, d) => s + d, 0) / replies.length)} days on average`
    : '';

  renderUpcoming(visible);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function donutRing(className, radius) {
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('class', className);
  circle.setAttribute('cx', '60');
  circle.setAttribute('cy', '60');
  circle.setAttribute('r', String(radius));
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke-width', '13');
  return circle;
}

function renderDonut(counts, total) {
  const radius = 50;
  const circumference = 2 * Math.PI * radius;
  const used = STATUSES.filter((s) => counts[s.id] > 0);
  const gap = used.length > 1 ? 2 : 0;
  const rings = [donutRing('donut-track', radius)];

  let offset = 0;
  for (const status of used) {
    const length = (counts[status.id] / total) * circumference;
    const ring = donutRing('donut-seg', radius);
    ring.dataset.status = status.id;
    ring.setAttribute('stroke-dasharray', `${Math.max(length - gap, 0.5)} ${circumference}`);
    ring.setAttribute('stroke-dashoffset', String(-offset));
    rings.push(ring);
    offset += length;
  }

  donut.replaceChildren(...rings);
  donutTotal.textContent = total;
  donutLabel.textContent = total === 1 ? 'application' : 'applications';
  donut.setAttribute('aria-label', STATUSES.map((s) => `${s.label}: ${counts[s.id]}`).join(', '));
}

// Follow-ups, deadlines and interviews, most urgent first
function upcomingItems(list) {
  const items = [];
  for (const app of list) {
    if (app.status === 'sent' && app.dateSent) {
      const waited = daysWaiting(app);
      const dueIn = FOLLOW_UP_DAYS + 1 - waited;
      if (dueIn <= FOLLOW_UP_SOON_DAYS) {
        items.push({
          app, kind: 'Follow up', dueIn, overdue: dueIn <= 0, canFollowUp: dueIn <= 0,
          text: dueIn <= 0 ? `No reply in ${waited} days` : relativeDays(-dueIn),
        });
      }
    }
    if (app.status === 'planned' && app.deadline) {
      const dueIn = -daysSince(app.deadline);
      if (dueIn <= LOOKAHEAD_DAYS) {
        items.push({
          app, kind: 'Deadline', dueIn, overdue: dueIn < 0, urgent: dueIn <= 3,
          text: dueIn < 0 ? `Passed ${formatShortDate(app.deadline)}` : relativeDays(-dueIn),
        });
      }
    }
    if (app.interviewAt && app.status !== 'rejected') {
      const dueIn = -daysSince(app.interviewAt);
      if (dueIn >= 0 && dueIn <= LOOKAHEAD_DAYS) {
        items.push({ app, kind: 'Interview', dueIn, urgent: dueIn <= 1, text: formatInterview(app.interviewAt) });
      }
    }
  }
  return items.sort((a, b) => a.dueIn - b.dueIn);
}

function renderUpcoming(visible) {
  const items = upcomingItems(visible);
  const overdue = items.filter((i) => i.overdue).length;
  upcomingCount.textContent = overdue ? `· ${overdue} overdue` : '';

  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'up-empty';
    empty.textContent = 'Nothing coming up right now.';
    upcomingList.replaceChildren(empty);
    return;
  }

  const max = isMobile() ? 3 : UPCOMING_MAX;
  const rows = items.slice(0, max).map((item) => {
    const li = document.createElement('li');
    li.className = 'up-item';

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'up-main';
    main.dataset.id = item.app.id;
    main.innerHTML = '<span class="up-kind"></span><span class="up-company"></span><span class="up-when"></span>';
    main.querySelector('.up-kind').textContent = item.kind;
    main.querySelector('.up-company').textContent = item.app.company;
    const when = main.querySelector('.up-when');
    when.textContent = item.text;
    if (item.overdue || item.urgent) when.classList.add('urgent');
    li.append(main);

    if (item.canFollowUp) {
      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'up-action';
      done.dataset.followup = item.app.id;
      done.textContent = 'Done';
      done.title = `I followed up with ${item.app.company}`;
      li.append(done);
    }
    return li;
  });

  if (items.length > max) {
    const more = document.createElement('li');
    more.className = 'up-more';
    more.textContent = `and ${items.length - max} more`;
    rows.push(more);
  }
  upcomingList.replaceChildren(...rows);
}

function renderBackupStatus() {
  const last = storageGet(BACKUP_KEY);
  backupStatus.classList.remove('urgent');
  if (!last) {
    backupStatus.textContent = 'No backup yet';
    if (applications.length) backupStatus.classList.add('urgent');
    return;
  }
  const days = daysSince(dateFromTimestamp(last));
  backupStatus.textContent = `Last backup ${relativeDays(days)}`;
  if (days > BACKUP_REMIND_DAYS) backupStatus.classList.add('urgent');
}

/* =========================================================
   Actions
   ========================================================= */

function changeStatus(app, status) {
  if (app.status === status) return;
  app.status = status;
  if (status === 'planned') app.dateSent = '';
  else if (!app.dateSent) app.dateSent = todayISO();
  // "Sent" is logged on the day it was sent; other changes on the day they happen
  const today = todayISO();
  const at = status === 'sent' && app.dateSent < today ? app.dateSent : today;
  app.history.push({ at, kind: 'status', status });
  app.updatedAt = new Date().toISOString();
}

function setStatus(id, status) {
  const app = findApp(id);
  if (!app || app.status === status) return;
  changeStatus(app, status);
  saveApplications();
  render();
}

function markFollowedUp(id) {
  const app = findApp(id);
  if (!app) return;
  app.lastFollowUp = todayISO();
  app.history.push({ at: app.lastFollowUp, kind: 'followup' });
  app.updatedAt = new Date().toISOString();
  saveApplications();
  render();
  showToast(`Follow-up logged for ${app.company}. The reminder restarts in ${FOLLOW_UP_DAYS} days.`);
}

function deleteApplication(id) {
  const app = findApp(id);
  if (!app) return false;
  if (!confirm(`Delete the application to ${app.company}? This can’t be undone.`)) return false;
  applications = applications.filter((a) => a.id !== id);
  saveApplications();
  render();
  return true;
}

let toastTimer = null;
function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3800);
}

/* =========================================================
   Backup: export & import
   ========================================================= */

function exportBackup() {
  const payload = {
    app: 'application-tracker',
    version: 2,
    exportedAt: new Date().toISOString(),
    applications,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `application-tracker-backup-${todayISO()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  storageSet(BACKUP_KEY, new Date().toISOString());
  renderBackupStatus();
  showToast(`Backup downloaded with ${plural(applications.length, 'application')}. Keep the file somewhere safe.`);
}

async function importBackup(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    showToast('That file isn’t a valid backup (it couldn’t be read as JSON).', true);
    return;
  }

  const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.applications) ? parsed.applications : null;
  if (!list) {
    showToast('That file doesn’t look like an Application Tracker backup.', true);
    return;
  }

  const imported = normalizeList(list);
  if (!imported.length) {
    showToast('No applications found in that backup file.', true);
    return;
  }

  const skipped = list.length - imported.length;
  const question = applications.length
    ? `Replace your ${plural(applications.length, 'current application')} with the ${plural(imported.length, 'application')} in this backup?`
    : `Import ${plural(imported.length, 'application')} from this backup?`;
  if (!confirm(question)) return;

  applications = imported;
  saveApplications();
  render();
  const skippedText = skipped === 1 ? ' (1 invalid entry skipped)' : skipped ? ` (${skipped} invalid entries skipped)` : '';
  showToast(`Imported ${plural(imported.length, 'application')}${skippedText}.`);
}

/* =========================================================
   Create / edit dialog
   ========================================================= */

const FORM_FIELDS = ['company', 'type', 'status', 'dateSent', 'deadline', 'interviewAt', 'contact', 'link', 'notes'];

function updateDateSentField() {
  const planned = form.elements.status.value === 'planned';
  dateSentField.hidden = planned;
  if (!planned && !form.elements.dateSent.value) form.elements.dateSent.value = todayISO();
}

function openDialog(app = null) {
  editingId = app ? app.id : null;
  form.reset();
  formError.hidden = true;
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');

  dialogTitle.textContent = app ? 'Edit application' : 'New application';
  deleteBtn.hidden = !app;

  const values = app || {
    type: activeFilter === 'all' ? 'job' : activeFilter,
    status: 'sent',
    dateSent: todayISO(),
  };
  for (const key of FORM_FIELDS) form.elements[key].value = values[key] || '';
  updateDateSentField();

  activity.hidden = !app;
  if (app) renderActivity(app);

  dialog.showModal();
  if (!app) form.elements.company.focus();
}

function renderActivity(app) {
  logFollowUpBtn.hidden = app.status !== 'sent';

  const reply = responseDays(app);
  const parts = [];
  if (reply !== null) parts.push(`First response after ${plural(reply, 'day')}.`);
  else if (app.status === 'sent') parts.push(`Waiting for a reply for ${plural(daysSince(app.dateSent), 'day')}.`);
  const followUps = app.history.filter((h) => h.kind === 'followup').length;
  if (followUps) parts.push(`Followed up ${followUps === 1 ? 'once' : `${followUps} times`}.`);
  activitySummary.textContent = parts.join(' ');
  activitySummary.hidden = !parts.length;

  activityList.replaceChildren(...[...app.history].reverse().map((entry) => {
    const li = document.createElement('li');
    if (entry.kind === 'status') li.dataset.status = entry.status;
    else li.classList.add('is-followup');
    const time = document.createElement('time');
    time.dateTime = entry.at;
    time.textContent = formatDate(entry.at);
    const text = document.createElement('span');
    text.textContent = entry.kind === 'followup' ? 'Followed up' : ACTIVITY_TEXT[entry.status];
    li.append(time, text);
    return li;
  }));
}

function closeDialog() {
  dialog.close();
  editingId = null;
}

function showFormError(message, field) {
  formError.textContent = message;
  formError.hidden = false;
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
}

function handleSubmit(event) {
  event.preventDefault();
  const el = form.elements;

  const company = el.company.value.trim();
  if (!company) return showFormError('Please enter a company name.', el.company);

  const status = el.status.value;
  const dateSent = status === 'planned' ? '' : el.dateSent.value;
  if (status !== 'planned' && !dateSent) return showFormError('Please choose the date you sent it.', el.dateSent);

  const link = normalizeLink(el.link.value);
  if (link === null) return showFormError('That link doesn’t look like a valid web address.', el.link);

  const data = {
    company,
    type: el.type.value,
    deadline: el.deadline.value,
    interviewAt: el.interviewAt.value.slice(0, 16),
    contact: el.contact.value.trim(),
    link,
    notes: el.notes.value.trim(),
  };

  const existing = editingId && findApp(editingId);
  if (existing) {
    Object.assign(existing, data, { updatedAt: new Date().toISOString() });
    if (status !== 'planned') existing.dateSent = dateSent;
    changeStatus(existing, status);
  } else {
    applications.push(normalizeApp({ ...data, status, dateSent, id: makeId() }));
  }

  saveApplications();
  render();
  closeDialog();
}

/* =========================================================
   Drag and drop (pointer events → works with mouse AND touch)
   Mouse: start dragging after moving a few pixels.
   Touch: press and hold briefly, then drag (a quick swipe still scrolls).
   ========================================================= */

const HOLD_MS = 250;
const MOUSE_THRESHOLD = 5;
const TOUCH_TOLERANCE = 10;
const EDGE = 60;

let pending = null; // pointer is down on a card, drag not started yet
let drag = null;    // drag in progress
let suppressClick = false;

function onPointerDown(e) {
  if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const card = e.target.closest('.card');
  if (!card || e.target.closest('button, a')) return;

  pending = {
    card,
    pointerId: e.pointerId,
    isMouse: e.pointerType === 'mouse',
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX,
    y: e.clientY,
    timer: null,
  };

  if (!pending.isMouse) {
    card.classList.add('pressing');
    pending.timer = setTimeout(startDrag, HOLD_MS);
  }
}

function onPointerMove(e) {
  if (pending && e.pointerId === pending.pointerId) {
    pending.x = e.clientX;
    pending.y = e.clientY;
    const distance = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
    if (pending.isMouse && distance > MOUSE_THRESHOLD) startDrag();
    else if (!pending.isMouse && distance > TOUCH_TOLERANCE) cancelPending(); // user is scrolling
    return;
  }
  if (drag && e.pointerId === drag.pointerId) {
    e.preventDefault();
    drag.x = e.clientX;
    drag.y = e.clientY;
    updateDrag();
  }
}

function cancelPending() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.card.classList.remove('pressing');
  pending = null;
}

function startDrag() {
  if (!pending) return;
  const { card, pointerId, startX, startY, x, y } = pending;
  cancelPending();

  const rect = card.getBoundingClientRect();
  const ghost = card.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width = `${rect.width}px`;
  document.body.append(ghost);

  card.classList.add('dragging');
  document.body.classList.add('is-dragging');
  if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(10);

  drag = {
    card,
    ghost,
    pointerId,
    id: card.dataset.id,
    offsetX: startX - rect.left,
    offsetY: startY - rect.top,
    x,
    y,
    target: null,
    raf: requestAnimationFrame(autoScroll),
  };
  updateDrag();
}

function updateDrag() {
  const { ghost, x, y, offsetX, offsetY } = drag;
  ghost.style.transform = `translate(${x - offsetX}px, ${y - offsetY}px) rotate(2deg)`;

  // Drop targets: board columns (desktop) or status tiles (phones)
  const under = document.elementFromPoint(x, y);
  const target = under ? under.closest('.column, .status-tile') : null;
  if (target !== drag.target) {
    if (drag.target) drag.target.classList.remove('drop-target');
    if (target) target.classList.add('drop-target');
    drag.target = target;
  }
}

// Scroll the board / page when dragging near the edges
function autoScroll() {
  if (!drag) return;
  const rect = board.getBoundingClientRect();
  const speed = (dist) => Math.ceil((EDGE - dist) / 4);
  let moved = false;

  if (drag.x < rect.left + EDGE && board.scrollLeft > 0) {
    board.scrollLeft -= speed(drag.x - rect.left);
    moved = true;
  } else if (drag.x > rect.right - EDGE) {
    board.scrollLeft += speed(rect.right - drag.x);
    moved = true;
  }
  if (drag.y < EDGE) {
    window.scrollBy(0, -speed(drag.y));
    moved = true;
  } else if (drag.y > window.innerHeight - EDGE) {
    window.scrollBy(0, speed(window.innerHeight - drag.y));
    moved = true;
  }

  if (moved) updateDrag();
  drag.raf = requestAnimationFrame(autoScroll);
}

function endDrag(e, drop) {
  if (pending && e.pointerId === pending.pointerId) {
    cancelPending();
    return;
  }
  if (!drag || e.pointerId !== drag.pointerId) return;

  const { id, card, ghost, target, raf } = drag;
  cancelAnimationFrame(raf);
  ghost.remove();
  card.classList.remove('dragging');
  if (target) target.classList.remove('drop-target');
  document.body.classList.remove('is-dragging');
  drag = null;

  // The click that follows a drag shouldn't open the card
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 0);

  if (!drop || !target) return;
  const app = findApp(id);
  const status = target.dataset.status;
  if (!app || app.status === status) return;
  setStatus(id, status);
  // On phones the card disappears from view, so say where it went
  if (target.classList.contains('status-tile')) showToast(`Moved ${app.company} to ${STATUS_LABEL[status]}.`);
}

/* =========================================================
   Events
   ========================================================= */

function bindEvents() {
  $('addBtn').addEventListener('click', () => openDialog());
  $('fabAdd').addEventListener('click', () => openDialog());
  statusTiles.addEventListener('click', (e) => {
    const tile = e.target.closest('.status-tile');
    if (tile && !suppressClick) showMobileStatus(tile.dataset.status);
  });
  mobileQuery.addEventListener('change', render);
  $('cancelBtn').addEventListener('click', closeDialog);
  $('exportBtn').addEventListener('click', exportBackup);
  $('importBtn').addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    importInput.value = '';
    if (file) await importBackup(file);
  });

  form.addEventListener('submit', handleSubmit);
  form.addEventListener('input', (e) => {
    e.target.removeAttribute('aria-invalid');
    formError.hidden = true;
  });
  form.elements.status.addEventListener('change', updateDateSentField);

  deleteBtn.addEventListener('click', () => {
    if (editingId && deleteApplication(editingId)) closeDialog();
  });

  logFollowUpBtn.addEventListener('click', () => {
    if (!editingId) return;
    markFollowedUp(editingId);
    renderActivity(findApp(editingId));
  });

  // Click on the dimmed backdrop closes the dialog
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });
  dialog.addEventListener('close', () => { editingId = null; });

  // Cards: buttons, or click anywhere else on the card to open it
  board.addEventListener('click', (e) => {
    if (suppressClick) return;
    const card = e.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    const btn = e.target.closest('[data-action]');
    if (btn) {
      if (btn.dataset.action === 'edit') openDialog(findApp(id));
      if (btn.dataset.action === 'delete') deleteApplication(id);
      if (btn.dataset.action === 'followup') markFollowedUp(id);
      return;
    }
    if (!e.target.closest('a')) openDialog(findApp(id));
  });
  board.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('card')) openDialog(findApp(e.target.dataset.id));
  });

  // List view: sort, change status, open row
  tableHead.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    const key = btn.dataset.sort;
    sort = sort.key === key
      ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: ['company', 'type', 'status'].includes(key) ? 'asc' : 'desc' };
    render();
  });
  tableBody.addEventListener('change', (e) => {
    if (!e.target.classList.contains('status-select')) return;
    setStatus(e.target.closest('tr').dataset.id, e.target.value);
  });
  tableBody.addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-id]');
    if (row && !e.target.closest('.status-pill')) openDialog(findApp(row.dataset.id));
  });
  tableBody.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('tr[data-id]')) openDialog(findApp(e.target.dataset.id));
  });

  // Filter, search, view
  filterGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    activeFilter = btn.dataset.filter;
    storageSet(FILTER_KEY, activeFilter);
    render();
  });
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    render();
  });
  viewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    activeView = btn.dataset.view;
    storageSet(VIEW_KEY, activeView);
    render();
  });

  // Status ledger jumps to its column (switching to the board if needed)
  ledger.addEventListener('click', (e) => {
    const item = e.target.closest('.ledger-cell');
    if (!item) return;
    if (activeView !== 'board') {
      activeView = 'board';
      storageSet(VIEW_KEY, activeView);
    }
    mobileStatus = item.dataset.status;
    render();
    $(`column-${item.dataset.status}`).scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'start' });
  });

  // "Coming up" rows open the application; "Done" logs a follow-up
  upcomingList.addEventListener('click', (e) => {
    const done = e.target.closest('[data-followup]');
    if (done) return markFollowedUp(done.dataset.followup);
    const row = e.target.closest('.up-main');
    if (row) openDialog(findApp(row.dataset.id));
  });

  // Drag and drop
  board.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', (e) => endDrag(e, true));
  window.addEventListener('pointercancel', (e) => endDrag(e, false));
  // Stop the page from scrolling while a card is being dragged on touch screens
  window.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
  board.addEventListener('contextmenu', (e) => { if (pending || drag) e.preventDefault(); });

  // Keep "days ago" fresh when you come back to the tab
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !dialog.open) render(); });

  // Sync if the app is open in another tab
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      applications = loadApplications();
      render();
    }
  });
}

/* =========================================================
   Start
   ========================================================= */

function init() {
  try {
    localStorage.setItem('applicationTracker.test', '1');
    localStorage.removeItem('applicationTracker.test');
  } catch {
    storageNote.hidden = false;
  }

  const savedFilter = storageGet(FILTER_KEY);
  if (savedFilter === 'all' || Object.hasOwn(TYPES, savedFilter ?? '')) activeFilter = savedFilter;
  const savedView = storageGet(VIEW_KEY);
  if (savedView === 'board' || savedView === 'list') activeView = savedView;

  $('today').textContent = new Intl.DateTimeFormat(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date());

  applications = loadApplications();
  buildBoard();
  buildTableHead();
  bindEvents();
  render();

  // Offline support + "Add to Home Screen" (only works when served over http/https, e.g. GitHub Pages)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
