// Julie web client. Plain ES modules, no build step. All text is inserted as text nodes (never innerHTML), so user content cannot inject markup.
const root = document.getElementById('app');
const state = { me: null };

const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) { if (kid == null || kid === false) continue; el.append(kid instanceof Node ? kid : document.createTextNode(String(kid))); }
  return el;
};
const can = (p) => !!state.me && state.me.permissions.includes(p);
const fmt = (s) => (s ? new Date(s).toLocaleString() : '—');
const day = (s) => (s ? new Date(s).toLocaleDateString() : '—');

let toastTimer;
function toast(msg, bad) {
  const t = document.getElementById('toast'); t.textContent = msg; t.className = 'show';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), bad ? 5000 : 2500);
}
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
async function api(method, path, body) {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'julie', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && state.me && path !== '/api/auth/login') { state.me = null; go('#/login'); }
    throw new ApiError(res.status, data?.error?.code, data?.error?.message || 'Request failed');
  }
  return data;
}
const act = (fn, done) => async (ev) => {
  ev?.preventDefault?.(); const btn = ev?.submitter || ev?.currentTarget; if (btn && 'disabled' in btn) btn.disabled = true;
  try { await fn(ev); if (done) done(); } catch (e) { toast(e.message, true); } finally { if (btn && 'disabled' in btn) btn.disabled = false; }
};
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
const paragraphs = (text) => String(text || '').split(/\n{2,}/).map((p) => h('p', {}, p));
const field = (label, control) => h('div', {}, h('label', {}, label), control);
const inp = (name, type = 'text', extra = {}) => h('input', { name, type, ...extra });
const val = (form, name) => form.elements[name]?.value?.trim();
const progressBar = (pct, label) => h('div', {}, h('progress', { value: pct, max: 100, 'aria-label': label || 'Progress' }), h('div', { class: 'small muted' }, `${pct}%`));
const empty = (msg, ...more) => h('div', { class: 'empty' }, msg, ...more);
const tag = (t, kind) => h('span', { class: 'tag ' + (kind || '') }, t);
const notice = (msg, kind) => h('div', { class: 'notice ' + (kind || '') }, msg);

// ── Shell ──
function shell(content, current) {
  const links = [];
  const add = (perm, href, text) => { if (can(perm)) links.push([href, text]); };
  add('progress:self', '#/', 'Dashboard'); add('course:read', '#/courses', 'Courses'); add('goal:self', '#/goals', 'Goals'); add('timetable:self', '#/timetable', 'Timetable');
  add('ai:use', '#/tutor', 'Julie AI'); add('notification:self', '#/notifications', 'Notifications'); links.push(['#/news', 'News']); add('subscription:self', '#/plans', 'Plans');
  add('course:manage_own', '#/teach', 'Teach'); add('user:read_any', '#/admin', 'Admin'); add('api_key:manage_own', '#/developer', 'Developer');
  links.push(['#/profile', 'Profile']);
  return h('div', {},
    h('header', { class: 'top' }, h('div', { class: 'bar' },
      h('a', { class: 'brand', href: '#/' }, 'Ju', h('span', {}, 'lie')),
      h('nav', { class: 'main', 'aria-label': 'Main' }, links.map(([href, text]) => h('a', { href, 'aria-current': href === current ? 'page' : null }, text))),
      h('button', { onclick: act(async () => { await api('POST', '/api/auth/logout'); state.me = null; go('#/login'); }) }, 'Sign out'))),
    h('main', { id: 'main' }, content));
}

// ── Auth ──
function authView(mode) {
  const reg = mode === 'register';
  const form = h('form', { class: 'stack', onsubmit: act(async () => {
    const body = { email: val(form, 'email'), password: form.elements.password.value };
    if (reg) body.displayName = val(form, 'displayName');
    state.me = await api('POST', reg ? '/api/auth/register' : '/api/auth/login', body); go('#/');
  }) },
    reg && field('Name', inp('displayName', 'text', { required: true, maxlength: 80, autocomplete: 'name' })),
    field('Email', inp('email', 'email', { required: true, autocomplete: 'email' })),
    field(reg ? 'Password (10+ characters)' : 'Password', inp('password', 'password', { required: true, minlength: reg ? 10 : 1, autocomplete: reg ? 'new-password' : 'current-password' })),
    h('button', { class: 'primary', type: 'submit' }, reg ? 'Create account' : 'Sign in'));
  return h('div', { class: 'auth' }, h('h1', {}, h('span', {}, 'Ju'), 'lie'), h('p', { class: 'muted' }, reg ? 'Create a student account.' : 'Sign in to keep learning.'), form,
    h('p', { class: 'small' }, reg ? 'Already registered? ' : 'New here? ', h('a', { href: reg ? '#/login' : '#/register' }, reg ? 'Sign in' : 'Create an account')));
}

// ── Student ──
async function dashboard() {
  const d = await api('GET', '/api/dashboard'); const m = d.me; const lv = m.level;
  const acc = m.access;
  return [
    h('h1', {}, `Welcome, ${m.displayName}`),
    h('div', { class: 'grid' },
      h('div', { class: 'panel' }, h('div', { class: 'label' }, 'Level'), h('div', { class: 'stat' }, `${lv.level} · ${lv.title}`), h('div', { class: 'small muted' }, `${lv.totalXp} XP` + (lv.xpForNextLevel ? ` · ${lv.xpForNextLevel - lv.xpIntoLevel} to next level` : ' · top level')), progressBar(lv.progressPct, 'Level progress')),
      h('div', { class: 'panel' }, h('div', { class: 'label' }, 'Study streak'), h('div', { class: 'stat' }, `${m.streak.currentDays} day${m.streak.currentDays === 1 ? '' : 's'}`), h('div', { class: 'small muted' }, `Longest: ${m.streak.longestDays}`)),
      h('div', { class: 'panel' }, h('div', { class: 'label' }, 'Access'), h('div', { class: 'stat' }, acc.planCode || (acc.source === 'GRANT' ? 'Admin grant' : 'Free')), h('div', { class: 'small muted' }, acc.hasPremiumAccess ? (acc.neverExpires ? 'Premium, no expiry' : `Premium until ${day(acc.expiresAt)}`) : 'Free access'), h('a', { class: 'small', href: '#/plans' }, 'Manage'))),
    h('h2', {}, 'Your courses'),
    d.courses.length ? h('div', { class: 'grid' }, d.courses.map((c) => h('div', { class: 'panel stack' },
      h('a', { href: `#/course/${c.id}` }, h('strong', {}, c.title)), c.subject && h('div', { class: 'small muted' }, c.subject), progressBar(c.progress.percent, c.title),
      c.nextLesson ? h('a', { class: 'btn primary', href: `#/lesson/${c.nextLesson.id}` }, `Continue: ${c.nextLesson.title}`) : tag(c.progress.totalLessons ? 'Completed' : 'No lessons yet', 'ok'))))
      : empty("You haven't enrolled in a course yet. ", h('a', { href: '#/courses' }, 'Browse courses')),
    h('div', { class: 'grid' },
      h('div', {}, h('h2', {}, 'Open tasks'), d.tasks.length ? h('ul', { class: 'list' }, d.tasks.map((t) => h('li', {}, t.title, t.dueAt && h('span', { class: 'small muted' }, ` · due ${day(t.dueAt)}`)))) : empty('No open tasks.')),
      h('div', {}, h('h2', {}, 'Recent quiz results'), d.recentAttempts.length ? h('ul', { class: 'list' }, d.recentAttempts.map((a) => h('li', {}, a.quizTitle, ' ', tag(`${a.percentage}%`, a.passed ? 'ok' : 'warn')))) : empty('No quiz attempts yet.'))),
    d.unreadNotifications > 0 && notice(h('span', {}, `You have ${d.unreadNotifications} unread notification${d.unreadNotifications === 1 ? '' : 's'}. `, h('a', { href: '#/notifications' }, 'View'))),
  ];
}

async function courses() {
  let q = '';
  const box = h('div', {});
  const load = async () => {
    const r = await api('GET', `/api/courses?pageSize=50${q ? '&q=' + encodeURIComponent(q) : ''}`);
    box.replaceChildren(r.items.length ? h('div', { class: 'grid' }, r.items.map((c) => h('div', { class: 'panel stack' },
      h('a', { href: `#/course/${c.id}` }, h('strong', {}, c.title)),
      h('div', {}, c.subject && tag(c.subject), c.isPremium && tag('Premium', 'warn'), c.enrolled && tag('Enrolled', 'ok')),
      h('p', { class: 'small muted' }, c.description || 'No description.'), h('div', { class: 'small muted' }, `${c.lessonCount} lesson${c.lessonCount === 1 ? '' : 's'}`),
      !c.enrolled && can('enrollment:self') && h('button', { onclick: act(async () => { await api('POST', `/api/courses/${c.id}/enroll`); toast('Enrolled'); await load(); }) }, 'Enroll'))))
      : empty(q ? 'No courses match your search.' : 'No published courses yet.'));
  };
  await load();
  return [h('h1', {}, 'Courses'), h('form', { class: 'row', onsubmit: act(async (e) => { q = val(e.target, 'q'); await load(); }) }, h('input', { name: 'q', type: 'search', placeholder: 'Search courses', 'aria-label': 'Search courses', style: null }), h('button', { type: 'submit' }, 'Search')), h('div', { class: 'stack' }, box)];
}

function resourceIcon(type) { return type === 'FILE' ? '📄' : '🔗'; }
async function resourcesList(courseId, canManage) {
  const r = await api('GET', `/api/courses/${courseId}/resources`);
  const list = h('ul', { class: 'list' });
  const draw = (items) => list.replaceChildren(...(items.length ? items.map((x) => h('li', { class: 'row between' },
    h('span', {}, resourceIcon(x.type), ' ', x.type === 'FILE' ? h('a', { href: `/api/resources/${x.id}/download` }, x.title) : h('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.title),
      x.description && h('div', { class: 'small muted' }, x.description), x.type === 'FILE' && h('div', { class: 'small muted' }, `${x.fileName} · ${(x.sizeBytes / 1024).toFixed(0)} KB`)),
    canManage && h('button', { class: 'danger', onclick: act(async () => { if (!confirm('Delete this resource?')) return; await api('DELETE', `/api/resources/${x.id}`); draw((await api('GET', `/api/courses/${courseId}/resources`)).items); }) }, 'Delete'))) : [empty('No resources yet.')]));
  draw(r.items);
  return list;
}
function resourceForms(courseId, onChange) {
  const linkForm = h('form', { class: 'row', onsubmit: act(async (e) => { await api('POST', `/api/courses/${courseId}/resources`, { type: 'LINK', title: val(e.target, 'title'), url: val(e.target, 'url') }); e.target.reset(); toast('Link added'); onChange(); }) },
    inp('title', 'text', { placeholder: 'Title', required: true, maxlength: 160, 'aria-label': 'Link title' }), inp('url', 'url', { placeholder: 'https://…', required: true, 'aria-label': 'Link URL' }), h('button', { type: 'submit' }, 'Add link'));
  const fileForm = h('form', { class: 'stack', onsubmit: act(async (e) => {
    const file = e.target.elements.file.files[0]; if (!file) return toast('Choose a file first', true);
    if (file.size > 25 * 1024 * 1024) return toast('File is too large (max 25 MB)', true);
    const buf = await file.arrayBuffer(); const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    await api('POST', `/api/courses/${courseId}/resources`, { type: 'FILE', title: val(e.target, 'title') || file.name, filename: file.name, mime: file.type || 'application/octet-stream', data: b64 });
    e.target.reset(); toast('File uploaded'); onChange();
  }) }, h('div', { class: 'row' }, inp('title', 'text', { placeholder: 'Title (optional)', maxlength: 160, 'aria-label': 'File title' }), h('input', { type: 'file', name: 'file', 'aria-label': 'Choose file', accept: '.pdf,.png,.jpg,.jpeg,.webp,.mp3,.mp4' })),
    h('p', { class: 'small muted' }, 'PDF, PNG, JPEG, WebP, MP3 or MP4. Max 25 MB.'), h('button', { type: 'submit' }, 'Upload file'));
  return h('div', { class: 'stack' }, h('strong', {}, 'Add a resource'), linkForm, fileForm);
}

async function course(id) {
  const c = await api('GET', `/api/courses/${id}`);
  return [
    h('p', { class: 'small' }, h('a', { href: '#/courses' }, '← Courses')), h('h1', {}, c.title),
    h('div', {}, c.subject && tag(c.subject), c.level && tag(c.level), c.isPremium && tag('Premium', 'warn'), c.status !== 'PUBLISHED' && tag(c.status, 'bad'), c.enrolled && tag('Enrolled', 'ok')),
    h('p', {}, c.description || ''),
    h('div', { class: 'row' }, !c.enrolled && can('enrollment:self') && c.status === 'PUBLISHED' && h('button', { class: 'primary', onclick: act(async () => { await api('POST', `/api/courses/${id}/enroll`); toast('Enrolled'); render(); }) }, 'Enroll'),
      c.enrolled && can('enrollment:self') && h('button', { onclick: act(async () => { await api('DELETE', `/api/courses/${id}/enroll`); toast('Left course'); render(); }) }, 'Leave course'),
      c.canManage && h('a', { class: 'btn', href: `#/teach/${id}` }, 'Manage this course')),
    c.enrolled && progressBar(c.progress.percent, 'Course progress'),
    c.announcements.length > 0 && [h('h2', {}, 'Announcements'), h('ul', { class: 'list' }, c.announcements.map((a) => h('li', {}, h('strong', {}, a.title), h('div', { class: 'small muted' }, fmt(a.createdAt)), h('p', {}, a.body))))],
    h('h2', {}, 'Lessons'),
    c.lessons.length ? h('ul', { class: 'list' }, c.lessons.map((l) => h('li', { class: 'row between' }, h('span', {}, h('a', { href: `#/lesson/${l.id}` }, `${l.position}. ${l.title}`), l.summary && h('div', { class: 'small muted' }, l.summary)),
      h('span', {}, l.status !== 'PUBLISHED' && tag(l.status, 'bad'), l.isPreview && tag('Preview'), l.completed && tag('Done', 'ok'))))) : empty('No lessons yet.'),
    h('h2', {}, 'Quizzes'),
    c.quizzes.length ? h('ul', { class: 'list' }, c.quizzes.map((q) => h('li', { class: 'row between' }, h('span', {}, h('strong', {}, q.title), h('div', { class: 'small muted' }, `${q.questionCount} questions · pass at ${q.passingScorePct}%` + (q.timeLimitSeconds ? ` · ${Math.round(q.timeLimitSeconds / 60)} min` : ''))),
      q.status !== 'PUBLISHED' && tag(q.status, 'bad'), can('quiz:attempt') && q.status === 'PUBLISHED' && (c.enrolled ? h('a', { class: 'btn', href: `#/quiz/${q.id}` }, 'Start quiz') : tag('Enroll to take'))))) : empty('No quizzes yet.'),
    (c.enrolled || c.canManage) && [h('h2', {}, 'Resources'), await resourcesList(id, c.canManage)],
  ];
}

async function lesson(id) {
  const l = await api('GET', `/api/lessons/${id}`);
  const body = l.locked === 'ENROLLMENT' ? notice(h('span', {}, 'Enroll in the course to read this lesson. ', h('a', { href: `#/course/${l.courseId}` }, 'Go to course')), 'warn')
    : l.locked === 'PREMIUM' ? notice(h('span', {}, 'This lesson needs premium access. ', h('a', { href: '#/plans' }, 'See plans')), 'warn')
    : h('div', { class: 'lesson-text' }, paragraphs(l.content || 'This lesson has no content yet.'));
  return [h('p', { class: 'small' }, h('a', { href: `#/course/${l.courseId}` }, `← ${l.courseTitle}`)), h('h1', {}, l.title), l.summary && h('p', { class: 'muted' }, l.summary), body,
    !l.locked && h('div', { class: 'row' },
      can('progress:self') && (l.completed ? tag('Completed', 'ok') : h('button', { class: 'primary', onclick: act(async () => { const r = await api('POST', `/api/lessons/${id}/complete`); toast(r.xpAwarded ? `+${r.xpAwarded} XP` : 'Completed'); render(); }) }, 'Mark complete')),
      can('ai:use') && h('a', { class: 'btn', href: `#/tutor/${id}` }, 'Ask Julie about this lesson'))];
}

async function quiz(id) {
  const meta = await api('GET', `/api/quizzes/${id}`);
  if (meta.manage) return [h('h1', {}, meta.quiz.title), notice('You manage this course, so you see the full answer key. Students never receive it.'), h('ol', {}, meta.quiz.questions.map((q) => h('li', {}, q.prompt, h('ul', {}, q.options.map((o) => h('li', {}, o.text, o.isCorrect && ' ✓'))))))];
  const a = await api('POST', `/api/quizzes/${id}/attempts`);
  const form = h('form', { onsubmit: act(async () => {
    const answers = a.quiz.questions.map((q) => q.type === 'SHORT_ANSWER' ? { questionId: q.id, textAnswer: form.elements['t' + q.id].value } : { questionId: q.id, selectedOptionIds: [...form.querySelectorAll(`[name="q${q.id}"]:checked`)].map((x) => x.value) });
    const r = await api('POST', `/api/attempts/${a.attemptId}/submit`, { answers });
    root.replaceChildren(shell(resultView(a, r, id), '#/courses'));
  }) },
    a.quiz.questions.map((q, i) => h('fieldset', { class: 'q', style: null }, h('legend', {}, `${i + 1}. ${q.prompt} `, h('span', { class: 'small muted' }, `(${q.points} pt${q.points > 1 ? 's' : ''}${q.type === 'MULTIPLE_CHOICE' ? ', select all that apply' : ''})`)),
      q.type === 'SHORT_ANSWER' ? inp('t' + q.id, 'text', { maxlength: 2000, 'aria-label': 'Your answer' })
        : q.options.map((o) => h('label', { class: 'check' }, h('input', { type: q.type === 'MULTIPLE_CHOICE' ? 'checkbox' : 'radio', name: 'q' + q.id, value: o.id }), o.text)))),
    h('button', { class: 'primary', type: 'submit' }, 'Submit answers'));
  return [h('h1', {}, a.quiz.title), a.quiz.description && h('p', { class: 'muted' }, a.quiz.description), a.timeLimitSeconds && notice(`Time limit: ${Math.round(a.timeLimitSeconds / 60)} min (enforced by the server, measured from when you started).`), form];
}
function resultView(a, r, quizId) {
  const byQ = new Map(r.questions.map((x) => [x.questionId, x]));
  return [h('h1', {}, r.passed ? 'Passed' : 'Not passed yet'), h('div', { class: 'stat' }, `${r.percentage}%`), h('p', { class: 'muted' }, `${r.score} of ${r.maxScore} points`),
    r.xpAwarded > 0 && notice(`+${r.xpAwarded} XP earned. You are level ${r.level.level} (${r.level.title}).`),
    r.questions[0] && 'isCorrect' in r.questions[0] ? [h('h2', {}, 'Review'), a.quiz.questions.map((q, i) => { const x = byQ.get(q.id); return h('div', { class: 'q' }, h('div', {}, `${i + 1}. ${q.prompt} `, tag(x.isCorrect ? 'Correct' : 'Incorrect', x.isCorrect ? 'ok' : 'bad')), x.explanation && h('p', { class: 'small muted' }, x.explanation)); })] : notice('Your teacher has chosen not to reveal answers for this quiz.'),
    h('div', { class: 'row' }, h('a', { class: 'btn', href: `#/quiz/${quizId}` }, 'Try again'), h('a', { class: 'btn', href: '#/' }, 'Dashboard'))];
}

async function goals() {
  const g = await api('GET', '/api/goals');
  const taskRow = (t) => h('li', { class: 'row between' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: t.status === 'DONE' || null, onchange: act(async (e) => { await api('PATCH', `/api/tasks/${t.id}`, { status: e.target.checked ? 'DONE' : 'TODO' }); render(); }) }), t.title), t.dueAt && h('span', { class: 'small muted' }, `due ${day(t.dueAt)}`));
  const goalForm = h('form', { class: 'panel stack', onsubmit: act(async (e) => { await api('POST', '/api/goals', { title: val(e.target, 'title'), targetDate: val(e.target, 'targetDate') || undefined }); render(); }) }, h('strong', {}, 'New goal'), field('Title', inp('title', 'text', { required: true, maxlength: 200 })), field('Target date (optional)', inp('targetDate', 'date')), h('button', { type: 'submit' }, 'Add goal'));
  const taskForm = h('form', { class: 'panel stack', onsubmit: act(async (e) => { await api('POST', '/api/tasks', { title: val(e.target, 'title'), goalId: val(e.target, 'goalId') || undefined, dueAt: e.target.elements.dueAt.value ? new Date(e.target.elements.dueAt.value).toISOString() : undefined }); render(); }) },
    h('strong', {}, 'New task'), field('Title', inp('title', 'text', { required: true, maxlength: 200 })),
    field('Goal (optional)', h('select', { name: 'goalId' }, h('option', { value: '' }, 'No goal'), g.goals.filter((x) => x.status === 'ACTIVE').map((x) => h('option', { value: x.id }, x.title)))),
    field('Due (optional)', inp('dueAt', 'datetime-local')), h('button', { type: 'submit' }, 'Add task'));
  return [h('h1', {}, 'Goals & tasks'), h('div', { class: 'grid' }, goalForm, taskForm),
    h('h2', {}, 'Goals'), g.goals.length ? g.goals.map((x) => h('div', { class: 'panel stack', 'data-goal': x.id }, h('div', { class: 'row between' }, h('strong', {}, x.title), h('span', {}, tag(x.status, x.status === 'COMPLETED' ? 'ok' : ''), x.targetDate && tag(`by ${x.targetDate}`))),
      x.tasks.length ? h('ul', { class: 'list' }, x.tasks.map(taskRow)) : h('div', { class: 'small muted' }, 'No tasks yet.'),
      x.status === 'ACTIVE' && h('div', {}, h('button', { onclick: act(async () => { const r = await api('PATCH', `/api/goals/${x.id}`, { status: 'COMPLETED' }); toast(r.xpAwarded ? `Goal complete! +${r.xpAwarded} XP` : 'Goal complete'); render(); }) }, 'Mark goal complete')))) : empty('No goals yet. Add your first one above.'),
    g.looseTasks.length > 0 && [h('h2', {}, 'Other tasks'), h('ul', { class: 'list panel' }, g.looseTasks.map(taskRow))]];
}

async function notifications() {
  const r = await api('GET', '/api/notifications?pageSize=50');
  return [h('div', { class: 'row between' }, h('h1', {}, 'Notifications'), r.items.some((n) => !n.read) && h('button', { onclick: act(async () => { await api('POST', '/api/notifications/read-all'); render(); }) }, 'Mark all read')),
    r.items.length ? h('ul', { class: 'list panel' }, r.items.map((n) => h('li', { class: 'row between' }, h('span', {}, n.read ? h('span', {}, n.title) : h('strong', {}, n.title), n.body && h('div', { class: 'small muted' }, n.body), h('div', { class: 'small muted' }, fmt(n.createdAt))),
      !n.read && h('button', { onclick: act(async () => { await api('POST', `/api/notifications/${n.id}/read`); render(); }) }, 'Mark read')))) : empty('Nothing here yet. Notifications appear when you finish quizzes, get announcements, or your access changes.')];
}

async function tutor(lessonId) {
  const hist = await api('GET', '/api/ai/history');
  let convo = hist.conversationId; const log = h('div', { class: 'chat', 'aria-live': 'polite' });
  const usage = h('div', { class: 'small muted' });
  const showUsage = (u) => (usage.textContent = u.dailyLimit === null ? `${u.usedToday} messages today (unlimited plan)` : `${u.usedToday} of ${u.dailyLimit} messages used today`);
  const add = (role, content) => log.append(h('div', { class: 'msg ' + role.toLowerCase() }, content)); showUsage(hist.usage);
  hist.messages.forEach((m) => add(m.role, m.content));
  const form = h('form', { class: 'row', onsubmit: act(async (e) => {
    const message = val(e.target, 'message'); if (!message) return; add('USER', message); e.target.reset();
    try { const r = await api('POST', '/api/ai/chat', { message, conversationId: convo, lessonId }); convo = r.conversationId; add('ASSISTANT', r.reply); showUsage(r.usage); }
    catch (err) { log.append(h('div', { class: 'notice bad' }, err.message)); }
    log.scrollTop = log.scrollHeight;
  }) }, h('input', { name: 'message', placeholder: 'Ask about a concept…', maxlength: 2000, required: true, 'aria-label': 'Message' }), h('button', { class: 'primary', type: 'submit' }, 'Send'));
  return [h('h1', {}, 'Julie AI tutor'), lessonId && notice('Julie can see the lesson you opened from, so you can ask about it directly.'),
    !hist.configured && notice('Julie AI is not configured on this server yet, so messages cannot be answered. An administrator needs to set AI_PROVIDER, AI_API_KEY and AI_MODEL.', 'warn'),
    h('p', { class: 'small muted' }, 'Julie explains and guides. She will not just hand over answers to quizzes.'), usage, log.children.length ? log : empty('Ask your first question below.'), h('div', { class: 'stack' }, form)];
}

async function plans() {
  const [p, mine] = await Promise.all([api('GET', '/api/subscriptions/plans'), api('GET', '/api/subscriptions/mine')]);
  const a = mine.access;
  return [h('h1', {}, 'Plans & access'),
    h('div', { class: 'panel stack' }, h('div', { class: 'label' }, 'Current access'), h('div', { class: 'stat' }, a.planCode || (a.source === 'GRANT' ? 'Admin grant' : 'Free')),
      h('div', {}, tag(a.source.toLowerCase()), a.hasPremiumAccess ? tag('Premium', 'ok') : tag('Free tier')),
      h('div', { class: 'small muted' }, a.neverExpires ? 'No expiry.' : `Expires ${fmt(a.expiresAt)}`),
      h('div', { class: 'small muted' }, `Julie AI today: ${mine.aiUsedToday} of ${a.aiDailyMessageLimit === null ? 'unlimited' : a.aiDailyMessageLimit}`)),
    mine.trialAvailable && h('div', { class: 'notice' }, h('div', {}, 'Try premium free for 7 days.'), h('button', { class: 'primary', onclick: act(async () => { await api('POST', '/api/subscriptions/trial'); toast('Trial started'); render(); }) }, 'Start free trial')),
    !p.paymentsConfigured && notice('Online payment is not connected on this server, so paid plans cannot be completed here yet. An administrator can grant access, and the free trial works.', 'warn'),
    h('h2', {}, 'Available plans'),
    h('div', { class: 'grid' }, p.items.filter((x) => x.code !== 'TRIAL').map((x) => h('div', { class: 'panel stack' }, h('strong', {}, x.name), h('div', { class: 'stat' }, x.priceCents ? `${(x.priceCents / 100).toFixed(2)} ${x.currency}` : 'Free'), h('div', { class: 'small muted' }, x.interval === 'NONE' ? 'No billing' : `per ${x.interval.toLowerCase()}`, ` · ${x.aiDailyLimit ?? 'unlimited'} AI messages/day`),
      x.priceCents > 0 && h('button', { onclick: act(async () => { const r = await api('POST', '/api/payments/checkout', { planCode: x.code }); toast(r.message, true); }) }, 'Purchase')))) ];
}

async function profile() {
  const m = state.me; const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const form = h('form', { class: 'panel stack', onsubmit: act(async (e) => { state.me = await api('PATCH', '/api/profile', { displayName: val(e.target, 'displayName'), timezone: val(e.target, 'timezone') }); toast('Saved'); render(); }) },
    field('Display name', inp('displayName', 'text', { value: m.displayName, required: true, maxlength: 80 })), field('Time zone (used for streak days)', inp('timezone', 'text', { value: m.timezone, placeholder: tz })),
    h('p', { class: 'small muted' }, `Your browser reports ${tz}.`), h('button', { class: 'primary', type: 'submit' }, 'Save'));
  const prefsBox = h('div', {});
  if (can('notification:self')) {
    const p = await api('GET', '/api/notification-preferences');
    prefsBox.append(h('h2', {}, 'Notification preferences'), h('div', { class: 'panel stack' }, p.items.map((x) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: x.enabled || null, onchange: act(async (e) => { await api('PATCH', `/api/notification-preferences/${x.category}`, { enabled: e.target.checked }); }) }), x.category.charAt(0) + x.category.slice(1).toLowerCase()))));
  }
  return [h('h1', {}, 'Profile'), h('p', { class: 'muted' }, m.email), h('div', {}, m.roles.map((r) => tag(r))), form, prefsBox];
}

// ── Teacher ──
async function teach() {
  const r = await api('GET', '/api/teacher/courses');
  const f = h('form', { class: 'panel stack', onsubmit: act(async (e) => { const c = await api('POST', '/api/courses', { title: val(e.target, 'title'), subject: val(e.target, 'subject') || undefined, description: val(e.target, 'description') || undefined, isPremium: e.target.elements.isPremium.checked }); go(`#/teach/${c.id}`); }) },
    h('strong', {}, 'New course'), field('Title', inp('title', 'text', { required: true, minlength: 3, maxlength: 160 })), field('Subject', inp('subject', 'text', { maxlength: 100 })), field('Description', h('textarea', { name: 'description', maxlength: 5000 })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'isPremium' }), 'Premium (non-preview lessons need paid access)'), h('button', { class: 'primary', type: 'submit' }, 'Create draft'));
  return [h('h1', {}, 'Teaching'), r.items.length ? h('div', { class: 'grid' }, r.items.map((c) => h('div', { class: 'panel stack' }, h('a', { href: `#/teach/${c.id}` }, h('strong', {}, c.title)), h('div', {}, tag(c.status, c.status === 'PUBLISHED' ? 'ok' : 'warn'), c.isPremium && tag('Premium')), h('div', { class: 'small muted' }, `${c.lessons} lessons · ${c.enrollments} students`)))) : empty('No courses yet. Create your first one below.'), h('h2', {}, 'Create'), f];
}

function quizBuilder(courseId) {
  const qs = []; const list = h('div', { class: 'stack' });
  const addQ = () => {
    const box = h('div', { class: 'panel stack' }); const opts = h('div', {});
    const state = { type: h('select', { name: 'type' }, ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER'].map((t) => h('option', { value: t }, t.replace('_', ' ').toLowerCase()))), prompt: h('input', { placeholder: 'Question', maxlength: 2000, 'aria-label': 'Question' }), points: h('input', { type: 'number', min: 1, max: 100, value: 1, 'aria-label': 'Points' }), explanation: h('input', { placeholder: 'Explanation shown after submission (optional)', maxlength: 2000, 'aria-label': 'Explanation' }), rows: [] };
    const addOpt = (text = '') => { const r = { text: h('input', { value: text, maxlength: 500, placeholder: 'Option / accepted answer', 'aria-label': 'Option text' }), ok: h('input', { type: 'checkbox', 'aria-label': 'Correct' }) }; state.rows.push(r); opts.append(h('div', { class: 'row' }, r.text, h('label', { class: 'check' }, r.ok, 'correct'))); };
    state.type.addEventListener('change', () => { if (state.type.value === 'TRUE_FALSE') { state.rows.length = 0; opts.replaceChildren(); addOpt('True'); addOpt('False'); } });
    addOpt(); addOpt(); box.append(state.type, state.prompt, h('div', { class: 'row' }, h('label', { class: 'small' }, 'Points'), state.points), state.explanation, opts, h('button', { type: 'button', onclick: () => addOpt() }, 'Add option'));
    qs.push(state); list.append(box);
  };
  addQ();
  const form = h('form', { class: 'stack', onsubmit: act(async (e) => {
    const questions = qs.map((q) => ({ type: q.type.value, prompt: q.prompt.value.trim(), points: Number(q.points.value) || 1, explanation: q.explanation.value.trim() || undefined, options: q.rows.filter((r) => r.text.value.trim()).map((r) => ({ text: r.text.value.trim(), isCorrect: r.ok.checked })) }));
    await api('POST', `/api/courses/${courseId}/quizzes`, { title: val(e.target, 'title'), passingScorePct: Number(e.target.elements.passing.value), timeLimitSeconds: e.target.elements.minutes.value ? Number(e.target.elements.minutes.value) * 60 : undefined, status: e.target.elements.publish.checked ? 'PUBLISHED' : 'DRAFT', revealAnswers: e.target.elements.reveal.checked, questions });
    toast('Quiz created'); render();
  }) }, field('Quiz title', inp('title', 'text', { required: true, maxlength: 200 })),
    h('div', { class: 'row' }, field('Pass mark %', inp('passing', 'number', { value: 60, min: 0, max: 100 })), field('Time limit (minutes, optional)', inp('minutes', 'number', { min: 1, max: 240 }))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'reveal', checked: true }), 'Reveal correct answers after submission'), h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'publish' }), 'Publish now'),
    list, h('div', { class: 'row' }, h('button', { type: 'button', onclick: addQ }, 'Add question'), h('button', { class: 'primary', type: 'submit' }, 'Create quiz')),
    h('p', { class: 'small muted' }, 'Short-answer questions: every option listed is an accepted answer (case-insensitive exact match). Questions cannot be edited after creation so past grades stay valid.'));
  return form;
}

async function teachCourse(id) {
  const c = await api('GET', `/api/courses/${id}`);
  if (!c.canManage) return [notice('You do not have permission to manage this course.', 'bad')];
  const edit = h('form', { class: 'panel stack', onsubmit: act(async (e) => { await api('PATCH', `/api/courses/${id}`, { title: val(e.target, 'title'), description: val(e.target, 'description'), subject: val(e.target, 'subject'), status: e.target.elements.status.value, isPremium: e.target.elements.isPremium.checked }); toast('Saved'); render(); }) },
    field('Title', inp('title', 'text', { value: c.title, required: true, maxlength: 160 })), field('Subject', inp('subject', 'text', { value: c.subject || '' })), field('Description', h('textarea', { name: 'description' }, c.description || '')),
    field('Status', h('select', { name: 'status' }, ['DRAFT', 'PUBLISHED', 'ARCHIVED'].map((s) => h('option', { value: s, selected: s === c.status || null }, s)))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'isPremium', checked: c.isPremium || null }), 'Premium course'), h('button', { class: 'primary', type: 'submit' }, 'Save course'));
  const lessonForm = h('form', { class: 'panel stack', onsubmit: act(async (e) => { await api('POST', `/api/courses/${id}/lessons`, { title: val(e.target, 'title'), summary: val(e.target, 'summary') || undefined, content: e.target.elements.content.value || undefined, isPreview: e.target.elements.isPreview.checked, status: e.target.elements.publish.checked ? 'PUBLISHED' : 'DRAFT' }); toast('Lesson added'); render(); }) },
    h('strong', {}, 'Add lesson'), field('Title', inp('title', 'text', { required: true, maxlength: 200 })), field('Summary', inp('summary', 'text', { maxlength: 500 })), field('Content (blank line = new paragraph)', h('textarea', { name: 'content' })),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'isPreview' }), 'Free preview (readable without premium or enrolment)'), h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'publish' }), 'Publish now'), h('button', { type: 'submit' }, 'Add lesson'));
  const annForm = h('form', { class: 'panel stack', onsubmit: act(async (e) => { await api('POST', `/api/courses/${id}/announcements`, { title: val(e.target, 'title'), body: val(e.target, 'body') }); toast('Announcement sent to enrolled students'); render(); }) },
    h('strong', {}, 'Announce to students'), field('Title', inp('title', 'text', { required: true, maxlength: 160 })), field('Message', h('textarea', { name: 'body', required: true, maxlength: 4000 })), h('button', { type: 'submit' }, 'Send'));
  const res = await api('GET', `/api/courses/${id}/results`);
  return [h('p', { class: 'small' }, h('a', { href: '#/teach' }, '← Teaching')), h('h1', {}, c.title), h('div', {}, tag(c.status, c.status === 'PUBLISHED' ? 'ok' : 'warn'), h('a', { class: 'small', href: `#/course/${id}` }, ' Student view')), edit,
    h('h2', {}, 'Lessons'), c.lessons.length ? h('ul', { class: 'list panel' }, c.lessons.map((l) => h('li', { class: 'row between' }, h('span', {}, `${l.position}. ${l.title} `, tag(l.status, l.status === 'PUBLISHED' ? 'ok' : 'warn'), l.isPreview && tag('Preview')),
      h('button', { onclick: act(async () => { await api('PATCH', `/api/lessons/${l.id}`, { status: l.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED' }); render(); }) }, l.status === 'PUBLISHED' ? 'Unpublish' : 'Publish')))) : empty('No lessons yet.'), lessonForm,
    h('h2', {}, 'Quizzes'), c.quizzes.length ? h('ul', { class: 'list panel' }, c.quizzes.map((q) => h('li', { class: 'row between' }, h('span', {}, q.title, ' ', tag(q.status, q.status === 'PUBLISHED' ? 'ok' : 'warn'), h('span', { class: 'small muted' }, ` ${q.questionCount} questions`)),
      h('span', { class: 'row' }, h('a', { class: 'btn', href: `#/quiz/${q.id}` }, 'View key'), h('a', { class: 'btn', href: `#/quiz-review/${q.id}` }, 'Review short answers'), h('button', { onclick: act(async () => { await api('PATCH', `/api/quizzes/${q.id}`, { status: q.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED' }); render(); }) }, q.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'))))) : empty('No quizzes yet.'),
    h('h3', {}, 'Create a quiz'), quizBuilder(id), h('h2', {}, 'Announcements'), annForm,
    h('h2', {}, 'Resources'), await resourcesList(id, true), resourceForms(id, () => render()),
    h('h2', {}, 'Student progress'), res.items.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Student', 'Progress', 'Quiz best scores'].map((x) => h('th', {}, x)))), h('tbody', {}, res.items.map((s) => h('tr', {}, h('td', {}, s.name, h('div', { class: 'small muted' }, s.email)), h('td', {}, `${s.progress.completedLessons}/${s.progress.totalLessons} (${s.progress.percent}%)`), h('td', {}, s.quizzes.map((q) => h('div', {}, `${q.title}: ${q.best == null ? 'not attempted' : q.best + '%'}`)))))))) : empty('No students enrolled yet.')];
}

async function quizReview(quizId) {
  const r = await api('GET', `/api/quizzes/${quizId}/short-answers`);
  const rows = h('div', { class: 'stack' });
  const draw = (items) => rows.replaceChildren(...(items.length ? items.map((x) => h('div', { class: 'panel row between' },
    h('span', {}, h('strong', {}, x.student), ` — ${x.prompt}`, h('div', {}, `Answer: “${x.answer ?? ''}”`), h('div', { class: 'small' }, x.autoCorrect ? tag('Auto-graded correct', 'ok') : tag('Auto-graded incorrect', 'warn'))),
    h('span', { class: 'row' }, h('button', { onclick: act(async () => { await api('POST', `/api/attempts/${x.attemptId}/answers/${x.questionId}/override`, { isCorrect: true }); toast('Marked correct'); const n = await api('GET', `/api/quizzes/${quizId}/short-answers`); draw(n.items); }) }, 'Mark correct'),
      h('button', { onclick: act(async () => { await api('POST', `/api/attempts/${x.attemptId}/answers/${x.questionId}/override`, { isCorrect: false }); toast('Marked incorrect'); const n = await api('GET', `/api/quizzes/${quizId}/short-answers`); draw(n.items); }) }, 'Mark incorrect')))) : [empty('No short-answer submissions yet.')]));
  draw(r.items);
  return [h('h1', {}, 'Review short answers'), h('p', { class: 'small muted' }, 'Overriding a grade recalculates the score and pass/fail for that attempt.'), rows];
}

// ── Timetable ──
async function timetable() {
  const r = await api('GET', '/api/timetable'); const myCourses = (await api('GET', '/api/dashboard')).courses;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const mins = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const byDay = (d) => r.items.filter((x) => x.dayOfWeek === d).sort((a, b) => a.startMinute - b.startMinute);
  const form = h('form', { class: 'panel stack', onsubmit: act(async (e) => {
    const [sh, sm] = e.target.elements.start.value.split(':').map(Number); const [eh, em] = e.target.elements.end.value.split(':').map(Number);
    await api('POST', '/api/timetable', { title: val(e.target, 'title'), dayOfWeek: Number(e.target.elements.day.value), startMinute: sh * 60 + sm, endMinute: eh * 60 + em, courseId: e.target.elements.course.value || undefined, location: val(e.target, 'location') || undefined });
    render();
  }) }, h('strong', {}, 'Add entry'), h('div', { class: 'row' }, field('Day', h('select', { name: 'day' }, DAYS.map((d, i) => h('option', { value: i }, d)))), field('Start', inp('start', 'time', { required: true })), field('End', inp('end', 'time', { required: true }))),
    field('Title', inp('title', 'text', { required: true, maxlength: 120 })), field('Course (optional)', h('select', { name: 'course' }, h('option', { value: '' }, 'None'), myCourses.map((c) => h('option', { value: c.id }, c.title)))), field('Location (optional)', inp('location', 'text', { maxlength: 120 })), h('button', { class: 'primary', type: 'submit' }, 'Add'));
  return [h('h1', {}, 'Timetable'), form, h('div', { class: 'grid' }, DAYS.map((d, i) => h('div', { class: 'panel' }, h('strong', {}, d),
    byDay(i).length ? h('ul', { class: 'list' }, byDay(i).map((x) => h('li', { class: 'row between' }, h('span', {}, `${mins(x.startMinute)}–${mins(x.endMinute)} ${x.title}`, x.courseTitle && h('div', { class: 'small muted' }, x.courseTitle), x.location && h('div', { class: 'small muted' }, x.location)),
      h('button', { class: 'danger', onclick: act(async () => { await api('DELETE', `/api/timetable/${x.id}`); render(); }) }, '×')))) : h('div', { class: 'small muted' }, 'Nothing scheduled.'))))];
}

// ── News ──
async function news() {
  const r = await fetch('/api/news').then((x) => x.json());
  return [h('h1', {}, 'News'), r.items.length ? r.items.map((n) => h('div', { class: 'panel stack' }, h('h2', {}, n.title), h('div', { class: 'small muted' }, fmt(n.publishedAt)), paragraphs(n.body))) : empty('No news yet.')];
}

// ── Admin ──
async function admin() {
  const tabs = [['users', 'Users', can('user:read_any')], ['plans', 'Plans', can('subscription_plan:manage')], ['news', 'News', can('news:manage')], ['flags', 'Feature flags', can('feature_flag:manage')], ['audit', 'Audit log', can('audit:read')], ['security', 'Security events', can('security:read')], ['analytics', 'Analytics', can('analytics:read')]].filter((t) => t[2]);
  const body = h('div', {}); let current = tabs[0][0];
  const bar = h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, label]) => h('button', { role: 'tab', 'aria-selected': k === current ? 'true' : 'false', 'data-tab': k, onclick: async () => { current = k; bar.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === k ? 'true' : 'false')); await show(); } }, label)));
  const table = (heads, rows) => rows.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, heads.map((x) => h('th', {}, x)))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))))) : empty('Nothing recorded yet.');
  async function show() {
    body.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
    try {
      if (current === 'users') body.replaceChildren(await usersTab());
      else if (current === 'plans') body.replaceChildren(await plansTab());
      else if (current === 'news') body.replaceChildren(await newsTab());
      else if (current === 'flags') body.replaceChildren(await flagsTab());
      else if (current === 'audit') { const r = await api('GET', '/api/admin/audit-logs?pageSize=100'); body.replaceChildren(table(['When', 'Actor', 'Action', 'Target', 'Details'], r.items.map((l) => [fmt(l.createdAt), l.actor, l.action, `${l.entityType} ${l.entityId || ''}`, JSON.stringify(l.metadata)]))); }
      else if (current === 'security') { const r = await api('GET', '/api/admin/security-events?pageSize=100'); body.replaceChildren(table(['When', 'Type', 'Severity', 'IP', 'Details'], r.items.map((l) => [fmt(l.createdAt), l.type, tag(l.severity, l.severity === 'HIGH' ? 'bad' : ''), l.ip || '—', JSON.stringify(l.metadata)]))); }
      else { const a = await api('GET', '/api/admin/analytics'); body.replaceChildren(h('div', { class: 'grid' },
        [['Users', a.users.total], ['Published courses', a.courses.published], ['Enrolments', a.courses.enrollments], ['Lessons completed', a.learning.lessonCompletions], ['Quiz attempts', a.learning.quizAttempts], ['Avg quiz score', a.learning.averageQuizPercent == null ? '—' : Math.round(a.learning.averageQuizPercent) + '%'], ['Active subscriptions', a.subscriptions.active], ['Successful payments', a.subscriptions.payments]].map(([l, v]) => h('div', { class: 'panel' }, h('div', { class: 'label' }, l), h('div', { class: 'stat' }, String(v)))),
        h('div', { class: 'panel' }, h('div', { class: 'label' }, 'Users by role'), Object.entries(a.users.byRole).map(([r, n]) => h('div', {}, `${r}: ${n}`))), h('div', { class: 'panel' }, h('div', { class: 'label' }, 'Events, last 7 days'), a.eventsLast7Days.length ? a.eventsLast7Days.map((e) => h('div', {}, `${e.name}: ${e.count}`)) : h('div', { class: 'small muted' }, 'None yet')))); }
    } catch (e) { body.replaceChildren(notice(e.message, 'bad')); }
  }
  async function plansTab() {
    const p = await api('GET', '/api/admin/plans');
    const wrap = h('div', { class: 'grid' });
    wrap.append(...p.items.map((x) => h('form', { class: 'panel stack', onsubmit: act(async (e) => { await api('PATCH', `/api/admin/plans/${x.code}`, { priceCents: Math.round(Number(e.target.elements.price.value) * 100), aiDailyLimit: e.target.elements.limit.value === '' ? null : Number(e.target.elements.limit.value), isActive: e.target.elements.active.checked }); toast('Plan saved'); }) },
      h('strong', {}, `${x.name} (${x.code})`), field('Price (USD)', inp('price', 'number', { min: 0, step: '0.01', value: (x.priceCents / 100).toFixed(2) })), field('AI messages/day (blank = unlimited)', inp('limit', 'number', { min: 0, value: x.aiDailyLimit ?? '' })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', checked: x.isActive || null }), 'Active'), h('button', { type: 'submit' }, 'Save'))));
    return wrap;
  }
  async function newsTab() {
    const list = h('div', { class: 'stack' });
    const load = async () => { const r = await api('GET', '/api/admin/news'); list.replaceChildren(...(r.items.length ? r.items.map((n) => h('div', { class: 'panel row between' }, h('span', {}, h('strong', {}, n.title), ' ', tag(n.status, n.status === 'PUBLISHED' ? 'ok' : 'warn')),
      h('button', { onclick: act(async () => { await api('PATCH', `/api/admin/news/${n.id}`, { status: n.status === 'PUBLISHED' ? 'ARCHIVED' : 'PUBLISHED' }); await load(); }) }, n.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'))) : [empty('No articles yet.')])); };
    await load();
    const form = h('form', { class: 'panel stack', onsubmit: act(async (e) => { await api('POST', '/api/admin/news', { title: val(e.target, 'title'), body: val(e.target, 'body'), status: e.target.elements.publish.checked ? 'PUBLISHED' : 'DRAFT' }); e.target.reset(); toast('Article saved'); await load(); }) },
      h('strong', {}, 'New article'), field('Title', inp('title', 'text', { required: true, maxlength: 160 })), field('Body', h('textarea', { name: 'body', required: true })), h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'publish' }), 'Publish now'), h('button', { type: 'submit' }, 'Save'));
    return h('div', { class: 'stack' }, list, form);
  }
  async function flagsTab() {
    const list = h('div', { class: 'stack' });
    const load = async () => { const r = await api('GET', '/api/admin/feature-flags'); list.replaceChildren(...(r.items.length ? r.items.map((f) => h('div', { class: 'panel row between' }, h('span', {}, h('strong', {}, f.key), f.description && h('div', { class: 'small muted' }, f.description), h('div', { class: 'small muted' }, `${f.rollout_percent}% rollout`)),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!f.enabled || null, onchange: act(async (e) => { await api('PATCH', `/api/admin/feature-flags/${f.key}`, { enabled: e.target.checked }); }) }), 'Enabled'))) : [empty('No flags yet.')])); };
    await load();
    const form = h('form', { class: 'row', onsubmit: act(async (e) => { await api('POST', '/api/admin/feature-flags', { key: val(e.target, 'key'), description: val(e.target, 'description') || undefined }); e.target.reset(); await load(); }) },
      inp('key', 'text', { placeholder: 'flag_key', required: true, pattern: '[a-z0-9_.\\-]+', 'aria-label': 'Flag key' }), inp('description', 'text', { placeholder: 'Description (optional)', 'aria-label': 'Description' }), h('button', { type: 'submit' }, 'Create flag'));
    return h('div', { class: 'stack' }, list, form);
  }
  async function usersTab() {
    const wrap = h('div', { class: 'stack' }); const detail = h('div', {}); let q = '';
    const list = h('div', {});
    const loadList = async () => { const r = await api('GET', `/api/admin/users?pageSize=50${q ? '&q=' + encodeURIComponent(q) : ''}`);
      list.replaceChildren(table(['Name', 'Email', 'Roles', 'Status', ''], r.items.map((u) => [u.displayName, u.email, u.roles.map((x) => tag(x)), tag(u.status, u.status === 'ACTIVE' ? 'ok' : 'bad'), h('button', { onclick: act(async () => { await openUser(u.id); }) }, 'Manage')]))); };
    async function openUser(uid) {
      const u = await api('GET', `/api/admin/users/${uid}`); const ROLES = ['STUDENT', 'TEACHER', 'ADMIN', 'DEVELOPER'];
      const reload = async () => { await loadList(); await openUser(uid); };
      detail.replaceChildren(h('div', { class: 'panel stack' }, h('h3', {}, `${u.displayName} — ${u.email}`),
        h('div', {}, 'Roles: ', u.roles.map((r) => h('span', { class: 'tag' }, r, ' ', h('button', { class: 'danger', 'aria-label': `Remove ${r}`, onclick: act(async () => { if (!confirm(`Remove ${r} from ${u.email}?`)) return; await api('DELETE', `/api/admin/users/${uid}/roles/${r}`); await reload(); }) }, '×')))),
        h('form', { class: 'row', onsubmit: act(async (e) => { await api('POST', `/api/admin/users/${uid}/roles`, { role: e.target.elements.role.value, reason: val(e.target, 'reason') || undefined }); toast('Role granted'); await reload(); }) }, h('select', { name: 'role', 'aria-label': 'Role' }, ROLES.filter((r) => !u.roles.includes(r)).map((r) => h('option', { value: r }, r))), h('input', { name: 'reason', placeholder: 'Reason (optional)', 'aria-label': 'Reason' }), h('button', { type: 'submit' }, 'Grant role')),
        h('div', {}, 'Account: ', tag(u.status, u.status === 'ACTIVE' ? 'ok' : 'bad'), ' ', h('button', { onclick: act(async () => { const next = u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'; if (!confirm(`Set ${u.email} to ${next}?`)) return; await api('PATCH', `/api/admin/users/${uid}/status`, { status: next }); await reload(); }) }, u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate')),
        h('div', { class: 'small muted' }, `Effective access: ${u.access.source} · ${u.access.hasPremiumAccess ? 'premium' : 'free'} · ${u.access.neverExpires ? 'no expiry' : 'until ' + fmt(u.access.expiresAt)}`),
        h('h3', {}, 'Access grants'), u.grants.length ? h('ul', { class: 'list' }, u.grants.map((g) => h('li', { class: 'row between' }, h('span', {}, tag(g.type), g.revokedAt ? tag('revoked', 'bad') : tag('active', 'ok'), ` ${g.reason}`, h('div', { class: 'small muted' }, `${g.expiresAt ? 'until ' + fmt(g.expiresAt) : 'no expiry'}${g.revokeReason ? ' · revoked: ' + g.revokeReason : ''}`)),
          !g.revokedAt && h('button', { class: 'danger', onclick: act(async () => { const reason = prompt('Reason for revoking?'); if (!reason || reason.length < 3) return; await api('POST', `/api/admin/grants/${g.id}/revoke`, { reason }); await reload(); }) }, 'Revoke')))) : h('div', { class: 'small muted' }, 'No grants.'),
        can('access_grant:manage') && h('form', { class: 'stack', onsubmit: act(async (e) => { const t = e.target.elements.type.value; await api('POST', `/api/admin/users/${uid}/grants`, { type: t, reason: val(e.target, 'reason'), expiresAt: t === 'TIMED' ? new Date(e.target.elements.expiresAt.value).toISOString() : undefined }); toast('Access granted'); await reload(); }) },
          h('strong', {}, 'Grant access'), h('div', { class: 'row' }, h('select', { name: 'type', 'aria-label': 'Grant type' }, h('option', { value: 'TIMED' }, 'Timed'), h('option', { value: 'UNLIMITED' }, 'Unlimited')), inp('expiresAt', 'datetime-local', { 'aria-label': 'Expires' })), inp('reason', 'text', { placeholder: 'Reason (required)', required: true, minlength: 3, maxlength: 300, 'aria-label': 'Reason' }), h('button', { type: 'submit' }, 'Grant'))));
    }
    wrap.append(h('form', { class: 'row', onsubmit: act(async (e) => { q = val(e.target, 'q'); await loadList(); }) }, h('input', { name: 'q', type: 'search', placeholder: 'Search users', 'aria-label': 'Search users' }), h('button', { type: 'submit' }, 'Search')), list, detail);
    await loadList(); return wrap;
  }
  await show();
  return [h('h1', {}, 'Administration'), bar, body];
}

// ── Developer ──
async function developer() {
  const r = await api('GET', '/api/developer/keys'); let fresh = null;
  const out = h('div', {});
  const showKey = (k) => out.replaceChildren(h('div', { class: 'notice warn' }, h('strong', {}, 'Copy your key now — it will not be shown again.'), h('div', { class: 'keybox' }, k.key)));
  const form = h('form', { class: 'panel stack', onsubmit: act(async (e) => { const k = await api('POST', '/api/developer/keys', { name: val(e.target, 'name'), scopes: ['courses:read'], expiresInDays: e.target.elements.days.value ? Number(e.target.elements.days.value) : undefined }); showKey(k); const t = await api('GET', '/api/developer/keys'); table.replaceChildren(...rows(t.items)); }) },
    h('strong', {}, 'Create API key'), field('Name', inp('name', 'text', { required: true, maxlength: 80 })), field('Expires in (days, optional)', inp('days', 'number', { min: 1, max: 365 })), h('p', { class: 'small muted' }, 'Scope: courses:read (read-only list of published courses).'), h('button', { class: 'primary', type: 'submit' }, 'Create key'));
  const rows = (items) => items.length ? items.map((k) => h('li', { class: 'row between' }, h('span', {}, h('strong', {}, k.name), ' ', tag(k.status, k.status === 'ACTIVE' ? 'ok' : 'bad'), h('div', { class: 'small muted' }, `${k.masked} · ${k.scopes.join(', ')} · ${k.requests7d} requests (7d) · last used ${fmt(k.lastUsedAt)}`)),
    k.status === 'ACTIVE' && h('span', { class: 'row' }, h('button', { onclick: act(async () => { const n = await api('POST', `/api/developer/keys/${k.id}/rotate`); showKey(n); render2(); }) }, 'Rotate'), h('button', { class: 'danger', onclick: act(async () => { if (!confirm('Revoke this key? Apps using it will stop working.')) return; await api('DELETE', `/api/developer/keys/${k.id}`); render(); }) }, 'Revoke')))) : [empty('No API keys yet.')];
  const render2 = async () => { const t = await api('GET', '/api/developer/keys'); table.replaceChildren(...rows(t.items)); };
  const table = h('ul', { class: 'list panel' }, rows(r.items));
  return [h('h1', {}, 'Developer'), out, table, form, h('h2', {}, 'Using the API'), h('div', { class: 'panel' }, h('p', {}, 'Send the key as a Bearer token:'), h('pre', { class: 'keybox' }, `curl -H "Authorization: Bearer <your key>" ${location.origin}/api/v1/courses?pageSize=20`), h('p', { class: 'small muted' }, 'Keys are stored as hashes, limited to 60 requests/minute, and every request is counted. Developers have no admin privileges.'))];
}

// ── Router ──
const routes = [
  [/^#\/login$/, () => authView('login'), true], [/^#\/register$/, () => authView('register'), true],
  [/^#\/?$/, () => (can('progress:self') ? dashboard() : can('course:manage_own') ? teach() : can('user:read_any') ? admin() : can('api_key:manage_own') ? developer() : profile()), false, '#/'],
  [/^#\/courses$/, courses, false, '#/courses'], [/^#\/course\/([\w-]+)$/, (m) => course(m[1]), false, '#/courses'], [/^#\/lesson\/([\w-]+)$/, (m) => lesson(m[1]), false, '#/courses'],
  [/^#\/quiz\/([\w-]+)$/, (m) => quiz(m[1]), false, '#/courses'], [/^#\/quiz-review\/([\w-]+)$/, (m) => quizReview(m[1]), false, '#/teach'], [/^#\/goals$/, goals, false, '#/goals'], [/^#\/notifications$/, notifications, false, '#/notifications'],
  [/^#\/tutor(?:\/([\w-]+))?$/, (m) => tutor(m[1]), false, '#/tutor'], [/^#\/plans$/, plans, false, '#/plans'], [/^#\/profile$/, profile, false, '#/profile'],
  [/^#\/timetable$/, timetable, false, '#/timetable'], [/^#\/news$/, news, false, '#/news'],
  [/^#\/teach$/, teach, false, '#/teach'], [/^#\/teach\/([\w-]+)$/, (m) => teachCourse(m[1]), false, '#/teach'], [/^#\/admin$/, admin, false, '#/admin'], [/^#\/developer$/, developer, false, '#/developer'],
];
let renderToken = 0;
async function render() {
  const token = ++renderToken; const hash = location.hash || '#/';
  if (!state.me && !state.checked) { state.checked = true; try { state.me = await api('GET', '/api/auth/session'); } catch { /* server unreachable */ } }
  const found = routes.map((r) => [r, r[0].exec(hash)]).find(([, m]) => m);
  if (!state.me) { if (!/^#\/(login|register)$/.test(hash)) return go('#/login'); root.replaceChildren(authView(hash === '#/register' ? 'register' : 'login')); return; }
  if (/^#\/(login|register)$/.test(hash)) return go('#/');
  if (!found) { root.replaceChildren(shell([h('h1', {}, 'Page not found'), h('a', { href: '#/' }, 'Go home')], hash)); return; }
  const [route, m] = found;
  root.replaceChildren(shell(h('p', { class: 'muted' }, 'Loading…'), route[3]));
  try { const content = await route[1](m); if (token === renderToken) root.replaceChildren(shell(content, route[3])); }
  catch (e) { if (token === renderToken) root.replaceChildren(shell([notice(e.status === 403 ? 'You do not have access to this page.' : e.status === 404 ? 'Not found.' : e.message, 'bad'), h('button', { onclick: () => render() }, 'Try again')], route[3])); }
}
window.addEventListener('hashchange', render);
render();
