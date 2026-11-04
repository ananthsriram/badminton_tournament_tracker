/**
 * Badminton Round Robin Tournament Engine
 * Real-time Supabase Cloud Synchronization with LocalStorage Fallback
 */

const STORAGE_KEY = 'badminton_round_robin_v1';
const SUPABASE_URL = 'https://bbxxgstfkpvhpzsuidtu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_y1rGkm8ZK13_hMkSrGzgzw_Z5yk82Ra';
const TOURNAMENT_ROW_ID = 'current_tournament';

// Supabase client instance
let supabaseClient = null;
let isRemoteUpdating = false;

// App State
let state = {
  players: [],
  matches: []
};

// Tournament initialization
async function initApp() {
  loadLocalData();
  setupEventListeners();
  renderAll();
  initSupabase();
}

function updateSyncStatus(status, text) {
  const badge = document.getElementById('syncStatusBadge');
  if (!badge) return;
  badge.className = `sync-badge sync-${status}`;
  badge.textContent = `● ${text}`;
}

// Initialize Supabase & Realtime Subscription
async function initSupabase() {
  if (typeof window.supabase === 'undefined') {
    console.warn('Supabase JS library not loaded, running in offline mode');
    updateSyncStatus('offline', 'Offline Storage');
    return;
  }

  try {
    updateSyncStatus('connecting', 'Connecting...');
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // Try fetching from normalized tables (matches + games)
    // Only games that have a winner (played) or scores need to be updated into state
    const { data: gamesData, error: gamesError } = await supabaseClient
      .from('games')
      .select('match_id, game_num, winner, t1_score, t2_score, played_date, played_at')
      .not('winner', 'is', null)
      .neq('winner', '')
      .order('match_id', { ascending: true });

    if (!gamesError && gamesData) {
      console.log('Connected to normalized Supabase tables! Games loaded:', gamesData.length);
      
      // Update state with games from normalized table
      const gamesByMatch = {};
      gamesData.forEach(g => {
        if (!gamesByMatch[g.match_id]) gamesByMatch[g.match_id] = [];
        gamesByMatch[g.match_id].push({
          game_num: g.game_num,
          winner: g.winner || '',
          t1_score: g.t1_score,
          t2_score: g.t2_score,
          played_date: g.played_date || null,
          played_at: g.played_at || null
        });
      });

      // Update state.matches with fetched played games
      state.matches.forEach(m => {
        if (gamesByMatch[m.id]) {
          gamesByMatch[m.id].forEach(fetchedGame => {
            const localGame = m.games.find(g => g.game_num === fetchedGame.game_num);
            if (localGame) {
              localGame.winner = fetchedGame.winner;
              localGame.t1_score = fetchedGame.t1_score;
              localGame.t2_score = fetchedGame.t2_score;
              localGame.played_date = fetchedGame.played_date;
              localGame.played_at = fetchedGame.played_at;
            }
          });
          let t1Wins = 0, t2Wins = 0, played = 0;
          m.games.forEach(g => {
            if (g.winner) {
              played++;
              if (normalizePair(g.winner) === normalizePair(m.team1)) t1Wins++;
              else if (normalizePair(g.winner) === normalizePair(m.team2)) t2Wins++;
            }
          });
          m.team1_wins = t1Wins;
          m.team2_wins = t2Wins;
          m.status = played === 3 ? 'Completed' : (played > 0 ? `${played} of 3 played` : 'Not started');
        }
      });

      saveLocalData();
      renderAll();
      updateSyncStatus('live', 'Live Cloud Sync');

      // Listen to Realtime updates on 'games'
      supabaseClient
        .channel('public:games')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, payload => {
          if (payload.new && payload.new.match_id) {
            const updatedMatch = state.matches.find(m => m.id === payload.new.match_id);
            if (updatedMatch) {
              const targetGame = updatedMatch.games.find(g => g.game_num === payload.new.game_num);
              if (targetGame) {
                targetGame.winner = payload.new.winner || '';
                targetGame.t1_score = payload.new.t1_score;
                targetGame.t2_score = payload.new.t2_score;
                targetGame.played_date = payload.new.played_date;
                targetGame.played_at = payload.new.played_at;

                // Recount wins
                let t1Wins = 0, t2Wins = 0, played = 0;
                updatedMatch.games.forEach(g => {
                  if (g.winner) {
                    played++;
                    if (normalizePair(g.winner) === normalizePair(updatedMatch.team1)) t1Wins++;
                    else if (normalizePair(g.winner) === normalizePair(updatedMatch.team2)) t2Wins++;
                  }
                });
                updatedMatch.team1_wins = t1Wins;
                updatedMatch.team2_wins = t2Wins;
                updatedMatch.status = played === 3 ? 'Completed' : (played > 0 ? `${played} of 3 played` : 'Not started');

                saveLocalData();
                renderAll();
                const finderResults = document.getElementById('finderResults');
                if (finderResults && finderResults.style.display !== 'none') {
                  find4PlayerMatchups();
                }
                showToast(`⚡ Match #${updatedMatch.id} Game ${targetGame.game_num} updated live!`);
              }
            }
          }
        })
        .subscribe();

      return;
    }

    // Fallback: Check monolithic 'tournament' table if normalized tables aren't queried yet
    const { data, error } = await supabaseClient
      .from('tournament')
      .select('data')
      .eq('id', TOURNAMENT_ROW_ID)
      .maybeSingle();

    if (error) {
      console.error('Supabase fetch error:', error);
      updateSyncStatus('offline', 'Local Cache');
    } else if (data && data.data && data.data.players && data.data.matches) {
      state = data.data;
      saveLocalData();
      renderAll();
      updateSyncStatus('live', 'Live Cloud Sync');
    }
  } catch (err) {
    console.error('Supabase initialization failed:', err);
    updateSyncStatus('offline', 'Offline Storage');
  }
}

// Load from LocalStorage or Fallback to INITIAL_TOURNAMENT_DATA
function loadLocalData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state = parsed;
    } catch (e) {
      console.error('Failed to parse saved state, loading initial defaults', e);
      state = JSON.parse(JSON.stringify(INITIAL_TOURNAMENT_DATA));
    }
  } else {
    state = JSON.parse(JSON.stringify(INITIAL_TOURNAMENT_DATA));
    saveLocalData();
  }
}

function saveLocalData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Save data locally and push to Supabase Cloud
async function saveData() {
  saveLocalData();

  if (supabaseClient) {
    try {
      isRemoteUpdating = true;
      updateSyncStatus('saving', 'Syncing...');
      const { error } = await supabaseClient
        .from('tournament')
        .upsert({ id: TOURNAMENT_ROW_ID, data: state, updated_at: new Date().toISOString() });

      if (error) {
        console.error('Failed to sync to Supabase:', error);
        updateSyncStatus('offline', 'Local only (Sync fail)');
      } else {
        updateSyncStatus('live', 'Live Cloud Sync');
      }
    } catch (err) {
      console.error('Cloud save exception:', err);
      updateSyncStatus('offline', 'Offline (Saved locally)');
    } finally {
      setTimeout(() => { isRemoteUpdating = false; }, 400);
    }
  }
}

// Reset to initial HTML state
async function resetData() {
  if (confirm('Are you sure you want to reset all tournament data back to the original spreadsheet numbers? This will reset data for all connected players.')) {
    localStorage.removeItem(STORAGE_KEY);
    state = JSON.parse(JSON.stringify(INITIAL_TOURNAMENT_DATA));
    await saveData();
    renderAll();
    showToast('Data reset to original tournament sheet');
  }
}

// Normalization helpers
function normalizePair(pairStr) {
  if (!pairStr) return '';
  const parts = pairStr.split('&').map(p => p.trim());
  return parts.sort().join(' & ');
}

function getPairMembers(pairStr) {
  if (!pairStr) return [];
  return pairStr.split('&').map(p => p.trim());
}

// Statistics Calculations
function calculateStats() {
  const numPlayers = state.players.length;
  // In doubles round robin with N players:
  // Each pair plays every other pair it does not share a player with, 3 times.
  // Number of eligible opponents for any pair is (N - 2)(N - 3) / 2
  // Total matches for each pair = 3 * (N - 2)(N - 3) / 2
  const matchesPerPair = 3 * ((numPlayers - 2) * (numPlayers - 3)) / 2;
  // Each player is in (N - 1) pairs, so matches per player = (N - 1) * matchesPerPair
  const matchesPerPlayer = (numPlayers - 1) * matchesPerPair;

  const playerStats = {};
  state.players.forEach(p => {
    playerStats[p] = {
      name: p,
      played: 0,
      won: 0,
      lost: 0,
      ptsWon: 0,
      ptsLost: 0,
      winPct: 0,
      matchesLeft: matchesPerPlayer,
      avgPts: 0
    };
  });

  const pairStats = {};
  // Initialize all pairs
  for (let i = 0; i < state.players.length; i++) {
    for (let j = i + 1; j < state.players.length; j++) {
      const p1 = state.players[i];
      const p2 = state.players[j];
      const pairName = `${p1} & ${p2}`;
      pairStats[pairName] = {
        pair: pairName,
        p1,
        p2,
        played: 0,
        won: 0,
        lost: 0,
        winPct: 0,
        matchesLeft: matchesPerPair
      };
    }
  }

  let totalGamesPlayed = 0;

  // Process all matches and games
  state.matches.forEach(m => {
    const t1Norm = normalizePair(m.team1);
    const t2Norm = normalizePair(m.team2);
    const t1Players = getPairMembers(m.team1);
    const t2Players = getPairMembers(m.team2);

    m.games.forEach(g => {
      if (g.winner) {
        totalGamesPlayed++;
        const winNorm = normalizePair(g.winner);
        const t1Won = (winNorm === t1Norm);
        const t2Won = (winNorm === t2Norm);

        const t1Score = (g.t1_score !== null && g.t1_score !== undefined) ? Number(g.t1_score) : 0;
        const t2Score = (g.t2_score !== null && g.t2_score !== undefined) ? Number(g.t2_score) : 0;

        // Update pair stats
        if (pairStats[t1Norm]) {
          pairStats[t1Norm].played++;
          if (t1Won) pairStats[t1Norm].won++;
          else pairStats[t1Norm].lost++;
        }
        if (pairStats[t2Norm]) {
          pairStats[t2Norm].played++;
          if (t2Won) pairStats[t2Norm].won++;
          else pairStats[t2Norm].lost++;
        }

        // Update player stats
        t1Players.forEach(p => {
          if (playerStats[p]) {
            playerStats[p].played++;
            playerStats[p].ptsWon += t1Score;
            playerStats[p].ptsLost += t2Score;
            if (t1Won) playerStats[p].won++;
            else playerStats[p].lost++;
          }
        });

        t2Players.forEach(p => {
          if (playerStats[p]) {
            playerStats[p].played++;
            playerStats[p].ptsWon += t2Score;
            playerStats[p].ptsLost += t1Score;
            if (t2Won) playerStats[p].won++;
            else playerStats[p].lost++;
          }
        });
      }
    });
  });

  // Calculate percentages and averages
  const playerList = Object.values(playerStats).map(p => {
    p.winPct = p.played > 0 ? ((p.won / p.played) * 100).toFixed(1) : 0;
    p.avgPts = p.played > 0 ? (p.ptsWon / p.played).toFixed(1) : 0;
    p.matchesLeft = Math.max(0, matchesPerPlayer - p.played);
    return p;
  });

  const pairList = Object.values(pairStats).map(pr => {
    pr.winPct = pr.played > 0 ? ((pr.won / pr.played) * 100).toFixed(1) : 0;
    pr.matchesLeft = Math.max(0, matchesPerPair - pr.played);
    return pr;
  });

  // Calculate total scheduled tournament games
  const totalMatchups = state.matches.length;
  const totalGamesScheduled = totalMatchups * 3;

  return {
    players: playerList,
    pairs: pairList,
    totalGamesPlayed,
    totalGamesScheduled,
    matchesPerPair,
    matchesPerPlayer
  };
}

// Rendering routines
function renderAll() {
  const stats = calculateStats();
  renderMetrics(stats);
  renderPlayersLeaderboard(stats.players);
  renderPairsLeaderboard(stats.pairs);
  renderRoster(stats.players);
  populateFinderDropdowns();
  renderFixtures();
  populateDailyPlayerFilter();
  renderDailyMatches();
}

function renderMetrics(stats) {
  document.getElementById('metricPlayed').textContent = stats.totalGamesPlayed;
  document.getElementById('metricPlayedSub').textContent = `of ${stats.totalGamesScheduled.toLocaleString()} games`;
  document.getElementById('metricPlayers').textContent = state.players.length;
  document.getElementById('metricPairs').textContent = stats.pairs.length;
}

// Leaderboard: Players
function renderPlayersLeaderboard(players) {
  const tbody = document.getElementById('playersTableBody');
  const sortMode = document.getElementById('playerSortSelect').value;
  const searchTerm = document.getElementById('playerSearch').value.toLowerCase().trim();

  let filtered = players.filter(p => p.name.toLowerCase().includes(searchTerm));

  filtered.sort((a, b) => {
    if (sortMode === 'wins') {
      if (b.won !== a.won) return b.won - a.won;
      return a.lost - b.lost;
    } else if (sortMode === 'win_pct') {
      if (Number(b.winPct) !== Number(a.winPct)) return Number(b.winPct) - Number(a.winPct);
      return b.won - a.won;
    } else if (sortMode === 'pts') {
      return b.ptsWon - a.ptsWon;
    } else if (sortMode === 'pts_avg') {
      return Number(b.avgPts) - Number(a.avgPts);
    }
    return 0;
  });

  tbody.innerHTML = '';
  filtered.forEach((p, idx) => {
    const rank = idx + 1;
    let rankBadgeClass = 'rank-other';
    if (rank === 1) rankBadgeClass = 'rank-1';
    else if (rank === 2) rankBadgeClass = 'rank-2';
    else if (rank === 3) rankBadgeClass = 'rank-3';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="rank-badge ${rankBadgeClass}">${rank}</span></td>
      <td>
        <div class="player-name-cell">
          <span>${p.name}</span>
        </div>
      </td>
      <td><strong>${p.played}</strong></td>
      <td style="color: #34d399; font-weight: 700;">${p.won}</td>
      <td style="color: #f43f5e;">${p.lost}</td>
      <td>
        <div class="win-pct-bar">
          <div class="progress-track">
            <div class="progress-fill" style="width: ${p.winPct}%"></div>
          </div>
          <span>${p.winPct}%</span>
        </div>
      </td>
      <td>${p.ptsWon}</td>
      <td>${p.avgPts}</td>
      <td class="muted">${p.matchesLeft}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Leaderboard: Pairs
function renderPairsLeaderboard(pairs) {
  const tbody = document.getElementById('pairsTableBody');
  const sortMode = document.getElementById('pairSortSelect').value;
  const searchTerm = document.getElementById('pairSearch').value.toLowerCase().trim();

  let filtered = pairs.filter(pr => pr.pair.toLowerCase().includes(searchTerm));

  filtered.sort((a, b) => {
    if (sortMode === 'wins') {
      if (b.won !== a.won) return b.won - a.won;
      return a.lost - b.lost;
    } else if (sortMode === 'win_pct') {
      if (Number(b.winPct) !== Number(a.winPct)) return Number(b.winPct) - Number(a.winPct);
      return b.won - a.won;
    } else if (sortMode === 'played') {
      return b.played - a.played;
    }
    return 0;
  });

  tbody.innerHTML = '';
  filtered.forEach((pr, idx) => {
    const rank = idx + 1;
    let rankBadgeClass = 'rank-other';
    if (rank === 1) rankBadgeClass = 'rank-1';
    else if (rank === 2) rankBadgeClass = 'rank-2';
    else if (rank === 3) rankBadgeClass = 'rank-3';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="rank-badge ${rankBadgeClass}">${rank}</span></td>
      <td><strong>${pr.pair}</strong></td>
      <td><strong>${pr.played}</strong></td>
      <td style="color: #34d399; font-weight: 700;">${pr.won}</td>
      <td style="color: #f43f5e;">${pr.lost}</td>
      <td>
        <div class="win-pct-bar">
          <div class="progress-track">
            <div class="progress-fill" style="width: ${pr.winPct}%"></div>
          </div>
          <span>${pr.winPct}%</span>
        </div>
      </td>
      <td class="muted">${pr.matchesLeft}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Roster tab
function renderRoster(players) {
  const grid = document.getElementById('rosterGrid');
  document.getElementById('rosterCount').textContent = state.players.length;
  grid.innerHTML = '';

  players.forEach(p => {
    const card = document.createElement('div');
    card.className = 'roster-card';
    card.innerHTML = `
      <div class="roster-name">🏸 ${p.name}</div>
      <div class="roster-stats">
        <span>Played: <strong>${p.played}</strong> | Won: <strong>${p.won}</strong></span>
        <span>Win Rate: <strong>${p.winPct}%</strong></span>
        <span>Points: <strong>${p.ptsWon}</strong> (avg ${p.avgPts})</span>
      </div>
    `;
    card.onclick = () => showPlayerDetail(p.name);
    grid.appendChild(card);
  });
}

// Player details drill-down
function showPlayerDetail(playerName) {
  const card = document.getElementById('playerDetailCard');
  document.getElementById('detailPlayerName').textContent = `Player Profile: ${playerName}`;
  
  // Find all matches featuring this player
  const playerMatches = state.matches.filter(m => {
    const p1 = getPairMembers(m.team1);
    const p2 = getPairMembers(m.team2);
    return p1.includes(playerName) || p2.includes(playerName);
  });

  const playedCount = playerMatches.reduce((acc, m) => acc + m.games.filter(g => g.winner).length, 0);

  // Group partners
  const partners = {};
  state.players.forEach(p => {
    if (p !== playerName) {
      const pairName = normalizePair(`${playerName} & ${p}`);
      partners[p] = { pair: pairName, played: 0, won: 0, lost: 0 };
    }
  });

  state.matches.forEach(m => {
    const t1Norm = normalizePair(m.team1);
    const t2Norm = normalizePair(m.team2);
    m.games.forEach(g => {
      if (g.winner) {
        const winNorm = normalizePair(g.winner);
        Object.keys(partners).forEach(p => {
          const pr = partners[p].pair;
          if (t1Norm === pr) {
            partners[p].played++;
            if (winNorm === pr) partners[p].won++;
            else partners[p].lost++;
          } else if (t2Norm === pr) {
            partners[p].played++;
            if (winNorm === pr) partners[p].won++;
            else partners[p].lost++;
          }
        });
      }
    });
  });

  let partnerHtml = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-top: 16px;">';
  Object.keys(partners).forEach(p => {
    const item = partners[p];
    partnerHtml += `
      <div style="background-color: var(--bg-secondary); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
        <div style="font-weight: 700; color: #fff;">Partner: ${p}</div>
        <div class="muted" style="margin-top: 4px;">Played: ${item.played} | Won: ${item.won} | Lost: ${item.lost}</div>
      </div>
    `;
  });
  partnerHtml += '</div>';

  document.getElementById('detailPlayerContent').innerHTML = `
    <div style="margin-bottom: 12px;">Total Tournament Fixtures: <strong>${playerMatches.length}</strong> | Games Completed: <strong>${playedCount}</strong></div>
    <h4 style="font-size: 0.95rem; margin-top: 16px;">Partnership Breakdown</h4>
    ${partnerHtml}
  `;

  card.style.display = 'block';
  card.scrollIntoView({ behavior: 'smooth' });
}

// Tab 2: Court Matchup Finder (Supports 4 or more players)
let finderSelectedPlayers = new Set();

function populateFinderDropdowns() {
  const container = document.getElementById('finderPlayerChips');
  if (!container) return;

  // Preserve selections that still exist in players roster
  const validSelections = new Set();
  finderSelectedPlayers.forEach(p => {
    if (state.players.includes(p)) validSelections.add(p);
  });

  // If initial load and empty, default to first 4 players
  if (validSelections.size === 0 && state.players.length >= 4) {
    state.players.slice(0, 4).forEach(p => validSelections.add(p));
  }
  finderSelectedPlayers = validSelections;

  container.innerHTML = '';
  state.players.forEach(p => {
    const isSelected = finderSelectedPlayers.has(p);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `player-chip ${isSelected ? 'selected' : ''}`;
    chip.innerHTML = `
      <span class="chip-check">${isSelected ? '✓' : ''}</span>
      <span class="chip-name">${p}</span>
    `;
    chip.addEventListener('click', () => {
      if (finderSelectedPlayers.has(p)) {
        finderSelectedPlayers.delete(p);
      } else {
        finderSelectedPlayers.add(p);
      }
      updateFinderSelectionUI();
    });
    container.appendChild(chip);
  });

  updateFinderSelectionCount();
}

function updateFinderSelectionUI() {
  const container = document.getElementById('finderPlayerChips');
  if (!container) return;

  const chips = container.querySelectorAll('.player-chip');
  chips.forEach(chip => {
    const name = chip.querySelector('.chip-name').textContent;
    const isSelected = finderSelectedPlayers.has(name);
    chip.classList.toggle('selected', isSelected);
    chip.querySelector('.chip-check').textContent = isSelected ? '✓' : '';
  });

  updateFinderSelectionCount();
}

function updateFinderSelectionCount() {
  const countEl = document.getElementById('finderSelectedCount');
  if (!countEl) return;
  const count = finderSelectedPlayers.size;
  if (count < 4) {
    countEl.textContent = `${count} selected (select at least 4)`;
    countEl.style.color = 'var(--accent-amber)';
  } else {
    // Calculate total matchups: C(n, 4) * 3
    // C(n, 4) = n * (n-1) * (n-2) * (n-3) / 24
    const n = count;
    const fourCombos = (n * (n - 1) * (n - 2) * (n - 3)) / 24;
    const totalMatchups = fourCombos * 3;
    countEl.textContent = `${count} selected (${totalMatchups} possible matchups)`;
    countEl.style.color = 'var(--accent-primary)';
  }
}

function find4PlayerMatchups() {
  const chosen = Array.from(finderSelectedPlayers);

  if (chosen.length < 4) {
    alert('Please select at least 4 players who are present on court.');
    return;
  }

  // Generate all 4-player subsets C(n, 4)
  const subsetsOf4 = [];
  function getSubsets(arr, k, start = 0, current = []) {
    if (current.length === k) {
      subsetsOf4.push([...current]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      getSubsets(arr, k, i + 1, current);
      current.pop();
    }
  }
  getSubsets(chosen, 4);

  // For each 4-player subset {A, B, C, D}, generate the 3 doubles matchups:
  // 1) (A & B) vs (C & D)
  // 2) (A & C) vs (B & D)
  // 3) (A & D) vs (B & C)
  const matchedFixtures = [];
  const seenMatchIds = new Set();

  subsetsOf4.forEach(four => {
    const [A, B, C, D] = four;
    const combinations = [
      { team1: normalizePair(`${A} & ${B}`), team2: normalizePair(`${C} & ${D}`) },
      { team1: normalizePair(`${A} & ${C}`), team2: normalizePair(`${B} & ${D}`) },
      { team1: normalizePair(`${A} & ${D}`), team2: normalizePair(`${B} & ${C}`) }
    ];

    combinations.forEach(combo => {
      const match = state.matches.find(m => {
        const m1 = normalizePair(m.team1);
        const m2 = normalizePair(m.team2);
        return (m1 === combo.team1 && m2 === combo.team2) || (m1 === combo.team2 && m2 === combo.team1);
      });

      if (match && !seenMatchIds.has(match.id)) {
        seenMatchIds.add(match.id);
        matchedFixtures.push(match);
      }
    });
  });

  // Filter based on status dropdown
  const statusFilterEl = document.getElementById('finderStatusFilter');
  const statusFilter = statusFilterEl ? statusFilterEl.value : 'all';

  const filteredFixtures = matchedFixtures.filter(m => {
    const played = m.games.filter(g => g.winner).length;
    if (statusFilter === 'pending') return played < 3;
    if (statusFilter === 'completed') return played === 3;
    if (statusFilter === 'not_started') return played === 0;
    return true;
  });

  renderFinderResults(filteredFixtures, matchedFixtures.length, chosen.length);
}

function renderFinderResults(fixtures, totalFound = fixtures.length, playerCount = 4) {
  const container = document.getElementById('matchupCardsContainer');
  const resultsSection = document.getElementById('finderResults');
  const countBadge = document.getElementById('finderMatchCount');
  const subtitle = document.getElementById('finderResultsSubtitle');
  container.innerHTML = '';

  if (countBadge) {
    countBadge.textContent = `${fixtures.length} Matchup${fixtures.length !== 1 ? 's' : ''}`;
  }

  if (subtitle) {
    subtitle.textContent = `Showing ${fixtures.length} of ${totalFound} total doubles matchups among ${playerCount} present players.`;
  }

  if (fixtures.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 30px; text-align: center; background: rgba(0,0,0,0.2); border-radius: 12px; color: var(--text-muted);">
        <p style="font-size: 1.1rem; margin-bottom: 8px;">No matchups match the selected status filter.</p>
        <p style="font-size: 0.85rem;">Try switching the filter to "All Matchups" above.</p>
      </div>
    `;
    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  fixtures.forEach(m => {
    const playedGames = m.games.filter(g => g.winner).length;
    const pendingGames = 3 - playedGames;

    let statusClass = 'status-notstarted';
    let statusLabel = '3 Games Pending';
    if (playedGames === 3) {
      statusClass = 'status-completed';
      statusLabel = 'Completed (3/3)';
    } else if (playedGames > 0) {
      statusClass = 'status-progress';
      statusLabel = `${playedGames} of 3 Played (${pendingGames} Left)`;
    }

    const card = document.createElement('div');
    card.className = `matchup-card ${pendingGames > 0 ? 'pending-highlight' : ''}`;

    let gamesHtml = '';
    m.games.forEach(g => {
      if (g.winner) {
        gamesHtml += `
          <div class="game-row">
            <span class="game-title">Game ${g.game_num}</span>
            <span class="game-result">Winner: <strong style="color: #34d399;">${g.winner}</strong> (${g.t1_score} - ${g.t2_score})</span>
          </div>
        `;
      } else {
        gamesHtml += `
          <div class="game-row" style="border: 1px dashed rgba(255,255,255,0.15);">
            <span class="game-title">Game ${g.game_num} (Ready to play)</span>
            <button class="game-action-btn" onclick="openScoreModal(${m.id}, ${g.game_num})">🏸 Record Game</button>
          </div>
        `;
      }
    });

    card.innerHTML = `
      <div class="matchup-header">
        <span class="matchup-number">Match #${m.id}</span>
        <span class="matchup-status-badge ${statusClass}">${statusLabel}</span>
      </div>

      <div class="teams-vs-container">
        <div class="team-box ${m.team1_wins > m.team2_wins ? 'winner' : ''}">
          <div class="team-name">${m.team1}</div>
          <div class="team-wins-count">${m.team1_wins} wins</div>
        </div>
        <div class="vs-divider">VS</div>
        <div class="team-box ${m.team2_wins > m.team1_wins ? 'winner' : ''}">
          <div class="team-name">${m.team2}</div>
          <div class="team-wins-count">${m.team2_wins} wins</div>
        </div>
      </div>

      <div class="games-list">
        ${gamesHtml}
      </div>
      ${m.note ? `<div class="muted" style="margin-top: 10px; font-size: 0.75rem;">Note: ${m.note}</div>` : ''}
    `;

    container.appendChild(card);
  });

  resultsSection.style.display = 'block';
  resultsSection.scrollIntoView({ behavior: 'smooth' });
}

// Tab 4: Fixtures & Pagination
let fixturePage = 1;
const FIXTURES_PER_PAGE = 12;

function renderFixtures() {
  const container = document.getElementById('fixturesContainer');
  const search = document.getElementById('fixtureSearch').value.toLowerCase().trim();
  const filter = document.getElementById('fixtureStatusFilter').value;

  let filtered = state.matches.filter(m => {
    const text = `${m.team1} ${m.team2} #${m.id} ${m.note || ''}`.toLowerCase();
    if (search && !text.includes(search)) return false;

    const played = m.games.filter(g => g.winner).length;
    if (filter === 'completed' && played !== 3) return false;
    if (filter === 'pending' && played === 3) return false;
    if (filter === 'not_started' && played !== 0) return false;
    if (filter === 'in_progress' && (played === 0 || played === 3)) return false;

    return true;
  });

  const totalPages = Math.ceil(filtered.length / FIXTURES_PER_PAGE) || 1;
  if (fixturePage > totalPages) fixturePage = totalPages;
  if (fixturePage < 1) fixturePage = 1;

  document.getElementById('pageIndicator').textContent = `Page ${fixturePage} of ${totalPages} (${filtered.length} fixtures)`;
  document.getElementById('prevPageBtn').disabled = (fixturePage === 1);
  document.getElementById('nextPageBtn').disabled = (fixturePage === totalPages);

  const start = (fixturePage - 1) * FIXTURES_PER_PAGE;
  const pageItems = filtered.slice(start, start + FIXTURES_PER_PAGE);

  container.innerHTML = '';
  pageItems.forEach(m => {
    const playedGames = m.games.filter(g => g.winner).length;
    let statusClass = 'status-notstarted';
    let statusLabel = '0 / 3 Played';
    if (playedGames === 3) {
      statusClass = 'status-completed';
      statusLabel = 'Completed';
    } else if (playedGames > 0) {
      statusClass = 'status-progress';
      statusLabel = `${playedGames} / 3 Played`;
    }

    const card = document.createElement('div');
    card.className = 'matchup-card';

    let gamesHtml = '';
    m.games.forEach(g => {
      if (g.winner) {
        gamesHtml += `
          <div class="game-row">
            <span class="game-title">Game ${g.game_num}</span>
            <span class="game-result">Win: ${g.winner} (${g.t1_score}-${g.t2_score})</span>
          </div>
        `;
      } else {
        gamesHtml += `
          <div class="game-row" style="border: 1px dashed rgba(255,255,255,0.15);">
            <span class="game-title">Game ${g.game_num}</span>
            <button class="game-action-btn" onclick="openScoreModal(${m.id}, ${g.game_num})">+ Play</button>
          </div>
        `;
      }
    });

    card.innerHTML = `
      <div class="matchup-header">
        <span class="matchup-number">Match #${m.id}</span>
        <span class="matchup-status-badge ${statusClass}">${statusLabel}</span>
      </div>
      <div class="teams-vs-container">
        <div class="team-box">
          <div class="team-name">${m.team1}</div>
          <div class="team-wins-count">${m.team1_wins} wins</div>
        </div>
        <div class="vs-divider">VS</div>
        <div class="team-box">
          <div class="team-name">${m.team2}</div>
          <div class="team-wins-count">${m.team2_wins} wins</div>
        </div>
      </div>
      <div class="games-list">
        ${gamesHtml}
      </div>
    `;
    container.appendChild(card);
  });
}

// Tab 5: Daily Matches Log
function populateDailyPlayerFilter() {
  const sel = document.getElementById('dailyPlayerFilter');
  if (!sel) return;
  const curr = sel.value;
  sel.innerHTML = '<option value="all">All Players</option>';
  state.players.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  });
  if (curr && state.players.includes(curr)) sel.value = curr;
}

function renderDailyMatches() {
  const container = document.getElementById('dailyMatchesContainer');
  const dateInput = document.getElementById('dailyDatePicker');
  const playerFilter = document.getElementById('dailyPlayerFilter');
  const countBadge = document.getElementById('dailyMatchCount');
  if (!container || !dateInput) return;

  const targetDate = dateInput.value;
  const targetPlayer = playerFilter ? playerFilter.value : 'all';

  if (!targetDate) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-muted); background: rgba(0,0,0,0.2); border-radius: 12px;">
        <p style="font-size: 1.1rem; margin-bottom: 8px;">Please select a date to view games played on that day.</p>
      </div>
    `;
    if (countBadge) countBadge.textContent = '0 Games Played';
    return;
  }

  // Find all games played on targetDate
  const dailyGames = [];
  state.matches.forEach(m => {
    m.games.forEach(g => {
      if (g.winner && g.played_date === targetDate) {
        // Player filter
        const t1Members = getPairMembers(m.team1);
        const t2Members = getPairMembers(m.team2);
        const allMatchPlayers = [...t1Members, ...t2Members];

        if (targetPlayer === 'all' || allMatchPlayers.includes(targetPlayer)) {
          dailyGames.push({ match: m, game: g });
        }
      }
    });
  });

  if (countBadge) {
    countBadge.textContent = `${dailyGames.length} Game${dailyGames.length !== 1 ? 's' : ''} Played`;
  }

  if (dailyGames.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--text-muted); background: rgba(0,0,0,0.2); border-radius: 12px;">
        <p style="font-size: 1.1rem; margin-bottom: 8px;">No games recorded for <strong>${targetDate}</strong>${targetPlayer !== 'all' ? ` for player ${targetPlayer}` : ''}.</p>
        <p style="font-size: 0.85rem;">Check "3 Nov 2026" or select another date.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  dailyGames.forEach(({ match: m, game: g }) => {
    const card = document.createElement('div');
    card.className = 'matchup-card';

    const t1Norm = normalizePair(m.team1);
    const t2Norm = normalizePair(m.team2);
    const winNorm = normalizePair(g.winner);
    const t1Won = (winNorm === t1Norm);
    const t2Won = (winNorm === t2Norm);

    card.innerHTML = `
      <div class="matchup-header">
        <span class="matchup-number">Match #${m.id} - Game ${g.game_num}</span>
        <span class="matchup-status-badge status-completed">Completed</span>
      </div>

      <div class="teams-vs-container">
        <div class="team-box ${t1Won ? 'winner' : ''}">
          <div class="team-name">${m.team1}</div>
          <div class="team-wins-count" style="font-size: 1.1rem; font-weight: 800; color: ${t1Won ? 'var(--accent-emerald)' : 'var(--text-muted)'};">
            ${g.t1_score} pts
          </div>
        </div>
        <div class="vs-divider">VS</div>
        <div class="team-box ${t2Won ? 'winner' : ''}">
          <div class="team-name">${m.team2}</div>
          <div class="team-wins-count" style="font-size: 1.1rem; font-weight: 800; color: ${t2Won ? 'var(--accent-emerald)' : 'var(--text-muted)'};">
            ${g.t2_score} pts
          </div>
        </div>
      </div>

      <div class="games-list" style="margin-top: 14px;">
        <div class="game-row" style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25);">
          <span class="game-title">🏆 Winner</span>
          <span class="game-result" style="color: #34d399; font-weight: 700;">${g.winner}</span>
        </div>
      </div>

      ${m.note ? `<div class="muted" style="margin-top: 10px; font-size: 0.75rem;">Note: ${m.note}</div>` : ''}
    `;

    container.appendChild(card);
  });
}

// Add New Player Engine
function handleAddPlayer(e) {
  e.preventDefault();
  const input = document.getElementById('newPlayerName');
  const name = input.value.trim();

  if (!name) return;
  if (state.players.some(p => p.toLowerCase() === name.toLowerCase())) {
    alert(`A player named "${name}" already exists!`);
    return;
  }

  const existingPlayers = [...state.players];
  const newPlayer = name;

  // Generate all new 4-player combinations that include the new player
  // For every 3 players in existingPlayers: {A, B, C} + newPlayer:
  // 3 distinct matchups:
  // 1) (A & B) vs (C & newPlayer)
  // 2) (A & C) vs (B & newPlayer)
  // 3) (A & newPlayer) vs (B & C)
  let nextMatchId = state.matches.length > 0 ? Math.max(...state.matches.map(m => m.id)) + 1 : 1;
  const newMatches = [];

  for (let i = 0; i < existingPlayers.length; i++) {
    for (let j = i + 1; j < existingPlayers.length; j++) {
      for (let k = j + 1; k < existingPlayers.length; k++) {
        const A = existingPlayers[i];
        const B = existingPlayers[j];
        const C = existingPlayers[k];
        const D = newPlayer;

        const combos = [
          { t1: `${A} & ${B}`, t2: `${C} & ${D}` },
          { t1: `${A} & ${C}`, t2: `${B} & ${D}` },
          { t1: `${A} & ${D}`, t2: `${B} & ${C}` }
        ];

        combos.forEach(c => {
          newMatches.push({
            id: nextMatchId++,
            team1: c.t1,
            team2: c.t2,
            team1_wins: 0,
            team2_wins: 0,
            status: 'Not started',
            games: [
              { game_num: 1, winner: '', t1_score: null, t2_score: null },
              { game_num: 2, winner: '', t1_score: null, t2_score: null },
              { game_num: 3, winner: '', t1_score: null, t2_score: null }
            ],
            note: ''
          });
        });
      }
    }
  }

  // Update State
  state.players.push(newPlayer);
  state.matches.push(...newMatches);
  saveData();

  input.value = '';
  renderAll();
  showToast(`Player "${newPlayer}" added with ${newMatches.length} new matchups scheduled!`);
}

// Score Recording Modal
window.openScoreModal = function(matchId, gameNum) {
  const match = state.matches.find(m => m.id === matchId);
  if (!match) return;

  const modal = document.getElementById('scoreModal');
  document.getElementById('modalMatchId').value = matchId;
  document.getElementById('modalGameNum').value = gameNum;
  document.getElementById('modalMatchTitle').textContent = `Match #${match.id} - Game ${gameNum}`;

  document.getElementById('modalTeam1Name').textContent = match.team1;
  document.getElementById('modalTeam2Name').textContent = match.team2;

  const opt1 = document.getElementById('modalOptTeam1');
  const opt2 = document.getElementById('modalOptTeam2');
  opt1.textContent = match.team1;
  opt1.value = match.team1;
  opt2.textContent = match.team2;
  opt2.value = match.team2;

  // Preset if already played
  const game = match.games.find(g => g.game_num === gameNum);
  if (game && game.winner) {
    document.getElementById('team1Score').value = game.t1_score || '';
    document.getElementById('team2Score').value = game.t2_score || '';
    document.getElementById('modalWinnerSelect').value = game.winner;
  } else {
    document.getElementById('team1Score').value = '';
    document.getElementById('team2Score').value = '';
    document.getElementById('modalWinnerSelect').value = '';
  }

  document.getElementById('modalGameNotes').value = match.note || '';
  modal.classList.add('open');
};

function handleSaveScore(e) {
  e.preventDefault();
  const matchId = Number(document.getElementById('modalMatchId').value);
  const gameNum = Number(document.getElementById('modalGameNum').value);
  const s1 = Number(document.getElementById('team1Score').value);
  const s2 = Number(document.getElementById('team2Score').value);
  const winner = document.getElementById('modalWinnerSelect').value;
  const notes = document.getElementById('modalGameNotes').value.trim();

  const match = state.matches.find(m => m.id === matchId);
  if (!match) return;

  const game = match.games.find(g => g.game_num === gameNum);
  if (!game) return;

  // Auto-record current date (ISO YYYY-MM-DD)
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const nowIso = now.toISOString();

  game.t1_score = s1;
  game.t2_score = s2;
  game.winner = winner;
  game.played_date = todayStr;
  game.played_at = nowIso;

  if (notes) {
    match.note = notes;
  }

  // Recalculate match team wins and status
  let t1Wins = 0;
  let t2Wins = 0;
  let played = 0;
  match.games.forEach(g => {
    if (g.winner) {
      played++;
      if (normalizePair(g.winner) === normalizePair(match.team1)) t1Wins++;
      else if (normalizePair(g.winner) === normalizePair(match.team2)) t2Wins++;
    }
  });

  match.team1_wins = t1Wins;
  match.team2_wins = t2Wins;

  if (played === 3) {
    match.status = 'Completed';
  } else if (played > 0) {
    match.status = `${played} of 3 played`;
  } else {
    match.status = 'Not started';
  }

  saveGameScoreNormalized(match, game);
  document.getElementById('scoreModal').classList.remove('open');
  renderAll();

  // If on matchup finder, refresh finder view
  const finderResults = document.getElementById('finderResults');
  if (finderResults.style.display !== 'none') {
    find4PlayerMatchups();
  }

  // Refresh daily tab if open
  renderDailyMatches();

  showToast(`Score recorded: ${winner} won (${s1} - ${s2}) on ${todayStr}!`);
}

// Targeted row update for normalized Supabase schema
async function saveGameScoreNormalized(match, game) {
  saveLocalData();

  if (supabaseClient) {
    try {
      updateSyncStatus('saving', 'Saving game...');
      
      // Update specific game row
      const { error: gameErr } = await supabaseClient
        .from('games')
        .upsert({
          match_id: match.id,
          game_num: game.game_num,
          winner: game.winner,
          t1_score: game.t1_score,
          t2_score: game.t2_score,
          played_date: game.played_date,
          played_at: game.played_at,
          updated_at: new Date().toISOString()
        }, { onConflict: 'match_id,game_num' });

      // Update match row summary
      const { error: matchErr } = await supabaseClient
        .from('matches')
        .update({
          team1_wins: match.team1_wins,
          team2_wins: match.team2_wins,
          status: match.status,
          note: match.note || ''
        })
        .eq('id', match.id);

      // Also mirror to monolithic tournament backup
      supabaseClient
        .from('tournament')
        .upsert({ id: TOURNAMENT_ROW_ID, data: state, updated_at: new Date().toISOString() })
        .then(() => {});

      if (gameErr || matchErr) {
        console.warn('Normalized table write note:', gameErr || matchErr);
        updateSyncStatus('live', 'Saved (Local + Backup)');
      } else {
        updateSyncStatus('live', 'Live Cloud Sync');
      }
    } catch (err) {
      console.error('Error saving score to Supabase:', err);
      updateSyncStatus('offline', 'Offline (Saved locally)');
    }
  }
}

// Toast helper
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Export / Import JSON
function exportTournament() {
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `badminton_tournament_backup_${new Date().toISOString().slice(0,10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast('Tournament backup JSON exported!');
}

function importTournament(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (data.players && data.matches) {
        state = data;
        saveData();
        renderAll();
        showToast('Tournament data successfully imported!');
      } else {
        alert('Invalid JSON file format.');
      }
    } catch (err) {
      alert('Error parsing JSON file.');
    }
  };
  reader.readAsText(file);
}

// Event Listeners setup
function setupEventListeners() {
  // Navigation tabs
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      const tabId = `tab-${btn.dataset.tab}`;
      const tabPane = document.getElementById(tabId);
      if (tabPane) tabPane.classList.add('active');

      // Update titles
      const titles = {
        leaderboard: ['Tournament Leaderboard', 'Live statistics and rankings for singles players and pairs'],
        finder: ["Today's Court Matchup Finder", 'Select present players (4 or more) to see all possible doubles combinations & pending games'],
        players: ['Player Roster & Management', 'View player records or register new tournament entrants'],
        fixtures: ['Tournament Fixtures & Score Recorder', 'Browse all 3-game matchups and enter game results'],
        daily: ['Daily Match Log', 'View all games played on any tournament day with scores and winners']
      };
      if (titles[btn.dataset.tab]) {
        document.getElementById('pageTitle').textContent = titles[btn.dataset.tab][0];
        document.getElementById('pageSubtitle').textContent = titles[btn.dataset.tab][1];
      }
    });
  });

  // Subtabs (Leaderboard)
  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.subtab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`subtab-${btn.dataset.subtab}`).classList.add('active');
    });
  });

  // Search & Filter listeners
  document.getElementById('playerSearch').addEventListener('input', () => renderPlayersLeaderboard(calculateStats().players));
  document.getElementById('playerSortSelect').addEventListener('change', () => renderPlayersLeaderboard(calculateStats().players));
  document.getElementById('pairSearch').addEventListener('input', () => renderPairsLeaderboard(calculateStats().pairs));
  document.getElementById('pairSortSelect').addEventListener('change', () => renderPairsLeaderboard(calculateStats().pairs));

  // Matchup Finder
  document.getElementById('findMatchupsBtn').addEventListener('click', find4PlayerMatchups);
  document.getElementById('selectAllFinderBtn').addEventListener('click', () => {
    state.players.forEach(p => finderSelectedPlayers.add(p));
    updateFinderSelectionUI();
  });
  document.getElementById('clearFinderBtn').addEventListener('click', () => {
    finderSelectedPlayers.clear();
    updateFinderSelectionUI();
    document.getElementById('finderResults').style.display = 'none';
  });
  const statusFilterEl = document.getElementById('finderStatusFilter');
  if (statusFilterEl) {
    statusFilterEl.addEventListener('change', () => {
      const finderResults = document.getElementById('finderResults');
      if (finderResults.style.display !== 'none') {
        find4PlayerMatchups();
      }
    });
  }

  // Fixtures
  document.getElementById('fixtureSearch').addEventListener('input', () => { fixturePage = 1; renderFixtures(); });
  document.getElementById('fixtureStatusFilter').addEventListener('change', () => { fixturePage = 1; renderFixtures(); });
  document.getElementById('prevPageBtn').addEventListener('click', () => { if (fixturePage > 1) { fixturePage--; renderFixtures(); } });
  document.getElementById('nextPageBtn').addEventListener('click', () => { fixturePage++; renderFixtures(); });

  // Daily Log
  const dailyDatePicker = document.getElementById('dailyDatePicker');
  if (dailyDatePicker) {
    // Default to today's date
    dailyDatePicker.value = new Date().toISOString().slice(0, 10);
    dailyDatePicker.addEventListener('change', renderDailyMatches);
  }
  const dailyPlayerFilter = document.getElementById('dailyPlayerFilter');
  if (dailyPlayerFilter) {
    dailyPlayerFilter.addEventListener('change', renderDailyMatches);
  }
  const todayBtn = document.getElementById('todayDateBtn');
  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      const dp = document.getElementById('dailyDatePicker');
      if (dp) {
        dp.value = new Date().toISOString().slice(0, 10);
        renderDailyMatches();
      }
    });
  }

  // Add player form
  document.getElementById('addPlayerForm').addEventListener('submit', handleAddPlayer);
  document.getElementById('closeDetailBtn').addEventListener('click', () => {
    document.getElementById('playerDetailCard').style.display = 'none';
  });

  // Modal
  document.getElementById('recordGameForm').addEventListener('submit', handleSaveScore);
  document.getElementById('closeModalBtn').addEventListener('click', () => document.getElementById('scoreModal').classList.remove('open'));
  document.getElementById('cancelModalBtn').addEventListener('click', () => document.getElementById('scoreModal').classList.remove('open'));

  // Export / Import / Reset
  document.getElementById('exportBtn').addEventListener('click', exportTournament);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFileInput').click());
  document.getElementById('importFileInput').addEventListener('change', (e) => {
    if (e.target.files.length > 0) importTournament(e.target.files[0]);
  });
  document.getElementById('resetBtn').addEventListener('click', resetData);
}

// Bootstrap
window.addEventListener('DOMContentLoaded', initApp);

