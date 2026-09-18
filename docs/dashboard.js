const session = JSON.parse(sessionStorage.getItem('wesporth_session') || 'null');
if (!session?.token || !session?.account) window.location.replace('index.html');

const account = session.account;
const ROLE_NAMES = { member: '用户', coach: '教练', admin: '管理员' };
const NAV = {
  member: [
    { id: 'home', label: '发现', icon: '⌁' },
    { id: 'bookings', label: '我的预约', icon: '▣' },
    { id: 'profile', label: '账号', icon: '◉' }
  ],
  coach: [
    { id: 'home', label: '工作台', icon: '⌁' },
    { id: 'schedule', label: '排期管理', icon: '▦' },
    { id: 'clients', label: '预约名单', icon: '◉' },
    { id: 'profile', label: '账号', icon: '◇' }
  ],
  admin: [
    { id: 'home', label: '总览', icon: '⌁' },
    { id: 'coaches', label: '教练管理', icon: '◉' },
    { id: 'users', label: '用户管理', icon: '◎' },
    { id: 'bookings', label: '全部预约', icon: '▣' },
    { id: 'profile', label: '账号', icon: '◇' }
  ]
};

const state = { view: 'home', coachFilter: '全部', selectedSlot: null, passwordTarget: null, nameTarget: null };
const db = { coaches: [], slots: [], bookings: [], users: [] };
const $ = (selector) => document.querySelector(selector);
const content = $('#app-content');

function dateISO(offset = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formatDate(value, options = {}) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', weekday: 'short', ...options }).format(new Date(`${value}T12:00:00`));
}

function initials(name) { return String(name).slice(-2).toUpperCase(); }
function getCoach(id) { return db.coaches.find((item) => item.id === id); }
function getSlot(id) { return db.slots.find((item) => item.id === id); }
function slotBookings(id) { return db.bookings.filter((item) => item.slotId === id && item.status !== 'cancelled'); }
function availableCount(slot) { return Math.max(0, Number(slot.capacity) - Number(slot.bookedCount || 0)); }

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2600);
}

function showFailure(error) {
  showToast(error instanceof Error ? error.message : '操作失败，请稍后重试。');
}

function openModal(html) {
  $('#modal-content').innerHTML = html;
  $('#modal').hidden = false;
  $('#modal-content input, #modal-content button, #modal-content select')?.focus();
}

function closeModal() {
  $('#modal').hidden = true;
  state.selectedSlot = null;
  state.passwordTarget = null;
  state.nameTarget = null;
}

function buildNav() {
  const markup = NAV[account.role].map((item) => `<button class="nav-button ${state.view === item.id ? 'active' : ''}" data-view="${item.id}" type="button"><span class="nav-icon">${item.icon}</span>${item.label}</button>`).join('');
  $('#side-nav').innerHTML = markup;
  $('#mobile-nav').innerHTML = markup;
}

function setHeader(title, kicker, actionLabel = '') {
  $('#page-title').textContent = title;
  $('#page-kicker').textContent = kicker;
  const action = $('#primary-action');
  action.hidden = !actionLabel;
  action.textContent = actionLabel;
}

function metric(label, value, note, accent = false) {
  return `<article class="metric-card ${accent ? 'accent' : ''}"><span class="metric-label">${label}<span>↗</span></span><strong class="metric-value">${value}</strong><span class="metric-note">${note}</span></article>`;
}

function bookingRow(booking, mode = 'member') {
  const slot = getSlot(booking.slotId);
  if (!slot) return '';
  const coach = getCoach(slot.coachId);
  const date = new Date(`${slot.date}T12:00:00`);
  const action = mode === 'member' && booking.status === 'confirmed'
    ? `<button class="inline-button danger" data-action="cancel-booking" data-id="${booking.id}">取消</button>`
    : mode === 'coach' && booking.status === 'confirmed'
      ? `<button class="inline-button" data-action="complete-booking" data-id="${booking.id}">核销</button>`
      : `<span class="status-badge ${booking.status}">${{ confirmed: '已预约', completed: '已完成', cancelled: '已取消' }[booking.status]}</span>`;
  return `<article class="appointment-row">
    <div class="date-tile"><div><strong>${date.getDate()}</strong><span>${date.toLocaleDateString('zh-CN', { month: 'short' })}</span></div></div>
    <div class="row-main"><strong>${mode === 'member' ? esc(coach?.name || '教练') : esc(booking.memberName)}</strong><span>${esc(coach?.specialty || '私教课程')} · ${slot.time}</span></div>
    <div class="row-meta">${formatDate(slot.date)}<br>${esc(booking.note || '常规训练')}</div>
    ${action}
  </article>`;
}

function coachCard(coach) {
  const future = db.slots.filter((item) => item.coachId === coach.id && item.date >= dateISO() && availableCount(item) > 0).length;
  return `<article class="coach-card"><div class="coach-top"><div class="coach-avatar">${initials(coach.name)}</div><div><h3>${esc(coach.name)}</h3><p>${coach.experience} 年经验 · ${esc(coach.specialty)}</p></div></div><div class="coach-tags">${coach.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}</div><div class="coach-footer"><strong>${future} 个可约时段</strong><button class="inline-button" data-action="view-coach" data-id="${coach.id}">查看排期</button></div></article>`;
}

function renderMemberHome() {
  const active = db.bookings.filter((item) => item.status === 'confirmed');
  const completed = db.bookings.filter((item) => item.status === 'completed');
  const available = db.slots.filter((item) => item.date >= dateISO() && availableCount(item) > 0).length;
  const filters = ['全部', ...new Set(db.coaches.map((coach) => coach.specialty))];
  const coaches = db.coaches.filter((coach) => coach.status === 'active' && (state.coachFilter === '全部' || coach.specialty === state.coachFilter));
  setHeader(`你好，${account.name}`, 'KEEP MOVING');
  content.innerHTML = `<div class="metric-grid">${metric('待训练', String(active.length).padStart(2, '0'), active.length ? '最近一次已加入日程' : '预约你的第一节课', true)}${metric('本周可约', String(available).padStart(2, '0'), '覆盖全部在岗教练')}${metric('已完成', String(completed.length).padStart(2, '0'), '持续积累训练记录')}</div>
    <section class="section-block"><div class="section-head"><div><h2>选择你的教练</h2><p>找到适合目标和时间的私教</p></div><div class="filter-pills">${filters.map((filter) => `<button class="filter-pill ${state.coachFilter === filter ? 'active' : ''}" data-action="filter-coach" data-filter="${esc(filter)}">${esc(filter)}</button>`).join('')}</div></div><div class="coach-grid">${coaches.length ? coaches.map(coachCard).join('') : '<div class="empty-state"><div><strong>暂无在岗教练</strong>请等待管理员添加教练。</div></div>'}</div></section>
    <section class="section-block"><div class="section-head"><div><h2>即将开始</h2><p>你的下一次训练安排</p></div><button class="inline-button" data-view="bookings">查看全部</button></div><div class="appointment-list">${active.length ? active.slice(0, 2).map((item) => bookingRow(item)).join('') : '<div class="empty-state"><div><strong>还没有预约</strong>选择教练，给训练留出时间。</div></div>'}</div></section>`;
}

function renderMemberBookings() {
  const endDate = dateISO(13);
  const futureBookings = db.bookings.filter((booking) => {
    const slot = getSlot(booking.slotId);
    return booking.status === 'confirmed' && slot && slot.date >= dateISO() && slot.date <= endDate;
  });
  const days = Array.from({ length: 14 }, (_, index) => dateISO(index));
  setHeader('我的预约', 'MY SESSIONS');
  content.innerHTML = `<section class="section-block"><div class="section-head"><div><h2>未来 14 天课程表</h2><p>已预约课程按日期排列，每排显示 7 天</p></div><span class="date-chip">${futureBookings.length} 节待上课</span></div><div class="slot-calendar booking-calendar">${days.map((date) => { const bookings = futureBookings.filter((booking) => getSlot(booking.slotId)?.date === date); return `<div class="day-column"><h3>${formatDate(date, { weekday: 'short' })}<span>${date.slice(5).replace('-', '/')}</span></h3>${bookings.length ? bookings.map((booking) => { const slot = getSlot(booking.slotId); const coach = getCoach(slot.coachId); return `<div class="slot-chip mine"><strong>${slot.time}</strong><br>${esc(coach?.name || '教练')}</div>`; }).join('') : '<div class="calendar-empty">—</div>'}</div>`; }).join('')}</div></section>
    <section class="section-block"><div class="section-head"><div><h2>全部训练记录</h2><p>预约成功后可在开课前取消</p></div></div><div class="appointment-list">${db.bookings.length ? db.bookings.map((item) => bookingRow(item)).join('') : '<div class="empty-state"><div><strong>暂无预约记录</strong>从发现页选择教练和时段。</div></div>'}</div></section>`;
}

function renderProfile() {
  setHeader('账号设置', 'ACCOUNT');
  content.innerHTML = `<section class="section-block"><div class="section-head"><div><h2>基本信息</h2><p>当前登录账号</p></div></div><div class="data-list"><div class="data-row"><div class="row-main"><strong>${esc(account.name)}</strong><span>${esc(account.username)}</span></div><div class="row-meta">身份：${ROLE_NAMES[account.role]}</div><div></div><button class="inline-button" data-action="change-password">修改密码</button></div></div></section>`;
}

function renderCoachHome() {
  const slots = db.slots.filter((item) => item.coachId === account.id && item.date >= dateISO());
  const active = db.bookings.filter((item) => item.status === 'confirmed');
  const today = active.filter((item) => getSlot(item.slotId)?.date === dateISO());
  setHeader(`今日安排，${account.name}`, 'COACH DESK', '＋ 新增排期');
  content.innerHTML = `<div class="metric-grid">${metric('今日预约', String(today.length).padStart(2, '0'), '按时到场并完成核销', true)}${metric('开放时段', String(slots.length).padStart(2, '0'), '未来可预约排期')}${metric('待服务', String(active.length).padStart(2, '0'), '已确认预约总数')}</div><section class="section-block"><div class="section-head"><div><h2>近期预约</h2><p>最新确认的会员训练</p></div><button class="inline-button" data-view="clients">查看名单</button></div><div class="appointment-list">${active.length ? active.slice(0, 4).map((item) => bookingRow(item, 'coach')).join('') : '<div class="empty-state"><div><strong>暂无待服务预约</strong>新预约会显示在这里。</div></div>'}</div></section>`;
}

function renderCoachSchedule() {
  setHeader('排期管理', 'AVAILABILITY', '＋ 新增排期');
  const days = Array.from({ length: 14 }, (_, index) => dateISO(index));
  content.innerHTML = `<section class="section-block"><div class="section-head"><div><h2>未来 14 天</h2><p>两排展示，每排 7 天；点击时段可查看占用情况或删除空排期</p></div></div><div class="slot-calendar">${days.map((date) => { const slots = db.slots.filter((item) => item.coachId === account.id && item.date === date).sort((a, b) => a.time.localeCompare(b.time)); return `<div class="day-column"><h3>${formatDate(date, { weekday: 'short' })}<span>${date.slice(5).replace('-', '/')}</span></h3>${slots.length ? slots.map((slot) => `<button class="slot-chip ${availableCount(slot) ? 'available' : 'full'}" data-action="manage-slot" data-id="${slot.id}">${slot.time}<br>${slot.bookedCount}/${slot.capacity} 人</button>`).join('') : '<div class="empty-state" style="min-height:80px;font-size:.72rem">休息</div>'}</div>`; }).join('')}</div></section>`;
}

function renderCoachClients() {
  setHeader('预约名单', 'CLIENTS');
  content.innerHTML = `<section class="section-block"><div class="section-head"><div><h2>会员预约</h2><p>到场后点击核销完成训练</p></div></div><div class="appointment-list">${db.bookings.length ? db.bookings.map((item) => bookingRow(item, 'coach')).join('') : '<div class="empty-state"><div><strong>暂无预约名单</strong>开放排期后等待用户预约。</div></div>'}</div></section>`;
}

function adminCoachRow(coach) {
  const slots = db.slots.filter((item) => item.coachId === coach.id && item.date >= dateISO());
  const capacity = slots.reduce((sum, slot) => sum + Number(slot.capacity), 0);
  const booked = slots.reduce((sum, slot) => sum + Number(slot.bookedCount || 0), 0);
  const percent = capacity ? Math.min(100, Math.round(booked / capacity * 100)) : 0;
  return `<article class="data-row"><div class="row-main"><strong>${esc(coach.name)}</strong><span>${esc(coach.specialty)} · ${esc(coach.username)}</span></div><div><div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div><div class="row-meta" style="margin-top:6px">预约占用 ${percent}%</div></div><div class="row-meta">${slots.length} 个开放时段<br>${booked} 个待服务</div><div class="actions"><button class="inline-button" data-action="edit-user-name" data-id="${coach.id}" data-name="${esc(coach.name)}">修改姓名</button><button class="inline-button" data-action="reset-user-password" data-id="${coach.id}" data-name="${esc(coach.name)}">修改密码</button><button class="inline-button" data-action="toggle-coach" data-id="${coach.id}" data-status="${coach.status}">${coach.status === 'active' ? '停用' : '启用'}</button></div></article>`;
}

function renderAdminHome() {
  const active = db.bookings.filter((item) => item.status === 'confirmed').length;
  setHeader('运营总览', 'ADMIN CONSOLE', '＋ 创建教练');
  content.innerHTML = `<div class="metric-grid">${metric('在岗教练', String(db.coaches.filter((item) => item.status === 'active').length).padStart(2, '0'), '拥有排期管理权限', true)}${metric('注册用户', String(db.users.length).padStart(2, '0'), '共享数据库账号')}${metric('有效预约', String(active).padStart(2, '0'), '待服务预约数量')}</div><section class="section-block"><div class="section-head"><div><h2>教练状态</h2><p>查看团队开放时段与预约负载</p></div><button class="inline-button" data-view="coaches">管理教练</button></div><div class="data-list">${db.coaches.length ? db.coaches.map(adminCoachRow).join('') : '<div class="empty-state"><div><strong>暂无教练</strong>先创建第一个教练账号。</div></div>'}</div></section>`;
}

function renderAdminCoaches() {
  setHeader('教练管理', 'TEAM ACCESS', '＋ 创建教练');
  content.innerHTML = `<section class="section-block"><div class="section-head"><div><h2>教练账号</h2><p>只有管理员可以创建或停用教练账号</p></div></div><div class="data-list">${db.coaches.length ? db.coaches.map(adminCoachRow).join('') : '<div class="empty-state"><div><strong>暂无教练账号</strong>点击右上角创建教练。</div></div>'}</div></section>`;
}

function adminUserRow(user) {
  const bookings = db.bookings.filter((item) => item.member === user.username);
  const active = bookings.filter((item) => item.status === 'confirmed').length;
  const completed = bookings.filter((item) => item.status === 'completed').length;
  return `<article class="data-row user-row"><div class="row-main"><strong>${esc(user.name)}</strong><span>${esc(user.username)}</span></div><div class="row-meta">待训练 ${active} 次<br>已完成 ${completed} 次</div><div class="row-meta">预约总数 ${bookings.length}</div><div class="actions"><button class="inline-button" data-action="edit-user-name" data-id="${user.id}" data-name="${esc(user.name)}">修改姓名</button><button class="inline-button" data-action="reset-user-password" data-id="${user.id}" data-name="${esc(user.name)}">修改密码</button></div></article>`;
}

function renderAdminUsers() {
  setHeader('用户管理', 'MEMBER ACCOUNTS');
  content.innerHTML = `<section class="section-block"><div class="section-head"><div><h2>用户账号</h2><p>查看用户预约情况并重设登录密码</p></div><span class="date-chip">${db.users.length} 位用户</span></div><div class="data-list">${db.users.length ? db.users.map(adminUserRow).join('') : '<div class="empty-state"><div><strong>暂无注册用户</strong>新用户注册后会显示在这里。</div></div>'}</div></section>`;
}

function renderAdminBookings() {
  setHeader('全部预约', 'BOOKING LOG');
  content.innerHTML = `<section class="section-block"><div class="section-head"><div><h2>预约记录</h2><p>按预约状态统一查看</p></div></div><div class="appointment-list">${db.bookings.length ? db.bookings.map((item) => bookingRow(item, 'admin')).join('') : '<div class="empty-state"><div><strong>暂无预约</strong>新预约会显示在这里。</div></div>'}</div></section>`;
}

function render() {
  buildNav();
  if (state.view === 'profile') return renderProfile();
  if (account.role === 'member') return state.view === 'bookings' ? renderMemberBookings() : renderMemberHome();
  if (account.role === 'coach') {
    if (state.view === 'schedule') return renderCoachSchedule();
    if (state.view === 'clients') return renderCoachClients();
    return renderCoachHome();
  }
  if (state.view === 'coaches') return renderAdminCoaches();
  if (state.view === 'users') return renderAdminUsers();
  if (state.view === 'bookings') return renderAdminBookings();
  return renderAdminHome();
}

async function refresh(message = '') {
  const data = await WesportAPI.get('/api/bootstrap');
  db.coaches = data.coaches || [];
  db.slots = data.slots || [];
  db.bookings = data.bookings || [];
  db.users = data.users || [];
  render();
  if (message) showToast(message);
}

function showCoachSchedule(coachId) {
  const coach = getCoach(coachId);
  const slots = db.slots.filter((item) => item.coachId === coachId && item.date >= dateISO()).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  openModal(`<p class="eyebrow lime">BOOK A SESSION</p><h2 id="modal-title">${esc(coach.name)}的排期</h2><p class="muted">${esc(coach.specialty)} · 选择有余位的训练时间</p><div class="slot-options">${slots.length ? slots.map((slot) => `<button class="slot-option" data-action="select-slot" data-id="${slot.id}" ${availableCount(slot) < 1 ? 'disabled' : ''}><strong>${formatDate(slot.date)}</strong><br>${slot.time} · ${availableCount(slot) ? `剩 ${availableCount(slot)} 位` : '已约满'}</button>`).join('') : '<div class="empty-state"><div><strong>暂无开放排期</strong>请选择其他教练。</div></div>'}</div><label for="booking-note">训练备注</label><textarea id="booking-note" maxlength="200" placeholder="例如：第一次训练，希望先做体态评估"></textarea><p id="booking-error" class="form-error" hidden></p><button class="primary-button" data-action="confirm-booking" type="button">确认预约 <span>↗</span></button>`);
}

function addSlotModal() {
  openModal(`<p class="eyebrow lime">OPEN AVAILABILITY</p><h2 id="modal-title">新增可约时段</h2><p class="muted">开放后用户可立即预约；已有预约的时段不能删除。</p><form id="slot-form" class="form-grid"><div><label for="slot-date">日期</label><input id="slot-date" type="date" min="${dateISO()}" value="${dateISO(1)}" required></div><div><label for="slot-time">开始时间</label><input id="slot-time" type="time" value="10:00" required></div><div class="full-field"><label for="slot-capacity">可预约人数</label><select id="slot-capacity"><option value="1">1 人 · 一对一</option><option value="2">2 人 · 双人课</option><option value="4">4 人 · 小组课</option></select></div><div class="full-field"><p id="slot-error" class="form-error" hidden></p><button class="primary-button" type="submit">发布排期 <span>↗</span></button></div></form>`);
}

function createCoachModal() {
  openModal(`<p class="eyebrow lime">NEW COACH</p><h2 id="modal-title">创建教练账号</h2><p class="muted">教练使用这里设置的账号和密码登录。</p><form id="coach-form" class="form-grid"><div><label for="coach-name">教练姓名</label><input id="coach-name" required placeholder="例如：赵教练"></div><div><label for="coach-username">登录账号</label><input id="coach-username" minlength="3" pattern="[a-z0-9_]+" required placeholder="coach01"></div><div><label for="coach-specialty">主攻方向</label><select id="coach-specialty"><option>增肌塑形</option><option>减脂燃脂</option><option>瑜伽康复</option><option>体能训练</option></select></div><div><label for="coach-experience">从业年限</label><input id="coach-experience" type="number" min="0" max="60" value="3" required></div><div class="full-field"><label for="coach-password">初始密码</label><input id="coach-password" type="password" minlength="8" required placeholder="至少 8 个字符"></div><div class="full-field"><p id="coach-error" class="form-error" hidden></p><button class="primary-button" type="submit">创建教练 <span>↗</span></button></div></form>`);
}

function passwordModal(targetId = null, name = '') {
  state.passwordTarget = targetId;
  const adminReset = Boolean(targetId);
  openModal(`<p class="eyebrow lime">${adminReset ? 'RESET PASSWORD' : 'SECURITY'}</p><h2 id="modal-title">${adminReset ? `修改${esc(name)}的密码` : '修改登录密码'}</h2><p class="muted">新密码至少 8 位。${adminReset ? '保存后，该用户现有会话会退出。' : ''}</p><form id="password-form"><label for="new-password">新密码</label><input id="new-password" type="password" minlength="8" required placeholder="至少 8 个字符"><label for="confirm-password">确认新密码</label><input id="confirm-password" type="password" minlength="8" required placeholder="再次输入"><p id="password-error" class="form-error" hidden></p><button class="primary-button" type="submit">保存新密码</button></form>`);
}

function nameModal(targetId, name) {
  state.nameTarget = targetId;
  openModal(`<p class="eyebrow lime">EDIT PROFILE</p><h2 id="modal-title">修改姓名</h2><p class="muted">登录账号保持不变，只更新系统中显示的姓名。</p><form id="name-form"><label for="display-name">姓名</label><input id="display-name" value="${esc(name)}" maxlength="40" required><p id="name-error" class="form-error" hidden></p><button class="primary-button" type="submit">保存姓名</button></form>`);
}

document.addEventListener('click', async (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) { state.view = viewButton.dataset.view; render(); return; }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const id = action.dataset.id;
  try {
    if (action.dataset.action === 'logout') {
      await WesportAPI.post('/api/auth/logout', {}).catch(() => {});
      sessionStorage.removeItem('wesporth_session');
      window.location.replace('index.html');
    } else if (action.dataset.action === 'close-modal') closeModal();
    else if (action.dataset.action === 'view-coach') showCoachSchedule(id);
    else if (action.dataset.action === 'filter-coach') { state.coachFilter = action.dataset.filter; render(); }
    else if (action.dataset.action === 'select-slot') {
      state.selectedSlot = id;
      document.querySelectorAll('.slot-option').forEach((item) => item.classList.toggle('selected', item.dataset.id === id));
    } else if (action.dataset.action === 'confirm-booking') await createBooking();
    else if (action.dataset.action === 'cancel-booking') await updateBooking(id, 'cancelled', '预约已取消');
    else if (action.dataset.action === 'complete-booking') await updateBooking(id, 'completed', '预约已核销');
    else if (action.dataset.action === 'manage-slot') manageSlot(id);
    else if (action.dataset.action === 'toggle-coach') await toggleCoach(id, action.dataset.status);
    else if (action.dataset.action === 'change-password') passwordModal();
    else if (action.dataset.action === 'reset-user-password') passwordModal(id, action.dataset.name);
    else if (action.dataset.action === 'edit-user-name') nameModal(id, action.dataset.name);
  } catch (error) { showFailure(error); }
});

$('#primary-action').addEventListener('click', () => account.role === 'admin' ? createCoachModal() : addSlotModal());
$('#modal').addEventListener('click', (event) => { if (event.target === $('#modal')) closeModal(); });

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    if (event.target.id === 'slot-form') await addSlot();
    if (event.target.id === 'coach-form') await createCoach();
    if (event.target.id === 'password-form') await changePassword();
    if (event.target.id === 'name-form') await changeManagedName();
  } catch (error) {
    const errorElement = event.target.querySelector('.form-error');
    if (errorElement) { errorElement.textContent = error.message; errorElement.hidden = false; }
    else showFailure(error);
  }
});

async function createBooking() {
  const error = $('#booking-error');
  if (!state.selectedSlot) { error.textContent = '请先选择一个可约时段。'; error.hidden = false; return; }
  await WesportAPI.post('/api/bookings', { slotId: state.selectedSlot, note: $('#booking-note').value.trim() });
  closeModal();
  await refresh('预约成功，已加入你的训练日程');
}

async function updateBooking(id, status, message) {
  await WesportAPI.patch(`/api/bookings/${encodeURIComponent(id)}`, { status });
  await refresh(message);
}

async function addSlot() {
  await WesportAPI.post('/api/slots', { date: $('#slot-date').value, time: $('#slot-time').value, capacity: Number($('#slot-capacity').value) });
  closeModal();
  await refresh('新排期已发布');
}

function manageSlot(id) {
  const slot = getSlot(id);
  const bookings = slotBookings(id);
  openModal(`<p class="eyebrow lime">SLOT DETAILS</p><h2 id="modal-title">${formatDate(slot.date)} · ${slot.time}</h2><p class="muted">当前 ${slot.bookedCount}/${slot.capacity} 人预约</p>${bookings.length ? `<div class="appointment-list">${bookings.map((item) => bookingRow(item, 'coach')).join('')}</div>` : `<button id="delete-slot" class="primary-button" type="button">删除空排期</button>`}`);
  $('#delete-slot')?.addEventListener('click', async () => {
    try { await WesportAPI.delete(`/api/slots/${encodeURIComponent(id)}`); closeModal(); await refresh('排期已删除'); } catch (error) { showFailure(error); }
  });
}

async function createCoach() {
  await WesportAPI.post('/api/admin/coaches', { name: $('#coach-name').value.trim(), username: $('#coach-username').value.trim(), password: $('#coach-password').value, specialty: $('#coach-specialty').value, experience: Number($('#coach-experience').value) });
  closeModal();
  await refresh('教练账号已创建');
}

async function toggleCoach(id, currentStatus) {
  await WesportAPI.patch(`/api/admin/coaches/${encodeURIComponent(id)}`, { status: currentStatus === 'active' ? 'inactive' : 'active' });
  await refresh('教练状态已更新');
}

async function changePassword() {
  const password = $('#new-password').value;
  const confirmation = $('#confirm-password').value;
  if (password !== confirmation) throw new Error('两次输入的密码不一致。');
  if (state.passwordTarget) await WesportAPI.put(`/api/admin/users/${encodeURIComponent(state.passwordTarget)}/password`, { password });
  else await WesportAPI.put('/api/account/password', { password });
  closeModal();
  await refresh('密码已更新');
}

async function changeManagedName() {
  const name = $('#display-name').value.trim();
  if (!name) throw new Error('姓名不能为空。');
  await WesportAPI.put(`/api/admin/users/${encodeURIComponent(state.nameTarget)}/name`, { name });
  closeModal();
  await refresh('姓名已更新');
}

$('#sidebar-name').textContent = account.name;
$('#sidebar-role').textContent = ROLE_NAMES[account.role];
$('#sidebar-avatar').textContent = initials(account.name);
$('#today-label').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
content.innerHTML = '<div class="empty-state"><div><strong>正在加载</strong>正在同步共享预约数据…</div></div>';

refresh().catch((error) => {
  if (!sessionStorage.getItem('wesporth_session')) window.location.replace('index.html');
  content.innerHTML = `<div class="empty-state"><div><strong>加载失败</strong>${esc(error.message)}<br><button class="inline-button" style="margin-top:16px" onclick="location.reload()">重新加载</button></div></div>`;
});
