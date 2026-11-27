# 项目总览

## 当前状态
- 项目类型：Expo / React Native 手机在线音乐播放器（Expo SDK 57，Android 为主）。
- 检查日期：2026-10-13。
- 当前阶段：**手机 Expo Go 实测通过**（首页推荐、播放、暂停、音质切换、启动页→首页）。下一步是出独立版 APK。
- 构建状态：**2026-10-14 已出 versionCode 5 的独立版 APK**（EAS `preview`，构建号 `26a38e11-e972-453d-bdcb-8696d353dcf9`，87.0MB）。EAS 云构建是唯一走通的路线（本地 prebuild 有已知缺陷）。详见下方「独立版构建现状」。
- 音乐源：默认 GD 音乐台，且实测只支持 netease；失效的 vercel 备用源已删除，兜底解析走 oiapi 网易云节点。
- Git 状态：`master` 分支，工作区干净。

## Android 开发版构建
- 构建号：`8032517b-d002-4bc0-a341-504ac49bca1a`，profile `development`（dev client + internal APK）。
- 对应提交：`18c9cc7`；产物 210MB；构建耗时约 8 分钟。
- 直链（稳定，不随签名过期）：`https://expo.dev/artifacts/eas/vYRBdnoi-Ciyvj0KdrEIAe5brzzdj-MKKb_XpP6_afs.apk`
- 构建页：`https://expo.dev/accounts/expomusic/projects/my-music-player/builds/8032517b-d002-4bc0-a341-504ac49bca1a`
- 注意：本机到 EAS 产物 CDN 的下行被限速（实测 30~150KB/s），本地只留了 23MB 分片 `build/*.apk.partial`（可用 `curl -C -` 续传），分发建议走手机直连或手机数据网络。
- 构建环境备忘：`eas.json` 需保留 `cli.appVersionSource = remote`，否则 eas-cli 会在交互提示处挂起。
- 当前状态：APK 已构建待安装，用户当日暂停；Metro 仍以 Expo Go 模式常驻在 `8081`，装完开发版后需切到 dev client 模式（终端里按 `s`）。

## 独立版（脱离电脑运行）构建现状
- **2026-10-14（当前最新版）**：`preview` 构建成功，构建号 `26a38e11-e972-453d-bdcb-8696d353dcf9`，对应提交 `321ec94`，**versionCode 5**；排队到完成约 5 分钟。
  - 产物直链：`https://expo.dev/artifacts/eas/dZsfLyAeZWp20xZG6rbsvbcZbztBP9I6Irp7vvNNByE.apk`
  - 本地副本：`build/my-music-player-v5.apk`（87.0MB，aapt 校验：包名 `com.example.mymusicplayer`，versionCode=5 / versionName=1.0.0，minSdk 24 / targetSdk 36）
  - 与开发版同包名、同一套 EAS keystore，versionCode 5 > 2，可直接覆盖安装。
  - **构建命令备忘**：`eas-cli` 只装在 `D:\nodejs` 全局（v23.0.0），项目 `node_modules` 里没有，必须用 `"D:/nodejs/eas.cmd" build --platform android --profile preview --no-wait`；直接 `npx eas` 会报 "could not determine executable to run"。查状态用 `"D:/nodejs/eas.cmd" build:view <buildId> --json`（输出带缩进，命令本身有延迟，别用短超时）。
  - `eas.json` 的 `appVersionSource` 为 `local`，**版本号必须手动改 `app.json`**。

- 2026-09-22：`preview` 构建成功。构建号 `f9f1dba8-1736-4f79-b706-a1b77f014be6`，对应提交 `bfe3536`（含自动续播修复），versionCode 2；排队 45 分钟 + 编译 12 分钟。
- 产物直链（稳定，不随签名过期）：`https://expo.dev/artifacts/eas/PsZn-I8gaOs-JmMSkW2V4E4Dt-ap68VCcmgD8vPTx6M.apk`
- 安装说明：与开发版同包名 `com.example.mymusicplayer`、同一套 EAS keystore，versionCode 2 > 1，可直接覆盖安装；装后 dev client 被替换，需连电脑调试时重装开发版。
- 实测该产物 CDN 下行约 850KB/s（此前两晚只有 2~150KB/s），手机直连下载约 2~4 分钟。
- 背景：dev client 只是一个壳，JS 由电脑上的 Metro 提供，电脑关机后应用无法打开。要让手机独立运行，必须打包内置 JS 的独立版。
- EAS 云端 `preview` profile 两次尝试都卡在创建构建的请求上（api.expo.dev 当晚响应极慢，`build:list` 也会挂住），服务端未生成新构建。同一天早些时候的 `development` 构建是成功的，说明通道本身可用，属于网络/接口的临时问题。
- 本地构建路线受阻于 Expo 自身的 prebuild 缺陷：`npx expo prebuild -p android` 会把模板解压到 `%TEMP%\<hash>`，但没有把 `android/` 拷进项目根就进入 mod 阶段，随后报
  `AssertionError [ERR_ASSERTION]: [android.dangerous]: withAndroidDangerousBaseMod: Project file "MainApplication" does not exist in android project for root ...`。
  手动把 `node_modules/expo/template.tgz` 里的 `package/android` 解到项目根也无效——prebuild 会先 `Cleared android code` 再复现同一错误。
- 重试命令（建议在网络空闲时）：
  `eas build --platform android --profile preview --no-wait`，成功后用 `eas build:list --platform android --limit 1` 取产物链接。
- 本地构建前置条件（备选，需先解决 prebuild 缺陷）：JDK 17 在 `D:\devtools\jdk17`，`ANDROID_HOME` 已指向 `C:\Users\Administrator\AppData\Local\Android\Sdk`，但该 SDK 只有 platform 34 / build-tools 34，需要补 android-36。

## 联调入口（局域网 + Expo Go）
- 地址：`exp://192.168.0.106:8081`，手机需与本机（192.168.0.106，以太网）在同一 Wi-Fi 下。
- 开发服务器以 Expo Go 模式常驻运行，未随本轮工作结束而停止；Metro 日志见 `%TEMP%\musicapp-expo\expo-out.log`、`expo-err.log`。
- 重启/换 tunnel：`npx expo start --go --port 8081`（`npx expo start --go --tunnel` 用于跨网段）。
- 停止服务：结束监听 8081 的 node 进程即可。
- 手机端需安装 Expo Go（SDK 57）。Android Development Build 仍未打通，EAS projectId 待更换为有效项目。

## 品牌资产
- 定稿方案：第三套「渐变音符」，主色 `#7c3aed → #ff5fa2`。
- 矢量源文件（可改色重新导出）：`assets/brand/icon.svg`、`mark.svg`（透明底白色音符，供启动页与自适应图标前景）、`adaptive-bg.svg`、`mark-mono.svg`。
- 生成产物：`assets/icon.png`（1024 不透明）、`assets/adaptive-icon.png`（1024 透明，音符置于安全区）、`assets/adaptive-bg.png`、`assets/icon-monochrome.png`、`assets/splash-icon.png`（512 透明）。
- PNG 由 Edge 无头模式直接栅格化 SVG 得到（`--screenshot` + `--default-background-color=00000000` 保留透明通道），因此不依赖额外的图像库。
- 启动页配色已在 2026-10-13 改为**网易云红 `#EC4141`**（深色模式 `#C62F38`）：原生启动屏与 JS `LaunchScreen` 同色同图标（200px），两屏首尾相接看不出切换。图标/自适应图标仍是紫色渐变 `#7c3aed → #ff5fa2`，配色差异用户已知并保留。

## 已实现功能
- 首页/发现：多来源歌单、每日推荐去重、新碟 banner 可直接播放、下拉刷新、按接口粒度 fallback。
- 推荐与排行：红色主题推荐页、榜单导航吸顶、排行榜与榜单 100 首详情。
- 播放：共享音频实例（`services/player.js`）、队列加载与歌词同步、不可用曲目自动跳过、防重叠播放、播放结束自动续播、队列/当前曲目/进度/播放模式的持久化与冷启动断点续播、后台播放（`shouldPlayInBackground`）。
- 播放/暂停统一走 `services/player.js::togglePlayback()`（播放页与迷你播放器共用），不再经过 store 计数中转。
- 音质：播放页可切 标准 128k / 高品 320k / 无损 FLAC，选择持久化，切档后从原进度续播。
- 音乐源：音乐源管理页、音源 `type` 标记、超时与连接失败不重试、兜底解析（oiapi 网易云节点）+ 播放地址缓存。
- 本地与下载：本地音乐文件夹扫描、下载管理、带 resumeData 的暂停恢复。
- 个人：最近播放与收藏持久化、歌单分类、歌曲搜索。
- 外观与设置：全局背景图主题（选图后复制到应用目录长期保存）、遮罩（无/浅色/深色 + 强度）、背景模糊、文字颜色（自动/黑/白）、播放设置。

## 检查与修复记录
- 2026-09-01：首轮项目审计，仅记录不改代码。
- 2026-09-03：修复下载恢复契约、发现页 fallback、迷你播放器状态同步。
- 2026-09-18：依赖补丁版本对齐到 SDK 57 要求；删除误建的 0 字节跟踪文件 `screens/PlaylistDetailScreen`；刷新 Web 导出；重写本进度文档。
- 2026-09-20：定稿应用图标与启动页（渐变音符）；修复锁屏媒体信息因 `artist`/`album` 为数组或对象导致的原生调用失败。
- 2026-09-27：播放状态持久化落地（队列、当前曲目、进度、播放模式），冷启动按存档恢复并支持断点续播；播放/暂停改由常驻的迷你播放器驱动，恢复出来的曲目在打开播放页之前也能控制。
- 2026-10-01：修复「选了背景图却看不见」。原因是前景层压着一层 80% 白纱把图糊掉了，而且存的是 ImagePicker 的缓存路径，缓存被清后图就消失。改为复制到 `documentDirectory/theme/` 长期保存 + 可控遮罩模型，并在设置页加了实时预览。
- 2026-10-13：清理已死亡的音源（vercel 备用源 DNS 已废）、超时不再重试、兜底解析换成实测节点；播放页加音质选项；启动页两屏合一；修复播放页暂停「点了没反应/发卡」。手机 Expo Go 实测全部通过。

## 仍需处理
1. 用当前代码出一版 `preview` APK（versionCode 4 尚未构建过）。
2. 装独立包后验证：原生启动屏、后台播放、锁屏控制、媒体库扫描、本地播放、下载暂停恢复（当前最大未闭环项）。
3. 未实机验证前不建议发布 production 构建。
4. 优化：队列与进度共用一个持久化 key，长队列每 4 秒整包落盘。
5. 音源储备：GD 目前只支持 netease，需留意其再次收缩。
