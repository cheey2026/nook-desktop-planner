'use strict';

/**
 * 把一段自然语言（聊天记录、待办清单、OCR 结果）拆成任务列表。
 * 识别：日期（今天/明天/后天/周X/下周X/M月D日）、时间（10:00、下午3点半）、链接。
 * 浏览器和主进程都能直接用：const { parse, normalizeOcr } = NookParse
 */
(function (root) {
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 0 };
  const PM_WORDS = ['下午', '傍晚', '晚上', '夜里', '晚', '今晚', '明晚'];

  function normalizeOcr(text) {
    return String(text || '')
      .replace(/：/g, ':')
      .replace(/[\u3000]/g, ' ')
      .replace(/(?<=[\u4e00-\u9fa5])[ \t]+(?=[\u4e00-\u9fa5])/g, '')
      .replace(/(?<=\d)[ \t]+(?=[年月日号周点时分])/g, '')
      .replace(/(?<=\d)[ \t]+(?=[\d:：])/g, '')
      .replace(/(?<=[\d:：])[ \t]+(?=\d)/g, '')
      .replace(/(?<=\d)[ \t]+(?=[\u4e00-\u9fa5])/g, '')
      .replace(/(?<=[\u4e00-\u9fa5])[ \t]+(?=\d)/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function stripBullet(line) {
    let s = String(line || '').trim();
    s = s.replace(/^[-–—*•·+▪▫>]+\s*/, '');
    s = s.replace(/^[（(【\[]?\d{1,2}[)）】\].、]\s*/, '');
    s = s.replace(/^(待办|todo|TODO)[:：]\s*/, '');
    return s.trim();
  }

  function nextWeekday(now, target) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const delta = (target - base.getDay() + 7) % 7;
    base.setDate(base.getDate() + delta);
    return base;
  }

  function weekdayOfNextWeek(now, target, weeksAhead = 0) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const untilMonday = (8 - base.getDay()) % 7 || 7;
    const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate() + untilMonday + weeksAhead * 7);
    const offset = target === 0 ? 6 : target - 1;
    monday.setDate(monday.getDate() + offset);
    return monday;
  }

  function extractDate(text, now) {
    let s = text;
    let date = '';

    const simple = [
      [/大后天/, 3],
      [/(今天|今日|今儿|今晚)/, 0],
      [/(明天|明日|明早|明晚)/, 1],
      [/后天/, 2]
    ];
    for (const [re, offset] of simple) {
      const m = s.match(re);
      if (!m) continue;
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      d.setDate(d.getDate() + offset);
      date = dayKey(d);
      s = s.replace(m[0], ' ');
      break;
    }
    if (date) return { text: s, date };

    const wd = s.match(/(下下|下|这|本)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/);
    if (wd) {
      const target = WEEKDAY[wd[2]];
      let d;
      if (wd[1] === '下下') d = weekdayOfNextWeek(now, target, 1);
      else if (wd[1] === '下') d = weekdayOfNextWeek(now, target, 0);
      else d = nextWeekday(now, target);
      date = dayKey(d);
      s = s.replace(wd[0], ' ');
      return { text: s, date };
    }

    const md = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/);
    if (md) {
      const month = Number(md[1]);
      const day = Number(md[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const d = new Date(now.getFullYear(), month - 1, day);
        date = dayKey(d);
        s = s.replace(md[0], ' ');
        return { text: s, date };
      }
    }

    const slash = s.match(/(\d{1,2})\s*[-/]\s*(\d{1,2})(?![\d:：])/);
    if (slash) {
      const month = Number(slash[1]);
      const day = Number(slash[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const d = new Date(now.getFullYear(), month - 1, day);
        date = dayKey(d);
        s = s.replace(slash[0], ' ');
      }
    }
    return { text: s, date };
  }

  function toHour(mod, hour, minute) {
    let h = hour;
    if (mod && PM_WORDS.includes(mod) && h < 12) h += 12;
    if (mod === '中午' && h < 11) h += 12;
    if (h >= 24) h = h - 12;
    return `${pad(h)}:${pad(minute)}`;
  }

  function extractTime(text) {
    let s = text;
    const colon = s.match(/(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2})\s*[:：]\s*(\d{1,2})/);
    if (colon) {
      const hour = Number(colon[2]);
      const minute = Number(colon[3]);
      if (hour <= 24 && minute <= 59) {
        s = s.replace(colon[0], ' ');
        return { text: s, time: toHour(colon[1], hour, minute) };
      }
    }
    const dot = s.match(/(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)?\s*(\d{1,2})\s*[点时]\s*(半|\d{1,2}\s*分?)?/);
    if (dot) {
      const hour = Number(dot[2]);
      let minute = 0;
      if (dot[3] === '半') minute = 30;
      else if (dot[3]) minute = Number(String(dot[3]).replace(/[^\d]/g, '')) || 0;
      if (hour <= 24 && minute <= 59) {
        s = s.replace(dot[0], ' ');
        return { text: s, time: toHour(dot[1], hour, minute) };
      }
    }
    return { text: s, time: '' };
  }

  function extractLink(text) {
    const m = text.match(/https?:\/\/[^\s，。；、)）]+/i) || text.match(/www\.[^\s，。；、)）]+/i);
    if (!m) return { text, link: '' };
    let link = m[0];
    if (!/^https?:\/\//i.test(link)) link = `https://${link}`;
    return { text: text.replace(m[0], ' '), link };
  }

  function tidyTitle(text) {
    return String(text || '')
      .replace(/[，,、]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s\-–—:：,，。.、]+/, '')
      .replace(/^[\s\-–—:：,，。.、]+$/, '')
      .trim();
  }

  function parseLine(line, now) {
    const cleaned = stripBullet(line);
    if (!cleaned) return null;

    let work = cleaned;
    const link = extractLink(work);
    work = link.text;
    const time = extractTime(work);
    work = time.text;
    const date = extractDate(work, now);
    work = date.text;

    const title = tidyTitle(work);
    if (!title && !link.link) return null;
    return {
      title: title || '（无标题，来自剪贴板）',
      date: date.date || dayKey(now),
      time: time.time || '',
      link: link.link || ''
    };
  }

  function parse(text, now = new Date()) {
    const source = normalizeOcr(text);
    const lines = source.split(/\r?\n/);
    const out = [];
    const seen = new Set();
    for (const line of lines) {
      if (!line.trim()) continue;
      if (/^[\s\-–—_=*]{2,}$/.test(line)) continue;
      const item = parseLine(line, now);
      if (!item) continue;
      const key = `${item.title}|${item.date}|${item.time}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= 40) break;
    }
    return out;
  }

  const api = { parse, parseLine, normalizeOcr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NookParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
