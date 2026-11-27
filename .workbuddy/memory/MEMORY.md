# 项目长期记忆：my-music-player

## 项目事实
- **Expo / React Native**（SDK 57，RN 0.86.3，React 19.2.3），目标 Android。**不是 Flutter，无本地后端**。
- 包名 `com.example.mymusicplayer`；EAS projectId `0551a9fc-9e1a-4ee3-b9fb-82528b529116`，owner `expomusic`。
- 状态：zustand v5，5 个 store（player / theme / library / download / source），均 hydrate + AsyncStorage。
- 播放器：`expo-audio` 共享实例 `services/player.js`（updateInterval 500ms），后台播放与锁屏控制已配置。

## 音乐源（2026-10-13 实测，结论短期不变）
- **GD 音乐台是唯一主源**（`music-api.gdstudio.xyz`），且**只支持 netease**：joox 能搜但播放地址恒为空；tencent/kuwo/kugou/migu/xiami 返回 “source is not supported”。
- 一切 `*.vercel.app` 音源在国内不可达（DNS 污染，HTTP 000），旧的网易云备用源已删除。
- 兜底：`services/playUrlResolver.js` 只装 `oiapi.net/api/Music_163`（网易云 id 精确匹配，实测稳定）。
- 封面：GD 只给 `pic_id`，图片要再问一次 `types=pic`（该接口实测不稳：503 / 2.4s / 15s 超时）。统一走 `services/picCache.js`（去重 + 并发上限 6 + 8s abort + AsyncStorage 落盘）。
- 尺寸实测：120px=5.4KB / 250px=19.6KB / 500px=59.2KB；列表缩略图默认 120，播放页与轮播 500。
- 开屏请求已从约 20 个压到 4 个：删掉从未渲染的 `getPersonalized`、隐藏的推荐页不预取、补页批次延后到翻页时。
- 推荐流必须可复现，否则封面缓存跨启动命中率为 0：关键词游标按天固定（下拉刷新才推进）、列表用按天种子的 `seededShuffle`（**不要用 Math.random()**）。上游对同一关键词返回的结果其实是确定的。
- 上游三大毛病：搜索**约一半请求返回空响应**（不算错误，需对空响应补问一次）、`types=pic` 慢且常空（8s abort）、GD 只支持 netease。
- 验证手段：临时在 `apiService.gd` / `picCache` 加 `global.__NET_PROBE__` 日志，从 Metro 日志（`%TEMP%/musicapp-expo/expo-out.log`）计数；验完务必移除。
- 码率实测可用：128 / 192 / 320 / 999（999 实为 1619kbps FLAC）。`apiService` 按档位映射 br（GD 用 kbps，官方接口用 bps）。
- 超时/连接失败**一律不重试**（`services/netError.js::isTimeoutError`），HTTP 503/404 保留一次重试。

## 关键实现约定（改动前务必读）
- **播放/暂停唯一落点**：`services/player.js::togglePlayback()`，判定 `!(store.isPlaying || sharedPlayer.playing)`。不要恢复 `requestToggle`/`toggleRequested` 那套中转——原生状态 500ms 才回传，会导致「点暂停被算成播放」。
- **音质**：`playerStore.quality`（128k/320k/flac）持久化；播放页监听变化后重载并**从原进度续播**。
- **不持久化 isPlaying**，冷启动一律暂停，靠 `resumePending`/`consumeResume()` 断点续播；进度写盘节流 4s。
- **背景主题 v6**：`components/AppBackground.js` 画在导航树之外 + `pointerEvents="none"` + 导航容器透明。不要再在 screen 内部画背景。存储键 `theme-v6`。
- **启动页**：原生 splash（app.json，红 #EC4141 + 200px 图标）由 `SplashScreen.preventAutoHideAsync()` 保持，等 JS `LaunchScreen` 淡出才收，两屏合成一屏。JS 侧图标必须 200px、文字绝对定位，否则交接会跳。

## 已验证可用（2026-10-13 手机 Expo Go 实测）
首页推荐出歌、播放出声、播放页暂停/播放一次生效、音质切换、启动页→首页。

## 构建与发布（2026-10-14 验证）
- **eas-cli 装在系统 node 的全局目录**（`D:\nodejs`，v23.0.0），**项目里没有**。必须用 `D:/nodejs/eas.cmd` 调用，直接 `npx eas` 会报 "could not determine executable to run"。
- 出包：`"D:/nodejs/eas.cmd" build --platform android --profile preview --no-wait`（约 5 分钟出结果）。`eas.json` 的 `appVersionSource` 是 `local`，**版本号必须手动改 app.json**。
- 查状态：`"D:/nodejs/eas.cmd" build:view <buildId> --json`（输出在 stdout，带缩进；注意该命令有延迟，别用短超时）。
- 产物直链 30 天有效；本机下行实测 ~886KB/s，87MB 约 100 秒。

## 待办 / 遗留
- 真机未闭环：媒体库扫描、本地播放、后台音频、下载暂停恢复（**需装 versionCode 5 的独立包验证**）。
- 配色不统一：图标紫色渐变 `#7c3aed→#ff5fa2`，启动页网易云红 `#EC4141`（用户已知，暂保持）。
- 优化债：队列与进度共用一个持久化 key（长队列每 4s 整包写盘）。

## 项目约定
- 四份文档（PROJECT / STATE_SNAPSHOT / TASK_QUEUE / DECISIONS）**经常滞后于代码**，动手前先 `git log`。
- 提交风格：英文 conventional commit（`feat:`/`fix:`/`chore:`）；中文注释解释「为什么」。
- 联调：`npx expo start --go --port 8081 --host lan`（**不要加 CI=1**），地址 `exp://192.168.0.106:8081`，日志 `%TEMP%\musicapp-expo\expo-out.log`。
