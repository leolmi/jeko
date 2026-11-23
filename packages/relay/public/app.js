// Pagina remota di Jeko: progetti, task e risposte, attraverso il relay (messaggi cifrati).
import { importKey, open, seal } from './seal.js';

const STORE = 'jeko-remote';
const ACTIVE = ['queued', 'running', 'waiting'];
const STATUS = {
  queued: 'In coda',
  running: 'Al lavoro',
  waiting: 'In attesa',
  done: 'Completato',
  failed: 'Fallito',
  rejected: 'Respinto',
  cancelled: 'Annullato',
};
const MODES = {
  headless: 'Senza domande',
  checkpoint: 'Con checkpoint',
  interactive: 'Interattiva',
};

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
const when = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
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
    try {
      localStorage.setItem(STORE, JSON.stringify(p));
    } catch {
      /* senza archivio: vale finché la pagina resta aperta */
    }
    history.replaceState(null, '', location.pathname);
    return p;
  }
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? 'null');
  } catch {
    return null;
  }
}

function forget() {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* niente */
  }
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
  error: '',
  ended: '',
};
const pending = new Map();
let reqSeq = 0;

// ---------- collegamento ----------

async function connect() {
  if (!state.pair) return render();
  if (!crypto?.subtle) {
    state.ended = 'Serve una pagina sicura (HTTPS) per la cifratura.';
    return render();
  }
  try {
    state.key ??= await importKey(state.pair.k);
  } catch {
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
    for (const [, p] of pending) p.reject(new Error('Collegamento perso'));
    pending.clear();
    if (e.code === 4403) {
      forget();
      state.ended = 'Questo dispositivo è stato scollegato da Jeko.';
      return render();
    }
    render();
    setTimeout(connect, 3000);
  };
}

async function send(body) {
  const ws = state.socket;
  if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Non collegato');
  ws.send(JSON.stringify({ m: await seal(state.key, 'c2h', state.pair.d, body) }));
}

function request(method, path, body) {
  const id = `r${++reqSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Nessuna risposta da Jeko'));
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
  if (res.status >= 400) throw new Error(res.body?.message ?? `Errore ${res.status}`);
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
    state.confirmed = body.confirmed;
    if (body.confirmed) {
      state.projects = body.projects;
      state.runs = body.runs;
      state.at = body.at;
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
  scrollTo(0, 0);
}

addEventListener('popstate', (e) => show(e.state ?? { name: 'home' }));

// ---------- viste ----------

const projectOf = (run) => state.projects.find((p) => folderKey(p.path) === folderKey(run.cwd));
const runsOf = (project) =>
  state.runs
    .filter((r) => folderKey(r.cwd) === folderKey(project.path))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

function pathDots(path) {
  return `<div class="path">${(path ?? []).map((m) => `<i class="${m}"></i>`).join('')}</div>`;
}

function runRow(r, withProject = false) {
  const project = withProject ? projectOf(r) : null;
  return `<button class="card row" data-go-task="${esc(r.id)}">
    <div class="grow">
      <div class="clip">${esc(r.request)}</div>
      <div class="muted clip">${project ? `${esc(project.name)} · ` : ''}${when(r.updatedAt)}</div>
      ${pathDots(r.path)}
    </div>
    <span class="badge ${r.status}">${STATUS[r.status] ?? r.status}</span>
  </button>`;
}

function viewHome() {
  const waiting = state.runs.filter((r) => r.status === 'waiting');
  const projects = [...state.projects].sort(
    (a, b) => (a.favorite ?? Infinity) - (b.favorite ?? Infinity) || a.name.localeCompare(b.name),
  );
  return `
    ${waiting.length ? `<h2>Da rispondere</h2>${waiting.map((r) => runRow(r, true)).join('')}` : ''}
    <h2>Progetti</h2>
    ${
      projects
        .map((p) => {
          const runs = runsOf(p);
          const w = runs.filter((r) => r.status === 'waiting').length;
          const a = runs.filter((r) => r.status === 'running' || r.status === 'queued').length;
          return `<button class="card row" data-go-project="${esc(p.id)}">
            <div class="grow"><div class="clip">${p.favorite !== undefined ? '★ ' : ''}${esc(p.name)}</div>
            <div class="muted clip">${esc(p.path)}</div></div>
            ${w ? `<span class="badge waiting">${w} in attesa</span>` : ''}
            ${a ? `<span class="badge running">${a} al lavoro</span>` : ''}
          </button>`;
        })
        .join('') || '<p class="empty">Nessun progetto.</p>'
    }`;
}

function viewProject(project) {
  const runs = runsOf(project);
  return `
    <div class="card">
      <textarea id="req" data-keep placeholder="Cosa deve fare claude?"></textarea>
      <select id="mode" data-keep aria-label="Modalità">
        ${Object.entries(MODES)
          .map(([k, v]) => `<option value="${k}">${v}</option>`)
          .join('')}
      </select>
      <label class="check"><input type="checkbox" id="direct" data-keep /> Richiesta libera (senza workflow)</label>
      <div class="actions"><button class="btn primary" data-act="start">Avvia task</button></div>
      ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
    </div>
    <h2>Task</h2>
    ${runs.map((r) => runRow(r)).join('') || '<p class="empty">Nessun task.</p>'}`;
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
      <input type="text" id="txt-${p.id}" data-keep placeholder="${q.default ? `Predefinito: ${esc(q.default)}` : 'Altro…'}" class="mt" />
      <div class="actions">
        <button class="btn primary" data-ask-send="${esc(p.id)}" data-multi="${q.multiSelect ? opts.length : ''}">Invia</button>
        ${q.required ? '' : `<button class="btn" data-ask="${esc(p.id)}" data-null="1">Salta</button>`}
      </div>`;
  } else if (q.kind === 'approve') {
    body = `
      <p>${esc(q.message)}</p>
      ${q.output ? `<pre>${esc(q.output)}</pre>` : ''}
      <input type="text" id="txt-${p.id}" data-keep placeholder="Nota (facoltativa)" class="mt" />
      <div class="actions">
        <button class="btn primary" data-approve="${esc(p.id)}" data-ok="1">Approva</button>
        <button class="btn danger" data-approve="${esc(p.id)}" data-ok="">Rifiuta</button>
      </div>`;
  } else {
    body = `
      <p>Revisione del risultato</p>
      <pre>${esc(q.output)}</pre>
      <textarea id="txt-${p.id}" data-keep placeholder="Cosa cambiare (per chiedere modifiche)" class="mt"></textarea>
      <div class="actions">
        <button class="btn primary" data-review="${esc(p.id)}" data-ok="1">Va bene</button>
        <button class="btn" data-review="${esc(p.id)}" data-ok="">Chiedi modifiche</button>
      </div>`;
  }
  return `<div class="card">${body}</div>`;
}

function feed(events) {
  const lines = [];
  for (const { event: e } of events) {
    if (e.type === 'step.started' && e.title) lines.push(`<p><b>${esc(e.title)}</b></p>`);
    else if (e.type === 'agent.activity' && e.kind === 'text') lines.push(`<p>${esc(e.text)}</p>`);
    else if (e.type === 'agent.activity')
      lines.push(`<p class="tool">${esc(e.tool ?? '')} ${esc(e.text)}</p>`);
    else if (e.type === 'step.finished' && !e.ok) lines.push(`<p class="error">Passo fallito</p>`);
    else if (e.type === 'run.finished')
      lines.push(
        `<p class="muted">Fine: ${esc(STATUS[e.status] ?? e.status)}${e.error ? ` — ${esc(e.error)}` : ''}</p>`,
      );
  }
  return lines.slice(-40).join('');
}

function viewTask() {
  const d = state.detail;
  if (!d)
    return state.error
      ? `<p class="error">${esc(state.error)}</p>`
      : '<p class="empty">Carico…</p>';
  const prompts = d.prompts.filter((p) => p.status === 'pending');
  return `
    <div class="card">
      <div class="row"><div class="grow">${esc(d.request)}</div>
      <span class="badge ${d.status}">${STATUS[d.status] ?? d.status}</span></div>
      <div class="muted">${esc(d.workflow)} · ${esc(MODES[d.mode] ?? d.mode)} · ${when(d.createdAt)}</div>
      ${pathDots(d.path)}
      ${d.error ? `<p class="error">${esc(d.error)}</p>` : ''}
      ${ACTIVE.includes(d.status) ? `<div class="actions"><button class="btn danger" data-act="cancel">Annulla task</button></div>` : ''}
    </div>
    ${state.error ? `<p class="error">${esc(state.error)}</p>` : ''}
    ${prompts.length ? `<h2>Da rispondere</h2>${prompts.map(promptCard).join('')}` : ''}
    <h2>Attività</h2>
    <div class="card feed">${feed(d.events) || '<p class="muted">Ancora niente.</p>'}</div>`;
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
  if (state.ended) html = `<p class="empty">${esc(state.ended)}</p>`;
  else if (!state.pair)
    html = `<p class="empty">Questo browser non è collegato a Jeko.<br/>Sul PC apri Opzioni → Accesso remoto → Collega un dispositivo e inquadra il QR.</p>`;
  else if (state.confirmed === false)
    html = `<p class="empty">In attesa di conferma.<br/>Sul PC, in Opzioni → Accesso remoto, conferma «${esc(deviceName())}».</p>`;
  else if (state.confirmed === null && !state.at) html = `<p class="empty">Collegamento…</p>`;
  else if (state.view.name === 'project') {
    const p = state.projects.find((x) => x.id === state.view.id);
    title = p?.name ?? 'Progetto';
    html = p ? viewProject(p) : '<p class="empty">Progetto non trovato.</p>';
  } else if (state.view.name === 'task') {
    title = state.detail ? (projectOf(state.detail)?.name ?? 'Task') : 'Task';
    html = viewTask();
  } else html = viewHome();

  $('title').textContent = title;
  $('back').hidden = state.view.name === 'home' || !state.at;
  status.className = `status ${state.host ? 'on' : state.pair ? 'off' : ''}`;
  status.textContent = !state.pair
    ? ''
    : state.host
      ? 'Jeko collegato'
      : state.relay
        ? `Jeko spento${state.at ? ` · dati delle ${when(state.at)}` : ''}`
        : 'Relay non raggiungibile';
  $('main').innerHTML = html;

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
  if (p) p.status = 'answered';
}

$('back').addEventListener('click', () => history.back());

$('main').addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
  if (d.goProject) return go({ name: 'project', id: d.goProject });
  if (d.goTask) return go({ name: 'task', id: d.goTask });
  if (d.act === 'start')
    return act(async () => {
      const p = state.projects.find((x) => x.id === state.view.id);
      const request = $('req').value.trim();
      if (!request) throw new Error('Scrivi la richiesta');
      t.disabled = true;
      const run = await api('POST', '/api/runs', {
        request,
        mode: $('mode').value,
        cwd: p.path,
        ...($('direct').checked && { direct: true }),
      });
      $('req').value = '';
      state.runs = [run, ...state.runs];
      go({ name: 'task', id: run.id });
    });
  if (d.act === 'cancel')
    return act(async () => {
      if (!confirm('Annullare il task?')) return;
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
      if (value === null && prompt?.required) throw new Error('Serve una risposta');
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
      if (!d.ok && !feedback) throw new Error('Scrivi cosa cambiare');
      await answer(d.review, { kind: 'review', ok: !!d.ok, ...(!d.ok && { feedback }) });
    });
});

history.replaceState({ name: 'home' }, '');
render();
void connect();
