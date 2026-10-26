'use strict';

/**
 * 本地假 AI 接口，用来端到端验证 Nook 的 AI 链路（不花钱、不联网）。
 * 用法：node tools/mock-ai.js [port]   （默认 8710）
 * 然后在「设置 → AI 助手」里选「自定义」，接口地址填 http://127.0.0.1:8710/v1，Key 随便写。
 */

const http = require('node:http');

const port = Number(process.argv[2] || 8710);

const RECOGNIZE = {
  tasks: [
    { title: '提交季度报销单', date: '', start: '10:00', end: '', link: '', note: '财务系统', parent_hint: '' },
    { title: '和设计团队评审方案', date: '', start: '15:30', end: '16:30', link: 'https://example.com/review' },
    { title: '整理本周项目进度并写邮件', date: '', start: '', end: '', link: 'https://mail.qq.com' },
    { title: '回复客户报价单', date: '', start: '', end: '' }
  ]
};

const PLAN = {
  tasks: [
    { title: '看 20 分钟课程视频', date_offset: 0, start: '20:00', end: '20:30' },
    { title: '动手练一遍今天的内容', date_offset: 1, start: '20:00', end: '21:00' },
    { title: '整理一份一页笔记', date_offset: 2, start: '19:30', end: '20:00' }
  ]
};

const BREAKDOWN = {
  tasks: [
    { title: '今天先跑 3 公里找找感觉', date: '', start: '21:00', end: '21:40' },
    { title: '周三做一次间歇跑', date: '', start: '19:30', end: '20:10' },
    { title: '周日长距离 8 公里', date: '', start: '08:00', end: '09:10' },
    { title: '买一双缓震跑鞋（截图发我）', date: '', start: '', end: '', need_proof: true }
  ]
};

const SUMMARY = {
  summary: '今天完成了 2 件事，节奏比昨天稳；晚上那件慢跑没做完，被你顺延到了明天。',
  tips: '把最费脑的事放在上午，晚上只留轻任务；明天的三件事里，先做报销单，它已经拖了 4 天。'
};

const PROOF = { ok: true, reason: '截图里能看到提交成功的提示，可以判定完成。' };

function pickReply(systemPrompt) {
  if (systemPrompt.includes('待办清单解析器')) return JSON.stringify(RECOGNIZE);
  if (systemPrompt.includes('计划拆解助手')) return JSON.stringify(PLAN);
  if (systemPrompt.includes('长期目标拆解助手')) return JSON.stringify(BREAKDOWN);
  if (systemPrompt.includes('温和的效率教练')) return JSON.stringify(SUMMARY);
  if (systemPrompt.includes('核对一条待办')) return JSON.stringify(PROOF);
  return JSON.stringify({ reply: '可用' });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mock: true }));
    return;
  }
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      body = {};
    }
    const system = (body.messages || []).find((m) => m.role === 'system');
    const systemText = typeof system?.content === 'string' ? system.content : '';
    // 模拟「推理模型把预算吃光、只回空内容」：预算过小时故意返回空
    const starved = Number(body.max_tokens || 0) > 0 && Number(body.max_tokens) < 100;
    const content = starved ? '' : pickReply(systemText || '');
    const payload = {
      id: 'mock-' + Date.now(),
      object: 'chat.completion',
      model: body.model || 'mock',
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: starved ? 'length' : 'stop'
      }],
      usage: { prompt_tokens: 10, completion_tokens: starved ? 0 : 10, total_tokens: starved ? 10 : 20 }
    };
    console.log(`[mock-ai] ${body.model || '?'} -> ${content.slice(0, 60)}…`);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-ai] listening on http://127.0.0.1:${port}/v1`);
});
