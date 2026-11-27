import { createAudioPlayer } from 'expo-audio';
import { usePlayerStore } from '../store/playerStore';

// The native audio instance lives outside React so navigating away from the
// player screen (or holding only the mini player) keeps playback and position
// intact.  Both the player screen and the mini player drive this instance.
export const sharedPlayer = createAudioPlayer(null, { updateInterval: 500 });

// 播放/暂停只在这一处落到原生实例上。
//
// 以前播放页要先往 store 里写一个计数，等迷你播放器的 effect 转一圈才真正执行：
// 既多等一帧，而且那一圈是用原生实例的 `playing` 判断方向的——原生状态每 500ms
// 才回传一次，曲目刚装载或刚从后台切回来时它还是 false，于是「点暂停」被算成
// 「要播放」，表现就是按了没反应、要多按几次（来回切换页面时尤其容易撞上）。
//
// 现在两处都直接调这里，方向按「UI 状态或原生状态，任一在播就暂停」来定，并且
// 立刻回写 store，按钮当帧就变。
export function togglePlayback() {
  const store = usePlayerStore.getState();
  if (!store.current) return false;
  const shouldPlay = !(store.isPlaying || sharedPlayer.playing);
  if (shouldPlay) sharedPlayer.play(); else sharedPlayer.pause();
  store.setPlaying(shouldPlay);
  return shouldPlay;
}
