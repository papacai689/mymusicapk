import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import Slider from '@react-native-community/slider';
import BackgroundWrapper from '../components/BackgroundWrapper';
import ThemedCard from '../components/ThemedCard';
import ThemedText from '../components/ThemedText';
import TopNav from '../components/TopNav';
import { PRIMARY_PRESETS, getMutedTextColor, getThemeTextColor, useThemeStore } from '../store/themeStore';
import { THEME_IMAGE_DIR, clearThemeImages, persistThemeImage, removeThemeImage } from '../services/themeImage';

const TEXT_OPTIONS = [['auto', '自动'], ['black', '黑色'], ['white', '白色']];

export default function ThemeSettingsScreen({ navigation }) {
  const {
    backgroundImage, backgroundBlur, foregroundOpacity, primaryColor, textColor, isDarkMode,
    backgroundStatus, savedAt,
    setBackgroundImage, setBackgroundBlur, setForegroundOpacity, setPrimaryColor, setTextColor, setIsDarkMode,
    saveTheme, resetTheme,
  } = useThemeStore();
  const color = useThemeStore(getThemeTextColor);
  const muted = useThemeStore(getMutedTextColor);
  const [busy, setBusy] = useState(false);
  const [hexInput, setHexInput] = useState('');
  const [warning, setWarning] = useState('');

  const savedInApp = Boolean(backgroundImage && backgroundImage.startsWith(THEME_IMAGE_DIR));
  const renderLabel = !backgroundStatus || backgroundStatus === 'idle' ? '尚未渲染'
    : backgroundStatus === 'loaded' ? '已渲染'
    : backgroundStatus === 'failed' ? '渲染失败'
    : '已布局，未报告加载';

  const chooseBackground = async () => {
    if (busy) return;
    try {
      // No permission request: Android's system photo picker needs none, and
      // asking for media-library access fails inside Expo Go.
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
      const picked = result.assets?.[0]?.uri;
      if (result.canceled || !picked) return;
      const previous = backgroundImage;
      setWarning('');
      setBackgroundImage(picked);
      setBusy(true);
      try {
        const stored = await persistThemeImage(picked);
        setBackgroundImage(stored);
        await removeThemeImage(previous);
        await saveTheme();
      } catch (error) {
        setWarning('这张图目前只是临时引用，重启后可能失效，建议换一张再试。');
      }
    } catch (error) {
      Alert.alert('选择失败', error?.message || '无法打开相册，请稍后再试。');
    } finally {
      setBusy(false);
    }
  };

  const removeBackground = async () => {
    setBackgroundImage(null);
    await clearThemeImages();
    await saveTheme();
  };

  const restoreDefaults = async () => {
    setWarning('');
    await resetTheme();
  };

  const applyHex = () => {
    const value = hexInput.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
      Alert.alert('颜色格式不对', '请填入六位十六进制颜色，例如 #7c3aed。');
      return;
    }
    setPrimaryColor(value.toLowerCase());
    setHexInput('');
  };

  return <BackgroundWrapper><TopNav navigation={navigation} active="" />
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}><Text style={[styles.back, { color }]}>‹</Text></Pressable>
        <ThemedText variant="title" style={styles.title}>主题设置</ThemedText>
        <View style={{ width: 28 }} />
      </View>

      <ThemedCard style={styles.card}>
        <ThemedText variant="subtitle" style={styles.label}>全局背景图</ThemedText>
        {backgroundImage
          ? <Image source={{ uri: backgroundImage }} style={styles.thumb} contentFit="cover" />
          : <View style={[styles.thumb, styles.thumbEmpty]}><ThemedText muted variant="caption">还没有背景图</ThemedText></View>}
        <Pressable style={[styles.primaryButton, { backgroundColor: primaryColor }, busy ? styles.busy : null]} onPress={chooseBackground} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{backgroundImage ? '更换图片' : '选择图片'}</Text>}
        </Pressable>
        {backgroundImage ? <Pressable style={styles.ghostButton} onPress={removeBackground}><ThemedText variant="caption" weight="700">移除背景图</ThemedText></Pressable> : null}
        <Pressable style={styles.ghostButton} onPress={restoreDefaults}><ThemedText variant="caption" weight="700">恢复默认设置</ThemedText></Pressable>
        {warning ? <Text style={styles.warning}>{warning}</Text> : null}
        <ThemedText muted variant="caption">图片会复制到应用目录保存，重启或更新都不会丢。</ThemedText>
        <ThemedText muted variant="caption">状态：{backgroundImage ? (savedInApp ? '已保存到应用目录' : '临时引用，未保存') : '未设置背景图'}{backgroundImage ? ` · 背景${renderLabel}` : ''}</ThemedText>
      </ThemedCard>

      <ThemedCard style={styles.card}>
        <ThemedText variant="subtitle" style={styles.label}>背景与遮罩</ThemedText>
        <View style={styles.row}>
          <ThemedText>背景模糊</ThemedText>
          <Switch value={backgroundBlur} onValueChange={setBackgroundBlur} trackColor={{ false: '#d1d5db', true: primaryColor }} thumbColor={backgroundBlur ? '#ffffff' : '#f4f4f5'} />
        </View>
        <View style={[styles.row, styles.spaced]}>
          <ThemedText>前景遮罩不透明度</ThemedText>
          <ThemedText weight="800">{Math.round(foregroundOpacity * 100)}%</ThemedText>
        </View>
        <Slider minimumValue={0} maximumValue={0.9} step={0.01} value={foregroundOpacity} onValueChange={setForegroundOpacity} minimumTrackTintColor={primaryColor} maximumTrackTintColor="rgba(127,127,127,.3)" thumbTintColor={primaryColor} />
        <ThemedText muted variant="caption">遮罩越强文字越清楚，0% 时背景图全强度显示；暗色模式下遮罩是黑色。</ThemedText>
      </ThemedCard>

      <ThemedCard style={styles.card}>
        <ThemedText variant="subtitle" style={styles.label}>配色</ThemedText>
        <View style={styles.row}>
          <ThemedText>暗色模式</ThemedText>
          <Switch value={isDarkMode} onValueChange={setIsDarkMode} trackColor={{ false: '#d1d5db', true: primaryColor }} thumbColor={isDarkMode ? '#ffffff' : '#f4f4f5'} />
        </View>
        <ThemedText muted variant="caption">开启后遮罩变黑、面板转深、文字自动转浅色。</ThemedText>
        <ThemedText style={styles.subLabel}>文字颜色</ThemedText>
        <View style={styles.buttons}>{TEXT_OPTIONS.map(([value, label]) => <Pressable key={value} onPress={() => setTextColor(value)} style={[styles.chip, textColor === value ? { backgroundColor: primaryColor } : null]}><Text style={[styles.chipText, { color: textColor === value ? '#fff' : primaryColor }]}>{label}</Text></Pressable>)}</View>
        <ThemedText style={styles.subLabel}>主题主色</ThemedText>
        <View style={styles.buttons}>{PRIMARY_PRESETS.map((preset) => <Pressable key={preset} onPress={() => setPrimaryColor(preset)} style={[styles.swatch, { backgroundColor: preset }, primaryColor === preset ? styles.swatchOn : null]} />)}</View>
        <View style={[styles.row, styles.spaced]}>
          <TextInput value={hexInput} onChangeText={setHexInput} placeholder="#7c3aed" placeholderTextColor={muted} autoCapitalize="none" style={[styles.input, { color, borderColor: primaryColor }]} />
          <Pressable onPress={applyHex} style={[styles.applyButton, { backgroundColor: primaryColor }]}><Text style={styles.primaryButtonText}>应用</Text></Pressable>
        </View>
        <ThemedText muted variant="caption">主色用于底栏选中态、按钮和进度条。</ThemedText>
      </ThemedCard>

      <Pressable style={[styles.save, { backgroundColor: primaryColor }]} onPress={saveTheme}>
        <Text style={styles.primaryButtonText}>保存主题</Text>
      </Pressable>
      {savedAt ? <ThemedText muted variant="caption" style={styles.savedHint}>已保存</ThemedText> : null}
    </ScrollView>
  </BackgroundWrapper>;
}

const styles = StyleSheet.create({
  content: { padding: 22, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  back: { fontSize: 38, lineHeight: 34, width: 28 },
  title: { marginBottom: 0 },
  card: { marginBottom: 16 },
  label: { marginBottom: 12 },
  subLabel: { marginTop: 16, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  spaced: { marginTop: 14 },
  thumb: { width: '100%', height: 168, borderRadius: 14, marginBottom: 12, backgroundColor: 'rgba(127,127,127,.18)' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  primaryButton: { borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  busy: { opacity: .7 },
  ghostButton: { marginTop: 10, borderRadius: 14, paddingVertical: 12, alignItems: 'center', backgroundColor: 'rgba(127,127,127,.16)' },
  warning: { fontSize: 12, color: '#dc2626', marginTop: 8 },
  buttons: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: 'rgba(127,127,127,.16)' },
  chipText: { fontWeight: '700', fontSize: 13 },
  swatch: { flex: 1, height: 34, borderRadius: 10 },
  swatchOn: { borderWidth: 3, borderColor: '#ffffff' },
  input: { flex: 1, minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginRight: 10 },
  applyButton: { paddingHorizontal: 18, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  save: { borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  savedHint: { textAlign: 'center', marginTop: 8 },
});
