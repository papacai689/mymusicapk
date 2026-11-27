import axios from 'axios';
import { useSourceStore } from '../store/sourceStore';
import { isTimeoutError } from './netError';
import { oiapiSearch } from './oiapiService';
import * as sourceHealth from './sourceHealth';
import * as urlCache from './urlCache';
const headers={'User-Agent':'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Mobile Safari/537.36'};
export async function request(path,params={}){const source=useSourceStore.getState().currentSource();const base=String(source?.baseUrl||'').trim().replace(/\/$/,'');if(!/^https?:\/\//i.test(base))throw new Error('当前音乐源地址无效，请在音乐源管理中检查 URL。');try{const res=await axios.get(`${base}${path}`,{params,headers,timeout:15000});if(res.status<200||res.status>=300)throw new Error(`HTTP ${res.status}`);return res.data;}catch(error){if(error?.response)throw new Error(`音乐源请求失败（HTTP ${error.response.status}）`);if(error?.code==='ECONNABORTED')throw new Error('音乐源请求超时，请检查网络或地址。');throw new Error(error?.message||'音乐源请求失败');}}
// 显式 type 优先；老存档没有 type 字段时退回域名判断，避免升级后自建源被误判。
const isGdSource=()=>{const s=useSourceStore.getState().currentSource();if(s?.type)return s.type==='gd';return String(s?.baseUrl||'').includes('music-api.gdstudio.xyz');};
// GD 主源请求缓存：2026-11-26 实测 GD 可用率仅 20-40%、成功 1-7s / 失败 12s 起，
// 同一请求在 TTL 内复用成功结果，避免反复砸向已经很脆弱的 GD。
// 失败和空响应一律不缓存：搜索约半数返回空，缓存空会让结果长时间出不来；
// 503 / 超时会抛异常，天然不进缓存。
const gdCache = new Map();
const GD_TTL = { url: 30 * 60 * 1000, search: 3 * 60 * 1000, pic: 60 * 60 * 1000 };
const gdPayloadOk = (types, data) => {
  if (!data || typeof data !== 'object') return false;
  if (types === 'url' || types === 'pic') return typeof data.url === 'string' && !!data.url;
  if (types === 'search') {
    if (Array.isArray(data)) return data.length > 0;
    const list = data.result || data.data || data.songs;
    return Array.isArray(list) && list.length > 0;
  }
  return true;
};
const gd=async(types,params={},timeout=15000)=>{const source=useSourceStore.getState().currentSource();const base=String(source?.baseUrl||'').replace(/\/$/,'');
  const fullParams={types,source:'netease',...params};
  const ttl=GD_TTL[types]||0;
  const key=ttl?`${base}|${JSON.stringify(fullParams)}`:null;
  if(key){const hit=gdCache.get(key);if(hit&&Date.now()-hit.time<ttl)return hit.data;}
  const res=await axios.get(base,{params:fullParams,headers,timeout});
  if(key&&gdPayloadOk(types,res.data)){
    gdCache.set(key,{data:res.data,time:Date.now()});
    // Map 保持插入顺序，超限时淘汰最早写入的条目，避免长时间运行后无限增长。
    if(gdCache.size>300) gdCache.delete(gdCache.keys().next().value);
  }
  return res.data;};
const extractUrl=(value)=>{
  if(typeof value==='string'&&/^https?:\/\//i.test(value)) return value;
  if(!value||typeof value!=='object') return null;
  const candidates=[value.url,value.data?.url,value.data?.[0]?.url,value.data?.[0],value.result?.url,value.result?.[0]?.url];
  return candidates.find((item)=>typeof item==='string'&&/^https?:\/\//i.test(item))||null;
};
// GD 对不支持的 source 返回 {"detail":"..."} 这类错误对象，而不是 HTTP 错误码。
// 直接吞成空数组会让「某个平台被下架」表现为「结果莫名其妙变少」，所以显式识别
// 出来抛给上层的 catch，失败得明明白白。
const unwrapSongs=(value)=>{
  if(Array.isArray(value)) return value;
  if(value&&typeof value==='object'){
    const detail=value.detail||value.error||value.msg||value.message;
    if(detail) throw new Error(`音乐源返回错误：${detail}`);
    const list=value.result||value.data||value.songs;
    if(Array.isArray(list)) return list;
  }
  return [];
};
// 首页推荐：按关键词轮换而不是固定查“热门歌曲”。
// 固定关键词时上游每次都返回同一批歌，既显得“不更新”，去重后也凑不满 10 页；
// 这里让每次请求都推进一次游标，所以下拉刷新会换一批，跨天也自然不同。
const RECOMMEND_KEYWORDS=['华语流行','热门歌曲','新歌','抖音热歌','网络流行','经典老歌','粤语歌曲','民谣','说唱','古风'];
// 2026-10-13 实测收敛到只剩 netease，其余全部排除，原因是三类、逐级更隐蔽：
//   1. tencent / kuwo / kugou / migu / xiami —— GD 直接回 "source is not supported"；
//   2. bilibili —— 恒返回空数组，白等一个请求；
//   3. joox —— 最坑：搜索有结果，但 types=url 稳定返回 {"url":"","br":-1}，
//      放进推荐流等于往队列里塞一批「点了必定播放失败」的歌，比直接失败更糟。
// 多样性改由下面的关键词轮换承担（10 个关键词轮换本来就是主要手段）。
const RECOMMEND_SOURCES=['netease'];
let recommendCursor=Math.floor(Date.now()/86400000);
const recommendQueries=(start,count)=>{
  const out=[];
  for(let i=0;i<count;i+=1){
    const n=recommendCursor+start+i;
    out.push({keyword:RECOMMEND_KEYWORDS[n%RECOMMEND_KEYWORDS.length],source:RECOMMEND_SOURCES[n%RECOMMEND_SOURCES.length]});
  }
  return out;
};
// 上游对同一关键词返回的结果是完全确定的（实测多次请求 id 序列一致），
// 所以列表顺序只要不随机化，冷启动拿到的就是同一批歌，封面缓存才能跨启动复用。
// 这里用固定种子的洗牌代替 Math.random()：种子只由「当天」或「关键词」决定，
// 既保证顺序看起来是打散的，又保证每次打开的顺序一致（下拉刷新推进种子才变）。
const seededShuffle=(list,seed)=>{
  const arr=list.slice();
  let s=(Math.abs(seed)||1)%2147483647;
  if(s<=0) s=1;
  for(let i=arr.length-1;i>0;i-=1){
    s=(s*16807)%2147483647;
    const j=s%(i+1);
    const tmp=arr[i]; arr[i]=arr[j]; arr[j]=tmp;
  }
  return arr;
};
const hashOf=(text='')=>{let h=2166136261;for(let i=0;i<text.length;i+=1){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return Math.abs(h);};
const dedupeSongs=(list)=>{
  const seen=new Set();
  return list.filter((song)=>{
    const key=`${song?.source||'netease'}:${song?.id}`;
    if(!song?.id||seen.has(key))return false;
    seen.add(key);
    return true;
  });
};
// 两批拉取：fast 先喂首页（启动快），more 随后补足到 10 页。
// 关键词游标改成「按天固定 + 只有下拉刷新才推进」。
// 原来每调用一次就 +1，导致每次冷启动都是一批新歌：封面缓存落盘也复用不上，
// 实测跨启动命中率为 0。按天固定后，同一天多次打开是同一批歌，缓存才真正省流量。
const advanceRecommend=()=>{recommendCursor+=1;};
// 上游大约有一半的请求会直接返回空响应（不是报错，也不是超时），于是一次拉歌
// 经常只拿到两三批，首页既显得歌少，又因为内容变了导致封面缓存对不上。
// 空响应是瞬间返回的，所以这里只对「空」补问一次——用户不会因此多等，
// 也不违反「超时不重试」的原则。
const gdSongs=async(params)=>{
  const first=await gd('search',params).then(unwrapSongs).catch(()=>[]);
  if(first.length) return first;
  return gd('search',params).then(unwrapSongs).catch(()=>[]);
};
// 搜歌主链路：oiapi 一次请求就带封面直链与播放地址，且几乎不返回空；
// 只有它彻底失败（含超时）时才回退 GD 的 search + 空响应补问。
// 注意 oiapi 只覆盖网易云，所以自定义非 GD 源仍走各自原路径，不受影响。
const searchSongs=async(params)=>{
  try {
    const list=await oiapiSearch(params.name,params.count||30,params.pages||1);
    if(list.length) return list;
  } catch (_) { /* 回退 GD */ }
  return gdSongs(params);
};
const fetchRecommend=async(mode)=>{
  if(!isGdSource()) return apiService.getTopSongs();
  const [start,count]=mode==='fast'?[0,4]:[4,6];
  const queries=recommendQueries(start,count);
  const results=await Promise.all(queries.map(({source,keyword})=>searchSongs({source,name:keyword,count:30,pages:1})));
  const songs=dedupeSongs(results.flat().map((song)=>({...song,source:song?.source||'netease'})));
  return seededShuffle(songs, recommendCursor);
};
export const apiService={
  search:(name,{source='netease',count=30,pages=1}={})=>isGdSource()?searchSongs({source,name,count,pages}):request('/search',{keywords:name,limit:count,offset:(pages-1)*count}),
  getBanner:()=>isGdSource()?Promise.resolve({banners:[]}):request('/banner'),
  getPersonalized:()=>isGdSource()?gd('search',{name:'华语流行',count:8,pages:1}).then(x=>({result:unwrapSongs(x).map((s,i)=>({id:s.id,name:s.album||s.name,picUrl:s.pic_id?`https://music-api.gdstudio.xyz/api.php?types=pic&source=${s.source||'netease'}&id=${s.pic_id}&size=300`:null}))})):request('/personalized'),
  getThemeSongs:async(theme,count=100,options={})=>{
    if(!isGdSource()) return request('/cloudsearch',{keywords:theme,limit:count,offset:0}).then(x=>x?.result?.songs||[]);
    // GD 音乐台单次 count 过大可能返回 422，按 30 首分页拉取后合并。
    const pageSize=30, pages=Math.ceil(count/pageSize), aliases={深夜温柔小调:'深夜',粤语歌曲天花板:'粤语',中文说唱:'说唱',华语流行:'华语',古风:'古风',神仙大家的年代:'经典老歌','流行70 80 90':'70 80 90',忧伤民谣:'民谣','2026年度热门歌曲':'2026 热门歌曲'}, sources=options.sources||RECOMMEND_SOURCES;
    const keyword=aliases[theme]||theme;
    // 歌单使用多平台混合歌源，避免只依赖网易云；每个平台按页请求并保留 source 字段。
    // 改用 gdSongs（带一次空响应补问），否则 GD 约一半请求返回空响应时，
    // count=1 的歌单封面会直接拿不到歌、永久空白。
    const results=await Promise.all(sources.flatMap((source)=>Array.from({length:pages},(_,i)=>searchSongs({source,name:keyword,count:pageSize,pages:i+1}))));
    const seen=new Set();
    let songs=results.flat().map((song)=>({...song,source:song?.source||'netease'})).filter((song)=>{const key=`${song.source}:${song?.id}`;if(!song?.id||seen.has(key))return false;seen.add(key);return true;});
    // 单个关键词上游最多只给约 69 首（实测 page4 起为空），凑不满 100。
    // 用一组通用关键词、每个按页拉取后混入去重，直到够数；请求彼此独立，并发执行。
    if(songs.length<count){
      const fillWords=['热门歌曲','新歌','抖音热歌','网络流行','华语流行'].filter((w)=>w!==keyword);
      const fillPages=Math.ceil(count/pageSize);
      // 每个 (关键词,页码) 是一个独立请求，全部并发；pages 在 oiapiSearch 里就是单页页码。
      const jobs=fillWords.flatMap((w)=>Array.from({length:fillPages},(_,i)=>searchSongs({name:w,count:pageSize,pages:i+1}).catch(()=>[])));
      const batches=await Promise.all(jobs);
      for(const batch of batches){
        for(const song of (batch||[])){
          const key=`${song?.source||'netease'}:${song?.id}`;
          if(song?.id&&!seen.has(key)){seen.add(key);songs.push(song);if(songs.length>=count)break;}
        }
        if(songs.length>=count)break;
      }
    }
    // 打散平台顺序（种子跟着关键词走，同一歌单每次打开顺序一致）。
    return seededShuffle(songs, hashOf(keyword)).slice(0,count);
  },
  // 排行榜主页卡片预览：只需 3 首（封面 + 歌名），用轻量链路，避免 getThemeSongs 的重量级
  // 多源混合 / 空响应补问 / 热门兜底 全链路。最多 1 次搜索 + 1 次空响应补问（gdSongs 已含）。
  getRankingPreview: async (theme, n = 3) => {
    if (!isGdSource()) return request('/cloudsearch', { keywords: theme, limit: n, offset: 0 }).then((x) => x?.result?.songs || []);
    const songs = await searchSongs({ source: 'netease', name: theme, count: n, pages: 1 });
    return (songs || []).slice(0, n);
  },
  getToplistDetail:()=>Promise.resolve({list:[]}),
  getTopSongs:()=>isGdSource()?searchSongs({name:'热门歌曲',count:30,pages:1}):request('/top/song',{type:0}),
  getDailySongs:()=>fetchRecommend('fast'),
  getMoreDailySongs:()=>fetchRecommend('more'),
  // 只有用户主动下拉刷新才换一批歌，冷启动保持同一批，让封面缓存能跨启动复用。
  advanceRecommend,
  getPlaylistDetail:(id)=>request('/playlist/detail',{id}),
  // 预取下一首播放地址：听当前歌时后台解析，切歌时 getSongUrl 直接命中缓存。
  // 复用 getSongUrl 的完整解析链路（含熔断/兜底），失败静默、不重试。
  prefetchSongUrl:(songInfo,quality='128k')=>urlCache.prefetchUrl(songInfo,quality,()=>apiService.getSongUrl(songInfo,quality)),
  getSongUrl:async(songInfo,quality='128k')=>{
    const id=songInfo.sourceTrackId||songInfo.id||songInfo.songId;
    if(!id) return null;
    // 预取命中：切歌时省掉整轮地址解析（移动网络下这是主要等待）。
    const cached=urlCache.cachedUrl(songInfo,quality);
    if(cached) return cached;
    // 2026-10-13 实测 GD 的 netease 源：128/192/320/999 都返回不同码率的真实文件
    // （999 那档实际是 1619kbps 的 FLAC）。档位写死成 128 会让高音质选项形同虚设。
    const br=quality==='flac'?999:quality==='320k'?320:quality==='192k'?192:128;
    if(isGdSource()) {
      // 智能源切换：GD 连续失败时熔断，熔断期内直接走兜底，不再等 GD 超时。
      // 2026-11-26 实测 GD 可用率 20-40%，每次超时 12-15 秒；熔断把「点即从兜底秒出」
      // 的机会还给健康节点，避免连点几首歌就是连续几次长等待。
      const source=songInfo.source||'netease';
      const health=sourceHealth;
      if(health.shouldTryGd()) {
        try {
          // 超时从 15s 缩到 6s：GD 成功请求实测 1-7s，失败是 12s 起；6s 能砍掉大部分
          // 无效等待，代价是极少数慢成功（>6s）会被让给兜底，权衡后值得。
          const data=await gd('url',{source,id,br},6000);
          const url=extractUrl(data);
          if(url){ health.recordGdSuccess(); urlCache.setCachedUrl(songInfo,quality,url); return url; }
          // 明确空地址（已无 joox，但防御其他平台）：算一次失败，尽快转兜底
          health.recordGdFailure();
        } catch (error) {
          // 超时或 503 都算失败信号，触发熔断计数；不再原地重试 GD，直接交兜底。
          health.recordGdFailure();
        } finally {
          health.clearGdProbe();
        }
      }
      try {
        const url=await import('./playUrlResolver').then(m=>m.playUrlResolver({...songInfo,platform:source,id},quality));
        urlCache.setCachedUrl(songInfo,quality,url);
        return url;
      } catch (_) {
        throw new Error('播放地址暂时不可用，请稍后重试或切换音乐源');
      }
    }
    const mode=useSourceStore.getState().playbackMode;
    // 网易云官方接口的码率单位是 bps，GD 用的是 kbps。
    const brApi=quality==='flac'?999000:quality==='320k'?320000:quality==='192k'?192000:128000;
    if(mode==='api'){
      const data=await request('/song/url',{id,br:brApi});
      const url=extractUrl(data);
      urlCache.setCachedUrl(songInfo,quality,url);
      return url;
    }
    try{
      const url=await import('./playUrlResolver').then(m=>m.playUrlResolver({...songInfo,id},quality));
      urlCache.setCachedUrl(songInfo,quality,url);
      return url;
    } catch(e){
      const data=await request('/song/url',{id,br:brApi});
      const url=extractUrl(data);
      urlCache.setCachedUrl(songInfo,quality,url);
      return url;
    }
  },
  // size 会被拼成 ?param=SIZExSIZE。实测同一张封面：120px 5.4KB、250px 19.6KB、
  // 500px 59.2KB——列表缩略图一直按 500 拉的话，100 行就是 5.9MB，而屏幕上只有 50px。
  getPicture:(song,size=500)=>{
    // oiapi 搜索结果自带网易云封面直链，按尺寸拼参数直接可用，不必再问 GD 的 types=pic。
    if(song?.picUrl) {
      const n=Math.max(16,Math.min(1000,Math.round(size)));
      return `${song.picUrl}${song.picUrl.includes('?')?'&':'?'}param=${n}y${n}`;
    }
    return song?.pic_id?`https://music-api.gdstudio.xyz/api.php?types=pic&source=${song.source||'netease'}&id=${song.pic_id}&size=${size}`:null;
  },
  getLyric:async(song)=>{
    const id=song?.lyric_id||song?.id;
    if(!id) return {lyric:''};
    // meting 歌词实测 0.26s（GD 1.36s），且直接返回纯 LRC 文本，解析少一层。
    // 只在 GD 主源下走这条快路径；自建 NeteaseCloudMusicApi 源仍用其原生 /lyric。
    if(isGdSource()) {
      try {
        const res=await axios.get('https://api.injahow.cn/meting/',{params:{server:'netease',type:'lrc',id},headers,timeout:8000});
        const text=typeof res?.data==='string'?res.data:'';
        if(text && /\[\d{1,2}:\d{2}/.test(text)) return {lyric:text};
      } catch (_) { /* 回退 GD */ }
      return gd('lyric',{source:song.source||'netease',id});
    }
    return request('/lyric',{id});
  },
};
