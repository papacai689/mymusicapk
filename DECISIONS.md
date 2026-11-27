# 决策记录

## 2026-09-01 项目检查
- 本轮仅执行检查与记录，不修改功能代码。
- 构建/依赖检查通过，但移动端运行时风险仍需 Development Build 实测。
- 暂不调整架构、接口或依赖，待用户确认后再进入执行阶段。

## 2026-09-03 第一轮修复
- 下载恢复改用带 resumeData 的任务执行 downloadAsync，避免重新创建任务后调用错误恢复契约。
- 发现页对 Promise.allSettled 按接口粒度保留 fallback 数据。
- 迷你播放器通过共享 toggle 请求驱动 PlayerScreen 音频实例，减少状态不同步。

## 2026-09-18 依赖对齐与真机联调准备
- 依赖只做 SDK 57 补丁级对齐（`npx expo install --fix`），不升级大版本，避免把运行时风险引入未实测的代码。
- 删除误建的 0 字节跟踪文件 `screens/PlaylistDetailScreen`；真实实现为同目录下的 `PlaylistDetailScreen.js`。
- 进度文档以 Git 历史为准重写，后续每次检查同步更新，避免文档再次落后于代码。
- 真机联调先用局域网开发服务器扫码，EAS Development Build 仅作为后台音频等原生能力的兜底验证路径。

## 2026-09-18 真机联调方式与暂停
- 用 `npx expo start --go` 而非默认的 dev-client 模式起服务，目的是让手机端用 Expo Go 扫码即可，省去尚未打通的 Dev Client 构建。
- 开发服务器保持常驻，不随当轮工作结束而停止，方便用户随时扫码；日志写入 `%TEMP%\musicapp-expo\`，避免污染仓库工作区。
- 已知取舍：Expo Go 无法验证后台播放（配置插件不生效），该项留到有效 EAS 项目打通后补测。
- 用户当日休息，任务挂起在「等待手机端测试反馈」，恢复时优先读 Metro 日志而不是重跑构建。

## 2026-09-20 品牌资产与真机反馈
- 图标与启动页选用第三套「渐变音符」：单个八分音符铺紫到洋红渐变，形最简，20px 下仍可辨识。
- 矢量源文件保留在 `assets/brand/`，PNG 用 Edge 无头模式从 SVG 栅格化，不引入额外图像依赖，日后改色可原样重新导出。
- 原生启动页只能「纯色底 + 图片」，因此底色取品牌起色 `#7c3aed`，JS 加载页用同色起点的渐变衔接，避免启动瞬间跳色。
- 锁屏媒体元数据统一经 `toText` 归一化：多音源下 `artist` 可能是数组、`album` 可能是对象，原生只接受字符串，直接透传会让整次调用被拒绝并静默失去锁屏控制。

## 2026-09-20 开发版构建
- 更正 9-03 的结论：EAS `projectId` 一直有效（`@expomusic/my-music-player`），当时的「Experience 不存在」是错误判断，开发版因此被无谓搁置。
- `eas.json` 固定 `cli.appVersionSource = remote`：未设置时 eas-cli 会停在交互提示上，命令看起来像挂死。
- 开发版走 EAS 云构建（免费额度，约 8 分钟），产物 210MB APK，本地不下载完整包——本机到 EAS 产物 CDN 的下行只有 30~150KB/s，走手机直连更快。
- 用户当日休息，任务挂起在「等装包 + 真机验证」，Metro 服务不随之下线；恢复时先在终端按 `s` 切到 dev client 模式再扫码。

## 2026-09-21 播放自动续播与独立构建
- 播放结束不切歌的原因是没有代码监听 expo-audio 的 `didJustFinish`，改成在 `PlayerScreen` 里监听该标志：列表循环走 `next()`，单曲循环 `seekTo(0)` 重播，随机播放抽一个不同下标。用 `wasFinished` + 曲目指纹两个 ref 防重复触发，避免一次结束连续跳两首。
- 独立版优先走 EAS 云构建：本地 prebuild 有人为不可控的缺陷，云端构建不受影响（同日的 development 构建已证明）。
- `eas.json` 的 `appVersionSource` 回到 `local`：`remote` 需要查询服务端版本号，而该接口在弱网下会让整条命令长时间无输出。

## 2026-09-27 播放状态持久化
- 持久化范围定为队列、下标、当前曲目、进度、时长、播放模式；**不持久化 `isPlaying`**，冷启动一律暂停，避免打开应用就自动放歌。
- 写盘节流 4 秒：进度每 500ms 更新一次，原来那种「每次变更都落盘」的写法会把 AsyncStorage 打爆；现在首次变更立即写，密集变更走一次尾写。
- 恢复出来的曲目**不立刻灌进原生播放器**（省流量、也避免自动播放），只标记 `resumePending`。用户真正播放时，`consumeResume()` 把位置交给播放页，并且延迟到 `status.isLoaded` 为真才 `seekTo`——`replace()` 之后立刻 seek 会被原生忽略。
- 播放/暂停的 toggle 从播放页搬到迷你播放器：恢复出来的会话在播放页从未打开过时，迷你播放器的按钮原本是死键。
- `sharedPlayer` 从播放页提取到 `services/player.js`，`loadedKey`（当前已装载曲目）从模块变量改存进 store，两个组件共用。

## 2026-10-01 背景图主题重做
- 现象是「加了图片出不来」，根因有两个：一是前景层用 `rgba(255,255,255, foregroundOpacity)` 且默认 0.8，等于在图上面糊一层 80% 白纱；二是只存了 ImagePicker 的缓存路径，系统清缓存后图片文件就没了。
- 选图后先 `copyAsync` 到 `documentDirectory/theme/background.<ext>`，只保存这个稳定路径；换图时删除旧文件，且删除前校验路径必须以主题目录开头，避免误删。
- 用「遮罩（scrim）」取代原来的前景白纱：无/浅色/深色 + 0~90% 强度，深色图配深色遮罩加白字，浅色图反之。
- 文字颜色的「自动」改为跟随遮罩：深色遮罩给白字。原来的「自动」恒定返回深色文字，深色背景上必然看不清。
- 存储键升到 `@my-music-player/theme-v2`：旧配置的默认值本身就是问题根源，旧数据直接忽略、让用户重选，比迁移一个坏默认更干净。
- 启动 hydrate 时校验文件是否还在，不在就清空背景，避免指向已失效的图片渲染出空白。

## 2026-10-13 音源清理与超时策略
- 内置「网易云音乐备用源」指向 `netease-cloud-music-api-*-*.vercel.app`，实测 DNS 被污染（解析到 Facebook IP 段）且连接被掐断（HTTP 000）。根因是 NeteaseCloudMusicApi 官方仓库因版权停更被清空，Vercel 上的公共演示部署集体下线。**结论：`*.vercel.app` 一律不可用作内置源**，该源直接删除。
- 音源加 `type` 字段（'gd' / 'netease'），不再靠 baseUrl 字符串匹配判断类型。
- GD 现在只接受 netease；joox 能搜索但 `types=url` 恒返回空地址（最隐蔽的失败），其余平台直接不支持。所以 GD 请求收敛到 netease，避免往队列里塞必然播不了的歌。
- **超时与连接失败不再重试**：新增 `services/netError.js::isTimeoutError`，`getSongUrl` / `playUrlResolver` / `PlayerScreen` 三处统一遵守。原来的「每个节点都试满 5 档音质」会让一次坏源卡住几十秒。HTTP 503/404 仍保留一次重试，不误伤 GD 偶发抖动。
- 用户提供的两个洛雪音源脚本（念心 / 全豆要）解析后实测：只有 `oiapi.net/api/Music_163` 可用（按网易云 id 精确匹配，3/3 稳定），仅作 GD 之外的兜底，**GD 始终是主源**。

## 2026-10-13 播放页音质
- 先实测再动手：GD netease 的 128/192/320/999 返回的是不同码率的真实文件（999 实为 1619kbps FLAC）。此前无论传什么都按 128k 请求，直接加 UI 会是摆设。
- 档位存进 `playerStore` 并持久化；播放页监听切换后重载当前曲目，并借 `resumePending` 从原进度续播，而不是回到 0:00。

## 2026-10-13 启动页两屏合一
- 现象是「启动结束后的上下两屏」。根因：原生启动屏（app.json expo-splash-screen）在 React 挂载瞬间自动收起，紧接着 JS `LaunchScreen` 又画了一遍红底图标。
- 用 `SplashScreen.preventAutoHideAsync()` 把原生屏留到 JS 启动页淡出才收；JS 侧图标尺寸对齐 app.json 的 `imageWidth`（200），标题与 slogan 用绝对定位浮在下方，避免文字出现时图标上跳。
- 注意：原生 splash 属原生配置，**Expo Go 下看不到合并效果**，必须出独立 APK 才能完整验证。

## 2026-10-13 播放/暂停可靠性
- 原链路「播放页 → store 计数 → 迷你播放器 effect → 原生」有两个问题：多等一帧；且方向由 `sharedPlayer.playing` 单独决定，而原生状态每 500ms 才回传，曲目刚装载或页面重挂载时它为 false，点暂停被算成播放。
- 收敛为 `services/player.js::togglePlayback()` 单一落点，方向按「UI 状态或原生状态，任一在播就暂停」，同步执行并立刻回写 store。删除 `requestToggle` / `toggleRequested` 中转。
- 播放页原来是 `usePlayerStore()` 整店订阅，进度每 500ms 触发全页重渲染（含几十行歌词），这是「卡」的来源。改为逐字段订阅 + `useMemo` 缓存唱片与歌词列表。

