import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createCoverCache } from './coverCacheCore.mjs';
import { apiService } from './apiService';

// GD 的搜索结果只给 pic_id，不给图片地址，所以每一行封面都要再发一次 types=pic。
// 实测这个接口很不稳定（同一张图三次请求分别是 503 / 2.4s / 15s 超时），而榜单详情页
// 一次要渲染 100 行，等于开屏瞬间打出 100 个并发请求，封面长时间是灰块。
//
// 现在封面缓存核心逻辑在 coverCacheCore.js（纯逻辑、可单测）。这里只做 RN 边界适配：
//   - AsyncStorage 作为落盘存储（只存成功 URL，软失败不落盘）；
//   - fetcher 负责把 pic_id 换成图片地址，并支持被 abort；
//   - 切后台立即落盘。

const STORAGE_KEY = '@my-music-player/pic-cache-v1';

const coverCache = createCoverCache({
  storage: AsyncStorage,
  now: () => Date.now(),
  failTtl: 90_000, // 软失败 90 秒后允许重试，而不是永久灰块
  maxConcurrency: 8, // 并发上限从 6 提到 8，缓解大批封面排队
  timeoutMs: 8000,
});

// 启动时把落盘的成功 URL 灌回内存（软失败不会落盘，所以不存在）。
const ready = (async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    const entries = Object.keys(saved || {})
      .filter((k) => typeof saved[k] === 'string' && saved[k])
      .map((k) => [k, saved[k]]);
    if (entries.length) coverCache._markReady(entries);
  } catch (error) {
    // 读取失败不影响后续运行
  }
})();

const keyOf = (song, size) => {
  const source = song?.source || song?.platform || 'netease';
  const id = song?.pic_id || song?.picId || song?.album?.picId || song?.sourceTrackId || song?.id || '';
  return `${source}:${id}:${size}`;
};

// 构造一次封面解析任务。core 会在超时(timeoutMs)或 abort 时取消本次请求，
// 结果（成功 URL 或软失败）都由 core 统一管理。
function makeFetcher(song, size) {
  return async ({ signal } = {}) => {
    const endpoint = apiService.getPicture(song, size);
    if (!endpoint) return null;
    // oiapi 结果自带图片直链（getPicture 直接拼好尺寸），不需要再 fetch 一次拿 JSON。
    // GD 老结果返回的是 types=pic 接口，仍走原来的解析路径。
    if (!/types=pic/i.test(endpoint)) return endpoint;
    const response = await fetch(endpoint, { signal });
    const value = await response.json();
    return typeof value === 'string' ? value : value?.url || value?.data?.url || null;
  };
}

// 已经解析好的封面；返回 null 表示还没解析过、或最近一次解析失败（软失败未过期）。
export function cachedCover(song, size = 120) {
  return coverCache.cached(keyOf(song, size)) || null;
}

export async function resolveCover(song, size = 120, opts = {}) {
  await ready;
  return coverCache.resolve(keyOf(song, size), makeFetcher(song, size), opts);
}

// 批量预热（fire-and-forget）：进入榜单时先预热首屏可见封面，
// FlatList 渲染这些行时 cachedCover 直接命中，不排队。
export function prefetchCovers(songs, size = 120) {
  if (!Array.isArray(songs) || !songs.length) return Promise.resolve();
  const items = songs
    .filter((s) => s && s.pic_id)
    .map((s) => ({ key: keyOf(s, size), fetcher: makeFetcher(s, size) }));
  return coverCache.prefetch(items);
}

AppState.addEventListener('change', (state) => {
  if (state !== 'active') coverCache.flush();
});

export default coverCache;
