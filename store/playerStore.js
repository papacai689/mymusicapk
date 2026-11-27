import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = '@my-music-player/player-v1';
export const PLAY_MODES = ['列表循环', '单曲循环', '随机播放'];
// 音质档位：GD 与网易云官方接口都实测支持这三档（999 那档实际为 FLAC）。
export const QUALITIES = ['128k', '320k', 'flac'];
// Position ticks every 500ms while playing, so disk writes are throttled
// instead of hitting AsyncStorage on every update.
const WRITE_INTERVAL = 4000;
// Below this we treat a saved position as "just started" and ignore it.
const RESUME_THRESHOLD = 5000;

// 队列/当前歌曲写盘前去掉 playUrl：它是 oiapi 返回的带时效签名直链，getSongUrl
// 每次都会重新解析、从不读这个字段，存进盘里既占空间又必然过期。100 首队列每 4s
// 整包 JSON.stringify 一次，这个字段是最大的纯冗余。其余字段（封面直链、歌手、
// id 等）都是恢复播放/秒出封面/收藏下载所需，一律保留，避免瘦身影响功能。
const compactSong = (song) => {
  if (!song || typeof song !== 'object') return song;
  const { playUrl, ...rest } = song;
  return rest;
};

const snapshot = (state) => ({
  queue: (state.queue || []).map(compactSong),
  index: state.index,
  current: compactSong(state.current),
  position: Math.round(state.position || 0),
  duration: Math.round(state.duration || 0),
  mode: state.mode,
  quality: state.quality,
});

const write = (state) => {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot(state))).catch(() => {});
};

// Actions that move to another track invalidate the saved resume point.
const trackChange = { resumePending: false, resumePosition: 0 };

export const usePlayerStore = create((set, get) => ({
  queue: [], index: 0, current: null, isPlaying: false, position: 0, duration: 0,
  playUrl: null, mode: '列表循环', quality: '128k', hydrated: false,
  // Set while a session restored from disk has not been loaded into the native
  // player yet, so the player can resume instead of starting from 0:00.
  resumePending: false, resumePosition: 0,
  // Key of the track currently loaded in the shared native player.
  loadedKey: '',
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const queue = Array.isArray(saved.queue) ? saved.queue : [];
        const index = Number.isInteger(saved.index) && saved.index >= 0 && saved.index < queue.length ? saved.index : 0;
        const current = saved.current || queue[index] || null;
        const position = Number(saved.position) > 0 ? Number(saved.position) : 0;
        set({
          queue,
          index,
          current,
          position,
          duration: Number(saved.duration) > 0 ? Number(saved.duration) : 0,
          mode: PLAY_MODES.includes(saved.mode) ? saved.mode : '列表循环',
          quality: QUALITIES.includes(saved.quality) ? saved.quality : '128k',
          isPlaying: false,
          resumePending: Boolean(current) && position > RESUME_THRESHOLD,
          resumePosition: position,
        });
      }
    } catch (error) {
      console.warn('[playerStore] 读取播放进度失败', error);
    } finally {
      set({ hydrated: true });
    }
  },
  setQueue: (queue, index = 0) => set({ queue, index, current: queue[index] || null, ...trackChange }),
  setCurrent: (current) => set({ current, ...trackChange }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setMode: (mode) => set({ mode: PLAY_MODES.includes(mode) ? mode : '列表循环' }),
  // 切换音质本身不重新取地址，由播放页监听这个变化后重载当前曲目。
  setQuality: (quality) => set({ quality: QUALITIES.includes(quality) ? quality : '128k' }),
  setLoadedKey: (loadedKey) => set({ loadedKey: loadedKey || '' }),
  setProgress: (position, duration) => set({ position, duration }),
  // Hands the restored position to the player once, then forgets it so a later
  // replay of the same track starts from the beginning.
  consumeResume: () => {
    const { resumePending, resumePosition } = get();
    if (!resumePending) return 0;
    set({ resumePending: false });
    return resumePosition > RESUME_THRESHOLD ? resumePosition : 0;
  },
  next: () => {
    const s = get();
    const i = s.queue.length ? (s.index + 1) % s.queue.length : 0;
    set({ index: i, current: s.queue[i] || null, ...trackChange });
    return s.queue[i];
  },
  prev: () => {
    const s = get();
    const i = s.queue.length ? (s.index - 1 + s.queue.length) % s.queue.length : 0;
    set({ index: i, current: s.queue[i] || null, ...trackChange });
    return s.queue[i];
  },
  // 把歌曲插到「当前播放」的下一首；若当前队列为空则作为唯一一首。
  // 用 source:id 去重，避免同一首歌在队列里重复出现。
  playNext: (song) => {
    if (!song) return;
    const s = get();
    const key = (x) => `${x?.source || x?.platform || 'netease'}:${x?.sourceTrackId || x?.id || x?.songId || ''}`;
    const target = key(song);
    const queue = s.queue.filter((x) => key(x) !== target);
    const insertAt = queue.length ? Math.min(s.index + 1, queue.length) : 0;
    queue.splice(insertAt, 0, song);
    // 插在当前歌之后，当前播放位置和 current 都不变；队列为空时新歌成为当前。
    if (!s.queue.length) set({ queue, index: 0, current: song, ...trackChange });
    else set({ queue });
  },
}));

let lastWrite = 0;
let pendingWrite = null;
// 写盘绝不能落在状态变更的同步调用栈里：点列表切歌时 setQueue 会把整条队列
// （可能上百首完整歌曲对象）换进 store，此刻同步 JSON.stringify + setItem 会
// 卡住导航转场那一帧，表现就是「点歌进播放页顿一下」。统一推到下一个事件循环。
const scheduleWrite = (state) => setTimeout(() => write(state), 0);
usePlayerStore.subscribe((state) => {
  if (!state.hydrated) return;
  const now = Date.now();
  if (now - lastWrite >= WRITE_INTERVAL) {
    lastWrite = now;
    scheduleWrite(state);
    return;
  }
  if (pendingWrite) return;
  pendingWrite = setTimeout(() => {
    pendingWrite = null;
    lastWrite = Date.now();
    const latest = usePlayerStore.getState();
    if (latest.hydrated) write(latest);
  }, WRITE_INTERVAL - (now - lastWrite));
});
