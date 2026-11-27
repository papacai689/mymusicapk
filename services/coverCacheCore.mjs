// 封面缓存的纯逻辑核心，不依赖任何 React Native / Expo 模块，便于在 Node 下单测。
//
// 为什么独立成模块：
//   picCache 之前把「一次超时 / 一次 503」记成永久失败并落盘，导致某张封面第一次
//   没拿到就永远灰块（跨启动也灰）。这里改为「软失败」——带过期时间的失败，
//   过期后允许重试，并且软失败绝不写入落盘存储，只缓存成功 URL。
//
// 模块边界约定：
//   - 本文件不关心封面 URL 怎么来，fetcher 由外部注入；
//   - storage 只需实现 getItem(key):Promise<string|null> 与 setItem(key,string):Promise。
export function createCoverCache({
  storage,
  now = Date.now,
  failTtl = 90_000,
  maxEntries = 400,
  maxConcurrency = 8,
  timeoutMs = 8000,
}) {
  const STORAGE_KEY_CORE = '@my-music-player/pic-cache-v1';
  // key -> string(url) 成功 | {__fail:true, at:number} 软失败
  const cache = new Map();
  const inflight = new Map();
  let running = 0;
  const waiting = [];
  let dirty = false;
  let flushTimer = null;
  let pendingSince = 0;

  const isFail = (v) => v && typeof v === 'object' && v.__fail === true;
  const isExpired = (v) => isFail(v) && now() - v.at >= failTtl;

  // 并发限流：最多 maxConcurrency 个在飞，其余排队。
  function gate(job) {
    return new Promise((resolve, reject) => {
      const run = () => {
        running += 1;
        job().then(resolve, reject).finally(() => {
          running -= 1;
          const next = waiting.shift();
          if (next) next();
        });
      };
      if (running < maxConcurrency) run();
      else waiting.push(run);
    });
  }

  function persist() {
    if (!storage) return;
    const payload = {};
    for (const [key, value] of cache) {
      // 只落盘成功 URL；软失败是短暂的，不持久化。
      if (typeof value === 'string' && value) payload[key] = value;
    }
    storage.setItem(STORAGE_KEY_CORE, JSON.stringify(payload)).catch(() => {});
  }

  function scheduleFlush() {
    if (pendingSince && cache.size - pendingSince >= 12) {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      dirty = false;
      pendingSince = 0;
      persist();
      return;
    }
    if (flushTimer) return;
    if (!pendingSince) pendingSince = cache.size;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (!dirty) return;
      dirty = false;
      pendingSince = 0;
      persist();
    }, 1000);
  }

  // 成功：写入 URL 并标记脏；失败(null)：记为软失败，不落盘、不刷新已存在软失败的 at。
  function remember(key, value) {
    if (value) {
      cache.set(key, value);
      dirty = true;
      scheduleFlush();
    } else {
      const prev = cache.get(key);
      if (isFail(prev) && !isExpired(prev)) return; // 已有未过期软失败，避免重试风暴刷 TTL
      cache.set(key, { __fail: true, at: now() });
    }
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  function markReady(loaded) {
    loaded.forEach(([key, value]) => {
      if (typeof value === 'string' && value) cache.set(key, value);
    });
  }

  // 同步读：成功 URL 或 null（软失败未过期 / 缺失 / 已过期）。
  function cached(key) {
    const v = cache.get(key);
    if (v === undefined) return null;
    if (isFail(v)) return null; // 软失败一律视为「暂时拿不到」
    return v;
  }

  function resolve(key, fetcher, { force = false } = {}) {
    const existing = cache.get(key);
    if (typeof existing === 'string' && existing) return Promise.resolve(existing);
    if (!force && isFail(existing) && !isExpired(existing)) return Promise.resolve(null);
    const pending = inflight.get(key);
    if (pending) return pending;

    const task = gate(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const value = await fetcher({ signal: controller.signal });
        remember(key, value || null);
        return value || null;
      } catch (error) {
        remember(key, null);
        return null;
      } finally {
        clearTimeout(timer);
      }
    }).then((url) => {
      inflight.delete(key);
      return url;
    });

    inflight.set(key, task);
    return task;
  }

  // 批量预热：只对「没成功缓存 + 不在未过期软失败」的 key 发起请求。
  function prefetch(items) {
    const tasks = [];
    for (const { key, fetcher } of items) {
      const existing = cache.get(key);
      if (typeof existing === 'string' && existing) continue;
      if (!isFail(existing) || isExpired(existing)) {
        tasks.push(resolve(key, fetcher));
      }
    }
    return Promise.allSettled(tasks);
  }

  function flush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (!dirty) return;
    dirty = false;
    pendingSince = 0;
    persist();
  }

  function clear() {
    cache.clear();
    inflight.clear();
  }

  return { cached, resolve, prefetch, flush, clear, _cache: cache, _markReady: markReady, _failTtl: failTtl };
}
