'use strict';

const api = window.planner;

const els = {
  body: document.body,
  card: document.getElementById('card'),
  dragZone: document.getElementById('dragZone'),
  dateText: document.getElementById('dateText'),
  weekText: document.getElementById('weekText'),
  progressRow: document.getElementById('progressRow'),
  barFill: document.getElementById('barFill'),
  countText: document.getElementById('countText'),
  list: document.getElementById('list'),
  footHint: document.getElementById('footHint'),
  cheerLayer: document.getElementById('cheerLayer'),
  sparkLayer: document.getElementById('sparkLayer')
};

const CHEERS = ['太棒了！', '又搞定一件 ✨', '干得漂亮！', '效率 +1 🌿', '说到做到 💪', '一口气清空它 🚀', '真不错 ☀️', '稳稳的 👍'];
const SPARK_COLORS = ['#22c1a0', '#7dd3fc', '#ffd166', '#f7a1c4', '#a08cf0'];

let state = null;
let animatingId = null;
let pendingState = null;
let lastFitHeight = 0;

init();

async function init() {
  bindStaticEvents();
  try {
    state = await api.getState();
  } catch (err) {
    console.error('[widget] 读取状态失败', err);
  }
  render();

  api.onState((next) => {
    if (animatingId) {
      pendingState = next;
      return;
    }
    state = next;
    render();
  });

  api.onRefit(() => requestAnimationFrame(() => fit(true)));

  api.onRemind((payload) => {
    if (!payload) return;
    const text = payload.body || payload.title || '有一条提醒';
    notice(`⏰ ${text}`);
    els.card.classList.add('nudging');
    setTimeout(() => els.card.classList.remove('nudging'), 900);
  });

  new ResizeObserver(() => fit()).observe(els.card);
  window.addEventListener('resize', () => fit());
  setTimeout(fit, 60);
}

/* ------------------------------------------------------------ 事件 */

function bindStaticEvents() {
  document.querySelector('.w-tools').addEventListener('click', (event) => {
    const btn = event.target.closest('.tool');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'add') api.openManager('today');
    if (act === 'panel') api.openManager('board');
    if (act === 'hide') api.hideWidget();
    if (act === 'pin') {
      const next = !state.settings.widget.alwaysOnTop;
      api.updateSettings({ widget: { alwaysOnTop: next } });
    }
  });

  els.dragZone.addEventListener('dblclick', () => api.openManager('today'));

  // 右键菜单：置顶开关、高度自适应、打开设置…
  els.card.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    api.widgetMenu();
  });

  els.list.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    api.widgetMenu();
  });

  document.addEventListener('paste', onPaste);

  els.list.addEventListener('click', (event) => {
    const linkChip = event.target.closest('.link-chip');
    if (linkChip) {
      openTaskTarget(linkChip.dataset.id);
      return;
    }

    const check = event.target.closest('.check');
    if (check) {
      const item = check.closest('.item');
      if (!item) return;
      const task = findTask(item.dataset.id);
      if (!task) return;
      if (task.done) {
        undo(item.dataset.id);
      } else {
        complete(item, check);
      }
      return;
    }

    const chip = event.target.closest('.chip');
    if (chip) {
      api.moveToday(chip.closest('.item').dataset.id);
      return;
    }

    const more = event.target.closest('.sec-more');
    if (more) {
      api.openManager(more.dataset.tab || 'board');
      return;
    }

    const emptyAdd = event.target.closest('[data-act="empty-add"]');
    if (emptyAdd) api.openManager('today');
  });

  els.footHint.addEventListener('click', () => api.openManager('today'));

  bindResizeGrip();
}

/** 右下角把手：拖动改变窗口大小（比原生边框好抓得多） */
function bindResizeGrip() {
  const grip = document.querySelector('.resize-grip');
  if (!grip) return;
  let drag = null;

  grip.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    drag = {
      startX: event.screenX,
      startY: event.screenY,
      width: window.innerWidth,
      height: window.innerHeight
    };
    document.body.classList.add('resizing');
  });

  grip.addEventListener('pointermove', (event) => {
    if (!drag) return;
    api.resizeWidgetTo({
      width: drag.width + (event.screenX - drag.startX),
      height: drag.height + (event.screenY - drag.startY)
    });
  });

  const end = (event) => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove('resizing');
    try {
      grip.releasePointerCapture(event.pointerId);
    } catch { /* 忽略 */ }
  };

  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

function findTask(id) {
  return state?.tasks.find((t) => t.id === id) || null;
}

/* ------------------------------------------------------------ 完成动画 */

async function complete(item, checkEl) {
  if (animatingId) return;
  const id = item.dataset.id;
  animatingId = id;

  const task = findTask(id);
  const ai = state?.settings?.ai;
  if (task && task.needsCheck && ai?.enabled && ai.visionModel && ai.apiKeyEnc) {
    animatingId = null;
    showNotice('这件事要先交凭证');
    api.requestProof(id);
    return;
  }

  item.classList.add('animating');
  checkEl.classList.add('done');

  burstFrom(checkEl);
  cheerFrom(checkEl);
  bumpCount();

  try {
    const result = await api.toggleTask(id, true);
    if (result && result.state) pendingState = result.state;
  } catch (err) {
    console.error('[widget] 完成任务失败', err);
  }

  setTimeout(() => {
    item.style.maxHeight = `${item.offsetHeight}px`;
    requestAnimationFrame(() => item.classList.add('leaving'));
  }, 420);

  setTimeout(() => {
    animatingId = null;
    if (pendingState) {
      state = pendingState;
      pendingState = null;
    }
    render();
  }, 720);
}

async function undo(id) {
  const result = await api.toggleTask(id, false);
  if (result?.state) {
    state = result.state;
    render();
  }
}

async function openTaskTarget(id) {
  try {
    const result = await api.openTarget(id);
    if (!result || !result.ok) showNotice(result?.error ? `打不开：${result.error}` : '没能打开这个链接');
  } catch (err) {
    showNotice('没能打开这个链接');
  }
}

function showNotice(text) {
  const rect = els.card.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'cheer notice';
  el.textContent = text;
  el.style.left = `${Math.round(rect.width / 2)}px`;
  el.style.top = `${Math.round(rect.height - 30)}px`;
  els.cheerLayer.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

function burstFrom(checkEl) {
  const cardRect = els.card.getBoundingClientRect();
  const rect = checkEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2 - cardRect.left;
  const cy = rect.top + rect.height / 2 - cardRect.top;

  for (let i = 0; i < 11; i += 1) {
    const spark = document.createElement('span');
    const angle = (Math.PI * 2 * i) / 11 + Math.random() * 0.5;
    const distance = 22 + Math.random() * 30;
    spark.className = 'spark';
    spark.style.left = `${cx}px`;
    spark.style.top = `${cy}px`;
    spark.style.background = SPARK_COLORS[i % SPARK_COLORS.length];
    spark.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    spark.style.setProperty('--dy', `${Math.sin(angle) * distance - 6}px`);
    spark.style.animationDelay = `${Math.random() * 0.08}s`;
    spark.style.width = `${4 + Math.random() * 4}px`;
    spark.style.height = spark.style.width;
    els.sparkLayer.appendChild(spark);
    setTimeout(() => spark.remove(), 900);
  }
}

function cheerFrom(checkEl) {
  const cardRect = els.card.getBoundingClientRect();
  const rect = checkEl.getBoundingClientRect();
  const item = checkEl.closest('.item');
  const itemTop = item ? item.getBoundingClientRect().top : rect.top;
  const cheer = document.createElement('div');
  cheer.className = 'cheer';
  cheer.textContent = CHEERS[Math.floor(Math.random() * CHEERS.length)];
  const x = Math.max(cardRect.width - 66, 96);
  cheer.style.left = `${x}px`;
  cheer.style.top = `${Math.max(itemTop - cardRect.top + 20, 30)}px`;
  els.cheerLayer.appendChild(cheer);
  setTimeout(() => cheer.remove(), 1200);
}

function bumpCount() {
  els.card.animate(
    [
      { transform: 'translateY(0) scale(1)' },
      { transform: 'translateY(-2px) scale(1.004)' },
      { transform: 'translateY(0) scale(1)' }
    ],
    { duration: 320, easing: 'ease-out' }
  );
}

/* ------------------------------------------------------------ 粘贴识别 */

function onPaste(event) {
  const target = event.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  const data = event.clipboardData;
  if (!data) return;

  const file =
    [...data.items].find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile() ||
    (data.files && data.files[0]);
  if (file) {
    event.preventDefault();
    recognizeFromFile(file);
    return;
  }
  const text = data.getData('text/plain');
  if (text && text.trim()) {
    event.preventDefault();
    addParsedTasks(text);
  }
}

async function recognizeFromFile(file) {
  notice('正在识别图片…');
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
  if (!dataUrl) {
    notice('读不到这张图片');
    return;
  }
  const result = await api.recognizeImage(dataUrl);
  if (!result || !result.ok) {
    notice(result?.error || '图片识别失败');
    return;
  }
  addParsedTasks(result.text);
}

async function addParsedTasks(text) {
  const items = window.NookParse ? window.NookParse.parse(text || '') : [];
  if (!items.length) {
    notice('没认出待办');
    return;
  }
  let added = 0;
  for (const item of items.slice(0, 8)) {
    const title = item.time ? `${item.time} ${item.title}` : item.title;
    const next = await api.addTask({ title, date: item.date, link: item.link });
    if (next) added += 1;
  }
  if (added) {
    bumpCount();
    notice(`已识别添加 ${added} 条`);
  } else {
    notice('添加失败');
  }
}

function notice(text) {
  const cheer = document.createElement('div');
  cheer.className = 'cheer notice';
  cheer.textContent = text;
  cheer.style.left = '50%';
  cheer.style.top = '46%';
  cheer.style.transform = 'translate(-50%, -50%)';
  els.cheerLayer.appendChild(cheer);
  setTimeout(() => cheer.remove(), 1700);
}

/* ------------------------------------------------------------ 渲染 */

function render() {
  if (!state) return;
  const s = state.settings.widget;
  els.body.dataset.accent = s.accent || 'mint';
  els.body.classList.toggle('manual', !s.autoHeight);
  const pinBtn = document.querySelector('.tool.pin');
  if (pinBtn) pinBtn.classList.toggle('on', Boolean(s.alwaysOnTop));
  document.documentElement.style.setProperty('--glass', String(s.opacity ?? 0.94));
  document.documentElement.style.setProperty('--fs', `${s.fontSize || 14}px`);

  const now = new Date();
  els.dateText.textContent = `${now.getMonth() + 1}月${now.getDate()}日`;
  els.weekText.textContent = state.weekday;

  const total = state.counts.todayTotal;
  const done = state.counts.todayDone;
  els.progressRow.classList.toggle('hidden', !s.showProgress);
  els.countText.textContent = `${done}/${total}`;
  requestAnimationFrame(() => {
    els.barFill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  });

  els.footHint.classList.toggle('hidden', !s.showHint);

  const overdue = state.tasks
    .filter((t) => t.overdue)
    .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const todayPending = state.tasks
    .filter((t) => t.isToday && !t.done)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
  const todayDone = state.tasks
    .filter((t) => t.isToday && t.done)
    .sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
  const future = s.includeFuture
    ? state.tasks.filter((t) => !t.done && t.date > state.today).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
    : [];

  const maxItems = Math.max(1, Number(s.maxItems) || 6);
  const overdueShown = s.showOverdue ? overdue.slice(0, Math.min(3, maxItems)) : [];
  const todayShown = s.showToday ? todayPending.slice(0, maxItems) : [];
  const doneShown = s.showDone ? todayDone.slice(0, 3) : [];
  const futureShown = future.slice(0, maxItems);

  const blocks = [];
  const L = window.NookI18n;
  if (L) {
    L.setLang(state.settings && state.settings.app && state.settings.app.lang === 'en' ? 'en' : 'zh');
    els.footHint.textContent = L.t('widget.foot');
  }
  const T = (key, vars) => (L ? L.t(key, vars) : key);

  if (overdueShown.length) {
    blocks.push(
      section(
        `${T('widget.overdue')} · ${overdue.length}`,
        true,
        overdueShown.map((t) => itemHtml(t, { overdueLabel: true })).join(''),
        overdue.length > overdueShown.length ? `+${overdue.length - overdueShown.length}` : ''
      )
    );
  }

  if (todayShown.length) {
    const label = T('widget.today');
    blocks.push(
      section(
        `${label}${todayPending.length ? ` · ${todayPending.length}` : ''}`,
        false,
        todayShown.map((t) => itemHtml(t)).join(''),
        todayPending.length > todayShown.length ? `+${todayPending.length - todayShown.length}` : ''
      )
    );
  }

  if (futureShown.length) {
    blocks.push(
      section(
        T('widget.next'),
        false,
        futureShown
          .map((t) => itemHtml(t, { showDate: true }))
          .join(''),
        ''
      )
    );
  }

  if (doneShown.length) {
    blocks.push(
      section(
        `${T('widget.todayDone')} · ${todayDone.length}`,
        false,
        doneShown.map((t) => itemHtml(t, { done: true })).join(''),
        ''
      )
    );
  }

  if (!blocks.length) {
    const allDone = state.counts.todayTotal > 0 && state.counts.todayDone >= state.counts.todayTotal && !overdue.length;
    blocks.push(emptyHtml(allDone));
  }

  els.list.innerHTML = blocks.join('');
  requestAnimationFrame(fit);
}

function section(title, warm, itemsHtml, moreLabel) {
  const more = moreLabel
    ? `<span class="sec-more" data-tab="board">${moreLabel} ›</span>`
    : '';
  return `
    <div class="section">
      <div class="sec-head ${warm ? 'warm' : ''}">
        <span class="sec-dot"></span>
        <span>${escapeHtml(title)}</span>
        ${more}
      </div>
      ${itemsHtml}
    </div>`;
}

function itemHtml(task, opts = {}) {
  const meta = [];
  const showTime = state?.settings?.widget?.showTime !== false;
  if (showTime && task.timeText) {
    meta.push(`<span class="time-text">⏱ ${escapeHtml(task.timeText)}</span>`);
  }
  if (opts.overdueLabel && task.overdueDays) {
    const T = (key, vars) => (window.NookI18n ? window.NookI18n.t(key, vars) : key);
    meta.push(T('widget.daysLate', { n: task.overdueDays }));
    meta.push(`<button class="chip" data-act="postpone">${T('widget.postpone')}</button>`);
  }
  if (opts.showDate) {
    meta.push(`${task.date.slice(5).replace('-', '/')} ${task.weekday}`);
  }
  const linkChip = task.link
    ? `<button class="link-chip" data-id="${task.id}" title="打开：${escapeHtml(task.link)}">
         <span class="ico">↗</span><span class="link-label">${escapeHtml(task.linkLabel || '打开')}</span>
       </button>`
    : '';

  return `
    <div class="item ${opts.done ? 'is-done' : ''}" data-id="${task.id}">
      <button class="check ${opts.done ? 'done' : ''}" aria-label="完成任务"></button>
      <div class="body">
        <div class="title-row">
          <div class="title">${escapeHtml(task.title)}</div>
          ${linkChip}
        </div>
        ${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}
      </div>
    </div>`;
}

function emptyHtml(allDone) {
  if (allDone) {
    return `
    <div class="empty">
      <span class="emoji">🎉</span>
      <p>今天的计划全部完成<br />给自己一点小奖励吧</p>
    </div>`;
  }
  return `
    <div class="empty">
      <span class="emoji">🌿</span>
      <p>今天还很轻松<br />给自己安排一件小事吧</p>
      <button class="btn btn-sm btn-primary" data-act="empty-add">＋ 添加任务</button>
    </div>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/* ------------------------------------------------------------ 自适应高度 */

function fit(force = false) {
  if (!els.card) return;
  if (state && !state.settings.widget.autoHeight) return;
  const rootStyle = getComputedStyle(document.querySelector('.root'));
  const padTop = parseFloat(rootStyle.paddingTop) || 0;
  const padBottom = parseFloat(rootStyle.paddingBottom) || 0;
  const height = Math.ceil(els.card.getBoundingClientRect().height + padTop + padBottom + 4);
  if (!force && Math.abs(height - lastFitHeight) <= 2) return;
  lastFitHeight = height;
  api.resizeWidget(height);
}
