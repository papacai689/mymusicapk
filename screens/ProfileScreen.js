import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import BackgroundWrapper from '../components/BackgroundWrapper';
import TopNav from '../components/TopNav';
import { useThemeStore } from '../store/themeStore';
import { hasPublicDir, pickPublicDir, clearPublicDir, isPublicCopyEnabled, setPublicCopyEnabled } from '../services/publicDownloadDir';

export default function ProfileScreen({ navigation }) {
  const textColor = useThemeStore(s => s.textColor);
  const color = textColor === 'white' ? '#fff' : textColor === 'black' ? '#111827' : '#24164f';
  const [dirReady, setDirReady] = useState(false);
  const [copyEnabled, setCopyEnabled] = useState(true);

  React.useEffect(() => {
    let alive = true;
    Promise.all([hasPublicDir(), isPublicCopyEnabled()]).then(([ready, enabled]) => {
      if (!alive) return;
      setDirReady(ready);
      setCopyEnabled(enabled);
    });
    return () => { alive = false; };
  }, []);

  const onDownloadLocation = () => {
    const buttons = [
      { text: '取消', style: 'cancel' },
      {
        text: dirReady ? '重新选择目录' : '选择公共目录',
        onPress: async () => {
          const ok = await pickPublicDir();
          if (ok) {
            setDirReady(true);
            setCopyEnabled(true);
            await setPublicCopyEnabled(true);
            Alert.alert('已设置', '之后的下载会同步一份到你选的目录。');
          }
        },
      },
    ];
    if (dirReady) {
      buttons.push({
        text: copyEnabled ? '改为仅App内部' : '恢复同步到公共目录',
        onPress: async () => {
          const next = !copyEnabled;
          await setPublicCopyEnabled(next);
          setCopyEnabled(next);
          Alert.alert('已更新', next ? '下载会同步一份到公共目录。' : '下载仅保存在 App 内部，公共目录不再新增副本。');
        },
      });
      buttons.push({ text: '清除目录设置', style: 'destructive', onPress: async () => { await clearPublicDir(); setDirReady(false); setCopyEnabled(false); } });
    }
    Alert.alert(
      '下载保存位置',
      dirReady
        ? `下载先存到 App 内部，完成后复制一份到公共目录（${copyEnabled ? '当前已开启同步' : '当前已暂停同步'}）。文件管理器可在你选的目录里看到。`
        : '下载目前只存在 App 内部（文件管理器看不到）。选一个公共目录后，下载完成会自动复制一份过去。',
      buttons,
    );
  };

  return (
    <BackgroundWrapper>
      <TopNav navigation={navigation} active="首页" />
      <View style={styles.container}>
        <Text style={[styles.title, { color }]}>我的</Text>
        <View style={styles.profile}>
          <View style={styles.avatar}><Text style={styles.avatarText}>♫</Text></View>
          <View>
            <Text style={[styles.name, { color }]}>音乐爱好者</Text>
            <Text style={[styles.sub, { color }]}>享受音乐，感受生活</Text>
          </View>
        </View>
        <Pressable style={styles.entry} onPress={onDownloadLocation}>
          <Text style={[styles.entryText, { color }]}>下载保存位置</Text>
          <Text style={[styles.chevron, { color }]}>{dirReady ? (copyEnabled ? '公共目录' : '仅内部') : '仅内部'}</Text>
        </Pressable>
        <Pressable style={styles.entry} onPress={() => navigation.navigate('ThemeSettings')}>
          <Text style={[styles.entryText, { color }]}>主题设置</Text>
          <Text style={[styles.chevron, { color }]}>›</Text>
        </Pressable>
        <Pressable style={styles.entry} onPress={() => navigation.navigate('MusicSource')}>
          <Text style={[styles.entryText, { color }]}>音乐源管理</Text>
          <Text style={[styles.chevron, { color }]}>›</Text>
        </Pressable>
        <Pressable style={styles.entry} onPress={() => navigation.navigate('PlaybackSettings')}>
          <Text style={[styles.entryText, { color }]}>播放源</Text>
          <Text style={[styles.chevron, { color }]}>›</Text>
        </Pressable>
      </View>
    </BackgroundWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 26 },
  title: { fontSize: 30, fontWeight: '800', marginTop: 28, marginBottom: 28 },
  profile: { flexDirection: 'row', alignItems: 'center', padding: 20, borderRadius: 22, backgroundColor: 'rgba(255,255,255,.45)' },
  avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#8b5cf6', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  avatarText: { fontSize: 30, color: '#fff' },
  name: { fontSize: 19, fontWeight: '700' },
  sub: { fontSize: 13, opacity: .7, marginTop: 4 },
  entry: { marginTop: 18, padding: 20, borderRadius: 18, backgroundColor: 'rgba(255,255,255,.5)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  entryText: { fontSize: 17, fontWeight: '600' },
  chevron: { fontSize: 15, opacity: .7 },
});
