/* ==========================================================================
   App Logic — Settings system, SSE connection, sidebar event rendering
   All display features are toggleable via the settings panel.
   ========================================================================== */

(function () {
  'use strict';

  // ===========================================================================
  // SETTINGS SYSTEM
  // Settings are saved to localStorage so they survive page reloads.
  // ===========================================================================

  const SETTINGS_CONFIG = [
    { key: 'smartSummaries',  name: 'Smart Summaries',   desc: 'Parsed, readable tool descriptions',   defaultOn: true },
    { key: 'liveTimer',       name: 'Live Timer',        desc: 'Real-time counter while tools run',    defaultOn: true },
    { key: 'sessionStats',    name: 'Session Stats',     desc: 'Tool count and timing in header',      defaultOn: true },
    { key: 'resultSize',      name: 'Result Size',       desc: 'Line and character count badges',      defaultOn: true },
    { key: 'sequenceNumbers', name: 'Sequence Numbers',  desc: 'Tool call numbering (#1, #2...)',      defaultOn: true },
    { key: 'mcpLabels',       name: 'MCP Server Labels', desc: 'Show which server a tool comes from',  defaultOn: true },
    { key: 'resultPreviews',  name: 'Result Previews',   desc: 'Smart first-line result summaries',    defaultOn: true },
    { key: 'workingDirectory',name: 'Working Directory',  desc: 'Show the active project path',        defaultOn: false },
    { key: 'failureCount',    name: 'Failure Counter',   desc: 'Count failed tool calls this session', defaultOn: true },
    { key: 'topTools',        name: 'Top Tools',         desc: 'Top 5 tools used this session',        defaultOn: true },
  ];

  const STORAGE_KEY = 'claude-visualizer-settings';

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved === 'object') {
        // Merge with defaults (in case new settings are added)
        const merged = {};
        for (const cfg of SETTINGS_CONFIG) {
          merged[cfg.key] = cfg.key in saved ? saved[cfg.key] : cfg.defaultOn;
        }
        return merged;
      }
    } catch { /* ignore */ }
    // Return defaults
    const defaults = {};
    for (const cfg of SETTINGS_CONFIG) {
      defaults[cfg.key] = cfg.defaultOn;
    }
    return defaults;
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch { /* ignore */ }
  }

  let settings = loadSettings();

  // Build the settings panel DOM
  function buildSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;

    const title = document.createElement('div');
    title.className = 'settings-title';
    title.textContent = 'Display Settings';
    panel.appendChild(title);

    for (const cfg of SETTINGS_CONFIG) {
      const row = document.createElement('div');
      row.className = 'setting-row';

      const info = document.createElement('div');
      info.className = 'setting-info';

      const nameEl = document.createElement('span');
      nameEl.className = 'setting-name';
      nameEl.textContent = cfg.name;

      const descEl = document.createElement('span');
      descEl.className = 'setting-desc';
      descEl.textContent = cfg.desc;

      info.appendChild(nameEl);
      info.appendChild(descEl);

      const toggle = document.createElement('div');
      toggle.className = 'toggle-switch' + (settings[cfg.key] ? ' on' : '');
      toggle.dataset.key = cfg.key;

      row.appendChild(info);
      row.appendChild(toggle);

      row.addEventListener('click', () => {
        settings[cfg.key] = !settings[cfg.key];
        toggle.classList.toggle('on', settings[cfg.key]);
        saveSettings();
        onSettingChanged(cfg.key);
      });

      panel.appendChild(row);
    }
  }

  // React to setting changes that have immediate visual effects
  function onSettingChanged(key) {
    if (key === 'sessionStats' || key === 'failureCount') {
      updateSessionStatsDisplay();
    }
    if (key === 'topTools') {
      renderTopTools();
    }
  }

  // Toggle settings panel open/close
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');

  if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener('click', () => {
      settingsPanel.classList.toggle('open');
      settingsBtn.classList.toggle('active');
    });
  }

  // ===========================================================================
  // TOOL UTILITIES
  // ===========================================================================

  const TOOL_COLORS = window.AmbientCanvas.TOOL_COLORS;

  function getToolColor(toolName) {
    return TOOL_COLORS[toolName] || TOOL_COLORS[cleanToolName(toolName)] || TOOL_COLORS._default;
  }

  // Clean long MCP tool names for display
  // "mcp__Claude_Preview__preview_screenshot" -> "preview_screenshot"
  function cleanToolName(name) {
    if (!name) return 'unknown';
    if (name.startsWith('mcp__')) {
      const parts = name.split('__');
      return parts.length >= 3 ? parts.slice(2).join('__') : parts[parts.length - 1];
    }
    return name;
  }

  // Extract MCP server name from raw tool name
  // "mcp__Claude_Preview__preview_screenshot" -> "Claude Preview"
  function extractMcpServer(name) {
    if (!name || !name.startsWith('mcp__')) return null;
    const parts = name.split('__');
    if (parts.length >= 3) {
      return parts[1].replace(/_/g, ' ');
    }
    return null;
  }

  // ===========================================================================
  // SMART INPUT PARSER
  // Turns raw tool_input JSON into a human-readable one-liner.
  // ===========================================================================

  function formatSmartInput(rawToolName, input) {
    if (!input || typeof input !== 'object') return null;

    const tool = cleanToolName(rawToolName);

    switch (tool) {
      case 'Read': {
        let s = input.file_path || '(unknown file)';
        if (input.offset) s += ', from line ' + input.offset;
        if (input.limit) s += ', ' + input.limit + ' lines';
        if (input.pages) s += ', pages ' + input.pages;
        return s;
      }

      case 'Edit': {
        let s = input.file_path || '(unknown file)';
        if (input.old_string) {
          const preview = input.old_string.trim().split('\n')[0].slice(0, 60);
          s += ' — replacing "' + preview + (input.old_string.length > 60 ? '...' : '') + '"';
        }
        if (input.replace_all) s += ' (all occurrences)';
        return s;
      }

      case 'Write': {
        let s = input.file_path || '(unknown file)';
        if (input.content) {
          s += ' (' + input.content.length.toLocaleString() + ' chars)';
        }
        return s;
      }

      case 'Bash': {
        const cmd = input.command || '(empty)';
        return '$ ' + cmd;
      }

      case 'Glob': {
        let s = input.pattern || '*';
        if (input.path) s += ' in ' + input.path;
        return s;
      }

      case 'Grep': {
        let s = '/' + (input.pattern || '') + '/';
        if (input['-i']) s += 'i';
        if (input.path) s += ' in ' + input.path;
        if (input.glob) s += ' (' + input.glob + ')';
        if (input.type) s += ' [' + input.type + ']';
        return s;
      }

      case 'Agent': {
        let s = input.subagent_type || 'general-purpose';
        if (input.description) s += ': ' + input.description;
        else if (input.prompt) s += ': ' + input.prompt.slice(0, 120) + (input.prompt.length > 120 ? '...' : '');
        return s;
      }

      case 'WebFetch':
        return input.url || '(no URL)';

      case 'WebSearch':
        return '"' + (input.query || '') + '"';

      case 'TodoWrite': {
        const count = Array.isArray(input.todos) ? input.todos.length : '?';
        return count + ' items';
      }

      case 'Skill':
        return input.skill || '(unknown skill)';

      case 'ToolSearch':
        return input.query || '(no query)';

      default: {
        // For MCP tools and others, show the most useful fields
        const keys = Object.keys(input);
        if (keys.length === 0) return null;
        if (keys.length === 1) {
          const val = input[keys[0]];
          const str = typeof val === 'string' ? val : JSON.stringify(val);
          return keys[0] + ': ' + str.slice(0, 120) + (str.length > 120 ? '...' : '');
        }
        // Multiple fields — show first 2-3 key:value pairs
        const previews = [];
        for (let i = 0; i < Math.min(keys.length, 3); i++) {
          const v = input[keys[i]];
          const vs = typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v).slice(0, 40);
          previews.push(keys[i] + ': ' + vs);
        }
        return previews.join(' | ') + (keys.length > 3 ? ' (+' + (keys.length - 3) + ' more)' : '');
      }
    }
  }

  // ===========================================================================
  // SMART RESULT PARSER
  // First meaningful line of a tool result.
  // ===========================================================================

  function formatSmartResult(result) {
    if (!result) return null;

    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    if (!text || text === 'null' || text === 'undefined') return null;

    const lines = text.split('\n').filter(function (l) { return l.trim(); });
    if (lines.length === 0) return '(empty result)';

    const firstLine = lines[0].trim().slice(0, 150);
    const suffix = lines.length > 1 ? ' (+' + (lines.length - 1) + ' more lines)' : '';
    return firstLine + (firstLine.length >= 150 ? '...' : '') + suffix;
  }

  // ===========================================================================
  // RESULT SIZE PARSER
  // Returns a short string like "1,842 lines" or "256 chars".
  // ===========================================================================

  function parseResultSize(result) {
    if (!result) return null;

    const text = typeof result === 'string' ? result : JSON.stringify(result);
    if (!text) return null;

    const lines = text.split('\n').length;
    if (lines > 1) return lines.toLocaleString() + ' lines';

    const chars = text.length;
    if (chars > 100) return chars.toLocaleString() + ' chars';
    return null;
  }

  // ===========================================================================
  // FORMATTING HELPERS
  // ===========================================================================

  function formatTime(isoString) {
    const d = new Date(isoString);
    return d.toLocaleTimeString('en-US', { hour12: false });
  }

  function formatDuration(ms) {
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return mins + 'm ' + secs + 's';
  }

  const MAX_DETAIL_LENGTH = 5000;

  function truncate(text) {
    if (typeof text !== 'string') {
      text = JSON.stringify(text, null, 2) || '';
    }
    if (text.length > MAX_DETAIL_LENGTH) {
      return { text: text.slice(0, MAX_DETAIL_LENGTH), truncated: true };
    }
    return { text: text, truncated: false };
  }

  // ===========================================================================
  // SESSION TRACKING
  // ===========================================================================

  let toolSequence = 0;
  let sessionToolCount = 0;
  let sessionTotalDuration = 0;
  let sessionFailureCount = 0;
  let sessionStartTime = null;
  let sessionClockInterval = null;
  const sessionByTool = new Map();

  function resetSessionStats() {
    toolSequence = 0;
    sessionToolCount = 0;
    sessionTotalDuration = 0;
    sessionFailureCount = 0;
    sessionByTool.clear();
    sessionStartTime = Date.now();
    if (sessionClockInterval) clearInterval(sessionClockInterval);
    sessionClockInterval = setInterval(updateSessionStatsDisplay, 1000);
    updateSessionStatsDisplay();
    renderTopTools();
  }

  function updateSessionStatsDisplay() {
    const bar = document.getElementById('session-stats');
    if (!bar) return;

    if (!settings.sessionStats) {
      bar.classList.remove('visible');
      return;
    }

    bar.classList.add('visible');

    const countEl = document.getElementById('stat-tool-count');
    const timeEl = document.getElementById('stat-total-time');
    const clockEl = document.getElementById('stat-session-clock');
    const failEl = document.getElementById('stat-failures');

    if (countEl) countEl.textContent = sessionToolCount + ' tool' + (sessionToolCount !== 1 ? 's' : '');
    if (timeEl) timeEl.textContent = formatDuration(sessionTotalDuration) + ' total';

    if (clockEl && sessionStartTime) {
      const elapsed = Date.now() - sessionStartTime;
      const mins = Math.floor(elapsed / 60000);
      const secs = Math.floor((elapsed % 60000) / 1000);
      clockEl.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    }

    // Failure counter — gated by its own setting, hidden when off
    bar.classList.toggle('show-failures', !!settings.failureCount);
    if (failEl) {
      failEl.textContent = sessionFailureCount + ' fail' + (sessionFailureCount !== 1 ? 's' : '');
      failEl.classList.toggle('has-failures', sessionFailureCount > 0);
    }
  }

  // ===========================================================================
  // TOP TOOLS PANEL
  // ===========================================================================

  function renderTopTools() {
    const panel = document.getElementById('top-tools-panel');
    if (!panel) return;

    if (!settings.topTools || sessionByTool.size === 0) {
      panel.classList.remove('visible');
      panel.innerHTML = '';
      return;
    }

    const entries = Array.from(sessionByTool.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const max = entries[0][1];

    panel.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'top-tools-title';
    title.textContent = 'Top tools this session';
    panel.appendChild(title);

    for (const [name, count] of entries) {
      const row = document.createElement('div');
      row.className = 'top-tool-row';

      const color = getToolColor(name);
      const dot = document.createElement('span');
      dot.className = 'tool-dot';
      dot.style.background = color;

      const bar = document.createElement('div');
      bar.className = 'top-tool-bar';

      const fill = document.createElement('div');
      fill.className = 'top-tool-fill';
      fill.style.background = color;
      fill.style.width = (count / max) * 100 + '%';

      const nameEl = document.createElement('span');
      nameEl.className = 'top-tool-name';
      nameEl.textContent = cleanToolName(name);

      bar.appendChild(fill);
      bar.appendChild(nameEl);

      const countEl = document.createElement('span');
      countEl.className = 'top-tool-count';
      countEl.textContent = String(count);

      row.appendChild(dot);
      row.appendChild(bar);
      row.appendChild(countEl);
      panel.appendChild(row);
    }

    panel.classList.add('visible');
  }

  // ===========================================================================
  // DOM REFERENCES
  // ===========================================================================

  const feed = document.getElementById('event-feed');
  const emptyState = document.getElementById('empty-state');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const sessionIndicator = document.getElementById('session-indicator');

  // Auto-scroll tracking
  let userScrolledUp = false;

  feed.addEventListener('scroll', function () {
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 50;
    userScrolledUp = !nearBottom;
  });

  function scrollToBottom() {
    if (!userScrolledUp) {
      feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
    }
  }

  // Cap DOM nodes to prevent memory growth during long sessions
  const MAX_FEED_ITEMS = 500;

  function pruneOldCards() {
    while (feed.children.length > MAX_FEED_ITEMS) {
      feed.removeChild(feed.firstChild);
    }
  }

  // ===========================================================================
  // SESSION MARKERS
  // ===========================================================================

  function createSessionMarker(text) {
    const marker = document.createElement('div');
    marker.className = 'session-marker';
    marker.innerHTML =
      '<div class="session-marker-line"></div>' +
      '<span class="session-marker-text">' + text + '</span>' +
      '<div class="session-marker-line"></div>';
    return marker;
  }

  // ===========================================================================
  // EVENT CARD BUILDER
  // ===========================================================================

  function createEventCard(event) {
    const color = getToolColor(event.tool_name);
    const card = document.createElement('div');
    card.className = 'event-card';
    card.style.borderLeftColor = color;

    if (event.tool_use_id) {
      card.dataset.toolUseId = event.tool_use_id;
    }

    // ---- Header row ----
    const header = document.createElement('div');
    header.className = 'event-header';

    // Sequence number
    if (settings.sequenceNumbers && event.event === 'PreToolUse') {
      toolSequence++;
      const seqEl = document.createElement('span');
      seqEl.className = 'sequence-num';
      seqEl.textContent = '#' + toolSequence;
      header.appendChild(seqEl);
    }

    // Color dot
    const dot = document.createElement('span');
    dot.className = 'tool-dot';
    dot.style.backgroundColor = color;
    header.appendChild(dot);

    // Tool name
    const name = document.createElement('span');
    name.className = 'tool-name';
    name.textContent = cleanToolName(event.tool_name) || event.event;
    name.style.color = color;
    header.appendChild(name);

    // MCP server label
    if (settings.mcpLabels) {
      const mcpServer = extractMcpServer(event.tool_name);
      if (mcpServer) {
        const label = document.createElement('span');
        label.className = 'mcp-label';
        label.textContent = mcpServer;
        header.appendChild(label);
      }
    }

    // Meta section (right side)
    const meta = document.createElement('div');
    meta.className = 'event-meta';

    // Running indicator (for PreToolUse)
    if (event.event === 'PreToolUse') {
      card.classList.add('running');
      const indicator = document.createElement('span');
      indicator.className = 'running-indicator';
      indicator.style.backgroundColor = color;
      meta.appendChild(indicator);
    }

    // Result size badge (filled on PostToolUse)
    const sizeBadge = document.createElement('span');
    sizeBadge.className = 'result-size-badge';
    meta.appendChild(sizeBadge);

    // Duration badge (live timer or filled on PostToolUse)
    const durationBadge = document.createElement('span');
    durationBadge.className = 'duration-badge';
    durationBadge.style.display = 'none';
    meta.appendChild(durationBadge);

    // Live timer for PreToolUse
    if (event.event === 'PreToolUse' && settings.liveTimer) {
      const startTime = Date.now();
      durationBadge.textContent = '0ms';
      durationBadge.style.display = '';
      durationBadge.classList.add('live');
      card._timerInterval = setInterval(function () {
        durationBadge.textContent = formatDuration(Date.now() - startTime);
      }, 100);
    }

    // Timestamp
    const time = document.createElement('span');
    time.className = 'timestamp';
    time.textContent = formatTime(event.timestamp);
    meta.appendChild(time);

    header.appendChild(meta);
    card.appendChild(header);

    // ---- Smart summary line ----
    if (settings.smartSummaries && event.tool_input) {
      const summary = formatSmartInput(event.tool_name, event.tool_input);
      if (summary) {
        const summaryEl = document.createElement('div');
        summaryEl.className = 'smart-summary';
        // Bash commands get special styling
        if (cleanToolName(event.tool_name) === 'Bash') {
          summaryEl.classList.add('bash-cmd');
        }
        summaryEl.textContent = summary;
        summaryEl.title = summary; // Full text on hover
        card.appendChild(summaryEl);
      }
    }

    // ---- Working directory ----
    if (settings.workingDirectory && event.cwd) {
      const cwdEl = document.createElement('div');
      cwdEl.className = 'cwd-display';
      cwdEl.textContent = 'cwd: ' + event.cwd;
      card.appendChild(cwdEl);
    }

    // ---- Expandable detail section (raw JSON) ----
    const detail = document.createElement('div');
    detail.className = 'event-detail';

    if (event.tool_input) {
      const inputSection = document.createElement('div');
      inputSection.className = 'detail-section';

      const inputLabel = document.createElement('div');
      inputLabel.className = 'detail-label';
      inputLabel.textContent = 'Input';

      const inputContent = document.createElement('div');
      inputContent.className = 'detail-content';
      const inputData = truncate(event.tool_input);
      inputContent.textContent = inputData.text;

      inputSection.appendChild(inputLabel);
      inputSection.appendChild(inputContent);

      if (inputData.truncated) {
        const notice = document.createElement('div');
        notice.className = 'truncated-notice';
        notice.textContent = '... truncated';
        inputSection.appendChild(notice);
      }

      detail.appendChild(inputSection);
    }

    // Click header to toggle detail
    header.addEventListener('click', function () {
      detail.classList.toggle('expanded');
    });

    card.appendChild(detail);

    // Track session stats
    if (event.event === 'PreToolUse') {
      sessionToolCount++;
      if (event.tool_name) {
        sessionByTool.set(event.tool_name, (sessionByTool.get(event.tool_name) || 0) + 1);
      }
      updateSessionStatsDisplay();
      renderTopTools();
    }

    return card;
  }

  // ===========================================================================
  // UPDATE CARD WITH POST-TOOL DATA
  // ===========================================================================

  function updateCardWithResult(card, event) {
    // Stop live timer
    if (card._timerInterval) {
      clearInterval(card._timerInterval);
      card._timerInterval = null;
    }

    // Remove running state
    card.classList.remove('running');

    // Mark failures
    if (event.event === 'PostToolUseFailure') {
      card.classList.add('failure');
      sessionFailureCount++;
      updateSessionStatsDisplay();
    }

    // Update duration badge
    const durationBadge = card.querySelector('.duration-badge');
    if (durationBadge) {
      durationBadge.classList.remove('live');
      if (event.duration_ms != null) {
        durationBadge.textContent = formatDuration(event.duration_ms);
        durationBadge.style.display = '';
        // Track total duration
        sessionTotalDuration += event.duration_ms;
        updateSessionStatsDisplay();
      }
    }

    // Remove running indicator
    const indicator = card.querySelector('.running-indicator');
    if (indicator) indicator.remove();

    // Result size badge
    if (settings.resultSize && event.tool_result) {
      const sizeText = parseResultSize(event.tool_result);
      if (sizeText) {
        const sizeBadge = card.querySelector('.result-size-badge');
        if (sizeBadge) {
          sizeBadge.textContent = sizeText;
          sizeBadge.style.display = '';
        }
      }
    }

    // Result preview (smart first-line summary)
    if (settings.resultPreviews && event.tool_result) {
      const preview = formatSmartResult(event.tool_result);
      if (preview) {
        const previewEl = document.createElement('div');
        previewEl.className = 'result-preview';
        previewEl.textContent = preview;
        previewEl.title = preview;
        // Insert before the detail section
        const detail = card.querySelector('.event-detail');
        if (detail) {
          card.insertBefore(previewEl, detail);
        } else {
          card.appendChild(previewEl);
        }
      }
    }

    // Add result to expandable detail section
    if (event.tool_result) {
      const detail = card.querySelector('.event-detail');
      if (detail) {
        const resultSection = document.createElement('div');
        resultSection.className = 'detail-section';

        const resultLabel = document.createElement('div');
        resultLabel.className = 'detail-label';
        resultLabel.textContent = 'Result';

        const resultContent = document.createElement('div');
        resultContent.className = 'detail-content';
        const resultData = truncate(event.tool_result);
        resultContent.textContent = resultData.text;

        resultSection.appendChild(resultLabel);
        resultSection.appendChild(resultContent);

        if (resultData.truncated) {
          const notice = document.createElement('div');
          notice.className = 'truncated-notice';
          notice.textContent = '... truncated';
          resultSection.appendChild(notice);
        }

        detail.appendChild(resultSection);
      }
    }
  }

  // ===========================================================================
  // EVENT HANDLER
  // ===========================================================================

  function handleEvent(event) {
    // Remove empty state on first event
    if (emptyState && emptyState.parentNode) {
      emptyState.remove();
    }

    // Session Start
    if (event.event === 'SessionStart') {
      feed.appendChild(createSessionMarker('Session Started'));
      sessionIndicator.textContent = 'Session ' + (event.session_id || '').slice(0, 8);
      resetSessionStats();
      scrollToBottom();
      return;
    }

    // Session End
    if (event.event === 'SessionEnd') {
      feed.appendChild(createSessionMarker('Session Ended'));
      sessionIndicator.textContent = '';
      if (sessionClockInterval) {
        clearInterval(sessionClockInterval);
        sessionClockInterval = null;
      }
      scrollToBottom();
      return;
    }

    // Stop (response complete)
    if (event.event === 'Stop') {
      feed.appendChild(createSessionMarker('Response Complete'));
      scrollToBottom();
      return;
    }

    // Notification
    if (event.event === 'Notification') {
      feed.appendChild(createSessionMarker('Notification'));
      scrollToBottom();
      return;
    }

    // PreToolUse — create a new card
    if (event.event === 'PreToolUse') {
      const card = createEventCard(event);
      feed.appendChild(card);
      pruneOldCards();
      scrollToBottom();
      // Canvas bloom + audio
      if (event.tool_name) {
        window.AmbientCanvas.triggerBloom(event.tool_name);
        if (window.AmbientAudio) {
          window.AmbientAudio.playToolSound(event.tool_name);
        }
      }
      return;
    }

    // PostToolUse / PostToolUseFailure — update matching card
    if (event.event === 'PostToolUse' || event.event === 'PostToolUseFailure') {
      let matchingCard = null;
      if (event.tool_use_id) {
        // Safe lookup: avoid CSS selector injection from tool_use_id
        const cards = feed.querySelectorAll('.event-card[data-tool-use-id]');
        for (let i = cards.length - 1; i >= 0; i--) {
          if (cards[i].dataset.toolUseId === event.tool_use_id) {
            matchingCard = cards[i];
            break;
          }
        }
      }

      if (matchingCard) {
        updateCardWithResult(matchingCard, event);
      } else {
        // No matching PreToolUse — create standalone card
        const card = createEventCard(event);
        if (event.event === 'PostToolUseFailure') card.classList.add('failure');
        if (event.duration_ms != null) {
          const badge = card.querySelector('.duration-badge');
          if (badge) {
            badge.textContent = formatDuration(event.duration_ms);
            badge.style.display = '';
          }
        }
        feed.appendChild(card);
      }
      scrollToBottom();
      return;
    }

    // SubagentStart
    if (event.event === 'SubagentStart') {
      feed.appendChild(createSessionMarker('Subagent Started'));
      if (event.tool_name) window.AmbientCanvas.triggerBloom('Agent');
      scrollToBottom();
      return;
    }

    // SubagentStop
    if (event.event === 'SubagentStop') {
      feed.appendChild(createSessionMarker('Subagent Finished'));
      scrollToBottom();
      return;
    }

    // Fallback: unknown event type
    const card = createEventCard(event);
    feed.appendChild(card);
    scrollToBottom();
  }

  // ===========================================================================
  // SSE CONNECTION
  // ===========================================================================

  function connect() {
    const evtSource = new EventSource('/stream');

    evtSource.onopen = function () {
      statusDot.className = 'connected';
      statusText.textContent = 'Connected';
    };

    evtSource.onmessage = function (e) {
      try {
        var event = JSON.parse(e.data);
        handleEvent(event);
      } catch {
        // Bad data — ignore
      }
    };

    evtSource.onerror = function () {
      statusDot.className = 'reconnecting';
      statusText.textContent = 'Reconnecting...';
    };
  }

  // ===========================================================================
  // AUDIO TOGGLE
  // ===========================================================================

  var audioBtn = document.getElementById('audio-toggle');
  var audioIcon = document.getElementById('audio-icon');
  var audioLabel = document.getElementById('audio-label');

  if (audioBtn && window.AmbientAudio) {
    audioBtn.addEventListener('click', function () {
      if (!window.AmbientAudio.isReady()) {
        window.AmbientAudio.init();
        audioBtn.classList.add('active');
        audioIcon.innerHTML = '&#9835;';
        audioLabel.textContent = 'Audio On';
      } else {
        var muted = window.AmbientAudio.toggleMute();
        if (muted) {
          audioBtn.classList.remove('active');
          audioBtn.classList.add('muted');
          audioIcon.innerHTML = '&#9834;';
          audioLabel.textContent = 'Muted';
        } else {
          audioBtn.classList.remove('muted');
          audioBtn.classList.add('active');
          audioIcon.innerHTML = '&#9835;';
          audioLabel.textContent = 'Audio On';
        }
      }
    });
  }

  // ===========================================================================
  // INITIALIZE
  // ===========================================================================

  buildSettingsPanel();
  updateSessionStatsDisplay();
  renderTopTools();
  connect();

})();
