import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = '@music_app/library_v1';
const MAX_RECENT = 50;
const songKey = (song) => `${song?.source || song?.platform || (song?.isLocal ? 'local' : 'netease')}:${song?.sourceTrackId || song?.id || song?.songId || ''}`;

const compactSong = (song) => {
  if (!song) return null;
  return {
    id: song.id ?? song.sourceTrackId ?? song.songId,
    sourceTrackId: song.sourceTrackId ?? song.id ?? song.songId,
    source: song.source ?? song.platform ?? 'netease',
    platform: song.platform,
    name: song.name ?? song.title ?? '未知歌曲',
    ar: Array.isArray(song.ar) ? song.ar : Array.isArray(song.artists) ? song.artists : song.artist ? [{ name: song.artist }] : [],
    artists: song.artists,
    artist: song.artist,
    album: song.album ? { name: song.album.name, picUrl: song.album.picUrl } : song.al ? { name: song.al.name, picUrl: song.al.picUrl } : undefined,
    pic_id: song.pic_id,
    picUrl: song.picUrl,
    lyric_id: song.lyric_id,
    isLocal: song.isLocal,
    uri: song.uri,
  };
};

const persist = async (recent, favorites) => {
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ recent, favorites })); }
  catch (error) { console.warn('[libraryStore] 保存失败', error); }
};

export const useLibraryStore = create((set, get) => ({
  recent: [], favorites: [], hydrated: false,
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      set({ recent: Array.isArray(parsed.recent) ? parsed.recent : [], favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [], hydrated: true });
    } catch (error) { console.warn('[libraryStore] 读取失败', error); set({ hydrated: true }); }
  },
  addRecent: (song) => {
    const item = compactSong(song); if (!item) return;
    const key = songKey(item);
    const recent = [item, ...get().recent.filter((entry) => songKey(entry) !== key)].slice(0, MAX_RECENT);
    set({ recent }); persist(recent, get().favorites);
  },
  toggleFavorite: (song) => {
    const item = compactSong(song); if (!item) return false;
    const favorites = get().favorites; const key = songKey(item);
    const exists = favorites.some((entry) => songKey(entry) === key);
    const next = exists ? favorites.filter((entry) => songKey(entry) !== key) : [item, ...favorites];
    set({ favorites: next }); persist(get().recent, next); return !exists;
  },
  removeFavorite: (song) => { const key = songKey(song); const favorites = get().favorites.filter((entry) => songKey(entry) !== key); set({ favorites }); persist(get().recent, favorites); },
  isFavorite: (song) => get().favorites.some((entry) => songKey(entry) === songKey(song)),
}));

export { songKey as librarySongKey };

