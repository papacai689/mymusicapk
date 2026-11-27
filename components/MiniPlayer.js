import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { togglePlayback } from '../services/player';
import { usePlayerStore } from '../store/playerStore';
import { useThemeStore, getThemeTextColor } from '../store/themeStore';

export default function MiniPlayer({ onPress }) {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const color = useThemeStore(getThemeTextColor);

  if (!current) return null;

  const muted = color === '#fff' ? 'rgba(255,255,255,.72)' : '#6b7280';
  const bg = color === '#fff' ? 'rgba(0,0,0,.5)' : 'rgba(255,255,255,.55)';
  const artist = current.ar?.[0]?.name || current.artists?.[0]?.name || current.artist || '未知歌手';
  // With nothing loaded yet there is no audio to toggle, so hand the tap to the
  // player screen, which loads the track and resumes it at the saved position.
  const onToggle = () => {
    const store = usePlayerStore.getState();
    if (store.loadedKey) togglePlayback();
    else onPress();
  };

  return <Pressable onPress={onPress} style={[styles.bar, { backgroundColor: bg }]}>
    <View style={styles.icon}><Text style={{ color: '#fff' }}>♫</Text></View>
    <View style={{ flex: 1 }}>
      <Text style={[styles.name, { color }]} numberOfLines={1}>{current.name || current.title}</Text>
      <Text style={[styles.artist, { color: muted }]} numberOfLines={1}>{artist}</Text>
    </View>
    <Pressable onPress={onToggle} hitSlop={10}><Text style={[styles.play, { color: '#6d45f5' }]}>{isPlaying ? 'Ⅱ' : '▶'}</Text></Pressable>
  </Pressable>;
}

const styles = StyleSheet.create({ bar: { position: 'absolute', left: 12, right: 12, bottom: 76, padding: 10, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 10, elevation: 5 }, icon: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#6d45f5', alignItems: 'center', justifyContent: 'center' }, name: { fontWeight: '700' }, artist: { fontSize: 11 }, play: { fontSize: 20, padding: 8 } });
