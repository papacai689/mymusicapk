import * as FileSystem from 'expo-file-system/legacy';
import { apiService } from './apiService';
import { usePlayerStore } from '../store/playerStore';
// App-private download folder. It is created on the phone as `mydown`.
const dir=`${FileSystem.documentDirectory}mydown/`;
export async function ensureDownloadDir(){const info=await FileSystem.getInfoAsync(dir);if(!info.exists)await FileSystem.makeDirectoryAsync(dir,{intermediates:true})}
// 下载跟随播放页选的音质：以前固定 128k，选了无损下载下来还是 128k；而且无损文件
// 也会被存成 .mp3，扩展名与实际格式对不上。GD 是否真给了无损取决于上游，这里只保证
// 请求与扩展名和选择一致。
export async function createSongDownload(song,onProgress,resumeData){await ensureDownloadDir();const quality=usePlayerStore.getState().quality||'128k';const url=await apiService.getSongUrl({...song,platform:song.platform||song.source||'netease'},quality);if(!url)throw new Error('无法获取下载地址');const safe=(song.name||song.title||'song').replace(/[\\/:*?"<>|]/g,'_');const extension=quality==='flac'?'flac':'mp3';const fileUri=`${dir}${song.id||Date.now()}-${safe}.${extension}`;const task=FileSystem.createDownloadResumable(url,fileUri,{},onProgress,resumeData);return {task,fileUri}}
export {FileSystem};
