/* 界面语言：默认中文，可在「设置 → 语言」切换 */
(function (root) {
  const DICT = {
    zh: {
      'nav.today': '今日',
      'nav.board': '计划板',
      'nav.goals': '长期',
      'nav.done': '已完成',
      'nav.settings': '设置',
      'nav.hide': '隐藏组件',
      'tool.ai': 'AI 建议',
      'tool.summary': '今日小结',
      'tool.import': '文件导入',
      'add.placeholder': '写下下一件今天要做的事，回车添加…',
      'add.time': '时间',
      'add.recognize': '识别',
      'add.link': '链接',
      'add.submit': '添加',
      'sec.overdue': '超期计划',
      'sec.today': '今天的计划',
      'sec.doneCount': '已完成 {n} 件',
      'act.postpone': '全部顺延到今天',
      'act.done': '完成',
      'act.undo': '取消完成',
      'act.link': '改链接',
      'act.del': '删除',
      'act.proof': '凭证',
      'act.time': '时间',
      'empty.today': '今天的事都做完了，享受这份轻松吧',
      'goals.title': '长期计划',
      'goals.new': '＋ 新建目标',
      'goals.break': '帮我拆',
      'goals.addPlaceholder': '给这个目标加一件事，回车添加…',
      'goals.doneCount': '已完成 {done} / {total} 件',
      'set.lang': '语言',
      'set.langHint': '界面语言，默认中文',
      'set.content': '桌面组件内容',
      'set.look': '外观与尺寸',
      'set.window': '窗口与启动',
      'set.remind': '提醒',
      'set.ai': 'AI 助手',
      'set.data': '数据',
      'btn.cancel': '取消',
      'btn.save': '保存',
      'btn.close': '知道了',
      'rec.title': '识别待办',
      'rec.hint': '把要识别的文字贴进来：待办、聊天记录、通知、课程安排都行。',
      'rec.placeholder': '在这里粘贴或输入…',
      'rec.run': '开始识别',
      'rec.image': '选择图片',
      'rec.paste': '从剪贴板粘贴',
      'widget.settings': '设置',
      'widget.open': '打开计划表',
      'widget.quit': '退出',
      'widget.hide': '隐藏',
      'widget.fit': '高度自适应',
      'widget.top': '显示在最上层',
      'widget.overdue': '超期',
      'widget.today': '今天的计划',
      'widget.next': '接下来',
      'widget.todayDone': '今天已完成',
      'widget.postpone': '顺延到今天',
      'widget.daysLate': '逾期 {n} 天',
      'widget.foot': '双击标题栏打开计划表',
      'widget.empty': '今天没有安排，先写一件小事吧',
      'widget.emptyDone': '今天的事都做完了，享受这份轻松吧',
      'ring.done': '完成',
      'stat.today': '今日完成',
      'stat.overdue': '超期未办',
      'side.hint': '点击桌面组件上的圆圈也能完成任务',
      'act.doneAt': '完成于 {time}',
      'act.moveToday': '挪到今天',
      'act.postponeOne': '顺延',
      'hero.empty': '今天还没有安排，写下第一件小事吧。',
      'hero.pushing': '稳步推进中',
      'hero.allDone': '任务都完成了',
      'hero.blank': '留白的一天',
      'cfg.showWidget': '显示组件',
      'cfg.hideWidget': '隐藏组件',
      'cfg.pasteKey': '粘贴你的 Key',
      'cfg.about': 'Nook v1.0 · 任务数据只保存在本机；只有开启 AI 后，识别/排计划/小结/凭证检查才会把你提供的那段内容发给所选服务商。按 Ctrl + Alt + P 可以随时唤出这个窗口。'
    },
    en: {
      'nav.today': 'Today',
      'nav.board': 'Board',
      'nav.goals': 'Goals',
      'nav.done': 'Done',
      'nav.settings': 'Settings',
      'nav.hide': 'Hide widget',
      'tool.ai': 'AI suggest',
      'tool.summary': 'Daily recap',
      'tool.import': 'Import file',
      'add.placeholder': 'Next thing for today, press Enter…',
      'add.time': 'Time',
      'add.recognize': 'Recognize',
      'add.link': 'Link',
      'add.submit': 'Add',
      'sec.overdue': 'Overdue',
      'sec.today': "Today's plan",
      'sec.doneCount': '{n} done',
      'act.postpone': 'Move all to today',
      'act.done': 'Done',
      'act.undo': 'Undo',
      'act.link': 'Link',
      'act.del': 'Delete',
      'act.proof': 'Proof',
      'act.time': 'Time',
      'empty.today': 'Nothing left today — enjoy it',
      'goals.title': 'Long-term goals',
      'goals.new': '+ New goal',
      'goals.break': 'Break it down',
      'goals.addPlaceholder': 'Add a task to this goal, press Enter…',
      'goals.doneCount': '{done} / {total} done',
      'set.lang': 'Language',
      'set.langHint': 'Interface language, Chinese by default',
      'set.content': 'Widget content',
      'set.look': 'Look & size',
      'set.window': 'Window & startup',
      'set.remind': 'Reminders',
      'set.ai': 'AI assistant',
      'set.data': 'Data',
      'btn.cancel': 'Cancel',
      'btn.save': 'Save',
      'btn.close': 'Got it',
      'rec.title': 'Recognize tasks',
      'rec.hint': 'Paste text to recognize: to-dos, chats, notices, class schedules.',
      'rec.placeholder': 'Paste or type here…',
      'rec.run': 'Recognize',
      'rec.image': 'Pick image',
      'rec.paste': 'Paste clipboard',
      'widget.settings': 'Settings',
      'widget.open': 'Open planner',
      'widget.quit': 'Quit',
      'widget.hide': 'Hide',
      'widget.fit': 'Auto height',
      'widget.top': 'Always on top',
      'widget.overdue': 'Overdue',
      'widget.today': "Today's plan",
      'widget.next': 'Up next',
      'widget.todayDone': 'Done today',
      'widget.postpone': 'Move to today',
      'widget.daysLate': '{n}d overdue',
      'widget.foot': 'Double-click the title to open the planner',
      'widget.empty': 'Nothing planned — add one small thing',
      'widget.emptyDone': 'All done today. Enjoy it',
      'ring.done': 'done',
      'stat.today': 'done today',
      'stat.overdue': 'overdue',
      'side.hint': 'Click the circle in the desktop widget to finish a task',
      'act.doneAt': 'Done at {time}',
      'act.moveToday': 'Move to today',
      'act.postponeOne': 'Postpone',
      'hero.empty': 'Nothing planned yet — write down one small thing.',
      'hero.pushing': 'Moving along',
      'hero.allDone': 'All done',
      'hero.blank': 'A blank day',
      'cfg.showWidget': 'Show widget',
      'cfg.hideWidget': 'Hide widget',
      'cfg.pasteKey': 'Paste your key',
      'cfg.about': 'Nook v1.0 · task data stays on this machine. Only when AI is enabled do recognition / planning / recap / proof checks send that piece of content to your provider. Press Ctrl + Alt + P to summon this window.'
    }
  };

  let lang = 'zh';

  function setLang(next) {
    if (DICT[next]) lang = next;
    return lang;
  }

  function getLang() {
    return lang;
  }

  function t(key, vars) {
    const table = DICT[lang] || DICT.zh;
    let text = table[key] != null ? table[key] : DICT.zh[key] != null ? DICT.zh[key] : key;
    if (vars) {
      Object.keys(vars).forEach((name) => {
        text = text.split(`{${name}}`).join(String(vars[name]));
      });
    }
    return text;
  }

  // 设置页等处的整句中文 → 英文对照（按整段文字匹配，逐条补即可）
  const ZH2EN = {
    '设置': 'Settings',
    '桌面组件的样子和行为都可以调整，修改后立刻生效。': 'Tweak how the widget looks and behaves — changes apply instantly.',
    '桌面组件内容': 'Widget content',
    '显示今天的计划': 'Show today',
    '组件里列出今天的待办': "List today's tasks in the widget",
    '显示超期计划': 'Show overdue',
    '逾期未完成的事情会置顶提醒': 'Unfinished past tasks stay on top',
    '显示已完成': 'Show finished',
    '完成的事情也在组件里保留一会儿': 'Keep finished tasks for a while',
    '显示未来计划': 'Show upcoming',
    '把明天及以后的安排也列出来': 'Include tomorrow and later',
    '显示完成进度': 'Show progress',
    '顶部进度条与 x/y 计数': 'Top progress bar and x/y count',
    '显示底部提示': 'Show footer hint',
    '一行小字，告诉你怎样打开计划表': 'One line telling you how to open the planner',
    '外观与尺寸': 'Look & size',
    '最多显示条数': 'Max items',
    '条数越多，组件越高': 'More items makes the widget taller',
    '背景不透明度': 'Background opacity',
    '调低会更通透，0.45 起可读性更好': 'Lower is more transparent; 0.45 keeps it readable',
    '文字大小': 'Font size',
    '单位 px': 'in px',
    '组件宽度': 'Widget width',
    '也可以直接拖动组件的边缘': 'You can also drag the widget edges',
    '高度自适应内容': 'Auto height',
    '关闭后可以用鼠标拖组件右下角自由调整大小': 'Turn off to resize by dragging the bottom-right corner',
    '组件高度': 'Widget height',
    '拖右下角或用这里调整': 'Drag the corner or adjust here',
    '主题色': 'Accent color',
    '薄荷': 'Mint',
    '晴空': 'Sky',
    '蜜桃': 'Peach',
    '紫藤': 'Lilac',
    '窗口与启动': 'Window & startup',
    '显示在窗口最上层': 'Always on top',
    '关掉后组件会留在桌面层，不再挡住其它窗口；也可以点组件标题栏的图钉或右键切换': 'When off the widget stays on the desktop layer; toggle with the pin or right-click',
    '开机自启动': 'Start with Windows',
    '登录 Windows 后自动运行，只显示桌面组件': 'Runs after sign-in and shows only the widget',
    '桌面组件': 'Desktop widget',
    '显示或隐藏，或者把它移回屏幕右上角': 'Show, hide, or move it back to the top-right corner',
    '显示组件': 'Show widget',
    '隐藏组件': 'Hide widget',
    '移回右上角': 'Move to top-right',
    '启动文件夹': 'Startup folder',
    '开机自启动会在系统启动文件夹里放一个脚本，可在这里查看或手动删除': 'Autostart drops a script in the Startup folder — open it or remove it manually',
    '打开': 'Open',
    '提醒': 'Reminders',
    '到点提醒我': 'Time reminders',
    '任务设了时间后，开始前和到点时会发系统通知，桌面组件里也会浮一条': 'When a task has a time, you get a system notification before and at the start',
    '提前多久提醒': 'Lead time',
    '0 表示只在开始时提醒（分钟）': '0 means only at the start (minutes)',
    '结束时也提醒': 'Remind at end',
    '方便知道这件事该收尾了': 'So you know when to wrap up',
    '提醒时出声': 'Play a sound',
    '默认静音，只在通知中心出现': 'Muted by default; appears in Action Center',
    '试一试': 'Try it',
    '现在发一条通知，确认系统没把它拦掉': 'Send one now to make sure Windows allows it',
    '发一条测试通知': 'Send test notification',
    '已开启': 'On',
    '未开启': 'Off',
    '启用 AI 能力': 'Enable AI',
    '使用你自己的 API Key，费用由服务商结算': 'Your own API key; billed by the provider',
    '服务商': 'Provider',
    '选好后会自动带出接口地址和模型名': 'Picking one fills in the endpoint and models',
    '接口地址': 'Endpoint',
    'OpenAI 兼容的 Base URL': 'OpenAI-compatible base URL',
    '文字模型': 'Text model',
    '识别文字、排计划、写小结用它': 'Used for text recognition, planning, recaps',
    '视觉模型': 'Vision model',
    '识别截图、检查凭证用它；留空则图片走本地 OCR': 'Used for screenshots and proofs; empty means local OCR',
    '还没有填写': 'not set',
    '粘贴你的 Key': 'Paste your key',
    '保存': 'Save',
    '连通性测试': 'Connection test',
    '发一句话试试，确认 Key 与地址可用': 'Send a short prompt to verify key and endpoint',
    '测试一下': 'Test',
    '默认需要凭证': 'Require proof by default',
    '开启后，新建任务会默认要求交一张截图凭证': 'New tasks will ask for a screenshot proof',
    '模型名需要更新': 'Model name needs updating',
    '一键改好': 'Fix it',
    '数据': 'Data',
    '数据文件': 'Data file',
    '打开文件夹': 'Open folder',
    '清空已完成': 'Clear finished',
    '只删除已完成记录，未完成的任务保留': 'Removes finished records only',
    '清空': 'Clear',
    '退出程序': 'Quit',
    '退出后桌面组件与托盘图标都会关闭': 'Closes the widget and tray icon too',
    '退出': 'Quit',
    '长期计划': 'Long-term goals',
    '新建目标': 'New goal',
    '＋ 新建目标': '+ New goal',
    '帮我拆': 'Break it down',
    '今天的事都做完了，享受这份轻松吧': 'Nothing left today. Enjoy it',
    '今天的计划': "Today's plan",
    '超期计划': 'Overdue',
    '已完成': 'Done',
    '计划板': 'Board',
    '全部顺延到今天': 'Move all to today'
  };

  function zh2en(text) {
    const key = String(text || '').trim();
    if (!key) return text;
    const hit = ZH2EN[key];
    return hit ? String(text).replace(key, hit) : text;
  }

  // 给带 data-i18n / data-i18n-ph / data-i18n-title 的静态标签换语言
  function apply(scope) {
    const rootEl = scope || document;
    rootEl.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    rootEl.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      el.placeholder = t(el.getAttribute('data-i18n-ph'));
    });
    rootEl.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    if (lang === 'en') translateDom(rootEl);
  }

  // 把还没翻译的整句中文按对照表换掉（只动纯文字节点，幂等）
  function translateDom(rootEl) {
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    const hits = [];
    let node = walker.nextNode();
    while (node) {
      const value = node.nodeValue;
      if (value && value.trim() && ZH2EN[value.trim()]) hits.push(node);
      node = walker.nextNode();
    }
    hits.forEach((textNode) => {
      textNode.nodeValue = zh2en(textNode.nodeValue);
    });
  }

  root.NookI18n = {
    t,
    setLang,
    getLang,
    apply,
    dict: DICT,
    langs: [
      { id: 'zh', label: '中文' },
      { id: 'en', label: 'English' }
    ]
  };
})(window);
