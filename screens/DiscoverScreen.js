import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, LayoutAnimation, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, UIManager, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import BackgroundWrapper from '../components/BackgroundWrapper';
import { getBarSurface, getThemeTextColor, useThemeStore } from '../store/themeStore';
import { useSourceStore } from '../store/sourceStore';
import { usePlayerStore } from '../store/playerStore';
import { useLibraryStore, librarySongKey } from '../store/libraryStore';
import { useDownloadStore } from '../store/downloadStore';
import { apiService } from '../services/apiService';
import RecommendScreen from './RecommendScreen';
import TopNav from '../components/TopNav';
import RankingScreen from './RankingScreen';
import SongCover from '../components/SongCover';
import SongMenu from '../components/SongMenu';

const FALLBACK = {
  personalized: [{ id: 'demo-1', name: '示例推荐歌单', picUrl: null }],
  toplist: [{ id: 'demo-top', name: '云端排行榜（演示）' }],
  songs: [{ id: 'demo-song', name: '在线音乐连接测试', ar: [{ name: '系统示例' }] }],
};

// LayoutAnimation is unsupported by React Native's New Architecture; avoid
// calling the legacy opt-in there so Android does not emit a misleading warn.
if (Platform.OS === 'android' && !global.nativeFabricUIManager && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function normalizeSong(song, index) {
  const rawArtists = song?.ar || song?.artists || song?.artist;
  const artistList = Array.isArray(rawArtists) ? rawArtists.map((artist) => typeof artist === 'string' ? { name: artist } : artist).filter(Boolean) : rawArtists ? [{ name: rawArtists }] : null;
  return {
    ...song,
    id: song?.id ?? `demo-song-${index + 1}`,
    name: song?.name || song?.title || `每日推荐歌曲 ${index + 1}`,
    ar: artistList?.length ? artistList : [{ name: '推荐歌手' }],
  };
}


export default function DiscoverScreen({ navigation, route }) {
  const color = useThemeStore(getThemeTextColor);
  const barSurface = useThemeStore(getBarSurface);
  const muted = color === '#fff' ? 'rgba(255,255,255,.72)' : '#6b7280';
  const sourceId = useSourceStore((s) => s.currentSourceId);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  const recentSongs = useLibraryStore((s) => s.recent);
  const favoriteSongs = useLibraryStore((s) => s.favorites);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const startDownload = useDownloadStore((s) => s.start);
  const [menuSong, setMenuSong] = useState(null);
  const [data, setData] = useState(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeNav, setActiveNav] = useState('首页');
  const [page, setPage] = useState(0);
  const [listExpanded, setListExpanded] = useState(true);
  const [playlistCategory, setPlaylistCategory] = useState('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  useEffect(() => { if (route?.params?.initialNav) setActiveNav(route.params.initialNav); }, [route?.params?.navKey]);

  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.allSettled([
      apiService.getToplistDetail(),
      apiService.getDailySongs(),
    ]).then(([toplist, songs]) => {
      if (!active) return;
      const failed = [toplist, songs].some((x) => x.status === 'rejected');
      setData({
        toplist: toplist.status === 'fulfilled' ? (toplist.value?.list || []) : FALLBACK.toplist,
        songs: songs.status === 'fulfilled' ? (Array.isArray(songs.value) ? songs.value : (songs.value?.data || songs.value?.result || [])) : FALLBACK.songs,
      });
      if (failed) setError('在线音乐源暂不可用，当前显示演示内容；点击此处重试。');
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [sourceId]);

  useEffect(() => load(), [load]);

  // 补足 10 页的那一批（6 个请求）原本开屏立刻就打出去，但快速批次本身就有 4×30 首，
  // 前 6 页根本用不到它。改成用户真翻到第 6 页时才补，开屏请求数直接从 10 降到 4。
  const moreRequested = useRef(false);
  useEffect(() => {
    if (page < 5 || moreRequested.current) return;
    moreRequested.current = true;
    apiService.getMoreDailySongs().then((more) => {
      if (!Array.isArray(more) || !more.length) return;
      setData((prev) => {
        const seen = new Set((prev.songs || []).map((entry) => `${entry.source || 'netease'}:${entry.id}`));
        const extra = more.filter((entry) => !seen.has(`${entry.source || 'netease'}:${entry.id}`));
        return extra.length ? { ...prev, songs: [...(prev.songs || []), ...extra] } : prev;
      });
    }).catch(() => {});
  }, [page]);

  const dailySongs = useMemo(() => {
    const source = (data.songs?.length ? data.songs : FALLBACK.songs)
      .map((song, index) => normalizeSong({ ...song, ar: song.ar || song.artist?.map?.((name) => ({ name })) || [{ name: '推荐歌手' }], album: { ...song.album } }, index));
    const seen = new Set();
    const unique = source.filter((song) => {
      const artist = song.ar?.[0]?.name || song.artists?.[0]?.name || '未知歌手';
      const sourceId = song.source || 'netease';
      const trackId = song.sourceTrackId || song.id;
      const key = `${sourceId}:${trackId}|${song.name.trim().toLowerCase()}|${artist.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Interleave artists so one singer does not occupy many consecutive rows.
    const buckets = new Map();
    unique.forEach((song) => {
      const artist = song.ar?.[0]?.name || song.artists?.[0]?.name || '未知歌手';
      if (!buckets.has(artist)) buckets.set(artist, []);
      buckets.get(artist).push(song);
    });
    const balanced = [];
    while (buckets.size) {
      for (const [artist, songs] of buckets) {
        const song = songs.shift();
        if (song) balanced.push(song);
        if (!songs.length) buckets.delete(artist);
      }
    }
    return balanced.slice(0, 200).map((song, index) => ({
      ...song,
      sourceTrackId: song.sourceTrackId || song.id,
      id: `${song.source || 'netease'}:${song.sourceTrackId || song.id}`,
      recommendationIndex: index,
    }));
  }, [data.songs]);
  const pageSongs = dailySongs.slice(page * 20, page * 20 + 20);
  // 页数按实际拿到的歌曲数算，避免出现点进去是空白的页码。
  const pageCount = Math.max(1, Math.ceil(dailySongs.length / 20));
  const pageWindow = Math.floor(page / 5) * 5;
  const playSong = (song, list = dailySongs) => {
    const index = list.findIndex((item) => item.id === song.id);
    setQueue(list, index >= 0 ? index : 0);
    navigation.navigate('Player');
  };

  const playlistSongs = playlistCategory === 'recent' ? recentSongs : favoriteSongs;
  const doSearch = async () => {
    const keyword = searchQuery.trim();
    if (!keyword) { setSearchResults([]); setSearchError('请输入歌曲名或歌手名'); return; }
    Keyboard.dismiss(); setSearching(true); setSearchError('');
    try {
      const response = await apiService.search(keyword, { source: 'netease', count: 30, pages: 1 });
      const rows = Array.isArray(response) ? response : (response?.result?.songs || response?.result || response?.data?.songs || response?.data || response?.songs || []);
      setSearchResults(rows.map((song, index) => normalizeSong(song, index)));
      if (!rows.length) setSearchError('没有找到相关歌曲');
    } catch (error) { setSearchResults([]); setSearchError(error?.message || '搜索失败，请稍后重试'); }
    finally { setSearching(false); }
  };

  if (loading) return <BackgroundWrapper><View style={styles.center}><ActivityIndicator color="#6d45f5" /></View></BackgroundWrapper>;
  const selectNav = (item) => setActiveNav(item);
  return <BackgroundWrapper>
    <View style={styles.screenHost}>
      <TopNav navigation={navigation} active={activeNav} onSelect={selectNav} />
      <View style={[styles.screenPanel, activeNav === '推荐' ? styles.panelVisible : styles.panelHidden]} pointerEvents={activeNav === '推荐' ? 'auto' : 'none'}>
        <RecommendScreen navigation={navigation} onSelect={selectNav} embedded active={activeNav === '推荐'} />
      </View>
      <View style={[styles.screenPanel, activeNav === '推荐' ? styles.panelHidden : styles.panelVisible]} pointerEvents={activeNav === '推荐' ? 'none' : 'auto'}>
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false} stickyHeaderIndices={[]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { apiService.advanceRecommend(); load(); }} colors={['#6d45f5']} tintColor="#6d45f5" />}>
      <View style={[styles.stickyArea, { backgroundColor: barSurface }]}>
          {error ? <Pressable onPress={load}><Text style={[styles.error, { color: muted }]}>{error}</Text></Pressable> : null}
        {activeNav === '首页' ? <>
          <Pressable onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setListExpanded((value) => !value); }} style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color }]}>每日推荐</Text></Pressable>
          <View style={styles.pagination}><Pressable disabled={page === 0} onPress={() => setPage((value) => Math.max(0, value - 1))} style={[styles.arrowButton, page === 0 && styles.pageButtonDisabled]}><Text style={styles.arrowText}>‹</Text></Pressable>{Array.from({ length: Math.max(0, Math.min(5, pageCount - pageWindow)) }, (_, i) => pageWindow + i).map((number) => <Pressable key={number} onPress={() => setPage(number)} style={[styles.pageButton, page === number && styles.pageButtonActive]}><Text style={[styles.pageText, page === number && styles.pageTextActive]}>{number + 1}</Text></Pressable>)}<Pressable disabled={page >= pageCount - 1} onPress={() => setPage((value) => Math.min(pageCount - 1, value + 1))} style={[styles.arrowButton, page >= pageCount - 1 && styles.pageButtonDisabled]}><Text style={styles.arrowText}>›</Text></Pressable></View>
        </> : null}
      </View>
      {activeNav === '首页' ? <>
        {listExpanded ? <View style={{ width: '100%' }}>{pageSongs.map((song) => <View key={song.id} style={styles.songRow}><Pressable style={styles.songMain} onPress={() => playSong(song)}><SongCover song={song} style={styles.songCover} fallbackStyle={styles.coverFallback} /><View style={styles.songInfo}><Text style={[styles.songName, { color }]} numberOfLines={1}>{song.name}</Text><Text style={[styles.artist, { color: muted }]} numberOfLines={1}>{song.ar?.[0]?.name || song.artists?.[0]?.name || '未知歌手'}</Text></View></Pressable><Pressable onPress={() => setMenuSong(song)} hitSlop={12}><Ionicons name="ellipsis-vertical" size={20} color={muted} /></Pressable></View>)}</View> : null}
      </> : activeNav === '排行榜' ? <RankingScreen navigation={navigation} /> : activeNav === '歌单' ? <View style={{ width: '100%' }}>
        <View style={styles.playlistTabs}>
          <Pressable onPress={() => setPlaylistCategory('recent')} style={[styles.playlistTab, playlistCategory === 'recent' && styles.playlistTabActive]}><Text style={[styles.playlistTabText, { color: playlistCategory === 'recent' ? '#fff' : muted }]}>最近播放</Text></Pressable>
          <Pressable onPress={() => setPlaylistCategory('favorite')} style={[styles.playlistTab, playlistCategory === 'favorite' && styles.playlistTabActive]}><Text style={[styles.playlistTabText, { color: playlistCategory === 'favorite' ? '#fff' : muted }]}>我的收藏</Text></Pressable>
        </View>
        <View>
          <Text style={[styles.playlistSectionTitle, { color }]}>{playlistCategory === 'recent' ? '最近播放' : '我的收藏'}</Text>
          {playlistSongs.length ? playlistSongs.map((song) => <View key={`${playlistCategory}-${song.source || 'netease'}-${song.sourceTrackId || song.id}`} style={styles.songRow}><Pressable style={styles.songMain} onPress={() => playSong(song, playlistSongs)}><SongCover song={song} style={styles.songCover} fallbackStyle={styles.coverFallback} /><View style={styles.songInfo}><Text style={[styles.songName, { color }]} numberOfLines={1}>{song.name}</Text><Text style={[styles.artist, { color: muted }]} numberOfLines={1}>{song.ar?.[0]?.name || song.artists?.[0]?.name || song.artist || '未知歌手'}</Text></View></Pressable><Pressable onPress={() => setMenuSong(song)} hitSlop={12}><Ionicons name="ellipsis-vertical" size={20} color={muted} /></Pressable></View>) : <Text style={[styles.placeholder, { color: muted }]}>{playlistCategory === 'recent' ? '暂无播放记录' : '暂无收藏歌曲'}</Text>}
        </View>
      </View> : <View style={styles.searchPanel}><Text style={[styles.sectionTitle, { color }]}>搜索歌曲</Text><View style={styles.searchBox}><TextInput value={searchQuery} onChangeText={setSearchQuery} onSubmitEditing={doSearch} returnKeyType="search" placeholder="输入歌曲名或歌手名" placeholderTextColor="#9ca3af" style={[styles.searchInput, { color }]} /><Pressable onPress={doSearch} style={styles.searchButton} disabled={searching}><Text style={styles.searchButtonText}>{searching ? '搜索中' : '搜索'}</Text></Pressable></View>{searchError ? <Text style={[styles.searchHint, { color: muted }]}>{searchError}</Text> : null}{searchResults.length ? <View style={{ width: '100%' }}>{searchResults.map((song) => <View key={`search-${song.source || 'netease'}-${song.sourceTrackId || song.id}`} style={styles.songRow}><Pressable style={styles.songMain} onPress={() => playSong(song, searchResults)}><SongCover song={song} style={styles.songCover} fallbackStyle={styles.coverFallback} /><View style={styles.songInfo}><Text style={[styles.songName, { color }]} numberOfLines={1}>{song.name}</Text><Text style={[styles.artist, { color: muted }]} numberOfLines={1}>{song.ar?.[0]?.name || song.artists?.[0]?.name || song.artist || '未知歌手'}</Text></View></Pressable><Pressable onPress={() => setMenuSong(song)} hitSlop={12}><Ionicons name="ellipsis-vertical" size={20} color={muted} /></Pressable></View>)}</View> : <Text style={[styles.placeholder, { color: muted }]}>可搜索歌曲名或歌手名</Text>}</View>}

    </ScrollView>
      </View>
    </View>
      <SongMenu
        visible={!!menuSong}
        song={menuSong}
        onClose={() => setMenuSong(null)}
        onPlayNext={() => menuSong && playNext({ ...menuSong, platform: menuSong.platform || menuSong.source || 'netease' })}
        isFavorite={!!menuSong && favoriteSongs.some((f) => librarySongKey(f) === librarySongKey(menuSong))}
        onFavorite={() => menuSong && toggleFavorite(menuSong)}
        onDownload={() => menuSong && startDownload({ ...menuSong, platform: menuSong.platform || menuSong.source || 'netease' })}
      />
  </BackgroundWrapper>;
}

const styles = StyleSheet.create({
  screenHost: { flex: 1 }, screenPanel: { position: 'absolute', top: 51, left: 0, right: 0, bottom: 0 }, panelVisible: { opacity: 1, zIndex: 1 }, panelHidden: { opacity: 0, zIndex: 0 }, container: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 110 }, center: { flex: 1, justifyContent: 'center', alignItems: 'center' }, stickyArea: { marginHorizontal: -18, paddingHorizontal: 18, backgroundColor: '#ffffff' }, playlistTabs: { flexDirection: 'row', backgroundColor: 'rgba(127,127,127,.12)', borderRadius: 14, padding: 4, marginTop: 18, marginBottom: 12 }, playlistTab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11 }, playlistTabActive: { backgroundColor: '#6d45f5' }, playlistTabText: { fontSize: 15, fontWeight: '700' }, playlistSectionTitle: { fontSize: 17, fontWeight: '800', marginBottom: 8 }, emptyPlaylist: { alignItems: 'stretch' }, error: { paddingVertical: 8 }, sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { fontSize: 20, fontWeight: '800', marginTop: 18, marginBottom: 10 }, collapseIcon: { fontSize: 24, marginTop: 8 }, count: { color: '#6d45f5', fontSize: 14 }, pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5, marginBottom: 8 }, pageButton: { width: 34, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.7)' }, arrowButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(109,69,245,.12)' }, pageButtonDisabled: { opacity: .3 }, arrowText: { color: '#6d45f5', fontSize: 25, lineHeight: 28, fontWeight: '500' }, pageButtonActive: { backgroundColor: '#6d45f5' }, pageText: { color: '#6d45f5', fontWeight: '700', fontSize: 13 }, pageTextActive: { color: '#fff' }, songRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(107,69,245,.18)' }, songMain: { flex: 1, flexDirection: 'row', alignItems: 'center' }, songCover: { width: 48, height: 48, borderRadius: 8, marginRight: 12 }, songInfo: { flex: 1 }, songName: { fontWeight: '700' }, artist: { fontSize: 12, marginTop: 3 }, playIcon: { color: '#6d45f5', fontSize: 14, paddingHorizontal: 8 }, placeholder: { paddingVertical: 35, textAlign: 'center' }, searchPanel: { paddingVertical: 18, alignItems: 'center' }, searchBox: { flexDirection: 'row', width: '100%', marginBottom: 12 }, searchInput: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: '#ddd6fe', borderRadius: 12, paddingHorizontal: 14, backgroundColor: 'rgba(255,255,255,.85)' }, searchButton: { marginLeft: 8, minWidth: 68, borderRadius: 12, backgroundColor: '#6d45f5', alignItems: 'center', justifyContent: 'center' }, searchButtonText: { color: '#fff', fontWeight: '700' }, searchHint: { paddingVertical: 10 }, playlistRow: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: 'rgba(255,255,255,.5)', borderRadius: 14, marginBottom: 8 }, cover: { width: 48, height: 48, borderRadius: 9, marginRight: 12 }, coverFallback: { backgroundColor: '#ddd6fe' }, playlistName: { flex: 1, fontWeight: '600' },
});
