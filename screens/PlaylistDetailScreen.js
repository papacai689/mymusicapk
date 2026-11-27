import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BackgroundWrapper from '../components/BackgroundWrapper';
import SongCover from '../components/SongCover';
import SongMenu from '../components/SongMenu';
import { prefetchCovers } from '../services/picCache';
import { apiService } from '../services/apiService';
import { usePlayerStore } from '../store/playerStore';
import { useDownloadStore } from '../store/downloadStore';
import { useLibraryStore, librarySongKey } from '../store/libraryStore';

const artistOf = (s) => s?.ar?.map((a) => a.name).join(' / ') || s?.artists?.map?.((a) => typeof a === 'string' ? a : a.name).join(' / ') || s?.artist || '未知歌手';

export default function PlaylistDetailScreen({ route, navigation }) {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const startDownload = useDownloadStore((s) => s.start);
  const favorites = useLibraryStore((s) => s.favorites);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const [menuSong, setMenuSong] = useState(null);
  const title = route.params?.title || '歌单详情';
  const theme = route.params?.theme;
  const source = route.params?.source;
  const playlistId = route.params?.id;
  const description = route.params?.description || '精选好歌，陪你度过每一个喜欢音乐的时刻。';

  // 首屏优先：先取 30 首（仅 1 个分页请求）立刻渲染，其余后台补到 100。
  // 配合下面的 FlatList，同一时刻只有约 12 行在树里，封面请求从 100 并发降到十几个，
  // 既消除开屏卡顿，也避免了把 GD 那个又慢又易 503 的 types=pic 接口打爆。
  useEffect(() => {
    let ok = true;
    setLoading(true);
    setSongs([]);
    const sources = source ? [source] : undefined;
    if (theme) {
      apiService.getThemeSongs(theme, 30, { sources }).then((xs) => {
        if (!ok) return;
        const list = (xs || []).slice(0, 100);
        setSongs(list);
        setLoading(false);
        prefetchCovers(list.slice(0, 18), 120);
      }).catch(() => { if (ok) { setSongs([]); setLoading(false); } });
      apiService.getThemeSongs(theme, 100, { sources }).then((xs) => {
        if (!ok || !xs?.length) return;
        const full = (xs || []).slice(0, 100);
        // seed 一致，前 30 首顺序相同，直接整包替换不跳变。
        setSongs((prev) => (prev.length >= full.length ? prev : full));
        prefetchCovers(full.slice(0, 30), 120);
      }).catch(() => {});
    } else {
      apiService.getPlaylistDetail(playlistId).then((d) => {
        if (!ok) return;
        const list = (d?.playlist?.tracks || d?.songs || []).slice(0, 100)
          .map((s) => ({ ...s, source: s.source || source || 'netease' }));
        setSongs(list);
        setLoading(false);
        prefetchCovers(list.slice(0, 18), 120);
      }).catch(() => { if (ok) { setSongs([]); setLoading(false); } });
    }
    return () => { ok = false; };
  }, [playlistId, theme, source]);

  const queue = useMemo(() => songs.map((s) => ({ ...s, platform: s.platform || s.source || 'netease' })), [songs]);
  const play = (i) => { if (queue.length) { setQueue(queue, i); navigation.navigate('Player'); } };
  const heroSong = songs[0];

  return (
    <BackgroundWrapper style={styles.page}>
      {/* FlatList 必须显式 flex:1，否则在嵌套 SafeAreaView 里虚拟化视口高度会塌成极小，
          表现为「hero 正常、列表只显示一两行就大片空白且无法滚动」。 */}
      <FlatList
        style={{ flex: 1 }}
        data={songs}
        keyExtractor={(item, i) => `${item.source || 'netease'}-${item.id || i}`}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={5}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <View style={styles.hero}>
              <View style={styles.topBar}>
                <Pressable onPress={() => navigation.goBack()} hitSlop={12}><Ionicons name="chevron-back" size={30} color="#fff" /></Pressable>
                <View style={styles.topActions}><Ionicons name="search-outline" size={23} color="#fff" /><Ionicons name="ellipsis-vertical" size={23} color="#fff" /></View>
              </View>
              <View style={styles.heroInfo}>
                <SongCover song={heroSong} size={500} style={[styles.cover, styles.heroCover]} fallbackStyle={styles.fallback} />
                <View style={styles.heroText}>
                  <Text style={styles.heroTitle} numberOfLines={2}>{title}</Text>
                  <Text style={styles.creator}>网易云音乐 · 推荐歌单</Text>
                  <Text style={styles.heroDescription} numberOfLines={3}>{description}</Text>
                </View>
              </View>
              <View style={styles.actionsRow}>
                <View style={styles.action}><Ionicons name="share-social-outline" size={21} color="#fff" /><Text style={styles.actionText}>分享</Text></View>
                <View style={styles.action}><Ionicons name="chatbubble-ellipses-outline" size={21} color="#fff" /><Text style={styles.actionText}>评论</Text></View>
                <View style={styles.action}><Ionicons name="heart-outline" size={21} color="#fff" /><Text style={styles.actionText}>收藏</Text></View>
              </View>
            </View>
            <View style={styles.sheet}>
              <View style={styles.playAllRow}>
                <Pressable style={styles.playAll} onPress={() => play(0)}><Ionicons name="play" size={21} color="#fff" /><Text style={styles.playAllText}>播放全部</Text></Pressable>
                <Text style={styles.songCount}>{loading ? '加载中…' : `${songs.length} 首歌曲`}</Text>
                <Pressable style={styles.downloadAll} onPress={() => songs.forEach((s) => startDownload({ ...s, platform: s.platform || s.source || 'netease' }))}><Ionicons name="download-outline" size={23} color="#333" /></Pressable>
              </View>
            </View>
          </View>
        }
        renderItem={({ item: s, index: i }) => (
          <View style={styles.row}>
            <Pressable style={styles.songInfo} onPress={() => play(i)}>
              <SongCover song={s} style={[styles.cover, styles.songCover]} fallbackStyle={styles.fallback} />
              <View style={styles.meta}>
                <Text style={styles.songName} numberOfLines={1}>{s.name || `推荐歌曲 ${i + 1}`}</Text>
                <Text style={styles.artist} numberOfLines={1}>{artistOf(s)}</Text>
              </View>
            </Pressable>
            <Pressable onPress={() => setMenuSong(s)} hitSlop={10}>
              <Ionicons name="ellipsis-vertical" size={20} color="#aaa" />
            </Pressable>
          </View>
        )}
        ListEmptyComponent={loading ? <ActivityIndicator style={styles.loading} color="#EC4141" /> : <Text style={styles.empty}>暂时没有可展示的歌曲，请稍后重试。</Text>}
      />
      <SongMenu
        visible={!!menuSong}
        song={menuSong}
        onClose={() => setMenuSong(null)}
        onPlayNext={() => menuSong && playNext({ ...menuSong, platform: menuSong.platform || menuSong.source || 'netease' })}
        isFavorite={!!menuSong && favorites.some((f) => librarySongKey(f) === librarySongKey(menuSong))}
        onFavorite={() => menuSong && toggleFavorite(menuSong)}
        onDownload={() => menuSong && startDownload({ ...menuSong, platform: menuSong.platform || menuSong.source || 'netease' })}
      />
    </BackgroundWrapper>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f6fa' },
  hero: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 20, backgroundColor: '#615252' },
  topBar: { height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topActions: { flexDirection: 'row', gap: 22 },
  heroInfo: { flexDirection: 'row', marginTop: 18, alignItems: 'center' },
  heroCover: { width: 126, height: 126, borderRadius: 10 },
  heroText: { flex: 1, marginLeft: 16 },
  heroTitle: { color: '#fff', fontSize: 22, lineHeight: 29, fontWeight: '800' },
  creator: { marginTop: 8, color: 'rgba(255,255,255,.86)', fontSize: 12 },
  heroDescription: { marginTop: 9, color: 'rgba(255,255,255,.7)', fontSize: 12, lineHeight: 18 },
  actionsRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 22 },
  action: { minWidth: 86, alignItems: 'center', gap: 5 },
  actionText: { color: '#fff', fontSize: 12 },
  sheet: { marginTop: -1, backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 4 },
  playAllRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 3 },
  playAll: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EC4141', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  playAllText: { color: '#fff', fontWeight: '800', fontSize: 14, marginLeft: 6 },
  songCount: { color: '#999', fontSize: 13, marginLeft: 12, flex: 1 },
  downloadAll: { padding: 8 },
  loading: { marginTop: 46 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
  songInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  songCover: { width: 52, height: 52, borderRadius: 7 },
  cover: { backgroundColor: '#eee' },
  fallback: { backgroundColor: '#ead8d8' },
  meta: { flex: 1, marginLeft: 12 },
  songName: { color: '#222', fontSize: 15, fontWeight: '700' },
  artist: { color: '#999', fontSize: 12, marginTop: 5 },
  empty: { textAlign: 'center', color: '#999', paddingTop: 48 }
});
