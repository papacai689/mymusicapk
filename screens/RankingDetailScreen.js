import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import SongCover from '../components/SongCover';
import SongMenu from '../components/SongMenu';
import { prefetchCovers } from '../services/picCache';
import { apiService } from '../services/apiService';
import { usePlayerStore } from '../store/playerStore';
import { useDownloadStore } from '../store/downloadStore';
import { useLibraryStore, librarySongKey } from '../store/libraryStore';

const artistOf = (s) =>
  s?.ar?.map?.((a) => a.name).join(' / ') ||
  s?.artists?.map?.((a) => (typeof a === 'string' ? a : a.name)).join(' / ') ||
  s?.artist ||
  '未知歌手';

// 同一榜单的结果缓存（上游对相同关键词返回确定性结果，可安全复用）。
// 反复进出某榜时直接命中、秒开；网络在后台静默刷新并覆盖。
const rankingCache = new Map(); // theme -> { songs, ts }
const RANK_TTL = 10 * 60 * 1000;

export default function RankingDetailScreen({ route, navigation }) {
  const cfg = route.params || {};
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const download = useDownloadStore((s) => s.start);
  const favorites = useLibraryStore((s) => s.favorites);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const [menuSong, setMenuSong] = useState(null);
  const heroColor = cfg.color || '#1aa89d';

  useEffect(() => {
    let ok = true;
    const theme = cfg.theme || cfg.title || '热门歌曲';
    // 先尝试命中缓存：命中则秒开，不闪空；未命中才走 loading。
    const cached = rankingCache.get(theme);
    if (cached && Date.now() - cached.ts < RANK_TTL) {
      const list = cached.songs;
      setSongs(list);
      setLoading(false);
      prefetchCovers(list.slice(0, 18), 120);
    } else {
      setLoading(true);
      setSongs([]);
    }
    // 榜单固定 100 首：一次取满（单关键词不足时由 getThemeSongs 多关键词补足并去重），
    // 命中缓存则上面已秒开，这里请求完成后覆盖并刷新缓存。
    apiService.getThemeSongs(theme, 100, { sources: ['netease'] }).then((xs) => {
      if (!ok) return;
      const full = (xs || []).slice(0, 100);
      if (full.length) {
        setSongs(full);
        rankingCache.set(theme, { songs: full, ts: Date.now() });
        prefetchCovers(full.slice(0, 18), 120);
      }
      setLoading(false);
    }).catch(() => { if (ok && !rankingCache.get(theme)) { setSongs([]); setLoading(false); } });
    return () => { ok = false; };
  }, [cfg.theme, cfg.title]);

  const queue = useMemo(() => songs.map((s) => ({ ...s, platform: s.platform || s.source || 'netease' })), [songs]);
  const play = (i) => { if (queue.length) { setQueue(queue, i); navigation.navigate('Player'); } };

  const Header = () => (
    <>
      <View style={[styles.hero, { backgroundColor: heroColor }]}>
        <View style={styles.top}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </Pressable>
          <View style={styles.topRight}>
            <Ionicons name="search-outline" size={23} color="#fff" />
            <Ionicons name="ellipsis-vertical" size={22} color="#fff" />
          </View>
        </View>
        <Text style={styles.brand}>◉ 网易云音乐</Text>
        <Text style={styles.title}>{cfg.title || '排行榜'}</Text>
        <Text style={styles.update}>每日更新 · {new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</Text>
      </View>

      <View style={styles.sheet}>
        <View style={styles.stats}>
          <Text style={styles.statsText}>{loading ? '加载中…' : `${songs.length} 首`}</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.statsText}>{cfg.update || '每日更新'}</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.statsText}>网易云</Text>
        </View>
        <View style={styles.toolbar}>
          <Pressable style={styles.playAll} onPress={() => play(0)}>
            <Ionicons name="play" size={18} color="#fff" />
            <Text style={styles.playText}>播放全部</Text>
            <Text style={styles.total}>({songs.length})</Text>
          </Pressable>
          <Pressable style={styles.toolBtn} onPress={() => queue.length && download(queue)}>
            <Ionicons name="download-outline" size={22} color="#555" />
          </Pressable>
          <Pressable style={styles.toolBtn}>
            <Ionicons name="list-outline" size={22} color="#555" />
          </Pressable>
        </View>
      </View>
    </>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <FlatList
        data={songs}
        keyExtractor={(item, i) => `${item.source || 'netease'}:${item.id || i}`}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={5}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        ListHeaderComponent={<Header />}
        renderItem={({ item: s, index: i }) => (
          <View style={[styles.row, styles.rowPad]}>
            <Pressable style={styles.rowMain} onPress={() => play(i)}>
              <Text style={[styles.rank, i < 3 && styles.topRank]}>{i + 1}</Text>
              <SongCover song={s} style={[styles.cover, styles.songCover]} fallbackStyle={{ backgroundColor: heroColor }} />
              <View style={styles.meta}>
                <Text style={styles.name} numberOfLines={1}>{s.name || '未命名歌曲'}</Text>
                <Text style={styles.artist} numberOfLines={1}>{artistOf(s)}</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => setMenuSong(s)} hitSlop={10}>
              <Ionicons name="ellipsis-vertical" size={20} color="#aaa" />
            </Pressable>
          </View>
        )}
        ListEmptyComponent={loading ? <ActivityIndicator color="#EC4141" style={{ marginTop: 40 }} /> : <Text style={styles.empty}>暂无歌曲</Text>}
      />
      <SongMenu
        visible={!!menuSong}
        song={menuSong}
        onClose={() => setMenuSong(null)}
        onPlayNext={() => menuSong && playNext({ ...menuSong, platform: menuSong.platform || menuSong.source || 'netease' })}
        isFavorite={!!menuSong && favorites.some((f) => librarySongKey(f) === librarySongKey(menuSong))}
        onFavorite={() => menuSong && toggleFavorite(menuSong)}
        onDownload={() => menuSong && download({ ...menuSong, platform: menuSong.platform || menuSong.source || 'netease' })}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  content: { backgroundColor: '#fff', paddingBottom: 24 },
  hero: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topRight: { flexDirection: 'row', gap: 22 },
  brand: { color: '#dffaf6', fontSize: 16, textAlign: 'center', marginTop: 16 },
  title: { color: '#fff', fontSize: 36, fontWeight: '800', textAlign: 'center', marginTop: 18 },
  update: { color: 'rgba(255,255,255,.85)', fontSize: 14, textAlign: 'center', marginTop: 12 },
  sheet: { backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 },
  stats: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 14 },
  statsText: { fontSize: 14, color: '#8a93a0' },
  dot: { color: '#cfd5dd', fontSize: 14 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f0f0f0' },
  playAll: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EC4141', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, flex: 1 },
  playText: { color: '#fff', fontSize: 15, fontWeight: '800', marginLeft: 7 },
  total: { color: '#ffdede', marginLeft: 5, fontSize: 14 },
  toolBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f0f0f0' },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  rowPad: { paddingHorizontal: 16 },
  rank: { width: 30, textAlign: 'center', fontSize: 16, color: '#9aa3af', fontWeight: '700' },
  topRank: { color: '#EC4141' },
  songCover: { width: 52, height: 52, borderRadius: 8 },
  cover: { backgroundColor: '#eee' },
  meta: { flex: 1, marginLeft: 12 },
  name: { fontSize: 15, fontWeight: '700', color: '#222' },
  artist: { fontSize: 12, color: '#999', marginTop: 5 },
  empty: { textAlign: 'center', padding: 50, color: '#999' },
});
