import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoverCache } from '../services/coverCacheCore.mjs';

function makeStorage() {
  const map = new Map();
  return {
    map,
    getItem: async (k) => (map.has(k) ? map.get(k) : null),
    setItem: async (k, v) => { map.set(k, v); },
  };
}

const STORAGE_KEY = '@my-music-player/pic-cache-v1';

test('成功 URL 被缓存，且只调用一次 fetcher', async () => {
  const cc = createCoverCache({ storage: makeStorage(), now: () => 1000, failTtl: 90000 });
  let calls = 0;
  const f = async () => { calls += 1; return 'http://img/1'; };
  assert.equal(await cc.resolve('k1', f), 'http://img/1');
  assert.equal(cc.cached('k1'), 'http://img/1');
  assert.equal(await cc.resolve('k1', f), 'http://img/1');
  assert.equal(calls, 1, '命中缓存后不应再次请求');
});

test('成功 URL 落盘，软失败不落盘', async () => {
  const store = makeStorage();
  const cc = createCoverCache({ storage: store, now: () => 1000, failTtl: 90000 });
  let calls = 0;
  const f = async () => { calls += 1; return null; };
  await cc.resolve('failk', f);
  cc.flush();
  const saved = JSON.parse(store.map.get(STORAGE_KEY) || '{}');
  assert.equal(saved.failk, undefined, '软失败不应写入磁盘');
  assert.equal(calls, 1);
});

test('软失败未过期不重试，过期后允许重试', async () => {
  const store = makeStorage();
  let t = 1000;
  const cc = createCoverCache({ storage: store, now: () => t, failTtl: 5000 });
  let calls = 0;
  const f = async () => { calls += 1; return null; };
  await cc.resolve('fk', f);
  assert.equal(cc.cached('fk'), null, '软失败期间视为拿不到');
  await cc.resolve('fk', f); // 未过期
  assert.equal(calls, 1, '未过期不应重试');
  t = 1000 + 6000; // 超过 ttl
  await cc.resolve('fk', f);
  assert.equal(calls, 2, '过期后允许重试');
});

test('并发同一 key 只发起一次 fetcher', async () => {
  const cc = createCoverCache({ storage: makeStorage(), now: () => 1, failTtl: 90000 });
  let calls = 0;
  const f = () => new Promise((res) => setTimeout(() => { calls += 1; res('u'); }, 20));
  const [a, b, c] = await Promise.all([cc.resolve('dup', f), cc.resolve('dup', f), cc.resolve('dup', f)]);
  assert.equal(calls, 1, '去重：同一 key 只请求一次');
  assert.equal(a, 'u');
  assert.equal(b, 'u');
  assert.equal(c, 'u');
});

test('prefetch 只解析未缓存项', async () => {
  const cc = createCoverCache({ storage: makeStorage(), now: () => 1, failTtl: 90000 });
  let calls = 0;
  const f = async () => { calls += 1; return 'u' + calls; };
  await cc.prefetch([{ key: 'p1', fetcher: f }, { key: 'p2', fetcher: f }]);
  assert.equal(calls, 2);
  await cc.prefetch([{ key: 'p1', fetcher: f }, { key: 'p2', fetcher: f }]);
  assert.equal(calls, 2, '已缓存的 key 不应重复请求');
});

test('force 可绕过未过期的软失败重新解析', async () => {
  const cc = createCoverCache({ storage: makeStorage(), now: () => 1, failTtl: 90000 });
  let calls = 0;
  const ok = async () => { calls += 1; return calls === 1 ? null : 'Recovered'; };
  await cc.resolve('fk', ok); // 第一次失败 -> 软失败
  assert.equal(cc.cached('fk'), null);
  const r = await cc.resolve('fk', ok, { force: true });
  assert.equal(calls, 2, 'force 应触发一次重试');
  assert.equal(r, 'Recovered');
  assert.equal(cc.cached('fk'), 'Recovered');
});

test('AbortController 超时会把请求降级为软失败', async () => {
  let t = 0;
  const cc = createCoverCache({ storage: makeStorage(), now: () => t, failTtl: 90000, timeoutMs: 30 });
  const f = async ({ signal }) => new Promise((_res, _rej) => {
    const timer = setTimeout(() => { _res('too-late'); }, 200);
    signal.addEventListener('abort', () => { clearTimeout(timer); _rej(new Error('aborted')); });
  });
  const r = await cc.resolve('slow', f);
  assert.equal(r, null, '超时请求应降级为软失败');
  assert.equal(cc.cached('slow'), null);
});
