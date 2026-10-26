/* eslint-disable no-console */
// 验证 ai.js 的空内容自动重试：mock 服务在 max_tokens < 100 时故意返回空 content
const { AiClient } = require('../src/ai');

const settings = {
  enabled: true,
  provider: 'custom',
  baseUrl: 'http://127.0.0.1:8710/v1',
  model: 'mock-chat',
  visionModel: 'mock-vl',
  apiKeyEnc: 'plain:test',
  useVision: true
};

const client = new AiClient(() => settings);

(async () => {
  let failed = 0;
  const check = (name, ok, detail) => {
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // 1) 预算过小 → 服务端返回空内容 → 应自动放大预算重试成功
  const starved = await client.chat(
    [{ role: 'system', content: '计划拆解助手' }, { role: 'user', content: '生成三天计划' }],
    { json: false, maxTokens: 16, timeout: 8000 }
  );
  check('空内容自动重试', starved.ok && starved.content.length > 0, starved.error || starved.content.slice(0, 40));

  // 2) 连通性测试（走 test()，预算 200）
  const test = await client.test();
  check('连通性测试', test.ok === true, test.error || test.reply);

  // 3) 识别链路仍然可用
  const rec = await client.recognize({ text: '明天下午三点交报告', dateHint: '2026-10-26 周一' });
  check('识别链路', rec.ok && Array.isArray(rec.items) && rec.items.length > 0, rec.error || `${rec.items?.length} 条`);

  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
