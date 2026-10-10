(function () {
  'use strict';
  const STORAGE_KEY = 'entity-championship-state-v1';
  const CHANNEL_NAME = 'entity-championship-sync-v1';
  const TABLE = 'tournament_state';
  const ROW_ID = 'main';
  let channel = null;
  let supabaseClient = null;
  let isAdmin = true;
  let cloudStatus = 'Starting…';
  let writeQueue = Promise.resolve();
  let pendingWrites = 0;
  let latestRemoteTimestamp = 0;
  let remoteRevision = 0;
  try { if ('BroadcastChannel' in window) channel = new BroadcastChannel(CHANNEL_NAME); } catch (_) {}

  function emptyState() {
    return { version: 1, tournamentName: 'THE ENTITY CHAMPIONSHIP', teams: [], matches: [], activeMatchId: null, generated: false, updatedAt: new Date().toISOString() };
  }
  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.teams) || !Array.isArray(parsed.matches)) return emptyState();
      return { ...emptyState(), ...parsed };
    } catch (err) { console.error('Unable to read tournament state', err); return emptyState(); }
  }
  let cachedState = loadLocal();
  function announce() {
    window.dispatchEvent(new CustomEvent('entity-state-change'));
    try { if (channel) channel.postMessage({ type: 'changed', at: Date.now() }); } catch (_) {}
  }
  function setCache(state, persistLocal = true) {
    if (!state || !Array.isArray(state.teams) || !Array.isArray(state.matches)) return;
    cachedState = { ...emptyState(), ...state };
    if (persistLocal) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedState)); } catch (_) {}
    }
    announce();
  }
  function load() { return cachedState; }
  function showCloudMessage(message) {
    cloudStatus = message;
    const sync = document.getElementById('sync-detail');
    if (sync) sync.textContent = `SYNC · ${message.toUpperCase()}`;
  }
  function isCloudConfigured() {
    const c = window.ENTITY_SUPABASE_CONFIG || {};
    return Boolean(c.url && c.anonKey && window.supabase && typeof window.supabase.createClient === 'function');
  }
  async function fetchRemoteState() {
    if (!supabaseClient) return;
    const { data, error } = await supabaseClient.from(TABLE).select('state, updated_at, revision').eq('id', ROW_ID).maybeSingle();
    if (error) { showCloudMessage(`Read error: ${error.message}`, true); return; }
    if (data && data.state) {
      latestRemoteTimestamp = Date.parse(data.updated_at || data.state.updatedAt || '') || Date.now();
      remoteRevision = Number(data.revision) || 1;
      setCache(data.state);
    }
    showCloudMessage('Connected · controller access');
  }
  async function persistRemoteState(state) {
    if (!supabaseClient) return;
    pendingWrites++;
    const run = writeQueue.catch(() => {}).then(async () => {
      const expectedRevision = remoteRevision;
      const { data, error } = await supabaseClient.rpc('save_tournament_state', {
        p_state: state,
        p_expected_revision: expectedRevision
      });
      if (error) throw error;
      if (!data || data.ok !== true) {
        if (data && data.state) {
          remoteRevision = Number(data.revision) || remoteRevision;
          latestRemoteTimestamp = Date.parse(data.updated_at || data.state.updatedAt || '') || Date.now();
          setCache(data.state);
        }
        throw new Error('Another controller saved a newer version. The latest shared state has been loaded; review it and retry your change.');
      }
      remoteRevision = Number(data.revision) || (expectedRevision + 1);
      latestRemoteTimestamp = Date.parse(data.updated_at || '') || Date.now();
      showCloudMessage('Saved · live sync active');
    });
    writeQueue = run;
    try { await run; }
    catch (err) {
      showCloudMessage(`Save error: ${err.message || 'database write failed'}`, true);
      // If a concurrent save won, re-fetch the canonical state so this tab is not left stale.
      fetchRemoteState().catch(() => {});
      throw err;
    } finally { pendingWrites--; }
  }
  function save(state) {
    state.updatedAt = new Date().toISOString();
    setCache(state);
    if (supabaseClient) persistRemoteState(state).catch(err => console.error('Tournament cloud save failed:', err));
    return state;
  }
  function update(mutator) {
    const state = JSON.parse(JSON.stringify(load()));
    mutator(state);
    return save(state);
  }
  function subscribe(callback) {
    const onStorage = (event) => { if (!event.key || event.key === STORAGE_KEY) { cachedState = loadLocal(); callback(load()); } };
    const onLocal = () => callback(load());
    const onChannel = () => callback(load());
    window.addEventListener('storage', onStorage);
    window.addEventListener('entity-state-change', onLocal);
    if (channel) channel.addEventListener('message', onChannel);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('entity-state-change', onLocal);
      if (channel) channel.removeEventListener('message', onChannel);
    };
  }
  function randInt(max) {
    if (window.crypto && crypto.getRandomValues) {
      const limit = Math.floor(4294967296 / max) * max; const buf = new Uint32Array(1);
      do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
      return buf[0] % max;
    }
    return Math.floor(Math.random() * max);
  }
  function shuffle(items) {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function uid(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
  function teamName(state, id) { if (!id) return 'TBD'; const team = state.teams.find((item) => item.id === id); return team ? team.name : 'TBD'; }
  function roundName(index, total) { if (index === total - 1) return 'FINAL'; if (index === total - 2) return 'SEMIFINAL'; if (index === total - 3) return 'QUARTERFINAL'; return `ROUND ${index + 1}`; }
  function isResolved(match) { return match && (match.status === 'completed' || match.status === 'bye'); }
  function resetMatchResult(match) {
    match.scoreA = null; match.scoreB = null; match.winnerId = null; match.status = 'pending'; match.toss = null;
    match.mapVeto = null; match.killerDraft = null; match.setupComplete = false; match.scorecard = null; match.tiebreakWinnerId = null;
  }
  function buildBracket(names) {
    const clean = []; const seen = new Set();
    names.forEach((raw) => {
      const name = String(raw || '').trim();
      const key = name.toLocaleLowerCase();
      if (name && !seen.has(key)) { seen.add(key); clean.push({ id: uid('team'), name }); }
    });
    if (clean.length < 2) throw new Error('Enter at least two distinct team names.');

    const bracketSize = 2 ** Math.ceil(Math.log2(clean.length));
    const roundCount = Math.log2(bracketSize);
    const firstRoundMatchCount = bracketSize / 2;
    const playInCount = clean.length - firstRoundMatchCount; // teams beyond one-per-slot
    const base = uid('bracket');
    const matches = [];
    // Unbiased Fisher-Yates shuffle (the old sort(() => Math.random()-0.5) is biased).
    const order = shuffle(clean);

    // Randomly choose which first-round slots are full matches (play-ins).
    // Every other slot is a single-team BYE. All teams are always placed.
    const playInSlots = new Set(clean.length === bracketSize
      ? Array.from({ length: firstRoundMatchCount }, (_, i) => i)
      : shuffle(Array.from({ length: firstRoundMatchCount }, (_, i) => i)).slice(0, playInCount));
    const firstRoundSlots = Array.from({ length: firstRoundMatchCount }, () => ({ a: null, b: null }));
    let teamIndex = 0;
    for (let slot = 0; slot < firstRoundMatchCount; slot++) {
      firstRoundSlots[slot].a = order[teamIndex++].id;
      if (playInSlots.has(slot)) firstRoundSlots[slot].b = order[teamIndex++].id;
    }

    for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
      const count = bracketSize / (2 ** (roundIndex + 1));
      for (let slot = 0; slot < count; slot++) {
        const isFirstRound = roundIndex === 0;
        const first = isFirstRound ? firstRoundSlots[slot] : null;
        const match = {
          id: `${base}-r${roundIndex + 1}-m${slot + 1}`,
          roundIndex,
          roundName: roundIndex === 0 && clean.length !== bracketSize ? 'PRELIMINARY' : roundName(roundIndex, roundCount),
          matchNumber: slot + 1,
          teamAId: isFirstRound ? (first?.a || null) : null,
          teamBId: isFirstRound ? (first?.b || null) : null,
          sourceAId: roundIndex > 0 ? `${base}-r${roundIndex}-m${slot * 2 + 1}` : null,
          sourceBId: roundIndex > 0 ? `${base}-r${roundIndex}-m${slot * 2 + 2}` : null,
          parentMatchId: roundIndex < roundCount - 1 ? `${base}-r${roundIndex + 2}-m${Math.floor(slot / 2) + 1}` : null,
          parentSlot: roundIndex < roundCount - 1 ? (slot % 2 === 0 ? 'a' : 'b') : null,
          scoreA: null, scoreB: null, status: 'pending', winnerId: null, toss: null,
          mapVeto: null, killerDraft: null, setupComplete: false, scorecard: null, tiebreakWinnerId: null
        };
        if (isFirstRound && (!match.teamAId || !match.teamBId)) {
          match.status = 'bye';
          match.winnerId = match.teamAId || match.teamBId || null;
        }
        matches.push(match);
      }
    }

    const state = { ...emptyState(), teams: clean, matches, generated: true, activeMatchId: null };
    propagateAdvances(state);
    const firstPlayable = state.matches.find((m) => m.status === 'pending' && m.teamAId && m.teamBId);
    if (firstPlayable) state.activeMatchId = firstPlayable.id;
    return state;
  }
  function propagateAdvances(state) {
    const sorted = state.matches.slice().sort((a, b) => a.roundIndex - b.roundIndex || a.matchNumber - b.matchNumber);
    sorted.forEach((match) => {
      if (match.sourceAId || match.sourceBId) {
        const sourceA = state.matches.find((m) => m.id === match.sourceAId); const sourceB = state.matches.find((m) => m.id === match.sourceBId);
        if (sourceA && isResolved(sourceA)) match.teamAId = sourceA.winnerId || null;
        if (sourceB && isResolved(sourceB)) match.teamBId = sourceB.winnerId || null;
        if (match.status !== 'completed' && sourceA && sourceB && isResolved(sourceA) && isResolved(sourceB)) {
          if (!match.teamAId || !match.teamBId) { match.status = 'bye'; match.winnerId = match.teamAId || match.teamBId || null; }
          else if (match.status === 'bye') { match.status = 'pending'; match.winnerId = null; }
        }
      }
      if (isResolved(match) && match.parentMatchId) {
        const parent = state.matches.find((m) => m.id === match.parentMatchId); if (!parent) return;
        const slotKey = match.parentSlot === 'a' ? 'teamAId' : 'teamBId'; const old = parent[slotKey];
        if (old !== (match.winnerId || null)) { parent[slotKey] = match.winnerId || null; if (parent.status === 'completed' || parent.scoreA != null || parent.scoreB != null) invalidateMatchAndDescendants(state, parent.id); }
      }
    });
    return state;
  }
  function invalidateMatchAndDescendants(state, matchId) {
    const match = state.matches.find((m) => m.id === matchId); if (!match) return;
    resetMatchResult(match);
    state.matches.filter((m) => m.sourceAId === matchId || m.sourceBId === matchId).forEach((child) => invalidateMatchAndDescendants(state, child.id));
  }
  function setLive(state, matchId) {
    const match = state.matches.find((m) => m.id === matchId); if (!match || !match.teamAId || !match.teamBId || match.status === 'bye') return;
    state.matches.forEach((m) => { if (m.status === 'in_progress') m.status = 'pending'; });
    if (match.status !== 'completed') match.status = 'in_progress'; state.activeMatchId = matchId;
  }
  function savePoints(state, matchId, scoreA, scoreB, complete, tieWinnerId) {
    const match = state.matches.find((m) => m.id === matchId); if (!match || !match.teamAId || !match.teamBId) throw new Error('Choose a match with two teams first.');
    const a = Number(scoreA), b = Number(scoreB);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isInteger(a * 2) || !Number.isInteger(b * 2) || a < 0 || b < 0) throw new Error('Scores must be non-negative and may use half points.');
    const oldWinner = match.winnerId; const hadResult = match.status === 'completed';
    state.matches.forEach((other) => { if (other.id !== match.id && other.status === 'in_progress') other.status = 'pending'; });
    let winnerId = null;
    if (complete) { if (a > b) winnerId = match.teamAId; else if (b > a) winnerId = match.teamBId; else if (tieWinnerId === match.teamAId || tieWinnerId === match.teamBId) winnerId = tieWinnerId; else throw new Error('The score is tied. Choose the tiebreak winner before completing this match.'); }
    match.scoreA = a; match.scoreB = b; match.status = complete ? 'completed' : 'in_progress'; match.winnerId = winnerId; state.activeMatchId = match.id;
    if (hadResult && oldWinner !== winnerId && match.parentMatchId) { const parent = state.matches.find((m) => m.id === match.parentMatchId); if (parent) invalidateMatchAndDescendants(state, parent.id); }
    propagateAdvances(state); return match;
  }
  function addToss(state, matchId, toss) {
    const match = state.matches.find((m) => m.id === matchId); if (!match || !match.teamAId || !match.teamBId) throw new Error('Choose a match with two teams first.');
    match.toss = { ...toss, savedAt: new Date().toISOString() }; state.activeMatchId = matchId; return match;
  }
  function activeMatch(state) {
    return state.matches.find((m) => m.id === state.activeMatchId) || state.matches.find((m) => m.status === 'in_progress' && m.teamAId && m.teamBId) || state.matches.find((m) => m.status === 'pending' && m.teamAId && m.teamBId) || state.matches.slice().reverse().find((m) => m.status === 'completed') || null;
  }
  function applyRemoteRow(row) {
    if (!row || !row.state) return;
    const ts = Date.parse(row.updated_at || row.state.updatedAt || '') || Date.now();
    const revision = Number(row.revision) || remoteRevision;
    if (pendingWrites > 0) return; // our own queued save will overwrite; don't clobber newer local edits with an echo
    if (revision < remoteRevision || ts < latestRemoteTimestamp) return;
    latestRemoteTimestamp = ts;
    remoteRevision = revision;
    setCache(row.state);
    if (isAdmin) showCloudMessage('Connected · controller access');
  }
  function initCloud() {
    mountAuthWidget();
    if (!isCloudConfigured()) { showCloudMessage('Supabase not configured · local mode'); return; }
    const config = window.ENTITY_SUPABASE_CONFIG;
    supabaseClient = window.supabase.createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    showCloudMessage('Connecting to Supabase…');
    fetchRemoteState().catch(err => showCloudMessage(`Connection error: ${err.message}`, true));
    supabaseClient.channel('entity-tournament-state')
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `id=eq.${ROW_ID}` }, payload => {
        if (payload.eventType === 'DELETE') return;
        applyRemoteRow(payload.new);
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') showCloudMessage('Connected · live updates active'); });
  }
  window.Entity = {
    STORAGE_KEY, load, save, update, subscribe, uid, teamName, roundName,
    buildBracket, shuffle, flush: () => writeQueue.catch(() => {}), propagateAdvances, setLive, savePoints, addToss, activeMatch,
    cloud: { configured: isCloudConfigured, get client() { return supabaseClient; }, get isAdmin() { return isAdmin; }, get status() { return cloudStatus; } }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCloud, { once: true }); else initCloud();
})();
