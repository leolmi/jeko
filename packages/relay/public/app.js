// Pagina remota di Jeko: progetti, task e risposte, attraverso il relay (messaggi cifrati).
import { lang, setLang, t } from './i18n.js';
import { importKey, open, seal } from './seal.js';

const STORE = 'jeko-remote';
const ACTIVE = ['queued', 'running', 'waiting'];
/** Workflow dei task diretti e passo del loro messaggio seguente (come in @jeko/shared). */
const DIRECT_WORKFLOW = 'diretto';
const DIRECT_FOLLOW_UP = 'seguito';
const STATUSES = ['queued', 'running', 'waiting', 'done', 'failed', 'rejected', 'cancelled'];
const statusLabel = (s) => (STATUSES.includes(s) ? t(`status.${s}`) : s);
const MODES = ['headless', 'checkpoint', 'interactive'];
const modeLabel = (m) => (MODES.includes(m) ? t(`mode.${m}`) : m);
/** Icone della web-app (Material Icons, Apache 2.0). */
const ICONS = {
  plan: 'M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3z',
  direct: 'M7 2v11h3v9l7-12h-4l4-8z',
  send: 'M2.01 21L23 12 2.01 3 2 10l15 2-15 2z',
  idea: 'M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z',
  issue:
    'M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5c-.49 0-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z',
  arrow: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  close:
    'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
};
const NOTE_KINDS = ['idea', 'issue'];
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}" /></svg>`;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const folderKey = (p) =>
  (p ?? '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
const cap = (s) => s[0].toUpperCase() + s.slice(1);
/** Come nella web-app: `opus` → Opus, `claude-opus-5-5` → Opus 5.5; gli altri come sono. */
function modelLabel(m) {
  if (/^[a-z]+$/.test(m)) return cap(m);
  const [name, ...nums] = m
    .replace(/^claude-/, '')
    .replace(/\[.*\]$/, '')
    .split('-')
    .filter((p) => !/^\d{8}$/.test(p));
  return name && /^[a-z]+$/.test(name) && nums.length && nums.every((n) => /^\d+$/.test(n))
    ? `${cap(name)} ${nums.join('.')}`
    : m;
}
/** Alias dei modelli, come MODEL_ALIASES in @jeko/shared. */
const MODEL_ALIASES = ['opus', 'sonnet', 'fable', 'haiku'];
const effortLabel = (e) => (EFFORTS.includes(e) ? t(`effort.${e}`) : e);
/** Modelli da scegliere: gli alias (con la versione se è quella del predefinito) più quelli fuori elenco. */
function modelChoices(defaultModel, ...extra) {
  const known = defaultModel ? modelLabel(defaultModel) : '';
  const list = MODEL_ALIASES.map((id) => ({
    id,
    label: known.startsWith(`${cap(id)} `) ? known : cap(id),
  }));
  for (const m of extra)
    if (m && !list.some((x) => x.id === m)) list.push({ id: m, label: modelLabel(m) });
  return list;
}
/** Modello e impegno con cui lavora il task (vuoto se non si sa). */
const agentText = (r) =>
  [
    r.model && modelLabel(r.model),
    r.effort && t('agent.effort', { e: effortLabel(r.effort).toLowerCase() }),
  ]
    .filter(Boolean)
    .join(' · ');
const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString(lang(), {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

// ---------- abbinamento ----------

function pairing() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('c') && hash.get('d') && hash.get('k')) {
    const p = { c: hash.get('c'), d: hash.get('d'), k: hash.get('k') };
    // Senza archivio vale finché la pagina resta aperta; la chiave poi passa in IndexedDB.
    savePairing(p);
    history.replaceState(null, '', location.pathname);
    return p;
  }
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? 'null');
  } catch {
    return null;
  }
}

function savePairing(p) {
  try {
    localStorage.setItem(STORE, JSON.stringify(p));
  } catch {
    /* niente */
  }
}

function forget() {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* niente */
  }
  void keyDb('readwrite', (s) => s.delete('key')).catch(() => {});
}

// La chiave sta in IndexedDB come CryptoKey non estraibile: nemmeno uno script nella pagina può
// leggerla. Nel localStorage restano solo canale e dispositivo.
function keyDb(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(STORE, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('keys', mode);
      const r = fn(tx.objectStore('keys'));
      tx.oncomplete = () => (db.close(), resolve(r.result));
      tx.onerror = tx.onabort = () => (db.close(), reject(tx.error));
    };
  });
}

/** Chiave del dispositivo: dal link appena aperto (e salvata), o quella salvata. */
async function loadKey(pair) {
  if (pair.k) {
    const key = await importKey(pair.k);
    try {
      await keyDb('readwrite', (s) => s.put({ d: pair.d, key }, 'key'));
      delete pair.k;
      savePairing(pair);
    } catch {
      /* senza IndexedDB la chiave resta nel localStorage, come prima */
    }
    return key;
  }
  const saved = await keyDb('readonly', (s) => s.get('key')).catch(() => {
    throw Object.assign(new Error('IndexedDB non disponibile'), { retry: true });
  });
  if (saved?.d !== pair.d || !(saved.key instanceof CryptoKey)) throw new Error('Chiave assente');
  return saved.key;
}

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac/.test(ua)
            ? 'Mac'
            : 'Browser';
  const br = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '';
  return br ? `${os} · ${br}` : os;
}

// ---------- stato ----------

const state = {
  pair: pairing(),
  key: null,
  socket: null,
  relay: false,
  host: false,
  confirmed: null,
  projects: [],
  runs: [],
  at: null,
  view: { name: 'home' },
  detail: null,
  /**
   * Scelte della chat in fondo al progetto: controllo, con/senza workflow, modello e impegno
   * (`agent`, vuoto = quelli del progetto; si riparte da vuoto cambiando progetto) e pannello aperto.
   */
  composer: {
    mode: 'checkpoint',
    direct: false,
    agent: {},
    agentOf: null,
    picking: false,
    /** Nota da cui viene il testo: quando il task parte le si lega. */
    note: null,
  },
  /** Scheda della home: i task e i progetti, o le note. */
  tab: 'tasks',
  /** Note (null finché non arrivano); quella aperta (con i comandi) e quella in modifica. */
  notes: null,
  noteOpen: null,
  noteEdit: null,
  noteKind: 'idea',
  /** Messaggi lunghi dell'attività aperti per intero (chiave: istante e posizione). */
  expanded: new Set(),
  error: '',
  ended: '',
};
const pending = new Map();
let reqSeq = 0;

// ---------- collegamento ----------

async function connect() {
  if (!state.pair) return render();
  if (!crypto?.subtle) {
    state.ended = t('err.https');
    return render();
  }
  try {
    state.key ??= await loadKey(state.pair);
  } catch (e) {
    // IndexedDB non disponibile adesso: l'abbinamento resta, si riprova ricaricando.
    if (e.retry) {
      state.ended = t('err.key');
      return render();
    }
    forget();
    state.pair = null;
    return render();
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const q = new URLSearchParams({ c: state.pair.c, d: state.pair.d });
  const ws = new WebSocket(`${proto}://${location.host}/ws/client?${q}`);
  state.socket = ws;
  ws.onopen = () => {
    state.relay = true;
    void send({ t: 'hello', name: deviceName() });
    render();
  };
  ws.onmessage = (e) => void onFrame(String(e.data));
  ws.onclose = (e) => {
    state.relay = false;
    state.host = false;
    state.socket = null;
    for (const [, p] of pending) p.reject(new Error(t('err.lost')));
    pending.clear();
    if (e.code === 4403) {
      forget();
      state.ended = t('err.dropped');
      return render();
    }
    render();
    setTimeout(connect, 3000);
  };
}

async function send(body) {
  const ws = state.socket;
  if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error(t('err.offline'));
  ws.send(JSON.stringify({ m: await seal(state.key, 'c2h', state.pair.d, body) }));
}

function request(method, path, body) {
  const id = `r${++reqSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(t('err.timeout')));
    }, 20_000);
    pending.set(id, {
      resolve: (v) => (clearTimeout(timer), resolve(v)),
      reject: (e) => (clearTimeout(timer), reject(e)),
    });
    send({ t: 'req', id, method, path, ...(body !== undefined && { body }) }).catch((e) => {
      pending.delete(id);
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function api(method, path, body) {
  const res = await request(method, path, body);
  if (res.status >= 400) throw new Error(res.body?.message ?? t('err.status', { n: res.status }));
  return res.body;
}

async function onFrame(data) {
  let msg;
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }
  if (msg.relay === 'host') {
    state.host = msg.online;
    if (msg.online) void send({ t: 'hello', name: deviceName() }).catch(() => {});
    return render();
  }
  if (typeof msg.m !== 'string') return;
  const opened = await open(state.key, 'h2c', state.pair.d, msg.m);
  if (!opened) return;
  const body = opened.body;
  if (body.t === 'state') {
    setLang(body.lang);
    state.confirmed = body.confirmed;
    if (body.confirmed) {
      state.projects = body.projects;
      state.runs = body.runs;
      state.at = body.at;
      if (state.notes === null && state.host) void loadNotes();
    }
    return render();
  }
  if (body.t === 'res') {
    const p = pending.get(body.id);
    pending.delete(body.id);
    return p?.resolve(body);
  }
  if (body.t === 'event') onEvent(body.msg);
}

function onEvent(msg) {
  state.at = new Date().toISOString();
  const run = (id) => state.runs.find((r) => r.id === id);
  const open = state.view.name === 'task' && state.detail?.id === msg.runId;
  switch (msg.type) {
    case 'run.status': {
      const r = run(msg.runId);
      if (r) Object.assign(r, { status: msg.status, error: msg.error });
      else void refreshRuns();
      if (open) Object.assign(state.detail, { status: msg.status, error: msg.error });
      break;
    }
    case 'run.path': {
      const r = run(msg.runId);
      if (r) r.path = msg.path;
      if (open) state.detail.path = msg.path;
      break;
    }
    case 'run.prompt':
      if (open) {
        const list = state.detail.prompts.filter((p) => p.id !== msg.prompt.id);
        state.detail.prompts = [...list, msg.prompt];
      }
      break;
    case 'run.event':
      if (open && msg.record.event.type === 'state' && msg.record.event.state?.sessionId)
        state.detail.session = true;
      if (open && msg.record.event.type !== 'state') {
        state.detail.events = [...state.detail.events, msg.record].slice(-150);
      }
      break;
    case 'project.added':
      state.projects = [...state.projects, msg.project];
      break;
    case 'runs.removed':
      state.runs = state.runs.filter((r) => !msg.ids.includes(r.id));
      break;
    default:
      return;
  }
  render();
}

async function loadNotes() {
  try {
    state.notes = await api('GET', '/api/notes');
    render();
  } catch {
    /* si riprova aprendo le note */
  }
}

async function refreshRuns() {
  try {
    state.runs = await api('GET', '/api/runs');
    render();
  } catch {
    /* lo stato arriva comunque col prossimo aggiornamento */
  }
}

// ---------- navigazione ----------

function go(view) {
  history.pushState(view, '');
  show(view);
}

function show(view) {
  state.view = view;
  state.error = '';
  if (view.name === 'task') {
    state.detail = null;
    api('GET', `/api/runs/${view.id}`)
      .then((d) => {
        if (state.view.name === 'task' && state.view.id === view.id) state.detail = d;
        render();
      })
      .catch((e) => {
        state.error = e.message;
        render();
      });
  }
  render();
  // Nel progetto i task più recenti sono in fondo, vicino alla chat.
  $('main').scrollTop = view.name === 'project' ? $('main').scrollHeight : 0;
}

addEventListener('popstate', (e) => show(e.state ?? { name: 'home' }));

// ---------- viste ----------

const projectOf = (run) => state.projects.find((p) => folderKey(p.path) === folderKey(run.cwd));
const runsOf = (project) =>
  state.runs
    .filter((r) => folderKey(r.cwd) === folderKey(project.path))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

function pathDots(path) {
  return `<div class="path">${(path ?? []).map((m) => `<i class="${m}"></i>`).join('')}</div>`;
}

function runRow(r, withProject = false) {
  const project = withProject ? projectOf(r) : null;
  return `<button class="card row" data-go-task="${esc(r.id)}">
    <div class="grow">
      <div class="clip">${esc(r.request)}</div>
      <div class="muted clip">${[project?.name, when(r.updatedAt), agentText(r)].filter(Boolean).map(esc).join(' · ')}</div>
      ${pathDots(r.path)}
    </div>
    <span class="badge ${r.status}">${esc(statusLabel(r.status))}</span>
  </button>`;
}

function projectRow(p) {
  const runs = runsOf(p);
  const w = runs.filter((r) => r.status === 'waiting').length;
  const a = runs.filter((r) => r.status === 'running' || r.status === 'queued').length;
  return `<button class="card row" data-go-project="${esc(p.id)}">
    <div class="grow"><div class="clip">${esc(p.name)}</div>
    <div class="muted clip">${esc(p.path)}</div></div>
    ${w ? `<span class="badge waiting">${t('project.waiting', { n: w })}</span>` : ''}
    ${a ? `<span class="badge running">${t('project.active', { n: a })}</span>` : ''}
  </button>`;
}

/** Schede della home: task e progetti, o note (col numero di quelle da lavorare). */
function homeTabs() {
  const todo = (state.notes ?? []).filter((n) => !n.runId).length;
  const tab = (k, label) =>
    `<button type="button" role="tab" aria-selected="${state.tab === k}" data-tab="${k}">${label}</button>`;
  const notes = todo ? `${t('tabs.notes')} · ${todo}` : t('tabs.notes');
  return `<div class="tabs" role="tablist">${tab('tasks', t('tabs.tasks'))}${tab('notes', notes)}</div>`;
}

/** Home: da rispondere, poi i preferiti (nel loro ordine), poi gli altri progetti per nome. */
function viewHome() {
  if (state.tab === 'notes') return homeTabs() + viewNotes();
  const waiting = state.runs.filter((r) => r.status === 'waiting');
  const favorites = state.projects
    .filter((p) => p.favorite !== undefined)
    .sort((a, b) => a.favorite - b.favorite);
  const others = state.projects
    .filter((p) => p.favorite === undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
  const section = (title, html) => (html ? `<h2>${title}</h2>${html}` : '');
  return (
    homeTabs() +
    section(t('home.waiting'), waiting.map((r) => runRow(r, true)).join('')) +
    section(t('home.favorites'), favorites.map(projectRow).join('')) +
    (section(t('home.projects'), others.map(projectRow).join('')) ||
      (favorites.length ? '' : `<p class="empty">${t('home.empty')}</p>`))
  );
}

function noteCard(n) {
  const open = state.noteOpen === n.id;
  const hasProject = state.projects.some((p) => p.id === n.projectId);
  const kind = esc(t(`notes.${n.kind}`));
  return `<div class="card note">
    <button type="button" class="note-main" data-note-open="${esc(n.id)}" aria-expanded="${open}">
      <span class="note-kind ${n.kind}" role="img" aria-label="${kind}" title="${kind}">${icon(n.kind)}</span>
      <span class="grow"><span class="note-body">${esc(n.body)}</span>
      <span class="muted">${when(n.createdAt)}</span></span>
    </button>
    ${
      open
        ? `<div class="actions">
            ${hasProject ? `<button type="button" class="btn primary" data-note-task="${esc(n.id)}">${icon('arrow')} ${t('notes.toTask')}</button>` : ''}
            <button type="button" class="btn" data-note-edit="${esc(n.id)}" aria-label="${t('notes.edit')}" title="${t('notes.edit')}">${icon('edit')}</button>
            <button type="button" class="btn danger" data-note-delete="${esc(n.id)}" aria-label="${t('notes.delete')}" title="${t('notes.delete')}">${icon('delete')}</button>
          </div>`
        : ''
    }
  </div>`;
}

/** Note da lavorare per progetto, in ordine di nome; quelle senza progetto in fondo. */
function viewNotes() {
  if (state.notes === null) return `<p class="empty">${t('notes.loading')}</p>`;
  const todo = state.notes.filter((n) => !n.runId);
  const known = new Set(state.projects.map((p) => p.id));
  const groups = [...state.projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => [p.name, todo.filter((n) => n.projectId === p.id)]);
  groups.push([t('notes.noProject'), todo.filter((n) => !known.has(n.projectId))]);
  const html = groups
    .filter(([, notes]) => notes.length)
    .map(([name, notes]) => `<h2>${esc(name)}</h2>${notes.map(noteCard).join('')}`)
    .join('');
  return html || `<p class="empty">${t('notes.empty')}</p>`;
}

/** In fondo alle note: una nuova, o quella in modifica. */
function noteForm() {
  const editing = !!state.noteEdit;
  const projects = [...state.projects].sort((a, b) => a.name.localeCompare(b.name));
  return `
    <div class="note-form">
      ${editing ? `<div class="muted">${t('notes.editing')}</div>` : ''}
      <textarea id="note-body" data-keep rows="2" aria-label="${t('notes.new')}" placeholder="${esc(t('notes.placeholder'))}"></textarea>
      ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
      <div class="note-bar">
        <div class="seg" role="radiogroup" aria-label="${t('notes.kind')}">
          ${NOTE_KINDS.map(
            (k) =>
              `<button type="button" role="radio" aria-checked="${k === state.noteKind}" data-note-kind="${k}">${icon(k)} ${t(`notes.${k}`)}</button>`,
          ).join('')}
        </div>
        <select id="note-project" data-keep aria-label="${t('notes.project')}">
          <option value="">${t('notes.noProject')}</option>
          ${projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
        </select>
        ${editing ? `<button type="button" class="btn ghost" data-act="note-cancel">${t('notes.cancel')}</button>` : ''}
        <button type="button" class="btn primary" data-act="note-save">${t(editing ? 'notes.save' : 'notes.add')}</button>
      </div>
    </div>`;
}

function viewProject(project) {
  const runs = runsOf(project);
  return runs.map((r) => runRow(r)).join('') || `<p class="empty">${t('project.empty')}</p>`;
}

/** Task diretto aperto in attesa del messaggio seguente: la sua richiesta, o null. */
const followUpOf = (task) =>
  task && ACTIVE.includes(task.status)
    ? (task.prompts.find((p) => p.status === 'pending' && p.prompt.stepId === DIRECT_FOLLOW_UP) ??
      null)
    : null;

/**
 * Chat in fondo, come nella web-app: un nuovo task sul progetto. Sul task aperto in pagina: se è
 * diretto e aspetta il seguito lo continua; se è chiuso ne avvia uno nuovo, che riparte dalla sua
 * conversazione se era diretto.
 */
function composer(project, task = null) {
  const follow = followUpOf(task);
  const closed = !!task && !ACTIVE.includes(task.status);
  const fork = closed && task.workflow === DIRECT_WORKFLOW && !!task.session;
  const busy = runsOf(project).some((r) => ACTIVE.includes(r.status));
  const direct = !!follow || fork || state.composer.direct;
  const mode = follow ? task.mode : state.composer.mode;
  const tone = direct ? 'direct' : 'plan';
  const name = esc(project.name);
  const placeholder = t(
    follow
      ? 'composer.continue.placeholder'
      : fork
        ? 'composer.fork.placeholder'
        : closed
          ? 'composer.closed.placeholder'
          : 'composer.placeholder',
    { name },
  );
  const send = t(
    follow || (fork && !busy) ? 'composer.continue' : busy ? 'composer.enqueue' : 'composer.send',
  );
  const fromTask = esc(t('composer.fromTask'));
  if (state.composer.agentOf !== project.id)
    Object.assign(state.composer, { agent: {}, agentOf: project.id, picking: false });
  // Continuando valgono modello e impegno del task; altrimenti la scelta, poi il progetto.
  const chosen = follow ? {} : state.composer.agent;
  const inherited = follow ? {} : (project.agent ?? {});
  const model = follow ? task.model : (chosen.model ?? inherited.model);
  const effort = follow ? task.effort : (chosen.effort ?? inherited.effort);
  const models = modelChoices(project.defaultModel, chosen.model, inherited.model);
  const labelOf = (m) => models.find((x) => x.id === m)?.label ?? modelLabel(m);
  const shownModel = model
    ? labelOf(model)
    : project.defaultModel
      ? modelLabel(project.defaultModel)
      : t('agent.defaultModel');
  const fromProject = (v) => t('agent.fromProject', { v });
  const option = (field, value, label, note = '') =>
    `<button type="button" role="radio" aria-checked="${(chosen[field] ?? '') === value}" data-agent-${field}="${esc(value)}">${esc(label)}${note ? ` <small>${esc(note)}</small>` : ''}</button>`;
  const picker =
    state.composer.picking && !follow
      ? `<div class="agent-panel">
          <div class="muted">${t('agent.model')}</div>
          <div class="chips" role="radiogroup" aria-label="${t('agent.model')}">
            ${option('model', '', t('agent.default'), inherited.model ? fromProject(labelOf(inherited.model)) : project.defaultModel ? modelLabel(project.defaultModel) : '')}
            ${models.map((m) => option('model', m.id, m.label)).join('')}
          </div>
          <div class="muted">${t('agent.effortLabel')}</div>
          <div class="chips" role="radiogroup" aria-label="${t('agent.effortLabel')}">
            ${option('effort', '', t('agent.default'), inherited.effort ? fromProject(effortLabel(inherited.effort)) : '')}
            ${EFFORTS.map((e) => option('effort', e, effortLabel(e))).join('')}
          </div>
        </div>`
      : '';
  const note = !task && state.composer.note?.projectId === project.id ? state.composer.note : null;
  return `
    <div class="composer ${tone}">
      <div class="composer-head">
        ${note ? `<button type="button" class="from-note" data-act="unnote" title="${esc(t('notes.unlink'))}">${icon('idea')} ${t('notes.fromNote')} ${icon('close')}</button>` : ''}
        <span class="mode-badge">${icon(tone)} ${t(direct ? 'composer.direct' : 'composer.plan')}</span>
      </div>
      ${picker}
      <textarea id="req" data-keep rows="2" aria-label="${t('composer.request')}" placeholder="${esc(placeholder)}">${note ? esc(note.body) : ''}</textarea>
      ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
      <div class="composer-bar">
        <div class="seg" role="radiogroup" aria-label="${t('composer.control')}"${follow ? ` aria-disabled="true" title="${fromTask}"` : ''}>
          ${MODES.map(
            (k) =>
              `<button type="button" role="radio" aria-checked="${k === mode}" data-mode="${k}"${follow ? ' disabled' : ''}>${modeLabel(k)}</button>`,
          ).join('')}
        </div>
        <button type="button" class="switch${follow || fork ? ' invisible' : ''}" data-act="switch" aria-label="${t('composer.switch')}" aria-pressed="${direct}"
          title="${esc(t(direct ? 'composer.direct.hint' : 'composer.plan.hint'))}">
          <span class="${direct ? '' : 'on'}">${icon('plan')}</span><span class="${direct ? 'on' : ''}">${icon('direct')}</span>
        </button>
        <button type="button" class="agent" data-act="agent" aria-label="${t('agent.title')}" aria-expanded="${state.composer.picking && !follow}"
          ${follow ? `disabled title="${fromTask}"` : `title="${t('agent.title')}"`}>
          <b>${esc(shownModel)}</b>${effort ? ` <span>${esc(effortLabel(effort))}</span>` : ''}
        </button>
        <button type="button" class="btn send" data-act="start">${icon('send')} ${send}</button>
      </div>
    </div>`;
}

function promptCard(p) {
  const q = p.prompt;
  let body = '';
  if (q.kind === 'ask') {
    const opts = q.options?.map((o) => o.label) ?? q.enum ?? [];
    body = `
      ${q.header ? `<div class="muted">${esc(q.header)}</div>` : ''}
      <p>${esc(q.question)}</p>
      ${q.options?.map((o) => (o.description ? `<p class="muted">• <b>${esc(o.label)}</b>: ${esc(o.description)}</p>` : '')).join('') ?? ''}
      ${
        q.multiSelect
          ? opts
              .map(
                (o, i) =>
                  `<label class="check"><input type="checkbox" data-keep id="opt-${p.id}-${i}" value="${esc(o)}" /> ${esc(o)}</label>`,
              )
              .join('')
          : `<div class="actions">${opts
              .map(
                (o) =>
                  `<button class="btn" data-ask="${esc(p.id)}" data-value="${esc(o)}">${esc(o)}</button>`,
              )
              .join('')}</div>`
      }
      <input type="text" id="txt-${p.id}" data-keep placeholder="${q.default ? t('prompt.default', { value: esc(q.default) }) : t('prompt.other')}" class="mt" />
      <div class="actions">
        <button class="btn primary" data-ask-send="${esc(p.id)}" data-multi="${q.multiSelect ? opts.length : ''}">${t('prompt.send')}</button>
        ${q.required ? '' : `<button class="btn" data-ask="${esc(p.id)}" data-null="1">${t('prompt.skip')}</button>`}
      </div>`;
  } else if (q.kind === 'approve') {
    body = `
      <p>${esc(q.message)}</p>
      ${q.output ? `<pre>${esc(q.output)}</pre>` : ''}
      <input type="text" id="txt-${p.id}" data-keep placeholder="${t('prompt.note')}" class="mt" />
      <div class="actions">
        <button class="btn primary" data-approve="${esc(p.id)}" data-ok="1">${t('prompt.approve')}</button>
        <button class="btn danger" data-approve="${esc(p.id)}" data-ok="">${t('prompt.reject')}</button>
      </div>`;
  } else {
    body = `
      <p>${t('prompt.review')}</p>
      <pre>${esc(q.output)}</pre>
      <textarea id="txt-${p.id}" data-keep placeholder="${t('prompt.feedback')}" class="mt"></textarea>
      <div class="actions">
        <button class="btn primary" data-review="${esc(p.id)}" data-ok="1">${t('prompt.ok')}</button>
        <button class="btn" data-review="${esc(p.id)}" data-ok="">${t('prompt.changes')}</button>
      </div>`;
  }
  return `<div class="card">${body}</div>`;
}

function feed(d) {
  // I messaggi seguenti dell'utente (task diretto) fra gli eventi, in ordine di tempo.
  const said = d.prompts
    .filter((p) => p.prompt.stepId === DIRECT_FOLLOW_UP && p.answer?.value)
    .map((p) => ({ at: p.createdAt, you: p.answer.value }));
  const items = [...d.events, ...said].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const lines = [];
  // Testo lungo: si vedono le prime righe, il resto su richiesta.
  const clip = (key, cls, text, max) => {
    const long = text.length > max * 80 || text.split('\n').length > max;
    if (!long) return `<p class="${cls}">${esc(text)}</p>`;
    const open = state.expanded.has(key);
    return `<div class="more lines-${max}${open ? ' open' : ''}"><p class="${cls}">${esc(text)}</p>
      <button class="link" data-more="${esc(key)}">${t(open ? 'feed.less' : 'feed.more')}</button></div>`;
  };
  items.forEach((item, i) => {
    const key = `${item.at}|${i}`;
    if (item.you) {
      lines.push(`<p class="you"><b>${t('feed.you')}</b> ${esc(item.you)}</p>`);
      return;
    }
    const e = item.event;
    if (e.type === 'step.started' && e.title) lines.push(`<p><b>${esc(e.title)}</b></p>`);
    else if (e.type === 'agent.activity' && e.kind === 'text')
      lines.push(clip(key, 'text', e.text, 6));
    else if (e.type === 'agent.activity')
      lines.push(clip(key, 'tool', `${e.tool ?? ''} ${e.text}`, 2));
    else if (e.type === 'step.finished' && !e.ok)
      lines.push(`<p class="error">${t('feed.stepFailed')}</p>`);
    else if (e.type === 'run.finished')
      lines.push(
        `<p class="muted">${t('feed.end', { status: esc(statusLabel(e.status)) })}${e.error ? ` — ${esc(e.error)}` : ''}</p>`,
      );
  });
  return lines.slice(-40).join('');
}

function viewTask() {
  const d = state.detail;
  if (!d)
    return state.error
      ? `<p class="error">${esc(state.error)}</p>`
      : `<p class="empty">${t('task.loading')}</p>`;
  const follow = followUpOf(d);
  const origin = d.from ? state.runs.find((r) => r.id === d.from) : null;
  const prompts = ACTIVE.includes(d.status)
    ? d.prompts.filter((p) => p.status === 'pending' && p.prompt.stepId !== DIRECT_FOLLOW_UP)
    : [];
  return `
    <div class="card">
      <div class="row"><div class="grow">${esc(d.request)}</div>
      <span class="badge ${d.status}">${esc(statusLabel(d.status))}</span></div>
      <div class="muted">${esc(d.workflow)} · ${esc(modeLabel(d.mode))} · ${when(d.createdAt)}</div>
      ${agentText(d) ? `<div class="muted">${esc(agentText(d))}</div>` : ''}
      ${origin ? `<button class="link muted clip" data-go-task="${esc(origin.id)}">${t('task.from', { request: esc(origin.request) })}</button>` : ''}
      ${pathDots(d.path)}
      ${d.error ? `<p class="error">${esc(d.error)}</p>` : ''}
      ${ACTIVE.includes(d.status) ? `<div class="actions"><button class="btn danger" data-act="cancel">${t('task.cancel')}</button></div>` : ''}
    </div>
    ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
    ${prompts.length ? `<h2>${t('task.prompts')}</h2>${prompts.map(promptCard).join('')}` : ''}
    <h2>${t('task.activity')}</h2>
    <div class="card feed">${feed(d) || `<p class="muted">${t('task.nothing')}</p>`}</div>
    ${
      follow
        ? `<div class="follow"><span>${t('task.follow')}</span>
            <button class="btn ghost" data-ask="${esc(follow.id)}" data-null="1">${t('task.close')}</button></div>`
        : ''
    }`;
}

function render() {
  // I campi che l'utente sta compilando sopravvivono ai ridisegni.
  const kept = {};
  for (const el of document.querySelectorAll('[data-keep]'))
    kept[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  const focus = document.activeElement?.id;

  const status = $('status');
  let title = 'Jeko';
  let html;
  let dock = '';
  if (state.ended) html = `<p class="empty">${esc(state.ended)}</p>`;
  else if (!state.pair) html = `<p class="empty">${t('pair.none')}</p>`;
  else if (state.confirmed === false)
    html = `<p class="empty">${t('pair.toConfirm', { name: esc(deviceName()) })}</p>`;
  else if (state.confirmed === null && !state.at)
    html = `<p class="empty">${t('pair.connecting')}</p>`;
  else if (state.view.name === 'project') {
    const p = state.projects.find((x) => x.id === state.view.id);
    title = p?.name ?? t('project.title');
    html = p ? viewProject(p) : `<p class="empty">${t('project.notFound')}</p>`;
    if (p) dock = composer(p);
  } else if (state.view.name === 'task') {
    title = state.detail ? (projectOf(state.detail)?.name ?? t('task.title')) : t('task.title');
    html = viewTask();
    const p = state.detail && projectOf(state.detail);
    if (p) dock = composer(p, state.detail);
  } else {
    html = viewHome();
    if (state.tab === 'notes' && state.notes !== null) dock = noteForm();
  }

  $('title').textContent = title;
  document.title = t('app.title');
  $('back').setAttribute('aria-label', t('back'));
  $('back').hidden = state.view.name === 'home' || !state.at;
  status.className = `status ${state.host ? 'on' : state.pair ? 'off' : ''}`;
  status.textContent = !state.pair
    ? ''
    : state.host
      ? t('status.host')
      : state.relay
        ? `${t('status.hostOff')}${state.at ? ` · ${t('status.dataAt', { at: when(state.at) })}` : ''}`
        : t('status.relayOff');
  const main = $('main');
  // Se si era in fondo (task più recenti), ci si resta anche quando la lista cresce.
  const atBottom = main.scrollHeight - main.scrollTop - main.clientHeight < 24;
  main.innerHTML = html;
  if (state.view.name === 'project' && atBottom) main.scrollTop = main.scrollHeight;
  $('dock').innerHTML = dock;
  $('dock').hidden = !dock;

  for (const [id, v] of Object.entries(kept)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = v;
    else el.value = v;
  }
  if (focus) document.getElementById(focus)?.focus();
}

// ---------- azioni ----------

async function act(fn) {
  state.error = '';
  try {
    await fn();
  } catch (e) {
    state.error = e.message;
  }
  render();
}

async function answer(promptId, value) {
  const runId = state.detail.id;
  await api('POST', `/api/runs/${runId}/prompts/${promptId}`, value);
  const p = state.detail?.prompts.find((x) => x.id === promptId);
  if (p) Object.assign(p, { status: 'answered', answer: value });
}

$('back').addEventListener('click', () => history.back());

function onClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const d = btn.dataset;
  if (d.mode) {
    state.composer.mode = d.mode;
    return render();
  }
  if (d.act === 'switch') {
    state.composer.direct = !state.composer.direct;
    return render();
  }
  if (d.act === 'agent') {
    state.composer.picking = !state.composer.picking;
    return render();
  }
  for (const field of ['model', 'effort']) {
    const v = d[`agent${cap(field)}`];
    if (v === undefined) continue;
    const { [field]: _, ...rest } = state.composer.agent;
    state.composer.agent = v ? { ...rest, [field]: v } : rest;
    return render();
  }
  if (d.more) {
    if (!state.expanded.delete(d.more)) state.expanded.add(d.more);
    return render();
  }
  if (d.tab) {
    state.tab = d.tab;
    state.error = '';
    if (d.tab === 'notes') void loadNotes();
    return render();
  }
  if (d.noteOpen) {
    state.noteOpen = state.noteOpen === d.noteOpen ? null : d.noteOpen;
    return render();
  }
  if (d.noteKind) {
    state.noteKind = d.noteKind;
    return render();
  }
  if (d.noteEdit) {
    const n = state.notes?.find((x) => x.id === d.noteEdit);
    if (!n) return;
    state.noteEdit = n.id;
    state.noteKind = n.kind;
    // I campi tengono quello che c'è scritto: si riempiono prima di ridisegnare.
    $('note-body').value = n.body;
    $('note-project').value = n.projectId ?? '';
    render();
    return $('note-body').focus();
  }
  if (d.act === 'note-cancel') {
    state.noteEdit = null;
    $('note-body').value = '';
    return render();
  }
  if (d.act === 'note-save')
    return act(async () => {
      const body = $('note-body').value.trim();
      if (!body) throw new Error(t('err.note'));
      btn.disabled = true;
      const fields = { body, kind: state.noteKind, projectId: $('note-project').value || null };
      const saved = state.noteEdit
        ? await api('PATCH', `/api/notes/${state.noteEdit}`, fields)
        : await api('POST', '/api/notes', fields);
      const others = (state.notes ?? []).filter((n) => n.id !== saved.id);
      state.notes = state.noteEdit
        ? (state.notes ?? []).map((n) => (n.id === saved.id ? saved : n))
        : [saved, ...others];
      state.noteEdit = null;
      $('note-body').value = '';
    });
  if (d.noteDelete)
    return act(async () => {
      const n = state.notes?.find((x) => x.id === d.noteDelete);
      if (!n || !confirm(t('notes.delete.confirm', { text: n.body.slice(0, 80) }))) return;
      await api('DELETE', `/api/notes/${n.id}`);
      state.notes = state.notes.filter((x) => x.id !== n.id);
      if (state.noteEdit === n.id) {
        state.noteEdit = null;
        $('note-body').value = '';
      }
    });
  if (d.noteTask) {
    const n = state.notes?.find((x) => x.id === d.noteTask);
    if (!n?.projectId) return;
    state.composer.note = n;
    state.noteOpen = null;
    return go({ name: 'project', id: n.projectId });
  }
  if (d.act === 'unnote') {
    state.composer.note = null;
    if ($('req')) $('req').value = '';
    return render();
  }
  if (d.goProject) return go({ name: 'project', id: d.goProject });
  if (d.goTask) return go({ name: 'task', id: d.goTask });
  if (d.act === 'start')
    return act(async () => {
      const task = state.view.name === 'task' ? state.detail : null;
      const p = task ? projectOf(task) : state.projects.find((x) => x.id === state.view.id);
      const request = $('req').value.trim();
      if (!request) throw new Error(t('err.request'));
      btn.disabled = true;
      // Task diretto aperto che aspetta il seguito: il messaggio lo continua.
      const follow = followUpOf(task);
      if (follow) {
        await answer(follow.id, { kind: 'ask', value: request });
        $('req').value = '';
        return;
      }
      // Task diretto chiuso: il nuovo riparte dalla sua conversazione.
      const from =
        task && !ACTIVE.includes(task.status) && task.workflow === DIRECT_WORKFLOW && task.session
          ? task.id
          : null;
      const run = await api('POST', '/api/runs', {
        request,
        mode: state.composer.mode,
        cwd: p.path,
        ...((state.composer.direct || from) && { direct: true }),
        ...(from && { from }),
        ...(Object.keys(state.composer.agent).length && { agent: state.composer.agent }),
      });
      $('req').value = '';
      state.composer.picking = false;
      state.runs = [run, ...state.runs];
      const note = state.composer.note;
      if (!task && note?.projectId === p.id) {
        state.composer.note = null;
        // Il task è partito: la nota gli si lega ed esce da quelle da lavorare.
        await api('PATCH', `/api/notes/${note.id}`, { runId: run.id })
          .then((saved) => {
            state.notes = (state.notes ?? []).map((n) => (n.id === saved.id ? saved : n));
          })
          .catch(() => {});
      }
      go({ name: 'task', id: run.id });
    });
  if (d.act === 'cancel')
    return act(async () => {
      if (!confirm(t('task.cancel.confirm'))) return;
      await api('POST', `/api/runs/${state.detail.id}/cancel`);
    });
  if (d.ask)
    return act(() => answer(d.ask, { kind: 'ask', value: d.null ? null : (d.value ?? null) }));
  if (d.askSend !== undefined)
    return act(async () => {
      const id = d.askSend;
      const text = $(`txt-${id}`).value.trim();
      const picked = [];
      for (let i = 0; i < Number(d.multi || 0); i++) {
        const el = $(`opt-${id}-${i}`);
        if (el?.checked) picked.push(el.value);
      }
      if (text) picked.push(text);
      const prompt = state.detail.prompts.find((p) => p.id === id)?.prompt;
      const value = picked.join(', ') || prompt?.default || null;
      if (value === null && prompt?.required) throw new Error(t('err.answer'));
      await answer(id, { kind: 'ask', value });
    });
  if (d.approve)
    return act(async () => {
      const note = $(`txt-${d.approve}`).value.trim();
      await answer(d.approve, { kind: 'approve', approved: !!d.ok, ...(note && { note }) });
    });
  if (d.review)
    return act(async () => {
      const feedback = $(`txt-${d.review}`).value.trim();
      if (!d.ok && !feedback) throw new Error(t('err.feedback'));
      await answer(d.review, { kind: 'review', ok: !!d.ok, ...(!d.ok && { feedback }) });
    });
}
$('main').addEventListener('click', onClick);
$('dock').addEventListener('click', onClick);

history.replaceState({ name: 'home' }, '');
render();
void connect();
