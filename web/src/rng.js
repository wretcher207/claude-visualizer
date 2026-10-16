// Small seeded random generator so the demo plays the same way every time.

export function createRng(seed = 1) {
  let a = seed >>> 0;
  function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range(min, max) { return min + (max - min) * next(); },
    int(min, max) { return Math.floor(min + (max - min + 1) * next()); },
    chance(p) { return next() < p; },
    pick(list) { return list[Math.floor(next() * list.length)]; },
    // Skewed toward short values with an occasional long one, like human pauses.
    pause(min, typical, max) {
      const u = next();
      const v = min + (typical - min) * (-Math.log(1 - u * 0.95));
      return Math.min(max, v);
    },
  };
}
