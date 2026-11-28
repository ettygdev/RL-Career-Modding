'use strict';

function createThumbnailLoader(send, fetcher = fetch) {
  const origin = 'https://api.velocityrl.tech';
  const cache = new Map();
  const queue = [];
  let active = 0;
  const limit = 256 * 1024;
  let garageCatalog;
  function normalize(value) {
    return String(value ?? '').replace(/^\(Alpha Reward\)\s*/i, '').replace(/\s*\(Alpha Reward\)$/i, '').trim().toLowerCase();
  }
  async function fallbackUrl(product, options) {
    if (!garageCatalog) {
      garageCatalog = fetcher('https://raw.githubusercontent.com/kaiserdj/rl-garage-assets/main/output/data.json', options)
        .then(response => response.ok ? response.json() : Promise.reject(new Error('Catalog unavailable')))
        .catch(() => { garageCatalog = undefined; return []; });
    }
    const name = normalize(product.name ?? product.Product);
    const category = normalize(product.category ?? product.Slot);
    const sameName = (await garageCatalog).filter(item => normalize(item.name) === name &&
      /^https:\/\/rocket-league\.com\/content\/media\/items\/avatar\/220px\/[a-z0-9]+\.png$/i.test(item.src || ''));
    const sameCategory = sameName.filter(item => normalize(item.Type) === category);
    const matches = sameCategory.length ? sameCategory : sameName;
    const urls = [...new Set(matches.map(item => item.src))];
    return urls.length === 1 ? urls[0] : '';
  }
  async function download(id) {
    let paints = null;
    try {
      const options = { redirect: 'error', signal: AbortSignal.timeout(6000) };
      const product = await fetcher(origin + '/v2/rl/products/' + id, options);
      if (!product.ok) return { image: '', paints };
      const json = await product.json();
      if (Number(json.id ?? json.ID) !== id) return { image: '', paints };
      if (json.Paintable === false) paints = [];
      else if (Array.isArray(json.Paints)) paints = json.Paints.map(paint => paint.label).filter(label => typeof label === 'string');
      const url = /^\/thumbnails\/[a-z0-9_-]+\.png$/i.test(json.thumbnail_url)
        ? origin + json.thumbnail_url
        : json.thumbnail_url == null && (json.name || json.Product) ? await fallbackUrl(json, options) : '';
      if (!url) return { image: '', paints };
      const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(6000) });
      if (!response.ok || !/^image\/png\b/i.test(response.headers.get('content-type') || '') ||
          Number(response.headers.get('content-length')) > limit || !response.body) return { image: '', paints };
      const parts = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) return { image: '', paints };
        parts.push(chunk);
      }
      const png = Buffer.concat(parts, size);
      if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return { image: '', paints };
      return { image: 'data:image/png;base64,' + png.toString('base64'), paints };
    } catch {
      return { image: '', paints };
    }
  }
  async function load(id) {
    if (fetcher !== fetch || !Number.isSafeInteger(id) || id < 0) return download(id);
    const fs = require('fs').promises;
    const path = require('path');
    const directory = path.join(process.env.LOCALAPPDATA || require('os').tmpdir(), 'RLCareer-Overhaul', 'thumbnails');
    const file = path.join(directory, id + '.json');
    try {
      const record = JSON.parse(await fs.readFile(file, 'utf8'));
      if (typeof record.image === 'string' && record.image.startsWith('data:image/png;base64,iVBOR')
          && record.image.length < limit * 1.4) return record;
    } catch {}
    const record = await download(id);
    if (record.image) {
      try {
        await fs.mkdir(directory, {recursive:true});
        const temp = file + '.' + process.pid + '.tmp';
        await fs.writeFile(temp, JSON.stringify(record));
        await fs.rename(temp, file);
      } catch {}
    }
    return record;
  }
  function pump() {
    while (active < 4 && queue.length) {
      const { id, resolve } = queue.shift();
      active++;
      load(id).then(result => { if (!result.image) cache.delete(id); resolve(result); }, () => { cache.delete(id); resolve({image:"", paints:null}); }).finally(() => { active--; pump(); });
    }
  }
  function get(id) {
    if (!cache.has(id)) {
      if (queue.length >= 48) return Promise.resolve({ image: '', paints: null });
      cache.set(id, new Promise(resolve => queue.push({ id, resolve })));
      if (cache.size > 128) cache.delete(cache.keys().next().value);
      pump();
    }
    return cache.get(id);
  }
  return async ids => {
    await Promise.all(ids.map(async id => {
      const { image, paints } = await get(id);
      if (!image && paints === null) return;
      try { await send(id, image, paints); } catch { /* The Hub window can be closed during download. */ }
    }));
  };
}

module.exports = { createThumbnailLoader };
