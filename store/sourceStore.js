import AsyncStorage from '@react-native-async-storage/async-storage';import {create} from 'zustand';
// type 决定请求怎么拼：'gd' 走 GD 音乐台的 types=/source= 参数，'netease' 走
// NeteaseCloudMusicApi 的路径风格（/search、/song/url）。以前靠 baseUrl 里有没有
// gdstudio 来判断，自建的 GD 风格镜像会被误判成网易云源，所以改成显式字段。
export const DEFAULT_SOURCE={id:'default',name:'GD音乐台（netease）',baseUrl:'https://music-api.gdstudio.xyz/api.php',type:'gd',isDefault:true};
// 2026-10-13 实测：原先内置的那个 *.vercel.app「网易云音乐备用源」已彻底失效——DNS
// 被污染到不可达 IP，TLS 连接立即被关闭；NeteaseCloudMusicApi 官方仓库停更后，基于
// 它的公共演示部署全部下线。与其预置一个必死的地址让人踩坑，不如留空：需要自建源的
// 用户在「音乐源管理」里填自己的地址即可。
export const BUILTIN_SOURCES=[DEFAULT_SOURCE];
// 自定义源没带 type 时按地址猜一次，猜不出来就按网易云风格处理。
const guessType=(baseUrl)=>/gdstudio/i.test(String(baseUrl||''))?'gd':'netease';
const KEY='@my-music-player/sources',CURRENT='@my-music-player/current-source',MODE='@my-music-player/playback-mode',MIGRATION='@my-music-player/source-switch-v3';
export const useSourceStore=create((set,get)=>({sources:BUILTIN_SOURCES,currentSourceId:'default',playbackMode:'resolver',hydrated:false,hydrate:async()=>{try{const [a,b,c,m]=await AsyncStorage.multiGet([KEY,CURRENT,MODE,MIGRATION]);const saved=a[1]?JSON.parse(a[1]):[];const custom=saved.filter(x=>!x.isDefault&&!BUILTIN_SOURCES.some(b=>b.id===x.id));const sources=[...BUILTIN_SOURCES,...custom];const shouldSwitch=m[1]!=='done';const savedCurrent=b[1];const currentSourceId=shouldSwitch?'default':(sources.some(x=>x.id===savedCurrent)?savedCurrent:'default');set({sources,currentSourceId,playbackMode:c[1]||'resolver'});if(shouldSwitch)await AsyncStorage.setItem(MIGRATION,'done');}finally{set({hydrated:true})}},addSource:(x)=>{const item={...x,id:`custom-${Date.now()}`,type:x.type||guessType(x.baseUrl),isDefault:false};set(s=>({sources:[...s.sources,item]}));return item},removeSource:(id)=>set(s=>({sources:s.sources.filter(x=>x.isDefault||x.id!==id),currentSourceId:s.currentSourceId===id?'default':s.currentSourceId})),setCurrentSource:(id)=>set({currentSourceId:id}),setPlaybackMode:(playbackMode)=>set({playbackMode}),currentSource:()=>get().sources.find(s=>s.id===get().currentSourceId)||DEFAULT_SOURCE}));
useSourceStore.subscribe(s=>{if(!s.hydrated)return;AsyncStorage.multiSet([[KEY,JSON.stringify(s.sources)],[CURRENT,s.currentSourceId],[MODE,s.playbackMode]]).catch(()=>{})});
