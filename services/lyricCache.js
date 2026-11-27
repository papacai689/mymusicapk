import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

// 歌词缓存：同一首歌在队列里来回切、切后台再回来，不该每次都重新请求。
// 实测 meting 歌词接口 0.26s / GD 1.36s，但再快也架不住每切一次歌就等一轮网络。
// 内存 LRU 管当次会话，AsyncStorage 落盘管跨启动；失败不落盘，下次允许重试。
const KEY = '@my-music-player/lyric-cache-v1';
const MAX = 120; // 歌词文本很小（1KB 左右），120 首也才 120KB
const cache = new Map(); // key -> { text, at }
const inflight = new Map(); // key -> Promise<string>

let ready = (async () => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) || {};
    Object.keys(obj).forEach((k) => {
      if (typeof obj[k] === 'string' && obj[k]) cache.set(k, { text: obj[k], at: Date.now() });
    });
  } catch (_) { /* 读取失败不影响运行 */ }
})();

let flushTimer = null;
const flush = () => {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const payload = {};
  cache.forEach((v, k) => { payload[k] = v.text; });
  AsyncStorage.setItem(KEY, JSON.stringify(payload)).catch(() => {});
};

export const cachedLyric = (key) => {
  const hit = cache.get(key);
  return hit ? hit.text : null;
};

// fetcher 由调用方注入（内部会依次尝试 meting / GD），这里只负责缓存策略。
export async function resolveLyric(key, fetcher) {
  await ready;
  const hit = cache.get(key);
  if (hit) return hit.text;
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = Promise.resolve()
    .then(fetcher)
    .then((text) => {
      if (typeof text === 'string' && text) {
        cache.set(key, { text, at: Date.now() });
        if (cache.size > MAX) cache.delete(cache.keys().next().value);
        if (!flushTimer) flushTimer = setTimeout(flush, 1500);
      }
      return text || '';
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

// 和 picCache 对齐：切后台立即落盘。否则刚缓存的歌词还挂在 1.5s 定时器上，
// 用户听完立刻切后台/杀进程，这批缓存就丢了，下次进来还要重新请求。
AppState.addEventListener('change', (state) => {
  if (state !== 'active') flush();
});
