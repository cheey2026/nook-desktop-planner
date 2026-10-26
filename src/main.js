'use strict';

/**
 * 某些宿主（例如以 Electron 编写的外壳程序）会给子进程带上 ELECTRON_RUN_AS_NODE=1，
 * 这会让本程序被当成普通 Node 脚本执行，表现为双击后毫无反应。
 * 这里检测到该变量时，用干净的环境重新拉起自己。
 */
if (process.env.ELECTRON_RUN_AS_NODE) {
  try {
    const { spawn } = require('node:child_process');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const keep = process.argv
      .slice(1)
      .filter(
        (arg) =>
          arg.startsWith('--startup') ||
          arg.startsWith('--shot') ||
          arg.startsWith('--user-data-dir') ||
          arg.startsWith('--set-autostart')
      );
    spawn(process.execPath, ['--no-sandbox', ...keep], { detached: true, stdio: 'ignore', env, cwd: process.cwd() }).unref();
  } catch (err) {
    /* 无法自愈时安静退出 */
  }
  process.exit(0);
}

const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Tray,
  Menu,
  shell,
  nativeImage,
  desktopCapturer,
  globalShortcut,
  dialog,
  clipboard,
  Notification
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { Store, dateKey, addDays, validTime } = require('./store');
const { AiClient, PRESETS, PROVIDER_ORDER, encrypt, maskKey } = require('./ai');

/**
 * 把 Chromium 的用户数据目录放到程序旁边。
 * 默认目录在 %APPDATA%，某些受限环境（沙箱、只读配置、便携 U 盘）里不可写，
 * 会导致进程启动即崩溃、双击毫无反应。这里优先用 <程序目录>\data。
 */
function resolveUserData() {
  // 命令行显式指定了数据目录时尊重它（自检、多开配置等场景）
  if (process.argv.some((arg) => arg.startsWith('--user-data-dir'))) return null;
  const exeDir = path.dirname(process.execPath);
  const candidates = [path.join(exeDir, 'data'), path.join(__dirname, '..', 'data')];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-test');
      fs.writeFileSync(probe, '1');
      fs.rmSync(probe, { force: true });
      return dir;
    } catch { /* 试下一个 */ }
  }
  return null;
}

try {
  const portableData = resolveUserData();
  if (portableData) app.setPath('userData', portableData);
} catch (err) {
  console.error('[boot] 无法设置用户数据目录，沿用默认位置：', err.message);
}

const APP_DIR = path.join(__dirname, '..');
const IS_SHOT = process.argv.includes('--shot');
const IS_STARTUP = process.argv.includes('--startup');
const AUTOSTART_ARG = process.argv.find((arg) => arg.startsWith('--set-autostart='));
const ACCENTS = new Set(['mint', 'sky', 'peach', 'lilac']);
const WIDGET_MIN = { width: 240, height: 96 };
const WIDGET_MAX = { width: 760, height: 1200 };

let lastProgrammaticResize = 0;
let widgetGraceUntil = 0;

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}

let store;
let managerWin = null;
let widgetWin = null;
let tray = null;
let resizeTimer = null;
let sizeSaveTimer = null;

function dataDir() {
  const candidates = [app.getPath('userData'), path.join(path.dirname(process.execPath), 'data')];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.write-test');
      fs.writeFileSync(probe, 'ok');
      fs.rmSync(probe, { force: true });
      return dir;
    } catch { /* 换下一个候选目录 */ }
  }
  return candidates[0];
}

function logStartup(line) {
  try {
    const file = path.join(dataDir(), 'startup.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 200 * 1024) fs.rmSync(file, { force: true });
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\r\n`, 'utf8');
  } catch {
    /* 日志失败不影响主流程 */
  }
}

process.on('uncaughtException', (err) => logStartup(`uncaught: ${(err && err.stack) || err}`));
process.on('unhandledRejection', (reason) => logStartup(`rejection: ${(reason && reason.stack) || reason}`));

function broadcast() {
  const state = store.snapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('state:changed', state);
  }
  if (tray) refreshTrayMenu(state);
}

function broadcastEvent(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/* ------------------------------------------------------------ 提醒与通知 */

function notify(title, body) {
  // 组件/管理窗内也会浮一条，双通道更可靠
  broadcastEvent('remind', { title, body });
  try {
    if (!Notification.isSupported()) {
      logStartup('系统通知不可用，改用窗口内提示');
      return false;
    }
    const item = new Notification({
      title,
      body,
      silent: !(store?.settings?.notify?.sound)
    });
    item.on('click', () => createManager('today'));
    item.show();
    return true;
  } catch (err) {
    logStartup(`通知发送失败：${err.message}`);
    return false;
  }
}

const firedReminders = new Map();
let reminderTimer = null;

function minuteOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

function startReminders() {
  if (reminderTimer) return;
  const tick = () => {
    try {
      checkReminders();
    } catch (err) {
      logStartup(`提醒检查失败：${err.message}`);
    }
  };
  reminderTimer = setInterval(tick, 30000);
  setTimeout(tick, 5000);
}

function checkReminders() {
  if (!store) return;
  const cfg = store.settings.notify;
  if (!cfg || !cfg.enabled) return;
  const now = new Date();
  const today = dateKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const lead = Math.max(0, Math.min(120, Number(cfg.leadMinutes) || 0));
  for (const task of store.tasks) {
    if (task.done || task.date !== today || !task.start) continue;
    const start = minuteOf(task.start);
    const end = task.end ? minuteOf(task.end) : start + 25;
    const due = [];
    if (lead > 0 && nowMin >= start - lead && nowMin < start) {
      due.push(['lead', start - lead, `还有 ${lead} 分钟：${task.title}`]);
    }
    if (nowMin >= start && nowMin <= start + 1) {
      due.push(['start', start, `现在开始：${task.title}`]);
    }
    if (cfg.atEnd && task.end && nowMin >= end && nowMin <= end + 1) {
      due.push(['end', end, `时间到：${task.title}`]);
    }
    for (const [kind, at, title] of due) {
      const key = `${task.id}|${today}|${kind}|${at}`;
      if (firedReminders.has(key)) continue;
      firedReminders.set(key, Date.now());
      notify(title, `${task.start}${task.end ? '–' + task.end : ''} · 点一下打开计划表`);
      logStartup(`提醒 ${kind}「${task.title}」${task.start}`);
    }
  }
  if (firedReminders.size > 800) firedReminders.clear();
}

/* ------------------------------------------------------------ AI 辅助 */

const ai = new AiClient(() => (store ? store.settings.ai : null));

function aiConfigPublic() {
  const s = store.settings.ai || {};
  const preset = PRESETS[s.provider] || PRESETS.custom;
  return {
    enabled: Boolean(s.enabled),
    provider: s.provider || 'deepseek',
    baseUrl: s.baseUrl || preset.baseUrl || '',
    model: s.model || preset.model || '',
    visionModel: s.visionModel || preset.visionModel || '',
    useVision: s.useVision !== false,
    hasKey: Boolean(s.apiKeyEnc),
    keyMask: maskKey(s.apiKeyEnc),
    order: PROVIDER_ORDER,
    presets: Object.fromEntries(
      PROVIDER_ORDER.map((key) => [
        key,
        {
          label: PRESETS[key].label,
          baseUrl: PRESETS[key].baseUrl,
          model: PRESETS[key].model,
          visionModel: PRESETS[key].visionModel
        }
      ])
    )
  };
}

function imageDataUrlFromPath(filePath, maxWidth = 1400) {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return '';
    const { width } = img.getSize();
    const out = width > maxWidth ? img.resize({ width: maxWidth }) : img;
    return `data:image/jpeg;base64,${out.toJPEG(82).toString('base64')}`;
  } catch (err) {
    logStartup(`读取图片失败：${err.message}`);
    return '';
  }
}

function decodeTextFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if ((utf8.match(/\uFFFD/g) || []).length > 0) {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

function widgetSettings() {
  return store.settings.widget;
}

function clampToArea(bounds) {
  const displays = screen.getAllDisplays();
  const area = displays.find((d) => {
    const b = d.workArea;
    return bounds.x >= b.x - 40 && bounds.x < b.x + b.width && bounds.y >= b.y - 40 && bounds.y < b.y + b.height;
  })?.workArea || screen.getPrimaryDisplay().workArea;
  const width = Math.min(Math.max(bounds.width, WIDGET_MIN.width), Math.min(WIDGET_MAX.width, area.width - 20));
  const height = Math.min(Math.max(bounds.height, WIDGET_MIN.height), area.height - 20);
  const x = Math.min(Math.max(bounds.x, area.x + 8), area.x + area.width - width - 8);
  const y = Math.min(Math.max(bounds.y, area.y + 8), area.y + area.height - height - 8);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

function defaultWidgetPosition(width, height) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(area.x + area.width - width - 36),
    y: Math.round(area.y + Math.max(48, Math.round(area.height * 0.14))),
    width,
    height
  };
}

/* ---------------------------------------------------------------- 窗口 */

function attachLogs(win, tag) {
  win.webContents.on('console-message', (_event, level, message, line, source) => {
    if (level >= 2) console.log(`[${tag}:${level === 3 ? 'error' : 'warn'}] ${message} (${source}:${line})`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[${tag}] 渲染进程退出:`, details.reason);
  });
}

function createManager(tab) {
  if (managerWin && !managerWin.isDestroyed()) {
    if (managerWin.isMinimized()) managerWin.restore();
    managerWin.show();
    managerWin.moveTop();
    managerWin.focus();
    if (tab) managerWin.webContents.send('ui:navigate', tab);
    return managerWin;
  }
  managerWin = new BrowserWindow({
    width: 1060,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: '#f3faf8',
    title: 'Nook',
    icon: path.join(APP_DIR, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  managerWin.loadFile(path.join(__dirname, 'renderer', 'manager', 'index.html'));
  attachLogs(managerWin, 'manager');
  managerWin.webContents.on('did-fail-load', (_e, code, desc) => logStartup(`manager: 页面加载失败 ${code} ${desc}`));

  managerWin.webContents.on('did-finish-load', () => {
    if (tab) managerWin.webContents.send('ui:navigate', tab);
  });

  managerWin.once('ready-to-show', () => {
    if (managerWin.isMinimized()) managerWin.restore();
    managerWin.show();
    managerWin.moveTop();
    managerWin.focus();
  });

  managerWin.on('closed', () => {
    managerWin = null;
  });

  managerWin.on('resize', () => {
    if (managerWin && !managerWin.isDestroyed()) {
      managerWin.webContents.send('window:resized');
    }
  });

  return managerWin;
}

function createWidget() {
  const s = widgetSettings();
  widgetGraceUntil = Date.now() + 2500;
  const saved = Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : null;
  const width = clampNumber(s.width, WIDGET_MIN.width, WIDGET_MAX.width, 330);
  const height = clampNumber(s.autoHeight ? 320 : s.height, WIDGET_MIN.height, WIDGET_MAX.height, 320);
  const bounds = clampToArea(
    saved ? { x: saved.x, y: saved.y, width, height } : defaultWidgetPosition(width, height)
  );

  widgetWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    minWidth: WIDGET_MIN.width,
    minHeight: WIDGET_MIN.height,
    maxWidth: WIDGET_MAX.width,
    maxHeight: WIDGET_MAX.height,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: Boolean(s.alwaysOnTop),
    show: false,
    roundedCorners: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  widgetWin.loadFile(path.join(__dirname, 'renderer', 'widget', 'index.html'));
  attachLogs(widgetWin, 'widget');
  try {
    widgetWin.setHasShadow(false);
  } catch { /* 某些平台不支持 */ }

  widgetWin.once('ready-to-show', () => {
    applyTopmost(s.alwaysOnTop);
    if (IS_SHOT) widgetWin.show();
    else widgetWin.showInactive();
  });

  let moveTimer = null;
  widgetWin.on('moved', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!widgetWin || widgetWin.isDestroyed()) return;
      const [x, y] = widgetWin.getPosition();
      store.updateSettings({ widget: { x, y } });
    }, 260);
  });

  let resizeTimerLocal = null;
  widgetWin.on('resize', () => {
    clearTimeout(resizeTimerLocal);
    resizeTimerLocal = setTimeout(() => {
      if (!widgetWin || widgetWin.isDestroyed()) return;
      if (Date.now() - lastProgrammaticResize < 400) return;
      if (Date.now() < widgetGraceUntil) return;

      const [w, h] = widgetWin.getSize();
      const current = widgetSettings();
      const widthChanged = Math.abs(w - clampNumber(current.width, WIDGET_MIN.width, WIDGET_MAX.width, 330)) >= 6;
      const heightChanged = Math.abs(h - clampNumber(current.height, WIDGET_MIN.height, WIDGET_MAX.height, 320)) >= 6;

      if (!current.autoHeight) {
        if (widthChanged || heightChanged) {
          store.updateSettings({ widget: { width: w, height: h, autoHeight: false } });
          broadcast();
        }
        return;
      }

      // 自动高度模式：高度由程序自己算，只有明显改宽才算用户手动拖动
      if (widthChanged) {
        store.updateSettings({ widget: { width: w, height: h, autoHeight: false } });
        broadcast();
      }
    }, 260);
  });

  widgetWin.on('closed', () => {
    widgetWin = null;
    if (!IS_SHOT && !app.isQuitting) store.updateSettings({ app: { hideWidget: true } });
  });

  return widgetWin;
}

function showWidget() {
  if (widgetWin && !widgetWin.isDestroyed()) {
    widgetWin.showInactive();
    applyTopmost(widgetSettings().alwaysOnTop);
  } else {
    createWidget();
  }
  store.updateSettings({ app: { hideWidget: false } });
}

function hideWidget() {
  if (widgetWin && !widgetWin.isDestroyed()) widgetWin.hide();
  store.updateSettings({ app: { hideWidget: true } });
}

/** 打开/关闭「显示在最上层」 */
function applyTopmost(enabled) {
  if (!widgetWin || widgetWin.isDestroyed()) return;
  widgetWin.setAlwaysOnTop(Boolean(enabled), enabled ? 'floating' : 'normal');
  if (enabled) widgetWin.moveTop();
}

function setTopmost(enabled) {
  store.updateSettings({ widget: { alwaysOnTop: Boolean(enabled) } });
  applyTopmost(Boolean(enabled));
  broadcast();
}

/** 高度自适应：等渲染进程量好内容高度后回调 resizeWidget */
function setAutoHeight(enabled) {
  store.updateSettings({ widget: { autoHeight: Boolean(enabled) } });
  if (widgetWin && !widgetWin.isDestroyed() && enabled) {
    widgetWin.webContents.send('widget:refit');
  }
  broadcast();
}

function resizeWidget(height) {
  if (!widgetWin || widgetWin.isDestroyed()) return;
  if (!widgetSettings().autoHeight) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!widgetWin || widgetWin.isDestroyed()) return;
    const [x, y] = widgetWin.getPosition();
    const [width, currentH] = widgetWin.getSize();
    const target = Math.round(clampNumber(height, WIDGET_MIN.height, WIDGET_MAX.height, currentH));
    if (Math.abs(target - currentH) < 2) return;
    lastProgrammaticResize = Date.now();
    widgetWin.setBounds(clampToArea({ x, y, width, height: target }));
  }, 40);
}

/** 设置里改尺寸：程序性调整，不触发「用户手动拖拽」的保存逻辑 */
function applyWidgetSize(patch) {
  if (!widgetWin || widgetWin.isDestroyed()) return;
  const s = widgetSettings();
  const [x, y] = widgetWin.getPosition();
  const [currentW, currentH] = widgetWin.getSize();
  const width = Math.round(clampNumber(patch.width ?? s.width ?? currentW, WIDGET_MIN.width, WIDGET_MAX.width, currentW));
  const height = Math.round(clampNumber(patch.height ?? s.height ?? currentH, WIDGET_MIN.height, WIDGET_MAX.height, currentH));
  if (width === currentW && height === currentH) return;
  lastProgrammaticResize = Date.now();
  widgetWin.setBounds(clampToArea({ x, y, width, height }));
}

/* ---------------------------------------------------------------- 托盘 */

function refreshTrayMenu(state) {
  if (!tray) return;
  const snap = state || store.snapshot();
  tray.setToolTip(`Nook · 今日 ${snap.counts.todayDone}/${snap.counts.todayTotal} · 超期 ${snap.counts.overdue}`);
  const menu = Menu.buildFromTemplate([
    { label: `今日完成 ${snap.counts.todayDone}/${snap.counts.todayTotal}`, enabled: false },
    { label: `超期未完成 ${snap.counts.overdue}`, enabled: false },
    { type: 'separator' },
    { label: '打开计划表', click: () => createManager() },
    {
      label: widgetWin && widgetWin.isVisible() ? '隐藏桌面组件' : '显示桌面组件',
      click: () => (widgetWin && widgetWin.isVisible() ? hideWidget() : showWidget())
    },
    {
      label: '组件显示在最上层',
      type: 'checkbox',
      checked: Boolean(store.settings.widget.alwaysOnTop),
      click: (item) => setTopmost(item.checked)
    },
    {
      label: '高度自适应内容',
      type: 'checkbox',
      checked: Boolean(store.settings.widget.autoHeight),
      click: (item) => setAutoHeight(item.checked)
    },
    { label: '把组件移回右上角', click: () => resetWidgetPosition() },
    { type: 'separator' },
    {
      label: '开机自启动',
      type: 'checkbox',
      checked: store.settings.app.autostart,
      click: (item) => toggleAutostart(item.checked)
    },
    { label: '打开数据文件夹', click: () => shell.openPath(dataDir()) },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() }
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const iconPath = path.join(APP_DIR, 'assets', 'tray.png');
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('Nook');
  refreshTrayMenu();
  tray.on('click', () => createManager());
}

function resetWidgetPosition() {
  if (!widgetWin || widgetWin.isDestroyed()) {
    store.updateSettings({ widget: { x: null, y: null } });
    return;
  }
  const [width] = widgetWin.getSize();
  const [, height] = widgetWin.getSize();
  const pos = defaultWidgetPosition(width, height);
  widgetWin.setPosition(pos.x, pos.y);
  store.updateSettings({ widget: { x: pos.x, y: pos.y } });
}

/* ---------------------------------------------------------------- 打开链接 / 应用 */

async function openTarget(rawLink) {
  const link = String(rawLink || '').trim();
  if (!link) return { ok: false, error: '链接为空' };

  try {
    if (/^https?:\/\//i.test(link) || /^mailto:/i.test(link)) {
      await shell.openExternal(link);
      return { ok: true };
    }

    let target = link;
    if (/^file:\/\//i.test(target)) {
      target = decodeURIComponent(target.replace(/^file:\/+/i, ''));
      if (/^\/[a-zA-Z]:/.test(target)) target = target.slice(1);
    }
    if (!path.isAbsolute(target) && !/^[a-zA-Z]:[\\/]/.test(target) && !/^\\\\/.test(target)) {
      return { ok: false, error: '不是有效的文件路径' };
    }

    const failure = await shell.openPath(target);
    return failure ? { ok: false, error: failure } : { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ---------------------------------------------------------------- 开机自启动 */

function loginItemArgs() {
  const appPath = app.getAppPath();
  const bundled = fs.existsSync(path.join(path.dirname(process.execPath), 'resources', 'app'));
  return bundled || app.isPackaged ? ['--startup'] : [appPath, '--startup'];
}

/** 启动文件夹里的启动脚本（不依赖注册表写入权限，中文路径也安全） */
function startupFile() {
  const dir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  return { dir, file: path.join(dir, 'Nook.vbs') };
}

/** 优先使用同目录的启动器（它负责带上 --no-sandbox 并清理环境变量） */
function entryExe() {
  try {
    const launcher = path.join(path.dirname(process.execPath), 'Nook.exe');
    if (fs.existsSync(launcher)) return launcher;
  } catch { /* 忽略 */ }
  return process.execPath;
}

function startupScript() {
  const exe = entryExe();
  const useLauncher = exe !== process.execPath;
  const argList = useLauncher ? loginItemArgs() : ['--no-sandbox', ...loginItemArgs()];
  // VBScript 字符串里用 "" 表示一个双引号
  const argLine = argList.map((arg) => (/\s/.test(arg) ? `""${arg}""` : arg)).join(' ');
  const lines = [
    "' 由「Nook」自动创建：删除这个文件即可取消开机自启动",
    'Set shell = CreateObject("WScript.Shell")',
    'shell.Environment("PROCESS")("ELECTRON_RUN_AS_NODE") = ""',
    `shell.CurrentDirectory = "${path.dirname(exe)}"`,
    `shell.Run """${exe}"" ${argLine}", 1, False`
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function nativeAutoStart(enabled) {
  try {
    if (enabled) app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: loginItemArgs() });
    else app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: loginItemArgs() });
  } catch (err) {
    console.warn('[autostart] 系统登录项设置失败（不影响启动文件夹方案）:', err.message);
  }
}

function readAutostart() {
  try {
    const { file } = startupFile();
    if (fs.existsSync(file)) return Promise.resolve(true);
    const info = app.getLoginItemSettings({ path: process.execPath, args: loginItemArgs() });
    return Promise.resolve(Boolean(info.openAtLogin));
  } catch (err) {
    console.error('[autostart] 读取失败:', err.message);
    return Promise.resolve(false);
  }
}

function writeAutostart(enabled) {
  try {
    const { dir, file } = startupFile();
    if (enabled) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, startupScript(), 'utf16le');
    } else {
      fs.rmSync(file, { force: true });
    }
    nativeAutoStart(Boolean(enabled));
    return Promise.resolve(enabled ? fs.existsSync(file) : !fs.existsSync(file));
  } catch (err) {
    console.error('[autostart] 写入失败:', err.message);
    logStartup(`autostart 写入失败: ${err.message}`);
    return Promise.resolve(false);
  }
}

async function toggleAutostart(enabled) {
  const ok = await writeAutostart(Boolean(enabled));
  store.updateSettings({ app: { autostart: ok && Boolean(enabled) } });
  broadcast();
  return ok;
}

/* ---------------------------------------------------------------- 图片识别 */

const OCR_SCRIPT = path.join(__dirname, 'ocr.ps1');

/**
 * 用 Windows 自带的 OCR（Windows.Media.Ocr）识别图片里的文字：
 * 离线、免安装、不联网；没有语言包的机器返回明确错误。
 */
function recognizeImage(dataUrl) {
  return new Promise((resolve) => {
    const match = /^data:image\/(png|jpe?g|bmp|webp);base64,(.+)$/i.exec(String(dataUrl || ''));
    if (!match) {
      resolve({ ok: false, error: '剪贴板里没有可识别的图片' });
      return;
    }
    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const tmp = path.join(app.getPath('temp'), `nook-ocr-${Date.now()}.${ext}`);
    try {
      fs.writeFileSync(tmp, Buffer.from(match[2], 'base64'));
    } catch (err) {
      resolve({ ok: false, error: `临时图片写入失败：${err.message}` });
      return;
    }
    const cleanup = () => {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* 忽略 */
      }
    };

    let child;
    try {
      child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', OCR_SCRIPT, '-Path', tmp],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch (err) {
      cleanup();
      resolve({ ok: false, error: err.message });
      return;
    }

    let out = '';
    let errOut = '';
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(payload);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* 忽略 */
      }
      finish({ ok: false, error: '图片识别超时了' });
    }, 25000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      errOut += chunk;
    });
    child.on('error', (err) => finish({ ok: false, error: `无法调用系统识别组件：${err.message}` }));
    child.on('close', () => {
      const lines = out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.includes('NO_ENGINE')) {
        finish({ ok: false, error: '这台电脑没装 OCR 语言包（Windows 设置里添加中文语言即可）' });
        return;
      }
      const failed = lines.find((line) => line.startsWith('ERROR:'));
      if (failed) {
        finish({ ok: false, error: failed.slice(6) });
        return;
      }
      const text = lines.join('\n').trim();
      if (!text) {
        finish({ ok: false, error: errOut.trim().slice(0, 120) || '图片里没认出文字' });
        return;
      }
      finish({ ok: true, text });
    });
  });
}

/* ---------------------------------------------------------------- IPC */

function registerIpc() {
  ipcMain.handle('state:get', () => store.snapshot());

  ipcMain.handle('clipboard:read', () => {
    const image = clipboard.readImage();
    return {
      text: clipboard.readText(),
      image: image.isEmpty() ? '' : image.toDataURL()
    };
  });

  ipcMain.handle('ocr:image', (_e, dataUrl) => recognizeImage(dataUrl));

  ipcMain.handle('clipboard:writeText', (_e, text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });

  ipcMain.handle('task:add', (_e, payload) => {
    store.addTask(payload || {});
    broadcast();
    return store.snapshot();
  });

  ipcMain.handle('task:update', (_e, { id, patch }) => {
    store.updateTask(id, patch);
    broadcast();
    return store.snapshot();
  });

  ipcMain.handle('task:toggle', (_e, { id, done }) => {
    const task = store.toggleTask(id, done);
    broadcast();
    return { state: store.snapshot(), task, encouragement: store.randomEncouragement() };
  });

  ipcMain.handle('task:delete', (_e, id) => {
    store.deleteTask(id);
    broadcast();
    return store.snapshot();
  });

  ipcMain.handle('task:moveToday', (_e, id) => {
    store.moveToToday(id);
    broadcast();
    return store.snapshot();
  });

  ipcMain.handle('task:openTarget', async (_e, id) => {
    const task = store.tasks.find((t) => t.id === id);
    if (!task || !task.link) return { ok: false, error: '这个任务还没有链接' };
    return openTarget(task.link);
  });

  ipcMain.handle('app:pickTarget', async () => {
    const parent = managerWin && !managerWin.isDestroyed() ? managerWin : undefined;
    const result = await dialog.showOpenDialog(parent, {
      title: '选择一个应用或文件',
      buttonLabel: '选择',
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('task:clearCompleted', () => {
    const removed = store.clearCompleted();
    broadcast();
    return { removed, state: store.snapshot() };
  });

  ipcMain.handle('overdue:postponeAll', () => {
    const count = store.postponeOverdueToToday();
    broadcast();
    return { count, state: store.snapshot() };
  });

  ipcMain.handle('settings:update', (_e, patch) => {
    const next = store.updateSettings(patch || {});
    const w = next.widget;
    const hasWin = Boolean(widgetWin) && !widgetWin.isDestroyed();

    if (patch && patch.widget) {
      if ('alwaysOnTop' in patch.widget) applyTopmost(w.alwaysOnTop);
      if ('x' in patch.widget || 'y' in patch.widget) resetWidgetPosition();

      if ('autoHeight' in patch.widget) {
        if (!hasWin) {
          /* 窗口未创建时无需处理 */
        } else if (w.autoHeight) {
          widgetWin.webContents.send('widget:refit');
        } else {
          applyWidgetSize({ width: w.width, height: w.height });
        }
      } else if (hasWin && ('width' in patch.widget || 'height' in patch.widget)) {
        applyWidgetSize({
          width: w.width,
          height: w.autoHeight ? widgetWin.getSize()[1] : w.height
        });
      }
    }

    broadcast();
    return { state: store.snapshot(), autostart: store.settings.app.autostart };
  });

  ipcMain.handle('widget:menu', () => {
    if (!widgetWin || widgetWin.isDestroyed()) return;
    const w = widgetSettings();
    const menu = Menu.buildFromTemplate([
      {
        label: '显示在窗口最上层',
        type: 'checkbox',
        checked: Boolean(w.alwaysOnTop),
        click: (item) => setTopmost(item.checked)
      },
      {
        label: '高度自适应内容',
        type: 'checkbox',
        checked: Boolean(w.autoHeight),
        click: (item) => setAutoHeight(item.checked)
      },
      { type: 'separator' },
      { label: '打开计划表', click: () => createManager() },
      {
        label: '组件设置…',
        click: () => {
          const win = createManager();
          win.webContents.send('ui:navigate', 'settings');
        }
      },
      { type: 'separator' },
      { label: '隐藏组件', click: () => hideWidget() },
      { label: '退出程序', click: () => quitApp() }
    ]);
    menu.popup({ window: widgetWin });
  });

  ipcMain.handle('app:autostart', async (_e, { enabled }) => {
    const ok = await toggleAutostart(enabled);
    return { ok, state: store.snapshot(), autostart: store.settings.app.autostart };
  });

  ipcMain.handle('app:autostartState', () => readAutostart());

  ipcMain.handle('widget:resize', (_e, height) => resizeWidget(height));

  ipcMain.handle('widget:resizeTo', (_e, size) => {
    if (!widgetWin || widgetWin.isDestroyed() || !size) return;
    const [x, y] = widgetWin.getPosition();
    const width = Math.round(clampNumber(size.width, WIDGET_MIN.width, WIDGET_MAX.width, 330));
    const height = Math.round(clampNumber(size.height, WIDGET_MIN.height, WIDGET_MAX.height, 320));
    lastProgrammaticResize = Date.now();
    widgetWin.setBounds({ x, y, width, height });
    if (store.settings.widget.autoHeight) {
      store.updateSettings({ widget: { autoHeight: false } });
      broadcast();
    }
    clearTimeout(sizeSaveTimer);
    sizeSaveTimer = setTimeout(() => {
      store.updateSettings({ widget: { width, height, autoHeight: false } });
      broadcast();
    }, 260);
  });
  ipcMain.handle('widget:hide', () => hideWidget());
  ipcMain.handle('widget:show', () => showWidget());
  ipcMain.handle('widget:resetPosition', () => resetWidgetPosition());

  ipcMain.handle('window:openManager', (_e, tab) => {
    createManager(tab);
  });
  ipcMain.handle('task:requestProof', (_e, id) => {
    // 桌面组件里点到"需要凭证"的任务：把管理窗叫出来，直接弹凭证框
    createManager('today');
    const send = () => managerWin?.webContents.send('ui:proof', id);
    if (managerWin?.webContents.isLoading()) {
      managerWin.webContents.once('did-finish-load', () => setTimeout(send, 400));
    } else {
      setTimeout(send, 120);
    }
    return { ok: true };
  });
  ipcMain.handle('window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipcMain.handle('window:close', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win === managerWin) win.hide();
    else win?.close();
  });
  ipcMain.handle('window:maximizeToggle', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  ipcMain.handle('app:openDataFolder', () => shell.openPath(dataDir()));
  ipcMain.handle('app:openStartupFolder', () => shell.openPath(startupFile().dir));
  ipcMain.handle('app:autostartInfo', () => ({
    file: startupFile().file,
    exists: fs.existsSync(startupFile().file),
    command: startupScript()
  }));
  ipcMain.handle('app:accentValidate', () => Array.from(ACCENTS));
  ipcMain.handle('app:quit', () => quitApp());

  /* ---------------------------------------------------------- AI 助手 */

  ipcMain.handle('ai:config', () => aiConfigPublic());

  ipcMain.handle('ai:save', (_e, patch = {}) => {
    const next = {};
    for (const key of ['enabled', 'provider', 'baseUrl', 'model', 'visionModel', 'useVision']) {
      if (key in patch) next[key] = patch[key];
    }
    if ('apiKey' in patch && String(patch.apiKey || '').trim()) {
      next.apiKeyEnc = encrypt(String(patch.apiKey).trim());
    }
    if (patch.clearKey) next.apiKeyEnc = '';
    store.updateSettings({ ai: next });
    broadcast();
    return aiConfigPublic();
  });

  ipcMain.handle('ai:test', async () => ai.test());

  ipcMain.handle('ai:recognize', async (_e, payload = {}) => {
    const state = store.snapshot();
    return ai.recognize({
      text: payload.text || '',
      imageDataUrl: payload.imageDataUrl || '',
      dateHint: `${state.today} ${state.weekday}`,
      goals: store.goals.filter((g) => !g.archived).map((g) => g.title)
    });
  });

  ipcMain.handle('ai:plan', (_e, payload = {}) => {
    const state = store.snapshot();
    return ai.plan({
      goal: String(payload.goal || '').slice(0, 600),
      days: Math.max(1, Math.min(30, Number(payload.days) || 7)),
      minutes: Math.max(10, Math.min(600, Number(payload.minutes) || 60)),
      dateHint: `${state.today} ${state.weekday}`
    });
  });

  ipcMain.handle('ai:summary', async (_e, payload = {}) => {
    const date = payload.date || dateKey();
    const state = store.snapshot();
    const dayTasks = state.tasks.filter((t) => t.date === date);
    const res = await ai.summary({
      date,
      done: dayTasks.filter((t) => t.done).map((t) => t.title),
      pending: dayTasks.filter((t) => !t.done).map((t) => t.title),
      overdue: state.tasks.filter((t) => t.overdue).map((t) => `${t.title}（逾期 ${t.overdueDays} 天）`)
    });
    if (res.ok && res.summary) {
      const entry = store.saveSummary({
        date,
        summary: res.summary,
        tips: res.tips,
        provider: ai.config().provider
      });
      broadcast();
      return { ...res, entry, state: store.snapshot() };
    }
    return res;
  });

  ipcMain.handle('ai:checkProof', (_e, payload = {}) => {
    const task = payload.taskId ? store.findTask(payload.taskId) : null;
    return ai.checkProof({
      title: task ? task.title : String(payload.title || ''),
      note: task ? task.note : '',
      imageDataUrl: payload.imageDataUrl || ''
    });
  });

  ipcMain.handle('ai:breakdown', (_e, payload = {}) => {
    const today = dateKey();
    return ai.breakdown({
      goal: String(payload.goal || '').slice(0, 600),
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(payload.startDate) ? payload.startDate : today,
      endDate: /^\d{4}-\d{2}-\d{2}$/.test(payload.endDate) ? payload.endDate : addDays(today, 30),
      timesPerWeek: Math.max(1, Math.min(7, Number(payload.timesPerWeek) || 3))
    });
  });

  /* ---------------------------------------------------------- 长期计划 */

  ipcMain.handle('goal:add', (_e, payload) => {
    store.addGoal(payload || {});
    broadcast();
    return store.snapshot();
  });

  ipcMain.handle('goal:update', (_e, { id, patch }) => {
    store.updateGoal(id, patch || {});
    broadcast();
    return store.snapshot();
  });

  ipcMain.handle('goal:delete', (_e, id) => {
    store.deleteGoal(id);
    broadcast();
    return store.snapshot();
  });

  ipcMain.handle('task:attachGoal', (_e, { id, goalId }) => {
    store.updateTask(id, { parentId: goalId || null });
    broadcast();
    return store.snapshot();
  });

  /* ---------------------------------------------------------- 文件 / 提醒 */

  ipcMain.handle('file:pick', async (_e, kind = 'image') => {
    const parent = managerWin && !managerWin.isDestroyed() ? managerWin : undefined;
    const filters = kind === 'image'
      ? [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
      : [{ name: '文本', extensions: ['txt', 'md', 'json', 'csv', 'log'] }, { name: '所有文件', extensions: ['*'] }];
    const result = await dialog.showOpenDialog(parent, {
      title: kind === 'image' ? '选择一张图片' : '选择文本文件',
      buttonLabel: '选择',
      properties: ['openFile'],
      filters
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('file:readText', (_e, filePath) => {
    try {
      return { ok: true, text: decodeTextFile(filePath).slice(0, 200000) };
    } catch (err) {
      return { ok: false, error: `读取失败：${err.message}` };
    }
  });

  ipcMain.handle('file:imageData', (_e, filePath) => {
    try {
      const dataUrl = imageDataUrlFromPath(filePath);
      return dataUrl ? { ok: true, dataUrl } : { ok: false, error: '不是可识别的图片' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('file:ocr', async (_e, filePath) => {
    try {
      const dataUrl = imageDataUrlFromPath(filePath, 2000);
      if (!dataUrl) return { ok: false, error: '不是可识别的图片' };
      return await recognizeImage(dataUrl);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('notify:test', () => ({ ok: notify('Nook 提醒测试', '看到这条说明提醒通道是通的') }));

  ipcMain.handle('notify:checkNow', () => {
    checkReminders();
    return { ok: true };
  });
}

function quitApp() {
  app.isQuitting = true;
  app.quit();
}

/* ---------------------------------------------------------------- 截图（开发自检） */

async function captureScreens() {
  const outDir = process.env.SHOT_DIR || path.join(APP_DIR, '.shots');
  fs.mkdirSync(outDir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(900);

  const shotWindow = async (win, name) => {
    if (!win || win.isDestroyed()) return;
    try {
      const image = await win.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
    } catch (err) {
      console.error(`[shot] ${name} 截图失败:`, err.message);
    }
  };

  const shotDesktop = async (name) => {
    try {
      const display = screen.getPrimaryDisplay();
      const size = display.size;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: size.width * display.scaleFactor, height: size.height * display.scaleFactor }
      });
      const source = sources[0];
      if (source) fs.writeFileSync(path.join(outDir, `${name}.png`), source.thumbnail.toPNG());
    } catch (err) {
      console.error('[shot] 桌面截图失败:', err.message);
    }
  };

  if (process.env.SHOT_OPEN) {
    // 自检：打开任务挂的目标，以及错误路径的提示
    const withLink = store.tasks.find((t) => t.link && /notepad\.exe$/i.test(t.link));
    if (withLink) {
      const ok = await openTarget(withLink.link);
      logStartup(`openTarget(notepad) -> ${JSON.stringify(ok)}`);
    }
    const bad = await openTarget('C:\\definitely-missing-folder\\nope.exe');
    logStartup(`openTarget(错误路径) -> ${JSON.stringify(bad)}`);
  }

  if (process.env.SHOT_RESIZE) {
    // 自检：拖拽/设置改尺寸是否生效，以及切回自适应高度
    await widgetWin.webContents.executeJavaScript('window.planner.resizeWidgetTo({ width: 460, height: 600 })');
    await wait(700);
    logStartup(
      `resizeTo -> size=${JSON.stringify(widgetWin.getSize())} auto=${store.settings.widget.autoHeight} saved=${store.settings.widget.width}x${store.settings.widget.height}`
    );
    await shotWindow(widgetWin, 'widget-resized');
    await widgetWin.webContents.executeJavaScript('window.planner.updateSettings({ widget: { autoHeight: true } })');
    await wait(1000);
    logStartup(`autoHeight -> size=${JSON.stringify(widgetWin.getSize())}`);
  }

  if (process.env.SHOT_TOP) {
    // 自检：置顶开关是否真的作用到窗口
    const before = widgetWin.isAlwaysOnTop();
    await widgetWin.webContents.executeJavaScript('window.planner.updateSettings({ widget: { alwaysOnTop: false } })');
    await wait(350);
    const afterOff = widgetWin.isAlwaysOnTop();
    await widgetWin.webContents.executeJavaScript('window.planner.updateSettings({ widget: { alwaysOnTop: true } })');
    await wait(350);
    const afterOn = widgetWin.isAlwaysOnTop();
    logStartup(`topmost before=${before} off=${afterOff} on=${afterOn}`);
  }

  if (process.env.SHOT_RECOGNIZE) {
    // 自检：真实走一遍「图片 → 系统 OCR → 解析 → 识别弹窗」
    const imagePath = process.env.SHOT_IMAGE || path.join(ROOT_DIR || process.cwd(), '.ocr-input.png');
    try {
      const base64 = fs.readFileSync(imagePath).toString('base64');
      const result = await recognizeImage(`data:image/png;base64,${base64}`);
      logStartup(`ocr -> ok=${result.ok} text=${JSON.stringify((result.text || result.error || '').slice(0, 120))}`);
      if (result.ok) {
        await managerWin.webContents.executeJavaScript(
          `openRecognize({ text: ${JSON.stringify(result.text)}, fromImage: true })`
        );
        await wait(600);
        await shotWindow(managerWin, 'manager-recognize');
        await managerWin.webContents.executeJavaScript('closeRecognize()');
        await wait(200);
      }
    } catch (err) {
      logStartup(`ocr 失败: ${err.message}`);
    }
  }

  if (process.env.SHOT_PASTE) {
    // 自检：组件里粘贴一段文字 → 拆成任务
    try {
      const before = store.tasks.length;
      await widgetWin.webContents.executeJavaScript(
        `addParsedTasks('明天 10:00 交季度报表 https://example.com/q3\\n周四 下午 3:30 和设计团队评审\\n晚上慢跑 3 公里')`
      );
      await wait(500);
      logStartup(`widget 粘贴识别 -> 任务数 ${before} -> ${store.tasks.length}`);
      await shotWindow(widgetWin, 'widget-paste');
      await wait(1200);
    } catch (err) {
      logStartup(`widget 粘贴识别失败: ${err.message}`);
    }
  }

  if (process.env.SHOT_RECOGNIZE_BTN) {
    // 自检：管理窗口点「识别」按钮 → 先弹输入框（可粘贴文字/选图片）
    try {
      await managerWin.webContents.executeJavaScript(
        `document.querySelector('[data-act="recognize"]')?.click()`
      );
      await wait(500);
      await managerWin.webContents.executeJavaScript(
        `document.getElementById('recInputText').value = '明天10:00提交季度报销单\\n15:30 和设计团队评审方案'`
      );
      await wait(200);
      await shotWindow(managerWin, 'manager-recognize-input');
      await managerWin.webContents.executeJavaScript('closeRecognizeInput()');
      await wait(150);
      logStartup('manager 识别输入框自检完成');
    } catch (err) {
      logStartup(`manager 识别输入框自检失败: ${err.message}`);
    }
  }

  if (process.env.SHOT_SCROLL) {
    // 自检：设置页下半部分（提醒 / AI 助手）
    try {
      await managerWin.webContents.executeJavaScript('navigate("settings")');
      await wait(400);
      await managerWin.webContents.executeJavaScript(
        'document.getElementById("view").scrollTop = 640'
      );
      await wait(400);
      await shotWindow(managerWin, 'manager-settings2');
      await managerWin.webContents.executeJavaScript(
        'document.getElementById("view").scrollTop = 99999'
      );
      await wait(400);
      await shotWindow(managerWin, 'manager-settings3');
    } catch (err) {
      logStartup(`设置页滚动截图失败: ${err.message}`);
    }
  }

  if (process.env.SHOT_AI) {
    // 自检：AI 链路（配合 tools/mock-ai.js 使用）
    try {
      const settings = store.settings;
      const today = dateKey();
      const t1 = await ai.test();
      logStartup(`ai.test => ${t1.ok ? `ok:${t1.reply}` : `fail:${t1.error}`}`);
      if (settings.ai.enabled) {
        const r = await ai.recognize({
          text: '明天10:00提交季度报销单（财务系统）\n15:30 和设计团队评审方案 https://example.com/review\n后天之前读完第3章',
          dateHint: today,
          goals: store.goals.map((g) => g.title)
        });
        logStartup(`ai.recognize => ${r.ok ? `${r.items.length} 条: ${r.items.map((i) => `${i.title}@${i.date}/${i.start}`).join(' | ')}` : `fail:${r.error}`}`);
        const p = await ai.plan({ goal: '学会 React Hooks', days: 3, minutes: 60, dateHint: today });
        logStartup(`ai.plan => ${p.ok ? `${p.items.length} 条` : `fail:${p.error}`}`);
        const b = await ai.breakdown({ goal: '跑完半程马拉松', startDate: today, endDate: addDays(today, 30), timesPerWeek: 3 });
        logStartup(`ai.breakdown => ${b.ok ? `${b.items.length} 条` : `fail:${b.error}`}`);
        const s = await ai.summary({ date: today, done: ['写周报'], pending: ['报销单'], overdue: ['跑步'] });
        logStartup(`ai.summary => ${s.ok ? s.summary.slice(0, 40) : `fail:${s.error}`}`);
        const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const chk = await ai.checkProof({ title: '交作业', note: '', imageDataUrl: png });
        logStartup(`ai.checkProof => ${chk.ok ? `pass=${chk.pass} reason=${chk.reason}` : `fail:${chk.error}`}`);

        if (process.env.SHOT_AI === 'ui') {
          await managerWin.webContents.executeJavaScript('navigate("today")');
          await wait(300);
          const modal = await managerWin.webContents.executeJavaScript(`
            (async () => {
              const task = state.tasks.find((t) => t.needsCheck) || state.tasks[0];
              openProof(task.id);
              const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
              setProofImage(png);
              await runProofCheck();
              return 'proof:' + document.getElementById('proofResult').textContent.trim();
            })()
          `).catch((err) => `proof-error:${err.message}`);
          logStartup(modal);
          await wait(600);
          await shotWindow(managerWin, 'manager-proof');
          await managerWin.webContents.executeJavaScript('closeProof(); openSummary(true)').catch(() => {});
          await wait(1200);
          await shotWindow(managerWin, 'manager-summary');
          await managerWin.webContents.executeJavaScript('document.getElementById("summaryModal").hidden = true');

          // 长期计划 → AI 拆解走 ai:breakdown 这条新链路
          const bd = await managerWin.webContents.executeJavaScript(`
            (async () => {
              const g = (state.goals || [])[0];
              if (!g) return 'no-goal';
              navigate('goals');
              await new Promise((r) => setTimeout(r, 200));
              await goalBreakdown(g.id);
              const count = document.getElementById('rcCount').textContent;
              const src = document.getElementById('rcSource').textContent;
              return 'breakdown: goal=' + g.title + ' items=' + count + ' src=' + src;
            })()
          `).catch((err) => `breakdown-error:${err.message}`);
          logStartup(bd);
          await wait(500);
          await shotWindow(managerWin, 'manager-breakdown');
          await managerWin.webContents.executeJavaScript('closeRecognize()').catch(() => {});
        }
      }
    } catch (err) {
      logStartup(`AI 自检失败: ${err.message}`);
    }
  }

  await shotDesktop('screen');
  await shotWindow(widgetWin, 'widget');

  if (process.env.SHOT_PROBE) {
    // 诊断用：把页面底色改成深色，观察卡片真实不透明度
    await widgetWin.webContents.executeJavaScript("document.body.style.background = '#101010'");
    await wait(250);
    await shotWindow(widgetWin, 'widget-on-dark');
    await widgetWin.webContents.executeJavaScript("document.body.style.background = 'transparent'");
    await wait(120);
  }

  // 完成动画：点击组件里的第一个圆圈，截取动画中间帧
  try {
    await widgetWin.webContents.executeJavaScript(
      `(() => { const el = document.querySelector('.item .check'); if (el) { el.click(); return true; } return false; })()`
    );
    await wait(340);
    await shotWindow(widgetWin, 'widget-anim');
    await shotDesktop('screen-anim');
    await wait(800);
  } catch (err) {
    console.error('[shot] 动画截图失败:', err.message);
  }

  // 管理窗口各标签页
  const tabs = [
    ['today', 'manager'],
    ['board', 'manager-board'],
    ['goals', 'manager-goals'],
    ['done', 'manager-done'],
    ['settings', 'manager-settings']
  ];
  for (const [tabName, file] of tabs) {
    try {
      await managerWin.webContents.executeJavaScript(`navigate(${JSON.stringify(tabName)})`);
      await wait(320);
      await shotWindow(managerWin, file);
    } catch (err) {
      console.error(`[shot] ${file} 截图失败:`, err.message);
    }
  }

  console.log('[shot] 已保存到', outDir);
  setTimeout(() => quitApp(), 200);
}

/* ---------------------------------------------------------------- 启动 */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  logStartup('另一个实例已在运行，本实例退出');
  app.quit();
} else {
  app.on('second-instance', () => createManager());

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.nook.app');
    store = new Store(dataDir());
    logStartup(
      `启动 v${app.getVersion()} ${process.platform} argv=${JSON.stringify(process.argv.slice(1))} exe=${process.execPath} data=${dataDir()}`
    );
    if (store.settings.widget.width === undefined || store.settings.widget.width === null) {
      store.updateSettings({ widget: { width: 330 } });
    }

    registerIpc();

    if (AUTOSTART_ARG) {
      const enabled = !AUTOSTART_ARG.endsWith('=off');
      const ok = await writeAutostart(enabled);
      store.updateSettings({ app: { autostart: ok && enabled } });
      logStartup(`autostart ${enabled ? 'on' : 'off'} -> ${ok ? 'ok' : 'failed'} file=${startupFile().file}`);
      app.exit(ok ? 0 : 1);
      return;
    }

    createWidget();
    if (!IS_SHOT && !IS_STARTUP) createManager();
    else if (IS_SHOT) createManager();

    createTray();
    startReminders();

    const reclamp = () => {
      if (widgetWin && !widgetWin.isDestroyed()) {
        widgetWin.setBounds(clampToArea(widgetWin.getBounds()));
      }
    };
    screen.on('display-metrics-changed', reclamp);
    screen.on('display-removed', reclamp);
    screen.on('display-added', reclamp);

    readAutostart().then((actual) => {
      if (actual !== store.settings.app.autostart) {
        store.updateSettings({ app: { autostart: actual } });
        broadcast();
      }
    });

    try {
      globalShortcut.register('Control+Alt+P', () => createManager());
    } catch { /* 忽略热键冲突 */ }

    if (IS_SHOT) captureScreens();

    app.on('activate', () => createManager());
  });

  app.on('window-all-closed', (e) => {
    e.preventDefault?.();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    globalShortcut.unregisterAll();
  });
}
