import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { cachedCover, resolveCover } from '../services/picCache';

// 六个页面原本各自实现了一遍「拿 pic_id 换封面 URL」的逻辑，写法略有差异，其中
// 几份连 unmount 后的 setState 都没挡干净。这里统一成一份：
// 直接字段优先 → 已缓存的直接用 → 剩下的交给 picCache 排队解析 → 失败显示占位块。
//
// size 默认 120：列表缩略图在屏幕上只有 50px 左右，按 500 拉是 59KB/张，100 行就是
// 5.9MB；120 只有 5.4KB。大图场景（播放页、轮播、歌单大图）显式传 250 或 500。
// 直链封面按显示尺寸拼 ?param=NxN：oiapi 返回的 180KB 原图缩到 120px 只要 5.4KB，
// 100 行列表能省十几 MB。GD 老结果没有 picUrl，仍走下面的 picCache 解析。
const sized = (url, size) => {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  const n = Math.max(16, Math.min(1000, Math.round(size)));
  return `${url}${url.includes('?') ? '&' : '?'}param=${n}y${n}`;
};
const directOf = (song, size = 120) => sized(song?.picUrl || song?.album?.picUrl, size);

// 大图（轮播 / 歌单封面）给 normal 优先级，列表小图 low，避免和首屏内容抢带宽。
const priorityOf = (size) => (size >= 500 ? 'normal' : 'low');

// 有没有可能解析出封面：有 pic_id（或能推导出 id）才值得在失败时重试。
const hasCoverKey = (song) =>
  !!(song?.pic_id || song?.picId || song?.album?.picId || song?.sourceTrackId || song?.id);

export default function SongCover({ song, style, fallbackStyle, size = 120, transition = 120 }) {
  const direct = directOf(song, size);
  const [uri, setUri] = useState(() => direct || cachedCover(song, size));
  const imgRetried = useRef(false);
  const retryTimer = useRef(null);

  // 卸载时清掉还在排队的重试定时器，避免对已经不存在的组件 setState。
  useEffect(() => () => { if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; } }, []);

  useEffect(() => {
    let active = true;
    imgRetried.current = false;
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    if (direct) { setUri(direct); return undefined; }
    const cached = cachedCover(song, size);
    if (cached) { setUri(cached); return undefined; }
    setUri(null);
    // 解析失败（上游 503 / 超时 / 空响应 → 软失败）时，只在「有 pic_id 可重试」的前提下
    // 受控重试几次；GD 的 types=pic 接口很不稳，但大多能稍后成功，这样空白封面不会长期挂死。
    // 用 force 绕过软失败缓存，避免被 90s 窗口挡住。
    let attempts = 0;
    const MAX = 3;
    const load = (force) => {
      resolveCover(song, size, { force }).then((next) => {
        if (!active) return;
        if (next) { setUri(next); return; }
        attempts += 1;
        if (!force && attempts < MAX && hasCoverKey(song)) {
          retryTimer.current = setTimeout(() => load(true), 2500 * attempts);
        }
      });
    };
    load(false);
    return () => { active = false; };
  }, [song?.id, song?.pic_id, song?.source, song?.picUrl, song?.album?.picUrl, direct, size]);

  // 图片加载失败（上游 5xx / 超时 / 被 abort）时，只受控重试一次：
  // 绕过软失败缓存强制重新解析，拿到新地址就刷新，否则安静地保持占位块。
  const handleError = () => {
    if (imgRetried.current || direct) return;
    imgRetried.current = true;
    resolveCover(song, size, { force: true }).then((next) => { if (next) setUri(next); });
  };

  return uri
    ? (
      <Image
        source={{ uri }}
        style={style}
        contentFit="cover"
        transition={transition}
        cachePolicy="memory-disk"
        priority={priorityOf(size)}
        onError={handleError}
      />
    )
    : <View style={[style, fallbackStyle]} />;
}
