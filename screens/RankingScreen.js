import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { apiService } from '../services/apiService';
import { prefetchCovers } from '../services/picCache';
import SongCover from '../components/SongCover';

// 仅保留 GD 实测可返回数据的风格/场景词（已用 curl 逐一验证：飙升榜/热门歌曲/新歌/华语/欧美/抖音/伤感/古风/摇滚 均有结果）。
// 播客/有声书/MV/原创歌曲/畅销歌曲 等主题 GD 一律返回空，已从列表移除。
// fallback 用于防御 GD 偶发空响应：主词落空时降级到兜底词，保证卡片永不为空白行。
export const RANKINGS = [
  { id: 'soaring', title: '飙升榜', theme: '飙升榜', update: '实时更新', color: '#274ad8', fallback: '热门歌曲' },
  { id: 'hot', title: '热歌榜', theme: '热门歌曲', update: '每天更新', color: '#9e8274', fallback: '新歌' },
  { id: 'new', title: '新歌榜', theme: '新歌', update: '每天更新', color: '#96a0ac', fallback: '热门歌曲' },
  { id: 'cpop', title: '华语榜', theme: '华语', update: '每天更新', color: '#d64726', fallback: '热门歌曲' },
  { id: 'west', title: '欧美榜', theme: '欧美', update: '每天更新', color: '#245f67', fallback: '热门歌曲' },
  { id: 'douyin', title: '抖音热歌', theme: '抖音', update: '每小时更新', color: '#ee1743', fallback: '热门歌曲' },
  { id: 'sad', title: '伤感榜', theme: '伤感', update: '每天更新', color: '#7c4dff', fallback: '热门歌曲' },
  { id: 'guofeng', title: '古风榜', theme: '古风', update: '每天更新', color: '#689373', fallback: '热门歌曲' },
  { id: 'rock', title: '摇滚榜', theme: '摇滚', update: '每天更新', color: '#37474f', fallback: '热门歌曲' },
];

const artistOf = (s) =>
  s?.ar?.map?.((a) => a.name).join(' / ') ||
  s?.artists?.map?.((a) => (typeof a === 'string' ? a : a.name)).join(' / ') ||
  s?.artist ||
  '未知歌手';

// 主页预览缓存：二次进页面直接命中，0 请求秒出；TTL 5 分钟，过期后后台静默刷新。
const previewCache = new Map();
const PREVIEW_TTL = 5 * 60 * 1000;

export default function RankingScreen({ navigation }) {
  // 逐卡渐进：每卡独立加载，不再被最慢的一个卡住整页。
  const [data, setData] = useState(() => {
    const init = {};
    const now = Date.now();
    RANKINGS.forEach((cfg) => {
      const c = previewCache.get(cfg.id);
      if (c && now - c.ts < PREVIEW_TTL) init[cfg.id] = c.songs; // 命中缓存，首帧即有内容
    });
    return init;
  });

  useEffect(() => {
    let ok = true;
    // 并发加载全部榜单：搜索已切到 oiapi 优先，实测 9 个关键词同时请求全部成功，
    // 不再需要当初为 GD（约半数空响应）设计的 100ms 错峰——那个错峰让最后一个卡片
    // 白白等 800ms 才发起请求，是排行榜首屏慢的主因。
    RANKINGS.forEach((cfg) => {
      const tryWord = (word, isFallback) => {
        const cached = previewCache.get(cfg.id);
        if (!isFallback && cached && Date.now() - cached.ts < PREVIEW_TTL) return; // 缓存有效则跳过请求
        apiService.getRankingPreview(word, 3)
          .then((songs) => {
            if (!ok) return;
            const list = songs || [];
            if (list.length) {
              previewCache.set(cfg.id, { ts: Date.now(), songs: list });
              setData((prev) => ({ ...prev, [cfg.id]: list }));
              const first = list[0];
              if (first?.pic_id) prefetchCovers([first], 120);
            } else if (!isFallback && cfg.fallback) {
              // 主词落空（上游偶发空响应）→ 降级兜底词，保证卡片永不为空白行。
              tryWord(cfg.fallback, true);
            } else {
              setData((prev) => ({ ...prev, [cfg.id]: [] }));
            }
          })
          .catch(() => { if (ok) setData((prev) => ({ ...prev, [cfg.id]: [] })); });
      };
      tryWord(cfg.theme, false);
    });
    return () => { ok = false; };
  }, []);

  // 统一横条卡：左侧封面 + 右侧标题/更新 + 前三名预览
  const RowCard = ({ cfg }) => {
    const songs = data[cfg.id];
    const ready = Array.isArray(songs);
    return (
      <Pressable style={styles.rowCard} onPress={() => navigation.navigate('RankingDetail', cfg)}>
        <View style={styles.rowCoverWrap}>
          {ready && songs[0]
            ? <SongCover song={songs[0]} style={styles.rowCover} fallbackStyle={{ backgroundColor: cfg.color }} />
            : <View style={[styles.rowCover, { backgroundColor: cfg.color }]} />}
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowHead}>
            <Text style={styles.rowTitle}>{cfg.title}</Text>
            <Text style={styles.update}>{cfg.update}</Text>
          </View>
          <View style={styles.rowPreview}>
            {ready && songs.length
              ? songs.slice(0, 3).map((song, i) => (
                  <Text key={`${song.source}:${song.id || i}`} style={styles.previewLine} numberOfLines={1}>
                    <Text style={[styles.rank, i === 0 && styles.topRank]}>{i + 1} </Text>
                    {song.name || '未命名'}
                  </Text>
                ))
              : [0, 1, 2].map((i) => <View key={i} style={styles.skBar} />)}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.grid}>
      {RANKINGS.map((cfg) => <RowCard key={cfg.id} cfg={cfg} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { width: '100%', paddingTop: 8, paddingHorizontal: 14, paddingBottom: 96, gap: 12 },
  rowCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff',
    borderRadius: 14, padding: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  rowCoverWrap: { width: 64, height: 64, borderRadius: 12, overflow: 'hidden' },
  rowCover: { width: 64, height: 64, borderRadius: 12 },
  rowBody: { flex: 1, marginLeft: 14, justifyContent: 'center' },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  rowTitle: { fontSize: 16, fontWeight: '800', color: '#28313e' },
  update: { fontSize: 12, color: '#aaa' },
  rowPreview: { gap: 4 },
  previewLine: { fontSize: 12, color: '#6b7480' },
  rank: { fontWeight: '800', color: '#9aa3af', fontSize: 12 },
  topRank: { color: '#EC4141' },
  skBar: { height: 9, width: '70%', borderRadius: 5, backgroundColor: '#eceff3' },
});
