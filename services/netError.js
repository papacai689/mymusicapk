// 超时和连不上属于「再等也不会变好」的错误：上游要么已经挂了，要么这一刻就是不通。
// 这类错误如果还按原样重试，用户看到的只是长时间的加载态——等满 N 次超时才失败。
// 统一判定后，调用方直接放弃当前请求，尽快切下一首或给出提示。
export const isTimeoutError = (error) => {
  const code = error?.code;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ERR_NETWORK') return true;
  const message = String(error?.message || '');
  return /timeout|timed out|network error|socket hang up/i.test(message);
};
