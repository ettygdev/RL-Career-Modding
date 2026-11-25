'use strict';

function createThumbnailLoader(send, fetcher = fetch) {
  const origin = 'https://api.velocityrl.tech';
  const cache = new Map();
  const queue = [];
  let active = 0;
  const limit = 256 * 1024;
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
      if (!/^\/thumbnails\/[a-z0-9_-]+\.png$/i.test(json.thumbnail_url)) return { image: '', paints };
      const response = await fetcher(origin + json.thumbnail_url, options);
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
  function pump() {
    while (active < 4 && queue.length) {
      const { id, resolve } = queue.shift();
      active++;
      download(id).then(resolve).finally(() => { active--; pump(); });
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
