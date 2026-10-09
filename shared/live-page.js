(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  if (new URLSearchParams(location.search).get('overlay') === '1') { document.documentElement.classList.add('overlay-mode'); document.body.classList.add('live-overlay'); }

  function currentMatch(state) {
    const requested = new URLSearchParams(location.search).get('match');
    if (requested) {
      const match = state.matches.find((m) => m.id === requested);
      if (match) return match;
    }
    return Entity.activeMatch(state);
  }

  function renderRecent(state) {
    const recent = state.matches.filter((m) => m.status === 'completed').slice().reverse().slice(0, 5);
    $('recent-section').style.display = recent.length ? '' : 'none';
    $('recent-list').innerHTML = recent.length ? recent.map((m) => `<div class="recent-row"><span class="left">${esc(Entity.teamName(state,m.teamAId))}</span><span class="scoreline">${m.scoreA} — ${m.scoreB}</span><span>${esc(Entity.teamName(state,m.teamBId))}</span></div>`).join('') : '<div class="empty">No completed matches yet.</div>';
  }

  function render() {
    const state = Entity.load();
    const match = currentMatch(state);
    if (!match || !match.teamAId || !match.teamBId) {
      $('round-label').textContent = 'AWAITING MATCH'; $('match-state').textContent = 'NOT STARTED'; $('match-number').innerHTML = 'NO MATCH<br>SELECTED';
      $('team-a-name').textContent = state.teams.length ? 'Match not selected' : 'Waiting for teams';
      $('team-b-name').textContent = state.teams.length ? 'Match not selected' : 'Waiting for teams';
      $('team-a-score').textContent = '—'; $('team-b-score').textContent = '—'; $('team-a-status').textContent = 'No active match'; $('team-b-status').textContent = 'No active match';
      $('toss-detail').textContent = 'TOSS · NOT RECORDED'; $('winner-detail').textContent = 'WINNER · PENDING';
      $('scenario-detail').textContent = 'MAP · NOT SELECTED · KILLERS · NOT LOCKED';
      $('sync-detail').textContent = 'LOCAL SYNC READY';
      renderRecent(state); return;
    }
    const status = match.status === 'in_progress' ? 'LIVE NOW' : match.status === 'completed' ? 'MATCH COMPLETE' : 'UP NEXT';
    $('round-label').textContent = match.roundName;
    $('match-state').textContent = status;
    $('match-number').innerHTML = `MATCH<br>${String(match.matchNumber).padStart(2,'0')}`;
    $('team-a-name').textContent = Entity.teamName(state, match.teamAId);
    $('team-b-name').textContent = Entity.teamName(state, match.teamBId);
    $('team-a-score').textContent = match.scoreA == null ? '0' : String(match.scoreA);
    $('team-b-score').textContent = match.scoreB == null ? '0' : String(match.scoreB);
    $('team-a-status').textContent = match.winnerId === match.teamAId ? 'MATCH WINNER' : (match.status === 'in_progress' ? 'COMPETING' : 'READY');
    $('team-b-status').textContent = match.winnerId === match.teamBId ? 'MATCH WINNER' : (match.status === 'in_progress' ? 'COMPETING' : 'READY');
    if (match.toss) $('toss-detail').textContent = `COIN · ${String(match.toss.side || '—').toUpperCase()} · ${Entity.teamName(state,match.toss.winnerId).toUpperCase()} · FIRST BAN / KILLER PICK`;
    else $('toss-detail').textContent = 'TOSS · NOT RECORDED';
    const picks = match.killerDraft && match.killerDraft.picks || [];
    const killerA = (picks.find((pick) => pick.teamId === match.teamAId) || {}).killer || 'NOT LOCKED';
    const killerB = (picks.find((pick) => pick.teamId === match.teamBId) || {}).killer || 'NOT LOCKED';
    const selectedMap = match.mapVeto && match.mapVeto.finalMap || 'NOT SELECTED';
    $('scenario-detail').textContent = `MAP · ${selectedMap.toUpperCase()} · ${Entity.teamName(state,match.teamAId).toUpperCase()} KILLER · ${killerA.toUpperCase()} · ${Entity.teamName(state,match.teamBId).toUpperCase()} KILLER · ${killerB.toUpperCase()}`;
    $('winner-detail').textContent = match.winnerId ? `WINNER · ${Entity.teamName(state,match.winnerId).toUpperCase()}` : 'WINNER · PENDING';
    $('sync-detail').textContent = `UPDATED · ${new Date(state.updatedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
    renderRecent(state);
  }

  Entity.subscribe(render);
  render();
})();
