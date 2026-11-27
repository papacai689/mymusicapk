import axios from 'axios';
import { isTimeoutError } from './netError';
import { isTrialUrl } from './urlCache';
import { sortNodes, recordNodeSuccess, recordNodeFailure } from './sourceHealth';

// GD 音乐台始终是主播放源（见 apiService.getSongUrl），这里只是它拿不到地址时的兜底。
// 2026-11-26 实测：GD 近乎全挂（播放地址 8 轮全失败），oiapi / injahow 同源只能给
// 30 秒试听，大量受限曲目降级。故加入 qijieya meting 镜像作为「完整版兜底」——
// 对同一受限曲目（id=509781655）5/5 次返回 9.5MB 完整版，排首位优先尝试。
// 注：旧的 qijieya.cn/api.php 路径已 404，这里用的是 /meting/ 新路径，二者不是一回事。
const cache = new Map();
// oiapi / meting 返回的直链带时效签名，缓存太久会拿到过期地址。实测 6 小时偶发失效，
// 缩到 2 小时：多一次请求换来「点播放不会因地址过期而失败」。
const TTL = 2 * 60 * 60 * 1000;
// 试听片段短 TTL：兜底拿到 30 秒试听时别按完整版缓存 2 小时，否则 GD 恢复后
// 这首歌两小时内都不会再试完整版。30 秒后过期，下次点歌自动重解析。
const TRIAL_TTL = 30 * 1000;
const H = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36' };

// GD 用完整平台名，第三方解析用短码；未知平台不要默认当网易云，否则会解析到别的歌。
const platformMap = { wy: 'wy', netease: 'wy', tx: 'tx', tencent: 'tx', kw: 'kw', kuwo: 'kw', kg: 'kg', mg: 'mg' };

// 每个节点自己声明支持哪些平台、怎么拼请求、怎么从响应里取地址。
// 这些第三方接口格式互不相同，写死一种格式就没法再加新节点了。
// 接入前都实测过：用网易云歌曲 id 5257138 能稳定返回同名同歌的真实地址。
const NODES = [
  {
    // 2026-11-26 实测：唯一能给受限曲目完整版的兜底源。type=song 返回 357B JSON，
    // url 字段是 qijieya 的 type=url 中转地址（302 跳完整版），交给 expo-audio 跟随，
    // 不把 12MB 音频读进 JS 内存。放首位优先——它健康时先拿完整版，失败降权后
    // sortNodes 会把它排到 oiapi/injahow 后面，自动降级试听。仅支持 netease。
    name: 'Meting(qijieya)',
    platforms: ['wy'],
    build: (id) => ({
      url: 'https://api.qijieya.cn/meting/',
      params: { server: 'netease', type: 'song', id },
    }),
    parse: (data) => {
      const row = Array.isArray(data) ? data[0] : null;
      const url = row?.url;
      return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
    },
  },
  {
    name: 'oiapi 网易云',
    platforms: ['wy'],
    build: (id) => ({ url: 'https://oiapi.net/api/Music_163', params: { id } }),
    // 响应形如 {code:0, data:{items:[{name, singers, url}]}}，取不到歌时 items 为空数组。
    parse: (data) => {
      const items = Array.isArray(data?.data?.items) ? data.data.items : null;
      const url = items?.[0]?.url;
      return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
    },
  },
  {
    // 2026-11-22 实测：0.11s 稳定返回，type=url 是 302 跳转，播放器跟随即可拿到真实 mp3。
    // axios 在 RN 里会跟随重定向，所以这里用 type=song（返回 JSON 里的 url 字段），
    // 让 expo-audio 自己跟随 302，避免把 12MB 音频读进 JS 内存。
    name: 'Meting(injahow)',
    platforms: ['wy', 'tx'],
    build: (id, quality, platform) => ({
      url: 'https://api.injahow.cn/meting/',
      params: { server: platform === 'tx' ? 'tencent' : 'netease', type: 'song', id },
    }),
    parse: (data) => {
      const row = Array.isArray(data) ? data[0] : null;
      const url = row?.url;
      return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
    },
  },
];

export async function playUrlResolver(songInfo, quality = '128k') {
  const rawPlatform = songInfo.platform || songInfo.source || 'wy';
  const platform = platformMap[rawPlatform];
  if (!platform) throw new Error(`暂不支持 ${rawPlatform} 的备用解析`);
  const id = songInfo.sourceTrackId || songInfo.id || songInfo.songId;
  if (!id) throw new Error('缺少歌曲 id，无法解析播放地址');

  const key = `${platform}:${id}:${quality}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit) {
    const ttl = hit.trial ? TRIAL_TTL : TTL;
    if (now - hit.time < ttl) return hit.url;
    // 惰性清理：这个 key 已过期，删掉再重解析。否则 cache 只增不减，听歌越多
    // 堆越多条目。每次只清碰到的那个 key，不做全表扫描，零额外开销。
    cache.delete(key);
  }

  // 按健康度排序：连续失败多的节点排后面，冷却后自动清零重新给机会。
  // oiapi 与 meting 同源，通常结果一致，但上游偶发单节点抖动时排序能减少等待。
  let nodes = NODES.filter((node) => !node.platforms || node.platforms.includes(platform));
  if (!nodes.length) throw new Error(`备用解析器暂无支持 ${rawPlatform} 的节点`);
  nodes = sortNodes(nodes);

  for (const node of nodes) {
    const { url, params } = node.build(id, quality, platform);
    try {
      const r = await axios.get(url, { params, headers: H, timeout: 10000 });
      const resolved = node.parse(r?.data);
      if (resolved) {
        recordNodeSuccess(node.name);
        cache.set(key, { url: resolved, time: Date.now(), trial: isTrialUrl(resolved) });
        return resolved;
      }
      // 返回空结果也算失败信号（oiapi 约半数请求返回空响应）。
      recordNodeFailure(node.name);
    } catch (error) {
      // 节点连不上或超时就换下一个，别在同一个节点上反复重试。
      recordNodeFailure(node.name);
      if (!isTimeoutError(error)) console.warn(`[resolver] ${node.name} 解析失败`, error?.message);
    }
  }
  throw new Error('备用解析失败：所有节点都未能返回播放地址');
}
