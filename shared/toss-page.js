(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const query = new URLSearchParams(window.location.search);
  let selectedId = query.get('match') || null;
  let mapPool = [];
  let killerPool = [];
  let pendingKiller = null;
  let flipping = false;
  let redirectTimer = null;
  let poolError = '';

  const shuffle = (items) => {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const sample = (items, count) => shuffle([...new Set(items.map((v) => String(v).trim()).filter(Boolean))]).slice(0, count);
  const otherTeam = (match, teamId) => teamId === match.teamAId ? match.teamBId : match.teamAId;
  const findMatch = (state, id) => state.matches.find((match) => match.id === id) || null;
  const playable = (state) => state.matches.filter((match) => match.teamAId && match.teamBId && match.status !== 'bye');
  const remainingMaps = (veto) => veto.pool.filter((name) => !veto.bans.some((ban) => ban.map === name));
  const names = (state, match) => ({ a: Entity.teamName(state, match.teamAId), b: Entity.teamName(state, match.teamBId) });

  async function readPool(path) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load ${path} (${response.status}).`);
    const values = await response.json();
    if (!Array.isArray(values)) throw new Error(`${path} must contain a JSON array of names.`);
    return values.map((value) => typeof value === 'string' ? value : (value && (value.name || value.title))).filter((value) => typeof value === 'string' && value.trim());
  }

  async function loadPools() {
    try {
      const [maps, killers] = await Promise.all([readPool('../data/maps.json'), readPool('../data/killers.json')]);
      mapPool = [...new Set(maps)];
      killerPool = [...new Set(killers)];
      if (mapPool.length < 5) throw new Error(`data/maps.json must contain at least 5 unique map names; found ${mapPool.length}.`);
      if (killerPool.length < 5) throw new Error(`data/killers.json must contain at least 5 unique Killer names; found ${killerPool.length}.`);
    } catch (error) {
      poolError = error.message || 'Unable to load map and Killer pools.';
    }
  }

  function teamOrder(match) {
    const first = match.toss && match.toss.winnerId;
    return first === match.teamAId || first === match.teamBId ? [first, otherTeam(match, first)] : [match.teamAId, match.teamBId];
  }

  function stageFor(match) {
    if (match.setupComplete && match.toss && match.mapVeto && match.killerDraft && match.killerDraft.complete) return 'done';
    if (!match.toss) return 'toss';
    if (!match.mapVeto || !match.mapVeto.finalMap || !match.killerDraft) return 'maps';
    if (!match.killerDraft.complete) return 'killers';
    return 'done';
  }

  function setActiveMarker(stage) {
    const order = { toss: 0, maps: 1, killers: 2, done: 3 };
    document.querySelectorAll('[data-step-marker]').forEach((element) => {
      const key = element.dataset.stepMarker;
      element.classList.toggle('active', key === stage);
      element.classList.toggle('finished', order[key] < order[stage]);
    });
  }

  function currentMatchAndState() {
    const state = Entity.load();
    const matches = playable(state);
    let match = findMatch(state, selectedId);
    if (!match || !match.teamAId || !match.teamBId || match.status === 'bye') {
      match = matches.find((item) => item.id === state.activeMatchId) || matches.find((item) => item.status === 'in_progress') || matches.find((item) => item.status === 'pending') || matches[0] || null;
      selectedId = match ? match.id : null;
    }
    return { state, matches, match };
  }

  function render() {
    const { state, matches, match } = currentMatchAndState();
    const select = $('match-select');
    select.innerHTML = matches.length
      ? matches.map((item) => `<option value="${esc(item.id)}">${esc(item.roundName)} · M${item.matchNumber} — ${esc(Entity.teamName(state, item.teamAId))} vs ${esc(Entity.teamName(state, item.teamBId))}</option>`).join('')
      : '<option value="">No playable matches yet</option>';
    if (selectedId) select.value = selectedId;
    select.disabled = flipping;

    if (!match) {
      $('match-summary').innerHTML = '<strong>No playable match.</strong><br>Open Bracket Control, enter the team names and generate the bracket first.';
      $('toss-status').textContent = 'Awaiting bracket'; $('toss-status').className = 'status pending';
      setActiveMarker('toss');
      $('wizard').innerHTML = `<section class="panel ceremony-empty"><div class="eyebrow">No match selected</div><h3>THE BRACKET IS EMPTY</h3><p>Create a bracket before launching a toss, map veto or Killer draft.</p><a class="button primary" href="./bracket.html">Open bracket control →</a></section>`;
      return;
    }

    const team = names(state, match);
    $('match-summary').innerHTML = `<strong>${esc(match.roundName)} · Match ${match.matchNumber}</strong><br><span class="muted">${esc(team.a)} vs ${esc(team.b)}</span><br><span class="muted">Status:</span> ${esc(match.status.replace('_', ' '))}`;
    const stage = stageFor(match);
    if (poolError && stage !== 'done') {
      $('toss-status').textContent = 'Pool configuration needed'; $('toss-status').className = 'status pending';
      setActiveMarker(stage);
      $('wizard').innerHTML = `<section class="panel ceremony-empty"><div class="eyebrow">Pool configuration error</div><h3>CAN'T START THE DRAFT</h3><p>${esc(poolError)}</p><p class="hint">Edit <code>data/maps.json</code> and <code>data/killers.json</code>; each needs at least five unique names.</p></section>`;
      return;
    }

    setActiveMarker(stage);
    $('toss-status').textContent = stage === 'done' ? 'Setup locked' : stage === 'toss' ? 'Awaiting toss' : stage === 'maps' ? 'Map veto' : 'Killer draft';
    $('toss-status').className = stage === 'done' ? 'status completed' : stage === 'toss' ? 'status pending' : 'status in_progress';

    if (stage === 'toss') renderTossStage(state, match, team);
    else if (stage === 'maps') renderMapStage(state, match, team);
    else if (stage === 'killers') renderKillerStage(state, match, team);
    else renderDoneStage(state, match, team);
  }

  function renderTossBanner(state, match) {
    const toss = match.toss || {};
    return `<div class="toss-result-line"><span>COIN · ${esc(toss.side || '—')}</span><strong>${esc(Entity.teamName(state, toss.winnerId))}</strong><small>${esc(Entity.teamName(state, toss.callerId))} called ${esc(toss.calledSide || '—')} · first map ban / Killer pick</small></div>`;
  }

  function renderTossStage(state, match, team) {
    $('wizard').innerHTML = `
      <section class="ceremony-grid">
        <article class="panel ceremony-instructions"><div class="eyebrow">Stage 01 / Coin toss</div><h3>WHO CLAIMS FIRST BAN?</h3><p>The toss winner earns the first map ban and first Killer pick. The teams then alternate bans until one map remains.</p>
          <div class="field"><label for="caller-select">Team calling the toss</label><select id="caller-select"><option value="a">${esc(team.a)}</option><option value="b">${esc(team.b)}</option></select></div>
          <div class="field"><label for="call-select">Call</label><select id="call-select"><option value="Heads">Heads</option><option value="Tails">Tails</option></select></div>
          <button class="button primary ceremony-main-action" data-action="flip" ${flipping ? 'disabled' : ''}>${flipping ? 'The Entity is deciding…' : 'Flip the coin'}</button>
          <p class="hint">The coin result is random and saved to this bracket match. Re-running a toss requires restarting this match setup.</p>
        </article>
        <article class="panel coin-panel"><div class="eyebrow">Fate protocol // ${esc(match.roundName)} · M${match.matchNumber}</div><div class="coin-stage"><div class="coin ${flipping ? 'flipping' : ''}" id="ceremony-coin"><div class="coin-inner"><span>${flipping ? '…' : 'ENTITY'}<small>${flipping ? 'FATE IS TURNING' : 'FLIP TO BEGIN'}</small></span></div></div><div><div class="eyebrow">${esc(team.a)} <span class="muted">vs</span> ${esc(team.b)}</div><h3 class="panel-title" style="font-size:2rem;margin:8px 0">${flipping ? 'THE ENTITY IS DECIDING' : 'The next match awaits'}</h3><p class="hint">${flipping ? 'The map pool and draft order are being decided…' : 'Call heads or tails, then reveal the toss.'}</p></div></div></article>
      </section>`;
  }

  function renderMapStage(state, match, team) {
    if (!match.mapVeto || !Array.isArray(match.mapVeto.pool)) {
      $('wizard').innerHTML = `<section class="panel ceremony-empty"><div class="eyebrow">Stage 02 / Map veto</div><h3>MAP POOL NOT INITIALIZED</h3><p>Regenerate the map pool for this toss before bans begin.</p><button class="button primary" data-action="init-map-pool">Reveal random five maps</button></section>`;
      return;
    }
    const veto = match.mapVeto;
    const remain = remainingMaps(veto);
    if (veto.finalMap || remain.length === 1) {
      const finalMap = veto.finalMap || remain[0];
      $('wizard').innerHTML = `<section class="panel ceremony-locked"><div class="eyebrow">Stage 02 / Map locked</div><h3>THE REALM HAS BEEN CHOSEN</h3>${renderTossBanner(state, match)}<div class="locked-map">${esc(finalMap)}</div><p class="hint">Four bans are complete. This is the only map remaining and is now locked for the matchup.</p>${renderBanHistory(state, match)}<div class="actions"><button class="button primary" data-action="start-killer-draft">Reveal 5 Killers →</button><button class="button" data-action="restart-setup" ${match.status === 'completed' ? 'disabled title="This match has already advanced a winner"' : ''}>Restart setup</button></div></section>`;
      return;
    }
    const order = teamOrder(match);
    const pickerId = order[veto.bans.length % 2];
    const pickerName = Entity.teamName(state, pickerId);
    $('wizard').innerHTML = `<section class="panel veto-panel"><div class="veto-head"><div><div class="eyebrow">Stage 02 / Map veto · ${veto.bans.length + 1} of 4 bans</div><h3>${esc(pickerName.toUpperCase())} — BAN A MAP</h3><p>${esc(Entity.teamName(state, match.toss.winnerId))} won the toss and bans first. Teams alternate picks; the last map remaining becomes the match map.</p></div><div class="veto-counter"><strong>${remain.length}</strong><span>MAPS LEFT</span></div></div>${renderTossBanner(state, match)}
        <div class="draft-grid map-draft-grid">${remain.map((name, index) => `<button class="draft-card map-card" type="button" data-action="ban-map" data-map="${esc(name)}"><span class="draft-index">MAP ${String(index + 1).padStart(2, '0')}</span><strong>${esc(name)}</strong><small>BAN THIS MAP ↗</small></button>`).join('')}</div>
        ${renderBanHistory(state, match)}<div class="actions"><button class="button" data-action="reroll-maps" ${veto.bans.length ? 'disabled title="Reroll is locked after the first ban"' : ''}>Reroll 5 maps</button><button class="button danger" data-action="restart-setup" ${match.status === 'completed' ? 'disabled title="This match has already advanced a winner"' : ''}>Restart setup</button></div></section>`;
  }

  function renderBanHistory(state, match) {
    const veto = match.mapVeto;
    if (!veto || !veto.bans.length) return '<div class="ban-history"><span class="muted">No maps banned yet.</span></div>';
    return `<div class="ban-history"><div class="eyebrow">Veto history</div>${veto.bans.map((ban, index) => `<div class="ban-row"><span>${String(index + 1).padStart(2, '0')}</span><strong>${esc(ban.map)}</strong><small>${esc(Entity.teamName(state, ban.teamId))} banned</small></div>`).join('')}</div>`;
  }

  function renderKillerStage(state, match, team) {
    const draft = match.killerDraft;
    if (!draft || !Array.isArray(draft.pool)) {
      $('wizard').innerHTML = `<section class="panel ceremony-empty"><div class="eyebrow">Stage 03 / Killer draft</div><h3>THE REALM IS LOCKED</h3><p>The selected map is <strong>${esc(match.mapVeto.finalMap)}</strong>. Reveal the shared randomized Killer pool next.</p><button class="button primary" data-action="start-killer-draft">Reveal 5 Killers →</button></section>`;
      return;
    }
    const order = teamOrder(match);
    const picks = draft.picks || [];
    const taken = new Set(picks.map((pick) => pick.killer));
    const pickerId = order[picks.length];
    if (!pickerId || picks.length >= 2) return renderDoneStage(state, match, team);
    const pickerName = Entity.teamName(state, pickerId);
    const currentPick = pendingKiller && !taken.has(pendingKiller) ? pendingKiller : null;
    if (!currentPick) pendingKiller = null;
    $('wizard').innerHTML = `<section class="panel killer-draft-panel"><div class="veto-head"><div><div class="eyebrow">Stage 03 / Killer draft · Pick ${picks.length + 1} of 2</div><h3>${esc(pickerName.toUpperCase())} — LOCK YOUR KILLER</h3><p>Both teams draft from the same randomized five. Picks are unique; the toss winner picks first.</p></div><div class="veto-counter"><strong>${5 - picks.length}</strong><span>AVAILABLE</span></div></div>${renderTossBanner(state, match)}
      <div class="draft-grid killer-draft-grid">${draft.pool.map((name, index) => {
        const isTaken = taken.has(name);
        const selected = name === currentPick;
        return `<button class="draft-card killer-card ${selected ? 'selected' : ''} ${isTaken ? 'taken' : ''}" type="button" data-action="select-killer" data-killer="${esc(name)}" ${isTaken ? 'disabled' : ''}><span class="draft-index">EXECUTIONER ${String(index + 1).padStart(2, '0')}</span><strong>${esc(name)}</strong><small>${isTaken ? `LOCKED BY ${esc(Entity.teamName(state, picks.find((p) => p.killer === name).teamId).toUpperCase())}` : selected ? 'SELECTED · READY TO LOCK' : 'SELECT KILLER'}</small></button>`;
      }).join('')}</div>
      <div class="draft-confirm-bar"><div><div class="eyebrow">Your selection</div><strong>${currentPick ? esc(currentPick) : 'Choose a Killer above'}</strong></div><button class="button primary" data-action="lock-killer" ${currentPick ? '' : 'disabled'}>Lock ${esc(pickerName)}'s Killer</button></div>
      ${picks.length ? `<div class="locked-picks"><div class="eyebrow">Confirmed locks</div>${picks.map((pick) => `<div class="ban-row"><span>✓</span><strong>${esc(Entity.teamName(state, pick.teamId))}</strong><small>${esc(pick.killer)}</small></div>`).join('')}</div>` : ''}
      <div class="actions"><button class="button" data-action="reroll-killers" ${picks.length ? 'disabled title="Reroll is locked after the first selection"' : ''}>Reroll 5 Killers</button><button class="button danger" data-action="restart-setup" ${match.status === 'completed' ? 'disabled title="This match has already advanced a winner"' : ''}>Restart setup</button></div></section>`;
  }

  function renderDoneStage(state, match, team) {
    const picks = match.killerDraft && match.killerDraft.picks || [];
    const map = match.mapVeto && match.mapVeto.finalMap || 'Not selected';
    const pickName = (teamId) => (picks.find((pick) => pick.teamId === teamId) || {}).killer || 'Not locked';
    $('wizard').innerHTML = `<section class="panel setup-complete-panel"><div class="eyebrow">Pre-match setup complete</div><h3>THE MATCH IS READY</h3><div class="final-map-tile"><span>SELECTED MAP</span><strong>${esc(map)}</strong></div>
      <div class="final-killer-grid"><article><span>${esc(team.a)} · KILLER</span><strong>${esc(pickName(match.teamAId))}</strong></article><article><span>${esc(team.b)} · KILLER</span><strong>${esc(pickName(match.teamBId))}</strong></article></div>
      ${renderTossBanner(state, match)}
      <p class="hint">The map and both Killer picks are saved to this match. Continue to the scoring menu to award points from in-game actions.</p>
      <div class="actions"><button class="button primary" data-action="continue-scoring">Continue to points menu →</button><button class="button" data-action="restart-setup" ${match.status === 'completed' ? 'disabled title="This match has already advanced a winner"' : ''}>Restart match setup</button><a class="button" href="./bracket.html">Back to bracket</a></div></section>`;
  }

  function startMatchFlowRedirect() {
    const url = new URL('./bracket.html', window.location.href);
    url.searchParams.set('match', selectedId);
    url.searchParams.set('openScoring', '1');
    window.location.href = url.href;
  }

  function flipToss() {
    if (flipping || !selectedId) return;
    if (poolError) return;
    const { state, match } = currentMatchAndState();
    if (!match) return;
    if (match.toss && !window.confirm('This match already has a toss. Restart the setup to rerun it?')) return;
    const callerId = $('caller-select').value === 'b' ? match.teamBId : match.teamAId;
    const calledSide = $('call-select').value;
    const side = Math.random() < 0.5 ? 'Heads' : 'Tails';
    const winnerId = side === calledSide ? callerId : otherTeam(match, callerId);
    const mapOptions = sample(mapPool, 5);
    if (mapOptions.length !== 5) { poolError = 'The map pool must have at least five unique names.'; render(); return; }
    flipping = true;
    render();
    window.setTimeout(() => {
      Entity.update((draft) => {
        const current = findMatch(draft, selectedId);
        if (!current) return;
        current.toss = { winnerId, side, callerId, calledSide, choice: 'First map ban + first Killer pick', savedAt: new Date().toISOString() };
        current.mapVeto = { pool: mapOptions, bans: [], finalMap: null, confirmed: false };
        current.killerDraft = null;
        current.setupComplete = false;
        draft.activeMatchId = selectedId;
        if (current.status !== 'completed') Entity.setLive(draft, selectedId);
      });
      flipping = false;
      pendingKiller = null;
      render();
    }, 1450);
  }

  function initMapVeto() {
    if (!selectedId) return;
    const pool = sample(mapPool, 5);
    if (pool.length !== 5) { poolError = 'The map pool must contain at least five unique names.'; render(); return; }
    Entity.update((state) => {
      const match = findMatch(state, selectedId);
      if (!match || !match.toss) return;
      match.mapVeto = { pool, bans: [], finalMap: null, confirmed: false };
      match.killerDraft = null; match.setupComplete = false;
    });
  }

  function startKillerDraft(reroll) {
    if (!selectedId) return;
    const state = Entity.load(); const match = findMatch(state, selectedId);
    if (!match || !match.mapVeto || !match.mapVeto.finalMap) return;
    if (match.killerDraft && match.killerDraft.picks && match.killerDraft.picks.length && reroll) return;
    const pool = sample(killerPool, 5);
    if (pool.length !== 5) { poolError = 'The Killer pool must contain at least five unique names.'; render(); return; }
    pendingKiller = null;
    Entity.update((draft) => {
      const current = findMatch(draft, selectedId);
      if (!current) return;
      current.killerDraft = { pool, picks: [], complete: false };
      current.setupComplete = false;
    });
  }

  function banMap(mapName) {
    Entity.update((state) => {
      const match = findMatch(state, selectedId);
      if (!match || !match.mapVeto || match.mapVeto.finalMap) return;
      const veto = match.mapVeto;
      const remaining = remainingMaps(veto);
      if (!remaining.includes(mapName)) return;
      const order = teamOrder(match);
      const teamId = order[veto.bans.length % 2];
      veto.bans.push({ map: mapName, teamId, at: new Date().toISOString() });
      const afterBan = remainingMaps(veto);
      if (afterBan.length === 1) { veto.finalMap = afterBan[0]; veto.confirmed = true; }
    });
  }

  function lockKiller() {
    if (!pendingKiller) return;
    let setupJustCompleted = false;
    Entity.update((state) => {
      const match = findMatch(state, selectedId);
      if (!match || !match.killerDraft || match.killerDraft.complete) return;
      const draft = match.killerDraft;
      const order = teamOrder(match);
      const picks = draft.picks || (draft.picks = []);
      const teamId = order[picks.length];
      if (!teamId || draft.pool.indexOf(pendingKiller) < 0 || picks.some((pick) => pick.killer === pendingKiller)) return;
      picks.push({ teamId, killer: pendingKiller, lockedAt: new Date().toISOString() });
      pendingKiller = null;
      if (picks.length === 2) {
        draft.complete = true;
        match.setupComplete = true;
        setupJustCompleted = true;
        if (match.status !== 'completed') Entity.setLive(state, match.id);
        else state.activeMatchId = match.id;
      }
    });
    render();
    if (setupJustCompleted) {
      if (redirectTimer) window.clearTimeout(redirectTimer);
      redirectTimer = window.setTimeout(startMatchFlowRedirect, 2300);
    }
  }

  function restartSetup() {
    const before = findMatch(Entity.load(), selectedId);
    if (!before) return;
    if (before.status === 'completed') { window.alert('This match has already advanced a winner. Rebuild the bracket or correct the result from the scoring menu before restarting its ceremony.'); return; }
    if (!selectedId || !window.confirm('Restarting setup clears this match’s toss, map bans, Killer locks and scorecard. Continue?')) return;
    if (redirectTimer) window.clearTimeout(redirectTimer);
    Entity.update((state) => {
      const match = findMatch(state, selectedId);
      if (!match) return;
      match.toss = null; match.mapVeto = null; match.killerDraft = null; match.setupComplete = false;
      match.scorecard = null; match.scoreA = null; match.scoreB = null; match.winnerId = null; match.tiebreakWinnerId = null;
      if (match.status !== 'bye') match.status = 'pending';
      state.activeMatchId = match.id;
    });
    pendingKiller = null; render();
  }

  $('match-select').addEventListener('change', (event) => {
    selectedId = event.target.value || null; pendingKiller = null;
    if (redirectTimer) window.clearTimeout(redirectTimer);
    Entity.update((state) => { state.activeMatchId = selectedId; });
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set('match', selectedId); else url.searchParams.delete('match');
    window.history.replaceState({}, '', url.pathname + url.search);
    render();
  });

  $('wizard').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'flip') flipToss();
    if (action === 'init-map-pool') initMapVeto();
    if (action === 'ban-map') banMap(button.dataset.map);
    if (action === 'reroll-maps' && !findMatch(Entity.load(), selectedId)?.mapVeto?.bans?.length) initMapVeto();
    if (action === 'start-killer-draft') startKillerDraft(false);
    if (action === 'select-killer') { pendingKiller = button.dataset.killer; render(); }
    if (action === 'reroll-killers') {
      const draft = findMatch(Entity.load(), selectedId)?.killerDraft;
      if (!draft || !draft.picks || !draft.picks.length) startKillerDraft(true);
    }
    if (action === 'lock-killer') lockKiller();
    if (action === 'restart-setup') restartSetup();
    if (action === 'continue-scoring') { if (redirectTimer) window.clearTimeout(redirectTimer); startMatchFlowRedirect(); }
  });

  Entity.subscribe(() => { if (!flipping) render(); });
  loadPools().then(() => {
    const { match } = currentMatchAndState();
    // Migrate an older toss result that predates map veto state: reuse its toss winner and start the map phase.
    if (match && match.toss && !match.mapVeto && !poolError) initMapVeto();
    render();
  });
})();
