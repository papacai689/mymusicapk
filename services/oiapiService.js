import axios from 'axios';
import { isTimeoutError } from './netError';

// GD 搜索只给 pic_id，封面要再问一次 types=pic（实测 503 / 2.4s / 15s 超时反复出现），
// 而 oiapi 的 Music_163 搜索一次就把歌名、歌手、封面直链、播放地址全给出来。
// 2026-11-22 实测：10 个推荐关键词全部 10/10 带 url + picurl、零空响应、0.3~0.6s。
// 因此把「搜歌 + 封面」主链路切到 oiapi；GD 仍保留为播放地址主源（只有它有 320k/FLAC）。
const H = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36' };
const BASE = 'https://oiapi.net/api/Music_163';

// 网易云封面 CDN 支持 ?param=WxH 实时缩略：原图 180KB，120px 只要 5.4KB。
// 列表按 120、大图按 500 拼，避免同一张 180KB 原图在 100 行列表里重复下载。
export const coverSize = (url, size = 120) => {
  if (!url || typeof url !== 'string') return null;
  if (!/^https?:\/\//i.test(url)) return null;
  const n = Math.max(16, Math.min(1000, Math.round(size)));
  return `${url}${url.includes('?') ? '&' : '?'}param=${n}y${n}`;
};

// 从 http://p1.music.126.net/xxx/109951165671182684.jpg 里取图片 id。
// 保留 pic_id 是为了兼容 picCache 的 keyOf 与各页面「有 pic_id 才预热/重试」的判断。
const picIdOf = (url) => {
  const m = String(url || '').match(/\/(\d+)\.(?:jpg|png|webp)/i);
  return m ? m[1] : null;
};

const normalize = (item) => {
  const singers = Array.isArray(item?.singers) ? item.singers : [];
  const picUrl = typeof item?.picurl === 'string' && /^https?:\/\//i.test(item.picurl) ? item.picurl : null;
  const url = typeof item?.url === 'string' && /^https?:\/\//i.test(item.url) ? item.url : null;
  return {
    id: item?.id,
    name: item?.name || '未知歌曲',
    artist: singers.map((s) => s?.name).filter(Boolean).join(' / '),
    artists: singers,
    pic_id: picIdOf(picUrl),
    picUrl, // 直链：SongCover 直接显示，不再走 types=pic 解析
    playUrl: url, // 标准音质直链，仅作播放地址的最后兜底
    lyric_id: item?.id,
    album: null,
    source: 'netease',
    sourceTrackId: item?.id,
  };
};

// 失败不重试（超时 / 连不上再等也没用）；返回空数组交给上层决定是否回退 GD。
export async function oiapiSearch(name, limit = 30, page = 1) {
  const res = await axios.get(BASE, {
    params: { name, limit, page },
    headers: H,
    timeout: 8000,
  });
  const payload = res?.data;
  // oiapi 信封 code 在文档里写 1，实测搜索返回 0，两种都算成功。
  if (payload?.code !== 0 && payload?.code !== 1) return [];
  const items = payload?.data?.items;
  if (!Array.isArray(items)) return [];
  return items.map(normalize).filter((s) => s.id != null);
}

export async function oiapiTrack(id) {
  const res = await axios.get(BASE, { params: { id }, headers: H, timeout: 8000 });
  const items = res?.data?.data?.items;
  return Array.isArray(items) && items.length ? normalize(items[0]) : null;
}

export { isTimeoutError };
