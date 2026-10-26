'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const pad = (n) => String(n).padStart(2, '0');

/** 本地日期 -> 'YYYY-MM-DD' */
function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const DEFAULT_SETTINGS = {
  widget: {
    showToday: true,
    showOverdue: true,
    showDone: false,
    includeFuture: false,
    maxItems: 6,
    opacity: 0.97,
    fontSize: 14,
    width: 330,
    height: 420,
    autoHeight: true,
    alwaysOnTop: true,
    showProgress: true,
    showHint: true,
    showTime: true,
    accent: 'mint',
    x: null,
    y: null
  },
  app: {
    autostart: false,
    hideWidget: false,
    startMinimized: false,
    requireProof: false,
    lang: 'zh'
  },
  notify: {
    enabled: true,
    leadMinutes: 5,
    atEnd: true,
    sound: false
  },
  ai: {
    enabled: false,
    provider: 'deepseek',
    baseUrl: '',
    model: '',
    visionModel: '',
    apiKeyEnc: '',
    useVision: true
  }
};

const ENCOURAGE = [
  '太棒了！',
  '又搞定一件 ✨',
  '效率满满 ☀️',
  '干得漂亮！',
  '今日进度 +1 🌿',
  '说到做到 💪',
  '一口气清空它 🚀'
];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'plans.json');
    this.backupFile = path.join(dir, 'plans.backup.json');
    this.data = this.load();
  }

  static empty() {
    return {
      version: 2,
      tasks: [],
      goals: [],
      summaries: [],
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      unknown: {}
    };
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    for (const file of [this.file, this.backupFile]) {
      try {
        if (!fs.existsSync(file)) continue;
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        const data = Store.empty();
        data.tasks = Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTask).filter(Boolean) : [];
        data.goals = Array.isArray(parsed.goals) ? parsed.goals.map(normalizeGoal).filter(Boolean) : [];
        data.summaries = Array.isArray(parsed.summaries) ? parsed.summaries.filter(Boolean).slice(-120) : [];
        data.settings = deepMerge(DEFAULT_SETTINGS, parsed.settings || {});
        data.unknown = parsed.unknown || {};
        return data;
      } catch (err) {
        console.error('[store] 读取失败，尝试下一个文件：', file, err.message);
      }
    }
    return Store.empty();
  }

  save() {
    const payload = JSON.stringify(this.data, null, 2);
    const tmp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(tmp, payload, 'utf8');
      if (fs.existsSync(this.file)) {
        try {
          fs.copyFileSync(this.file, this.backupFile);
        } catch { /* 备份失败不阻塞 */ }
      }
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] 保存失败：', err);
    }
  }

  get tasks() {
    return this.data.tasks;
  }

  get goals() {
    return this.data.goals;
  }

  get summaries() {
    return this.data.summaries;
  }

  get settings() {
    return this.data.settings;
  }

  findTask(id) {
    return this.data.tasks.find((t) => t.id === id) || null;
  }

  findGoal(id) {
    return this.data.goals.find((g) => g.id === id) || null;
  }

  snapshot() {
    const today = dateKey();
    const goalMap = new Map(this.data.goals.map((g) => [g.id, g]));
    const tasks = this.data.tasks.map((t) => decorate(t, today, goalMap));
    const pending = tasks.filter((t) => !t.done);
    const todayTasks = tasks.filter((t) => t.date === today);
    const doneToday = todayTasks.filter((t) => t.done).length;
    return {
      today,
      todayLabel: `${parseKey(today).getFullYear()}年${parseKey(today).getMonth() + 1}月${parseKey(today).getDate()}日`,
      weekday: WEEKDAY[parseKey(today).getDay()],
      storeFile: this.file,
      tasks,
      goals: this.data.goals.map((g) => decorateGoal(g, tasks, today)),
      summaries: this.data.summaries.slice(-30),
      counts: {
        todayTotal: todayTasks.length,
        todayDone: doneToday,
        todayPending: todayTasks.filter((t) => !t.done).length,
        overdue: pending.filter((t) => t.overdue).length,
        future: pending.filter((t) => t.date > today).length,
        done: tasks.filter((t) => t.done).length
      },
      settings: this.data.settings
    };
  }

  addTask({ title, date, note = '', link = '', start = '', end = '', parentId = null, needsCheck = false }) {
    const clean = String(title || '').trim();
    if (!clean) return null;
    const task = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: clean.slice(0, 120),
      note: String(note || '').slice(0, 400),
      link: normalizeLink(link),
      date: isValidKey(date) ? date : dateKey(),
      start: validTime(start),
      end: validTime(end),
      parentId: this.data.goals.some((g) => g.id === parentId) ? parentId : null,
      needsCheck: Boolean(needsCheck),
      done: false,
      doneAt: null,
      createdAt: new Date().toISOString(),
      order: this.data.tasks.length
    };
    this.data.tasks.push(task);
    this.save();
    return task;
  }

  addTasks(titles, date) {
    const added = [];
    for (const title of titles) {
      const t = this.addTask({ title, date });
      if (t) added.push(t);
    }
    return added;
  }

  updateTask(id, patch = {}) {
    const task = this.findTask(id);
    if (!task) return null;
    if (typeof patch.title === 'string' && patch.title.trim()) task.title = patch.title.trim().slice(0, 120);
    if (typeof patch.note === 'string') task.note = patch.note.slice(0, 400);
    if (typeof patch.link === 'string') task.link = normalizeLink(patch.link);
    if (typeof patch.date === 'string' && isValidKey(patch.date)) task.date = patch.date;
    if ('start' in patch) task.start = validTime(patch.start);
    if ('end' in patch) task.end = validTime(patch.end);
    if ('needsCheck' in patch) task.needsCheck = Boolean(patch.needsCheck);
    if ('parentId' in patch) {
      task.parentId = this.data.goals.some((g) => g.id === patch.parentId) ? patch.parentId : null;
    }
    if (typeof patch.done === 'boolean') {
      task.done = patch.done;
      task.doneAt = patch.done ? new Date().toISOString() : null;
    }
    this.save();
    return task;
  }

  toggleTask(id, force) {
    const task = this.findTask(id);
    if (!task) return null;
    task.done = typeof force === 'boolean' ? force : !task.done;
    task.doneAt = task.done ? new Date().toISOString() : null;
    this.save();
    return task;
  }

  deleteTask(id) {
    const idx = this.data.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    this.data.tasks.splice(idx, 1);
    this.save();
    return true;
  }

  moveToToday(id) {
    const task = this.findTask(id);
    if (!task) return null;
    task.date = dateKey();
    if (task.done) {
      task.done = false;
      task.doneAt = null;
    }
    this.save();
    return task;
  }

  postponeOverdueToToday() {
    const today = dateKey();
    let count = 0;
    for (const t of this.data.tasks) {
      if (!t.done && t.date < today) {
        t.date = today;
        count += 1;
      }
    }
    if (count) this.save();
    return count;
  }

  clearCompleted() {
    const before = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter((t) => !t.done);
    if (this.data.tasks.length !== before) this.save();
    return before - this.data.tasks.length;
  }

  /* ------------------------------------------------------ 长期计划 */

  addGoal({ title, startDate, endDate, note = '' }) {
    const clean = String(title || '').trim();
    if (!clean) return null;
    const today = dateKey();
    const goal = {
      id: crypto.randomUUID ? crypto.randomUUID() : `g-${Date.now()}`,
      title: clean.slice(0, 80),
      note: String(note || '').slice(0, 400),
      startDate: isValidKey(startDate) ? startDate : today,
      endDate: isValidKey(endDate) ? endDate : addDays(today, 30),
      createdAt: new Date().toISOString(),
      archived: false
    };
    this.data.goals.push(goal);
    this.save();
    return goal;
  }

  updateGoal(id, patch = {}) {
    const goal = this.findGoal(id);
    if (!goal) return null;
    if (typeof patch.title === 'string' && patch.title.trim()) goal.title = patch.title.trim().slice(0, 80);
    if (typeof patch.note === 'string') goal.note = patch.note.slice(0, 400);
    if (isValidKey(patch.startDate)) goal.startDate = patch.startDate;
    if (isValidKey(patch.endDate)) goal.endDate = patch.endDate;
    if (typeof patch.archived === 'boolean') goal.archived = patch.archived;
    this.save();
    return goal;
  }

  deleteGoal(id) {
    const idx = this.data.goals.findIndex((g) => g.id === id);
    if (idx === -1) return false;
    this.data.goals.splice(idx, 1);
    for (const task of this.data.tasks) {
      if (task.parentId === id) task.parentId = null;
    }
    this.save();
    return true;
  }

  /** 把一堆 AI 生成/识别出来的条目批量写进计划表 */
  addBatch(items, fallbackDate) {
    const added = [];
    for (const item of items) {
      if (!item || !String(item.title || '').trim()) continue;
      const task = this.addTask({
        title: item.title,
        date: item.date || fallbackDate,
        start: item.start || '',
        end: item.end || '',
        note: item.note || '',
        link: item.link || '',
        parentId: item.parentId || null,
        needsCheck: Boolean(item.needsCheck)
      });
      if (task) added.push(task);
    }
    return added;
  }

  /* ------------------------------------------------------ 每日总结 */

  saveSummary({ date, summary, tips, provider = '' }) {
    const entry = {
      id: crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}`,
      date: isValidKey(date) ? date : dateKey(),
      summary: String(summary || '').slice(0, 2000),
      tips: String(tips || '').slice(0, 1000),
      provider,
      createdAt: new Date().toISOString()
    };
    this.data.summaries = this.data.summaries.filter((s) => !(s && s.date === entry.date && s.kind === 'auto'));
    entry.kind = 'auto';
    this.data.summaries.push(entry);
    this.data.summaries = this.data.summaries.slice(-120);
    this.save();
    return entry;
  }

  updateSettings(patch) {
    this.data.settings = deepMerge(this.data.settings, patch || {});
    this.save();
    return this.data.settings;
  }

  randomEncouragement() {
    return ENCOURAGE[Math.floor(Math.random() * ENCOURAGE.length)];
  }
}

function isValidKey(key) {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key);
}

/** 'HH:mm' 或 'H:mm' -> 规范化；空串表示不设时间 */
function validTime(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const m = /^(\d{1,2})[:：](\d{2})$/.exec(text);
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return '';
  return `${pad(h)}:${pad(min)}`;
}

/** 统一整理链接/应用路径 */
function normalizeLink(value) {
  const text = String(value || '').trim().slice(0, 600);
  if (!text) return '';
  // 用户只输入了 www 或域名时补上 https
  if (/^www\./i.test(text)) return `https://${text}`;
  if (/^[^\s\\/]+\.(com|cn|net|org|io|dev|app|me|cc|co|top|xyz)(\/|$)/i.test(text) && !/^[a-z]:/i.test(text)) {
    return `https://${text}`;
  }
  return text;
}

function linkKind(link) {
  if (!link) return '';
  if (/^https?:\/\//i.test(link)) return 'url';
  if (/^mailto:/i.test(link)) return 'mail';
  return 'file';
}

function linkLabel(link) {
  if (!link) return '';
  try {
    if (linkKind(link) === 'url') return new URL(link).hostname.replace(/^www\./i, '');
    if (linkKind(link) === 'mail') return link.slice(7);
    const clean = link.replace(/^file:\/+/i, '').replace(/\//g, '\\');
    const parts = clean.split('\\').filter(Boolean);
    return parts[parts.length - 1] || clean;
  } catch {
    return link;
  }
}

function normalizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || '').trim();
  if (!title) return null;
  return {
    id: String(raw.id || crypto.randomUUID()),
    title: title.slice(0, 120),
    note: String(raw.note || '').slice(0, 400),
    link: normalizeLink(raw.link),
    date: isValidKey(raw.date) ? raw.date : dateKey(),
    start: validTime(raw.start),
    end: validTime(raw.end),
    parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
    needsCheck: Boolean(raw.needsCheck),
    done: Boolean(raw.done),
    doneAt: raw.doneAt || (raw.done ? new Date().toISOString() : null),
    createdAt: raw.createdAt || new Date().toISOString(),
    order: Number.isFinite(raw.order) ? raw.order : 0
  };
}

function normalizeGoal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = String(raw.title || '').trim();
  if (!title) return null;
  const today = dateKey();
  return {
    id: String(raw.id || `g-${crypto.randomUUID()}`),
    title: title.slice(0, 80),
    note: String(raw.note || '').slice(0, 400),
    startDate: isValidKey(raw.startDate) ? raw.startDate : today,
    endDate: isValidKey(raw.endDate) ? raw.endDate : addDays(today, 30),
    createdAt: raw.createdAt || new Date().toISOString(),
    archived: Boolean(raw.archived)
  };
}

function decorate(task, today, goalMap) {
  const overdueDays = task.date < today
    ? Math.round((parseKey(today) - parseKey(task.date)) / 86400000)
    : 0;
  const goal = task.parentId && goalMap ? goalMap.get(task.parentId) : null;
  return {
    ...task,
    overdue: !task.done && overdueDays > 0,
    overdueDays,
    isToday: task.date === today,
    weekday: WEEKDAY[parseKey(task.date).getDay()],
    linkLabel: linkLabel(task.link),
    linkKind: linkKind(task.link),
    timeText: task.start ? (task.end ? `${task.start}–${task.end}` : task.start) : '',
    parentTitle: goal ? goal.title : ''
  };
}

function decorateGoal(goal, tasks, today) {
  const children = tasks.filter((t) => t.parentId === goal.id);
  const done = children.filter((t) => t.done).length;
  const daysLeft = Math.round((parseKey(goal.endDate) - parseKey(today)) / 86400000);
  return {
    ...goal,
    children,
    childTotal: children.length,
    childDone: done,
    progress: children.length ? done / children.length : 0,
    daysLeft,
    ended: daysLeft < 0,
    pending: children.filter((t) => !t.done)
  };
}

module.exports = {
  Store,
  dateKey,
  parseKey,
  addDays,
  WEEKDAY,
  DEFAULT_SETTINGS,
  normalizeLink,
  linkLabel,
  linkKind,
  validTime,
  isValidKey
};
