import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TopNav from '../components/TopNav';
import BackgroundWrapper from '../components/BackgroundWrapper';
import SongCover from '../components/SongCover';
import { apiService } from '../services/apiService';
import { prefetchCovers } from '../services/picCache';
import { usePlayerStore } from '../store/playerStore';
import { useLibraryStore } from '../store/libraryStore';

// 歌单分类沿用本地文案；封面改为取该主题的第一首歌实图（有缓存，同一会话只解析一次）。
//
// 「主题 → 代表歌曲」在单次 App 生命周期内缓存，并落盘持久化：GD 搜索本身就有几秒延迟，
// 反复拉取是推荐页歌单封面慢的主因。picCache 已持久化解后的图片地址，所以图片本就秒出，
// 这里缓存的是「搜哪首歌」，命中后连搜索都省了——冷启动、来回切 Tab 都不再慢。
const COVER_CACHE_KEY = '@my-music-player/recommend-covers-v1';
const playlistCoverCache = new Map();
const bannerCoverCache = new Map();
(async () => {
  try {
    const raw = await AsyncStorage.getItem(COVER_CACHE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) || {};
    (obj.playlists || []).forEach(([k, v]) => playlistCoverCache.set(k, v));
    (obj.banner || []).forEach((s) => bannerCoverCache.set(s.id, s));
  } catch (_) { /* 读取失败不影响运行 */ }
})();
const persistCoverCache = () => {
  const payload = {
    playlists: [...playlistCoverCache.entries()],
    banner: [...bannerCoverCache.values()],
  };
  AsyncStorage.setItem(COVER_CACHE_KEY, JSON.stringify(payload)).catch(() => {});
};
const playlists = [
  { title: '华语流行', desc: '全网最烫耳的旋律都在这' },
  { title: '粤语歌曲天花板', desc: '一开口就是青春与回忆的粤语金曲' },
  { title: '中文说唱', desc: '半年榜精选' },
  { title: '古风', desc: '最值得单曲循环的古风歌合集' },
  { title: '神仙大家的年代', desc: '那些跨越年代依然耐听的经典旋律' },
  { title: '流行70 80 90', desc: '三代人的流行记忆，一次听个够' },
  { title: '忧伤民谣', desc: '适合安静时刻循环的民谣故事' },
  { title: '2026年度热门歌曲', desc: '正在刷屏的年度热门新歌合集' },
];
// 轮播图拿不到数据时只显示占位块，不再依赖 picsum.photos（国内实测不可达）。
const FALLBACK_BANNERS = [1, 2, 3].map((n) => ({ id: `banner-${n}`, name: '新歌推荐', artist: '热门新碟' }));
const artistOf = (song) => song?.ar?.map((item) => item.name).join(' / ') || song?.artists?.map?.((item) => typeof item === 'string' ? item : item.name).join(' / ') || song?.artist || '热门新碟';

function AlbumBanner({ song, onPress }) {
  return <Pressable style={styles.bannerCard} onPress={onPress}>
    <SongCover song={song} size={500} style={styles.banner} fallbackStyle={styles.bannerFallback} />
    <View style={styles.bannerShade} />
    <View style={styles.bannerText}>
      <Text style={styles.bannerTitle} numberOfLines={1}>{song?.name || '新歌推荐'}</Text>
      <Text style={styles.bannerArtist} numberOfLines={1}>{artistOf(song)}</Text>
    </View>
    <View style={styles.bannerPlay}><Ionicons name="play" size={15} color="#fff" /></View>
  </Pressable>;
}

export default function RecommendScreen({ navigation, onSelect, embedded = false, active = true }) {
  const [banner, setBanner] = useState(0);
  const [banners, setBanners] = useState(FALLBACK_BANNERS);
  const [coverSongs, setCoverSongs] = useState({});
  const bannerRef = useRef(null);
  const bannerDragging = useRef(false);
  const bannerTimers = useRef([]);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const recentSongs = useLibraryStore((s) => s.recent);
  const loaded = useRef(false);
  // 首页把这一屏常驻挂载（只是隐藏），如果不判断可见性，开屏就会替用户把
  // 轮播 + 8 个歌单封面共 9 个请求打出去，而用户可能根本不切到「推荐」。
  if (active) loaded.current = true;
  const shouldLoad = active || loaded.current;
  // 轮播：取 10 首、优先带 pic_id 的；会话内已缓存则直接出，省一次 GD 搜索（慢的主因）。
  useEffect(() => {
    if (!shouldLoad) return undefined;
    let active = true;
    const apply = (songs) => {
      const withPic = (songs || []).filter((s) => s?.pic_id);
      if (active && withPic.length) {
        setBanners(withPic.slice(0, 6).map((song) => ({ ...song, source: song.source || 'netease' })));
      }
    };
    if (bannerCoverCache.size) apply([...bannerCoverCache.values()]);
    const tryLoad = (retry) => {
      apiService.getThemeSongs('新歌', 10).then((songs) => {
        if (active && songs?.length) {
          songs.forEach((s) => bannerCoverCache.set(s.id, s));
          persistCoverCache();
          apply(songs);
        } else if (active && retry) {
          const rt = setTimeout(() => tryLoad(false), 1200);
          bannerTimers.current.push(rt);
        }
      }).catch(() => { if (active && retry) { const rt = setTimeout(() => tryLoad(false), 1200); bannerTimers.current.push(rt); } });
    };
    tryLoad(true);
    return () => { active = false; bannerTimers.current.forEach(clearTimeout); };
  }, [shouldLoad]);
  // 歌单封面：每个分类取 10 首、挑带 pic_id 的第一首；命中缓存直接出，未命中才搜 GD。
  // 错峰间隔从 150ms 降到 50ms（GD 瓶颈是延迟不是队列，过长错峰只徒增总耗时）；
  // 歌曲一拿到就 prefetchCovers 预热封面图，与 SongCover 挂载并行，省掉一次往返等待。
  useEffect(() => {
    if (!shouldLoad) return undefined;
    let active = true;
    const timers = [];
    playlists.forEach((playlist, i) => {
      const t = setTimeout(() => {
        if (!active) return;
        const cached = playlistCoverCache.get(playlist.title);
        if (cached) { setCoverSongs((prev) => ({ ...prev, [playlist.title]: cached })); return; }
        const tryLoad = (retry) => {
          apiService.getThemeSongs(playlist.title, 10).then((songs) => {
            const song = (songs || []).find((s) => s?.pic_id) || songs?.[0];
            if (active && song) {
              playlistCoverCache.set(playlist.title, song);
              persistCoverCache();
              prefetchCovers([song], 250);
              setCoverSongs((prev) => ({ ...prev, [playlist.title]: song }));
            } else if (active && retry) {
              const rt = setTimeout(() => tryLoad(false), 1200);
              timers.push(rt);
            }
          }).catch(() => { if (active && retry) { const rt = setTimeout(() => tryLoad(false), 1200); timers.push(rt); } });
        };
        tryLoad(true);
      }, i * 50);
      timers.push(t);
    });
    return () => { active = false; timers.forEach(clearTimeout); };
  }, [shouldLoad]);
  useEffect(() => { const timer = setInterval(() => { if (!bannerDragging.current) setBanner((value) => (value + 1) % Math.max(banners.length, 1)); }, 3500); return () => clearInterval(timer); }, [banners.length]);
  useEffect(() => { bannerRef.current?.scrollTo({ x: banner * 343, animated: true }); }, [banner]);
  const playBanner = (index) => { const song = banners[index]; if (!song?.id || String(song.id).startsWith('banner-')) return; const queue = banners.filter((item) => item?.id && !String(item.id).startsWith('banner-')).map((item) => ({ ...item, platform: item.platform || item.source || 'netease' })); const queueIndex = queue.findIndex((item) => String(item.id) === String(song.id)); if (queueIndex < 0) return; setQueue(queue, queueIndex); navigation?.navigate?.('Player'); };
  const playRecent = (index) => {
    const queue = recentSongs.map((song) => ({ ...song, platform: song.platform || song.source || 'netease' }));
    if (!queue.length) return;
    setQueue(queue, index);
    navigation?.navigate?.('Player');
  };
  const content = <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {!embedded ? <View style={styles.navArea}><TopNav navigation={navigation} active="推荐" onSelect={onSelect} /></View> : null}
      <View style={styles.bannerWrap}>
        <ScrollView
          ref={bannerRef}
          horizontal
          pagingEnabled
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          scrollEnabled
          onScrollBeginDrag={() => { bannerDragging.current = true; }}
          onMomentumScrollEnd={(event) => {
            const page = Math.round(event.nativeEvent.contentOffset.x / 343);
            setBanner(Math.max(0, Math.min(page, banners.length - 1)));
            bannerDragging.current = false;
          }}
        >
          {banners.map((song, index) => <AlbumBanner key={`${song.source || 'banner'}-${song.id || index}`} song={song} onPress={() => playBanner(index)} />)}
        </ScrollView>
        <View style={styles.dots}>{banners.map((_, index) => <View key={index} style={[styles.dot, index === banner && styles.dotActive]} />)}</View>
      </View>
      <SectionTitle title="推荐歌单" more onMore={() => navigation?.navigate?.('PlaylistDetail', { id: 'recommend', title: '推荐歌单', theme: '华语流行' })} />
      <View style={styles.grid}>{playlists.map((playlist, i) => <Pressable key={playlist.title} style={styles.card} onPress={() => navigation?.navigate?.('PlaylistDetail', { id: `recommend-${i}`, title: playlist.title, theme: playlist.title, description: playlist.desc, source: 'netease' })}>
        <View><SongCover song={coverSongs[playlist.title]} size={250} style={styles.playlistCover} /><View style={styles.playCount}><Ionicons name="play" size={10} color="#fff" /></View></View>
        <Text style={styles.cardTitle} numberOfLines={2}>{playlist.title}</Text><Text style={styles.cardDesc} numberOfLines={1}>{playlist.desc}</Text>
      </Pressable>)}</View>
      <SectionTitle title="最近常听" />
      {recentSongs.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>{recentSongs.slice(0, 12).map((song, i) => <Pressable key={`recent-${song.source || 'netease'}-${song.sourceTrackId || song.id}-${i}`} style={styles.recentItem} onPress={() => playRecent(i)}><SongCover song={song} style={styles.recentCover} /><Text style={styles.recentName} numberOfLines={1}>{song.name || '未知歌曲'}</Text></Pressable>)}</ScrollView> : <Text style={styles.recentEmpty}>还没有播放记录，去首页听几首就会出现在这里</Text>}
    </ScrollView>;
  return embedded ? content : <BackgroundWrapper style={styles.page}>{content}</BackgroundWrapper>;
}
function SectionTitle({ title, more, onMore }) { return <View style={styles.sectionTitle}><Text style={styles.title}>{title}</Text>{more ? <Pressable onPress={onMore}><Text style={styles.more}>更多 ›</Text></Pressable> : null}</View>; }
const styles = StyleSheet.create({page:{flex:1,backgroundColor:'#F8F8F8'},scroll:{flex:1},content:{paddingBottom:110},navArea:{backgroundColor:'#fff',paddingHorizontal:18},bannerWrap:{marginHorizontal:16,marginTop:14,height:150,borderRadius:12,overflow:'hidden'},bannerCard:{width:343,height:150,borderRadius:12,overflow:'hidden'},banner:{width:343,height:150},bannerFallback:{backgroundColor:'#d87b7b'},bannerShade:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(0,0,0,.26)'},bannerText:{position:'absolute',left:16,bottom:15,right:55},bannerTitle:{color:'#fff',fontSize:19,fontWeight:'800'},bannerArtist:{color:'rgba(255,255,255,.88)',fontSize:12,marginTop:4},bannerPlay:{position:'absolute',right:16,bottom:16,width:34,height:34,borderRadius:17,backgroundColor:'rgba(236,65,65,.94)',alignItems:'center',justifyContent:'center'},dots:{position:'absolute',bottom:7,left:0,right:0,flexDirection:'row',justifyContent:'center',gap:5},dot:{width:5,height:5,borderRadius:3,backgroundColor:'#D9D9D9'},dotActive:{width:14,backgroundColor:'#EC4141'},sectionTitle:{marginTop:22,marginHorizontal:16,marginBottom:12,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},title:{fontSize:18,fontWeight:'800',color:'#222'},more:{fontSize:14,color:'#999'},grid:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',rowGap:16,paddingHorizontal:16},card:{width:'48%'},playlistCover:{width:'100%',aspectRatio:1,borderRadius:8,backgroundColor:'#eee'},playCount:{position:'absolute',right:7,top:7,flexDirection:'row',alignItems:'center',gap:3},playCountText:{color:'#fff',fontSize:11,textShadowColor:'#000',textShadowRadius:3},cardTitle:{marginTop:7,color:'#222',fontSize:14,fontWeight:'700'},cardDesc:{marginTop:3,color:'#666',fontSize:12},horizontalList:{paddingHorizontal:16,gap:12},recentItem:{width:120,alignItems:'center'},recentCover:{width:80,height:80,borderRadius:8,backgroundColor:'#eee'},recentName:{marginTop:7,color:'#333',fontSize:13,textAlign:'center'},recentEmpty:{marginHorizontal:16,color:'#999',fontSize:13},albumItem:{width:100,alignItems:'center'},albumCover:{width:60,height:60,borderRadius:30,backgroundColor:'#eee'},albumName:{marginTop:8,color:'#222',fontSize:13,fontWeight:'700'},albumArtist:{marginTop:3,color:'#999',fontSize:11}});
