'use strict';

/** 生成用于自检的演示数据：node tools/seed_demo.js <profileDir> [--reset] [--with-goals] [--manual-size] */

const path = require('node:path');
const fs = require('node:fs');
const { Store, dateKey, addDays } = require('../src/store');

const dir = process.argv[2] || path.join(__dirname, '..', '.testprofile');
const reset = process.argv.includes('--reset');
const withGoals = process.argv.includes('--with-goals');

fs.mkdirSync(dir, { recursive: true });
const store = new Store(dir);
const today = dateKey();

if (reset) {
  store.data.tasks = [];
  store.data.goals = [];
  store.data.summaries = [];
}

if (store.data.tasks.length === 0) {
  const done = store.addTask({
    title: '整理本周项目进度，把风险点写成邮件',
    date: today,
    link: 'https://mail.qq.com',
    start: '09:30',
    end: '10:00'
  });
  if (done) store.toggleTask(done.id, true);

  store.addTask({ title: '给桌面计划表加上完成动画', date: today });
  store.addTask({
    title: '读 30 页《深度工作》并记两条笔记',
    date: today,
    link: 'https://www.notion.so',
    start: '20:30'
  });
  store.addTask({ title: '晚上慢跑 3 公里', date: today, start: '21:30', end: '22:00' });

  store.addTask({ title: '回复设计稿的评审意见', date: addDays(today, -2), link: 'C:\\Windows\\System32\\notepad.exe' });
  store.addTask({ title: '提交季度报销单', date: addDays(today, -4) });

  store.addTask({ title: '给爸妈打个电话', date: addDays(today, 1) });
  store.addTask({ title: '准备下周一的项目周会材料', date: addDays(today, 3), link: 'https://www.feishu.cn' });
}

if (withGoals && store.data.goals.length === 0) {
  const goal = store.addGoal({
    title: '三个月内跑完半程马拉松',
    startDate: addDays(today, -20),
    endDate: addDays(today, 70),
    note: '每周三次跑量，周末长距离'
  });
  const goalId = goal && goal.id ? goal.id : store.data.goals[store.data.goals.length - 1].id;
  store.addTask({ title: '慢跑 5 公里（配速 6:30）', date: today, parentId: goalId });
  store.addTask({ title: '报名 11 月的半马', date: addDays(today, 2), parentId: goalId, needsCheck: true });
  const doneChild = store.addTask({ title: '买一双缓震跑鞋', date: addDays(today, -3), parentId: goalId });
  if (doneChild) store.toggleTask(doneChild.id, true);

  const goal2 = store.addGoal({
    title: '把《深度工作》读完并写读书笔记',
    startDate: addDays(today, -6),
    endDate: addDays(today, 24)
  });
  const g2 = goal2 && goal2.id ? goal2.id : store.data.goals[store.data.goals.length - 1].id;
  store.addTask({ title: '读第 3 章：远离社交媒体', date: addDays(today, 1), parentId: g2, start: '19:00', end: '20:00' });
}

store.save();

if (process.argv.includes('--manual-size')) {
  store.updateSettings({ widget: { autoHeight: false, width: 380, height: 520 } });
}

console.log(JSON.stringify({ dir, tasks: store.data.tasks.length, goals: store.data.goals.length, today }, null, 2));
