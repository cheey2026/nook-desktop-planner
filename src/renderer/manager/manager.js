'use strict';

const api = window.planner;
const t = (key, vars) => (window.NookI18n ? window.NookI18n.t(key, vars) : key);

const CHEERS = ['太棒了！', '又搞定一件 ✨', '干得漂亮！', '效率 +1 🌿', '说到做到 💪', '真不错 ☀️'];
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const ACCENT_LABELS = { mint: '薄荷', sky: '晴空', peach: '蜜桃', lilac: '紫藤' };

const els = {
  view: document.getElementById('view'),
  nav: document.getElementById('nav'),
  statToday: document.getElementById('statToday'),
  statOverdue: document.getElementById('statOverdue'),
  toastWrap: document.getElementById('toastWrap'),
  btnShowWidget: document.getElementById('btnShowWidget')
};

let state = null;
let tab = 'today';
let selectedDate = null;
let weekOffset = 0;
let editingId = null;
let pendingLink = '';
let linkTaskId = null;
let freezeUntil = 0;
let queuedState = null;
let autostartActual = null;
let rangeTimer = null;

let aiCfg = null;
let timeTaskId = null;
let timeForNew = false;
let pendingTime = { start: '', end: '' };
let goalEditingId = null;
let proofTaskId = null;
let proofDataUrl = '';
let planBusy = false;
let summaryBusy = false;
let summaryEntry = null;

init();

async function init() {
  bindChrome();
  els.view.addEventListener('click', onViewClick);
  els.view.addEventListener('keydown', onViewKeyDown);
  els.view.addEventListener('input', onViewInput);
  els.view.addEventListener('change', onViewChange);

  api.onState((next) => {
    if (Date.now() < freezeUntil) {
      queuedState = next;
      return;
    }
    state = next;
    render();
  });

  api.onNavigate((target) => navigate(target));
  api.onWindowResized(() => {});
  api.onProofRequest((id) => {
    navigate('today');
    setTimeout(() => openProof(id), 120);
  });

  try {
    state = await api.getState();
    selectedDate = state.today;
    applyLanguage(state.settings.app && state.settings.app.lang);
    render();
    refreshAiConfig();
    api.autostartState().then((actual) => {
      autostartActual = Boolean(actual);
      if (tab === 'settings') render();
    });
  } catch (err) {
    console.error('[manager] 初始化失败', err);
  }
}

/* ------------------------------------------------------------ 窗口按钮 */

function bindChrome() {
  document.getElementById('btnMin').addEventListener('click', () => api.minimize());
  document.getElementById('btnMax').addEventListener('click', () => api.toggleMaximize());
  document.getElementById('btnClose').addEventListener('click', () => api.close());
  els.btnShowWidget.addEventListener('click', async () => {
    if (state.settings.app.hideWidget) {
      await api.showWidget();
      toast('桌面组件已显示');
    } else {
      await api.hideWidget();
      toast('桌面组件已隐藏');
    }
  });

  els.nav.addEventListener('click', (event) => {
    const btn = event.target.closest('.nav-item');
    if (btn) navigate(btn.dataset.tab);
  });

  bindLinkModal();
  bindRecognizeModal();
  bindRecognizeInput();
  bindTimeModal();
  bindGoalModal();
  bindAiPlanModal();
  bindSummaryModal();
  bindProofModal();
  bindDropZone();

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      navigate('today');
      setTimeout(() => document.getElementById('addInput')?.focus(), 30);
    }
    if (event.key === 'Escape' && editingId) {
      editingId = null;
      render();
    }
  });
}

function applyLanguage(lang) {
  if (!window.NookI18n) return;
  window.NookI18n.setLang(lang === 'en' ? 'en' : 'zh');
  window.NookI18n.apply();
}

function navigate(target) {
  if (!target) return;
  tab = ['today', 'board', 'goals', 'done', 'settings'].includes(target) ? target : 'today';
  editingId = null;
  render();
  if (tab === 'today') {
    setTimeout(() => document.getElementById('addInput')?.focus(), 60);
  }
  if (tab === 'settings') {
    refreshAiConfig();
    api.autostartState().then((actual) => {
      autostartActual = Boolean(actual);
      if (tab === 'settings') render();
    });
  }
}

/* ------------------------------------------------------------ 链接 / 应用弹窗 */

function bindLinkModal() {
  const mask = document.getElementById('linkModal');  const input = document.getElementById('linkInput');

  document.getElementById('linkCancel').addEventListener('click', closeLinkModal);
  document.getElementById('linkSave').addEventListener('click', saveLinkModal);
  document.getElementById('linkClear').addEventListener('click', () => {
    input.value = '';
    saveLinkModal();
  });
  document.getElementById('linkPick').addEventListener('click', async () => {
    const picked = await api.pickTarget();
    if (picked) input.value = picked;
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveLinkModal();
    }
    if (event.key === 'Escape') closeLinkModal();
  });

  mask.addEventListener('mousedown', (event) => {
    if (event.target === mask) closeLinkModal();
  });
}

/* ------------------------------------------------------------ 粘贴 / 图片识别 */

let rcItems = [];

function bindRecognizeModal() {
  const mask = document.getElementById('recognizeModal');
  document.getElementById('rcCancel').addEventListener('click', closeRecognize);
  document.getElementById('rcSave').addEventListener('click', applyRecognized);
  mask.addEventListener('mousedown', (event) => {
    if (event.target === mask) closeRecognize();
  });
  document.getElementById('rcList').addEventListener('click', (event) => {
    const del = event.target.closest('.rc-del');
    if (del) {
      del.closest('.rc-row')?.remove();
      updateRcCount();
      return;
    }
    const copy = event.target.closest('.rc-copy');
    if (copy) {
      const row = copy.closest('.rc-row');
      if (row) {
        api.writeClipboard(recognizeRowText(row));
        toast('这一条已复制');
      }
    }
  });
  document.getElementById('rcCopy').addEventListener('click', () => {
    const text = recognizeAllText();
    if (!text.trim()) {
      toast('没有可复制的内容');
      return;
    }
    api.writeClipboard(text);
    toast('已复制全部识别结果');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !mask.hidden) closeRecognize();
  });
  document.addEventListener('paste', onPaste);
}

function onPaste(event) {
  const mask = document.getElementById('recognizeModal');
  if (!mask.hidden) return;
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
    openRecognize({ text });
  }
}

async function recognizeFromClipboard() {
  const data = await api.readClipboard();
  if (data && data.image) {
    await recognizeFromDataUrl(data.image);
    return;
  }
  if (data && data.text && data.text.trim()) {
    openRecognize({ text: data.text });
    return;
  }
  toast('剪贴板里没有文字或图片，先复制一段内容再点识别');
}

async function recognizeFromFile(file) {
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
  if (!dataUrl) {
    toast('读不到这张图片');
    return;
  }
  await recognizeFromDataUrl(dataUrl);
}

async function recognizeFromDataUrl(dataUrl) {
  if (aiReady(true)) {
    toast('AI 正在看这张图…');
    const res = await api.aiRecognize({ imageDataUrl: dataUrl });
    if (res && res.ok && res.items && res.items.length) {
      openRecognizeItems(res.items, 'ai-image');
      return;
    }
    if (res && !res.ok) toast(`AI 没成功：${res.error}，改用本地识别`);
  }
  toast('正在识别图片，稍等一下…');
  const result = await api.recognizeImage(dataUrl);
  if (!result || !result.ok) {
    toast(result?.error || '图片识别失败');
    return;
  }
  const items = window.NookParse ? window.NookParse.parse(result.text || '') : [];
  if (!items.length) {
    toast('图片里没读出待办，试着直接粘贴文字');
    return;
  }
  openRecognizeItems(items, 'ocr');
}

async function openRecognize({ text, fromImage = false }) {
  if (aiReady()) {
    toast('AI 正在整理这段内容…');
    const res = await api.aiRecognize({ text });
    if (res && res.ok && res.items && res.items.length) {
      openRecognizeItems(res.items, 'ai-text');
      return;
    }
    if (res && !res.ok) {
      toast(`AI 没成功：${res.error}，改用本地规则`);
    }
  }
  const items = window.NookParse ? window.NookParse.parse(text || '') : [];
  if (!items.length) {
    toast('没从里面认出待办事项');
    return;
  }
  openRecognizeItems(items, fromImage ? 'ocr' : 'local');
}

/* ------------------------------------------------------------ 识别输入框 */

function openRecognizeInput() {
  const mask = document.getElementById('recognizeInputModal');
  const input = document.getElementById('recInputText');
  if (!mask || !input) return;
  input.value = '';
  document.getElementById('recInputNote').textContent = '';
  if (window.NookI18n) window.NookI18n.apply(mask);
  mask.hidden = false;
  setTimeout(() => input.focus(), 40);
}

function closeRecognizeInput() {
  const mask = document.getElementById('recognizeInputModal');
  if (mask) mask.hidden = true;
}

function bindRecognizeInput() {
  const mask = document.getElementById('recognizeInputModal');
  const input = document.getElementById('recInputText');
  if (!mask || !input) return;

  document.getElementById('recInputCancel').addEventListener('click', closeRecognizeInput);
  mask.addEventListener('mousedown', (event) => {
    if (event.target === mask) closeRecognizeInput();
  });

  document.getElementById('recInputRun').addEventListener('click', () => {
    const text = input.value.trim();
    if (!text) {
      placeNote('recInputNote', '先粘一段文字，或者点「选择图片」');
      document.getElementById('recInputText').focus();
      return;
    }
    closeRecognizeInput();
    openRecognize({ text });
  });

  document.getElementById('recInputPaste').addEventListener('click', async () => {
    const text = await api.readClipboard();
    if (!text) {
      placeNote('recInputNote', '剪贴板里没有文字');
      return;
    }
    input.value = text;
    document.getElementById('recInputNote').textContent = '已从剪贴板粘贴';
  });

  document.getElementById('recInputImage').addEventListener('click', async () => {
    const picked = await api.pickFile('image');
    if (!picked) return;
    const img = await api.fileImageData(picked);
    if (!img || !img.ok) {
      placeNote('recInputNote', img?.error || '读不到这张图片');
      return;
    }
    closeRecognizeInput();
    await recognizeFromDataUrl(img.dataUrl);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      document.getElementById('recInputRun').click();
    }
  });
}

function placeNote(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderRecognizeRows() {  const list = document.getElementById('rcList');
  list.innerHTML = rcItems
    .map((item) => {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(item.date || '') ? item.date : state.today;
      return `
      <div class="rc-row" data-link="${escapeAttr(item.link || '')}" data-end="${escapeAttr(item.end || '')}" data-note="${escapeAttr(item.note || '')}" data-parent="${escapeAttr(item.parentId || '')}">
        <input class="rc-time" type="time" value="${escapeAttr(item.start || '')}" title="开始时间（可不填）" />
        <input class="rc-title" maxlength="120" value="${escapeAttr(item.title)}" />
        <input class="rc-date" type="date" value="${escapeAttr(date)}" />
        ${item.link ? `<span class="rc-link" title="${escapeAttr(item.link)}">↗ ${escapeHtml(shortLinkLabel(item.link))}</span>` : ''}
        ${item.note ? `<span class="rc-note" title="${escapeAttr(item.note)}">${escapeHtml(truncate(item.note, 10))}</span>` : ''}
        <button class="rc-copy" type="button" title="复制这一条">⧉</button>
        <button class="rc-del" type="button" title="删掉这条">✕</button>
      </div>`;
    })
    .join('');
  updateRcCount();
}

function recognizeRowText(row) {
  const title = row.querySelector('.rc-title').value.trim();
  const time = row.querySelector('.rc-time').value;
  const date = row.querySelector('.rc-date').value;
  const link = row.dataset.link || '';
  return `${date} ${time ? time + ' ' : ''}${title}${link ? ' ' + link : ''}`.trim();
}

function recognizeAllText() {
  return [...document.querySelectorAll('#rcList .rc-row')].map(recognizeRowText).join('\n');
}

function updateRcCount() {
  const count = document.querySelectorAll('#rcList .rc-row').length;
  document.getElementById('rcCount').textContent = String(count);
  document.getElementById('rcSave').disabled = count === 0;
}

function closeRecognize() {
  document.getElementById('recognizeModal').hidden = true;
  rcItems = [];
}

async function applyRecognized() {
  const rows = [...document.querySelectorAll('#rcList .rc-row')];
  const payloads = [];
  for (const row of rows) {
    const title = row.querySelector('.rc-title').value.trim();
    if (!title) continue;
    payloads.push({
      title: title.slice(0, 120),
      date: row.querySelector('.rc-date').value || state.today,
      start: row.querySelector('.rc-time').value || '',
      end: row.dataset.end || '',
      note: row.dataset.note || '',
      link: row.dataset.link || '',
      parentId: row.dataset.parent || null
    });
  }
  if (!payloads.length) {
    closeRecognize();
    toast('没有可添加的内容');
    return;
  }
  let added = 0;
  for (const payload of payloads) {
    const next = await api.addTask(payload);
    if (next) {
      state = next;
      added += 1;
    }
  }
  closeRecognize();
  render();
  toast(`已识别添加 ${added} 条`, 'good');
}

function openLinkModal(taskId) {
  linkTaskId = taskId || null;
  const task = taskId ? state.tasks.find((t) => t.id === taskId) : null;
  const mask = document.getElementById('linkModal');
  const input = document.getElementById('linkInput');
  document.getElementById('linkTitle').textContent = task ? '修改任务的链接 / 应用' : '给新任务挂一个链接或应用';
  document.getElementById('linkSub').textContent = task
    ? `「${task.title}」`
    : '填网址或本机程序路径，任务后面会出现一个小按钮，点一下就能打开。';
  input.value = task ? task.link || '' : pendingLink || '';
  mask.hidden = false;
  setTimeout(() => {
    input.focus();
    input.select();
  }, 20);
}

function closeLinkModal() {
  document.getElementById('linkModal').hidden = true;
  linkTaskId = null;
}

async function saveLinkModal() {
  const value = document.getElementById('linkInput').value.trim();
  const taskId = linkTaskId;
  closeLinkModal();

  if (taskId) {
    const next = await api.updateTask(taskId, { link: value });
    state = next;
    render();
    toast(value ? '已保存链接' : '已清除链接');
    return;
  }

  pendingLink = value;
  render();
  toast(value ? '已挂上链接，添加任务时生效' : '已清除');
}

/* ------------------------------------------------------------ 渲染 */

function render() {
  if (!state) return;
  const settings = state.settings;
  document.body.dataset.accent = settings.widget.accent || 'mint';

  if (!selectedDate || selectedDate < state.today) selectedDate = state.today;

  els.statToday.textContent = `${state.counts.todayDone}/${state.counts.todayTotal}`;
  els.statOverdue.textContent = String(state.counts.overdue);
  els.btnShowWidget.textContent = settings.app.hideWidget ? t('cfg.showWidget') : t('cfg.hideWidget');

  for (const item of els.nav.querySelectorAll('.nav-item')) {
    item.classList.toggle('active', item.dataset.tab === tab);
  }

  if (tab === 'today') els.view.innerHTML = todayView();
  else if (tab === 'board') els.view.innerHTML = boardView();
  else if (tab === 'goals') els.view.innerHTML = goalsView();
  else if (tab === 'done') els.view.innerHTML = doneView();
  else els.view.innerHTML = settingsView();

  if (window.NookI18n) window.NookI18n.apply(document);

  requestAnimationFrame(() => {
    if (editingId) {
      const input = els.view.querySelector(`[data-edit-input="${editingId}"]`);
      if (input) {
        input.focus();
        input.select();
      }
    }
    const current = els.view.querySelector('.day-chip.active');
    if (current) current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

/* ------------------------------------------------------------ 今日 */

function todayView() {
  const today = state.today;
  const todayTasks = state.tasks.filter((t) => t.date === today);
  const pending = todayTasks.filter((t) => !t.done).sort(byOrder);
  const done = todayTasks.filter((t) => t.done).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
  const overdue = state.tasks.filter((t) => t.overdue).sort((a, b) => a.date.localeCompare(b.date) || byOrder(a, b));

  const total = state.counts.todayTotal;
  const doneCount = state.counts.todayDone;
  const pct = total ? doneCount / total : 0;

  let sub;
  if (!total && !overdue.length) {
    sub = t('hero.empty');
  } else if (state.settings.app.lang === 'en') {
    const parts = [`${total} thing${total > 1 ? 's' : ''} today, ${doneCount} done`];
    if (overdue.length) parts.push(`${overdue.length} overdue`);
    if (pending.length) parts.push(`${pending.length} waiting`);
    sub = parts.join(' · ') + '.';
  } else {
    const parts = [`今天共 <b>${total}</b> 件事，已完成 <b>${doneCount}</b> 件`];
    if (overdue.length) parts.push(`另有 <b>${overdue.length}</b> 件超期未办`);
    if (pending.length) parts.push(`还剩 <b>${pending.length}</b> 件在等你`);
    sub = `${parts.join('，')}。`;
  }

  const isEn = state.settings.app.lang === 'en';

  return `
    <section class="hero">
      <div>
        <div class="hero-date">${isEn ? monthDayEn(today) : monthDay(today)}</div>
        <div class="hero-meta">
          <span>${isEn ? weekdayEn(state.weekday) : state.weekday}</span>
          <span class="sep"></span>
          <span>${greeting()}</span>
          <span class="sep"></span>
          <span>${pending.length ? t('hero.pushing') : total ? t('hero.allDone') : t('hero.blank')}</span>
        </div>
        <p class="hero-sub">${sub}</p>
        <div class="hero-tools">
          <button class="btn btn-sm" data-act="ai-plan" title="写一句目标，AI 帮你拆成未来几天的任务">✨ ${t('tool.ai')}</button>
          <button class="btn btn-sm" data-act="summary" title="AI 根据今天的完成情况写一段小结">📝 ${t('tool.summary')}</button>
          <button class="btn btn-sm" data-act="import-file" title="选择文件导入：文本或截图，自动拆成任务">📄 ${t('tool.import')}</button>
        </div>
      </div>
      <div class="ring">
        <svg width="104" height="104" viewBox="0 0 104 104">
          <defs>
            <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="var(--acc)" />
              <stop offset="100%" stop-color="var(--acc-deep)" />
            </linearGradient>
          </defs>
          <circle cx="52" cy="52" r="44" fill="none" stroke="rgba(30,90,78,0.1)" stroke-width="8" />
          <circle cx="52" cy="52" r="44" fill="none" stroke="url(#ringGrad)" stroke-width="8" stroke-linecap="round"
            stroke-dasharray="${(2 * Math.PI * 44).toFixed(1)}"
            stroke-dashoffset="${(2 * Math.PI * 44 * (1 - pct)).toFixed(1)}"
            style="transition: stroke-dashoffset .6s cubic-bezier(.22,1,.36,1)" />
        </svg>
        <div class="ring-label">
          <b>${Math.round(pct * 100)}%</b>
          <span>${t('ring.done')}</span>
        </div>
      </div>
    </section>

    <div class="add-row">
      <input type="text" id="addInput" placeholder="${t('add.placeholder')}" maxlength="120" />
      <input type="date" id="addDate" value="${today}" />
      <button class="btn btn-sm ${pendingTime.start ? 'btn-link-on' : ''}" data-act="time-new" title="给这条新任务安排时间">
        ${pendingTime.start ? `⏱ ${pendingTime.start}${pendingTime.end ? '–' + pendingTime.end : ''}` : '⏱ ' + t('add.time')}
      </button>
      <button class="btn btn-sm" data-act="recognize" title="输入或粘贴一段文字、选一张截图，自动拆成任务">${t('add.recognize')}</button>
      <button class="btn btn-sm ${pendingLink ? 'btn-link-on' : ''}" data-act="attach" title="${pendingLink ? escapeAttr(pendingLink) : '给新任务挂一个链接或应用'}">
        ${pendingLink ? `↗ ${escapeHtml(shortLinkLabel(pendingLink))}` : '＋ ' + t('add.link')}
      </button>
      <button class="btn btn-primary btn-sm" data-act="add">${t('add.submit')}</button>
    </div>

    ${overdue.length ? `
      <section class="block">
        <header class="block-head">
          <h3><span class="dot warm"></span>${t('sec.overdue')}<span class="badge warm">${overdue.length}</span></h3>
          <div class="spacer"></div>
          <button class="btn btn-sm" data-act="postpone-all">${t('act.postpone')}</button>
        </header>
        <div class="list">${overdue.map((t) => taskRow(t, { showDate: true })).join('')}</div>
      </section>` : ''}

    <section class="block">
      <header class="block-head">
        <h3><span class="dot"></span>${t('sec.today')}<span class="badge">${pending.length}</span></h3>
        <div class="spacer"></div>
        ${done.length ? `<span style="font-size:11.5px;color:var(--ink-3)">${t('sec.doneCount', { n: done.length })}</span>` : ''}
      </header>
      <div class="list">
        ${pending.length ? pending.map((t) => taskRow(t)).join('') : emptyHtml('☀️', t('empty.today'))}
      </div>
      ${done.length ? `<div class="list" style="margin-top:6px">${done.map((t) => taskRow(t, { done: true })).join('')}</div>` : ''}
    </section>
  `;
}

/* ------------------------------------------------------------ 计划板 */

function boardView() {
  const today = state.today;
  const start = dateAdd(today, weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, i) => dateAdd(start, i));
  const countsByDay = new Map();
  for (const task of state.tasks) {
    if (task.done) continue;
    countsByDay.set(task.date, (countsByDay.get(task.date) || 0) + 1);
  }

  const dayTasks = state.tasks.filter((t) => t.date === selectedDate).sort(byOrder);
  const doneCount = dayTasks.filter((t) => t.done).length;

  return `
    <div class="board-top">
      <div>
        <h2>计划板</h2>
        <p>提前安排未来几天，也可以回头补记。超期的任务会自动出现在「今日」页。</p>
      </div>
      <div style="display:flex;gap:6px">
        <button class="icon-btn" data-act="week-prev" title="上一周">‹</button>
        <button class="icon-btn" data-act="week-today" title="回到今天">今</button>
        <button class="icon-btn" data-act="week-next" title="下一周">›</button>
      </div>
    </div>

    <div class="week">
      <div class="week-scroll">
        ${days.map((d) => {
          const n = countsByDay.get(d) || 0;
          return `<button class="day-chip ${d === selectedDate ? 'active' : ''} ${d === today ? 'today' : ''}" data-act="pick-day" data-date="${d}">
            <span class="wd">${d === today ? '今天' : WEEK[weekdayIndex(d)]}</span>
            <span class="dd">${Number(d.slice(8))}</span>
            <span class="cnt">${n ? `${n} 件` : '—'}</span>
          </button>`;
        }).join('')}
      </div>
    </div>

    <section class="block">
      <header class="block-head">
        <h3><span class="dot"></span>${monthDay(selectedDate)} ${WEEK[weekdayIndex(selectedDate)]}<span class="badge">${dayTasks.filter((t) => !t.done).length}</span></h3>
        <div class="spacer"></div>
        ${doneCount ? `<span style="font-size:11.5px;color:var(--ink-3)">已完成 ${doneCount} 件</span>` : ''}
      </header>

      <div class="add-row" style="margin-bottom:12px">
        <input type="text" id="boardInput" placeholder="为 ${monthDay(selectedDate)} 添加一件事，回车添加…" maxlength="120" />
        <button class="btn btn-primary btn-sm" data-act="add-board">添加</button>
      </div>

      <div class="list">
        ${dayTasks.length ? dayTasks.map((t) => taskRow(t, { done: t.done })).join('') : emptyHtml('🗓️', '这一天还没有安排。')}
      </div>
    </section>
  `;
}

/* ------------------------------------------------------------ 已完成 */

function doneView() {
  const done = state.tasks.filter((t) => t.done).sort((a, b) => String(b.doneAt).localeCompare(String(a.doneAt)));
  const groups = new Map();
  for (const task of done) {
    const key = task.date;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  }
  const keys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

  return `
    <div class="board-top">
      <div>
        <h2>已完成</h2>
        <p>累计完成 ${done.length} 件事。点圆圈可以撤销完成状态。</p>
      </div>
      <button class="btn btn-sm" data-act="clear-done">清空记录</button>
    </div>

    ${keys.length
      ? keys
          .map(
            (key) => `
        <section class="block">
          <header class="block-head">
            <h3><span class="dot"></span>${monthDay(key)} ${WEEK[weekdayIndex(key)]}<span class="badge">${groups.get(key).length}</span></h3>
          </header>
          <div class="list">${groups.get(key).map((t) => taskRow(t, { done: true, showDate: false })).join('')}</div>
        </section>`
          )
          .join('')
      : emptyHtml('🌱', '还没有完成记录，从今天的第一件小事开始吧。')}
  `;
}

/* ------------------------------------------------------------ 设置 */

function settingsView() {
  const w = state.settings.widget;
  const app = state.settings.app;
  const autoEnabled = autostartActual === null ? Boolean(app.autostart) : autostartActual;

  return `
    <div class="board-top">
      <div>
        <h2>设置</h2>
        <p>桌面组件的样子和行为都可以调整，修改后立刻生效。</p>
      </div>
    </div>

    <section class="settings-section">
      <h3>${t('set.lang')}</h3>
      <div class="rows">
        <div class="row">
          <div class="row-text"><b>${t('set.lang')}</b><span>${t('set.langHint')}</span></div>
          <select class="select" data-select="app-lang">
            ${(window.NookI18n ? window.NookI18n.langs : [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }])
              .map((lang) => `<option value="${lang.id}" ${(app.lang || 'zh') === lang.id ? 'selected' : ''}>${lang.label}</option>`)
              .join('')}
          </select>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h3>${t('set.content')}</h3>
      <div class="rows">
        ${switchRow('widget.showToday', w.showToday, '显示今天的计划', '组件里列出今天的待办')}
        ${switchRow('widget.showOverdue', w.showOverdue, '显示超期计划', '逾期未完成的事情会置顶提醒')}
        ${switchRow('widget.showDone', w.showDone, '显示已完成', '完成的事情也在组件里保留一会儿')}
        ${switchRow('widget.includeFuture', w.includeFuture, '显示未来计划', '把明天及以后的安排也列出来')}
        ${switchRow('widget.showProgress', w.showProgress, '显示完成进度', '顶部进度条与 x/y 计数')}
        ${switchRow('widget.showHint', w.showHint, '显示底部提示', '一行小字，告诉你怎样打开计划表')}
      </div>
    </section>

    <section class="settings-section">
      <h3>${t('set.look')}</h3>
      <div class="rows">
        ${rangeRow('widget.maxItems', w.maxItems, 2, 12, 1, '最多显示条数', '条数越多，组件越高')}
        ${rangeRow('widget.opacity', w.opacity, 0.45, 1, 0.02, '背景不透明度', '调低会更通透，0.45 起可读性更好', true)}
        ${rangeRow('widget.fontSize', w.fontSize, 12, 18, 1, '文字大小', '单位 px', false, 'px')}
        ${rangeRow('widget.width', w.width, 240, 720, 10, '组件宽度', '也可以直接拖动组件的边缘', false, 'px')}
        ${switchRow('widget.autoHeight', w.autoHeight, '高度自适应内容', '关闭后可以用鼠标拖组件右下角自由调整大小')}
        ${w.autoHeight ? '' : rangeRow('widget.height', w.height, 120, 900, 10, '组件高度', '拖右下角或用这里调整', false, 'px')}
        <div class="row">
          <div class="row-text"><b>主题色</b><span>${ACCENT_LABELS[w.accent] || '薄荷'}</span></div>
          <div class="accents">
            ${Object.keys(ACCENT_LABELS)
              .map(
                (key) =>
                  `<button class="swatch ${w.accent === key ? 'active' : ''}" data-act="accent" data-accent-choice="${key}" title="${ACCENT_LABELS[key]}"></button>`
              )
              .join('')}
          </div>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h3>${t('set.window')}</h3>
      <div class="rows">
        ${switchRow('widget.alwaysOnTop', w.alwaysOnTop, '显示在窗口最上层', '关掉后组件会留在桌面层，不再挡住其它窗口；也可以点组件标题栏的图钉或右键切换')}
        ${switchRow('app.autostart', autoEnabled, '开机自启动', '登录 Windows 后自动运行，只显示桌面组件')}
        <div class="row">
          <div class="row-text"><b>桌面组件</b><span>显示或隐藏，或者把它移回屏幕右上角</span></div>
          <button class="btn btn-sm" data-act="toggle-widget">${app.hideWidget ? '显示组件' : '隐藏组件'}</button>
          <button class="btn btn-sm" data-act="reset-widget">移回右上角</button>
        </div>
        <div class="row">
          <div class="row-text"><b>启动文件夹</b><span>开机自启动会在系统启动文件夹里放一个脚本，可在这里查看或手动删除</span></div>
          <button class="btn btn-sm" data-act="open-startup">打开</button>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h3>${t('set.remind')}</h3>
      <div class="rows">
        ${switchRow('notify.enabled', state.settings.notify.enabled, '到点提醒我', '任务设了时间后，开始前和到点时会发系统通知，桌面组件里也会浮一条')}
        ${rangeRow('notify.leadMinutes', state.settings.notify.leadMinutes, 0, 60, 5, '提前多久提醒', '0 表示只在开始时提醒（分钟）', false, ' 分')}
        ${switchRow('notify.atEnd', state.settings.notify.atEnd, '结束时也提醒', '方便知道这件事该收尾了')}
        ${switchRow('notify.sound', state.settings.notify.sound, '提醒时出声', '默认静音，只在通知中心出现')}
        <div class="row">
          <div class="row-text"><b>试一试</b><span>现在发一条通知，确认系统没把它拦掉</span></div>
          <button class="btn btn-sm" data-act="test-notify">发一条测试通知</button>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h3>${t('set.ai')} <span class="tag ${aiCfg && aiCfg.enabled ? 'on' : ''}">${aiCfg && aiCfg.enabled ? '已开启' : '未开启'}</span></h3>
      <p class="section-tip">开启后，识别、排计划、写小结、凭证检查会走你自己选的 AI 服务；关掉后一切照常可用（本地规则识别 + 系统 OCR）。Key 只存在本机，不会上传到别处。</p>
      <div class="rows">
        ${switchRow('ai.enabled', Boolean(aiCfg && aiCfg.enabled), '启用 AI 能力', '使用你自己的 API Key，费用由服务商结算')}
        <div class="row">
          <div class="row-text"><b>服务商</b><span>选好后会自动带出接口地址和模型名</span></div>
          <select class="select" data-select="ai-provider">
            ${(aiCfg ? aiCfg.order : ['deepseek']).map((key) => {
              const preset = aiCfg ? aiCfg.presets[key] : null;
              return `<option value="${key}" ${aiCfg && aiCfg.provider === key ? 'selected' : ''}>${escapeHtml(preset ? preset.label : key)}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="row">
          <div class="row-text"><b>接口地址</b><span>OpenAI 兼容的 Base URL</span></div>
          <input class="text-input" data-ai="baseUrl" value="${escapeAttr(aiCfg ? aiCfg.baseUrl : '')}" placeholder="https://api.deepseek.com" />
        </div>
        <div class="row">
          <div class="row-text"><b>文字模型</b><span>识别文字、排计划、写小结用它</span></div>
          <input class="text-input" data-ai="model" value="${escapeAttr(aiCfg ? aiCfg.model : '')}" placeholder="${escapeAttr(presetOf('model') || 'deepseek-flash')}" />
        </div>
        <div class="row">
          <div class="row-text"><b>视觉模型</b><span>识别截图、检查凭证用它；留空则图片走本地 OCR</span></div>
          <input class="text-input" data-ai="visionModel" value="${escapeAttr(aiCfg ? aiCfg.visionModel : '')}" placeholder="${escapeAttr(presetOf('visionModel') || 'deepseek-flash')}" />
        </div>
        <div class="row">
          <div class="row-text"><b>API Key</b><span>${aiCfg && aiCfg.hasKey ? `已保存 ${escapeHtml(aiCfg.keyMask)}` : '还没有填写'}</span></div>
          <input class="text-input" type="password" data-ai="apiKey" placeholder="${t('cfg.pasteKey')}" autocomplete="off" />
          <button class="btn btn-sm" data-act="ai-save">保存</button>
        </div>
        <div class="row">
          <div class="row-text"><b>连通性测试</b><span>发一句话试试，确认 Key 与地址可用</span></div>
          <button class="btn btn-sm" data-act="ai-test">测试一下</button>
        </div>
        ${aiWarnRow()}
        ${switchRow('app.requireProof', state.settings.app.requireProof, '默认需要凭证', '开启后，新建任务会默认要求交一张截图凭证')}
      </div>
    </section>

    <section class="settings-section">
      <h3>${t('set.data')}</h3>
      <div class="rows">
        <div class="row">
          <div class="row-text">
            <b>数据文件</b>
            <span class="path-text">${escapeHtml(state.storeFile || '')}</span>
          </div>
          <button class="btn btn-sm" data-act="open-data">打开文件夹</button>
        </div>
        <div class="row">
          <div class="row-text"><b>清空已完成</b><span>只删除已完成记录，未完成的任务保留</span></div>
          <button class="btn btn-sm" data-act="clear-done">清空</button>
        </div>
        <div class="row">
          <div class="row-text"><b>退出程序</b><span>退出后桌面组件与托盘图标都会关闭</span></div>
          <button class="btn btn-sm" data-act="quit">退出</button>
        </div>
      </div>
    </section>

    <p class="about">${t('cfg.about')}</p>
  `;
}

function switchRow(path, value, title, desc) {
  return `
    <div class="row">
      <div class="row-text"><b>${escapeHtml(title)}</b><span>${escapeHtml(desc)}</span></div>
      <button class="switch ${value ? 'on' : ''}" data-act="toggle-switch" data-switch="${path}" aria-label="${escapeHtml(title)}"></button>
    </div>`;
}

function rangeRow(path, value, min, max, step, title, desc, decimal = false, unit = '') {
  const display = decimal ? Number(value).toFixed(2) : String(Math.round(Number(value)));
  return `
    <div class="row">
      <div class="row-text"><b>${escapeHtml(title)}</b><span>${escapeHtml(desc)}</span></div>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-range="${path}" />
      <span class="row-value" data-val-for="${path}">${display}${unit}</span>
    </div>`;
}

/* ------------------------------------------------------------ 任务行 */

function taskRow(task, opts = {}) {
  const isEditing = editingId === task.id;
  const subParts = [];
  if (opts.showDate) subParts.push(`${monthDay(task.date)} ${task.weekday}`);
  if (task.overdue) subParts.push(`<span class="warm">逾期 ${task.overdueDays} 天</span>`);
  if (task.done && task.doneAt) subParts.push(t('act.doneAt', { time: timeLabel(task.doneAt) }));

  const linkChip =
    !isEditing && task.link
      ? `<button class="link-chip" data-act="open-link" data-id="${task.id}" title="打开：${escapeAttr(task.link)}">
           <span class="ico">↗</span><span class="label">${escapeHtml(task.linkLabel || '打开')}</span>
         </button>`
      : '';

  const timeChip = !isEditing && !opts.done
    ? `<button class="time-chip ${task.timeText ? 'has' : ''}" data-act="time" data-id="${task.id}" title="设置开始/结束时间，到点提醒">
         <span class="ico">⏱</span>${task.timeText ? escapeHtml(task.timeText) : '时间'}
       </button>`
    : (task.timeText ? `<span class="time-chip has static">⏱ ${escapeHtml(task.timeText)}</span>` : '');

  const goalChip = task.parentTitle && !opts.hideGoal
    ? `<button class="goal-chip" data-act="open-goal" data-goal="${task.parentId}" title="来自长期计划：${escapeAttr(task.parentTitle)}">🎯 ${escapeHtml(truncate(task.parentTitle, 8))}</button>`
    : '';

  return `
    <div class="task ${opts.done ? 'is-done' : ''}" data-id="${task.id}">
      <button class="check ${opts.done ? 'done' : ''}" data-act="${opts.done ? 'undo' : 'complete'}" data-id="${task.id}" aria-label="完成"></button>
      <div class="task-main">
        <div class="task-title-row">
          ${isEditing
            ? `<input class="edit-input" data-edit-input="${task.id}" value="${escapeAttr(task.title)}" maxlength="120" />`
            : `<div class="task-title" data-act="edit" data-id="${task.id}">${escapeHtml(task.title)}</div>`}
          ${timeChip}
          ${goalChip}
          ${linkChip}
        </div>
        ${subParts.length && !isEditing ? `<div class="task-sub">${subParts.join('<span style="opacity:.4">·</span>')}</div>` : ''}
        ${task.note && !isEditing ? `<div class="task-note">${escapeHtml(task.note)}</div>` : ''}
      </div>
      <div class="task-actions">
        ${!task.done ? `<button class="act ok" data-act="complete" data-id="${task.id}">✓ ${t('act.done')}</button>` : ''}
        ${task.overdue && !task.done ? `<button class="act" data-act="postpone" data-id="${task.id}">${t('act.postponeOne')}</button>` : ''}
        ${!task.done && task.date !== state.today ? `<button class="act" data-act="move-today" data-id="${task.id}">${t('act.moveToday')}</button>` : ''}
        <button class="act" data-act="edit-link" data-id="${task.id}">${task.link ? t('act.link') : t('add.link')}</button>
        ${task.needsCheck ? '<button class="act" data-act="toggle-proof" data-id="' + task.id + '">凭证 ✓</button>' : ''}
        <button class="act danger" data-act="delete" data-id="${task.id}">${t('act.del')}</button>
      </div>
    </div>`;
}

function emptyHtml(emoji, text) {
  return `<div class="empty"><span class="emoji">${emoji}</span><p>${escapeHtml(text)}</p></div>`;
}

/* ------------------------------------------------------------ 交互 */

function onViewClick(event) {
  const target = event.target.closest('[data-act]');
  if (!target) return;
  const act = target.dataset.act;
  const id = target.dataset.id;

  switch (act) {
    case 'add':
      submitAdd();
      break;
    case 'attach':
      openLinkModal(null);
      break;
    case 'recognize':
      openRecognizeInput();
      break;
    case 'edit-link':
      openLinkModal(id);
      break;
    case 'open-link':
      openTaskLink(id);
      break;
    case 'time':
      openTimeModal(id, false);
      break;
    case 'time-new':
      openTimeModal(null, true);
      break;
    case 'open-goal':
      navigate('goals');
      break;
    case 'toggle-proof':
      api.updateTask(id, { needsCheck: !state.tasks.find((t) => t.id === id)?.needsCheck }).then((next) => {
        state = next;
        render();
        toast('已切换凭证要求');
      });
      break;
    case 'ai-plan':
      openAiPlanModal();
      break;
    case 'summary':
      openSummary(false);
      break;
    case 'import-file':
      importFile();
      break;
    case 'test-notify':
      api.testNotify().then((res) => toast(res && res.ok ? '已发出测试通知' : '系统通知没能发出'));
      break;
    case 'ai-save':
      saveAiKey();
      break;
    case 'ai-test':
      testAi();
      break;
    case 'ai-fix':
      fixAiModels();
      break;
    case 'goal-new':
      openGoalModal(null);
      break;
    case 'goal-edit':
      openGoalModal(id);
      break;
    case 'goal-del':
      deleteGoal(id);
      break;
    case 'goal-ai':
      goalBreakdown(id);
      break;
    case 'add-board':
      submitBoardAdd();
      break;
    case 'complete':
      completeTask(id, target.closest('.task'));
      break;
    case 'undo':
      undoTask(id);
      break;
    case 'delete':
      deleteTask(id);
      break;
    case 'edit':
      editingId = id;
      render();
      break;
    case 'postpone':
      api.moveToday(id).then((next) => {
        state = next;
        render();
        toast('已顺延到今天');
      });
      break;
    case 'move-today':
      api.moveToday(id).then((next) => {
        state = next;
        render();
        toast('已挪到今天');
      });
      break;
    case 'postpone-all':
      api.postponeAll().then((res) => {
        state = res.state;
        render();
        toast(`已顺延 ${res.count} 件事到今天`, 'good');
      });
      break;
    case 'clear-done':
      if (!window.confirm('确定要清空所有已完成记录吗？这个操作不可撤销。')) return;
      api.clearCompleted().then((res) => {
        state = res.state;
        render();
        toast(`已清理 ${res.removed} 条记录`);
      });
      break;
    case 'pick-day':
      selectedDate = target.dataset.date;
      render();
      break;
    case 'week-prev':
      weekOffset -= 1;
      selectedDate = dateAdd(state.today, weekOffset * 7);
      render();
      break;
    case 'week-next':
      weekOffset += 1;
      selectedDate = dateAdd(state.today, weekOffset * 7);
      render();
      break;
    case 'week-today':
      weekOffset = 0;
      selectedDate = state.today;
      render();
      break;
    case 'toggle-switch':
      toggleSwitch(target.dataset.switch, target.classList.contains('on'));
      break;
    case 'accent':
      api.updateSettings({ widget: { accent: target.dataset.accentChoice } }).then((res) => {
        state = res.state;
        render();
      });
      break;
    case 'toggle-widget':
      if (state.settings.app.hideWidget) api.showWidget().then(() => toast('桌面组件已显示'));
      else api.hideWidget().then(() => toast('桌面组件已隐藏'));
      break;
    case 'reset-widget':
      api.resetWidgetPosition().then(() => toast('组件已移回右上角'));
      break;
    case 'open-data':
      api.openDataFolder();
      break;
    case 'open-startup':
      api.openStartupFolder();
      break;
    case 'quit':
      api.quit();
      break;
    default:
      break;
  }
}

function onViewKeyDown(event) {
  const editInput = event.target.closest('[data-edit-input]');
  if (editInput) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitEdit(editInput.dataset.editInput, editInput.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      editingId = null;
      render();
    }
    return;
  }

  if (event.key === 'Enter' && event.target.id === 'addInput') {
    event.preventDefault();
    submitAdd();
  }
  if (event.key === 'Enter' && event.target.id === 'boardInput') {
    event.preventDefault();
    submitBoardAdd();
  }
  const goalInput = event.target.closest('[data-goal-input]');
  if (goalInput && event.key === 'Enter') {
    event.preventDefault();
    const title = goalInput.value.trim();
    if (title) addTaskToGoal(goalInput.dataset.goalInput, title);
  }
}

function onViewInput(event) {
  const range = event.target.closest('[data-range]');
  if (range) {
    const path = range.dataset.range;
    const decimal = path === 'widget.opacity';
    const value = decimal ? Number(Number(range.value).toFixed(2)) : Number(range.value);
    const label = els.view.querySelector(`[data-val-for="${path}"]`);
    if (label) {
      const unit = path === 'widget.fontSize' || path === 'widget.width' ? 'px' : '';
      label.textContent = `${decimal ? value.toFixed(2) : value}${unit}`;
    }
    clearTimeout(rangeTimer);
    rangeTimer = setTimeout(() => applyRange(path, value), 90);
  }
}

function onViewChange(event) {
  const editInput = event.target.closest('[data-edit-input]');
  if (editInput) {
    commitEdit(editInput.dataset.editInput, editInput.value);
    return;
  }

  const aiField = event.target.closest('[data-ai]');
  if (aiField) {
    const key = aiField.dataset.ai;
    if (key === 'apiKey') return; // Key 由「保存」按钮提交
    saveAiField(key, aiField.value.trim());
    return;
  }

  const langSelect = event.target.closest('[data-select="app-lang"]');
  if (langSelect) {
    const lang = langSelect.value === 'en' ? 'en' : 'zh';
    api.updateSettings({ app: { lang } }).then((next) => {
      state = next;
      applyLanguage(lang);
      render();
      toast(lang === 'en' ? 'Language: English' : '界面语言：中文');
    });
    return;
  }

  const providerSelect = event.target.closest('[data-select="ai-provider"]');
  if (providerSelect) {
    const provider = providerSelect.value;
    const preset = aiCfg && aiCfg.presets ? aiCfg.presets[provider] : null;
    const patch = { provider };
    if (preset) {
      patch.baseUrl = preset.baseUrl;
      patch.model = preset.model;
      patch.visionModel = preset.visionModel;
    }
    api.saveAiConfig(patch).then((cfg) => {
      aiCfg = cfg;
      render();
      toast(`已切到 ${preset ? preset.label : provider}，记得填 Key`);
    });
  }
}

/* ------------------------------------------------------------ 任务操作 */

async function submitAdd() {
  const input = document.getElementById('addInput');
  const dateInput = document.getElementById('addDate');
  if (!input) return;
  const title = input.value.trim();
  if (!title) return;
  const date = dateInput?.value || state.today;
  const next = await api.addTask({
    title,
    date,
    link: pendingLink,
    start: pendingTime.start,
    end: pendingTime.end,
    needsCheck: Boolean(state.settings.app.requireProof)
  });
  state = next;
  pendingLink = '';
  pendingTime = { start: '', end: '' };
  render();
  toast('已添加');
  setTimeout(() => document.getElementById('addInput')?.focus(), 40);
}

async function openTaskLink(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (!task || !task.link) {
    toast('这个任务还没有链接');
    return;
  }
  const result = await api.openTarget(id);
  if (!result || !result.ok) {
    toast(result?.error ? `打不开：${result.error}` : '打不开这个链接');
    return;
  }
  toast(`已打开「${task.linkLabel || '链接'}」`);
}

function shortLinkLabel(link) {
  if (!link) return '';
  try {
    if (/^https?:\/\//i.test(link)) return new URL(link).hostname.replace(/^www\./i, '');
    const clean = link.replace(/^file:\/+/i, '').replace(/\//g, '\\');
    const parts = clean.split('\\').filter(Boolean);
    return parts[parts.length - 1] || link;
  } catch {
    return link;
  }
}

async function submitBoardAdd() {
  const input = document.getElementById('boardInput');
  if (!input) return;
  const title = input.value.trim();
  if (!title) return;
  const next = await api.addTask({ title, date: selectedDate });
  state = next;
  render();
  toast(`已添加到 ${monthDay(selectedDate)}`);
  setTimeout(() => document.getElementById('boardInput')?.focus(), 40);
}

async function completeTask(id, row) {
  if (Date.now() < freezeUntil) return;
  const task = state.tasks.find((t) => t.id === id);
  // 需要凭证的任务，先让 AI 看一眼再打勾
  if (task && task.needsCheck && aiReady(true)) {
    openProof(id);
    return;
  }
  await completeNow(id, row);
}

async function completeNow(id, row) {
  if (Date.now() < freezeUntil) return;
  const target = row || document.querySelector(`.task[data-id="${id}"]`);
  freezeUntil = Date.now() + 700;

  const check = target?.querySelector('.check');
  target?.classList.add('animating');
  check?.classList.add('done');

  try {
    const res = await api.toggleTask(id, true);
    if (res?.state) queuedState = res.state;
    setTimeout(() => {
      finishAnimation();
      toast(CHEERS[Math.floor(Math.random() * CHEERS.length)], 'good');
    }, 660);
  } catch (err) {
    console.error(err);
    finishAnimation();
  }
}

function finishAnimation() {
  freezeUntil = 0;
  if (queuedState) {
    state = queuedState;
    queuedState = null;
  }
  render();
}

async function undoTask(id) {
  const res = await api.toggleTask(id, false);
  if (res?.state) {
    state = res.state;
    render();
    toast('已撤销完成');
  }
}

async function deleteTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  const next = await api.deleteTask(id);
  state = next;
  render();
  toast(task ? `已删除「${truncate(task.title, 10)}」` : '已删除');
}

async function commitEdit(id, value) {
  const title = String(value || '').trim();
  editingId = null;
  if (!title) {
    render();
    return;
  }
  const res = await api.updateTask(id, { title });
  state = res;
  render();
}

function toggleSwitch(path, current) {
  const next = !current;
  if (path === 'app.autostart') {
    api.setAutostart(next).then((res) => {
      state = res.state;
      autostartActual = Boolean(res.autostart);
      render();
      if (!res.ok) {
        toast('写入启动文件夹失败，可点「打开」手动放置');
        return;
      }
      toast(next ? '已开启开机自启动' : '已关闭开机自启动');
    });
    return;
  }
  applySetting(path, next);
}

function applySetting(path, value) {
  const patch = pathToPatch(path, value);
  api.updateSettings(patch).then((res) => {
    state = res.state;
    render();
  });
}

function applyRange(path, value) {
  const patch = pathToPatch(path, value);
  api.updateSettings(patch).then((res) => {
    state = res.state;
    // 不重渲染，避免拖动滑块时页面跳动
    document.body.dataset.accent = res.state.settings.widget.accent || 'mint';
  });
}

function pathToPatch(path, value) {
  const [group, key] = path.split('.');
  return { [group]: { [key]: value } };
}

/* ------------------------------------------------------------ 工具 */

function byOrder(a, b) {
  return (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt));
}

function dateAdd(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function weekdayIndex(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function monthDay(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${m}月${d}日`;
}

const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function monthDayEn(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${MONTH_EN[m - 1]} ${d}, ${y}`;
}

function weekdayEn(label) {
  const index = WEEK.indexOf(label);
  return index >= 0 ? WEEKDAY_EN[index] : label;
}

function timeLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function greeting() {
  const hour = new Date().getHours();
  const en = state && state.settings.app.lang === 'en';
  if (hour < 5) return en ? 'Late night' : '夜深了';
  if (hour < 9) return en ? 'Good morning' : '早上好';
  if (hour < 12) return en ? 'Morning' : '上午好';
  if (hour < 14) return en ? 'Noon' : '中午好';
  if (hour < 18) return en ? 'Afternoon' : '下午好';
  if (hour < 22) return en ? 'Evening' : '晚上好';
  return en ? 'Late night' : '夜深了';
}

function truncate(text, len) {
  return text.length > len ? `${text.slice(0, len)}…` : text;
}

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  els.toastWrap.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function escapeAttr(text) {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------ AI 状态 */

function refreshAiConfig() {
  api.getAiConfig()
    .then((cfg) => {
      aiCfg = cfg;
      if (tab === 'settings') render();
    })
    .catch(() => {});
}

function aiReady(needVision = false) {
  if (!aiCfg || !aiCfg.enabled) return false;
  if (!aiCfg.hasKey) return false;
  if (needVision && !aiCfg.visionModel) return false;
  return true;
}

/* ------------------------------------------------------------ 时间段 */

function bindTimeModal() {
  const mask = document.getElementById('timeModal');
  document.getElementById('timeCancel').addEventListener('click', closeTimeModal);
  document.getElementById('timeSave').addEventListener('click', saveTimeModal);
  document.getElementById('timeClear').addEventListener('click', () => {
    document.getElementById('timeStart').value = '';
    document.getElementById('timeEnd').value = '';
    saveTimeModal();
  });
  mask.addEventListener('mousedown', (event) => {
    if (event.target === mask) closeTimeModal();
  });
}

function openTimeModal(taskId, forNew = false) {
  timeTaskId = taskId || null;
  timeForNew = Boolean(forNew);
  const task = taskId ? state.tasks.find((t) => t.id === taskId) : null;
  document.getElementById('timeStart').value = task ? task.start || '' : pendingTime.start || '';
  document.getElementById('timeEnd').value = task ? task.end || '' : pendingTime.end || '';
  document.getElementById('timeSub').textContent = task
    ? `「${truncate(task.title, 16)}」开始前和到点时会提醒你。`
    : '给这条新任务安排时间，到点会提醒你。';
  document.getElementById('timeModal').hidden = false;
  setTimeout(() => document.getElementById('timeStart')?.focus(), 40);
}

function closeTimeModal() {
  document.getElementById('timeModal').hidden = true;
  timeTaskId = null;
  timeForNew = false;
}

async function saveTimeModal() {
  const start = document.getElementById('timeStart').value || '';
  const end = document.getElementById('timeEnd').value || '';
  if (start && end && end <= start) {
    toast('结束时间要晚于开始时间');
    return;
  }
  if (timeForNew) {
    pendingTime = { start, end };
    closeTimeModal();
    render();
    toast(start ? '时间已设好' : '已取消时间');
    return;
  }
  const next = await api.updateTask(timeTaskId, { start, end });
  state = next;
  closeTimeModal();
  render();
  toast(start ? '时间已保存，到点提醒你' : '已取消时间');
}

/* ------------------------------------------------------------ 长期计划 */

function bindGoalModal() {
  const mask = document.getElementById('goalModal');
  document.getElementById('goalCancel').addEventListener('click', closeGoalModal);
  document.getElementById('goalSave').addEventListener('click', saveGoalModal);
  mask.addEventListener('mousedown', (event) => {
    if (event.target === mask) closeGoalModal();
  });
}

function openGoalModal(goalId) {
  goalEditingId = goalId || null;
  const goal = goalId ? state.goals.find((g) => g.id === goalId) : null;
  const today = state.today;
  document.getElementById('goalTitle').textContent = goal ? '编辑长期计划' : '新建长期计划';
  document.getElementById('goalName').value = goal ? goal.title : '';
  document.getElementById('goalStart').value = goal ? goal.startDate : today;
  document.getElementById('goalEnd').value = goal ? goal.endDate : dateAdd(today, 30);
  document.getElementById('goalNote').value = goal ? goal.note : '';
  document.getElementById('goalModal').hidden = false;
  setTimeout(() => document.getElementById('goalName')?.focus(), 40);
}

function closeGoalModal() {
  document.getElementById('goalModal').hidden = true;
  goalEditingId = null;
}

async function saveGoalModal() {
  const title = document.getElementById('goalName').value.trim();
  if (!title) {
    toast('给这个目标起个名字吧');
    return;
  }
  const payload = {
    title,
    startDate: document.getElementById('goalStart').value,
    endDate: document.getElementById('goalEnd').value,
    note: document.getElementById('goalNote').value.trim()
  };
  const next = goalEditingId
    ? await api.updateGoal(goalEditingId, payload)
    : await api.addGoal(payload);
  state = next;
  closeGoalModal();
  render();
  toast(goalEditingId ? '目标已更新' : '目标已创建');
}

async function deleteGoal(id) {
  const goal = state.goals.find((g) => g.id === id);
  if (!goal) return;
  if (!window.confirm(`删除目标「${goal.title}」？已经挂上去的任务会保留，只是不再属于这个目标。`)) return;
  state = await api.deleteGoal(id);
  render();
  toast('目标已删除');
}

async function addTaskToGoal(goalId, title) {
  const next = await api.addTask({ title, date: state.today, parentId: goalId });
  state = next;
  render();
  toast('已加到目标里');
}

async function goalBreakdown(goalId) {
  const goal = state.goals.find((g) => g.id === goalId);
  if (!goal) return;
  if (!aiReady()) {
    toast('先在「设置 → AI 助手」里开启并填好 Key');
    navigate('settings');
    return;
  }
  toast('AI 正在拆解这个目标…');
  // 长期目标用「拆解」提示词（按起止日期均匀铺开），周期很短时退回按天排的计划
  const res = goal.daysLeft > 3
    ? await api.aiBreakdown({
        goal: goal.note ? `${goal.title}（${goal.note}）` : goal.title,
        startDate: goal.startDate,
        endDate: goal.endDate,
        timesPerWeek: 3
      })
    : await api.aiPlan({
        goal: `${goal.title}（${goal.startDate} 到 ${goal.endDate}）`,
        days: Math.max(1, Math.min(30, goal.daysLeft > 0 ? goal.daysLeft : 3)),
        minutes: 60
      });
  if (!res || !res.ok) {
    toast(res?.error || 'AI 没给出结果');
    return;
  }
  const items = (res.items || []).map((item) => ({ ...item, parentId: goal.id }));
  if (!items.length) {
    toast('AI 没有给出可用的任务');
    return;
  }
  openRecognizeItems(items, 'ai-plan', goal.id);
}

/* ------------------------------------------------------------ 识别（含 AI） */

function openRecognizeItems(items, source = 'local', parentId = null) {
  if (!items || !items.length) {
    toast('没从里面认出待办事项');
    return;
  }
  rcItems = items.map((item) => ({ ...item, parentId: item.parentId || parentId }));
  const subMap = {
    'ai-image': 'AI 从图片里读出这些事，日期已按今天往后顺好，确认前可以改。',
    'ai-text': 'AI 从这段文字里整理出这些事，确认前可以改。',
    'ai-plan': 'AI 排好了这些任务，可以删掉不需要的、改日期或时间，然后一起加进去。',
    file: '从文件里读出这些事，确认后加入计划表。',
    ocr: '内容来自图片识别，可能有个别错字，确认前可以直接改。',
    local: '内容来自你粘贴的文字，确认后一起加进计划表。'
  };
  document.getElementById('rcSub').textContent = subMap[source] || '确认一下，不需要的可以删掉。';
  document.getElementById('rcSource').textContent = source.startsWith('ai') ? '✨ AI 整理' : '本地识别';
  const head = document.querySelector('#recognizeModal h3');
  if (head) {
    head.innerHTML = source === 'ai-plan'
      ? 'AI 拆出 <b id="rcCount">0</b> 条任务'
      : '识别到 <b id="rcCount">0</b> 条待办';
  }
  renderRecognizeRows();
  document.getElementById('recognizeModal').hidden = false;
  setTimeout(() => document.querySelector('#rcList .rc-title')?.focus(), 40);
}

/* ------------------------------------------------------------ AI 排计划 */

function bindAiPlanModal() {
  const mask = document.getElementById('aiPlanModal');
  document.getElementById('planCancel').addEventListener('click', () => {
    document.getElementById('aiPlanModal').hidden = true;
  });
  document.getElementById('planRun').addEventListener('click', runAiPlan);
  mask.addEventListener('mousedown', (event) => {
    if (event.target === mask) mask.hidden = true;
  });
}

function openAiPlanModal() {
  if (!aiReady()) {
    toast('先在「设置 → AI 助手」里开启并填好 Key');
    navigate('settings');
    return;
  }
  document.getElementById('planNote').textContent = aiCfg ? `用 ${aiCfg.model}` : '';
  document.getElementById('aiPlanModal').hidden = false;
  setTimeout(() => document.getElementById('planGoal')?.focus(), 40);
}

async function runAiPlan() {
  if (planBusy) return;
  const goal = document.getElementById('planGoal').value.trim();
  if (!goal) {
    toast('先写一句你想要的结果');
    return;
  }
  planBusy = true;
  const btn = document.getElementById('planRun');
  btn.textContent = '生成中…';
  document.getElementById('planNote').textContent = '正在请求 AI，通常几秒钟…';
  const res = await api.aiPlan({
    goal,
    days: Number(document.getElementById('planDays').value) || 7,
    minutes: Number(document.getElementById('planMinutes').value) || 60
  });
  planBusy = false;
  btn.textContent = '生成';
  document.getElementById('planNote').textContent = '';
  if (!res || !res.ok) {
    toast(res?.error || 'AI 没有返回结果');
    return;
  }
  if (!res.items || !res.items.length) {
    toast('AI 没有拆出任务，换个说法再试试');
    return;
  }
  document.getElementById('aiPlanModal').hidden = true;
  openRecognizeItems(res.items, 'ai-plan');
}

/* ------------------------------------------------------------ 今日小结 */

function bindSummaryModal() {
  const mask = document.getElementById('summaryModal');
  document.getElementById('summaryClose').addEventListener('click', () => {
    mask.hidden = true;
  });
  document.getElementById('summaryCopy').addEventListener('click', () => {
    if (!summaryEntry) return;
    api.writeClipboard(`【${monthDay(summaryEntry.date)}小结】\n${summaryEntry.summary}\n${summaryEntry.tips || ''}`.trim());
    toast('已复制到剪贴板');
  });
  document.getElementById('summaryRun').addEventListener('click', () => openSummary(true));
  mask.addEventListener('mousedown', (event) => {
    if (event.target === mask) mask.hidden = true;
  });
}

async function openSummary(force = false) {
  const mask = document.getElementById('summaryModal');
  const body = document.getElementById('summaryBody');
  const today = (state.summaries || []).find((s) => s.date === state.today && s.kind === 'auto');
  if (today && !force) {
    summaryEntry = today;
    body.innerHTML = `<p class="sum-text">${escapeHtml(today.summary)}</p>${today.tips ? `<p class="sum-tip">💡 ${escapeHtml(today.tips)}</p>` : ''}`;
    document.getElementById('summaryNote').textContent = `${monthDay(today.date)} · 已保存在本地`;
    mask.hidden = false;
    return;
  }
  if (!aiReady()) {
    toast('先在「设置 → AI 助手」里开启并填好 Key');
    navigate('settings');
    return;
  }
  if (summaryBusy) return;
  summaryBusy = true;
  document.getElementById('summaryTitle').textContent = '今日小结';
  document.getElementById('summaryNote').textContent = 'AI 正在写…';
  body.innerHTML = '<p class="sum-loading">正在根据今天的完成情况写一段小结…</p>';
  mask.hidden = false;
  const res = await api.aiSummary({ date: state.today });
  summaryBusy = false;
  if (!res || !res.ok) {
    document.getElementById('summaryNote').textContent = '';
    body.innerHTML = `<p class="sum-error">没生成出来：${escapeHtml(res?.error || '未知错误')}</p>`;
    return;
  }
  if (res.state) state = res.state;
  summaryEntry = res.entry || null;
  document.getElementById('summaryNote').textContent = '已保存在本地';
  body.innerHTML = `<p class="sum-text">${escapeHtml(res.summary)}</p>${res.tips ? `<p class="sum-tip">💡 ${escapeHtml(res.tips)}</p>` : ''}`;
}

/* ------------------------------------------------------------ 凭证 / 验收 */

function bindProofModal() {
  const mask = document.getElementById('proofModal');
  document.getElementById('proofCancel').addEventListener('click', closeProof);
  document.getElementById('proofSkip').addEventListener('click', async () => {
    const id = proofTaskId;
    closeProof();
    await completeNow(id);
  });
  document.getElementById('proofPick').addEventListener('click', async () => {
    const picked = await api.pickFile('image');
    if (!picked) return;
    const res = await api.fileImageData(picked);
    if (res && res.ok) setProofImage(res.dataUrl);
    else toast(res?.error || '读不到这张图');
  });
  document.getElementById('proofCheck').addEventListener('click', runProofCheck);
  mask.addEventListener('mousedown', (event) => {
    if (event.target === mask) closeProof();
  });
  document.getElementById('proofDrop').addEventListener('click', () => document.getElementById('proofPick').click());
  document.addEventListener('paste', (event) => {
    if (mask.hidden) return;
    const item = [...(event.clipboardData?.items || [])].find((it) => it.kind === 'file' && it.type.startsWith('image/'));
    if (!item) return;
    event.preventDefault();
    const file = item.getAsFile();
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setProofImage(String(reader.result || ''));
      reader.readAsDataURL(file);
    }
  });
}

function openProof(taskId) {
  proofTaskId = taskId;
  proofDataUrl = '';
  document.getElementById('proofResult').hidden = true;
  document.getElementById('proofPreview').hidden = true;
  document.getElementById('proofPreview').removeAttribute('src');
  document.getElementById('proofHint').hidden = false;
  document.getElementById('proofNote').textContent = '';
  const task = state.tasks.find((t) => t.id === taskId);
  document.getElementById('proofSub').textContent = task
    ? `「${truncate(task.title, 18)}」要交一张截图作为凭证，AI 确认后自动打勾。`
    : '交一张截图作为凭证。';
  document.getElementById('proofModal').hidden = false;
}

function closeProof() {
  document.getElementById('proofModal').hidden = true;
  proofTaskId = null;
  proofDataUrl = '';
}

function setProofImage(dataUrl) {
  proofDataUrl = dataUrl;
  const img = document.getElementById('proofPreview');
  img.src = dataUrl;
  img.hidden = false;
  document.getElementById('proofHint').hidden = true;
  document.getElementById('proofResult').hidden = true;
}

async function runProofCheck() {
  if (!proofDataUrl) {
    toast('先选一张截图或直接粘贴截图');
    return;
  }
  if (!aiReady(true)) {
    toast('凭证检查需要 AI 视觉模型，先去设置里配置');
    return;
  }
  document.getElementById('proofCheck').textContent = '检查中…';
  const res = await api.aiCheckProof({ taskId: proofTaskId, imageDataUrl: proofDataUrl });
  document.getElementById('proofCheck').textContent = 'AI 检查';
  const box = document.getElementById('proofResult');
  box.hidden = false;
  if (!res || !res.ok) {
    box.className = 'proof-result bad';
    box.textContent = res?.error || '检查失败';
    return;
  }
  if (res.pass) {
    box.className = 'proof-result good';
    box.textContent = `看起来对得上：${res.reason || '已完成'}`;
    const id = proofTaskId;
    setTimeout(async () => {
      closeProof();
      await completeNow(id);
    }, 700);
  } else {
    box.className = 'proof-result bad';
    box.textContent = `不太像完成凭证：${res.reason || '看不清内容'}。可以换一张，或点「直接完成」。`;
  }
}

/* ------------------------------------------------------------ 拖入文件 */

function bindDropZone() {
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.innerHTML = '<div><b>松手就识别</b><span>图片走识别，txt/md 文本直接拆成任务</span></div>';
  document.body.appendChild(overlay);
  let depth = 0;
  const show = (on) => overlay.classList.toggle('show', on);

  window.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    depth += 1;
    show(true);
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) show(false);
  });
  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
  });
  window.addEventListener('drop', async (event) => {
    const files = [...(event.dataTransfer?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    depth = 0;
    show(false);
    await handleFiles(files);
  });
}

async function handleFiles(files) {
  const file = files[0];
  if (file.type.startsWith('image/')) {
    const dataUrl = await readFileAsDataUrl(file);
    if (dataUrl) await recognizeFromDataUrl(dataUrl);
    return;
  }
  if (/\.(txt|md|json|csv|log)$/i.test(file.name) || file.type.startsWith('text/')) {
    const text = await file.text();
    openRecognize({ text });
    return;
  }
  toast('支持拖图片，或 txt / md / json 文本文件');
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

async function importFile() {
  const picked = await api.pickFile('text');
  if (!picked) return;
  const res = await api.readTextFile(picked);
  if (!res || !res.ok) {
    // 也可能是图片
    const img = await api.fileImageData(picked);
    if (img && img.ok) {
      await recognizeFromDataUrl(img.dataUrl);
      return;
    }
    toast(res?.error || '读不到这个文件');
    return;
  }
  openRecognize({ text: res.text });
}

/* ------------------------------------------------------------ 目标视图 */

function goalsView() {
  const goals = state.goals || [];
  const loose = state.tasks.filter((t) => !t.parentId && !t.done).length;
  return `
    <div class="board-top">
      <div>
        <h2>${t('goals.title')}</h2>
        <p>把零散任务挂到一个目标上，进度自动算。${loose ? `现在还有 ${loose} 件待办没挂目标。` : ''}</p>
      </div>
      <button class="btn btn-sm btn-primary" data-act="goal-new">${t('goals.new')}</button>
    </div>
    ${goals.length ? goals.map(goalCard).join('') : emptyHtml('🎯', '还没有长期计划。想一个三个月内想要的改变，先写下来。')}
  `;
}

function goalCard(goal) {
  const pct = Math.round(goal.progress * 100);
  const children = goal.children || [];
  const pending = children.filter((t) => !t.done);
  const doneCount = children.length - pending.length;
  return `
    <section class="goal-card">
      <header class="goal-head">
        <div class="goal-title">
          <b>${escapeHtml(goal.title)}</b>
          <span>${monthDay(goal.startDate)} – ${monthDay(goal.endDate)} · ${
            goal.ended ? '<span class="warm">已到期</span>' : goal.daysLeft === 0 ? '今天截止' : `还剩 ${goal.daysLeft} 天`
          }</span>
        </div>
        <div class="goal-side">
          <span class="goal-pct">${pct}%</span>
          <button class="icon-btn" data-act="goal-edit" data-id="${goal.id}" title="编辑">✎</button>
          <button class="icon-btn" data-act="goal-del" data-id="${goal.id}" title="删除">✕</button>
        </div>
      </header>
      <div class="goal-bar"><i style="width:${pct}%"></i></div>
      ${goal.note ? `<p class="goal-note">${escapeHtml(goal.note)}</p>` : ''}
      <div class="goal-tools">
        <input class="goal-add-input" data-goal-input="${goal.id}" placeholder="${t('goals.addPlaceholder')}" maxlength="120" />
        <button class="btn btn-sm" data-act="goal-ai" data-id="${goal.id}" title="AI 把这个目标拆成具体任务">✨ ${t('goals.break')}</button>
      </div>
      <div class="goal-list">
        ${pending.length
          ? pending.map((t) => taskRow(t, { showDate: true, hideGoal: true })).join('')
          : children.length
            ? `<p class="goal-done-all">这个目标下的 ${doneCount} 件事都完成了 🎉</p>`
            : '<p class="goal-empty">还没有挂任务，先在下面加一件小事。</p>'}
      </div>
      ${doneCount ? `<p class="goal-foot">${t('goals.doneCount', { done: doneCount, total: children.length })}</p>` : ''}
    </section>`;
}

/* ------------------------------------------------------------ AI 设置交互 */

async function fixAiModels() {
  if (!aiCfg || !aiCfg.presets) return;
  const preset = aiCfg.presets[aiCfg.provider] || {};
  aiCfg = await api.saveAiConfig({
    model: preset.model || aiCfg.model,
    visionModel: preset.visionModel || aiCfg.visionModel
  });
  render();
  toast('模型名已按服务商改好，记得点「测试一下」', 'good');
}

async function saveAiField(key, value) {
  aiCfg = await api.saveAiConfig({ [key]: value });
  if (tab === 'settings') render();
  if (key === 'model' || key === 'visionModel') {
    const warn = modelMismatch(key, value);
    if (warn) toast(warn);
  }
}

// 视觉/文字模型名明显属于别家服务商时提醒一句，避免 key 正确却一直 400
function aiWarnRow() {
  const warn = aiModelWarning();
  if (!warn) return '';
  return `<div class="row ai-warn">
    <div class="row-text"><b>模型名需要更新</b><span>${escapeHtml(warn)}</span></div>
    <button class="btn btn-sm" data-act="ai-fix">一键改好</button>
  </div>`;
}

function aiModelWarning() {
  if (!aiCfg || !aiCfg.enabled) return '';
  const provider = aiCfg.provider;
  const model = String(aiCfg.model || '');
  const vision = String(aiCfg.visionModel || '');
  if (provider === 'deepseek' && /^deepseek-chat$/i.test(model)) {
    return 'deepseek-chat 已下线，DeepSeek 现在的文字模型是 deepseek-flash';
  }
  if (provider === 'deepseek' && /^(qwen|glm|moonshot)/i.test(vision)) {
    return '视觉模型填的是别家的名字，DeepSeek 认不出来；改成 deepseek-flash';
  }
  if (provider && provider !== 'custom' && !vision && aiCfg.presets && aiCfg.presets[provider] && aiCfg.presets[provider].vision) {
    return '视觉模型还空着，截图识别和凭证检查会退回本地 OCR；填上 deepseek-flash 之类即可';
  }
  return '';
}

function presetOf(field) {
  if (!aiCfg || !aiCfg.presets) return '';
  const preset = aiCfg.presets[aiCfg.provider];
  return preset ? preset[field] || '' : '';
}

function modelMismatch(key, value) {
  const provider = aiCfg ? aiCfg.provider : '';
  if (!value) return key === 'visionModel' ? '留空的话，图片识别会走本地 OCR' : '';
  const foreign = {
    deepseek: /^(qwen|glm|moonshot)/i,
    dashscope: /^(deepseek|glm|moonshot)/i,
    moonshot: /^(deepseek|qwen|glm)/i,
    zhipu: /^(deepseek|qwen|moonshot)/i
  }[provider];
  if (foreign && foreign.test(value)) {
    return `这个模型名不像 ${provider} 家的，调用会失败`;
  }
  if (provider === 'deepseek' && /^deepseek-chat$/i.test(value)) {
    return 'deepseek-chat 已下线，改成 deepseek-flash';
  }
  return '';
}

async function saveAiKey() {
  const input = document.querySelector('[data-ai="apiKey"]');
  const value = input ? input.value.trim() : '';
  if (!value) {
    toast('先粘贴 Key 再保存');
    return;
  }
  aiCfg = await api.saveAiConfig({ apiKey: value, enabled: true });
  render();
  toast('Key 已保存，只存在这台电脑上', 'good');
}

async function testAi() {
  const btn = document.querySelector('[data-act="ai-test"]');
  if (btn) btn.textContent = '测试中…';
  const res = await api.testAi();
  if (btn) btn.textContent = '测试一下';
  if (res && res.ok) toast(`通了：${res.reply || 'OK'}`, 'good');
  else toast(res?.error || '没连上');
}

