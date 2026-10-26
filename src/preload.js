'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('planner', {
  getState: () => invoke('state:get'),

  addTask: (payload) => invoke('task:add', payload),
  updateTask: (id, patch) => invoke('task:update', { id, patch }),
  toggleTask: (id, done) => invoke('task:toggle', { id, done }),
  deleteTask: (id) => invoke('task:delete', id),
  moveToday: (id) => invoke('task:moveToday', id),
  openTarget: (id) => invoke('task:openTarget', id),
  pickTarget: () => invoke('app:pickTarget'),
  readClipboard: () => invoke('clipboard:read'),
  writeClipboard: (text) => invoke('clipboard:writeText', text),
  recognizeImage: (dataUrl) => invoke('ocr:image', dataUrl),
  clearCompleted: () => invoke('task:clearCompleted'),
  postponeAll: () => invoke('overdue:postponeAll'),

  updateSettings: (patch) => invoke('settings:update', patch),
  setAutostart: (enabled) => invoke('app:autostart', { enabled }),
  autostartState: () => invoke('app:autostartState'),

  resizeWidget: (height) => invoke('widget:resize', height),
  resizeWidgetTo: (size) => invoke('widget:resizeTo', size),
  hideWidget: () => invoke('widget:hide'),
  showWidget: () => invoke('widget:show'),
  resetWidgetPosition: () => invoke('widget:resetPosition'),
  widgetMenu: () => invoke('widget:menu'),

  openManager: (tab) => invoke('window:openManager', tab),
  minimize: () => invoke('window:minimize'),
  close: () => invoke('window:close'),
  toggleMaximize: () => invoke('window:maximizeToggle'),
  openDataFolder: () => invoke('app:openDataFolder'),
  openStartupFolder: () => invoke('app:openStartupFolder'),
  autostartInfo: () => invoke('app:autostartInfo'),
  quit: () => invoke('app:quit'),

  /* ---- AI ---- */
  getAiConfig: () => invoke('ai:config'),
  saveAiConfig: (patch) => invoke('ai:save', patch),
  testAi: () => invoke('ai:test'),
  aiRecognize: (payload) => invoke('ai:recognize', payload),
  aiPlan: (payload) => invoke('ai:plan', payload),
  aiSummary: (payload) => invoke('ai:summary', payload),
  aiCheckProof: (payload) => invoke('ai:checkProof', payload),
  aiBreakdown: (payload) => invoke('ai:breakdown', payload),

  /* ---- 长期计划 ---- */
  addGoal: (payload) => invoke('goal:add', payload),
  updateGoal: (id, patch) => invoke('goal:update', { id, patch }),
  deleteGoal: (id) => invoke('goal:delete', id),
  attachGoal: (id, goalId) => invoke('task:attachGoal', { id, goalId }),

  /* ---- 文件与提醒 ---- */
  pickFile: (kind) => invoke('file:pick', kind),
  readTextFile: (filePath) => invoke('file:readText', filePath),
  fileImageData: (filePath) => invoke('file:imageData', filePath),
  ocrFile: (filePath) => invoke('file:ocr', filePath),
  testNotify: () => invoke('notify:test'),
  checkReminders: () => invoke('notify:checkNow'),

  onState: (callback) => subscribe('state:changed', callback),
  onNavigate: (callback) => subscribe('ui:navigate', callback),
  onWindowResized: (callback) => subscribe('window:resized', callback),
  onRefit: (callback) => subscribe('widget:refit', callback),
  onRemind: (callback) => subscribe('remind', callback),
  requestProof: (id) => invoke('task:requestProof', id),
  onProofRequest: (callback) => subscribe('ui:proof', callback)
});
