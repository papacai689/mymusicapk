import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BackgroundWrapper from '../components/BackgroundWrapper';
import TopNav from '../components/TopNav';
import { usePlayerStore } from '../store/playerStore';
import { useThemeStore, getThemeTextColor } from '../store/themeStore';

const KEY = 'local_music_cache_v1';
const FOLDER_KEY = 'local_music_folder_uri_v1';
const AUDIO_EXTENSIONS = /\.(mp3|m4a|aac|wav|flac|ogg|opus|3gp|amr)$/i;
const formatDuration = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
const fileNameFromUri = (uri) => {
  try {
    const raw = decodeURIComponent(String(uri).split('/').pop() || '本地歌曲');
    return raw.replace(/\?.*$/, '').replace(/\.[^/.]+$/, '') || '本地歌曲';
  } catch (_) {
    return '本地歌曲';
  }
};

export default function LocalScreen({ navigation }) {
  const color = useThemeStore(getThemeTextColor);
  const muted = color === '#fff' ? 'rgba(255,255,255,.72)' : '#6b7280';
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [folderUri, setFolderUri] = useState(null);
  const [permission, setPermission] = useState(null);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const isExpoGo = Constants.appOwnership === 'expo';

  const saveSongs = async (nextSongs) => {
    setSongs(nextSongs);
    await AsyncStorage.setItem(KEY, JSON.stringify(nextSongs));
  };

  const scan = useCallback(async () => {
    if (isExpoGo) {
      Alert.alert('需要开发构建', 'Expo Go 在 Android 新权限模型下无法提供完整媒体库访问。请安装 Development Build 后再扫描系统本地音乐。');
      return;
    }
    setLoading(true);
    try {
      let p = await MediaLibrary.getPermissionsAsync();
      if (!p.granted) p = await MediaLibrary.requestPermissionsAsync();
      setPermission(p);
      if (!p.granted) {
        Alert.alert('需要音乐权限', '请在系统设置中允许访问媒体库。');
        return;
      }
      const r = await MediaLibrary.getAssetsAsync({ mediaType: 'audio', first: 1000 });
      const mapped = (r.assets || []).map((a) => ({
        id: `local-${a.id}`,
        name: (a.filename || '未知歌曲').replace(/\.[^/.]+$/, ''),
        title: (a.filename || '未知歌曲').replace(/\.[^/.]+$/, ''),
        artist: a.artist || '未知歌手',
        artists: [{ name: a.artist || '未知歌手' }],
        duration: a.duration || 0,
        uri: a.uri,
        platform: 'local',
        isLocal: true,
      }));
      await saveSongs(mapped);
    } catch (e) {
      Alert.alert('扫描失败', e?.message || '无法读取本地音乐。');
    } finally {
      setLoading(false);
    }
  }, [isExpoGo]);

  const openMusicFolder = useCallback(async () => {
    if (Platform.OS !== 'android') {
      Alert.alert('暂不支持', '打开本地音乐文件夹目前仅支持 Android。');
      return;
    }
    setLoading(true);
    try {
      const result = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(folderUri || undefined);
      if (!result?.granted || !result.directoryUri) return;
      setFolderUri(result.directoryUri);
      await AsyncStorage.setItem(FOLDER_KEY, result.directoryUri);
      const files = await FileSystem.StorageAccessFramework.readDirectoryAsync(result.directoryUri);
      const mapped = files
        .filter((uri) => AUDIO_EXTENSIONS.test(String(uri)))
        .map((uri, index) => {
          const name = fileNameFromUri(uri);
          return {
            id: `saf-${encodeURIComponent(uri)}`,
            name,
            title: name,
            artist: '本地音乐',
            artists: [{ name: '本地音乐' }],
            duration: 0,
            uri,
            platform: 'local',
            isLocal: true,
          };
        });
      await saveSongs(mapped);
      if (!mapped.length) Alert.alert('文件夹已打开', '该文件夹中没有找到支持的音频文件（mp3、m4a、aac、wav、flac、ogg 等）。');
    } catch (e) {
      Alert.alert('打开失败', e?.message || '无法读取所选音乐文件夹，请重试。');
    } finally {
      setLoading(false);
    }
  }, [folderUri]);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => v && setSongs(JSON.parse(v))).catch(() => {});
    AsyncStorage.getItem(FOLDER_KEY).then((v) => v && setFolderUri(v)).catch(() => {});
    if (!isExpoGo) MediaLibrary.getPermissionsAsync().then(setPermission).catch(() => {});
  }, [isExpoGo]);

  const play = (song) => {
    setQueue(songs, songs.findIndex((x) => x.id === song.id));
    navigation.navigate('Player');
  };

  return (
    <BackgroundWrapper>
      <TopNav navigation={navigation} active="首页" />
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={[styles.title, { color }]}>本地音乐</Text>
          <View style={styles.actions}>
            <Pressable style={styles.folderButton} onPress={openMusicFolder} disabled={loading}>
              <Text style={styles.folderText}>打开文件夹</Text>
            </Pressable>
            <Pressable style={styles.scan} onPress={scan} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.scanText}>扫描</Text>}
            </Pressable>
          </View>
        </View>
        {folderUri ? <Text style={[styles.folderHint, { color: muted }]} numberOfLines={1}>已选择音乐文件夹 · 可再次点击更换</Text> : null}
        {isExpoGo && !songs.length ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color }]}>请使用开发构建扫描系统音乐</Text>
            <Text style={[styles.emptyText, { color: muted }]}>也可以点击“打开文件夹”，选择手机中的公共音乐目录。</Text>
          </View>
        ) : permission && !permission.granted && !songs.length ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color }]}>尚未获得音乐权限</Text>
            <Text style={[styles.emptyText, { color: muted }]}>点击“扫描”并允许访问设备音频文件。</Text>
          </View>
        ) : (
          <FlatList
            data={songs}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={[styles.emptyText, { color: muted }]}>暂无本地歌曲，请打开文件夹或扫描设备音乐</Text>}
            renderItem={({ item, index }) => (
              <Pressable style={styles.row} onPress={() => play(item)}>
                <View style={styles.index}><Text style={styles.indexText}>{index + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color }]} numberOfLines={1}>{item.name}</Text>
                  <Text style={[styles.artist, { color: muted }]}>{item.artist}</Text>
                </View>
                <Text style={[styles.duration, { color: muted }]}>{formatDuration(item.duration)}</Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </BackgroundWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontSize: 28, fontWeight: '800' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  folderButton: { borderWidth: 1, borderColor: '#6d45f5', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 18 },
  folderText: { color: '#6d45f5', fontWeight: '700', fontSize: 12 },
  scan: { backgroundColor: '#6d45f5', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 18 },
  scanText: { color: '#fff', fontWeight: '700' },
  folderHint: { fontSize: 12, marginBottom: 8 },
  list: { paddingBottom: 110, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,.38)', gap: 12 },
  index: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center' },
  indexText: { color: '#6d45f5', fontWeight: '700' },
  name: { fontSize: 16, fontWeight: '700' },
  artist: { fontSize: 13, marginTop: 3 },
  duration: {},
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptyText: { textAlign: 'center', padding: 24 },
});
