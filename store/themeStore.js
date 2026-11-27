import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { clearThemeImages, themeImageExists } from '../services/themeImage';

// v6: another deliberate reset.  The layering bug hid every screen behind the
// wallpaper, so the in-app reset button could not be reached either — bumping
// the key is the only way to get back to a usable state without the user
// fighting a covered UI.
const STORAGE_KEY = '@my-music-player/theme-v6';
export const DEFAULT_PRIMARY_COLOR = '#6d45f5';
export const DEFAULT_FOREGROUND_OPACITY = 0.42;
export const PRIMARY_PRESETS = ['#6d45f5', '#e11d48', '#f97316', '#10b981', '#0ea5e9', '#8b5cf6'];
const MAX_FOREGROUND_OPACITY = 0.9;
const TEXT_COLORS = ['auto', 'black', 'white'];

const clampOpacity = (value) => Math.max(0, Math.min(MAX_FOREGROUND_OPACITY, Number(value) || 0));
const isHexColor = (value) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
const isTextColor = (value) => TEXT_COLORS.includes(value);

// The backdrop is only truly dark when a picture sits behind a dark veil, so
// "auto" text stays dark otherwise — that keeps every existing screen readable
// while the surface components below adopt dark mode one by one.
const hasDarkBackdrop = (state) => Boolean(state.isDarkMode && state.backgroundImage);

export const getThemeTextColor = (state) => {
  if (state.textColor === 'white') return '#fff';
  if (state.textColor === 'black') return '#111827';
  return hasDarkBackdrop(state) ? '#fff' : '#24164f';
};

export const getMutedTextColor = (state) => (getThemeTextColor(state) === '#fff' ? 'rgba(255,255,255,.72)' : '#6b7280');

// Surfaces used by ThemedCard and by any screen that opts into dark mode.
export const getSurfaceColor = (state) => (hasDarkBackdrop(state) ? 'rgba(20,16,38,.5)' : 'rgba(255,255,255,.45)');
export const getSurfaceBorderColor = (state) => (hasDarkBackdrop(state) ? 'rgba(255,255,255,.14)' : 'rgba(36,22,79,.08)');
// Panels and list rows: translucent enough that the wallpaper reads through,
// opaque enough that dark text stays legible on top of it.
export const getCardSurface = (state) => (hasDarkBackdrop(state) ? 'rgba(20,16,38,.42)' : 'rgba(255,255,255,.38)');
// Bars (top nav, sticky headers) need a bit more body than cards.
export const getBarSurface = (state) => (hasDarkBackdrop(state) ? 'rgba(16,12,30,.55)' : 'rgba(255,255,255,.45)');
// The veil that keeps text readable over a picture: dark veil in dark mode.
export const getVeilColor = (state) => (state.isDarkMode ? '0,0,0' : '255,255,255');

const snapshot = (state) => ({
  backgroundImage: state.backgroundImage,
  backgroundBlur: state.backgroundBlur,
  foregroundOpacity: state.foregroundOpacity,
  primaryColor: state.primaryColor,
  textColor: state.textColor,
  isDarkMode: state.isDarkMode,
});

export const useThemeStore = create((set, get) => {
  const loadTheme = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const image = typeof saved.backgroundImage === 'string' && saved.backgroundImage ? saved.backgroundImage : null;
        set({
          backgroundImage: image,
          backgroundBlur: Boolean(saved.backgroundBlur),
          foregroundOpacity: typeof saved.foregroundOpacity === 'number' ? clampOpacity(saved.foregroundOpacity) : DEFAULT_FOREGROUND_OPACITY,
          primaryColor: isHexColor(saved.primaryColor) ? saved.primaryColor : DEFAULT_PRIMARY_COLOR,
          textColor: isTextColor(saved.textColor) ? saved.textColor : 'auto',
          isDarkMode: Boolean(saved.isDarkMode),
        });
        // A saved picture may have been deleted or cleaned out of the cache.
        if (image && !(await themeImageExists(image))) set({ backgroundImage: null });
      }
      // No picture in use: drop leftovers so a reset really removes them.
      if (!get().backgroundImage) await clearThemeImages();
    } catch (error) {
      console.warn('[themeStore] 读取主题失败', error);
    } finally {
      set({ hydrated: true });
    }
  };

  const saveTheme = async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot(get())));
      set({ savedAt: Date.now() });
    } catch (error) {
      console.warn('[themeStore] 保存主题失败', error);
    }
  };

  const resetTheme = async () => {
    set({
      backgroundImage: null,
      backgroundBlur: false,
      foregroundOpacity: DEFAULT_FOREGROUND_OPACITY,
      primaryColor: DEFAULT_PRIMARY_COLOR,
      textColor: 'auto',
      isDarkMode: false,
      backgroundStatus: 'idle',
    });
    await clearThemeImages();
    await saveTheme();
  };

  return {
    backgroundImage: null,
    backgroundBlur: false,
    foregroundOpacity: DEFAULT_FOREGROUND_OPACITY,
    primaryColor: DEFAULT_PRIMARY_COLOR,
    textColor: 'auto',
    isDarkMode: false,
    hydrated: false,
    savedAt: 0,
    // Transient render report from BackgroundWrapper, shown in the settings
    // screen so a broken background can be diagnosed without reading logs.
    backgroundStatus: 'idle',
    setBackgroundImage: (backgroundImage) => set({ backgroundImage: backgroundImage || null }),
    setBackgroundBlur: (backgroundBlur) => set({ backgroundBlur: Boolean(backgroundBlur) }),
    setForegroundOpacity: (foregroundOpacity) => set({ foregroundOpacity: clampOpacity(foregroundOpacity) }),
    setPrimaryColor: (primaryColor) => set({ primaryColor: isHexColor(primaryColor) ? primaryColor : DEFAULT_PRIMARY_COLOR }),
    setTextColor: (textColor) => set({ textColor: isTextColor(textColor) ? textColor : 'auto' }),
    setIsDarkMode: (isDarkMode) => set({ isDarkMode: Boolean(isDarkMode) }),
    setBackgroundStatus: (backgroundStatus) => set({ backgroundStatus }),
    loadTheme,
    // App startup keeps using the original name; both point at the same loader.
    hydrate: loadTheme,
    saveTheme,
    resetTheme,
  };
});

// Changes are persisted automatically too, so a crash cannot lose them.
useThemeStore.subscribe((state) => {
  if (!state.hydrated) return;
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot(state))).catch(() => {});
});
