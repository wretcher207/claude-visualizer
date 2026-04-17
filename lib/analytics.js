'use strict';

/*
 * Historical analytics aggregator for claude-visualizer.
 *
 * Streams the daily JSONL logs that server.js writes and produces compact
 * aggregates suitable for the dashboard. Each daily file is parsed once and
 * cached by (mtimeMs, size) — today's file reparses only when it grows, and
 * yesterday's files hit the cache forever after rollover.
 *
 * Zero dependencies. Pure Node stdlib.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const LOG_DIR = path.join(__dirname, '..', 'logs');

const FILE_RE = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/;

// Cache: filepath -> { key: 'mtimeMs:size', result: DailyAggregate }
const fileCache = new Map();

// Debounce: filepath -> { at: ms, result: DailyAggregate }
const inflightCache = new Map();
const DEBOUNCE_MS = 2000;

function listLogFiles() {
  let entries;
  try {
    entries = fs.readdirSync(LOG_DIR);
  } catch {
    return [];
  }
  const out = [];
  for (const name of entries) {
    const m = FILE_RE.exec(name);
    if (!m) continue;
    out.push({ date: m[1], path: path.join(LOG_DIR, name) });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

function emptyDaily(date) {
  return {
    date,
    totalEvents: 0,
    toolCalls: 0,
    failures: 0,
    totalDurationMs: 0,
    sessionIds: new Set(),
    byTool: Object.create(null),
    bySession: Object.create(null),
    byHour: new Array(24).fill(0),
    byDayHour: Object.create(null),
    errors: [],
  };
}

function ensureToolBucket(agg, name) {
  let b = agg.byTool[name];
  if (!b) {
    b = {
      count: 0,
      totalMs: 0,
      failures: 0,
      durations: [],
      maxMs: 0,
    };
    agg.byTool[name] = b;
  }
  return b;
}

function ensureSessionBucket(agg, sid) {
  let b = agg.bySession[sid];
  if (!b) {
    b = {
      sessionId: sid,
      firstTs: null,
      lastTs: null,
      toolCount: 0,
      totalMs: 0,
      failures: 0,
      cwds: new Set(),
      byTool: Object.create(null),
    };
    agg.bySession[sid] = b;
  }
  return b;
}

function ingest(agg, e) {
  agg.totalEvents++;

  const ts = e.timestamp ? new Date(e.timestamp) : null;
  if (ts && !isNaN(ts.getTime())) {
    const hour = ts.getHours();
    agg.byHour[hour]++;
    const dow = ts.getDay();
    const key = dow + ':' + hour;
    agg.byDayHour[key] = (agg.byDayHour[key] || 0) + 1;
  }

  if (e.session_id) agg.sessionIds.add(e.session_id);

  const sessionBucket = e.session_id ? ensureSessionBucket(agg, e.session_id) : null;
  if (sessionBucket && ts) {
    if (!sessionBucket.firstTs || ts < sessionBucket.firstTs) sessionBucket.firstTs = ts;
    if (!sessionBucket.lastTs || ts > sessionBucket.lastTs) sessionBucket.lastTs = ts;
    if (e.cwd) sessionBucket.cwds.add(e.cwd);
  }

  if (e.event === 'PreToolUse' && e.tool_name) {
    agg.toolCalls++;
    const bucket = ensureToolBucket(agg, e.tool_name);
    bucket.count++;
    if (sessionBucket) {
      sessionBucket.toolCount++;
      sessionBucket.byTool[e.tool_name] = (sessionBucket.byTool[e.tool_name] || 0) + 1;
    }
    return;
  }

  if (e.event === 'PostToolUse' || e.event === 'PostToolUseFailure') {
    if (e.tool_name) {
      const bucket = ensureToolBucket(agg, e.tool_name);
      if (typeof e.duration_ms === 'number' && e.duration_ms >= 0) {
        bucket.totalMs += e.duration_ms;
        bucket.durations.push(e.duration_ms);
        if (e.duration_ms > bucket.maxMs) bucket.maxMs = e.duration_ms;
        agg.totalDurationMs += e.duration_ms;
        if (sessionBucket) sessionBucket.totalMs += e.duration_ms;
      }
      if (e.event === 'PostToolUseFailure') {
        bucket.failures++;
        agg.failures++;
        if (sessionBucket) sessionBucket.failures++;
        if (agg.errors.length < 200) {
          agg.errors.push({
            timestamp: e.timestamp,
            tool_name: e.tool_name,
            error: shortError(e),
            session_id: e.session_id || null,
          });
        }
      }
    }
    return;
  }
}

function shortError(e) {
  if (typeof e.error === 'string' && e.error) return truncate(e.error, 300);
  if (e.error && typeof e.error === 'object') return truncate(JSON.stringify(e.error), 300);
  if (typeof e.tool_result === 'string' && e.tool_result) return truncate(e.tool_result, 300);
  return null;
}

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n) + '...' : s;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function finalizeDaily(agg) {
  // Per-tool percentile stats, then discard raw duration arrays
  for (const name of Object.keys(agg.byTool)) {
    const b = agg.byTool[name];
    const sorted = b.durations.slice().sort((x, y) => x - y);
    b.avgMs = b.count ? Math.round(b.totalMs / b.count) : 0;
    b.p50Ms = percentile(sorted, 0.5);
    b.p95Ms = percentile(sorted, 0.95);
    b.failureRate = b.count ? b.failures / b.count : 0;
    delete b.durations;
  }

  // Convert session Sets to arrays for JSON-serialization
  const sessions = {};
  for (const sid of Object.keys(agg.bySession)) {
    const s = agg.bySession[sid];
    const topTools = Object.entries(s.byTool)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([n, c]) => ({ name: n, count: c }));
    sessions[sid] = {
      sessionId: s.sessionId,
      firstTs: s.firstTs ? s.firstTs.toISOString() : null,
      lastTs: s.lastTs ? s.lastTs.toISOString() : null,
      durationMs: s.firstTs && s.lastTs ? s.lastTs - s.firstTs : 0,
      toolCount: s.toolCount,
      totalMs: s.totalMs,
      failures: s.failures,
      cwds: Array.from(s.cwds),
      topTools,
    };
  }
  agg.bySession = sessions;
  agg.sessionCount = agg.sessionIds.size;
  delete agg.sessionIds;

  return agg;
}

async function aggregateFile(filepath) {
  let stat;
  try {
    stat = await fs.promises.stat(filepath);
  } catch {
    return null;
  }

  const cacheKey = stat.mtimeMs + ':' + stat.size;
  const hit = fileCache.get(filepath);
  if (hit && hit.key === cacheKey) return hit.result;

  // Debounce: if we reparsed this file within 2 seconds, serve the prior result
  const infl = inflightCache.get(filepath);
  if (infl && Date.now() - infl.at < DEBOUNCE_MS) return infl.result;

  const m = FILE_RE.exec(path.basename(filepath));
  const date = m ? m[1] : 'unknown';
  const agg = emptyDaily(date);

  const stream = fs.createReadStream(filepath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    ingest(agg, e);
  }

  finalizeDaily(agg);
  fileCache.set(filepath, { key: cacheKey, result: agg });
  inflightCache.set(filepath, { at: Date.now(), result: agg });
  return agg;
}

function dateNDaysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function parseDays(val, fallback) {
  const n = parseInt(val, 10);
  if (Number.isFinite(n) && n > 0 && n <= 3650) return n;
  return fallback;
}

async function aggregateRange(days) {
  const d = parseDays(days, 30);
  const start = dateNDaysAgo(d - 1);
  const end = today();
  const files = listLogFiles().filter(f => f.date >= start && f.date <= end);

  const dailies = await Promise.all(files.map(f => aggregateFile(f.path)));
  return {
    start,
    end,
    days: d,
    dailies: dailies.filter(Boolean),
  };
}

// ---- Public API: response shapers ----

async function getSummary(days) {
  const { start, end, dailies } = await aggregateRange(days);

  let totalSessions = 0;
  let totalTools = 0;
  let totalFailures = 0;
  let totalDurationMs = 0;
  const byTool = Object.create(null);
  const byHour = new Array(24).fill(0);
  const byDate = [];
  let busiestDay = null;
  const sessionIds = new Set();

  for (const d of dailies) {
    totalTools += d.toolCalls;
    totalFailures += d.failures;
    totalDurationMs += d.totalDurationMs;

    for (const sid of Object.keys(d.bySession)) sessionIds.add(sid);

    for (let h = 0; h < 24; h++) byHour[h] += d.byHour[h];

    for (const name of Object.keys(d.byTool)) {
      const src = d.byTool[name];
      const dst = byTool[name] || (byTool[name] = { count: 0, totalMs: 0, failures: 0 });
      dst.count += src.count;
      dst.totalMs += src.totalMs;
      dst.failures += src.failures;
    }

    byDate.push({
      date: d.date,
      count: d.toolCalls,
      durationMs: d.totalDurationMs,
      failures: d.failures,
    });
    if (!busiestDay || d.toolCalls > busiestDay.count) {
      busiestDay = { date: d.date, count: d.toolCalls };
    }
  }

  totalSessions = sessionIds.size;

  let busiestHour = 0;
  for (let h = 1; h < 24; h++) if (byHour[h] > byHour[busiestHour]) busiestHour = h;

  const topTools = Object.entries(byTool)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, v]) => ({ name, count: v.count }));

  return {
    start,
    end,
    totalSessions,
    totalTools,
    totalFailures,
    totalDurationMs,
    failureRate: totalTools ? totalFailures / totalTools : 0,
    activeDays: dailies.length,
    busiestDay,
    busiestHour,
    topTools,
    byDate,
  };
}

async function getToolBreakdown(days) {
  const { dailies } = await aggregateRange(days);
  const merged = Object.create(null);

  for (const d of dailies) {
    for (const name of Object.keys(d.byTool)) {
      const src = d.byTool[name];
      const dst = merged[name] || (merged[name] = {
        name,
        count: 0,
        totalMs: 0,
        failures: 0,
        maxMs: 0,
        // Keep running approximations; true percentiles require full data, so we
        // weight-average the daily p50/p95. Good enough for a dashboard.
        p50Weighted: 0,
        p95Weighted: 0,
        weight: 0,
      });
      dst.count += src.count;
      dst.totalMs += src.totalMs;
      dst.failures += src.failures;
      if (src.maxMs > dst.maxMs) dst.maxMs = src.maxMs;
      dst.p50Weighted += (src.p50Ms || 0) * src.count;
      dst.p95Weighted += (src.p95Ms || 0) * src.count;
      dst.weight += src.count;
    }
  }

  const tools = Object.values(merged).map(t => ({
    name: t.name,
    count: t.count,
    totalMs: t.totalMs,
    avgMs: t.count ? Math.round(t.totalMs / t.count) : 0,
    p50Ms: t.weight ? Math.round(t.p50Weighted / t.weight) : 0,
    p95Ms: t.weight ? Math.round(t.p95Weighted / t.weight) : 0,
    maxMs: t.maxMs,
    failures: t.failures,
    failureRate: t.count ? t.failures / t.count : 0,
  }));

  tools.sort((a, b) => b.count - a.count);
  return { tools };
}

async function getSessions(days, limit) {
  const { dailies } = await aggregateRange(days);
  const lim = Math.min(parseInt(limit, 10) || 50, 200);

  const sessions = [];
  for (const d of dailies) {
    for (const sid of Object.keys(d.bySession)) {
      sessions.push(Object.assign({ date: d.date }, d.bySession[sid]));
    }
  }
  sessions.sort((a, b) => (a.lastTs < b.lastTs ? 1 : -1));
  return { sessions: sessions.slice(0, lim) };
}

async function getHeatmap(days) {
  const { dailies } = await aggregateRange(days);
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const d of dailies) {
    for (const key of Object.keys(d.byDayHour)) {
      const [dow, hour] = key.split(':').map(Number);
      grid[dow][hour] += d.byDayHour[key];
    }
  }
  return { grid };
}

async function getErrors(days, limit) {
  const { dailies } = await aggregateRange(days);
  const lim = Math.min(parseInt(limit, 10) || 100, 500);

  const errors = [];
  for (const d of dailies) {
    for (const err of d.errors) errors.push(err);
  }
  errors.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return { errors: errors.slice(0, lim) };
}

async function getTimeline(date) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { minutes: [] };
  const filepath = path.join(LOG_DIR, 'events-' + date + '.jsonl');
  if (!fs.existsSync(filepath)) return { minutes: [] };

  const buckets = Object.create(null);
  const stream = fs.createReadStream(filepath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.event !== 'PreToolUse') continue;
    const ts = new Date(e.timestamp);
    if (isNaN(ts.getTime())) continue;
    const minuteKey = ts.getHours() * 60 + ts.getMinutes();
    buckets[minuteKey] = (buckets[minuteKey] || 0) + 1;
  }

  const minutes = [];
  for (let m = 0; m < 24 * 60; m++) {
    minutes.push({ t: m, count: buckets[m] || 0 });
  }
  return { minutes };
}

module.exports = {
  getSummary,
  getToolBreakdown,
  getSessions,
  getHeatmap,
  getErrors,
  getTimeline,
};
