import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, FlatList, InteractionManager, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { cachedCover, resolveCover } from '../services/picCache';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useAudioPlayerStatus } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BackgroundWrapper from '../components/BackgroundWrapper';
import { apiService } from '../services/apiService';
import { cachedLyric, resolveLyric } from '../services/lyricCache';
import { isTimeoutError } from '../services/netError';
import { sharedPlayer, togglePlayback } from '../services/player';
import { usePlayerStore } from '../store/playerStore';
import { useDownloadStore } from '../store/downloadStore';
import { useLibraryStore } from '../store/libraryStore';
import { getCardSurface, getThemeTextColor, useThemeStore } from '../store/themeStore';

const formatTime = (ms = 0) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const songId = (song) => String(song?.sourceTrackId || song?.id || song?.songId || '');
// Track ids are only unique inside one music platform.  Including the source
// prevents a NetEase id and a Kuwo/Tencent id from being treated as the same
// already-loaded song when the user skips through a mixed queue.
const songKey = (song) => `${song?.source || song?.platform || (song?.isLocal ? 'local' : 'netease')}:${songId(song)}`;
// Lock-screen metadata is handed to a native record whose fields must be plain
// strings.  Queue items come from several music APIs, so a field can arrive as
// an array (artist list) or an object (album); passing those straight through
// made the native call reject and silently disabled the lock-screen controls.
const toText = (value) => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join('、');
  if (typeof value === 'object') return toText(value.name || value.title || value.text);
  return String(value);
};
// Both the native audio instance and the "which track is loaded" bookkeeping
// live outside this screen, so the mini player can drive playback on its own.
const MAX_LOAD_RETRIES = 2;
const MAX_AUTO_SKIPS = 3;
// 音质档位与 apiService 里的码率映射一一对应；GD 与网易云接口都实测支持这三档。
const QUALITY_OPTIONS = [
  { id: '128k', label: '标准', hint: '128kbps · 省流量' },
  { id: '320k', label: '高品', hint: '320kbps · 更清晰' },
  { id: 'flac', label: '无损', hint: 'FLAC · 文件较大' },
];
const parseLyrics = (raw = '') => raw.split(/\r?\n/).flatMap((line) => { const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]; const text = line.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim(); return tags.map((tag) => ({ time: (Number(tag[1]) * 60 + Number(tag[2])) * 1000, text })); }).filter((x) => x.text).sort((a, b) => a.time - b.time);

export default function PlayerScreen({ navigation }) {
  // 逐字段订阅而不是订阅整个 store。进度不再订阅 position/duration：这两个值每
  // 500ms 由 effect 写回 store 一次，若订阅就会在原生 status 更新之外再多渲染一
  // 轮。UI 进度直接读 status（见 uiPosition/uiDuration），store 里的值只用于断点
  // 续播持久化，不需要驱动渲染。
  const current = usePlayerStore((s) => s.current);
  const queue = usePlayerStore((s) => s.queue);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const mode = usePlayerStore((s) => s.mode);
  const quality = usePlayerStore((s) => s.quality);
  const setPlaying = usePlayerStore((s) => s.setPlaying);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const setProgress = usePlayerStore((s) => s.setProgress);
  const setMode = usePlayerStore((s) => s.setMode);
  const setQuality = usePlayerStore((s) => s.setQuality);
  const insets = useSafeAreaInsets();
  const tasks = useDownloadStore((s) => s.tasks);
  const startDownload = useDownloadStore((s) => s.start);
  const pauseDownload = useDownloadStore((s) => s.pause);
  const resumeDownload = useDownloadStore((s) => s.resume);
  const color = useThemeStore(getThemeTextColor);
  const muted = color === '#fff' ? 'rgba(255,255,255,.72)' : '#6b7280';
  const cardSurface = useThemeStore(getCardSurface);
  const player = sharedPlayer;
  const status = useAudioPlayerStatus(player);
  const rotation = useRef(new Animated.Value(0)).current;
  const loop = useRef(null);
  const loadRequest = useRef(0);
  const consecutiveFailures = useRef(0);
  const lyricsRef = useRef(null);
  const queueListRef = useRef(null);
  const favorites = useLibraryStore((state) => state.favorites);
  const addRecent = useLibraryStore((state) => state.addRecent);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const [lyrics, setLyrics] = useState('正在加载歌词…');
  const [viewMode, setViewMode] = useState('lyrics');
  const [showQueue, setShowQueue] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const [coverUrl, setCoverUrl] = useState(null);
  const [lyricLines, setLyricLines] = useState([]);
  const [playbackError, setPlaybackError] = useState('');
  // 试听片段（网易云 jd-musicrep-ts）只有 30 秒，标注出来免得用户以为歌本身短或播放器坏了。
  const [isTrial, setIsTrial] = useState(false);
  const currentKey = songKey(current);
  // 用 songKey 而不是裸 id 定位：队列里可能混有不同音乐平台的同号歌曲。
  const activeQueueIndex = queue.findIndex((song) => songKey(song) === currentKey);
  const liked = Boolean(current && favorites.some((song) => songKey(song) === currentKey));

  const currentTask = current ? tasks[String(current.id)] || tasks[songId(current)] : null;
  const cover = coverUrl || current?.picUrl || current?.album?.picUrl || current?.al?.picUrl;
  // UI 进度读原生 status：它本来每 500ms 更新并触发重渲染，进度条/歌词跟着它走
  // 不会再多一轮。status 未装载（冷启动恢复、切歌加载中）时回退到 store 持久化值，
  // 避免进度条闪回 0。注意这里用 getState 一次性读取，不建立订阅。
  const stored = usePlayerStore.getState();
  const uiPosition = status?.isLoaded ? (status?.currentTime || 0) * 1000 : stored.position;
  const uiDuration = status?.isLoaded ? (status?.duration || 0) * 1000 : stored.duration;
  const activeLyric = lyricLines.reduce((found, line, index) => (line.time <= uiPosition ? index : found), -1);
  const artist = toText(current?.ar) || toText(current?.artists) || toText(current?.artist) || '未知歌手';
  const progress = currentTask?.progress || 0;
  const downloadLabel = currentTask?.status === 'completed'
    ? '已下载'
    : currentTask?.status === 'downloading'
      ? `下载中 ${Math.round(progress * 100)}%`
      : currentTask?.status === 'paused'
        ? '继续下载'
        : '下载';

  useEffect(() => {
    if (isPlaying) {
      loop.current?.stop?.();
      loop.current = Animated.loop(Animated.timing(rotation, { toValue: 1, duration: 12000, easing: Easing.linear, useNativeDriver: true }));
      loop.current.start();
    } else loop.current?.stop?.();
    return () => loop.current?.stop?.();
  }, [isPlaying, rotation]);

  // A session restored from disk is not in the native player yet, so the seek
  // is deferred until the new source reports itself loaded.
  const pendingResume = useRef(0);
  useEffect(() => {
    // Nothing loaded yet: keep the position read from disk instead of blanking it.
    if (!status?.isLoaded) return;
    if (pendingResume.current > 0) {
      const target = pendingResume.current;
      pendingResume.current = 0;
      player.seekTo(target / 1000);
      player.play();
      setPlaying(true);
      setProgress(target, status?.duration ? status.duration * 1000 : usePlayerStore.getState().duration);
      return;
    }
    setProgress((status?.currentTime || 0) * 1000, (status?.duration || 0) * 1000);
    if (status?.playing !== undefined) setPlaying(status.playing);
  }, [status?.currentTime, status?.duration, status?.playing, status?.isLoaded]);

  // Auto-advance when a track ends.  Nothing used to watch the native
  // `didJustFinish` flag, so playback simply stopped at the end of every song.
  const wasFinished = useRef(false);
  useEffect(() => {
    if (!status?.didJustFinish) {
      wasFinished.current = false;
      return;
    }
    if (wasFinished.current || !current) return;
    wasFinished.current = true;
    if (mode === '单曲循环') {
      player.seekTo(0);
      player.play();
      setPlaying(true);
      return;
    }
    if (mode === '随机播放' && queue.length > 1) {
      const playing = queue.findIndex((song) => songKey(song) === currentKey);
      let pick = playing;
      while (pick === playing) pick = Math.floor(Math.random() * queue.length);
      setQueue(queue, pick);
      return;
    }
    change(next);
  }, [status?.didJustFinish, currentKey, mode, queue]);

  useEffect(() => {
    if (!current) return;
    load(current);
  }, [currentKey]);
  // Play/pause toggling lives in MiniPlayer so it keeps working before this
  // screen has ever been opened (for example right after a restored session).

  useEffect(() => {
    let cancelled = false;
    setLyricLines([]);
    if (!current) { setLyrics('选择一首歌曲开始播放'); return undefined; }
    // 命中缓存直接出词（切歌来回切尤其明显），未命中才发请求；同曲并发只发一次。
    const key = songKey(current);
    const cached = cachedLyric(key);
    if (cached) {
      setLyricLines(parseLyrics(cached));
      setLyrics(cached.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim() || '暂无歌词');
      return undefined;
    }
    setLyrics('正在加载歌词…');
    resolveLyric(key, () => apiService.getLyric(current).then((data) => (
      typeof data === 'string' ? data : (data?.lyric || data?.data?.lyric || '')
    ))).then((text) => {
      if (cancelled) return;
      setLyricLines(parseLyrics(text));
      setLyrics(text.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim() || '暂无歌词');
      // 预取下一首歌词：用户听完当前歌切过去时已命中缓存，不再等一轮网络。
      // 歌词文本只有 1KB 左右，多这一个请求几乎不耗流量。
      const nextSong = queue[(queue.findIndex((s) => songKey(s) === key) + 1) % queue.length];
      if (nextSong && nextSong !== current) {
        const nextKey = songKey(nextSong);
        if (!cachedLyric(nextKey)) {
          resolveLyric(nextKey, () => apiService.getLyric(nextSong).then((data) => (
            typeof data === 'string' ? data : (data?.lyric || data?.data?.lyric || '')
          ))).catch(() => {});
        }
      }
    }).catch(() => !cancelled && setLyrics('歌词加载失败'));
    return () => { cancelled = true; };
  }, [currentKey]);

  useEffect(() => {
    if (activeLyric >= 0) lyricsRef.current?.scrollTo({ y: Math.max(0, activeLyric * 30 - 45), animated: true });
  }, [activeLyric]);

  // 打开播放列表时把「正在播放」滚到可视区中间，否则队列长时当前歌在屏幕外，
  // 即使有高亮也看不到。等弹窗滑上来（交互结束）后再滚，避免动画打架。
  useEffect(() => {
    if (!showQueue || activeQueueIndex < 0) return undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      queueListRef.current?.scrollToIndex({ index: activeQueueIndex, animated: false, viewPosition: 0.5 });
    });
    return () => task.cancel();
  }, [showQueue, activeQueueIndex]);

  useEffect(() => {
    let cancelled = false;
    // 直接字段优先，其余交给 picCache：带缓存与并发限流，不再现发一次请求。
    const direct = current?.picUrl || current?.album?.picUrl;
    if (direct || !current?.pic_id) { setCoverUrl(direct || null); return undefined; }
    setCoverUrl(cachedCover(current, 500));
    resolveCover(current, 500).then((url) => { if (!cancelled) setCoverUrl(url); });
    return () => { cancelled = true; };
  }, [currentKey]);

  // Register this player with Android/iOS lock-screen controls. This is a
  // no-op on platforms/builds that do not expose the native controls, while
  // Development Builds can keep playing when the app is backgrounded.
  // 推迟到导航转场结束后再注册：这个原生调用在 Expo Go 里会尝试绑定后台播放
  // 服务并失败，同步执行会拖慢「点列表进播放页」那一帧的转场动画。
  // 依赖里去掉 cover：封面是异步加载的，加载完再触发一次纯属重复注册。
  useEffect(() => {
    if (!current) {
      player.clearLockScreenControls?.();
      return undefined;
    }
    const task = InteractionManager.runAfterInteractions(() => {
      const metadata = {
        title: toText(current.name || current.title) || '未知歌曲',
        artist,
        albumTitle: toText(current.album),
        artworkUrl: toText(cover) || undefined,
      };
      try {
        player.setActiveForLockScreen?.(true, metadata, {
          showSeekForward: true,
          showSeekBackward: true,
          isLiveStream: false,
        });
      } catch (error) {
        console.warn('[Audio] 锁屏控制初始化失败', error);
      }
    });
    return () => task.cancel();
  }, [currentKey, artist]);

  const load = async (song) => {
    const key = songKey(song);
    // Keep the shared audio instance and current position when returning to this screen.
    if (key && usePlayerStore.getState().loadedKey === key) return;
    const requestId = ++loadRequest.current;
    // A restored session was never handed to the native player, so claim its
    // position before the reset below overwrites it.
    const resumeAt = usePlayerStore.getState().consumeResume();
    // A previous attempt that never reached "loaded" must not leak into this track.
    pendingResume.current = 0;
    // Stop the old track as soon as the selected queue item changes. Previously
    // it kept playing while the next URL was being resolved (or after that
    // request failed), so the title belonged to the next song while the audio
    // and synchronized lyric still belonged to the previous one.
    player.pause();
    // 挂载/切歌时这几次写如果分开调用，会各自触发一次订阅与整页重渲染，扎堆在
    // 进页面那一帧就是「顿一下」。合并成一次 setState 只广播一轮。
    usePlayerStore.setState({ isPlaying: false, position: 0, duration: 0, loadedKey: '' });
    setPlaybackError('');
    setIsTrial(false);
    let lastError = null;
    for (let attempt = 0; attempt < MAX_LOAD_RETRIES; attempt += 1) {
      try {
        if (attempt > 0) {
          setPlaybackError('播放地址加载失败，正在重试…');
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        const local = tasks[songId(song)] || tasks[String(song.id)];
        const url = local?.status === 'completed' && local.fileUri
          ? local.fileUri
          : song?.isLocal ? song.uri : await apiService.getSongUrl({ ...song, platform: song.platform || song.source || 'netease' }, quality);
        if (!url) throw new Error('无法获取播放地址');
        // 兜底解析器拿到的网易云试听直链带 jd-musicrep-ts 标记（约 30 秒）。
        // 主源 GD 返回的是完整文件，不含此标记，因此不会误标。
        setIsTrial(/musicrep-ts/i.test(String(url)));
        // Do not let an older response replace a newer selected track.
        if (requestId !== loadRequest.current) return;
        player.replace(url);
        usePlayerStore.getState().setLoadedKey(key);
        if (resumeAt > 0) pendingResume.current = resumeAt;
        // 锁屏注册交给上面的 effect（已推迟到转场后、且只注册一次），这里不再
        // 同步调用原生绑定——它在网络返回后触发，正好撞上「进页面就顿」。
        if (!pendingResume.current) {
          player.play();
          setPlaying(true);
        }
        addRecent(song);
        consecutiveFailures.current = 0;
        setPlaybackError('');
        // 后台预取下一首播放地址：移动网络 RTT 高，把解析前移到「听当前歌时」，
        // 切歌时 getSongUrl 直接命中缓存。延后到交互完成后发起，不与首帧播放抢资源。
        const currentIdx = queue.findIndex((s) => songKey(s) === key);
        const nextSong = queue.length > 1 && currentIdx >= 0 ? queue[(currentIdx + 1) % queue.length] : null;
        if (nextSong && songKey(nextSong) !== key) {
          setTimeout(() => {
            if (requestId === loadRequest.current) {
              apiService.prefetchSongUrl({ ...nextSong, platform: nextSong.platform || nextSong.source || 'netease' }, quality).catch(() => {});
            }
          }, 1200);
        }
        return;
      } catch (error) {
        lastError = error;
        if (requestId !== loadRequest.current) return;
        // 超时或连不上就不再重试：一遍遍等满次数只会让用户干等，直接交给下面的
        // 切下一首逻辑，让播放尽快继续。
        if (isTimeoutError(error)) break;
      }
    }
    if (requestId !== loadRequest.current) return;
    console.warn('[PlayerScreen] 播放失败', lastError);
    player.pause();
    setPlaying(false);
    consecutiveFailures.current += 1;
    const canSkip = queue.length > 1 && consecutiveFailures.current <= MAX_AUTO_SKIPS;
    if (canSkip) {
      setPlaybackError('当前歌曲暂时无法播放，正在切换下一首…');
      setTimeout(() => {
        if (requestId === loadRequest.current) next();
      }, 350);
    } else {
      setPlaybackError('当前歌曲暂时无法播放，请稍后重试或手动切换歌曲');
    }
  };

  // 换音质要重新解析播放地址：先记下当前进度标记成「待续播」，重载后跳回原位继续放，
  // 否则每次切换都会从 0:00 开始。用 ref 挡掉首次渲染，避免一进页面就重载。
  const appliedQuality = useRef(quality);
  useEffect(() => {
    if (appliedQuality.current === quality) return;
    appliedQuality.current = quality;
    const state = usePlayerStore.getState();
    const song = state.current;
    if (!song) return;
    if (state.position > 5000) usePlayerStore.setState({ resumePending: true, resumePosition: state.position });
    state.setLoadedKey('');
    load(song);
  }, [quality]);

  const qualityLabel = QUALITY_OPTIONS.find((option) => option.id === quality)?.label || '标准';
  const pickQuality = (id) => {
    setShowQuality(false);
    if (id === quality) return;
    setQuality(id);
  };
  // 直接驱动原生实例，不再绕 store 计数 + 迷你播放器 effect 那一圈。
  // 曲目还没装载（例如刚恢复的会话）时先装载，装载完成后由 load 自己开始播放。
  const toggle = () => {
    if (!current) return;
    if (!usePlayerStore.getState().loadedKey) { load(current); return; }
    togglePlayback();
  };
  const change = (fn) => { fn(); };
  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  // 进度每 500ms 触发一次重渲染，唱片和歌词列表本身没变，没必要跟着重建几十个节点。
  const discBlock = useMemo(() => <Animated.View style={[styles.disc, { transform: [{ rotate }] }]}>
    <View style={styles.discRing}>{cover ? <Image source={{ uri: cover }} contentFit="cover" style={styles.cover} onError={() => setCoverUrl(null)} /> : <Ionicons name="musical-notes" size={80} color="#fff" />}</View>
    <View style={styles.centerDot} />
  </Animated.View>, [cover, rotate]);
  const lyricsBlock = useMemo(() => <ScrollView ref={lyricsRef} contentContainerStyle={styles.lyricsContent}>
    {lyricLines.length ? lyricLines.map((line, index) => <Text key={`${line.time}-${index}`} style={[styles.lyricsText, { color: index === activeLyric ? '#e11d48' : muted, fontWeight: index === activeLyric ? '800' : '400' }]}>{line.text}</Text>) : <Text style={[styles.lyricsText, { color: muted }]}>{lyrics}</Text>}
  </ScrollView>, [lyricLines, activeLyric, muted, lyrics]);
  // setMode 只接受具体值（不是函数式 updater），必须先算出下一个模式再传入。
  // 之前误传了 updater 函数，导致每次都被 store 兜底成「列表循环」，点了没反应。
  const cycleMode = () => {
    const order = ['列表循环', '单曲循环', '随机播放'];
    const index = order.indexOf(mode);
    setMode(order[(index + 1) % order.length]);
  };
  const onDownload = () => {
    if (!current || currentTask?.status === 'completed') return;
    if (currentTask?.status === 'downloading') pauseDownload(String(current.id));
    else if (currentTask?.status === 'paused') resumeDownload(String(current.id));
    else startDownload(current);
  };

  return <BackgroundWrapper>
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation?.goBack?.()} hitSlop={12}><Ionicons name="chevron-down" size={28} color={color} /></Pressable>
        <Text style={[styles.headerTitle, { color }]}>正在播放</Text>
        <Pressable onPress={() => {}} hitSlop={12}><Ionicons name="ellipsis-horizontal" size={25} color={color} /></Pressable>
      </View>
      <View style={styles.body}>
        <Pressable style={styles.visualStage} onPress={() => setViewMode((value) => value === 'cover' ? 'lyrics' : 'cover')}>
        {viewMode === 'cover' ? discBlock : <View style={[styles.lyrics, { backgroundColor: 'transparent' }]}>{lyricsBlock}</View>}
        </Pressable>
        <View style={styles.bottomPanel}>
        <View style={styles.metaRow}>
          <View style={{ flex: 1 }}><Text style={[styles.name, { color }]} numberOfLines={1}>{current?.name || '请选择歌曲'}</Text><Text style={[styles.artist, { color: muted }]} numberOfLines={1}>{artist}</Text>{isTrial ? <Text style={styles.playbackError}>试听片段 · 约 30 秒</Text> : null}{playbackError ? <Text style={styles.playbackError}>{playbackError}</Text> : null}</View>
          <Pressable onPress={() => toggleFavorite(current)} disabled={!current}><Ionicons name={liked ? 'heart' : 'heart-outline'} size={28} color={liked ? '#ef4444' : color} /></Pressable>
        </View>
        <View style={styles.tools}><Pressable onPress={onDownload} disabled={!current || currentTask?.status === 'completed'}><Ionicons name={currentTask?.status === 'completed' ? 'checkmark-circle' : 'download-outline'} size={25} color={currentTask?.status === 'completed' ? '#22c55e' : color} /><Text style={[styles.toolText, { color: muted }]}>{downloadLabel}</Text></Pressable><Pressable onPress={() => setShowQueue((v) => !v)}><Ionicons name="list-outline" size={24} color={showQueue ? '#e11d48' : color} /><Text style={[styles.toolText, { color: muted }]}>播放列表</Text></Pressable><Pressable onPress={() => setShowQuality(true)}><Ionicons name="sparkles-outline" size={24} color={color} /><Text style={[styles.toolText, { color: muted }]}>{qualityLabel}</Text></Pressable></View>
        <View style={styles.progressRow}><Text style={[styles.time, { color: muted }]}>{formatTime(uiPosition)}</Text><Slider style={styles.slider} minimumValue={0} maximumValue={uiDuration || 1} value={uiPosition} onSlidingComplete={(v) => player.seekTo(v / 1000)} minimumTrackTintColor="#e11d48" maximumTrackTintColor="rgba(255,255,255,.38)" thumbTintColor="#e11d48"/><Text style={[styles.time, { color: muted }]}>{formatTime(uiDuration)}</Text></View>
        <View style={[styles.controls, { paddingBottom: Math.max(8, insets.bottom) }]}><Pressable onPress={cycleMode} style={styles.modeBtn}><Ionicons name={mode === '随机播放' ? 'shuffle' : mode === '单曲循环' ? 'repeat' : 'repeat-outline'} size={23} color={mode === '列表循环' ? muted : '#e11d48'} />{mode === '单曲循环' ? <Text style={styles.modeOneBadge}>1</Text> : null}<Text style={[styles.modeText, { color: muted }]}>{mode}</Text></Pressable><Pressable onPress={() => change(prev)}><Ionicons name="play-skip-back" size={35} color={color} /></Pressable><Pressable onPress={toggle} style={styles.play}><Ionicons name={isPlaying ? 'pause' : 'play'} size={30} color="#fff" /></Pressable><Pressable onPress={() => change(next)}><Ionicons name="play-skip-forward" size={35} color={color} /></Pressable><Pressable onPress={() => setShowQueue((v) => !v)}><Ionicons name="list" size={25} color={muted} /></Pressable></View>
        </View>
      </View>
      <Modal visible={showQueue} transparent animationType="slide" onRequestClose={() => setShowQueue(false)}>
        <Pressable style={styles.queueOverlay} onPress={() => setShowQueue(false)}>
          <Pressable style={[styles.queueSheet, { backgroundColor: cardSurface }]} onPress={(event) => event.stopPropagation()}>
            <View style={styles.queueHandle} />
            <View style={styles.queueHeader}><Text style={[styles.queueTitle, { color }]}>播放列表（{queue.length}）</Text><Pressable onPress={() => setShowQueue(false)}><Ionicons name="close" size={24} color={muted} /></Pressable></View>
            {queue.length ? <FlatList
              ref={queueListRef}
              style={styles.queueScroll}
              contentContainerStyle={styles.queueContent}
              data={queue}
              keyExtractor={(item, index) => `${item.id || item.songId || item.sourceTrackId}-${index}`}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={5}
              removeClippedSubviews
              onScrollToIndexFailed={({ index, averageItemLength }) => queueListRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false })}
              renderItem={({ item, index }) => {
                const active = index === activeQueueIndex;
                return <Pressable style={styles.queueRow} onPress={() => { setQueue(queue, index); setShowQueue(false); }}><Text style={[styles.queueIndex, { color: active ? '#e11d48' : muted }]}>{index + 1}</Text><Text style={[styles.queueItem, { color: active ? '#e11d48' : color, fontWeight: active ? '700' : '400' }]} numberOfLines={1}>{item.name || item.title || '未知歌曲'}</Text>{active && <Ionicons name="volume-high" size={16} color="#e11d48" />}</Pressable>;
              }}
            /> : <Text style={[styles.queueItem, { color: muted }]}>播放列表为空</Text>}
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={showQuality} transparent animationType="slide" onRequestClose={() => setShowQuality(false)}>
        <Pressable style={styles.queueOverlay} onPress={() => setShowQuality(false)}>
          <Pressable style={[styles.queueSheet, { backgroundColor: cardSurface }]} onPress={(event) => event.stopPropagation()}>
            <View style={styles.queueHandle} />
            <View style={styles.queueHeader}><Text style={[styles.queueTitle, { color }]}>选择音质</Text><Pressable onPress={() => setShowQuality(false)}><Ionicons name="close" size={24} color={muted} /></Pressable></View>
            {QUALITY_OPTIONS.map((option) => <Pressable key={option.id} style={[styles.qualityRow, quality === option.id && styles.qualityRowActive]} onPress={() => pickQuality(option.id)}>
              <View style={{ flex: 1 }}><Text style={[styles.qualityLabel, { color }]}>{option.label}</Text><Text style={[styles.qualityHint, { color: muted }]}>{option.hint}</Text></View>
              <Text style={styles.qualityCheck}>{quality === option.id ? '✓' : ''}</Text>
            </Pressable>)}
            <Text style={[styles.qualityFoot, { color: muted }]}>切换后会重新获取当前歌曲的播放地址，并从原进度继续播放。实际音质以音乐源返回的码率为准。</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  </BackgroundWrapper>;
}

const styles = StyleSheet.create({
  qualityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 14, borderRadius: 14, marginBottom: 8 },
  qualityRowActive: { backgroundColor: 'rgba(225,29,72,.10)' },
  qualityLabel: { fontSize: 16, fontWeight: '700' },
  qualityHint: { marginTop: 3, fontSize: 12 },
  qualityCheck: { color: '#e11d48', fontSize: 18, fontWeight: '800' },
  qualityFoot: { marginTop: 10, fontSize: 12, lineHeight: 18 },
  screen: { flex: 1 }, body: { flex: 1 }, visualStage: { flex: 1, width: '100%', minHeight: 220, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }, bottomPanel: { width: '100%', paddingHorizontal: 24, paddingTop: 8 }, header: { height: 64, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerTitle: { fontSize: 18, fontWeight: '700' }, content: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 30 }, disc: { width: 275, height: 275, borderRadius: 138, marginTop: 20, backgroundColor: '#171717', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: .3, shadowRadius: 14, elevation: 8 }, discRing: { width: 235, height: 235, borderRadius: 118, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#8b5cf6', borderWidth: 7, borderColor: '#2d2d2d' }, cover: { width: '100%', height: '100%' }, centerDot: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: '#f5f5f5', borderWidth: 5, borderColor: '#666' }, metaRow: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12 }, name: { fontSize: 23, fontWeight: '800' }, artist: { marginTop: 6, fontSize: 14 }, playbackError: { marginTop: 5, color: '#ef4444', fontSize: 12 }, lyrics: { width: '100%', height: '100%', maxHeight: 360, borderRadius: 16, padding: 15, justifyContent: 'center' }, lyricsContent: { paddingVertical: 120 }, lyricsTitle: { fontWeight: '700', marginBottom: 8, textAlign: 'center' }, lyricsScroll: { maxHeight: 95 },  lyricsText: { lineHeight: 30, fontSize: 14, textAlign: 'center', paddingHorizontal: 8 }, queueOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.45)' }, queueSheet: { maxHeight: '72%', minHeight: 220, backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 24, shadowColor: '#000', shadowOpacity: .25, shadowRadius: 12, elevation: 12 }, queueHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: 'rgba(127,127,127,.55)', marginBottom: 10 }, queueHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10 }, queueTitle: { fontWeight: '700', fontSize: 17 }, queueScroll: { flexGrow: 0 }, queueContent: { paddingBottom: 8 }, queueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(127,127,127,.2)' }, queueIndex: { width: 24, fontSize: 12, textAlign: 'center' }, queueItem: { flex: 1, paddingVertical: 5, fontSize: 13 },  switcher: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,.18)', borderRadius: 22, padding: 3, marginTop: 20 }, switchButton: { minWidth: 90, paddingVertical: 8, borderRadius: 18, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center' }, switchActive: { backgroundColor: '#e11d48' }, switchText: { fontSize: 13, fontWeight: '700' }, tools: { width: '100%', flexDirection: 'row', justifyContent: 'space-around', marginTop: 10 }, toolText: { marginTop: 4, fontSize: 11, textAlign: 'center' }, progressRow: { width: '100%', flexDirection: 'row', alignItems: 'center', marginTop: 12 }, slider: { flex: 1, marginHorizontal: 8 }, time: { width: 38, fontSize: 11 }, controls: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }, play: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#e11d48', alignItems: 'center', justifyContent: 'center' }, modeText: { fontSize: 10, marginTop: 2 }, modeBtn: { position: 'relative', alignItems: 'center', minWidth: 34 }, modeOneBadge: { position: 'absolute', top: -3, right: 2, fontSize: 10, fontWeight: '800', color: '#e11d48' }, });

