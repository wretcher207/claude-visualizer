'use strict';

/*
 * Token usage aggregator. Streams Claude Code's transcript files at
 * ~/.claude/projects/** /*.jsonl and extracts per-assistant-message usage:
 *   input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
 *
 * Per-file cache keyed by (mtimeMs, size) so today's growing transcripts
 * reparse cheaply and yesterday's files hit the cache forever.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

const fileCache = new Map();

function listTranscripts() {
  const out = [];
  let top;
  try { top = fs.readdirSync(PROJECTS_DIR); } catch { return out; }
  for (const name of top) {
    const full = path.join(PROJECTS_DIR, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.isDirectory()) walk(full, out);
  }
  return out;
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const full = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(full); } catch { continue; }
    if (stat.isDirectory()) walk(full, out);
    else if (name.endsWith('.jsonl')) out.push(full);
  }
}

async function parseFile(fp) {
  let stat;
  try { stat = await fs.promises.stat(fp); } catch { return []; }
  const key = stat.mtimeMs + ':' + stat.size;
  const hit = fileCache.get(fp);
  if (hit && hit.key === key) return hit.result;

  const records = [];
  const stream = fs.createReadStream(fp, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.type !== 'assistant') continue;
    const msg = r.message || {};
    const u = msg.usage;
    if (!u) continue;
    records.push({
      timestamp: r.timestamp,
      sessionId: r.sessionId || null,
      cwd: r.cwd || null,
      model: msg.model || 'unknown',
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cacheCreate: u.cache_creation_input_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      stopReason: msg.stop_reason || null,
    });
  }
  fileCache.set(fp, { key, result: records });
  return records;
}

async function allRecords() {
  const files = listTranscripts();
  const batches = await Promise.all(files.map(parseFile));
  const out = [];
  for (const b of batches) for (const r of b) out.push(r);
  out.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  return out;
}

function emptyBucket() {
  return { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, messages: 0 };
}

function addUsage(b, r) {
  b.input += r.input;
  b.output += r.output;
  b.cacheCreate += r.cacheCreate;
  b.cacheRead += r.cacheRead;
  b.messages += 1;
}

function totalOf(b) {
  return b.input + b.output + b.cacheCreate + b.cacheRead;
}

function withTotal(b) {
  return Object.assign({ total: totalOf(b) }, b);
}

function dayKey(iso) {
  return (iso || '').slice(0, 10);
}

function daysAgoISO(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function getSummary() {
  const records = await allRecords();

  const byDate = Object.create(null);
  const bySession = Object.create(null);
  const byModel = Object.create(null);
  const byCwd = Object.create(null);
  const overall = emptyBucket();
  let biggestCall = null;

  for (const r of records) {
    addUsage(overall, r);

    const d = dayKey(r.timestamp);
    const db = byDate[d] || (byDate[d] = emptyBucket());
    addUsage(db, r);

    if (r.sessionId) {
      let sb = bySession[r.sessionId];
      if (!sb) {
        sb = Object.assign({ sessionId: r.sessionId, cwd: r.cwd, firstTs: r.timestamp, lastTs: r.timestamp }, emptyBucket());
        bySession[r.sessionId] = sb;
      }
      addUsage(sb, r);
      if (!sb.firstTs || r.timestamp < sb.firstTs) sb.firstTs = r.timestamp;
      if (!sb.lastTs || r.timestamp > sb.lastTs) sb.lastTs = r.timestamp;
      if (r.cwd && !sb.cwd) sb.cwd = r.cwd;
    }

    const mb = byModel[r.model] || (byModel[r.model] = emptyBucket());
    addUsage(mb, r);

    if (r.cwd) {
      const cb = byCwd[r.cwd] || (byCwd[r.cwd] = emptyBucket());
      addUsage(cb, r);
    }

    const t = r.input + r.output + r.cacheCreate + r.cacheRead;
    if (!biggestCall || t > (biggestCall.input + biggestCall.output + biggestCall.cacheCreate + biggestCall.cacheRead)) {
      biggestCall = r;
    }
  }

  // Rolling windows
  function sumRange(fromDate, toDate) {
    const b = emptyBucket();
    for (const d of Object.keys(byDate)) {
      if (d >= fromDate && d <= toDate) {
        const bb = byDate[d];
        b.input += bb.input;
        b.output += bb.output;
        b.cacheCreate += bb.cacheCreate;
        b.cacheRead += bb.cacheRead;
        b.messages += bb.messages;
      }
    }
    return b;
  }

  const today = todayISO();
  const last7  = sumRange(daysAgoISO(6),  today);
  const prev7  = sumRange(daysAgoISO(13), daysAgoISO(7));
  const last30 = sumRange(daysAgoISO(29), today);
  const prev30 = sumRange(daysAgoISO(59), daysAgoISO(30));

  const dates = Object.keys(byDate).sort();
  let busiestDay = null;
  for (const d of dates) {
    const t = totalOf(byDate[d]);
    if (!busiestDay || t > busiestDay.total) {
      busiestDay = Object.assign({ date: d, total: t }, byDate[d]);
    }
  }

  const sessions = Object.values(bySession)
    .map(s => withTotal(s));
  sessions.sort((a, b) => b.total - a.total);
  const biggestSession = sessions[0] || null;

  const byDateArr = dates.map(d => Object.assign({ date: d }, withTotal(byDate[d])));

  const byModelArr = Object.entries(byModel)
    .map(([name, b]) => Object.assign({ model: name }, withTotal(b)))
    .sort((a, b) => b.total - a.total);

  const byCwdArr = Object.entries(byCwd)
    .map(([cwd, b]) => Object.assign({ cwd }, withTotal(b)))
    .sort((a, b) => b.total - a.total);

  return {
    overall: withTotal(overall),
    last7:  withTotal(last7),
    prev7:  withTotal(prev7),
    last30: withTotal(last30),
    prev30: withTotal(prev30),
    busiestDay,
    biggestSession: biggestSession ? {
      sessionId: biggestSession.sessionId,
      cwd: biggestSession.cwd,
      firstTs: biggestSession.firstTs,
      lastTs: biggestSession.lastTs,
      messages: biggestSession.messages,
      input: biggestSession.input,
      output: biggestSession.output,
      cacheCreate: biggestSession.cacheCreate,
      cacheRead: biggestSession.cacheRead,
      total: biggestSession.total,
    } : null,
    biggestCall: biggestCall ? {
      timestamp: biggestCall.timestamp,
      sessionId: biggestCall.sessionId,
      cwd: biggestCall.cwd,
      model: biggestCall.model,
      input: biggestCall.input,
      output: biggestCall.output,
      cacheCreate: biggestCall.cacheCreate,
      cacheRead: biggestCall.cacheRead,
      total: biggestCall.input + biggestCall.output + biggestCall.cacheCreate + biggestCall.cacheRead,
    } : null,
    byDate: byDateArr,
    byModel: byModelArr,
    byCwd: byCwdArr,
    topSessions: sessions.slice(0, 15),
  };
}

// Cool equivalents. All figures based on the 1 token ~= 0.75 English words rule.
// Output tokens feel most like "things Claude said," so that's the anchor for
// writing comparisons; cache + input + output for the raw volume.
function buildComparisons(s) {
  const output = s.overall.output;
  const all = s.overall.total;
  const wordsOut = Math.round(output * 0.75);

  return {
    // Writing landmarks (token figures assume ~0.75 words/token)
    novels:           output / 107000,        // avg 80k-word novel
    harryPotter:      output / 103000,        // HP & Sorcerer's Stone (77k words)
    warAndPeace:      output / 783000,        // 587k words
    lotrTrilogy:      output / 641000,        // 481k words
    bibleKJV:         output / 1044000,       // 783k words
    emails:           Math.floor(output / 130),         // avg short email ~100 words
    tweets:           Math.floor(output / 70),          // 280 chars ~ 70 tokens
    albumLyrics:      output / 4800,          // 12 tracks x ~300 words
    songLyrics:       Math.floor(output / 400),

    // Speech / reading time on output
    readingMinutes:   Math.round(wordsOut / 250),  // 250 wpm
    speakingMinutes:  Math.round(wordsOut / 150),  // 150 wpm

    // Raw volume (everything Claude processed, including cache replays)
    totalTokens:      all,
    outputWords:      wordsOut,
  };
}

async function getComparisons() {
  const s = await getSummary();
  return buildComparisons(s);
}

async function getByDate(days) {
  const s = await getSummary();
  const n = parseInt(days, 10) || 30;
  const from = daysAgoISO(n - 1);
  return { byDate: s.byDate.filter(d => d.date >= from) };
}

async function getTopSessions(limit) {
  const s = await getSummary();
  const lim = Math.min(parseInt(limit, 10) || 15, 100);
  return { sessions: s.topSessions.slice(0, lim) };
}

module.exports = {
  getSummary,
  getComparisons,
  getByDate,
  getTopSessions,
};
