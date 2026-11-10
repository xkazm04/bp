'use client';
// /headsets: pair a VR headset with this PC by typing the code the headset shows, see and revoke paired headsets, and read
// what the table did (the companion's grants, then the decision log, filterable by where the decision was made). All server
// calls go through ./api (the fixture under ?fixture=...). The page never receives a pairing code: it lists who is asking
// and the owner types the code from the headset's screen (docs/concepts/vr-light-table/table-link-v2.md section 13).
// While the server cannot be reached it says so with the one command that fixes it, and shows nothing else.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { headsetsApi, Unreachable, type Decision, type DecisionPage, type Grant, type HeadsetState, type HeadsetsApi, type PendingView, type Scope } from './api';
import s from './headsets.module.css';

const POLL_MS = 2000, SLOW_POLL_MS = 10_000;
/** Each permission in one line, for the owner deciding what to tick. */
const SCOPE_WORDS: Record<Scope, { name: string; line: string }> = {
  read: { name: 'See', line: 'the plan, scans and findings of your projects' },
  standup: { name: 'Stand-up', line: 'hold the morning stand-up and talk to the companion (includes See)' },
  place: { name: 'Hand over', line: 'take a place from this page into the headset and hand it back' },
  focus: { name: 'Focus', line: 'follow and set the shared focus with this page' },
  decide: { name: 'Decide as you', line: 'approve or decline findings and cards, and give the companion time-limited permission' },
  scan: { name: 'Scan', line: 'start and cancel scans of your projects' },
  onboard: { name: 'Onboard', line: 'this headset may start reading a new project from the folders this PC offers: a paid agent run' },
};
const DEFAULT_ON: Scope[] = ['read', 'standup', 'place', 'focus'];
const DAY_CHOICES = [1, 7, 14, 30];
const KIND_WORDS: Record<Decision['kind'], string> = { morning: 'Stand-up verdict', card: 'Card answer', 'policy-grant': 'Permission given', 'policy-revoke': 'Permission taken back', onboard: 'Project read', 'onboard-ask': 'Asked to read a project' };
const VERDICT_WORDS: Record<string, string> = { ask: 'asked, waiting for the PC', confirm: 'confirmed at the PC', decline: 'declined', start: 'started' };

const secs = (iso: string, now: number) => Math.round((Date.parse(iso) - now) / 1000);
function ago(iso: string, now: number): string {
  const s = Math.max(0, -secs(iso, now));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
const clock = (n: number) => `${Math.floor(Math.max(0, n) / 60)}:${String(Math.max(0, n) % 60).padStart(2, '0')}`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fromWhere = (peer: string) => (peer === 'loopback' ? 'over the USB cable' : `over Wi-Fi from ${peer}`);
const deviceName = (id?: string) => (id ? id.split(':')[0] : '');

type Load<T> = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ok'; v: T };

export function HeadsetsPage() {
  const [api, setApi] = useState<HeadsetsApi | null>(null);
  const [st, setSt] = useState<HeadsetState | null>(null);
  const [down, setDown] = useState<Unreachable['kind'] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [grants, setGrants] = useState<Load<Grant[]>>({ state: 'loading' });
  const [log, setLog] = useState<Load<DecisionPage>>({ state: 'loading' });
  const [surface, setSurface] = useState<'vr' | 'web' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [back, setBack] = useState('/');

  useEffect(() => {
    setApi(headsetsApi());
    const q = new URLSearchParams(location.search), product = q.get('product');
    setBack('/' + (product ? '?product=' + encodeURIComponent(product) : ''));
    const f = q.get('surface');
    if (f === 'vr' || f === 'web') setSurface(f);
  }, []);

  const readState = useCallback(async (a: HeadsetsApi) => {
    try { setSt(await a.state()); setDown(null); return true; } catch (e) {
      if (e instanceof Unreachable) { setDown(e.kind); return false; }
      setErr((e as Error).message); return false;
    }
  }, []);
  const readGrants = useCallback(async (a: HeadsetsApi) => {
    try { setGrants({ state: 'ok', v: await a.grants() }); } catch (e) { if (e instanceof Unreachable) setDown(e.kind); else setGrants({ state: 'error', error: (e as Error).message }); }
  }, []);
  const readLog = useCallback(async (a: HeadsetsApi, f: 'vr' | 'web' | null) => {
    try { setLog({ state: 'ok', v: await a.decisions(f) }); } catch (e) { if (e instanceof Unreachable) setDown(e.kind); else setLog({ state: 'error', error: (e as Error).message }); }
  }, []);

  useEffect(() => {
    if (!api) return;
    void readState(api).then((ok) => { if (ok) void readGrants(api); });
  }, [api, readState, readGrants]);
  useEffect(() => { if (api && !down) void readLog(api, surface); }, [api, surface, down, readLog]);

  // the door's state every 2 s while something is in motion (a window, a request), else every 10 s; the clock every second
  const busy = !!st && (!!st.window || st.pending.length > 0 || st.onboards.some((o) => o.status === 'queued' || o.status === 'running') || st.asks.length > 0);
  useEffect(() => {
    if (!api) return;
    const t = setInterval(() => { void readState(api); }, busy ? POLL_MS : SLOW_POLL_MS);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [api, busy, readState]);
  useEffect(() => {
    if (!api || down) return;
    const t = setInterval(() => { void readGrants(api); void readLog(api, surface); }, SLOW_POLL_MS);
    return () => clearInterval(t);
  }, [api, down, surface, readGrants, readLog]);

  const act = async (f: () => Promise<unknown>, after?: () => void) => {
    if (!api) return;
    setErr(null);
    try { await f(); after?.(); } catch (e) { if (e instanceof Unreachable) setDown(e.kind); else setErr((e as Error).message); }
    await readState(api);
  };

  if (!api) return <main className={s.main} aria-busy="true" />;
  return (
    <main className={s.main}>
      <header className={s.head}>
        <div>
          <div className={s.kicker}><a href={back}>‹ Blueprint</a>{api.fixture ? ' · sample data (fixture)' : ''}</div>
          <h1 className={s.h1}>Headsets</h1>
          <p className={s.lead}>Pair a VR headset with this PC, see what each one may do, and read what was decided at the table.</p>
        </div>
        <div className={s.headActs}><ThemeToggle /></div>
      </header>

      {down ? <CannotReach kind={down} onRetry={() => { setDown(null); void readState(api).then((ok) => { if (ok) { void readGrants(api); void readLog(api, surface); } }); }} />
        : !st ? <p className={s.note} role="status">Reading the server…</p>
        : (
          <>
            {err && <p className={s.err} role="alert">{err}</p>}
            <Pair st={st} now={now} act={act} api={api} />
            <Paired st={st} now={now} onRevoke={(id) => act(() => api.revoke(id))} />
            <TableDid st={st} onConfirm={(id) => act(() => api.confirmAsk(id), () => { void readLog(api, surface); })}
              onDecline={(id) => act(() => api.declineAsk(id), () => { void readLog(api, surface); })} onStop={(slug, job) => act(() => api.stop(slug, job), () => { void readLog(api, surface); })}
              grants={grants} log={log} surface={surface} now={now}
              onSurface={(f) => { setSurface(f); setLog({ state: 'loading' }); }}
              onRevokeGrant={(id) => act(() => api.revokeGrant(id), () => { void readGrants(api); void readLog(api, surface); })} />
          </>
        )}
    </main>
  );
}

// ------------------------------------------------------------------------------------------------ cannot reach
function CannotReach({ kind, onRetry }: { kind: 'noserver' | 'nowire'; onRetry: () => void }) {
  return (
    <section className={s.down} role="alert" aria-labelledby="hs-down">
      <h2 id="hs-down" className={s.h2}>{kind === 'noserver' ? 'bp’s server is not answering' : 'This page is not connected to bp’s server'}</h2>
      {kind === 'noserver' ? (
        <>
          <p>Headsets pair with the bp server on this PC, and it is not running. Start it from the repo root:</p>
          <pre className={s.cmd}>npm run server</pre>
        </>
      ) : (
        <>
          <p>The web app is running on its own, so it cannot see the headsets. Restart it pointed at bp’s server (with the server running):</p>
          <pre className={s.cmd}>BP_COMPANION_URL=http://127.0.0.1:3100 npm run dev</pre>
        </>
      )}
      <p><button type="button" className={s.bt} onClick={onRetry}>Try again</button></p>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ pair a headset
function Pair({ st, now, act, api }: { st: HeadsetState; now: number; act: (f: () => Promise<unknown>, after?: () => void) => Promise<void>; api: HeadsetsApi }) {
  const [code, setCode] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(DEFAULT_ON);
  const [days, setDays] = useState(st.days.default);
  const [sending, setSending] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const waiting = st.pending.filter((p) => p.state === 'pending');
  const wifiAsk = waiting.some((p) => p.peer !== 'loopback');
  const windowLeft = st.window ? secs(st.window, now) : 0;
  const ready = code.length === 6 && scopes.length > 0 && !sending;

  const approve = async () => {
    if (!ready) return;
    setSending(true); setSaid(null);
    try {
      const r = await api.approve(code, scopes, days);
      setSaid({ ok: true, text: `Approved ${r.device} ${fromWhere(r.peer)}: it collects its key within 2 minutes, then it appears under Paired.` });
      setCode('');
    } catch (e) {
      if (e instanceof Unreachable) await act(() => Promise.reject(e));
      else { setSaid({ ok: false, text: (e as Error).message }); field.current?.select(); }
    } finally { setSending(false); }
    await act(() => Promise.resolve());
  };
  const toggle = (sc: Scope) => setScopes((x) => (x.includes(sc) ? x.filter((y) => y !== sc) : [...x, sc]));

  return (
    <section className={s.part} aria-labelledby="hs-pair">
      <h2 id="hs-pair" className={s.sec}>Pair a headset</h2>
      <DoorLine st={st} act={act} api={api} />

      {st.door !== 'off' && (
        <div className={s.windowRow}>
          {st.window
            ? <p className={s.state} role="status"><b>Pairing is open for {clock(windowLeft)}.</b> In the headset: MENU, then PC LINK, then PAIR.</p>
            : <p className={s.state}>Pairing is closed: a headset that asks now is refused.</p>}
          <button type="button" className={`${s.bt} ${st.window ? '' : s.go}`} onClick={() => act(() => api.open())}>{st.window ? 'Open for 2 more minutes' : 'Open pairing for 2 minutes'}</button>
        </div>
      )}

      {st.pending.length > 0 && (
        <ul className={s.list} aria-label="Headsets asking to pair">
          {st.pending.map((p) => <Asking key={p.id} p={p} now={now} onDeny={() => act(() => api.deny(p.id))} />)}
        </ul>
      )}

      {waiting.length > 0 && (
        <form className={s.panel} onSubmit={(e) => { e.preventDefault(); void approve(); }}>
          <label className={s.codeField}>
            <span>Type the 6 characters shown in the headset</span>
            <input ref={field} value={code} maxLength={6} autoComplete="off" spellCheck={false} inputMode="text" aria-invalid={said && !said.ok ? true : undefined}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder="······" />
          </label>
          <fieldset className={s.scopes}>
            <legend>What it may do</legend>
            {st.scopes.map((sc) => {
              const named = st.namedOnly.includes(sc), asked = waiting.some((p) => p.requested.includes(sc));
              return (
                <label key={sc} className={`${s.check} ${named ? s.named : ''}`}>
                  <input type="checkbox" checked={scopes.includes(sc)} onChange={() => toggle(sc)} />
                  <span><b>{SCOPE_WORDS[sc].name}</b>: {SCOPE_WORDS[sc].line}.{asked ? <em className={s.asked}> It asked for this.</em> : null}
                    {named ? <small>Off until you tick it: a headset never gets this by asking.</small> : null}</span>
                </label>
              );
            })}
          </fieldset>
          <label className={s.days}>
            <span>The pairing lasts</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {DAY_CHOICES.filter((d) => d <= st.days.max).map((d) => <option key={d} value={d}>{d === 1 ? '1 day' : `${d} days`}</option>)}
            </select>
          </label>
          {wifiAsk && <p className={s.warn}>This request came over Wi-Fi. The headset’s key will travel unencrypted on your home network: anyone on it could copy it until you revoke it.</p>}
          <div className={s.acts}>
            <button type="submit" className={`${s.bt} ${s.go} ${s.big}`} disabled={!ready}>{sending ? 'Approving…' : 'Approve'}</button>
            {st.wrongCodes.count > 0 && <span className={s.note}>{st.wrongCodes.count} wrong of {st.wrongCodes.limit} so far</span>}
          </div>
          {said && <p className={said.ok ? s.ok : s.err} role={said.ok ? 'status' : 'alert'}>{said.text}</p>}
        </form>
      )}
      {said && waiting.length === 0 && <p className={said.ok ? s.ok : s.err} role="status">{said.text}</p>}
    </section>
  );
}

function DoorLine({ st, act, api }: { st: HeadsetState; act: (f: () => Promise<unknown>) => Promise<void>; api: HeadsetsApi }) {
  const at = st.wifiAt;
  const wifiWords = at?.address
    ? `Opens port ${at.port} on ${at.address} to devices on your home network. Only a headset you paired gets past it, and its key travels unencrypted on your Wi-Fi.`
    : 'This PC has no home-network address, so Wi-Fi cannot be switched on from here.';
  const wifiButton = (
    <div className={s.choice}>
      <button type="button" className={s.bt} disabled={!at?.address} onClick={() => act(() => api.door('lan'))}>Turn Wi-Fi on</button>
      <span>{wifiWords}</span>
    </div>
  );
  const untilRestart = <p className={s.note}>Switched on here, it lasts until the server stops: a restart goes back to how the server was started.</p>;
  if (st.door === 'off') return (
    <div className={s.door}>
      <p className={s.state}><b>Pairing is off on this server.</b> Paired headsets still work over the cable; new ones cannot pair.</p>
      <div className={s.choice}>
        <button type="button" className={`${s.bt} ${s.go}`} onClick={() => act(() => api.door('pair'))}>Pair over the cable</button>
        <span>For a headset on the USB cable. Nothing new listens on your network.</span>
      </div>
      {wifiButton}
      {untilRestart}
    </div>
  );
  if (st.door === 'pair') return (
    <div className={s.door}>
      <p className={s.state}><b>Pairing over the cable is on.</b> Wi-Fi is off: the headset reaches this PC only through the USB cable.</p>
      {wifiButton}
      {st.started !== 'pair' && untilRestart}
    </div>
  );
  return (
    <div className={s.door}>
      <p className={s.state}><b>Wi-Fi is on</b> at {st.wifi?.address}:{st.wifi?.port}{st.wifi?.listening ? ', listening for paired headsets.' : ': closed until pairing opens or a headset is paired.'} Pairing over the cable works too.</p>
      {st.started !== 'lan' && untilRestart}
    </div>
  );
}

function Asking({ p, now, onDeny }: { p: PendingView; now: number; onDeny: () => void }) {
  const left = secs(p.until, now);
  return (
    <li className={`${s.row} ${p.state === 'approved' ? s.rowOk : s.rowAsk}`}>
      <div className={s.rowMain}>
        <span className={s.name}>{p.device}</span>
        <span className={s.meta}>asks {fromWhere(p.peer)}, {ago(p.at, now)} · the name is what the headset says it is</span>
        <span className={s.chips}>{(p.state === 'approved' ? p.granted ?? p.requested : p.requested).map((sc) => <span key={sc} className={s.chip}>{SCOPE_WORDS[sc]?.name ?? sc}</span>)}</span>
        <span className={s.meta}>{p.state === 'approved' ? `Approved: waiting for it to collect its key (${clock(left)} left).` : `Its code is on its screen for ${clock(left)}.`}</span>
      </div>
      <button type="button" className={s.bt} onClick={onDeny}>Decline</button>
    </li>
  );
}

// ------------------------------------------------------------------------------------------------ paired
function Paired({ st, now, onRevoke }: { st: HeadsetState; now: number; onRevoke: (id: string) => void }) {
  const live = st.paired.filter((p) => !p.expired).length;
  return (
    <section className={s.part} aria-labelledby="hs-paired">
      <h2 id="hs-paired" className={s.sec}><span>Paired</span><span>{live} of {st.limits.paired} in use</span></h2>
      {st.paired.length === 0 ? <p className={s.empty}>No headset is paired with this PC.</p> : (
        <ul className={s.list}>
          {st.paired.map((p) => (
            <li key={p.id} className={`${s.row} ${p.expired ? s.rowOff : ''}`}>
              <div className={s.rowMain}>
                <span className={s.name}>{p.name} <span className={s.id}>{p.id}</span></span>
                <span className={s.chips}>{p.scopes.map((sc) => <span key={sc} className={`${s.chip} ${st.namedOnly.includes(sc) ? s.chipStrong : ''}`}>{SCOPE_WORDS[sc]?.name ?? sc}</span>)}</span>
                <span className={s.meta}>
                  Paired {when(p.createdAt)} · {p.expired ? <b>expired {when(p.expiresAt)}</b> : <>until {when(p.expiresAt)}</>} · {p.lastSeen ? `last seen ${ago(p.lastSeen, now)}` : 'not seen since the server started'}
                </span>
              </div>
              <button type="button" className={`${s.bt} ${p.expired ? '' : s.danger}`} onClick={() => onRevoke(p.id)}>{p.expired ? 'Remove' : 'Revoke'}</button>
            </li>
          ))}
        </ul>
      )}
      <p className={s.note}>Revoking ends the pairing here at once; the headset learns it on its next request and must pair again.</p>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ what the table did
function TableDid({ st, onConfirm, onDecline, onStop, grants, log, surface, now, onSurface, onRevokeGrant }: {
  st: HeadsetState; onConfirm: (id: string) => void; onDecline: (id: string) => void; onStop: (slug: string, job: string) => void;
  grants: Load<Grant[]>; log: Load<DecisionPage>; surface: 'vr' | 'web' | null; now: number;
  onSurface: (f: 'vr' | 'web' | null) => void; onRevokeGrant: (id: string) => void;
}) {
  const running = (x: string) => x === 'queued' || x === 'running';
  return (
    <section className={s.part} aria-labelledby="hs-did">
      <h2 id="hs-did" className={s.sec}>What the table did</h2>
      {st.asks.length > 0 && (
        <ul className={s.list} aria-label="Waiting for you">
          {st.asks.map((a) => (
            <li key={a.id} className={`${s.row} ${s.ask}`} role="alert">
              <div className={s.rowMain}>
                <span className={s.name}>{deviceName(a.device) || 'A headset'} asks to read {a.name}: {a.hint}.</span>
                <span className={s.meta}>Reading it starts an agent on that folder and spends from your account. Asked {ago(a.askedAt, now)}; the ask lapses in {clock(secs(a.expiresAt, now))}.</span>
                <Shown text={a.shown} />
              </div>
              <span className={s.askActs}>
                <button type="button" className={`${s.bt} ${s.go}`} onClick={() => onConfirm(a.id)}>Confirm</button>
                <button type="button" className={s.bt} onClick={() => onDecline(a.id)}>Decline</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <h3 className={s.h3}>Projects started from the table</h3>
      {st.onboards.length === 0 ? <p className={s.empty}>No headset has started reading a project. A headset with Onboard may start {st.onboardBounds.perDay} a day, {st.onboardBounds.inFlight} at a time.</p> : (
        <ul className={s.list}>
          {st.onboards.map((o) => (
            <li key={o.job} className={`${s.row} ${running(o.status) ? '' : s.rowOff}`}>
              <div className={s.rowMain}>
                <span className={s.name}>{o.name} <span className={s.id}>{o.slug}</span></span>
                <span className={s.meta}>
                  {running(o.status) ? <b>Being read now (a paid agent run)</b> : `Read ${o.status}`} · started {ago(o.at, now)} at the table by {deviceName(o.device) || 'a headset'} · <span className={s.id}>{o.job}</span>
                </span>
                {o.shown && <Shown text={o.shown} />}
              </div>
              {running(o.status) && <button type="button" className={`${s.bt} ${s.danger}`} onClick={() => onStop(o.slug, o.job)}>Stop</button>}
            </li>
          ))}
        </ul>
      )}
      <h3 className={s.h3}>Permissions given to the companion</h3>
      {grants.state === 'loading' && <p className={s.note} role="status">Reading the permissions…</p>}
      {grants.state === 'error' && <p className={s.err}>{grants.error}</p>}
      {grants.state === 'ok' && (grants.v.length === 0 ? <p className={s.empty}>The companion holds no permission: every action it proposes waits for you.</p> : (
        <ul className={s.list}>
          {grants.v.map((g) => {
            const live = Date.parse(g.expiresAt) > now;
            return (
              <li key={g.id} className={`${s.row} ${live ? '' : s.rowOff}`}>
                <div className={s.rowMain}>
                  <span className={s.name}>{g.product === '*' ? 'Every project' : g.product}</span>
                  <span className={s.chips}>{g.tools.map((t) => <span key={t} className={s.chip}>{t}</span>)}{g.minTier !== undefined && <span className={s.chip}>tier {g.minTier} and milder</span>}</span>
                  <span className={s.meta}>
                    {live ? `Until ${when(g.expiresAt)}` : <b>Expired {when(g.expiresAt)}</b>} · given {g.grantedBy?.surface === 'vr' ? `at the table by ${deviceName(g.grantedBy.device) || 'a headset'}` : g.grantedBy ? 'on this page' : 'by someone unrecorded'} {when(g.createdAt)}
                  </span>
                  {g.grantedBy?.shown && <Shown text={g.grantedBy.shown} />}
                </div>
                {live && <button type="button" className={`${s.bt} ${s.danger}`} onClick={() => onRevokeGrant(g.id)}>Revoke</button>}
              </li>
            );
          })}
        </ul>
      ))}

      <div className={s.logHead}>
        <h3 className={s.h3}>Decisions</h3>
        <div className={s.seg} role="group" aria-label="Where the decision was made">
          {([[null, 'All'], ['vr', 'At the table'], ['web', 'On this PC']] as const).map(([f, label]) => (
            <button key={label} type="button" aria-pressed={surface === f} className={surface === f ? s.segOn : ''} onClick={() => onSurface(f)}>{label}</button>
          ))}
        </div>
      </div>
      {log.state === 'loading' && <p className={s.note} role="status">Reading the decision log…</p>}
      {log.state === 'error' && <p className={s.err}>{log.error}</p>}
      {log.state === 'ok' && <Log page={log.v} />}
    </section>
  );
}

function Log({ page }: { page: DecisionPage }) {
  const where = page.filter.surface === 'vr' ? ' made at the table' : page.filter.surface === 'web' ? ' made on this PC' : '';
  const count = !page.recorded ? 'Nothing has been decided yet: the log is empty.'
    : page.matched === 0 ? `No decision${where}, out of ${page.total} recorded.`
    : page.rows.length < page.matched ? `The newest ${page.rows.length} of ${page.matched} decisions${where}.`
    : `All ${page.matched} decision${page.matched === 1 ? '' : 's'}${where}.`;
  return (
    <>
      <p className={s.note} role="status">{count}{page.unreadable ? ` ${page.unreadable} line${page.unreadable === 1 ? '' : 's'} of the log could not be read.` : ''}</p>
      {page.rows.length > 0 && (
        <ol className={s.log}>
          {page.rows.map((r, i) => (
            <li key={r.at + r.target + i} className={s.entry}>
              <div className={s.entryTop}>
                <span className={s.at}>{when(r.at)}</span>
                <span className={s.kind}>{KIND_WORDS[r.kind] ?? r.kind}</span>
                <span className={s.verdict}>{(r.kind === 'onboard' || r.kind === 'onboard-ask') && VERDICT_WORDS[r.verdict] ? VERDICT_WORDS[r.verdict] : r.verdict}</span>
              </div>
              <div className={s.meta}>
                {r.product ? (r.product === '*' ? 'every project' : r.product) : 'no project'} · {r.surface === 'vr' ? `at the table, ${r.device ?? 'device not recorded'}` : r.device ? `on this PC, on ${deviceName(r.device)}'s ask` : 'on this PC'} · <span className={s.id}>{r.target}</span>
              </div>
              {/* a revoke carries no words (it only narrows, table-link-v2.md 3.5); every other decision from the table must */}
              {r.reason && <p className={s.meta}>{r.reason}</p>}
              {r.shown ? <Shown text={r.shown} /> : r.surface === 'vr' && r.kind !== 'policy-revoke' ? <p className={s.meta}>The words shown were not recorded.</p> : null}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function Shown({ text }: { text: string }) {
  return (
    <details className={s.shown}>
      <summary>The words shown</summary>
      <p>{text}</p>
    </details>
  );
}
