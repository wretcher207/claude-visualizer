/* ==========================================================================
   Analytics Dashboard — fetch + render
   Matches the main app's IIFE pattern; no deps, no chart libs.
   ========================================================================== */

(function () {
  'use strict';

  // Mirrors TOOL_COLORS from canvas.js. Duplicated intentionally: analytics
  // page doesn't load canvas.js (no ambient animation here).
  const TOOL_COLORS = {
    Read:           '#D4A017',
    Edit:           '#C86840',
    Write:          '#B85535',
    Bash:           '#6B8E5A',
    Glob:           '#C8A850',
    Grep:           '#B89040',
    Agent:          '#D4B030',
    WebFetch:       '#4A8A7A',
    WebSearch:      '#3A7A6A',
    TodoWrite:      '#A06858',
    Skill:          '#B87040',
    Plan:           '#8A6070',
    EnterPlanMode:  '#8A6070',
    ExitPlanMode:   '#8A6070',
    _default:       '#7A7060',
  };

  function toolColor(name) {
    if (!name) return TOOL_COLORS._default;
    if (TOOL_COLORS[name]) return TOOL_COLORS[name];
    return TOOL_COLORS[cleanToolName(name)] || TOOL_COLORS._default;
  }

  function cleanToolName(name) {
    if (!name) return 'unknown';
    if (name.startsWith('mcp__')) {
      const parts = name.split('__');
      return parts.length >= 3 ? parts.slice(2).join('__') : parts[parts.length - 1];
    }
    return name;
  }

  // ---- Formatting ----

  function fmtDuration(ms) {
    if (!ms || ms < 0) return '0s';
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    if (ms < 3600000) {
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      return m + 'm ' + s + 's';
    }
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h + 'h ' + m + 'm';
  }

  function fmtNum(n) {
    return (n || 0).toLocaleString();
  }

  function fmtPct(p) {
    if (!p) return '0%';
    return (p * 100).toFixed(p < 0.01 ? 2 : 1) + '%';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function shortCwd(cwd) {
    if (!cwd) return '';
    const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.slice(-2).join('/') || cwd;
  }

  // ---- State ----

  let currentDays = 30;

  const els = {
    tiles: {
      tools: document.getElementById('tile-tools'),
      toolsSub: document.getElementById('tile-tools-sub'),
      sessions: document.getElementById('tile-sessions'),
      sessionsSub: document.getElementById('tile-sessions-sub'),
      duration: document.getElementById('tile-duration'),
      durationSub: document.getElementById('tile-duration-sub'),
      failures: document.getElementById('tile-failures'),
      failuresSub: document.getElementById('tile-failures-sub'),
    },
    activityCanvas: document.getElementById('activity-canvas'),
    activityTooltip: document.getElementById('activity-tooltip'),
    leaderboard: document.getElementById('tool-leaderboard'),
    heatmap: document.getElementById('heatmap'),
    sessionsTable: document.getElementById('sessions-table'),
    sessionsBody: document.getElementById('sessions-tbody'),
    sessionsHint: document.getElementById('sessions-hint'),
    errorsList: document.getElementById('errors-list'),
    errorsHint: document.getElementById('errors-hint'),
    rangeSelector: document.getElementById('range-selector'),
    footerRange: document.getElementById('footer-range'),
  };

  // ---- Fetch ----

  async function fetchJSON(url) {
    const r = await fetch(url);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'request failed');
    return j.data;
  }

  // ---- Render ----

  function renderTiles(summary) {
    const tileTools = document.querySelector('[data-tile="tools"]');
    const tileFailures = document.querySelector('[data-tile="failures"]');

    els.tiles.tools.textContent = fmtNum(summary.totalTools);
    els.tiles.toolsSub.textContent = summary.activeDays + ' active day' + (summary.activeDays === 1 ? '' : 's');

    els.tiles.sessions.textContent = fmtNum(summary.totalSessions);
    if (summary.totalSessions > 0) {
      const avgTools = Math.round(summary.totalTools / summary.totalSessions);
      els.tiles.sessionsSub.textContent = avgTools + ' tools/session avg';
    } else {
      els.tiles.sessionsSub.textContent = '';
    }

    els.tiles.duration.textContent = fmtDuration(summary.totalDurationMs);
    if (summary.busiestHour !== null && summary.busiestHour !== undefined) {
      els.tiles.durationSub.textContent = 'Peak at ' + String(summary.busiestHour).padStart(2, '0') + ':00';
    }

    els.tiles.failures.textContent = fmtPct(summary.failureRate);
    els.tiles.failuresSub.textContent = fmtNum(summary.totalFailures) + ' fails / ' + fmtNum(summary.totalTools) + ' calls';

    // Color tile state
    tileTools.removeAttribute('data-state');
    if (summary.failureRate >= 0.15) tileFailures.setAttribute('data-state', 'bad');
    else if (summary.failureRate >= 0.05) tileFailures.setAttribute('data-state', 'warn');
    else tileFailures.removeAttribute('data-state');
  }

  // ---- Activity chart (canvas) ----

  let activitySeries = [];
  let activityGeom = null;

  function renderActivity(summary) {
    const canvas = els.activityCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    // Fill in missing dates with zeros so the axis is continuous
    const byDate = {};
    for (const d of summary.byDate) byDate[d.date] = d;
    const dates = enumerateDates(summary.start, summary.end);
    const series = dates.map(date => ({
      date,
      count: byDate[date] ? byDate[date].count : 0,
      durationMs: byDate[date] ? byDate[date].durationMs : 0,
      failures: byDate[date] ? byDate[date].failures : 0,
    }));
    activitySeries = series;

    if (series.length === 0) {
      ctx.fillStyle = '#5A5448';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No activity in this range', cssWidth / 2, cssHeight / 2);
      activityGeom = null;
      return;
    }

    const padL = 40, padR = 16, padT = 16, padB = 24;
    const plotW = cssWidth - padL - padR;
    const plotH = cssHeight - padT - padB;
    const max = Math.max(1, ...series.map(s => s.count));

    const xAt = i => padL + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
    const yAt = v => padT + plotH - (v / max) * plotH;

    // Grid: 4 horizontal lines
    ctx.strokeStyle = '#2A2824';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(cssWidth - padR, y);
      ctx.stroke();

      ctx.fillStyle = '#5A5448';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(max - (max * i) / 4)), padL - 6, y + 3);
    }

    // Area fill under line
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, 'rgba(255, 134, 109, 0.35)');
    grad.addColorStop(1, 'rgba(255, 134, 109, 0)');

    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(0));
    series.forEach((s, i) => ctx.lineTo(xAt(i), yAt(s.count)));
    ctx.lineTo(xAt(series.length - 1), padT + plotH);
    ctx.lineTo(xAt(0), padT + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.strokeStyle = '#D4A017';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    series.forEach((s, i) => {
      const x = xAt(i), y = yAt(s.count);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Points
    ctx.fillStyle = '#ff866d';
    series.forEach((s, i) => {
      ctx.beginPath();
      ctx.arc(xAt(i), yAt(s.count), 2, 0, Math.PI * 2);
      ctx.fill();
    });

    // X-axis labels: start, middle, end
    ctx.fillStyle = '#5A5448';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    const xLabels = [0, Math.floor(series.length / 2), series.length - 1];
    for (const i of xLabels) {
      ctx.fillText(fmtDate(series[i].date), xAt(i), cssHeight - 6);
    }

    activityGeom = { padL, padR, padT, padB, plotW, plotH, xAt, yAt, max };
  }

  function onActivityHover(e) {
    if (!activityGeom || activitySeries.length === 0) return;
    const rect = els.activityCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const { padL, padR } = activityGeom;
    if (x < padL || x > rect.width - padR) {
      els.activityTooltip.classList.remove('visible');
      return;
    }

    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < activitySeries.length; i++) {
      const d = Math.abs(activityGeom.xAt(i) - x);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    }

    const s = activitySeries[nearestIdx];
    els.activityTooltip.innerHTML =
      '<span class="tt-date">' + fmtDate(s.date) + '</span>' +
      '<span class="tt-count">' + fmtNum(s.count) + ' tool' + (s.count === 1 ? '' : 's') + '</span>' +
      '<span style="color:#8A7E6A"> &middot; ' + fmtDuration(s.durationMs) +
      (s.failures ? ' &middot; <span style="color:#C86840">' + s.failures + ' fail' + (s.failures === 1 ? '' : 's') + '</span>' : '') +
      '</span>';

    const tx = Math.min(rect.width - 160, Math.max(0, x + 12));
    const ty = Math.max(0, y - 40);
    els.activityTooltip.style.left = tx + 'px';
    els.activityTooltip.style.top = ty + 'px';
    els.activityTooltip.classList.add('visible');
  }

  function onActivityLeave() {
    els.activityTooltip.classList.remove('visible');
  }

  // ---- Tool leaderboard ----

  function renderLeaderboard(breakdown) {
    const tools = breakdown.tools.slice(0, 15);
    els.leaderboard.innerHTML = '';

    if (tools.length === 0) {
      els.leaderboard.innerHTML = '<div class="empty-state">No tool usage yet.</div>';
      return;
    }

    const max = tools[0].count;

    for (const t of tools) {
      const row = document.createElement('div');
      row.className = 'leader-row';
      row.title = t.name + ' — p50 ' + fmtDuration(t.p50Ms) + ', p95 ' + fmtDuration(t.p95Ms) + ', max ' + fmtDuration(t.maxMs);

      const color = toolColor(t.name);
      const width = (t.count / max) * 100;

      const dot = document.createElement('span');
      dot.className = 'leader-dot';
      dot.style.background = color;

      const bar = document.createElement('div');
      bar.className = 'leader-bar';

      const fill = document.createElement('div');
      fill.className = 'leader-fill';
      fill.style.background = color;
      fill.style.width = width + '%';

      const name = document.createElement('span');
      name.className = 'leader-name';
      name.textContent = cleanToolName(t.name);

      bar.appendChild(fill);
      bar.appendChild(name);

      const stats = document.createElement('span');
      stats.className = 'leader-stats';
      let inner = '<span class="leader-count">' + fmtNum(t.count) + '</span>';
      inner += ' &middot; ' + fmtDuration(t.avgMs) + ' avg';
      if (t.failures > 0) {
        inner += '<span class="leader-fail">' + t.failures + ' fail</span>';
      }
      stats.innerHTML = inner;

      row.appendChild(dot);
      row.appendChild(bar);
      row.appendChild(stats);

      els.leaderboard.appendChild(row);
    }
  }

  // ---- Heatmap ----

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function renderHeatmap(data) {
    const grid = data.grid;
    els.heatmap.innerHTML = '';

    let max = 0;
    for (const row of grid) for (const v of row) if (v > max) max = v;

    // Top-left corner spacer
    els.heatmap.appendChild(document.createElement('div'));

    // Column labels (0, 3, 6, ...)
    for (let h = 0; h < 24; h++) {
      const lbl = document.createElement('div');
      lbl.className = 'heatmap-col-label';
      lbl.textContent = h % 3 === 0 ? String(h).padStart(2, '0') : '';
      els.heatmap.appendChild(lbl);
    }

    for (let d = 0; d < 7; d++) {
      const rowLbl = document.createElement('div');
      rowLbl.className = 'heatmap-row-label';
      rowLbl.textContent = DAYS[d];
      els.heatmap.appendChild(rowLbl);

      for (let h = 0; h < 24; h++) {
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';
        const v = grid[d][h];
        const intensity = max > 0 ? v / max : 0;
        const alpha = 0.04 + intensity * 0.86;
        cell.style.background = 'rgba(255, 134, 109, ' + alpha.toFixed(3) + ')';
        cell.title = DAYS[d] + ' ' + String(h).padStart(2, '0') + ':00 — ' + fmtNum(v) + ' tool' + (v === 1 ? '' : 's');
        els.heatmap.appendChild(cell);
      }
    }
  }

  // ---- Sessions ----

  function renderSessions(data) {
    const sessions = data.sessions;
    els.sessionsBody.innerHTML = '';
    els.sessionsHint.textContent = sessions.length + ' session' + (sessions.length === 1 ? '' : 's') + ' shown';

    if (sessions.length === 0) {
      els.sessionsBody.innerHTML = '<tr><td colspan="7" class="empty-state">No sessions in this range.</td></tr>';
      return;
    }

    for (const s of sessions) {
      const tr = document.createElement('tr');

      const date = document.createElement('td');
      date.textContent = fmtDate(s.firstTs || s.date);
      tr.appendChild(date);

      const started = document.createElement('td');
      started.textContent = fmtTime(s.firstTs);
      tr.appendChild(started);

      const dur = document.createElement('td');
      dur.textContent = fmtDuration(s.durationMs);
      tr.appendChild(dur);

      const tools = document.createElement('td');
      tools.className = 'num';
      tools.textContent = fmtNum(s.toolCount);
      tr.appendChild(tools);

      const fails = document.createElement('td');
      fails.className = 'num session-fail-cell' + (s.failures === 0 ? ' zero' : '');
      fails.textContent = s.failures;
      tr.appendChild(fails);

      const top = document.createElement('td');
      const dotsWrap = document.createElement('span');
      dotsWrap.className = 'session-top-dots';
      for (const t of (s.topTools || []).slice(0, 3)) {
        const dot = document.createElement('span');
        dot.className = 'tool-dot';
        dot.style.background = toolColor(t.name);
        dot.title = cleanToolName(t.name) + ' × ' + t.count;
        dotsWrap.appendChild(dot);
      }
      top.appendChild(dotsWrap);
      tr.appendChild(top);

      const cwd = document.createElement('td');
      const cwdSpan = document.createElement('span');
      cwdSpan.className = 'session-cwd';
      const primary = (s.cwds && s.cwds[0]) || '';
      cwdSpan.textContent = shortCwd(primary) || '—';
      cwdSpan.title = primary;
      cwd.appendChild(cwdSpan);
      tr.appendChild(cwd);

      els.sessionsBody.appendChild(tr);
    }
  }

  // ---- Errors ----

  function renderErrors(data) {
    const errors = data.errors;
    els.errorsList.innerHTML = '';
    els.errorsHint.textContent = errors.length + ' failure' + (errors.length === 1 ? '' : 's');

    if (errors.length === 0) {
      els.errorsList.innerHTML = '<div class="empty-state">No failures in this range. Nice.</div>';
      return;
    }

    for (const err of errors) {
      const row = document.createElement('div');
      row.className = 'error-row';

      const head = document.createElement('div');
      head.className = 'error-row-head';
      const tool = document.createElement('span');
      tool.className = 'error-row-tool';
      tool.textContent = cleanToolName(err.tool_name || 'unknown');
      const time = document.createElement('span');
      time.textContent = fmtDate(err.timestamp) + ' · ' + fmtTime(err.timestamp);
      head.appendChild(tool);
      head.appendChild(time);

      const msg = document.createElement('div');
      msg.className = 'error-row-msg';
      msg.textContent = err.error || '(no error message)';

      row.appendChild(head);
      row.appendChild(msg);

      els.errorsList.appendChild(row);
    }
  }

  // ---- Utilities ----

  function enumerateDates(startIso, endIso) {
    const out = [];
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return out;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }

  // ==========================================================================
  // TOKEN ANALYTICS
  // ==========================================================================

  function fmtTokens(n) {
    if (!n || n < 0) return '0';
    if (n < 1000) return String(n);
    if (n < 1e6)  return (n / 1e3).toFixed(n < 1e4 ? 2 : 1) + 'K';
    if (n < 1e9)  return (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + 'M';
    return (n / 1e9).toFixed(2) + 'B';
  }

  function fmtFloat(n, digits) {
    if (!isFinite(n)) return '0';
    if (n < 1 && n > 0) return n.toFixed(2);
    if (n < 10) return n.toFixed(1);
    return Math.round(n).toLocaleString();
  }

  function renderDelta(curr, prev) {
    if (!prev || prev === 0) {
      if (curr > 0) return '<span class="delta up">new</span>';
      return '<span class="delta flat">—</span>';
    }
    const diff = (curr - prev) / prev;
    const pct = Math.round(Math.abs(diff) * 100);
    if (Math.abs(diff) < 0.01) return '<span class="delta flat">flat</span>';
    if (diff > 0)  return '<span class="delta up">+' + pct + '%</span>';
    return '<span class="delta down">-' + pct + '%</span>';
  }

  function renderTokenHero(summary, comp) {
    const el = document.getElementById('tokens-hero-number');
    const equiv = document.getElementById('tokens-hero-equiv');
    const sub = document.getElementById('tokens-hero-sub');
    const mix = document.getElementById('tokens-mix');

    el.textContent = fmtTokens(summary.overall.total);
    sub.textContent = summary.overall.messages.toLocaleString() + ' assistant messages';

    // Pick 3-4 punchy comparisons based on output volume.
    const parts = [];
    if (comp.novels >= 0.5) {
      parts.push('<span class="equiv-number">' + fmtFloat(comp.novels) + '</span> novels');
    }
    if (comp.lotrTrilogy >= 0.1) {
      parts.push('<span class="equiv-number">' + fmtFloat(comp.lotrTrilogy) + '</span> Lord of the Rings trilogies');
    }
    if (comp.albumLyrics >= 1) {
      parts.push('<span class="equiv-number">' + fmtFloat(comp.albumLyrics) + '</span> albums of lyrics');
    }
    if (comp.emails >= 100) {
      parts.push('<span class="equiv-number">' + comp.emails.toLocaleString() + '</span> emails');
    }
    const speakH = Math.floor(comp.speakingMinutes / 60);
    if (speakH >= 1) {
      parts.push('<span class="equiv-number">' + speakH.toLocaleString() + '</span> hours of talking');
    }

    const lead = comp.outputWords ? ('That\'s <span class="equiv-number">' + comp.outputWords.toLocaleString() + '</span> words Claude wrote for you') : 'Claude hasn\'t said much yet';
    const tail = parts.length ? (' — about ' + parts.slice(0, 4).join('<span class="equiv-sep">·</span>')) : '';
    equiv.innerHTML = lead + tail + '.';

    // Mix breakdown tiles: cache-read, cache-create, output, input
    const mixItems = [
      { label: 'Cache read',   value: summary.overall.cacheRead,   color: '#6B8E5A' },
      { label: 'Cache create', value: summary.overall.cacheCreate, color: '#4A8A7A' },
      { label: 'Output',       value: summary.overall.output,      color: '#ff866d' },
      { label: 'Input',        value: summary.overall.input,       color: '#D4A017' },
    ];
    const total = summary.overall.total || 1;
    mix.innerHTML = mixItems.map(item => {
      const pct = ((item.value / total) * 100);
      return '<div class="tokens-mix-item" style="--mix-color:' + item.color + '">' +
        '<span class="mm-label">' + item.label + '</span>' +
        '<span class="mm-value">' + fmtTokens(item.value) + '</span>' +
        '<span class="mm-pct">' + (pct < 0.05 ? '<0.1' : pct.toFixed(1)) + '%</span>' +
      '</div>';
    }).join('');
  }

  function renderTokenWindows(summary) {
    const l7 = summary.last7, p7 = summary.prev7;
    const l30 = summary.last30, p30 = summary.prev30;

    document.getElementById('tile-last7').innerHTML = fmtTokens(l7.total);
    document.getElementById('tile-last7-sub').innerHTML =
      l7.messages.toLocaleString() + ' msgs  ' + renderDelta(l7.total, p7.total) + ' vs prior 7';

    document.getElementById('tile-last30').innerHTML = fmtTokens(l30.total);
    document.getElementById('tile-last30-sub').innerHTML =
      l30.messages.toLocaleString() + ' msgs  ' + renderDelta(l30.total, p30.total) + ' vs prior 30';

    const bd = summary.busiestDay;
    document.getElementById('tile-biggest-day').textContent = bd ? fmtTokens(bd.total) : '—';
    document.getElementById('tile-biggest-day-sub').textContent = bd ? fmtDate(bd.date) + ', ' + bd.messages.toLocaleString() + ' msgs' : '';

    const bs = summary.biggestSession;
    document.getElementById('tile-biggest-session').textContent = bs ? fmtTokens(bs.total) : '—';
    document.getElementById('tile-biggest-session-sub').textContent = bs ?
      fmtDate(bs.firstTs) + ' · ' + shortCwd(bs.cwd || '') + ' · ' + bs.messages.toLocaleString() + ' msgs' : '';
  }

  // Stacked-bar token chart
  let tokenSeries = [];
  let tokenGeom = null;
  function renderTokenFlow(summary) {
    const canvas = document.getElementById('tokens-canvas');
    const tooltip = document.getElementById('tokens-tooltip');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const series = summary.byDate.slice(-60);
    tokenSeries = series;

    if (series.length === 0) {
      ctx.fillStyle = '#5A5448';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No token data yet', cssW / 2, cssH / 2);
      tokenGeom = null;
      return;
    }

    const padL = 56, padR = 16, padT = 16, padB = 24;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;
    const max = Math.max(1, ...series.map(d => d.total));

    const barW = Math.max(2, Math.min(36, plotW / series.length - 3));
    const slot = plotW / series.length;

    // grid lines + labels
    ctx.strokeStyle = 'rgba(42, 40, 36, 0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(cssW - padR, y);
      ctx.stroke();
      ctx.fillStyle = '#5A5448';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(fmtTokens(Math.round(max - (max * i) / 4)), padL - 6, y + 3);
    }

    const colors = {
      output:      '#ff866d',
      input:       '#D4A017',
      cacheRead:   '#6B8E5A',
      cacheCreate: '#4A8A7A',
    };
    const order = ['cacheRead', 'cacheCreate', 'output', 'input'];

    series.forEach((d, i) => {
      const x = padL + i * slot + (slot - barW) / 2;
      let yTop = padT + plotH;
      for (const key of order) {
        const v = d[key] || 0;
        if (v <= 0) continue;
        const h = (v / max) * plotH;
        yTop -= h;
        ctx.fillStyle = colors[key];
        ctx.globalAlpha = 0.85;
        roundedRectTop(ctx, x, yTop, barW, h, 3);
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;

    // x-axis labels
    ctx.fillStyle = '#5A5448';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    const labelIdx = series.length <= 5 ? series.map((_, i) => i) : [0, Math.floor(series.length / 2), series.length - 1];
    for (const i of labelIdx) {
      ctx.fillText(fmtDate(series[i].date), padL + i * slot + slot / 2, cssH - 6);
    }

    tokenGeom = { padL, padR, padT, padB, plotW, plotH, max, slot, barW, series };
  }

  function roundedRectTop(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  function onTokenHover(e) {
    const canvas = document.getElementById('tokens-canvas');
    const tooltip = document.getElementById('tokens-tooltip');
    if (!tokenGeom) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { padL, padR, slot, series } = tokenGeom;
    if (x < padL || x > rect.width - padR) { tooltip.classList.remove('visible'); return; }
    const idx = Math.min(series.length - 1, Math.max(0, Math.floor((x - padL) / slot)));
    const d = series[idx];
    tooltip.innerHTML =
      '<span class="tt-date">' + fmtDate(d.date) + '</span>' +
      '<span class="tt-count">' + fmtTokens(d.total) + '</span>' +
      '<span style="color:#8A7E6A"> · ' +
        'out ' + fmtTokens(d.output) + ' · cache ' + fmtTokens(d.cacheRead + d.cacheCreate) +
      '</span>';
    const tx = Math.min(rect.width - 200, Math.max(0, x + 12));
    const ty = Math.max(0, y - 48);
    tooltip.style.left = tx + 'px';
    tooltip.style.top = ty + 'px';
    tooltip.classList.add('visible');
  }

  function onTokenLeave() {
    document.getElementById('tokens-tooltip').classList.remove('visible');
  }

  function renderTokenBars(container, items, opts) {
    opts = opts || {};
    container.innerHTML = '';
    if (!items || items.length === 0) {
      container.innerHTML = '<div class="empty-state">No data.</div>';
      return;
    }
    const max = items[0].total || 1;
    items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.style.animationDelay = (idx * 0.03) + 's';
      const color = opts.colorFn ? opts.colorFn(it) : '#ff866d';
      const name = opts.nameFn ? opts.nameFn(it) : (it.name || '');
      const stat = opts.statFn ? opts.statFn(it) : fmtTokens(it.total);
      const width = (it.total / max) * 100;

      row.innerHTML =
        '<span class="bar-dot" style="background:' + color + '"></span>' +
        '<div class="bar-track">' +
          '<div class="bar-fill" style="background:' + color + ';width:' + width + '%"></div>' +
          '<span class="bar-name">' + name + '</span>' +
        '</div>' +
        '<span class="bar-stats"><span class="bar-count">' + stat + '</span></span>';
      container.appendChild(row);
    });
  }

  function cwdShort(cwd) {
    if (!cwd) return '(unknown)';
    const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.slice(-1).join('/') || cwd;
  }

  function renderTokenProjects(summary) {
    const el = document.getElementById('tokens-by-cwd');
    renderTokenBars(el, summary.byCwd.slice(0, 12), {
      colorFn: () => '#ff866d',
      nameFn: (it) => '<span title="' + (it.cwd || '') + '">' + cwdShort(it.cwd) + '</span>',
      statFn: (it) => fmtTokens(it.total) + ' · ' + it.messages.toLocaleString() + ' msgs',
    });
  }

  function renderTokenModels(summary) {
    const el = document.getElementById('tokens-by-model');
    const modelColor = (m) => {
      if (m.model.includes('opus')) return '#ff866d';
      if (m.model.includes('sonnet')) return '#D4A017';
      if (m.model.includes('haiku')) return '#6B8E5A';
      return '#7A7060';
    };
    renderTokenBars(el, summary.byModel, {
      colorFn: modelColor,
      nameFn: (it) => it.model.replace('claude-', '').replace('-20251001', ''),
      statFn: (it) => fmtTokens(it.total),
    });
  }

  function renderTokenSessions(summary) {
    const tbody = document.getElementById('token-sessions-tbody');
    tbody.innerHTML = '';
    if (!summary.topSessions || summary.topSessions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No sessions yet.</td></tr>';
      return;
    }
    for (const s of summary.topSessions) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + fmtDate(s.firstTs) + ' ' + fmtTime(s.firstTs) + '</td>' +
        '<td><span class="session-cwd" title="' + (s.cwd || '') + '">' + cwdShort(s.cwd) + '</span></td>' +
        '<td class="num">' + s.messages.toLocaleString() + '</td>' +
        '<td class="num">' + fmtTokens(s.output) + '</td>' +
        '<td class="num">' + fmtTokens(s.cacheRead) + '</td>' +
        '<td class="num" style="color:#ff866d">' + fmtTokens(s.total) + '</td>';
      tbody.appendChild(tr);
    }
  }

  async function loadTokens() {
    try {
      const [summary, comp] = await Promise.all([
        fetchJSON('/api/tokens/summary'),
        fetchJSON('/api/tokens/comparisons'),
      ]);
      renderTokenHero(summary, comp);
      renderTokenWindows(summary);
      renderTokenFlow(summary);
      renderTokenProjects(summary);
      renderTokenModels(summary);
      renderTokenSessions(summary);
    } catch (err) {
      console.error('token load failed:', err);
      document.getElementById('tokens-hero-number').textContent = '—';
      document.getElementById('tokens-hero-equiv').textContent = 'Token analytics unavailable: ' + (err.message || 'unknown error');
    }
  }

  // ---- Load ----

  async function load(days) {
    currentDays = days;
    els.footerRange.textContent = 'Last ' + days + ' days';

    try {
      const [summary, breakdown, sessions, heatmap, errors] = await Promise.all([
        fetchJSON('/api/analytics/summary?days=' + days),
        fetchJSON('/api/analytics/tools?days=' + days),
        fetchJSON('/api/analytics/sessions?days=' + days + '&limit=50'),
        fetchJSON('/api/analytics/heatmap?days=' + days),
        fetchJSON('/api/analytics/errors?days=' + days + '&limit=50'),
      ]);

      renderTiles(summary);
      renderActivity(summary);
      renderLeaderboard(breakdown);
      renderHeatmap(heatmap);
      renderSessions(sessions);
      renderErrors(errors);
    } catch (err) {
      console.error('analytics load failed:', err);
      els.leaderboard.innerHTML = '<div class="empty-state">Failed to load analytics: ' + (err.message || 'unknown error') + '</div>';
    }

    loadTokens();
  }

  // Token flow canvas hover
  (function () {
    const c = document.getElementById('tokens-canvas');
    if (c) {
      c.addEventListener('mousemove', onTokenHover);
      c.addEventListener('mouseleave', onTokenLeave);
    }
  })();

  // ---- Range buttons ----

  els.rangeSelector.addEventListener('click', function (e) {
    const btn = e.target.closest('.range-btn');
    if (!btn) return;
    const days = parseInt(btn.dataset.days, 10);
    if (!days || days === currentDays) return;

    els.rangeSelector.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const url = new URL(window.location.href);
    url.searchParams.set('range', days + 'd');
    window.history.replaceState({}, '', url);

    load(days);
  });

  // ---- Activity hover ----

  els.activityCanvas.addEventListener('mousemove', onActivityHover);
  els.activityCanvas.addEventListener('mouseleave', onActivityLeave);

  // ---- Resize ----

  let resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      fetchJSON('/api/analytics/summary?days=' + currentDays)
        .then(renderActivity).catch(() => {});
      fetchJSON('/api/tokens/summary')
        .then(renderTokenFlow).catch(() => {});
    }, 200);
  });

  // ---- Boot ----

  function initRangeFromURL() {
    const params = new URLSearchParams(window.location.search);
    const r = params.get('range');
    if (!r) return 30;
    const m = /^(\d+)d?$/.exec(r);
    if (!m) return 30;
    const days = parseInt(m[1], 10);
    const allowed = [7, 30, 90, 365];
    if (!allowed.includes(days)) return 30;

    els.rangeSelector.querySelectorAll('.range-btn').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.days, 10) === days);
    });
    return days;
  }

  const startDays = initRangeFromURL();
  load(startDays);

})();
