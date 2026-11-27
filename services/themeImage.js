import * as FileSystem from 'expo-file-system/legacy';

// Picked images land in the OS cache/temp folder, which can be purged at any
// time (that is why a saved background used to disappear).  Keep our own copy
// inside the app's private document folder instead.
const DIR = `${FileSystem.documentDirectory}theme/`;
const NAME = /\.(png|jpe?g|webp|heic|heif)$/i;

export async function ensureThemeDir() {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  return DIR;
}

export async function persistThemeImage(sourceUri) {
  await ensureThemeDir();
  const match = String(sourceUri).split('?')[0].match(NAME);
  const extension = match ? match[1].toLowerCase() : 'jpg';
  // A unique name per pick, not a fixed one: image loaders cache by uri, so
  // overwriting background.png left the renderer showing the previous picture.
  const target = `${DIR}background-${Date.now()}.${extension}`;
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  return target;
}

export async function removeThemeImage(uri) {
  // Never delete anything outside our own theme folder.
  if (!uri || !String(uri).startsWith(DIR)) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

// Wipes the whole theme folder, so a reset also removes pictures the app no
// longer references instead of leaving them on the device for ever.
export async function clearThemeImages() {
  const info = await FileSystem.getInfoAsync(DIR).catch(() => null);
  if (!info?.exists) return;
  const names = await FileSystem.readDirectoryAsync(DIR).catch(() => []);
  await Promise.all(names.map((name) => FileSystem.deleteAsync(`${DIR}${name}`, { idempotent: true }).catch(() => {})));
}

export async function themeImageExists(uri) {
  if (!uri || !String(uri).startsWith('file://')) return true;
  const info = await FileSystem.getInfoAsync(uri).catch(() => null);
  return Boolean(info?.exists);
}

export { DIR as THEME_IMAGE_DIR };
