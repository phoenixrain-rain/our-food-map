// Only reads and token renewal receive transport deadlines. Never retry record writes.
export function withDeadline(operation, milliseconds = 15000) {
  let timer;
  return Promise.race([Promise.resolve(operation), new Promise((_, reject) => {
    timer = setTimeout(() => { const error = new Error('连接超时，请检查网络后重试；没有清除你的档案'); error.code = 'connection_timeout'; reject(error); }, milliseconds);
  })]).finally(() => clearTimeout(timer));
}
export function singleFlight() {
  let pending = null;
  return start => {
    if (!pending) {
      const task = Promise.resolve().then(start);
      pending = task.finally(() => { pending = null; });
    }
    return pending;
  };
}
export function recoveryFetch(fetcher = globalThis.fetch.bind(globalThis), milliseconds = 10000) {
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = (init.method || input.method || 'GET').toUpperCase();
    const bounded = ['GET', 'HEAD'].includes(method) || url.pathname === '/auth/v1/token' || (method === 'POST' && url.pathname.startsWith('/storage/v1/object/sign/'));
    if (!bounded) return fetcher(input, init);
    const controller = new AbortController(), original = init.signal || input.signal;
    const abort = () => controller.abort(original.reason);
    if (original?.aborted) abort(); else original?.addEventListener('abort', abort, { once: true });
    try {
      return await withDeadline((async () => {
        const response = await fetcher(input, { ...init, signal: controller.signal });
        // fetch resolves at headers. Drain a clone under the same deadline so a
        // half-delivered JSON body cannot keep SDK initialization pending forever.
        if (response.body) await response.clone().arrayBuffer();
        return response;
      })(), milliseconds);
    } catch (error) { controller.abort(); throw error; }
    finally { original?.removeEventListener('abort', abort); }
  };
}
export function connectionSummary({ mode, syncStatus, online, hasSpace, lastSyncAt, needsLogin }) {
  if (mode === 'loading') return syncStatus === 'error'
    ? { title: '连接未完成 · 可安全重试', detail: '暂时无法确认登录状态，不代表记录丢失。检查网络后重试，不必退出账号或清除网站数据。' }
    : { title: '正在读取档案…', detail: '正在确认登录状态；等待较久时会显示恢复入口。' };
  if (mode === 'local') return needsLogin ? { title: '需要重新登录 · 本机档案', detail: '原登录状态已失效或已在另一页面退出。请用原邮箱重新登录查看共同档案；账号草稿仍按原有效期保留。当前本机档案不是你的云端空间。' }
    : { title: online ? '本机档案 · 仅保存在这台设备' : '当前离线 · 本机档案', detail: syncStatus === 'error' ? '本机档案读取失败，请重试；不要清除站点数据。' : `${online ? '' : '当前离线，本机记录仍可保存。'}本机记录与云端空间相互独立，不会自动上传。云端记录需要登录原来的邮箱查看。` };
  if (!online) return { title: '当前离线', detail: '已加载内容仍可查看，云端保存需联网。不要卸载应用或清除网站数据。' };
  if (syncStatus === 'error') return { title: '云同步待重试', detail: lastSyncAt ? '当前显示上次成功读取的内容，可能不是最新。可安全重试，不会把空档案覆盖到云端。' : '账号已识别，但尚未读到共同档案；这不是空空间，请先重试连接。' };
  if (!lastSyncAt) return { title: '正在读取共同档案…', detail: '已识别登录账号，正在读取空间、记录和照片。' };
  return hasSpace ? { title: '双人空间 · 已同步', detail: '最近一次共同档案读取成功；这不代表每张历史照片都完整。' }
    : { title: '已登录 · 等待加入空间', detail: '已成功查询，此账号尚未加入空间。可使用原邀请码加入。' };
}
// Explicit allowlist: never include errors, URLs, emails, IDs, record contents or tokens.
export function connectionReport({ version, mode, syncStatus, online, hasSpace, lastSyncAt, needsLogin }) {
  const summary = connectionSummary({ mode, syncStatus, online, hasSpace, lastSyncAt, needsLogin });
  return ['美食地图 · 连接检查', `页面版本：${/^\d+\.\d+\.\d+$/.test(version) ? version : '未知'}`,
    `浏览器网络：${online ? '显示在线（不代表服务可达）' : '显示离线'}`, `档案状态：${summary.title}`,
    `本页最近成功读取云端：${Number.isFinite(lastSyncAt) && lastSyncAt > 0 ? new Date(lastSyncAt).toISOString() : '尚无'}`,
    '此报告不含邮箱、邀请码、记录、照片地址或登录凭据。'].join('\n');
}
