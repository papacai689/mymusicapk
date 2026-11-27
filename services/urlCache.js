// 播放地址短期缓存：预取下一首与正式点歌共用，命中即省掉一次网络往返。
// 移动网络下 RTT 高（实测 oiapi 0.27s / GD 1-7s），把解析前移到「听当前歌时」
// 能把切歌等待压到接近 0，这是纯前端能拿到的最大收益。
//
// TTL 取 30 分钟：网易云直链签名实测 2 小时才失效，30 分钟留足安全余量，
// 又不会让切歌拿到过期地址。仅内存，App 重启清空——启动时本来就不会预取。
const cache = new Map();
const TTL = 30 * 60 * 1000;
// 网易云试听片段（jd-musicrep-ts，约 30 秒）只缓存 30 秒：GD 主源是唯一能给
// 完整版的源，且当前故障频繁；试听若按完整版的 30 分钟缓存，GD 恢复后仍会
// 一直命中试听、拿不到完整版。短 TTL 让恢复后很快自动重取。
const TRIAL_TTL = 30 * 1000;
export const isTrialUrl = (url) => /musicrep-ts/i.test(String(url || ''));

const keyOf = (songInfo, quality) => {
  const id = songInfo?.sourceTrackId || songInfo?.id || songInfo?.songId;
  const platform = songInfo?.source || songInfo?.platform || 'netease';
  return `${platform}:${id}:${quality}`;
};

export function cachedUrl(songInfo, quality) {
  const key = keyOf(songInfo, quality);
  const hit = cache.get(key);
  if (!hit) return null;
  const ttl = hit.trial ? TRIAL_TTL : TTL;
  if (Date.now() - hit.time >= ttl) { cache.delete(key); return null; }
  return hit.url;
}

export function setCachedUrl(songInfo, quality, url) {
  if (!url) return;
  cache.set(keyOf(songInfo, quality), { url, time: Date.now(), trial: isTrialUrl(url) });
}

// 预取成功/失败都不影响当前播放，失败静默；不写盘、不重试（超时重试无意义）。
export async function prefetchUrl(songInfo, quality, resolve) {
  if (!songInfo) return;
  if (cachedUrl(songInfo, quality)) return;
  try {
    const url = await resolve();
    setCachedUrl(songInfo, quality, url);
  } catch (_) { /* 预取失败不影响播放，切歌时会正常重新解析 */ }
}
