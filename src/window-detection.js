'use strict';
// 纯逻辑：识别服务端返回的“尚未真正启动的五小时窗口”。
// 注意：这不是 OpenAI 的正式窗口状态字段，而是本机日志验证过的启发式判定。
function classifyWindow(input) {
  const {timeMs, primary, previous={}, lastConfirmedActiveResetAt=0,
    currentTotal=null, lastOwnSuccessAt=0, morning=false} = input;
  const used=Number(primary?.usedPercent);
  const duration=Number(primary?.windowDurationMins)*60*1000;
  const resetMs=Number(primary?.resetsAt)*1000;
  if (!Number.isFinite(used)||!Number.isFinite(duration)||duration<=0||
      !Number.isFinite(resetMs)||resetMs<=0) return {inactive:false,reason:'invalid_rate'};
  if (used>0) return {inactive:false,reason:'usage_nonzero'};
  const remaining=resetMs-timeMs;
  // 空窗口在服务器返回值表现为：每次查询 resetAt ~= 当前时间 + 300 分钟。
  // 真实已经开启的窗口有固定 resetAt，不会随着只读巡检持续平移。
  const appearsRolling=remaining>=duration-2*60*1000 &&
    remaining<=duration+2*60*1000;
  if (!appearsRolling) return {inactive:false,reason:'not_rolling'};
  const prevReset=Number(previous.resetAt||0)*1000;
  const prevChecked=Number(previous.checkedAt||0);
  const prevUsed=Number(previous.usedPercent);
  const prevTotal=previous.usageTotal;
  const totalRose=Number.isFinite(currentTotal)&&Number.isFinite(prevTotal)&&
    currentTotal>prevTotal;
  // 用户刚刚自行发起请求时，累计用量也可能先于用量百分比更新。
  if (totalRose) return {inactive:false,reason:'tokens_increased'};
  const previousActiveExpired=prevUsed>0 && prevReset>0 &&
    prevReset<=timeMs-30*1000;
  const confirmedExpired=Number(lastConfirmedActiveResetAt)>0 &&
    Number(lastConfirmedActiveResetAt)<=timeMs-30*1000;
  const priorWasRolling=prevUsed===0 && prevReset>0 && prevChecked>0 &&
    (timeMs-prevChecked)>=3*60*1000 &&
    Math.abs((resetMs-prevReset)-(timeMs-prevChecked))<=2*60*1000 &&
    Math.abs((prevReset-prevChecked)-duration)<=2*60*1000;
  if (!previousActiveExpired&&!confirmedExpired&&!priorWasRolling&&!morning) {
    return {inactive:false,reason:'insufficient_evidence'};
  }
  // 5h 成功请求去重在主调度中仍需额外检查。
  if (lastOwnSuccessAt && timeMs-lastOwnSuccessAt < duration-6*60*1000) {
    return {inactive:false,reason:'recent_warmup'};
  }
  return {inactive:true,reason:previousActiveExpired?'prior_window_expired':
    confirmedExpired?'confirmed_window_expired':priorWasRolling?'rolling_reset_time':'morning_prewarm'};
}
function checkRollingProbe(x) {
  const a=x.first?.rate?.primary,b=x.second?.rate?.primary;
  if (!a || !b || a.usedPercent!==0 || b.usedPercent!==0) return false;
  const duration=a.windowDurationMins*60000;
  const elapsed=x.secondTimeMs-x.firstTimeMs;
  const drift=(b.resetsAt-a.resetsAt)*1000;
  return elapsed>=4000 &&
    Math.abs(a.resetsAt*1000-x.firstTimeMs-duration)<90000 &&
    Math.abs(b.resetsAt*1000-x.secondTimeMs-duration)<90000 &&
    drift>=Math.max(3000,elapsed-4000) && drift<=elapsed+4000;
}
module.exports={classifyWindow,checkRollingProbe};
