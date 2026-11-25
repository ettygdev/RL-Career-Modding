'use strict';

function createLiquipediaCameraLookup(cacheFile, fs, fetcher = fetch, now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const endpoint = 'https://liquipedia.net/rocketleague/api.php';
  const agent = 'RLCareer-Overhaul/0.9.14 (https://github.com/ettygdev/RL-Career-Modding/issues; contact: ettygdev via GitHub)';
  const ranges = [[60, 110], [40, 200], [-45, 0], [100, 400], [0, 1], [1, 10], [1, 2]];
  const day = 24 * 60 * 60 * 1000;
  const key = name => name.trim().replace(/[ _]+/g, ' ').toLowerCase();
  const saved = new Map();
  let nextRequest = 0;
  let queue = Promise.resolve();
  const valid = values => Array.isArray(values) && values.length === ranges.length &&
    values.every((value, i) => Number.isFinite(value) && value >= ranges[i][0] && value <= ranges[i][1]);
  try {
    if (fs.statSync(cacheFile).size < 512 * 1024) {
      for (const [name, entry] of JSON.parse(fs.readFileSync(cacheFile, 'utf8'))) {
        if (typeof name === 'string' && Number.isFinite(entry?.expires) && entry.expires > now() &&
            (entry.settings === null || valid(entry.settings))) saved.set(name, entry);
      }
    }
  } catch { /* The cache is optional. */ }

  function parse(wikitext) {
    if (typeof wikitext !== 'string') return null;
    const templates = /\{\{\s*camera[ _]+settings[ _]+table\b/gi;
    let latest = '';
    let selected = null;
    for (const match of wikitext.matchAll(templates)) {
      let depth = 1;
      let start = match.index + match[0].length;
      const limit = Math.min(wikitext.length, start + 6000);
      const fields = new Map();
      const field = end => {
        const pair = wikitext.slice(start, end).match(/^\s*([\w _]+)\s*=\s*([^{}<>\r\n]*?)\s*$/);
        if (pair) fields.set(pair[1].replace(/[ _]/g, '').toLowerCase(), pair[2]);
      };
      for (let i = start; i < limit; i++) {
        const pair = wikitext.slice(i, i + 2);
        if (pair === '{{') { depth++; i++; }
        else if (pair === '}}') {
          if (--depth === 0) { field(i); break; }
          i++;
        } else if (wikitext[i] === '|' && depth === 1) {
          field(i);
          start = i + 1;
        }
      }
      if (depth !== 0) continue;
      const settings = ['fov', 'height', 'angle', 'distance', 'stiffness', 'swivelspeed', 'transitionspeed']
        .map(name => {
          const raw = fields.get(name);
          return /^-?\d+(?:[.,]\d+)?$/.test(raw || '') ? Number(raw.replace(',', '.')) : NaN;
        });
      const date = (fields.get('date') || '').split('-').map((part, i) => i ? part.padStart(2, '0') : part).join('-');
      if (valid(settings) && (!selected || date > latest)) { selected = settings; latest = date; }
    }
    return selected;
  }

  function persist() {
    for (const [name, entry] of saved) if (entry.expires <= now()) saved.delete(name);
    while (saved.size > 2000) saved.delete(saved.keys().next().value);
    try {
      fs.writeFileSync(cacheFile + '.tmp', JSON.stringify([...saved]), 'utf8');
      fs.renameSync(cacheFile + '.tmp', cacheFile);
    } catch { /* Keep the in-memory cache if the disk is unavailable. */ }
  }

  async function resolve(names) {
    const unique = [...new Map(names.filter(name => typeof name === 'string' &&
      /^[\p{L}\p{N} .'_-]{1,40}$/u.test(name)).map(name => [key(name), name])).values()].slice(0, 6);
    const missing = unique.filter(name => !saved.has(key(name)) || saved.get(key(name)).expires <= now());
    if (missing.length && now() >= nextRequest - 2100) {
      const delay = Math.max(0, nextRequest - now());
      if (delay) await wait(delay);
      nextRequest = now() + 2100;
      try {
        const query = new URLSearchParams({
          action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', format: 'json',
          formatversion: '2', redirects: '1', maxlag: '5', titles: missing.join('|')
        });
        const response = await fetcher(endpoint + '?' + query, {
          headers: { 'User-Agent': agent, 'Accept': 'application/json' },
          redirect: 'error', signal: AbortSignal.timeout(7000)
        });
        if (!response.ok) {
          const retry = Number(response.headers?.get('retry-after'));
          nextRequest = now() + Math.max(60000, Number.isFinite(retry) ? retry * 1000 : 0);
        } else {
          const json = await response.json();
          if (!Array.isArray(json.query?.pages)) throw new Error('Unexpected Liquipedia response');
          const aliases = new Map([...(json.query.normalized || []), ...(json.query.redirects || [])]
            .map(entry => [key(entry.from), key(entry.to)]));
          const pages = new Map(json.query.pages.map(page => [key(page.title), page]));
          for (const name of missing) {
            let canonical = key(name);
            for (let i = 0; i < 5 && aliases.has(canonical); i++) canonical = aliases.get(canonical);
            const page = pages.get(canonical);
            if (!page) continue;
            const settings = parse(page.revisions?.[0]?.slots?.main?.content);
            saved.set(key(name), { settings, expires: now() + (settings ? 30 : 7) * day });
          }
          persist();
        }
      } catch {
        nextRequest = now() + 60000;
      }
    }
    return new Map(unique.flatMap(name => {
      const entry = saved.get(key(name));
      return entry?.settings && entry.expires > now() ? [[name, entry.settings]] : [];
    }));
  }

  return names => {
    const result = queue.then(() => resolve(names));
    queue = result.catch(() => {});
    return result;
  };
}

module.exports = { createLiquipediaCameraLookup };
