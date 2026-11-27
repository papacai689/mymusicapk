import React, { useEffect, useRef } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { BlurTargetView, BlurView } from 'expo-blur';
import { getVeilColor, useThemeStore } from '../store/themeStore';

// The wallpaper is painted once, behind the whole navigation tree, instead of
// inside each screen — that keeps it from ever covering the UI.  The layer is
// sized from the window instead of resolving from layout: an image view that
// starts with no measurable size never fires its load callback at all.
export default function AppBackground() {
  const { backgroundImage, backgroundBlur, foregroundOpacity, isDarkMode, setBackgroundStatus } = useThemeStore();
  const { width, height } = useWindowDimensions();
  const veil = getVeilColor({ isDarkMode });
  // Android only blurs a view it is handed.
  const blurTarget = useRef(null);
  useEffect(() => {
    console.warn('[theme] background', backgroundImage ? `...${backgroundImage.slice(-46)}` : 'none', 'blur=' + backgroundBlur, 'veil=' + foregroundOpacity, 'dark=' + isDarkMode, 'size=' + Math.round(width) + 'x' + Math.round(height));
  }, [backgroundImage, backgroundBlur, foregroundOpacity, isDarkMode, width, height]);
  const image = <Image
    source={{ uri: backgroundImage }}
    style={styles.image}
    contentFit="cover"
    transition={200}
    onLoad={() => {
      console.warn('[theme] background image loaded');
      if (useThemeStore.getState().backgroundStatus !== 'loaded') setBackgroundStatus('loaded');
    }}
    onError={(event) => {
      console.warn('[theme] background image failed', event?.error || event);
      if (useThemeStore.getState().backgroundStatus !== 'failed') setBackgroundStatus('failed');
    }}
  />;
  return <View
    style={[styles.host, { width, height }, isDarkMode && backgroundImage ? styles.hostDark : null]}
    pointerEvents="none"
    onLayout={() => {
      if (useThemeStore.getState().backgroundStatus === 'idle') setBackgroundStatus(`size ${Math.round(width)}x${Math.round(height)}`);
    }}
  >
    {backgroundImage ? (backgroundBlur
      ? <BlurTargetView ref={blurTarget} style={styles.layer}>{image}</BlurTargetView>
      : <View style={styles.layer}>{image}</View>) : null}
    {backgroundImage && backgroundBlur ? <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurViewSdk31Plus" intensity={55} tint={isDarkMode ? 'dark' : 'light'} style={styles.layer} /> : null}
    {foregroundOpacity > 0 ? <View style={[styles.layer, { backgroundColor: `rgba(${veil},${foregroundOpacity})` }]} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, top: 0, backgroundColor: '#f7f7fb' },
  hostDark: { backgroundColor: '#141122' },
  layer: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  image: { width: '100%', height: '100%' },
});
