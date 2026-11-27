import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Android 11+ 强制分区存储，App 无法直接写 /storage/emulated/0/Download。
// 可行做法：用 SAF 让用户选一次目录（expo-file-system 会自动持久化该 URI 权限），
// 之后把私有目录里下好的文件复制一份过去。复制走 legacy copyAsync，它支持 content:// 目标。
const DIR_KEY = 'public_download_dir_uri_v1';

// 是否把副本同步到公共目录。默认开启（用户要求文件管理器可见）。
const ENABLE_KEY = 'public_download_enabled_v1';

export async function isPublicCopyEnabled() {
  try {
    const v = await AsyncStorage.getItem(ENABLE_KEY);
    return v === null ? true : v === '1';
  } catch { return true; }
}

export async function setPublicCopyEnabled(enabled) {
  try { await AsyncStorage.setItem(ENABLE_KEY, enabled ? '1' : '0'); } catch {}
}

export async function hasPublicDir() {
  try { return !!(await AsyncStorage.getItem(DIR_KEY)); } catch { return false; }
}

// 打开系统目录选择器，让用户挑一个公共目录（默认引导到 Download）。
// 选中后权限持久化，后续无需再选。返回是否选到了目录。
export async function pickPublicDir() {
  try {
    // Directory.pickDirectoryAsync 来自新版 expo-file-system；SAF 选中的 URI 会被系统持久化授权。
    const { Directory } = await import('expo-file-system');
    const picked = await Directory.pickDirectoryAsync();
    if (!picked?.uri) return false;
    await AsyncStorage.setItem(DIR_KEY, picked.uri);
    return true;
  } catch (error) {
    // 用户取消选择属于正常情况，不当作错误。
    return false;
  }
}

export async function clearPublicDir() {
  try { await AsyncStorage.removeItem(DIR_KEY); } catch {}
}

// 把私有目录的下好的文件复制一份到公共目录。失败不影响下载本身（错误被吞掉）。
export async function publishToPublicDir(fileUri) {
  if (!fileUri) return false;
  try {
    if (!(await isPublicCopyEnabled())) return false;
    const dirUri = await AsyncStorage.getItem(DIR_KEY);
    if (!dirUri) return false;
    const fileName = decodeURIComponent(fileUri.split('/').pop() || 'song.mp3');
    await FileSystem.copyAsync({ from: fileUri, to: `${dirUri.replace(/\/$/, '')}/${fileName}` });
    return true;
  } catch (error) {
    console.warn('[publicDownload] 复制到公共目录失败', error?.message);
    return false;
  }
}
