// 音源健康状态：GD 连续失败时熔断，避免每首歌都等满超时才回退兜底。
// 2026-11-26 实测 GD 可用率仅 20-40%（搜索 5 轮 2 超时 1 次 503，播放 5 轮 4 超时），
// 而每次失败的代价是 8-15 秒的等待。没有熔断时，用户连续点几首歌就是连续几次长等待。
//
// 纯内存状态，不持久化：App 重启后重新探测，避免一次长期熔断把用户锁在兜底链路上。
const GD_FAIL_THRESHOLD = 2;          // 连续失败 2 次即熔断（GD 现在太不稳，1 次可能是偶发）
const GD_COOLDOWN_MS = 60 * 1000;     // 熔断 60 秒后放 1 次探测请求，成功则恢复
const NODE_FAIL_THRESHOLD = 3;        // 兜底节点连续失败 3 次后降权
const NODE_COOLDOWN_MS = 30 * 1000;

const gd = { consecutiveFailures: 0, openUntil: 0, probeInFlight: false };
const nodes = new Map();

// 是否还应该尝试 GD。熔断中直接跳过；冷却期满只放 1 个探测请求，
// 其余并发请求走兜底，避免探测失败时一堆积请求同时卡住。
export function shouldTryGd() {
  const now = Date.now();
  if (gd.openUntil && now < gd.openUntil) return false;
  if (gd.openUntil && now >= gd.openUntil) {
    // 冷却到期：进入半开态，仅允许一个探测；probeInFlight 由调用方 finally 清理。
    if (gd.probeInFlight) return false;
    gd.probeInFlight = true;
    return true;
  }
  return true;
}

export function recordGdSuccess() {
  gd.consecutiveFailures = 0;
  gd.openUntil = 0;
  gd.probeInFlight = false;
}

export function recordGdFailure() {
  gd.consecutiveFailures += 1;
  gd.probeInFlight = false;
  if (gd.consecutiveFailures >= GD_FAIL_THRESHOLD) gd.openUntil = Date.now() + GD_COOLDOWN_MS;
}

// 无论探测成功失败都要清标志；幂等，放在 finally 里兜底防止卡在半开态。
export function clearGdProbe() {
  gd.probeInFlight = false;
}

// 仅供调试/测试读取当前状态，不参与业务逻辑。
export function getGdHealth() {
  return { ...gd, circuitOpen: Date.now() < gd.openUntil };
}

// 兜底节点按失败次数降权：失败多的排后面，但冷却后清零重新给机会。
// oiapi / meting 同源，任 one 失败换另一个仍有意义（上游节点偶尔单独抖动）。
export function sortNodes(list) {
  const now = Date.now();
  const score = (name) => {
    const s = nodes.get(name);
    if (!s) return 0;
    if (s.until && now >= s.until) { nodes.delete(name); return 0; }
    return s.failures;
  };
  return [...list].sort((a, b) => score(a.name) - score(b.name));
}

export function recordNodeSuccess(name) {
  nodes.delete(name);
}

export function recordNodeFailure(name) {
  const s = nodes.get(name) || { failures: 0, until: 0 };
  s.failures += 1;
  if (s.failures >= NODE_FAIL_THRESHOLD) s.until = Date.now() + NODE_COOLDOWN_MS;
  nodes.set(name, s);
}
