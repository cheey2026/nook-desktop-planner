'use strict';

/**
 * AI 能力（可选，默认关闭）。
 * 走 OpenAI 兼容的 /chat/completions 接口：
 *  - DeepSeek   https://api.deepseek.com
 *  - 通义千问   https://dashscope.aliyuncs.com/compatible-mode/v1
 *  - Kimi       https://api.moonshot.cn/v1
 *  - 智谱 GLM   https://open.bigmodel.cn/api/paas/v4
 *  - 任意 OpenAI 兼容服务（自定义）
 *
 * 全部调用都在主进程完成，key 只存在本机（safeStorage 加密）。
 */

const { safeStorage } = require('electron');

const PRESETS = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    // deepseek-flash 同时支持文字与图片；deepseek-chat 已下线
    model: 'deepseek-flash',
    visionModel: 'deepseek-flash',
    vision: true
  },
  dashscope: {
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-flash',
    visionModel: 'qwen-vl-plus',
    vision: true
  },
  moonshot: {
    label: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    visionModel: 'moonshot-v1-8k-vision-preview',
    vision: true
  },
  zhipu: {
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    visionModel: 'glm-4v-flash',
    vision: true
  },
  custom: {
    label: '自定义（OpenAI 兼容）',
    baseUrl: '',
    model: '',
    visionModel: '',
    vision: true
  }
};

const PROVIDER_ORDER = ['deepseek', 'dashscope', 'moonshot', 'zhipu', 'custom'];

const SYSTEM_PROMPT = [
  '你是一个待办清单解析器，服务于桌面计划表应用。',
  '用户会给你一段从别处复制来的文字（聊天记录、邮件、会议纪要、网页片段），或者一张截图里识别出的文字。',
  '请把其中隐含的待办事项提取成结构化列表。',
  '规则：',
  '1. 只提取真正要“做”的事情，忽略寒暄、署名、纯资讯、广告。',
  '2. 每条任务标题精炼到 20 字以内，保留关键对象；不要加序号、书名号、引号。',
  '3. 能推断出日期就填 date（格式 YYYY-MM-DD，今天由用户消息告知），提到“每天/每周”等重复事项填 recur。',
  '4. 能推断出时间填 start（HH:mm），有时间段填 end；没提到就留空字符串。',
  '5. 文本里出现链接就放进 link（完整 URL）；提到具体文件名/软件可放进 note。',
  '6. 任务属于某个长期目标时填 goal（用用户给出的目标标题原文）。',
  '7. 不要虚构任务；宁可少不要多。',
  '只输出 JSON，形如：',
  '{"tasks":[{"title":"...","date":"YYYY-MM-DD","start":"","end":"","link":"","note":"","goal":"","recur":""}]}'
].join('\n');

const SUMMARY_PROMPT = [
  '你是一个温和的效率教练。',
  '用户会给你他某一天的计划完成情况（JSON）。',
  '请用中文写两段简短文字：',
  '1. summary：60 字以内的完成情况总结，语气积极但不说空话，可引用具体数字与任务名。',
  '2. tips：40 字以内的一条可执行建议（比如明日优先做什么、哪类任务总拖延）。',
  '只输出 JSON：{"summary":"...","tips":"..."}'
].join('\n');

const PLAN_PROMPT = [
  '你是一个计划拆解助手。',
  '用户会给你一个目标、可用天数、每天大概能投入的分钟数。',
  '请把它拆成每天可执行的小任务，输出 JSON：',
  '{"tasks":[{"title":"...","date":"YYYY-MM-DD","start":"","end":"","note":""}]}',
  '要求：',
  '1. 只输出 JSON，不要解释。',
  '2. 从今天开始排，日期用 YYYY-MM-DD，跨度不超过用户给的天数。',
  '3. 每天任务数量要符合投入时间（例如 30 分钟就 1-2 条），每条 20 字以内。',
  '4. 第一天的第一条尽量是“列出…清单/明确…范围”这种起步动作。',
  '5. 周日可选留空休息，不必每天都有。'
].join('\n');

const BREAKDOWN_PROMPT = [
  '你是一个长期目标拆解助手。',
  '用户会给你一个长期目标、起止日期、每周大概能做几次。',
  '请把它拆成一组具体任务，输出 JSON：',
  '{"tasks":[{"title":"...","date":"YYYY-MM-DD","start":"","end":"","note":""}]}',
  '只输出 JSON。每条任务 20 字以内，日期在起止范围内均匀分布，不超过 12 条。'
].join('\n');

const PROOF_PROMPT = [
  '你在核对一条待办是否真的完成了。',
  '用户会给你任务描述和一张截图/照片作为凭证。',
  '判断凭证能否支持“已完成”这个结论（例如：交作业 → 作业页面/老师回复；跑步 → 运动记录；报销 → 提交成功页）。',
  '只输出 JSON：{"ok":true或false,"reason":"20字以内中文理由"}',
  '宁可宽松：只要凭证看起来相关就返回 ok=true；完全无关（如风景照配“交作业”）返回 false。'
].join('\n');

function pickPreset(provider) {
  return PRESETS[provider] || PRESETS.custom;
}

class AiClient {
  constructor(getSettings) {
    this.getSettings = getSettings;
  }

  config() {
    const ai = this.getSettings() || {};
    const preset = pickPreset(ai.provider);
    return {
      enabled: Boolean(ai.enabled),
      provider: ai.provider || 'deepseek',
      baseUrl: (ai.baseUrl || preset.baseUrl || '').replace(/\/+$/, ''),
      model: ai.model || preset.model || '',
      visionModel: ai.visionModel || preset.visionModel || '',
      apiKey: decrypt(ai.apiKeyEnc),
      useVision: Boolean(ai.useVision)
    };
  }

  ready(needVision = false) {
    const cfg = this.config();
    if (!cfg.enabled) return { ok: false, error: '没有开启 AI 功能，请在「设置 → AI 助手」里打开' };
    if (!cfg.apiKey) return { ok: false, error: '还没有填写 API Key，请在「设置 → AI 助手」里填写' };
    if (!cfg.baseUrl) return { ok: false, error: '接口地址为空，请选择服务商或填写 Base URL' };
    if (!cfg.model) return { ok: false, error: '模型名为空' };
    if (needVision && !cfg.visionModel) return { ok: false, error: '当前服务商没有配置视觉模型，无法识别图片' };
    return { ok: true, cfg };
  }

  async chat(messages, { json = true, timeout = 60000, model, maxTokens = 1600 } = {}) {
    const state = this.ready(messages.some((m) => Array.isArray(m.content)));
    if (!state.ok) return { ok: false, error: state.error };
    const cfg = state.cfg;
    const url = `${cfg.baseUrl}/chat/completions`;

    // 单次请求：区分「HTTP 出错」「HTTP 通了但内容为空」两种情况
    const send = async (jsonMode, budget) => {
      const body = {
        model: model || cfg.model,
        messages,
        temperature: 0.2,
        max_tokens: budget
      };
      if (jsonMode) body.response_format = { type: 'json_object' };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey}`
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        const text = await res.text();
        if (!res.ok) {
          let detail = text.slice(0, 300);
          try {
            const parsed = JSON.parse(text);
            detail = parsed.error?.message || parsed.message || detail;
          } catch { /* 保留原文 */ }
          return { ok: false, error: `接口返回 ${res.status}：${detail}` };
        }
        let payload = {};
        try {
          payload = JSON.parse(text);
        } catch {
          return { ok: false, error: `接口返回的内容不是 JSON：${text.slice(0, 160)}` };
        }
        const choice = payload.choices?.[0] || {};
        // 推理模型可能把正文写进 reasoning_content，content 为空；两种都算有内容
        const content = choice.message?.content || '';
        if (!content || !String(content).trim()) {
          return {
            ok: false,
            empty: true,
            finish: choice.finish_reason || '',
            usage: payload.usage || null
          };
        }
        return { ok: true, content: String(content), usage: payload.usage || null };
      } catch (err) {
        if (err.name === 'AbortError') return { ok: false, error: '请求超时，请检查网络或改用更快的模型' };
        return { ok: false, error: `请求失败：${err.message}` };
      } finally {
        clearTimeout(timer);
      }
    };

    let out = await send(json, maxTokens);
    // 空内容最常见的原因是「推理模型的思考过程把 token 预算吃光了」：
    // 放大预算、去掉 JSON 约束再试一次，一般就能拿到正文。
    if (!out.ok && out.empty) {
      const budget = Math.min(Math.max(maxTokens * 8, 512), 4096);
      out = await send(false, budget);
    }
    if (out.ok) return out;
    if (out.empty) {
      const extra = out.finish === 'length'
        ? '（输出被 token 上限截断）'
        : out.usage
          ? `（本次用量 ${out.usage.total_tokens || 0} token）`
          : '';
      return { ok: false, error: `接口返回了空内容${extra}，自动放大预算重试后仍为空。可以换个模型，或检查账户额度` };
    }
    return out;
  }

  async test() {
    const state = this.ready();
    if (!state.ok) return { ok: false, error: state.error };
    const res = await this.chat(
      [
        { role: 'system', content: '你只需要回答两个字：可用' },
        { role: 'user', content: '连通性测试' }
      ],
      { json: false, timeout: 30000, maxTokens: 200 }
    );
    if (!res.ok) return res;
    return { ok: true, model: state.cfg.model, reply: res.content.trim().slice(0, 40) };
  }

  /** 文字 → 任务列表 */
  async recognize({ text = '', dateHint = '', goals = [], imageDataUrl = '' }) {
    const useVision = Boolean(imageDataUrl);
    if (useVision) {
      const state = this.ready(true);
      if (!state.ok) return state;
      const cfg = state.cfg;
      const b64 = String(imageDataUrl).replace(/^data:[^;]+;base64,/, '');
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `今天是 ${dateHint}（周几自行推算）。`,
                goals.length ? `用户的长期目标有：${goals.join(' / ')}。` : '',
                '下面这张图片里可能有日程/聊天/通知/作业清单，请提取其中的待办。'
              ].filter(Boolean).join('\n')
            },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }
          ]
        }
      ];
      const res = await this.chat(messages, { model: cfg.visionModel, timeout: 90000, maxTokens: 1200 });
      if (!res.ok) return res;
      return { ok: true, items: normalizeItems(safeJson(res.content)), provider: 'vision' };
    }

    const res = await this.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `今天是 ${dateHint}。`,
            goals.length ? `用户的长期目标有：${goals.join(' / ')}。` : '',
            '需要提取待办的文字如下（可能很零散）：',
            '"""',
            String(text).slice(0, 6000),
            '"""'
          ].filter(Boolean).join('\n')
        }
      ],
      { timeout: 60000, maxTokens: 1400 }
    );
    if (!res.ok) return res;
    return { ok: true, items: normalizeItems(safeJson(res.content)), provider: 'chat' };
  }

  /** 目标 → 未来几天的计划 */
  async plan({ goal = '', days = 7, minutes = 60, dateHint = '' }) {
    const res = await this.chat(
      [
        { role: 'system', content: PLAN_PROMPT },
        {
          role: 'user',
          content: `今天：${dateHint}\n目标：${goal}\n天数：${days}\n每天可用：${minutes} 分钟`
        }
      ],
      { timeout: 90000, maxTokens: 1800 }
    );
    if (!res.ok) return res;
    return { ok: true, items: normalizeItems(safeJson(res.content)) };
  }

  /** 长期目标 → 一批任务 */
  async breakdown({ goal = '', startDate = '', endDate = '', timesPerWeek = 7 }) {
    const res = await this.chat(
      [
        { role: 'system', content: BREAKDOWN_PROMPT },
        { role: 'user', content: `目标：${goal}\n起：${startDate}\n止：${endDate}\n每周可做：${timesPerWeek} 次` }
      ],
      { timeout: 90000, maxTokens: 1800 }
    );
    if (!res.ok) return res;
    return { ok: true, items: normalizeItems(safeJson(res.content)) };
  }

  /** 一天的计划 → 总结 + 建议 */
  async summary({ date = '', done = [], pending = [], overdue = [] }) {
    const res = await this.chat(
      [
        { role: 'system', content: SUMMARY_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({ date, done, pending, overdue }).slice(0, 4000)
        }
      ],
      { timeout: 60000, maxTokens: 600 }
    );
    if (!res.ok) return res;
    const parsed = safeJson(res.content) || {};
    return {
      ok: true,
      summary: String(parsed.summary || '').slice(0, 600),
      tips: String(parsed.tips || '').slice(0, 300)
    };
  }

  /** 截图凭证 → 是否完成 */
  async checkProof({ title = '', note = '', imageDataUrl = '' }) {
    const state = this.ready(true);
    if (!state.ok) return state;
    const cfg = state.cfg;
    const b64 = String(imageDataUrl).replace(/^data:[^;]+;base64,/, '');
    const res = await this.chat(
      [
        { role: 'system', content: PROOF_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: `任务：${title}\n补充：${note || '无'}` },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }
          ]
        }
      ],
      { model: cfg.visionModel, timeout: 90000, maxTokens: 200 }
    );
    if (!res.ok) return res;
    const parsed = safeJson(res.content) || {};
    return { ok: true, pass: Boolean(parsed.ok), reason: String(parsed.reason || '').slice(0, 120) };
  }
}

function safeJson(text) {
  const raw = String(text || '').trim();
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  let data = tryParse(raw);
  if (data) return data;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fenced) {
    data = tryParse(fenced[1].trim());
    if (data) return data;
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    data = tryParse(raw.slice(start, end + 1));
    if (data) return data;
  }
  return null;
}

function normalizeItems(data) {
  const list = Array.isArray(data?.tasks) ? data.tasks : Array.isArray(data) ? data : [];
  const pads = (n) => String(n).padStart(2, '0');
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const title = String(item.title || item.task || item.name || '').trim();
      if (!title) return null;
      const rawDate = String(item.date || '').trim();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : '';
      const time = (v) => {
        const m = /^(\d{1,2})[:：](\d{2})/.exec(String(v || '').trim());
        if (!m) return '';
        const h = Number(m[1]);
        const mi = Number(m[2]);
        if (h > 23 || mi > 59) return '';
        return `${pads(h)}:${pads(mi)}`;
      };
      return {
        title: title.slice(0, 120),
        date,
        start: time(item.start),
        end: time(item.end),
        link: String(item.link || '').slice(0, 600),
        note: [String(item.note || '').trim(), String(item.goal || '').trim()].filter(Boolean).join(' · ').slice(0, 400),
        recur: String(item.recur || '').slice(0, 20)
      };
    })
    .filter(Boolean)
    .slice(0, 30);
}

/* ------------------------------------------------------------ key 加密 */

function encrypt(plain) {
  const text = String(plain || '');
  if (!text) return '';
  if (!safeStorage.isEncryptionAvailable()) return `plain:${text}`;
  try {
    return `safe:${safeStorage.encryptString(text).toString('base64')}`;
  } catch {
    return `plain:${text}`;
  }
}

function decrypt(stored) {
  const text = String(stored || '');
  if (!text) return '';
  if (text.startsWith('plain:')) return text.slice(6);
  if (text.startsWith('safe:')) {
    try {
      return safeStorage.decryptString(Buffer.from(text.slice(5), 'base64'));
    } catch {
      return '';
    }
  }
  return '';
}

function maskKey(stored) {
  const key = decrypt(stored);
  if (!key) return '';
  if (key.length <= 8) return `${key.slice(0, 2)}••••`;
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

module.exports = { AiClient, PRESETS, PROVIDER_ORDER, encrypt, decrypt, maskKey, safeJson };
