(function () {
  const apiBase = String(window.WESPORT_CONFIG?.API_BASE || '').replace(/\/$/, '');

  async function request(path, options = {}) {
    if (!apiBase) throw new Error('后端尚未配置，请先设置 WESPORT_API_BASE。');
    const session = JSON.parse(sessionStorage.getItem('wesporth_session') || 'null');
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;
    const response = await fetch(`${apiBase}${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !path.includes('/auth/login')) sessionStorage.removeItem('wesporth_session');
      throw new Error(data.message || `请求失败（${response.status}）`);
    }
    return data;
  }

  window.WesportAPI = {
    base: apiBase,
    get: (path) => request(path),
    post: (path, data) => request(path, { method: 'POST', body: JSON.stringify(data) }),
    put: (path, data) => request(path, { method: 'PUT', body: JSON.stringify(data) }),
    patch: (path, data) => request(path, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (path) => request(path, { method: 'DELETE' })
  };
})();
