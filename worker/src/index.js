const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 210000;
const SESSION_DAYS = 7;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (origin && !cors['Access-Control-Allow-Origin']) return json({ error: 'origin_not_allowed' }, 403, cors);
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (request.method === 'GET' && path === '/api/health') {
        return json({ ok: true, service: 'wesporth-api' }, 200, cors);
      }
      if (request.method === 'POST' && path === '/api/setup') return setupAdmin(request, env, cors);
      if (request.method === 'POST' && path === '/api/auth/register') return registerMember(request, env, cors);
      if (request.method === 'POST' && path === '/api/auth/login') return login(request, env, cors);

      const auth = await authenticate(request, env);
      if (!auth) return json({ error: 'unauthorized', message: '请重新登录。' }, 401, cors);

      if (request.method === 'POST' && path === '/api/auth/logout') return logout(auth, env, cors);
      if (request.method === 'GET' && path === '/api/bootstrap') return bootstrap(auth, env, cors);
      if (request.method === 'PUT' && path === '/api/account/password') return changeOwnPassword(request, auth, env, cors);
      if (request.method === 'POST' && path === '/api/bookings') return createBooking(request, auth, env, cors);
      if (request.method === 'POST' && path === '/api/slots') return createSlot(request, auth, env, cors);
      if (request.method === 'POST' && path === '/api/admin/coaches') return createCoach(request, auth, env, cors);

      const bookingMatch = path.match(/^\/api\/bookings\/([^/]+)$/);
      if (request.method === 'PATCH' && bookingMatch) return updateBooking(request, auth, env, cors, bookingMatch[1]);
      const slotMatch = path.match(/^\/api\/slots\/([^/]+)$/);
      if (request.method === 'DELETE' && slotMatch) return deleteSlot(auth, env, cors, slotMatch[1]);
      const coachMatch = path.match(/^\/api\/admin\/coaches\/([^/]+)$/);
      if (request.method === 'PATCH' && coachMatch) return updateCoach(request, auth, env, cors, coachMatch[1]);
      const userPasswordMatch = path.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
      if (request.method === 'PUT' && userPasswordMatch) return resetMemberPassword(request, auth, env, cors, userPasswordMatch[1]);

      return json({ error: 'not_found' }, 404, cors);
    } catch (error) {
      console.error(error);
      return json({ error: 'server_error', message: '服务暂时不可用，请稍后重试。' }, 500, cors);
    }
  }
};

function corsHeaders(origin, configured = '') {
  const allowed = configured.split(',').map((item) => item.trim()).filter(Boolean);
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin'
  };
  if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}

async function body(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new HttpError(415, '请使用 JSON 请求。');
  return request.json();
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function cleanUsername(value) {
  const username = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(username)) throw new HttpError(400, '账号需为 3–32 位小写字母、数字或下划线。');
  return username;
}

function cleanName(value) {
  const name = String(value || '').trim();
  if (name.length < 1 || name.length > 40) throw new HttpError(400, '姓名长度应为 1–40 个字符。');
  return name;
}

function cleanPassword(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 128) throw new HttpError(400, '密码至少需要 8 位。');
  return password;
}

function b64(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sha256(value) {
  return b64(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function passwordRecord(password, saltValue) {
  const salt = saltValue ? fromB64(saltValue) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS }, key, 256);
  return { hash: b64(hash), salt: b64(salt) };
}

async function authenticate(request, env) {
  const value = request.headers.get('Authorization') || '';
  if (!value.startsWith('Bearer ')) return null;
  const token = value.slice(7).trim();
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.id, u.username, u.display_name AS name, u.role, u.status, s.token_hash
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.status = 'active'
  `).bind(tokenHash).first();
  return row || null;
}

async function createSession(user, env) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(tokenHash, user.id, expires).run();
  return { token, expiresAt: expires };
}

async function setupAdmin(request, env, cors) {
  try {
    const data = await body(request);
    if (!env.SETUP_TOKEN || String(data.setupToken || '') !== env.SETUP_TOKEN) throw new HttpError(403, '初始化密钥无效。');
    const username = cleanUsername(data.username);
    const name = cleanName(data.name);
    const password = cleanPassword(data.password);
    const record = await passwordRecord(password);
    const id = crypto.randomUUID();
    let result;
    try {
      result = await env.DB.prepare(`
        INSERT INTO users (id, username, display_name, role, password_hash, password_salt)
        SELECT ?, ?, ?, 'admin', ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')
      `).bind(id, username, name, record.hash, record.salt).run();
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new HttpError(409, '该账号已被使用，请换一个管理员账号。');
      throw error;
    }
    if (!result.meta.changes) return json({ error: 'already_initialized', message: '管理员已经初始化。' }, 409, cors);
    const session = await createSession({ id }, env);
    return json({ ...session, account: { id, username, name, role: 'admin' } }, 201, cors);
  } catch (error) { return handled(error, cors); }
}

async function registerMember(request, env, cors) {
  try {
    const data = await body(request);
    const username = cleanUsername(data.username);
    const name = cleanName(data.name);
    const password = cleanPassword(data.password);
    const record = await passwordRecord(password);
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(`INSERT INTO users (id, username, display_name, role, password_hash, password_salt) VALUES (?, ?, ?, 'member', ?, ?)`)
        .bind(id, username, name, record.hash, record.salt).run();
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new HttpError(409, '该账号已存在。');
      throw error;
    }
    const session = await createSession({ id }, env);
    return json({ ...session, account: { id, username, name, role: 'member' } }, 201, cors);
  } catch (error) { return handled(error, cors); }
}

async function login(request, env, cors) {
  try {
    const data = await body(request);
    const username = cleanUsername(data.username);
    const role = ['member', 'coach', 'admin'].includes(data.role) ? data.role : null;
    if (!role) throw new HttpError(400, '登录身份无效。');
    const password = String(data.password || '');
    const user = await env.DB.prepare('SELECT * FROM users WHERE username = ? AND role = ?').bind(username, role).first();
    if (!user || user.status !== 'active') throw new HttpError(401, '账号、密码或身份不匹配。');
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) throw new HttpError(429, '尝试次数过多，请稍后再试。');
    const record = await passwordRecord(password, user.password_salt);
    if (record.hash !== user.password_hash) {
      const attempts = Number(user.failed_attempts || 0) + 1;
      const lockedUntil = attempts >= 8 ? new Date(Date.now() + 15 * 60000).toISOString() : null;
      await env.DB.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').bind(attempts >= 8 ? 0 : attempts, lockedUntil, user.id).run();
      throw new HttpError(401, '账号、密码或身份不匹配。');
    }
    await env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').bind(user.id).run();
    const session = await createSession(user, env);
    return json({ ...session, account: { id: user.id, username: user.username, name: user.display_name, role: user.role } }, 200, cors);
  } catch (error) { return handled(error, cors); }
}

async function logout(auth, env, cors) {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(auth.token_hash).run();
  return json({ ok: true }, 200, cors);
}

async function bootstrap(auth, env, cors) {
  const coachesResult = await env.DB.prepare(`
    SELECT u.id, u.username, u.display_name AS name, u.status, p.specialty, p.tags, p.experience
    FROM users u JOIN coach_profiles p ON p.user_id = u.id
    ${auth.role === 'admin' ? '' : "WHERE u.status = 'active'"}
    ORDER BY u.created_at
  `).all();
  const slotsResult = await env.DB.prepare(`
    SELECT s.id, s.coach_id AS coachId, s.slot_date AS date, s.slot_time AS time, s.capacity,
      SUM(CASE WHEN b.status IN ('confirmed','completed') THEN 1 ELSE 0 END) AS bookedCount
    FROM slots s LEFT JOIN bookings b ON b.slot_id = s.id
    WHERE s.slot_date >= date('now') GROUP BY s.id ORDER BY s.slot_date, s.slot_time
  `).all();
  let bookingsSql = `
    SELECT b.id, b.slot_id AS slotId, b.status, b.note, b.created_at AS createdAt,
      m.username AS member, m.display_name AS memberName
    FROM bookings b JOIN users m ON m.id = b.member_id JOIN slots s ON s.id = b.slot_id`;
  const bindings = [];
  if (auth.role === 'member') { bookingsSql += ' WHERE b.member_id = ?'; bindings.push(auth.id); }
  if (auth.role === 'coach') { bookingsSql += ' WHERE s.coach_id = ?'; bindings.push(auth.id); }
  bookingsSql += ' ORDER BY s.slot_date, s.slot_time';
  const bookingsResult = await env.DB.prepare(bookingsSql).bind(...bindings).all();
  let users = [];
  if (auth.role === 'admin') {
    const usersResult = await env.DB.prepare(`
      SELECT id, username, display_name AS name, role, status, created_at AS createdAt
      FROM users WHERE role = 'member' ORDER BY created_at DESC
    `).all();
    users = usersResult.results;
  }
  const coaches = coachesResult.results.map((coach) => ({ ...coach, tags: parseTags(coach.tags), experience: Number(coach.experience) }));
  const slots = slotsResult.results.map((slot) => ({ ...slot, capacity: Number(slot.capacity), bookedCount: Number(slot.bookedCount) }));
  return json({ account: { id: auth.id, username: auth.username, name: auth.name, role: auth.role }, coaches, slots, bookings: bookingsResult.results, users }, 200, cors);
}

function parseTags(value) { try { const tags = JSON.parse(value); return Array.isArray(tags) ? tags : []; } catch { return []; } }

async function createBooking(request, auth, env, cors) {
  try {
    requireRole(auth, 'member');
    const data = await body(request);
    const slotId = String(data.slotId || '');
    const note = String(data.note || '').trim().slice(0, 200);
    if (!slotId) throw new HttpError(400, '请选择预约时段。');
    const id = crypto.randomUUID();
    const result = await env.DB.prepare(`
      INSERT INTO bookings (id, slot_id, member_id, note)
      SELECT ?, s.id, ?, ? FROM slots s
      WHERE s.id = ? AND s.slot_date >= date('now')
        AND (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = s.id AND b.status IN ('confirmed','completed')) < s.capacity
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id = s.id AND b.member_id = ? AND b.status IN ('confirmed','completed'))
    `).bind(id, auth.id, note, slotId, auth.id).run();
    if (!result.meta.changes) throw new HttpError(409, '时段已满、已预约或不可用。');
    return json({ id, status: 'confirmed' }, 201, cors);
  } catch (error) { return handled(error, cors); }
}

async function updateBooking(request, auth, env, cors, bookingId) {
  try {
    const data = await body(request);
    const status = String(data.status || '');
    let query;
    if (auth.role === 'member' && status === 'cancelled') {
      query = env.DB.prepare(`UPDATE bookings SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND member_id = ? AND status = 'confirmed'`).bind(bookingId, auth.id);
    } else if (auth.role === 'coach' && status === 'completed') {
      query = env.DB.prepare(`UPDATE bookings SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'confirmed' AND slot_id IN (SELECT id FROM slots WHERE coach_id = ?)`).bind(bookingId, auth.id);
    } else if (auth.role === 'admin' && ['cancelled', 'completed'].includes(status)) {
      query = env.DB.prepare(`UPDATE bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'confirmed'`).bind(status, bookingId);
    } else throw new HttpError(403, '没有权限执行此操作。');
    const result = await query.run();
    if (!result.meta.changes) throw new HttpError(404, '没有找到可更新的预约。');
    return json({ id: bookingId, status }, 200, cors);
  } catch (error) { return handled(error, cors); }
}

async function createSlot(request, auth, env, cors) {
  try {
    requireRole(auth, 'coach');
    const data = await body(request);
    const date = String(data.date || '');
    const time = String(data.time || '');
    const capacity = Number(data.capacity);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || capacity < 1 || capacity > 20) throw new HttpError(400, '排期信息不完整。');
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare('INSERT INTO slots (id, coach_id, slot_date, slot_time, capacity) VALUES (?, ?, ?, ?, ?)').bind(id, auth.id, date, time, capacity).run();
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new HttpError(409, '这个时间已经开放。');
      throw error;
    }
    return json({ id }, 201, cors);
  } catch (error) { return handled(error, cors); }
}

async function deleteSlot(auth, env, cors, slotId) {
  try {
    requireRole(auth, 'coach');
    const result = await env.DB.prepare(`
      DELETE FROM slots WHERE id = ? AND coach_id = ?
      AND NOT EXISTS (SELECT 1 FROM bookings WHERE slot_id = slots.id AND status IN ('confirmed','completed'))
    `).bind(slotId, auth.id).run();
    if (!result.meta.changes) throw new HttpError(409, '已有预约的排期不能删除。');
    return json({ ok: true }, 200, cors);
  } catch (error) { return handled(error, cors); }
}

async function createCoach(request, auth, env, cors) {
  try {
    requireRole(auth, 'admin');
    const data = await body(request);
    const username = cleanUsername(data.username);
    const name = cleanName(data.name);
    const password = cleanPassword(data.password);
    const specialty = String(data.specialty || '').trim().slice(0, 40);
    const experience = Math.max(0, Math.min(60, Number(data.experience) || 0));
    if (!specialty) throw new HttpError(400, '请选择主攻方向。');
    const record = await passwordRecord(password);
    const id = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO users (id, username, display_name, role, password_hash, password_salt) VALUES (?, ?, ?, 'coach', ?, ?)`).bind(id, username, name, record.hash, record.salt),
        env.DB.prepare('INSERT INTO coach_profiles (user_id, specialty, tags, experience) VALUES (?, ?, ?, ?)').bind(id, specialty, JSON.stringify([specialty]), experience)
      ]);
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new HttpError(409, '登录账号已存在。');
      throw error;
    }
    return json({ id, username, name, role: 'coach' }, 201, cors);
  } catch (error) { return handled(error, cors); }
}

async function updateCoach(request, auth, env, cors, coachId) {
  try {
    requireRole(auth, 'admin');
    const data = await body(request);
    const status = data.status === 'active' ? 'active' : data.status === 'inactive' ? 'inactive' : null;
    if (!status) throw new HttpError(400, '状态无效。');
    const result = await env.DB.prepare(`UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND role = 'coach'`).bind(status, coachId).run();
    if (!result.meta.changes) throw new HttpError(404, '没有找到该教练。');
    return json({ id: coachId, status }, 200, cors);
  } catch (error) { return handled(error, cors); }
}

async function resetMemberPassword(request, auth, env, cors, memberId) {
  try {
    requireRole(auth, 'admin');
    const data = await body(request);
    const password = cleanPassword(data.password);
    const record = await passwordRecord(password);
    const result = await env.DB.prepare(`
      UPDATE users SET password_hash = ?, password_salt = ?, failed_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND role = 'member'
    `).bind(record.hash, record.salt, memberId).run();
    if (!result.meta.changes) throw new HttpError(404, '没有找到该用户。');
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(memberId).run();
    return json({ ok: true }, 200, cors);
  } catch (error) { return handled(error, cors); }
}

async function changeOwnPassword(request, auth, env, cors) {
  try {
    const data = await body(request);
    const password = cleanPassword(data.password);
    const record = await passwordRecord(password);
    await env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(record.hash, record.salt, auth.id).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(auth.id, auth.token_hash).run();
    return json({ ok: true }, 200, cors);
  } catch (error) { return handled(error, cors); }
}

function requireRole(auth, role) {
  if (auth.role !== role) throw new HttpError(403, '没有权限执行此操作。');
}

function handled(error, cors) {
  if (error instanceof HttpError) return json({ error: 'request_error', message: error.message }, error.status, cors);
  console.error(error);
  return json({ error: 'server_error', message: '服务暂时不可用，请稍后重试。' }, 500, cors);
}
