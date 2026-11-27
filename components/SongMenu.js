import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// 歌曲行尾部竖三点弹出的底部菜单：下一首播放 / 收藏到我喜欢的音乐 / 下载。
// 两个详情页共用一份，避免各写一遍弹窗与关闭逻辑。
// 项目目前只有单一「我喜欢的音乐」收藏集（libraryStore.favorites），没有多歌单系统，
// 所以「收藏到歌单」落到这个集合上，文案写清楚避免误导。
export default function SongMenu({ visible, song, onClose, onPlayNext, isFavorite, onFavorite, onDownload }) {
  const items = [
    { key: 'next', label: '下一首播放', icon: 'play-forward-outline', onPress: onPlayNext },
    { key: 'fav', label: isFavorite ? '取消收藏' : '收藏到我喜欢的音乐', icon: isFavorite ? 'heart-dislike-outline' : 'heart-outline', onPress: onFavorite },
    { key: 'download', label: '下载', icon: 'download-outline', onPress: onDownload },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title} numberOfLines={1}>{song?.name || '歌曲'}</Text>
          {items.map((item) => (
            <Pressable
              key={item.key}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              onPress={() => { onClose(); item.onPress?.(); }}
            >
              <Ionicons name={item.icon} size={21} color="#333" />
              <Text style={styles.itemText}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable style={[styles.item, styles.cancel]} onPress={onClose}>
            <Text style={[styles.itemText, { color: '#999', textAlign: 'center' }]}>取消</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.42)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 24 },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#ddd', alignSelf: 'center', marginTop: 9, marginBottom: 6 },
  title: { fontSize: 14, color: '#999', textAlign: 'center', paddingHorizontal: 24, paddingVertical: 10 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24, paddingVertical: 15 },
  itemPressed: { backgroundColor: '#f4f4f4' },
  itemText: { fontSize: 16, color: '#222' },
  cancel: { borderTopWidth: 1, borderTopColor: '#f0f0f0', marginTop: 4, paddingTop: 16 },
});
