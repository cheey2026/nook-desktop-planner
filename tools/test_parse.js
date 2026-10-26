'use strict';

// 单元自测：node tools/test_parse.js
const path = require('node:path');
const assert = require('node:assert');

require(path.join(__dirname, '..', 'src', 'renderer', 'shared', 'parsePlan.js'));
const { parse, normalizeOcr } = globalThis.NookParse;

// 固定"今天"为 2026-10-22（周四），避免测试随时间漂移
const NOW = new Date(2026, 9, 22, 9, 0, 0);
let passed = 0;

function check(name, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    console.log(`✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`✗ ${name}\n  实际: ${JSON.stringify(actual)}\n  期望: ${JSON.stringify(expected)}`);
    process.exitCode = 1;
  }
}

check('明天+时间+链接', parse('明天 10:00 提交季度报销单 https://example.com/report', NOW), [
  { title: '提交季度报销单', date: '2026-10-23', time: '10:00', link: 'https://example.com/report' }
]);

check('周四下午沟通', parse('周四 下午 3:30 和设计团队评审方案', NOW), [
  { title: '和设计团队评审方案', date: '2026-10-22', time: '15:30', link: '' }
]);

check('具体日期', parse('10月28日 整理本周项目进度并写邮件', NOW), [
  { title: '整理本周项目进度并写邮件', date: '2026-10-28', time: '', link: '' }
]);

check('列表符号', parse('- 晚上慢跑 3 公里\n2. 读 30 页《深度工作》', NOW), [
  { title: '晚上慢跑3公里', date: '2026-10-22', time: '', link: '' },
  { title: '读30页《深度工作》', date: '2026-10-22', time: '', link: '' }
]);

check('后天+中午', parse('后天中午前回复客户报价单', NOW), [
  { title: '中午前回复客户报价单', date: '2026-10-24', time: '', link: '' }
]);

check('下周三点半', parse('下周三 9点半 交周报', NOW), [
  { title: '交周报', date: '2026-10-28', time: '09:30', link: '' }
]);

check('纯链接', parse('明天看 https://www.notion.so/page', NOW), [
  { title: '看', date: '2026-10-23', time: '', link: 'https://www.notion.so/page' }
]);

check('OCR 归一化', normalizeOcr('明 天 1 0 ： 00 提 交 季 度 报 销 单'), '明天10:00提交季度报销单');

check('OCR 后解析', parse('明 天 1 0 ： 00 提 交 季 度 报 销 单 https://example.com/report', NOW), [
  { title: '提交季度报销单', date: '2026-10-23', time: '10:00', link: 'https://example.com/report' }
]);

check('去重', parse('买菜\n买菜\n今天买菜', NOW).length, 1);

console.log(`\n${passed} 项通过`);
