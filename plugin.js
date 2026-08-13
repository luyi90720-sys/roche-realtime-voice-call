(function () {
  'use strict';

  // ============================================================
  // 常量
  // ============================================================

  // 内置通话提示词
  var BUILTIN_PROMPT = [
    '你正在和 {{user}} 进行一通实时语音通话，你是 {{char}}。',
    '',
    '【角色设定】',
    '{{persona}}',
    '',
    '【用户人设】（正在和你通话的 user）',
    '{{user_persona}}',
    '',
    '【已知记忆】',
    '{{memory}}',
    '',
    '【通话风格】',
    '- 口语化、简短（1-3 句），像真实电话对话',
    '- 可用语气词：嗯、啊、诶、哦、嘿',
    '- 不用 markdown、列表、标题、分点',
    '- 不输出 thinking 标签、不写旁白、不写动作描写',
    '- 不说"作为AI""我是助手"之类的话',
    '',
    '【语气词标签】（minimax speech-2.8 模型才支持，TTS 会渲染为真实声音）',
    '可使用 (laughs) (chuckle) (sighs) (gasps) (humming) (breath) 等标签',
    '- 情绪到位时才用，每条回复最多 1 个，不要堆砌',
    '- 自然口语对话大多数时候不需要标签',
    '- 标签写在对应位置，如："你说什么？(laughs) 我没听清。"',
    '',
    '',
    '【用户语气标签】（情绪识别开启时，用户消息开头可能带有）',
    '形如 [音量:大][音高:高/紧张][情绪:激动/兴奋] 的标签，反映用户说话时的真实语气和情绪。',
    '- 据此调整你的回应语气和内容（用户激动时可安抚或共兴奋，平静时不必过度热情）',
    '- 自然融入，不要生硬复述标签，不要说“检测到你的情绪是XX”',
    '',
    '【硬性约束】',
    '- 只输出 {{char}} 在电话里说出口的话',
    '- 中文回复为主，可夹带少量外语若符合人设',
    '- 始终保持 {{char}} 的性格、口癖、说话方式',
    '- 通话感优先：听见 → 回应，可追问、附和、打断'
  ].join('\n');

  // 默认角色配置（默认不挂载任何记忆，user 手动选择和 char 相关的记忆）
  function makeDefaultCharConfig() {
    return {
      bg: { type: 'color', value: '' },
      voiceId: '',
      memory: {
        dm: { shortTermLimit: 0, factsLimit: 0, core: false },
        groups: []
      },
      worldbook: { enabled: false, categoryIds: [] },
      userPersonaId: '',  // 绑定的 user 人设 ID（空=用当前激活的 user）
      addedAt: 0
    };
  }

  // 默认全局设置
  var DEFAULT_SETTINGS = {
    silenceMs: 1800,
    bufferFlushMs: 2500,    // 攒够多句后, 停顿超过此值就整体发送给 char
    lang: 'zh-CN',              // STT 识别语言（同时影响 UI 默认显示）
    callLang: 'zh-CN',          // 通话语言（AI 回复用的语言）
    translateToChinese: false,  // 外语回复是否附加中文翻译（仅文字显示，不 TTS）
    defaultVoiceId: '',
    temperature: 0.8,
    callPrompt: '',
    historyLimit: 50,
    sttProvider: 'none',
    sttApiKey: '',
    sttModel: 'whisper-large-v3',
    // 音频预处理参数（降噪/滤波）
    vadThreshold: 0.025,         // VAD 触发阈值（上调以过滤环境噪音）
    maxRecordMs: 12000,
    minSpeakMs: 300,             // 说话时长下限：短于此值视为噪音脉冲丢弃
    highpassFreq: 85,            // 高通滤波截止频率（滤除低频电流声/风噪）
    noiseGateThreshold: 0.015,   // 噪声门阈值：低于此值直接静音
    // 通话模式：auto（自动检测停顿）/ ptt（按住说话，松开发送）
    callMode: 'auto',
    // 通话记录是否同步到聊天会话（默认不同步，需手动开启）
    syncToChat: false,
    // 悬浮语音球：任意页面可点击录音 → 转文字 → 注入输入框
    floatingBall: false,
    // TTS provider：roche（用 roche.voice.tts）/ minimax / elevenlabs
    ttsProvider: 'roche',
    minimaxApiKey: '',
    minimaxModel: 'speech-02-hd',
    minimaxEndpoint: '',
    elevenlabsApiKey: '',
    elevenlabsModel: 'eleven_multilingual_v2',
    // STT provider 扩展：mimo（小米, 限时免费, 中文极好）/ baidu（每日5h免费）/ wit（英文, 免费）
    mimoApiKey: '',
    baiduApiKey: '',
    baiduSecretKey: '',
    witToken: '',
    // 自托管 Whisper ASR Webservice (用户填 URL)
    whisperUrl: '',
    // Transformers.js 浏览器内 Whisper 模型选择 (tiny/base/small/medium)
    transformersModel: 'base',
    // 腾讯云一句话识别
    tencentAppId: '',
    tencentSecretId: '',
    tencentSecretKey: '',
    // 情绪识别：用 MediaRecorder 的 analyser 提取声学特征→规则映射成标签注入提示词
    // 仅 MediaRecorder 路径生效（webkit/Groq/MiMo/百度/腾讯/Wit/Transformers.js/自托管）
    // Vosk 流式路径音频在原生层，JS 拿不到，不识别情绪（标签为空，不影响原功能）
    emotionDetect: false,
    // 悬浮球注入后是否自动模拟回车发送（通话界面/聊天界面通用）
    floatAutoEnter: true
  };

  // ============================================================
  // SVG 图标（内联，不用 emoji）
  // ============================================================

  var SVG = {
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    phoneHangup: '<svg viewBox="0 0 24 24" fill="currentColor" width="30" height="30" style="transform:rotate(135deg)"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.92-.98.49-1.87 1.15-2.66 1.93-.18.18-.43.29-.71.29-.28 0-.53-.11-.71-.29L1.29 12.29c-.18-.18-.29-.43-.29-.71 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.42 3.88c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.47 2.47c-.18.18-.43.29-.71.29-.28 0-.53-.11-.71-.29-.79-.78-1.68-1.44-2.66-1.93-.33-.18-.56-.53-.56-.92v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>',
    keyboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
  };

  // 支持的通话语言
  var LANG_LABELS = {
    'zh-CN': '简体中文',
    'zh-TW': '繁体中文',
    'en-US': '美式英语',
    'en-GB': '英式英语',
    'ja-JP': '日语',
    'ko-KR': '韩语',
    'fr-FR': '法语',
    'de-DE': '德语',
    'es-ES': '西班牙语',
    'ru-RU': '俄语',
    'it-IT': '意大利语',
    'pt-PT': '葡萄牙语',
    'th-TH': '泰语',
    'vi-VN': '越南语',
    'ar-SA': '阿拉伯语'
  };

  // ============================================================
  // CSS 样式
  // ============================================================

  var CSS_TEXT = [
    '.rvc-root{--c-bg:#0d1117;--c-card:#161b22;--c-border:#30363d;--c-text:#e6edf3;--c-sub:#8b949e;--c-accent:#2ea043;--c-accent2:#388bfd;--c-danger:#f85149;--c-user:#1f6feb;height:100%;display:flex;flex-direction:column;background:var(--c-bg);color:var(--c-text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden;position:relative}',
    // 通用按钮
    '.rvc-btn{cursor:pointer;border:1px solid var(--c-border);background:var(--c-card);color:var(--c-text);padding:7px 14px;border-radius:8px;font-size:13px;transition:.15s;display:inline-flex;align-items:center;gap:6px}',
    '.rvc-btn:hover{border-color:var(--c-accent2);color:var(--c-accent2)}',
    '.rvc-btn.primary{background:var(--c-accent);border-color:var(--c-accent);color:#fff}',
    '.rvc-btn.primary:hover{opacity:.9;color:#fff}',
    '.rvc-btn.danger{background:var(--c-danger);border-color:var(--c-danger);color:#fff}',
    '.rvc-btn.danger:hover{opacity:.9;color:#fff}',
    '.rvc-btn.rvc-close-btn{padding:4px 10px;border-radius:8px;font-weight:bold;border:1px solid var(--c-border)}',
    '.rvc-btn.rvc-close-btn:hover{background:var(--c-danger);border-color:var(--c-danger);color:#fff}',
    '.rvc-btn.icon-btn{padding:6px;border-radius:8px}',
    // 顶栏
    '.rvc-topbar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--c-border);background:var(--c-card);flex-shrink:0}',
    '.rvc-topbar .title{flex:1;font-size:15px;font-weight:600}',
    // 主体
    '.rvc-body{flex:1;overflow-y:auto;padding:14px}',
    '.rvc-empty{text-align:center;color:var(--c-sub);padding:40px 0}',
    // 列表视图
    '.rvc-char-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}',
    '.rvc-char-card{display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 10px;border:1px solid var(--c-border);border-radius:12px;background:var(--c-card);cursor:pointer;transition:.15s;position:relative}',
    '.rvc-char-card:hover{border-color:var(--c-accent2);transform:translateY(-1px)}',
    '.rvc-char-card .avatar{width:56px;height:56px;border-radius:50%;object-fit:cover;background:var(--c-border);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;overflow:hidden}',
    '.rvc-char-card .avatar img{width:100%;height:100%;object-fit:cover}',
    '.rvc-char-card .name{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
    '.rvc-char-card .sub{font-size:11px;color:var(--c-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}',
    '.rvc-char-card .config-icon{position:absolute;top:6px;right:6px;width:28px;height:28px;border-radius:6px;border:none;background:transparent;color:var(--c-sub);cursor:pointer;display:flex;align-items:center;justify-content:center}',
    '.rvc-char-card .config-icon:hover{background:var(--c-bg);color:var(--c-text)}',
    '.rvc-add-btn{display:flex;align-items:center;justify-content:center;gap:6px;padding:14px;border:2px dashed var(--c-border);border-radius:12px;background:transparent;color:var(--c-sub);cursor:pointer;transition:.15s;font-size:14px}',
    '.rvc-add-btn:hover{border-color:var(--c-accent2);color:var(--c-accent2)}',
    // 配置视图
    '.rvc-config-view{display:flex;flex-direction:column;height:100%}',
    '.rvc-config-body{flex:1;overflow-y:auto;padding:14px}',
    '.rvc-section{border:1px solid var(--c-border);border-radius:10px;padding:14px;margin-bottom:12px;background:var(--c-card)}',
    '.rvc-section h3{margin:0 0 10px;font-size:14px}',
    '.rvc-section label{display:block;font-size:12px;color:var(--c-sub);margin:10px 0 4px}',
    '.rvc-section input[type=text],.rvc-section input[type=number],.rvc-section input[type=password],.rvc-section textarea,.rvc-section select{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;border:1px solid var(--c-border);background:var(--c-bg);color:var(--c-text);font-size:13px;font-family:inherit}',
    '.rvc-section textarea{min-height:80px;resize:vertical}',
    '.rvc-section input[type=color]{width:48px;height:32px;border:1px solid var(--c-border);border-radius:6px;background:var(--c-bg);cursor:pointer;padding:2px}',
    '.rvc-row{display:flex;gap:8px;align-items:center}',
    '.rvc-row>*{flex:1}',
    '.rvc-hint{font-size:11px;color:var(--c-sub);margin-top:4px;line-height:1.5}',
    '.rvc-toggle{display:flex;align-items:center;gap:8px;padding:8px 0}',
    '.rvc-toggle input[type=checkbox]{width:18px;height:18px;cursor:pointer}',
    '.rvc-group-item{border:1px solid var(--c-border);border-radius:8px;padding:10px;margin-bottom:8px}',
    '.rvc-group-item .group-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
    '.rvc-group-item .group-head .name{flex:1;font-size:13px;font-weight:600}',
    '.rvc-group-item .group-fields{display:flex;gap:8px;flex-wrap:wrap}',
    '.rvc-group-item .group-fields label{font-size:11px;margin:0}',
    '.rvc-group-item .group-fields input{width:70px;padding:4px 6px;font-size:12px}',
    '.rvc-config-actions{display:flex;gap:8px;padding:14px;border-top:1px solid var(--c-border);flex-shrink:0}',
    '.rvc-config-actions .rvc-btn{flex:1;justify-content:center}',
    // 通话视图（手机通话界面 - 网易云梦幻毛玻璃风格）
    '.rvc-call-view{flex:1;display:flex;flex-direction:column;min-height:0;position:relative;background:linear-gradient(160deg,#0f0c29 0%,#1a1a2e 45%,#232552 100%);background-size:200% 200%;animation:rvc-bgflow 18s ease infinite}',
    '.rvc-call-overlay{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 28%,rgba(194,12,12,0.14) 0%,rgba(15,12,41,0.5) 58%,rgba(10,8,30,0.68) 100%);z-index:0}',
    '.rvc-call-topbar{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:12px 18px;position:relative;z-index:2}',
    '.rvc-call-back{background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.9);border:1px solid rgba(255,255,255,0.12);padding:7px 16px;border-radius:18px;font-size:13px;cursor:pointer;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);transition:.2s;box-shadow:0 4px 16px rgba(0,0,0,0.2)}',
    '.rvc-call-back:hover{background:rgba(255,255,255,0.16);color:#fff;border-color:rgba(255,255,255,0.25)}',
    '.rvc-call-timer{font-size:14px;color:rgba(255,255,255,0.92);font-variant-numeric:tabular-nums;font-weight:500;letter-spacing:.5px;text-shadow:0 1px 8px rgba(194,12,12,0.4)}',
    '.rvc-call-mute-top{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;color:rgba(255,255,255,0.9);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);transition:.2s;box-shadow:0 4px 16px rgba(0,0,0,0.2)}',
    '.rvc-call-mute-top:hover{background:rgba(255,255,255,0.16)}',
    '.rvc-call-mute-top.muted{background:rgba(194,12,12,0.35);border-color:rgba(194,12,12,0.5)}',
    '.rvc-call-header{flex-shrink:0;display:flex;flex-direction:column;align-items:center;padding:20px 16px 10px;position:relative;z-index:2}',
    '.rvc-call-avatar{width:108px;height:108px;border-radius:50%;background-size:cover;background-position:center;background-color:rgba(255,255,255,0.06);margin-bottom:14px;border:3px solid rgba(255,255,255,0.25);display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:300;color:rgba(255,255,255,0.85);overflow:hidden;box-shadow:0 0 0 4px rgba(194,12,12,0.15),0 8px 32px rgba(0,0,0,0.4),inset 0 0 20px rgba(255,255,255,0.05);animation:rvc-pulse 3s ease-in-out infinite}',
    '.rvc-call-avatar img{width:100%;height:100%;object-fit:cover}',
    '.rvc-call-name{font-size:23px;font-weight:600;color:#fff;margin-bottom:5px;text-shadow:0 2px 12px rgba(0,0,0,0.6),0 0 24px rgba(194,12,12,0.3);letter-spacing:.5px}',
    '.rvc-call-status{font-size:14px;color:rgba(255,255,255,0.7);text-shadow:0 1px 8px rgba(0,0,0,0.5)}',
    '.rvc-call-messages{flex:1;overflow-y:auto;padding:10px 16px;min-height:0;display:flex;flex-direction:column;gap:7px;position:relative;z-index:2;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.15) transparent}',
    '.rvc-call-messages::-webkit-scrollbar{width:5px}',
    '.rvc-call-messages::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:3px}',
    '.rvc-msg{max-width:75%;padding:10px 15px;border-radius:20px;word-wrap:break-word;word-break:break-word;font-size:15px;line-height:1.45;white-space:pre-wrap;box-shadow:0 2px 12px rgba(0,0,0,0.15)}',
    '.rvc-msg-user{align-self:flex-end;background:linear-gradient(135deg,#C20C0C 0%,#E60026 100%);color:#fff;border-bottom-right-radius:5px;box-shadow:0 4px 18px rgba(194,12,12,0.35)}',
    '.rvc-msg-char{align-self:flex-start;background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.15);border-bottom-left-radius:5px;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 4px 18px rgba(0,0,0,0.2)}',
    '.rvc-msg-interim{align-self:flex-end;background:rgba(194,12,12,0.25);color:rgba(255,255,255,0.85);font-style:italic;border:1px solid rgba(194,12,12,0.3);border-bottom-right-radius:5px;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}',
    '.rvc-msg-sys{align-self:center;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.55);font-size:12px;padding:5px 14px;border-radius:12px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}',
    '.rvc-msg-wrap{position:relative;max-width:75%}',
    '.rvc-msg-actions{display:flex;gap:5px;margin-top:5px;opacity:0;transition:opacity .15s}',
    '.rvc-msg-wrap:hover .rvc-msg-actions{opacity:1}',
    '.rvc-msg-action-btn{font-size:11px;padding:3px 9px;border-radius:11px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.9);cursor:pointer;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:.15s}',
    '.rvc-msg-action-btn:hover{background:rgba(255,255,255,0.25)}',
    '.rvc-msg-action-btn.danger:hover{background:rgba(194,12,12,0.6);border-color:rgba(194,12,12,0.8)}',
    '.rvc-msg-edit-input{width:100%;padding:9px 13px;border-radius:16px;border:1px solid rgba(194,12,12,0.6);background:rgba(0,0,0,0.35);color:#fff;font-size:15px;outline:none;margin-top:5px;box-sizing:border-box;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}',
    '.rvc-call-bottom{flex-shrink:0;display:flex;justify-content:center;align-items:center;gap:30px;padding:18px 16px 28px;position:relative;z-index:2}',
    '.rvc-call-btn{width:60px;height:60px;border-radius:50%;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .15s,box-shadow .15s,opacity .15s;color:#fff;box-shadow:0 6px 22px rgba(0,0,0,0.3)}',
    '.rvc-call-btn:active{transform:scale(0.92)}',
    '.rvc-call-btn-mute{background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.18);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}',
    '.rvc-call-btn-mute:hover{background:rgba(255,255,255,0.2)}',
    '.rvc-call-btn-mute.muted{background:rgba(194,12,12,0.45);border-color:rgba(194,12,12,0.6)}',
    '.rvc-call-btn-hangup{background:linear-gradient(135deg,#f85149 0%,#C20C0C 100%);width:70px;height:70px;box-shadow:0 6px 24px rgba(194,12,12,0.45)}',
    '.rvc-call-btn-hangup:hover{box-shadow:0 8px 28px rgba(194,12,12,0.6)}',
    '.rvc-call-btn-ptt{background:linear-gradient(135deg,#C20C0C 0%,#E60026 100%);width:70px;height:70px;flex-direction:column;font-size:11px;font-weight:600;user-select:none;-webkit-user-select:none;box-shadow:0 6px 24px rgba(194,12,12,0.4)}',
    '.rvc-call-btn-ptt:hover{box-shadow:0 8px 28px rgba(194,12,12,0.55)}',
    '.rvc-call-btn-ptt.recording{background:linear-gradient(135deg,#E60026 0%,#ff2d4d 100%);transform:scale(1.06);animation:rvc-recpulse 1.4s ease-in-out infinite;box-shadow:0 0 0 6px rgba(194,12,12,0.25),0 8px 30px rgba(194,12,12,0.6)}',
    '.rvc-call-btn-ptt:active{transform:scale(0.95)}',
    '.rvc-call-btn-ptt .ptt-label{font-size:10px;margin-top:2px;letter-spacing:.3px}',
    '.rvc-call-btn-text{background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.18);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}',
    '.rvc-call-btn-text:hover{background:rgba(255,255,255,0.2)}',
    '.rvc-call-text-bar{flex:1;display:flex;gap:8px;align-items:center}',
    '.rvc-call-text-input{flex:1;padding:13px 18px;border-radius:26px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;font-size:15px;outline:none;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);transition:.2s}',
    '.rvc-call-text-input:focus{border-color:rgba(194,12,12,0.6);background:rgba(255,255,255,0.12);box-shadow:0 0 0 3px rgba(194,12,12,0.15)}',
    '.rvc-call-text-input::placeholder{color:rgba(255,255,255,0.45)}',
    '.rvc-call-send-btn{width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg,#C20C0C 0%,#E60026 100%);border:none;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 18px rgba(194,12,12,0.4)}',
    '.rvc-call-send-btn:active{transform:scale(0.92)}',
    // 设置视图
    '.rvc-settings-view label{display:block;font-size:13px;color:var(--c-sub);margin:12px 0 6px}',
    '.rvc-settings-view input,.rvc-settings-view textarea,.rvc-settings-view select{width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid var(--c-border);background:var(--c-bg);color:var(--c-text);font-size:13px;font-family:inherit}',
    '.rvc-settings-view textarea{min-height:80px;resize:vertical}',
    '.rvc-slider-row{display:flex;gap:8px;align-items:center}',
    '.rvc-slider-row input[type=range]{flex:1}',
    '.rvc-slider-val{font-size:12px;color:var(--c-sub);min-width:40px;text-align:right}',
    '.rvc-link{display:inline-block;color:#388bfd;text-decoration:underline;margin-bottom:8px;font-size:13px}',
    // 弹窗
    '.rvc-modal-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:100}',
    '.rvc-modal{background:var(--c-card);border:1px solid var(--c-border);border-radius:12px;width:90%;max-width:420px;max-height:80%;display:flex;flex-direction:column}',
    '.rvc-modal-head{display:flex;align-items:center;padding:14px;border-bottom:1px solid var(--c-border)}',
    '.rvc-modal-head .title{flex:1;font-size:15px;font-weight:600}',
    '.rvc-modal-head .close{width:32px;height:32px;border:none;background:transparent;color:var(--c-sub);cursor:pointer;display:flex;align-items:center;justify-content:center;border-radius:6px}',
    '.rvc-modal-head .close:hover{background:var(--c-bg);color:var(--c-text)}',
    '.rvc-modal-body{flex:1;overflow-y:auto;padding:10px}',
    '.rvc-modal-item{display:flex;align-items:center;gap:10px;padding:10px;border-radius:8px;cursor:pointer;transition:.1s}',
    '.rvc-modal-item:hover{background:var(--c-bg)}',
    '.rvc-modal-item .avatar{width:40px;height:40px;border-radius:50%;background:var(--c-border);display:flex;align-items:center;justify-content:center;font-size:18px;overflow:hidden;flex-shrink:0}',
    '.rvc-modal-item .avatar img{width:100%;height:100%;object-fit:cover}',
    '.rvc-modal-item .info{flex:1;min-width:0}',
    '.rvc-modal-item .info .n{font-size:14px;font-weight:600}',
    '.rvc-modal-item .info .b{font-size:12px;color:var(--c-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    // 动画 keyframes（网易云梦幻风格）
    '@keyframes rvc-bgflow{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}',
    '@keyframes rvc-pulse{0%,100%{box-shadow:0 0 0 4px rgba(194,12,12,0.15),0 8px 32px rgba(0,0,0,0.4),inset 0 0 20px rgba(255,255,255,0.05)}50%{box-shadow:0 0 0 9px rgba(194,12,12,0.28),0 8px 32px rgba(0,0,0,0.4),inset 0 0 26px rgba(255,255,255,0.1)}}',
    '@keyframes rvc-recpulse{0%,100%{box-shadow:0 0 0 6px rgba(194,12,12,0.25),0 8px 30px rgba(194,12,12,0.6)}50%{box-shadow:0 0 0 12px rgba(194,12,12,0.12),0 8px 30px rgba(194,12,12,0.75)}}',
    // 音波频率动画 (中间小尺寸半透明隐约)
    '.rvc-call-waveform{display:flex;align-items:center;justify-content:center;gap:3px;height:24px;width:120px;margin:6px auto 0;pointer-events:none;opacity:0;transition:opacity .5s}',
    '.rvc-call-waveform.active{opacity:1}',
    '.rvc-wave-bar{width:3px;height:4px;background:rgba(255,255,255,0.25);border-radius:2px;transform-origin:center;animation:rvc-waveidle 3s ease-in-out infinite}',
    '.rvc-call-waveform.active .rvc-wave-bar{background:rgba(255,255,255,0.4);animation:rvc-wave 1.1s ease-in-out infinite}',
    '@keyframes rvc-waveidle{0%,100%{height:4px}50%{height:6px}}',
    '@keyframes rvc-wave{0%,100%{height:5px}25%{height:18px}50%{height:9px}75%{height:22px}}',
    // 悬浮语音球
    '.rvc-float-ball{position:fixed;z-index:99998;width:52px;height:52px;border-radius:50%;background:rgba(194,12,12,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 4px 20px rgba(194,12,12,0.4),inset 0 1px 0 rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;transition:transform .15s,box-shadow .15s;touch-action:none}',
    '.rvc-float-ball:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(194,12,12,0.55),inset 0 1px 0 rgba(255,255,255,0.2)}',
    '.rvc-float-ball.recording{background:rgba(220,38,38,0.9);animation:rvc-float-pulse 1.2s ease-in-out infinite}',
    '.rvc-float-ball svg{width:24px;height:24px;fill:#fff;pointer-events:none}',
    '@keyframes rvc-float-pulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,0.5),0 4px 20px rgba(194,12,12,0.4)}50%{box-shadow:0 0 0 14px rgba(220,38,38,0),0 4px 20px rgba(194,12,12,0.4)}}',
    '.rvc-float-tip{position:fixed;z-index:99999;background:rgba(20,20,30,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);color:#fff;padding:8px 14px;border-radius:10px;font-size:13px;max-width:260px;box-shadow:0 4px 24px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);pointer-events:none;white-space:pre-wrap;line-height:1.5}'
  ].join('\n');

  // 悬浮球样式独立注入（unmount 不移除），确保插件面板关闭后悬浮球仍有样式
  var FLOAT_CSS_TEXT = [
    '.rvc-float-ball{position:fixed;z-index:99998;width:52px;height:52px;border-radius:50%;background:rgba(194,12,12,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 4px 20px rgba(194,12,12,0.4),inset 0 1px 0 rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;transition:transform .15s,box-shadow .15s;touch-action:none}',
    '.rvc-float-ball:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(194,12,12,0.55),inset 0 1px 0 rgba(255,255,255,0.2)}',
    '.rvc-float-ball.recording{background:rgba(220,38,38,0.9);animation:rvc-float-pulse 1.2s ease-in-out infinite}',
    '.rvc-float-ball svg{width:24px;height:24px;fill:#fff;pointer-events:none}',
    '@keyframes rvc-float-pulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,0.5),0 4px 20px rgba(194,12,12,0.4)}50%{box-shadow:0 0 0 14px rgba(220,38,38,0),0 4px 20px rgba(194,12,12,0.4)}}',
    '.rvc-float-tip{position:fixed;z-index:99999;background:rgba(20,20,30,0.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);color:#fff;padding:8px 14px;border-radius:10px;font-size:13px;max-width:260px;box-shadow:0 4px 24px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);pointer-events:none;white-space:pre-wrap;line-height:1.5}'
  ].join('\n');

  // ============================================================
  // 工具函数
  // ============================================================

  function el(tag, props, children) {
    var e = document.createElement(tag);
    if (props) {
      for (var k in props) {
        var v = props[k];
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'text') e.textContent = v;
        else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        // boolean 属性：true 才设置，false/null/undefined 跳过
        else if (v === true) e.setAttribute(k, '');
        else if (v !== false && v != null) e.setAttribute(k, v);
      }
    }
    if (children != null) {
      var arr = Array.isArray(children) ? children : [children];
      for (var i = 0; i < arr.length; i++) {
        var c = arr[i];
        if (c == null) continue;
        e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return e;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatTime(ms) {
    var total = Math.floor(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  // Vosk 语言映射: callLang → Vosk 支持的语言代码
  var VOSK_LANG_MAP = {
    'zh-CN': 'zh', 'zh-TW': 'zh',
    'en-US': 'en-us', 'en-GB': 'en-us',
    'ja-JP': 'ja', 'ko-KR': 'ko',
    'fr-FR': 'fr', 'de-DE': 'de', 'es-ES': 'es',
    'ru-RU': 'ru', 'it-IT': 'it', 'pt-PT': 'pt',
    'th-TH': 'en-us', 'vi-VN': 'vi', 'ar-SA': 'ar'
  };
  var VOSK_SUPPORTED = ['en-us','de','fr','es','pt','zh','ru','ar','tr','vi','it','hi','gu','te','ja','ko'];
  var VOSK_LANG_LABELS = {
    'zh': '中文', 'en-us': '英语', 'ja': '日语', 'ko': '韩语',
    'fr': '法语', 'de': '德语', 'es': '西班牙语', 'ru': '俄语',
    'it': '意大利语', 'pt': '葡萄牙语', 'vi': '越南语', 'ar': '阿拉伯语'
  };
  // 获取 callLang 对应的 Vosk 语言代码 (state 在 mount 内部, 这里用参数传入)
  function getVoskLang(callLang) {
    var code = VOSK_LANG_MAP[callLang] || 'zh';
    if (VOSK_SUPPORTED.indexOf(code) === -1) code = 'zh';
    return code;
  }
  // 获取 Vosk 语言的中文名
  function getVoskLangLabel(callLang) {
    return VOSK_LANG_LABELS[getVoskLang(callLang)] || '中文';
  }

  // Vosk 识别结果清洗: 中文去空格/英文压缩空格/清理多余标点
  // Vosk 中文模型输出带空格分词 (如 "我 是 一个 人"), 需去除
  function cleanVoskText(text, lang) {
    if (!text) return '';
    var t = String(text).trim();
    if (!t) return '';
    var isZh = (lang || '').indexOf('zh') === 0;
    if (isZh) {
      // 中文: 去除所有空格 (Vosk 中文分词空格)
      t = t.replace(/\s+/g, '');
      // 合并连续相同标点
      t = t.replace(/([，。！？、；：""''])\1+/g, '$1');
      // 去除句首多余标点
      t = t.replace(/^[，。、；：\s]+/, '');
    } else {
      // 英文等其他语言: 压缩多余空格
      t = t.replace(/\s+/g, ' ');
      // 首字母大写 (句首)
      if (t) t = t.charAt(0).toUpperCase() + t.slice(1);
    }
    return t;
  }

  function displayName(char) {
    return (char && (char.handle || char.name)) || '未知';
  }

  function avatarHTML(char) {
    if (char && char.avatar) {
      return '<img src="' + escapeHtml(char.avatar) + '" onerror="this.style.display=\'none\'">';
    }
    return '<span>' + escapeHtml((char && char.name || '?').slice(0, 1)) + '</span>';
  }

  // 从 char 对象读取 voiceId
  function pickVoiceId(char) {
    if (!char) return '';
    return char.voiceId || char.voice || char.ttsVoiceId ||
      (char.tts && (char.tts.voiceId || char.tts.voice)) ||
      (char.voiceConfig && char.voiceConfig.voiceId) || '';
  }

  // ============================================================
  // IndexedDB：消息注入到 Roche 主数据库
  // ============================================================

  function injectMessagesToRoche(char, messages) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('Roche_db');
      req.onsuccess = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('messages')) {
          db.close();
          resolve();
          return;
        }
        var tx = db.transaction('messages', 'readwrite');
        var store = tx.objectStore('messages');
        for (var i = 0; i < messages.length; i++) {
          var msg = messages[i];
          var record = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            isMe: msg.isMe,
            text: msg.text,
            type: 'text',
            timestamp: msg.timestamp || Date.now(),
            conversationId: char.conversationId
          };
          if (!msg.isMe) {
            record.senderId = char.id;
            record.senderName = char.name;
          }
          store.add(record);
        }
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      };
      req.onerror = function () { reject(req.error); };
    });
  }

  // ============================================================
  // 插件定义
  // ============================================================

  var plugin = {
    id: 'realtime-voice-call',
    name: '实时语音通话',
    version: '2.0.0',
    apps: [{
      id: 'realtime-voice-call',
      name: '实时语音通话',
      icon: 'call',
      iconImage: '',
      async mount(container, roche) {
        // ===== 注入样式 =====
        var styleEl = document.createElement('style');
        styleEl.id = 'rvc-styles';
        styleEl.textContent = CSS_TEXT;
        document.head.appendChild(styleEl);
        // 悬浮球样式独立注入（unmount 时不移除，保证面板关闭后悬浮球仍有样式）
        if (!document.getElementById('rvc-float-styles')) {
          var fStyle = document.createElement('style');
          fStyle.id = 'rvc-float-styles';
          fStyle.textContent = FLOAT_CSS_TEXT;
          document.head.appendChild(fStyle);
        }

        // ===== 创建根元素 =====
        var root = document.createElement('div');
        root.className = 'rvc-root';
        container.appendChild(root);

        // ===== 状态 =====
        var state = {
          view: 'loading',
          chars: [],
          activeUser: null,
          userPersonas: [],  // 所有 user 人设列表（供 char 绑定选择）
          charConfigs: {},
          currentChar: null,
          callState: 'idle',     // idle | listening | thinking | speaking | text_input
          callMessages: [],
          callHistory: [],
          callStartTime: 0,
          recognition: null,
          wantListen: false,
          finalText: '',
          interimText: '',
          silenceTimer: null,
          bufferFlushTimer: null,
          utteranceBuffer: [],
          audio: null,
          muted: false,
          callTimerInterval: null,
          scrollLocked: true,
          // 通话界面元素引用
          callMsgListEl: null,
          callStatusEl: null,
          callTimerEl: null,
          callBottomEl: null,
          callInterimEl: null,
          callMuteBtnTop: null,
          callMuteBtnBottom: null,
          // STT 运行时
          stt: {
            audioCtx: null,
            analyser: null,
            micStream: null,
            mediaRecorder: null,
            chunks: [],
            vadRaf: null,
            isSpeaking: false,
            speakStartTs: 0,
            silenceStartTs: 0,
            recording: false,
            highpass: null,
            compressor: null,
            pttMode: false  // PTT 模式：按住说话时为 true
          },
          settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
        };

        var cleanups = [];
        function addCleanup(fn) { cleanups.push(fn); }

        // ============================================================
        // 数据加载 / 保存
        // ============================================================

        async function loadCharConfigs() {
          var stored = await roche.storage.get('rvc_char_configs');
          state.charConfigs = stored || {};
        }

        async function saveCharConfigs() {
          await roche.storage.set('rvc_char_configs', state.charConfigs);
        }

        async function loadSettings() {
          var stored = await roche.storage.get('rvc_settings');
          if (stored) Object.assign(state.settings, stored);
        }

        async function saveSettings() {
          await roche.storage.set('rvc_settings', state.settings);
        }

        function getCharConfig(charId) {
          if (!state.charConfigs[charId]) {
            state.charConfigs[charId] = makeDefaultCharConfig();
            state.charConfigs[charId].addedAt = Date.now();
          }
          return state.charConfigs[charId];
        }

        // ============================================================
        // 记忆加载
        // ============================================================

        async function loadMemoryForCall(char, config) {
          var parts = [];

          // 单聊记忆
          var dm = config.memory.dm;
          try {
            if (dm.shortTermLimit > 0) {
              var shortTerm = await roche.memory.getShortTerm({
                conversationId: char.conversationId,
                limit: dm.shortTermLimit
              });
              if (shortTerm && shortTerm.length > 0) {
                parts.push('近期对话:');
                for (var i = 0; i < shortTerm.length; i++) {
                  var m = shortTerm[i];
                  parts.push((m.isMe ? '用户' : (m.senderName || '对方')) + ': ' + (m.text || ''));
                }
              }
            }
            if (dm.factsLimit > 0 || dm.core) {
              var longTerm = await roche.memory.getLongTerm({
                conversationId: char.conversationId,
                limit: dm.factsLimit
              });
              if (dm.core && longTerm && longTerm.core) {
                var coreText = typeof longTerm.core === 'string' ? longTerm.core : (longTerm.core.summary || longTerm.core.text || '');
                if (coreText) parts.push('核心记忆: ' + coreText);
              }
              if (dm.factsLimit > 0 && longTerm && longTerm.facts) {
                var facts = longTerm.facts.slice(0, dm.factsLimit);
                if (facts.length > 0) {
                  parts.push('事实记忆:');
                  for (var j = 0; j < facts.length; j++) {
                    var f = facts[j];
                    parts.push('- ' + (f.summaryText || f.summary || f.text || f.action || ''));
                  }
                }
              }
            }
          } catch (e) { /* 记忆加载失败不阻塞通话 */ }

          // 群聊记忆
          var groups = config.memory.groups || [];
          for (var gi = 0; gi < groups.length; gi++) {
            var group = groups[gi];
            if (!group.enabled) continue;
            try {
              if (group.shortTermLimit > 0) {
                var gShort = await roche.memory.getShortTerm({
                  conversationId: group.conversationId,
                  limit: group.shortTermLimit
                });
                if (gShort && gShort.length > 0) {
                  parts.push('\n群聊[' + group.name + ']近期对话:');
                  for (var k = 0; k < gShort.length; k++) {
                    var gm = gShort[k];
                    parts.push((gm.isMe ? '用户' : (gm.senderName || '对方')) + ': ' + (gm.text || ''));
                  }
                }
              }
              if (group.factsLimit > 0 || group.core) {
                var gLong = await roche.memory.getLongTerm({
                  conversationId: group.conversationId,
                  limit: group.factsLimit
                });
                if (group.core && gLong && gLong.core) {
                  var gCore = typeof gLong.core === 'string' ? gLong.core : (gLong.core.summary || gLong.core.text || '');
                  if (gCore) parts.push('群聊[' + group.name + ']核心: ' + gCore);
                }
                if (group.factsLimit > 0 && gLong && gLong.facts) {
                  var gFacts = gLong.facts.slice(0, group.factsLimit);
                  if (gFacts.length > 0) {
                    parts.push('群聊[' + group.name + ']事实:');
                    for (var l = 0; l < gFacts.length; l++) {
                      var gf = gFacts[l];
                      parts.push('- ' + (gf.summaryText || gf.summary || gf.text || gf.action || ''));
                    }
                  }
                }
              }
            } catch (e2) { /* 群聊记忆加载失败不阻塞 */ }
          }

          // 世界书
          if (config.worldbook.enabled && config.worldbook.categoryIds.length > 0) {
            for (var ci = 0; ci < config.worldbook.categoryIds.length; ci++) {
              var catId = config.worldbook.categoryIds[ci];
              try {
                var entries = await roche.worldbook.getEntries({ categoryId: catId });
                if (entries && entries.length > 0) {
                  parts.push('世界书:');
                  for (var ei = 0; ei < entries.length; ei++) {
                    var e = entries[ei];
                    parts.push('- ' + (e.content || e.text || e.summary || ''));
                  }
                }
              } catch (e3) { /* 世界书加载失败不阻塞 */ }
            }
          }

          return parts.join('\n');
        }

        // ============================================================
        // 提示词构建
        // ============================================================

        // ============================================================
        // 情绪识别（纯前端声学特征 → 规则映射成标签）
        // 复用 MediaRecorder 路径的 analyser，提取音量(RMS)/过零率(音高)/频谱质心(音色)
        // 仅在 isSpeaking 时累积，停止时计算最终标签注入 user 消息
        // ============================================================

        function createEmotionTracker() {
          return {
            rmsSum: 0, rmsMax: 0, rmsCount: 0,   // 音量统计
            zcrSum: 0, zcrCount: 0,              // 过零率（估音高/紧张度）
            centroidSum: 0, centroidCount: 0,    // 频谱质心（音色亮度）
            frames: 0, speakFrames: 0
          };
        }

        // 在 vadTick 中调用，复用已有 analyser
        function updateEmotionFeatures(analyser, tracker) {
          if (!analyser || !tracker) return;
          var bins = analyser.frequencyBinCount;
          var timeBuf = new Uint8Array(bins);
          var freqBuf = new Uint8Array(bins);
          analyser.getByteTimeDomainData(timeBuf);
          analyser.getByteFrequencyData(freqBuf);

          // RMS 音量
          var sum = 0;
          for (var i = 0; i < bins; i++) {
            var v = (timeBuf[i] - 128) / 128;
            sum += v * v;
          }
          var rms = Math.sqrt(sum / bins);

          // 过零率（单位时间内信号穿过零点的次数，粗估音高/紧张度）
          var zc = 0;
          for (var j = 1; j < bins; j++) {
            var a = timeBuf[j] >= 128;
            var b = timeBuf[j - 1] >= 128;
            if (a !== b) zc++;
          }
          var zcr = zc / bins;

          // 频谱质心（能量加权平均频率，反映音色亮度）
          var magSum = 0, weightedSum = 0;
          for (var k = 0; k < bins; k++) {
            var mag = freqBuf[k];
            magSum += mag;
            weightedSum += mag * k;
          }
          var centroid = magSum > 0 ? (weightedSum / magSum) : 0;

          // 只在真正有声音时累计（RMS 高于噪声门，避免静音段污染统计）
          if (rms > 0.02) {
            tracker.rmsSum += rms;
            if (rms > tracker.rmsMax) tracker.rmsMax = rms;
            tracker.rmsCount++;
            tracker.zcrSum += zcr;
            tracker.zcrCount++;
            tracker.centroidSum += centroid;
            tracker.centroidCount++;
            tracker.speakFrames++;
          }
          tracker.frames++;
        }

        // 计算 final 情绪标签，返回如 "[音量:大][音高:高/紧张][情绪:激动/兴奋]"
        function computeEmotionTags(tracker) {
          if (!tracker || tracker.rmsCount === 0) return '';
          var avgRms = tracker.rmsSum / tracker.rmsCount;
          var avgZcr = tracker.zcrSum / tracker.zcrCount;
          var avgCentroid = tracker.centroidSum / tracker.centroidCount;

          // 音量分级（RMS 经验阈值，0-1 区间）
          var vol;
          if (avgRms > 0.18) vol = '大';
          else if (avgRms > 0.09) vol = '中';
          else vol = '小';

          // 音高/紧张度（过零率高 → 音高高或声带紧张）
          var pitch;
          if (avgZcr > 0.18) pitch = '高/紧张';
          else if (avgZcr > 0.10) pitch = '中';
          else pitch = '低/放松';

          // 情绪映射（音量 × 音高 × 音色亮度）
          var emotion;
          if (vol === '大' && avgZcr > 0.15) {
            emotion = avgCentroid > 100 ? '激动/兴奋' : '愤怒/强调';
          } else if (vol === '大' && avgZcr <= 0.15) {
            emotion = '坚定/强调';
          } else if (vol === '小' && avgZcr > 0.15) {
            emotion = '紧张/焦虑';
          } else if (vol === '小' && avgZcr <= 0.10) {
            emotion = '平静/低落';
          } else if (vol === '小') {
            emotion = '疲惫/伤心';
          } else {
            emotion = '平静';
          }

          return '[音量:' + vol + '][音高:' + pitch + '][情绪:' + emotion + ']';
        }

        // 格式化 user 人设为文本（供 {{persona}} 注入）
        function formatUserPersona(p) {
          if (!p) return '';
          var parts = [];
          if (p.name) parts.push('姓名：' + p.name);
          if (p.gender) parts.push('性别：' + p.gender);
          if (p.age) parts.push('年龄：' + p.age);
          if (p.occupation) parts.push('职业：' + p.occupation);
          if (p.bio) parts.push('简介：' + p.bio);
          if (p.customSettings) parts.push('补充设定：' + p.customSettings);
          return parts.join('\n');
        }

        function buildPrompt(char, memoryText, config) {
          var tmpl = (state.settings.callPrompt && state.settings.callPrompt.trim()) || BUILTIN_PROMPT;
          // 解析绑定的 user 人设：若 char 配置了 userPersonaId，优先用绑定的；否则用当前激活的
          var boundPersona = null;
          if (config && config.userPersonaId && state.userPersonas && state.userPersonas.length) {
            for (var i = 0; i < state.userPersonas.length; i++) {
              if (state.userPersonas[i].id === config.userPersonaId) {
                boundPersona = state.userPersonas[i];
                break;
              }
            }
          }
          var user = boundPersona || state.activeUser;
          var userName = (user && (user.handle || user.name)) || '用户';
          // {{persona}} = char 的人设（保持原有语义）
          var charPersona = (char && (char.persona || char.bio)) || '';
          // {{user_persona}} = 绑定的 user 人设文本
          var userPersonaText = formatUserPersona(user);
          return tmpl
            .replace(/\{\{char\}\}/g, displayName(char))
            .replace(/\{\{user\}\}/g, userName)
            .replace(/\{\{persona\}\}/g, charPersona)
            .replace(/\{\{user_persona\}\}/g, userPersonaText)
            .replace(/\{\{memory\}\}/g, memoryText || '无');
        }

        async function buildMessages(char, config, userText) {
          var memoryText = await loadMemoryForCall(char, config);
          var systemPrompt = buildPrompt(char, memoryText, config);

          // 附加通话语言指令（让 AI 用指定语言回复）
          var callLang = state.settings.callLang || 'zh-CN';
          var langName = LANG_LABELS[callLang] || callLang;
          systemPrompt += '\n\n【通话语言】\n你必须用 ' + langName + ' 回复。无论用户用什么语言说话，你的回复必须用 ' + langName + '。';

          // 外语时附加中文翻译指令
          if (state.settings.translateToChinese && callLang.indexOf('zh') !== 0) {
            systemPrompt += '\n\n【中文翻译】\n在回复末尾另起一行，用 【中文翻译】 开头给出中文译文。例如：\nHello, how are you?\n【中文翻译】你好，你怎么样？\n注意：翻译行仅用于显示，不要影响通话语气。';
          }

          var messages = [{ role: 'system', content: systemPrompt }];

          // 携带本轮通话历史
          var hist = state.callHistory.slice(-state.settings.historyLimit);
          for (var i = 0; i < hist.length; i++) {
            messages.push({ role: hist[i].role, content: hist[i].content });
          }

          // 当前用户输入
          messages.push({ role: 'user', content: userText });
          return messages;
        }

        // ============================================================
        // STT：语音识别
        // ============================================================

        function webSpeechSupported() {
          return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
        }

        function detectSTTProvider() {
          var cfg = state.settings.sttProvider || 'auto';
          // 用户明确选择了引擎 → 严格使用该引擎, 绝不 fallback 到 groq
          // 坏了就报错, 让用户自己换, 不偷偷替换
          if (cfg !== 'auto' && cfg !== 'none') return cfg;

          // auto 模式: 按优先级选第一个可用的, 不再默认 groq
          // 优先级: Vosk(APK 环境) > Web Speech API > 不选择(让用户手动选)
          var vosk = detectVoskAvailable();
          if (vosk) return 'vosk';  // APK 环境优先 Vosk
          if (webSpeechSupported()) return 'webspeech';  // Chrome/Edge 优先浏览器内置
          // 都不可用, 返回 'none', 用户必须手动选
          return 'none';
        }

        // Web Speech API 路径
        function setupWebSpeech() {
          var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (!SR) return null;
          var rec = new SR();
          rec.lang = state.settings.lang;
          rec.continuous = true;
          rec.interimResults = true;

          rec.onresult = function (e) {
            var interim = '';
            for (var i = e.resultIndex; i < e.results.length; i++) {
              var r = e.results[i];
              if (r.isFinal) {
                state.finalText += r[0].transcript;
              } else {
                interim += r[0].transcript;
              }
            }
            state.interimText = interim;
            // 显示：已确认 buffer + 当前 finalText + 正在说的 interim（每句换行）
            var disp = state.utteranceBuffer.slice();
            if (state.finalText) disp.push(state.finalText);
            if (interim) disp.push(interim);
            updateInterim(disp.join('\n'));
            if (state.silenceTimer) clearTimeout(state.silenceTimer);
            state.silenceTimer = setTimeout(onSilence, state.settings.silenceMs);
          };

          rec.onerror = function (e) {
            if (e.error === 'no-speech' || e.error === 'aborted') return;
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
              addCallMessage({ role: 'sys', text: '当前环境不支持 Web Speech API（应用内 WebView 无 Google 语音服务），请到插件设置里把「语音识别」切换为 Groq 并填写 API Key' });
              updateStatus('语音服务不可用');
            } else {
              addCallMessage({ role: 'sys', text: '识别错误: ' + e.error });
            }
          };

          rec.onend = function () {
            if (state.callState === 'listening' && state.wantListen) {
              try { rec.start(); } catch (e) { /* ignore */ }
            }
          };
          return rec;
        }

        // MediaRecorder + VAD 路径（含音频预处理：高通滤波 + 噪声门）
        async function startMediaRecorderListening() {
          var stt = state.stt;
          if (stt.recording) return;

          try {
            var stream = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });
            stt.micStream = stream;

            // AudioContext 用于 VAD + 音频预处理
            var AC = window.AudioContext || window.webkitAudioContext;
            var ctx = new AC();
            stt.audioCtx = ctx;
            var src = ctx.createMediaStreamSource(stream);

            // 构建音频处理链：src → highpass → noiseGate → analyser
            // highpass：滤除低频电流声/风噪
            var highpass = null;
            try {
              highpass = ctx.createBiquadFilter();
              highpass.type = 'highpass';
              highpass.frequency.value = state.settings.highpassFreq || 85;
              highpass.Q.value = 0.7;
            } catch (e) { highpass = null; }

            // 噪声门：用 DynamicsCompressorNode 近似实现（无原NoiseGate时用压缩器+阈值判断）
            // 真正的静音在 VAD tick 中按 RMS 阈值裁剪，这里仅做压缩
            var compressor = null;
            try {
              compressor = ctx.createDynamicsCompressor();
              compressor.threshold.value = -50;  // 低于此 dB 压缩
              compressor.knee.value = 30;
              compressor.ratio.value = 12;
              compressor.attack.value = 0.003;
              compressor.release.value = 0.25;
            } catch (e) { compressor = null; }

            var analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.6;

            // 串联节点
            var chainHead = src;
            if (highpass) {
              src.connect(highpass);
              chainHead = highpass;
            }
            if (compressor) {
              chainHead.connect(compressor);
              chainHead = compressor;
            }
            chainHead.connect(analyser);
            stt.analyser = analyser;
            stt.highpass = highpass;
            stt.compressor = compressor;
            // 情绪识别：开启时初始化特征采集器（Vosk 路径不走这里，tracker 为 null）
            stt.emotionTracker = state.settings.emotionDetect ? createEmotionTracker() : null;

            // MediaRecorder 录音（直接从原始 stream 录，预处理仅用于 VAD 判断）
            // 注：浏览器原生 echoCancellation/noiseSuppression 已对录音做处理
            var mr = new MediaRecorder(stream);
            stt.mediaRecorder = mr;
            stt.chunks = [];
            mr.ondataavailable = function (e) {
              if (e.data && e.data.size > 0) stt.chunks.push(e.data);
            };
            mr.onstop = async function () {
              var blob = new Blob(stt.chunks, { type: (stt.mediaRecorder && stt.mediaRecorder.mimeType) || 'audio/webm' });
              stt.chunks = [];
              await processRecordedBlob(blob);
            };
            mr.start(250);
            stt.recording = true;
            stt.isSpeaking = false;
            stt.speakStartTs = 0;
            stt.silenceStartTs = 0;

            stt.vadRaf = requestAnimationFrame(vadTick);
          } catch (e) {
            var em = (e && e.message || e) + '';
            if (/NotAllowedError|PermissionDenied|denied/i.test(em)) {
              addCallMessage({ role: 'sys', text: '麦克风权限被拒绝：请在 Android 系统设置 → 应用 → Roche → 权限里授予「麦克风」权限，然后重试' });
              updateStatus('麦克风权限被拒绝');
            } else {
              addCallMessage({ role: 'sys', text: '麦克风启动失败: ' + em });
              updateStatus('麦克风失败');
            }
          }
        }

        function vadTick() {
          var stt = state.stt;
          if (!stt.recording || !stt.analyser) {
            stt.vadRaf = null;
            return;
          }
          var buf = new Uint8Array(stt.analyser.frequencyBinCount);
          stt.analyser.getByteTimeDomainData(buf);
          var sum = 0;
          for (var i = 0; i < buf.length; i++) {
            var v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          var rms = Math.sqrt(sum / buf.length);
          var now = performance.now();
          var threshold = state.settings.vadThreshold;
          var noiseGate = state.settings.noiseGateThreshold || 0.015;

          // 噪声门：低于阈值的信号视为静音
          if (rms < noiseGate) rms = 0;

          if (rms > threshold) {
            if (!stt.isSpeaking) {
              stt.isSpeaking = true;
              stt.speakStartTs = now;
              stt.silenceStartTs = 0;
            }
            // 情绪识别：说话中累积声学特征
            if (stt.emotionTracker) updateEmotionFeatures(stt.analyser, stt.emotionTracker);
          } else {
            if (stt.isSpeaking) {
              if (stt.silenceStartTs === 0) stt.silenceStartTs = now;
              if (now - stt.silenceStartTs >= state.settings.silenceMs) {
                // PTT 模式: 不自动停止, 等用户手动点停止按钮
                if (stt.pttMode) {
                  stt.vadRaf = requestAnimationFrame(vadTick);
                  return;
                }
                // 短脉冲过滤：说话时长低于下限视为噪音丢弃
                var speakDur = now - stt.speakStartTs;
                if (speakDur < (state.settings.minSpeakMs || 300)) {
                  // 丢弃，继续监听下一段
                  stt.isSpeaking = false;
                  stt.speakStartTs = 0;
                  stt.silenceStartTs = 0;
                  stt.vadRaf = requestAnimationFrame(vadTick);
                  return;
                }
                stopMediaRecorderAndTranscribe();
                stt.vadRaf = null;
                return;
              }
            }
          }

          // 最长录音时长保护 (PTT 模式跳过, 用户主动控制录音时长)
          if (stt.speakStartTs > 0 && now - stt.speakStartTs > state.settings.maxRecordMs) {
            if (stt.pttMode) {
              stt.vadRaf = requestAnimationFrame(vadTick);
              return;
            }
            stopMediaRecorderAndTranscribe();
            stt.vadRaf = null;
            return;
          }

          stt.vadRaf = requestAnimationFrame(vadTick);
        }

        function stopMediaRecorderAndTranscribe() {
          var stt = state.stt;
          if (!stt.recording) return;
          stt.recording = false;
          try { if (stt.mediaRecorder) stt.mediaRecorder.stop(); } catch (e) { /* ignore */ }
        }

        async function processRecordedBlob(blob) {
          var stt = state.stt;
          // 关闭音频流
          if (stt.micStream) { stt.micStream.getTracks().forEach(function (t) { t.stop(); }); stt.micStream = null; }
          if (stt.audioCtx) { try { stt.audioCtx.close(); } catch (e) { /* ignore */ } stt.audioCtx = null; }
          stt.analyser = null;
          stt.highpass = null;
          stt.compressor = null;
          // 情绪识别：录音停止时计算最终标签，存到 lastEmotionTags 供注入
          if (state.settings.emotionDetect && stt.emotionTracker) {
            state.stt.lastEmotionTags = computeEmotionTags(stt.emotionTracker);
          }
          stt.emotionTracker = null;

          if (blob.size < 2000) {
            backToListening();
            return;
          }

          state.callState = 'thinking';
          updateStatus('识别中...');
          // 识别期间保留已累积的 buffer 显示，让用户看到说过的话
          updateInterim(state.utteranceBuffer.join('\n'));

          try {
            var text = await transcribe(blob);
            var clean = (text || '').trim();
            if (clean) {
              if (stt.pttMode) {
                // PTT 模式: 用户已点停止, 直接发送这段录音的转写结果
                updateInterim('');
                stopListening();
                var sendText = clean;
                if (state.settings.emotionDetect && state.stt.lastEmotionTags) {
                  sendText = state.stt.lastEmotionTags + '\n' + sendText;
                  state.stt.lastEmotionTags = '';
                }
                sendToAI(sendText);
                return;
              } else {
                pushUtterance(clean);
                updateStatus('继续说或停顿发送...');
              }
            } else {
              addCallMessage({ role: 'sys', text: '未识别到内容' });
            }
            // 不立即发送，继续听下一段；bufferFlushTimer 负责整体发送
            backToListening();
          } catch (e) {
            addCallMessage({ role: 'sys', text: '识别失败: ' + (e && e.message || e) });
            backToListening();
          }
        }

        // ============================================================
        // PTT (Push-to-Talk) 模式：点击按钮开始, 再点击停止并发送
        // 支持 Vosk 流式识别 (边说边出字) 和 MediaRecorder 录音后转录
        // ============================================================
        async function startPTTRecording() {
          if (state.callState !== 'listening' && state.callState !== 'idle') return;
          var provider = detectSTTProvider();
          if (provider === 'none') {
            addCallMessage({ role: 'sys', text: '未选择语音识别引擎。请到设置 → STT 引擎, 选择一个引擎' });
            updateStatus('未选引擎');
            return;
          }
          var stt = state.stt;
          stt.pttMode = true;
          stt.pttProvider = provider;  // 记录 PTT 用的引擎, 停止时按引擎发送
          stt.pttTextBuffer = '';      // Vosk 模式累积识别文字
          state.callState = 'listening';
          updateStatus('说话中（再点停止）');
          updateInterim('');

          if (provider === 'vosk') {
            // Vosk 流式识别: 启动后边说边出字, 停止时发送累积文字
            await startVoskListening();
          } else {
            // 其他引擎: MediaRecorder 录音, 停止后转 blob 发送
            await startMediaRecorderListening();
          }
        }

        async function stopPTTRecording() {
          var stt = state.stt;
          if (!stt.pttMode) return;
          stt.pttMode = false;
          var provider = stt.pttProvider || detectSTTProvider();

          if (provider === 'vosk') {
            // Vosk 模式: 停止识别, 发送累积的文字
            await stopVoskListening();
            var text = (stt.pttTextBuffer || '').trim();
            stt.pttTextBuffer = '';
            updateInterim('');
            if (text) {
              stopListening();
              sendToAI(text);
            } else {
              addCallMessage({ role: 'sys', text: '未识别到内容' });
              backToListening();
            }
            return;
          }

          // MediaRecorder 模式: 停止录音, 触发 processRecordedBlob(pttMode 已 false, 走累积逻辑)
          // 但我们希望 PTT 立即发送, 所以保留 pttMode=true 直到 processRecordedBlob 处理完
          stt.pttMode = true;
          if (!stt.recording) {
            stt.pttMode = false;
            backToListening();
            return;
          }
          stopMediaRecorderAndTranscribe();
        }

        // STT 路由：根据当前 provider 分发到对应实现
        async function transcribe(blob) {
          var provider = detectSTTProvider();
          if (provider === 'mimo') return transcribeMimo(blob);
          if (provider === 'baidu') return transcribeBaidu(blob);
          if (provider === 'wit') return transcribeWit(blob);
          if (provider === 'whisper_self') return transcribeWhisperSelf(blob);
          if (provider === 'transformers') return transcribeTransformers(blob);
          if (provider === 'tencent') return transcribeTencent(blob);
          return transcribeGroq(blob);
        }

        // Groq Whisper（分段上传，非真流式，海外免费）
        async function transcribeGroq(blob) {
          var key = (state.settings.sttApiKey || '').trim();
          if (!key) throw new Error('未配置 Groq API Key，请到设置页填写');
          var form = new FormData();
          form.append('file', blob, 'speech.webm');
          // 默认 large-v3（精度高），用户可在设置里切 turbo（快但精度略低）
          var model = state.settings.sttModel || 'whisper-large-v3';
          form.append('model', model);
          var lang = (state.settings.lang || 'zh-CN').split('-')[0].toLowerCase();
          form.append('language', lang);
          form.append('response_format', 'text');
          form.append('temperature', '0');
          // prompt 参数：提供角色名/用户名/常见词，帮 Whisper 识别专有名词
          var promptCtx = [];
          if (state.currentChar) {
            var cn = state.currentChar.name || state.currentChar.handle;
            if (cn) promptCtx.push(cn);
          }
          if (state.activeUser) {
            var un = state.activeUser.name || state.activeUser.handle;
            if (un) promptCtx.push(un);
          }
          if (promptCtx.length > 0) {
            form.append('prompt', '对话涉及人物：' + promptCtx.join('、'));
          }
          var r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + key },
            body: form
          });
          if (!r.ok) {
            var t = await r.text();
            throw new Error('Groq STT HTTP ' + r.status + ': ' + t.slice(0, 200));
          }
          var txt = (await r.text()).trim();
          return txt.replace(/^"|"$/g, '');
        }

        // 把录音 blob 转成 16kHz 单声道 16bit PCM WAV（返回 blob + dataUrl 双形态）
        async function blobToWav(blob) {
          var ab = await blob.arrayBuffer();
          var AC = window.AudioContext || window.webkitAudioContext;
          var ctx = new AC({ sampleRate: 16000 });
          try {
            var audioBuf = await ctx.decodeAudioData(ab);
            // 降混到单声道
            var ch0 = audioBuf.numberOfChannels > 1
              ? audioBuf.getChannelData(0).map(function (v, i) { return (v + (audioBuf.getChannelData(1)[i] || 0)) / 2; })
              : audioBuf.getChannelData(0);
            // 重采样到 16k（decodeAudioData 已按 ctx.sampleRate 解码，故已为 16k）
            var samples = new Int16Array(ch0.length);
            for (var i = 0; i < ch0.length; i++) {
              var s = Math.max(-1, Math.min(1, ch0[i]));
              samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            // 构造 WAV
            var buffer = new ArrayBuffer(44 + samples.length * 2);
            var view = new DataView(buffer);
            function writeStr(off, str) { for (var i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); }
            writeStr(0, 'RIFF');
            view.setUint32(4, 36 + samples.length * 2, true);
            writeStr(8, 'WAVE');
            writeStr(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, 1, true);
            view.setUint32(24, 16000, true);
            view.setUint32(28, 16000 * 2, true);
            view.setUint16(32, 2, true);
            view.setUint16(34, 16, true);
            writeStr(36, 'data');
            view.setUint32(40, samples.length * 2, true);
            for (var j = 0; j < samples.length; j++) view.setInt16(44 + j * 2, samples[j], true);
            var wavBlob = new Blob([buffer], { type: 'audio/wav' });
            // 转 base64 data URL
            var bytes = new Uint8Array(buffer);
            var bin = '';
            for (var k = 0; k < bytes.length; k++) bin += String.fromCharCode(bytes[k]);
            var b64 = btoa(bin);
            return { blob: wavBlob, dataUrl: 'data:audio/wav;base64,' + b64 };
          } finally {
            try { ctx.close(); } catch (e) { /* ignore */ }
          }
        }

        // 小米 MiMo ASR（OpenAI 兼容, 限时免费, 中文极好, 支持方言/嘈杂/歌词）
        async function transcribeMimo(blob) {
          var key = (state.settings.mimoApiKey || '').trim();
          if (!key) throw new Error('未配置小米 MiMo API Key，请到设置页填写');
          var dataUrl = (await blobToWav(blob)).dataUrl;
          var lang = (state.settings.lang || 'zh-CN').split('-')[0].toLowerCase();
          var langCode = lang.indexOf('zh') === 0 ? 'zh' : (lang.indexOf('en') === 0 ? 'en' : 'auto');
          var body = {
            model: 'mimo-v2.5-asr',
            messages: [{
              role: 'user',
              content: [{ type: 'input_audio', input_audio: { data: dataUrl } }]
            }],
            asr_options: { language: langCode },
            stream: false
          };
          var r = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + key,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
          });
          if (!r.ok) {
            var t = await r.text();
            throw new Error('MiMo ASR HTTP ' + r.status + ': ' + t.slice(0, 300));
          }
          var json = await r.json();
          var text = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
          return String(text).trim();
        }

        // 百度一句话识别（REST, ≤60s, 每日5小时免费, 中文好）
        // 注意: 浏览器端换取 access_token 会暴露 Secret Key, 仅建议用户自用
        async function transcribeBaidu(blob) {
          var apiKey = (state.settings.baiduApiKey || '').trim();
          var secretKey = (state.settings.baiduSecretKey || '').trim();
          if (!apiKey || !secretKey) throw new Error('未配置百度 API Key / Secret Key，请到设置页填写');
          // 换取 access_token（带缓存）
          if (!state.baiduToken || Date.now() > state.baiduToken.expiresAt) {
            var tokenUrl = 'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id='
              + encodeURIComponent(apiKey) + '&client_secret=' + encodeURIComponent(secretKey);
            var tr = await fetch(tokenUrl);
            if (!tr.ok) {
              var te = await tr.text();
              throw new Error('百度 token HTTP ' + tr.status + ': ' + te.slice(0, 200));
            }
            var tj = await tr.json();
            if (!tj.access_token) throw new Error('百度未返回 access_token: ' + JSON.stringify(tj).slice(0, 200));
            state.baiduToken = {
              token: tj.access_token,
              expiresAt: Date.now() + (Math.min(tj.expires_in || 2592000, 2592000) - 60) * 1000
            };
          }
          var dataUrl = (await blobToWav(blob)).dataUrl;
          var b64 = dataUrl.split(',')[1];
          var cuid = 'roche-rvc-' + Date.now();
          var body = {
            format: 'wav',
            rate: 16000,
            channel: 1,
            cuid: cuid,
            token: state.baiduToken.token,
            speech: b64,
            len: Math.floor(b64.length * 3 / 4)
          };
          var r = await fetch('https://vop.baidu.com/server_api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          if (!r.ok) {
            var t = await r.text();
            throw new Error('百度 ASR HTTP ' + r.status + ': ' + t.slice(0, 300));
          }
          var json = await r.json();
          if (json.err_no !== 0) throw new Error('百度 ASR err ' + json.err_no + ': ' + (json.err_msg || ''));
          var arr = json.result || [];
          return Array.isArray(arr) ? arr.join('') : String(arr);
        }

        // Wit.ai（Meta 旗下, 免费, 英文最佳, 适合练口语场景）
        async function transcribeWit(blob) {
          var token = (state.settings.witToken || '').trim();
          if (!token) throw new Error('未配置 Wit.ai Server Access Token，请到设置页填写');
          var wavBlob = (await blobToWav(blob)).blob;
          var r = await fetch('https://api.wit.ai/speech?v=20240516', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + token,
              'Content-Type': 'audio/wav'
            },
            body: wavBlob
          });
          if (!r.ok) {
            var t = await r.text();
            throw new Error('Wit.ai HTTP ' + r.status + ': ' + t.slice(0, 300));
          }
          // Wit 可能返回 JSON 或分块 NDJSON，统一取 text 字段
          var txt = await r.text();
          try {
            var j = JSON.parse(txt);
            return String(j.text || '').trim();
          } catch (e) {
            // 分块响应：取最后一条带 text 的
            var lines = txt.split('\n').filter(Boolean);
            for (var i = lines.length - 1; i >= 0; i--) {
              try {
                var lj = JSON.parse(lines[i]);
                if (lj.text) return String(lj.text).trim();
                if (lj.is_final && lj.text) return String(lj.text).trim();
              } catch (e2) { /* continue */ }
            }
            return '';
          }
        }

        // ============================================================
        // 自托管 Whisper ASR Webservice (whisper-asr-webservice)
        // Docker: onerahmet/openai-whisper-asr-webservice
        // 接口: POST /asr?output=json&task=transcribe&language=zh
        // 用户填 URL，无限免费，质量最高
        // ============================================================
        async function transcribeWhisperSelf(blob) {
          var url = (state.settings.whisperUrl || '').trim();
          if (!url) throw new Error('未配置自托管 Whisper 服务地址，请到设置页填写');
          // 去掉尾部斜杠
          url = url.replace(/\/+$/, '');
          // 自动补 /asr 端点
          if (!/\/asr$/.test(url)) url = url + '/asr';

          var wavBlob = (await blobToWav(blob)).blob;
          var lang = (state.settings.callLang || 'zh-CN').split('-')[0];

          var params = new URLSearchParams({
            output: 'json',
            task: 'transcribe',
            language: lang
          });

          var r = await fetch(url + '?' + params.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'audio/wav' },
            body: wavBlob
          });
          if (!r.ok) {
            var t = await r.text();
            throw new Error('Whisper Self-Hosted HTTP ' + r.status + ': ' + t.slice(0, 300));
          }
          var j = await r.json();
          return String(j.text || '').trim();
        }

        // ============================================================
        // Transformers.js 浏览器内 Whisper (WebGPU/WASM)
        // 纯前端，无需后端，完全免费，隐私好
        // 需要现代浏览器 (Chrome 113+/Edge 113+ for WebGPU)
        // 首次加载模型 ~250MB (small) / ~150MB (base)
        // ============================================================
        var transformersWhisper = null;  // 缓存 pipeline 实例
        var transformersLoading = false;

        async function transcribeTransformers(blob) {
          // 动态 import transformers.js
          if (!transformersWhisper && !transformersLoading) {
            transformersLoading = true;
            try {
              updateStatus('加载 Whisper 模型中... (首次约 1-2 分钟)');
              var mod = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0');
              var pipeline = mod.pipeline;
              var model = state.settings.transformersModel || 'base';
              // 用 Xenova/whisper-{model} 系列
              var modelName = 'Xenova/whisper-' + model;
              // 优先 WebGPU，回退 WASM
              var device = 'wasm';
              try {
                if (navigator.gpu) {
                  var adapter = await navigator.gpu.requestAdapter();
                  if (adapter) device = 'webgpu';
                }
              } catch (e) { device = 'wasm'; }
              transformersWhisper = await pipeline('automatic-speech-recognition', modelName, {
                device: device,
                dtype: device === 'webgpu' ? 'fp32' : 'q8'
              });
            } catch (e) {
              transformersLoading = false;
              throw new Error('加载 Whisper 模型失败: ' + (e && e.message || e));
            }
            transformersLoading = false;
          }

          // 等待加载完成
          while (transformersLoading) {
            await new Promise(function (r) { setTimeout(r, 200); });
          }
          if (!transformersWhisper) throw new Error('Whisper 模型加载失败');

          // blob 转 AudioBuffer
          var arrayBuf = await blob.arrayBuffer();
          var AC = window.AudioContext || window.webkitAudioContext;
          var ctx = new AC({ sampleRate: 16000 });
          var audioBuf;
          try {
            audioBuf = await ctx.decodeAudioData(arrayBuf);
          } catch (e) {
            // webm 解码失败时,尝试用原始采样率
            var tmpCtx = new AC();
            audioBuf = await tmpCtx.decodeAudioData(arrayBuf);
            await tmpCtx.close();
          }
          // 转 16kHz 单声道 Float32Array
          var offline = new OfflineAudioContext(1, audioBuf.duration * 16000, 16000);
          var src = offline.createBufferSource();
          src.buffer = audioBuf;
          src.connect(offline.destination);
          src.start();
          var rendered = await offline.startRendering();
          await ctx.close();
          var pcm = rendered.getChannelData(0);

          var lang = (state.settings.callLang || 'zh-CN').split('-')[0];
          var output = await transformersWhisper(pcm, {
            language: lang,
            task: 'transcribe',
            return_timestamps: false
          });
          return String((output && output.text) || '').trim();
        }

        // ============================================================
        // 腾讯云一句话识别 (每月 10h 免费, 中文好)
        // 接口: POST https://asr.tencentcloudapi.com
        // 签名: TC3-HMAC-SHA256 (复杂签名, 用一话识别 REST 简化版)
        // 简化实现: 调用 https://asr.cloud.tencent.com/v1/asr
        // ============================================================
        async function transcribeTencent(blob) {
          var appId = (state.settings.tencentAppId || '').trim();
          var secretId = (state.settings.tencentSecretId || '').trim();
          var secretKey = (state.settings.tencentSecretKey || '').trim();
          if (!appId || !secretId || !secretKey) {
            throw new Error('未配置腾讯云 AppID/SecretId/SecretKey，请到设置页填写');
          }

          var wavData = await blobToWav(blob);
          var wavBase64 = btoa(String.fromCharCode.apply(null, new Uint8Array(wavData.dataUrl.split(',')[1])));
          // 注: blobToWav 返回 {blob, dataUrl}, 这里重新读 blob
          var wavArrayBuf = await wavData.blob.arrayBuffer();
          var wavBytes = new Uint8Array(wavArrayBuf);
          var wavBase64Str = '';
          for (var i = 0; i < wavBytes.length; i += 0x8000) {
            wavBase64Str += String.fromCharCode.apply(null, wavBytes.subarray(i, i + 0x8000));
          }
          wavBase64Str = btoa(wavBase64Str);

          var lang = (state.settings.callLang || 'zh-CN').split('-')[0];
          var engSerType = lang === 'zh' ? '8k_0' : '16k_1';  // 8k_0=中文 8k, 16k_1=英文 16k
          // 简化: 默认 16k 中文
          var subServiceType = '8k_0';

          // 腾讯云 ASR 一句话识别 (旧版 cloud.tencent.com/asr/demonstrate)
          // 接口: POST https://asr.cloud.tencent.com/asr/v1/<appid>
          // 签名: HMAC-SHA1 (query string)
          var timestamp = Math.floor(Date.now() / 1000);
          var expired = timestamp + 86400;
          var queryStr = 'appid=' + appId + '&secretid=' + encodeURIComponent(secretId) +
            '&timestamp=' + timestamp + '&expired=' + expired +
            '&engine_model_type=16k_0&voice_format=1&sub_service_type=2';

          // HMAC-SHA1 签名
          var sigMsg = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secretKey),
            { name: 'HMAC', hash: 'SHA-1' },
            false,
            ['sign']
          );
          var sig = await crypto.subtle.sign('HMAC', sigMsg, new TextEncoder().encode(queryStr));
          var sigBase64 = btoa(String.fromCharCode.apply(null, new Uint8Array(sig)));

          var r = await fetch('https://asr.cloud.tencent.com/asr/v1/' + appId + '?' + queryStr + '&signature=' + encodeURIComponent(sigBase64), {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: wavArrayBuf
          });
          if (!r.ok) {
            var t = await r.text();
            throw new Error('腾讯云 HTTP ' + r.status + ': ' + t.slice(0, 300));
          }
          var j = await r.json();
          if (j.code !== 0) throw new Error('腾讯云错误 ' + j.code + ': ' + (j.message || ''));
          return String(j.text || '').trim();
        }

        // ============================================================
        // Vosk 离线语音识别 (Capacitor 原生插件)
        // 依赖: capacitor-offline-speech-recognition (Vosk 引擎)
        // 特点: 完全离线、免费、流式实时识别 (边说边出字)
        // 模型: 首次使用从 alphacephei.com 下载 ~50MB, 永久缓存
        // ============================================================
        var voskPlugin = null;       // Capacitor 插件实例
        var voskListener = null;     // recognitionResult 监听器
        var voskPartialText = '';    // 当前部分识别结果

        // 检测 Vosk 插件是否可用 (APK 环境)
        function detectVoskAvailable() {
          try {
            if (typeof Capacitor !== 'undefined' && Capacitor.Plugins) {
              var p = Capacitor.Plugins.CapacitorOfflineSpeechRecognition ||
                      Capacitor.Plugins.OfflineSpeechRecognition ||
                      Capacitor.Plugins.capacitorOfflineSpeechRecognition;
              if (p) return p;
            }
            if (typeof window !== 'undefined' && window.CapacitorOfflineSpeechRecognition) {
              return window.CapacitorOfflineSpeechRecognition;
            }
          } catch (e) { /* ignore */ }
          return null;
        }

        // 检测 Capacitor Permissions API
        function detectPermissionsPlugin() {
          try {
            if (typeof Capacitor !== 'undefined' && Capacitor.Plugins) {
              return Capacitor.Plugins.Permissions || null;
            }
          } catch (e) { /* ignore */ }
          return null;
        }

        // 主动请求麦克风权限 (在调 Vosk 之前先确保权限)
        // 注意: 不要用 getUserMedia 作为 fallback, 因为 Android WebView 默认会拒绝 getUserMedia
        // 即使 Android 系统层已授权麦克风, WebView 仍会拒绝 (需要 WebChromeClient.onPermissionRequest 授权)
        // 所以这里只尝试 Capacitor Permissions API, 失败就直接让 Vosk 插件自己处理
        async function ensureMicPermissionForVosk() {
          var perms = detectPermissionsPlugin();
          if (!perms) {
            // 没有 Permissions API, 直接让 Vosk 插件自己请求权限 (它有 @RequiresPermission 注解)
            return true;
          }
          try {
            var status = await perms.check({ name: 'microphone' });
            if (status.state === 'granted') return true;
            if (status.state === 'prompt') {
              // prompt 状态, 主动请求
              try {
                var reqStatus = await perms.request({ name: 'microphone' });
                if (reqStatus.state === 'granted') return true;
                // 请求后仍未授权, 不直接返回 denied (可能是误判), 让 Vosk 自己处理
                return true;
              } catch (e) {
                // 请求失败, 让 Vosk 自己处理
                return true;
              }
            }
            if (status.state === 'denied') {
              // 注意: Capacitor 的 'denied' 可能是误判 (Permissions API 未正确注册)
              // 不直接拒绝, 让 Vosk 插件自己尝试请求
              return true;
            }
            return true;
          } catch (e) {
            // Permissions API 不可用或异常, 让 Vosk 自己处理
            return true;
          }
        }

        // 显示 Vosk 模型下载进度 (在通话界面中央显示)
        function showVoskDownloadProgress(percent, message) {
          if (!state.callMsgListEl) return;
          // 移除旧的进度元素
          var old = document.getElementById('rvc-vosk-progress');
          if (old) old.remove();
          if (percent >= 100) {
            // 下载完成, 移除进度
            return;
          }
          var progEl = el('div', {
            id: 'rvc-vosk-progress',
            style: {
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(0,0,0,0.85)',
              padding: '20px 30px',
              borderRadius: '14px',
              color: 'white',
              textAlign: 'center',
              zIndex: '1000',
              minWidth: '200px',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)'
            }
          }, [
            el('div', { style: { fontSize: '14px', marginBottom: '10px' } }, '下载语言模型 (Vosk 离线识别)'),
            el('div', {
              style: {
                width: '100%',
                height: '8px',
                background: 'rgba(255,255,255,0.2)',
                borderRadius: '4px',
                overflow: 'hidden',
                marginBottom: '8px'
              }
            }, [
              el('div', {
                style: {
                  width: percent + '%',
                  height: '100%',
                  background: 'linear-gradient(90deg, #C20C0C, #E60026)',
                  borderRadius: '4px',
                  transition: 'width .3s ease'
                }
              })
            ]),
            el('div', { style: { fontSize: '12px', color: 'rgba(255,255,255,0.7)' } }, Math.floor(percent) + '% - ' + (message || '下载中...'))
          ]);
          // 找到通话界面的容器
          var container = state.callMsgListEl.parentElement;
          if (container && container.style) {
            container.style.position = 'relative';
            container.appendChild(progEl);
          }
        }

        function hideVoskDownloadProgress() {
          var old = document.getElementById('rvc-vosk-progress');
          if (old) old.remove();
        }

        // 启动 Vosk 流式识别 (auto 模式专用, 不走 MediaRecorder)
        async function startVoskListening() {
          if (!voskPlugin) voskPlugin = detectVoskAvailable();
          if (!voskPlugin) {
            addCallMessage({ role: 'sys', text: 'Vosk 离线识别需要 APK 环境 (打包 capacitor-offline-speech-recognition 插件), 浏览器不可用' });
            updateStatus('Vosk 不可用');
            return;
          }

          // 1. 先主动请求麦克风权限 (可选, 失败也继续让 Vosk 自己处理)
          updateStatus('初始化 Vosk...');
          // 不再阻塞流程, 即使权限 API 返回 denied 也让 Vosk 自己尝试
          try {
            await ensureMicPermissionForVosk();
          } catch (e) { /* 忽略, 让 Vosk 自己处理 */ }

          // 映射 STT 识别语言(lang) → Vosk 支持的语言代码 (Vosk 是语音转文字, 用识别语言而非通话语言)
          var voskLang = getVoskLang(state.settings.lang);

          state.callState = 'listening';
          updateStatus('Vosk 识别中...');
          voskPartialText = '';

          // 2. 监听识别结果
          try {
            voskListener = await voskPlugin.addListener('recognitionResult', function (result) {
              if (!result) return;
              // 清洗 Vosk 输出 (中文去空格分词/英文压缩空格)
              var text = cleanVoskText(result.text, state.settings.lang);
              var isPTT = !!(state.stt && state.stt.pttMode);
              if (result.isFinal) {
                voskPartialText = '';
                if (text) {
                  if (isPTT) {
                    // PTT 模式: 累积到 pttTextBuffer, 不自动发送
                    var buf = state.stt.pttTextBuffer || '';
                    state.stt.pttTextBuffer = buf ? buf + '\n' + text : text;
                    updateInterim(state.stt.pttTextBuffer);
                    updateStatus('说话中（再点停止）');
                  } else {
                    // auto 模式: 累积到 utteranceBuffer, 超时自动发送
                    pushUtterance(text);
                    updateInterim(state.utteranceBuffer.join('\n'));
                    updateStatus('继续说或停顿发送...');
                  }
                }
              } else {
                voskPartialText = text;
                if (isPTT) {
                  var buf2 = state.stt.pttTextBuffer || '';
                  updateInterim(buf2 + (text ? '\n' + text : ''));
                } else {
                  updateInterim(state.utteranceBuffer.join('\n') + (text ? '\n' + text : ''));
                }
              }
            });
          } catch (e) {
            addCallMessage({ role: 'sys', text: 'Vosk 监听器注册失败: ' + (e && e.message || e) });
            updateStatus('Vosk 失败');
            return;
          }

          // 3. 启动识别 (不自动下载模型, 模型未下载时提示去设置页下载)
          try {
            await voskPlugin.startRecognition({ language: voskLang });
            updateStatus('正在听...');
          } catch (e) {
            var em = String((e && e.message) || e || '');
            // 权限错误: 只在 Vosk 自己确认权限被拒时才提示
            if (/permission|denied|权限/i.test(em)) {
              // 尝试通过 Vosk 的 requestPermissions 方法 (如果存在)
              var permGranted = false;
              try {
                if (typeof voskPlugin.requestPermissions === 'function') {
                  var pr = await voskPlugin.requestPermissions({ permissions: ['microphone'] });
                  permGranted = pr && pr.microphone === 'granted';
                }
              } catch (e2) { /* 忽略 */ }
              if (permGranted) {
                try {
                  await voskPlugin.startRecognition({ language: voskLang });
                  updateStatus('正在听...');
                  return;
                } catch (e3) {
                  em = String((e3 && e3.message) || e3 || '');
                }
              }
              addCallMessage({ role: 'sys', text: '麦克风权限被拒绝。请到系统设置 → 应用 → Roche → 权限 → 麦克风 → 允许，然后重试。如果已允许仍提示，请重启 Roche' });
              updateStatus('权限被拒');
            } else if (/not.*download|model.*not.*(found|exist|available)|未下载|No such file|cannot find|does not exist/i.test(em)) {
              // 模型未下载: 提示具体哪个语言的模型未下载
              addCallMessage({ role: 'sys', text: 'Vosk「' + voskLang + '」语言模型未下载（原始错误: ' + em + '）。请到插件设置 → STT 引擎 → Vosk 设置 → 点「下载模型」按钮下载对应语言模型。若识别语言与已下载模型不一致，请在设置里把识别语言改为已下载模型的语言' });
              updateStatus('模型未下载(' + voskLang + ')');
            } else {
              // 其他错误: 显示原始错误, 方便排查
              addCallMessage({ role: 'sys', text: 'Vosk 启动失败[' + voskLang + ']: ' + em });
              updateStatus('Vosk 失败');
            }
          }
        }

        // 下载 Vosk 模型并启动识别 (带进度 UI)
        async function downloadVoskModelAndStart(voskLang) {
          if (!voskPlugin) return;
          var label = getVoskLangLabel(state.settings.lang);
          addCallMessage({ role: 'sys', text: 'Vosk ' + label + '(' + voskLang + ') 模型未下载, 开始下载 (~50MB, 首次需要网络)' });
          updateStatus('准备下载' + label + '模型...');

          var progListener = null;
          try {
            // 监听下载进度
            progListener = await voskPlugin.addListener('downloadProgress', function (p) {
              if (!p) return;
              var percent = (typeof p.progress === 'number') ? p.progress : 0;
              var msg = p.message || '下载中...';
              updateStatus('下载' + label + '模型 ' + Math.floor(percent) + '%');
              showVoskDownloadProgress(percent, msg);
              if (percent >= 100) {
                hideVoskDownloadProgress();
              }
            });

            updateStatus('下载' + label + '模型中...');
            showVoskDownloadProgress(0, '开始下载...');

            // 触发下载
            var result = await voskPlugin.downloadLanguageModel({ language: voskLang });
            hideVoskDownloadProgress();
            if (progListener) { try { await progListener.remove(); } catch (e) { /* ignore */ } }

            if (result && result.success !== false) {
              addCallMessage({ role: 'sys', text: label + '模型下载完成, 开始识别' });
              updateStatus('Vosk 识别中...');
              // 重试启动识别
              try {
                await voskPlugin.startRecognition({ language: voskLang });
                updateStatus('正在听...');
              } catch (e2) {
                var em2 = String((e2 && e2.message) || e2 || '');
                if (/permission|denied|权限/i.test(em2)) {
                  addCallMessage({ role: 'sys', text: '麦克风权限被拒绝。请到系统设置 → 应用 → Roche → 权限 → 麦克风 → 允许' });
                  updateStatus('权限被拒');
                } else {
                  addCallMessage({ role: 'sys', text: '模型下载完成但识别启动失败: ' + em2 });
                  updateStatus('启动失败');
                }
              }
            } else {
              addCallMessage({ role: 'sys', text: '模型下载失败: ' + (result && result.message || '未知错误') });
              updateStatus('下载失败');
            }
          } catch (e) {
            hideVoskDownloadProgress();
            if (progListener) { try { await progListener.remove(); } catch (e2) { /* ignore */ } }
            var em = String((e && e.message) || e || '');
            if (/permission|denied|权限/i.test(em)) {
              addCallMessage({ role: 'sys', text: '下载模型需要麦克风权限。请到系统设置 → 应用 → Roche → 权限 → 麦克风 → 允许' });
              updateStatus('权限被拒');
            } else {
              addCallMessage({ role: 'sys', text: '模型下载失败: ' + em });
              updateStatus('下载失败');
            }
          }
        }

        // 停止 Vosk 识别
        async function stopVoskListening() {
          try {
            if (voskPlugin) await voskPlugin.stopRecognition();
          } catch (e) { /* ignore */ }
          if (voskListener) {
            try { await voskListener.remove(); } catch (e) { /* ignore */ }
            voskListener = null;
          }
          voskPartialText = '';
        }

        // Vosk 不走 transcribe(blob) 路径, 但为统一路由保留桩函数
        async function transcribeVosk(blob) {
          throw new Error('Vosk 使用流式识别, 不支持 blob 转录。请通过 callMode=auto + sttProvider=vosk 使用');
        }

        // 启动监听（统一入口）
        function startListening() {
          if (state.callState === 'text_input') return;
          var provider = detectSTTProvider();
          state.finalText = '';
          state.interimText = '';
          state.wantListen = true;
          state.callState = 'listening';
          updateStatus('正在听...');
          updateInterim('');

          if (provider === 'none') {
            // 没有可用的 STT 引擎, 不 fallback, 让用户手动选
            addCallMessage({ role: 'sys', text: '未选择语音识别引擎。请到插件设置 → STT 引擎, 手动选择一个引擎 (Vosk/Groq/百度/小米/Wit.ai 等)' });
            updateStatus('未选引擎');
            state.callState = 'idle';
            return;
          }
          if (provider === 'webspeech') {
            if (!state.recognition) state.recognition = setupWebSpeech();
            if (!state.recognition) {
              addCallMessage({ role: 'sys', text: 'Web Speech API 不可用，请到设置里切换为其他引擎 (Vosk/Groq/百度等)' });
              backToListening();
              return;
            }
            try {
              state.recognition.lang = state.settings.lang;
              state.recognition.start();
            } catch (e) { /* ignore */ }
          } else if (provider === 'vosk') {
            // Vosk 流式识别, 走原生插件路径
            startVoskListening();
          } else {
            startMediaRecorderListening();
          }
        }

        function stopListening() {
          state.wantListen = false;
          if (state.silenceTimer) { clearTimeout(state.silenceTimer); state.silenceTimer = null; }
          if (state.bufferFlushTimer) { clearTimeout(state.bufferFlushTimer); state.bufferFlushTimer = null; }
          if (state.recognition) {
            try { state.recognition.stop(); } catch (e) { /* ignore */ }
          }
          // Vosk 流式识别停止 + 清理进度 UI
          hideVoskDownloadProgress();
          if (voskPlugin) {
            stopVoskListening();
          }
          var stt = state.stt;
          if (stt.vadRaf) { cancelAnimationFrame(stt.vadRaf); stt.vadRaf = null; }
          if (stt.recording) {
            stt.recording = false;
            try { if (stt.mediaRecorder) stt.mediaRecorder.stop(); } catch (e) { /* ignore */ }
          }
          if (stt.micStream) { stt.micStream.getTracks().forEach(function (t) { t.stop(); }); stt.micStream = null; }
          if (stt.audioCtx) { try { stt.audioCtx.close(); } catch (e) { /* ignore */ } stt.audioCtx = null; }
          stt.analyser = null;
          stt.highpass = null;
          stt.compressor = null;
          stt.pttMode = false;
        }

        function onSilence() {
          if (state.callState !== 'listening') return;
          var text = state.finalText.trim();
          state.finalText = '';
          state.interimText = '';
          if (text) pushUtterance(text);
          updateInterim(state.utteranceBuffer.join('\n'));
          // 不停止监听，继续听下一句；由 bufferFlushTimer 负责整体发送
        }

        // 把一句识别结果推入累积 buffer，并重置"发送定时器"
        function pushUtterance(text) {
          var t = (text || '').trim();
          if (!t) return;
          // 情绪识别：把当前段的情绪标签拼到这段文字前（auto 模式累积发送）
          if (state.settings.emotionDetect && state.stt.lastEmotionTags) {
            t = state.stt.lastEmotionTags + '\n' + t;
            state.stt.lastEmotionTags = '';
          }
          state.utteranceBuffer.push(t);
          if (state.bufferFlushTimer) clearTimeout(state.bufferFlushTimer);
          state.bufferFlushTimer = setTimeout(flushBuffer, state.settings.bufferFlushMs || 2500);
        }

        // 攒够多句 + 用户停顿超时 → 整体发送给 char（半双工：发完等 char 说话再听下一轮）
        function flushBuffer() {
          state.bufferFlushTimer = null;
          // 正在识别中（Groq/MiMo 等异步 transcribe 未返回），稍后再试
          if (state.callState === 'thinking') {
            state.bufferFlushTimer = setTimeout(flushBuffer, 500);
            return;
          }
          if (state.callState !== 'listening') return;
          var text = state.utteranceBuffer.join('\n').trim();
          state.utteranceBuffer = [];
          updateInterim('');
          if (!text) return;
          stopListening();
          sendToAI(text);
        }

        // ============================================================
        // TTS：语音合成
        // ============================================================

        async function speak(text, char, config) {
          var voiceId = config.voiceId || pickVoiceId(char) || state.settings.defaultVoiceId;
          state.callState = 'speaking';
          updateStatus('说话中...');

          // 根据当前 TTS provider 路由
          var provider = (config.ttsProvider || state.settings.ttsProvider || 'roche').toLowerCase();
          try {
            var audioUrl;
            if (provider === 'minimax') {
              audioUrl = await ttsMinimax(text, voiceId, config, char);
            } else if (provider === 'elevenlabs') {
              audioUrl = await ttsElevenLabs(text, voiceId, config);
            } else {
              // 默认走 roche.voice.tts
              if (!voiceId) {
                addCallMessage({ role: 'sys', text: '未配置 voiceId，已跳过语音播放' });
                backToListening();
                return;
              }
              var result = await roche.voice.tts({
                text: text,
                voiceId: voiceId,
                language: state.settings.lang.indexOf('zh') === 0 ? 'Chinese' : undefined,
                senderName: char.name || 'Plugin'
              });
              // 鲁棒提取音频 URL（兼容 Roche 不同版本返回字段）
              audioUrl = result && (result.audioUrl || result.url || result.audio || result.data && result.data.audioUrl || result.data && result.data.url);
              if (!audioUrl && typeof result === 'string') audioUrl = result;
              if (!audioUrl) {
                console.error('[RVC] roche.voice.tts 返回结构无法识别:', result);
                addCallMessage({ role: 'sys', text: 'TTS 未返回音频（控制台已打印返回结构）' });
                backToListening();
                return;
              }
            }
            var audio = new Audio(audioUrl);
            state.audio = audio;
            audio.onended = function () { backToListening(); };
            audio.onerror = function () {
              addCallMessage({ role: 'sys', text: '音频播放失败' });
              backToListening();
            };
            await audio.play();
          } catch (e) {
            var msg = (e && e.message) || String(e);
            console.error('[RVC] TTS 失败:', provider, e);
            addCallMessage({ role: 'sys', text: 'TTS 失败 [' + provider + ']: ' + msg });
            backToListening();
          }
        }

        // MiniMax TTS（直接调用公开 API，绕过 roche.voice.tts）
        async function ttsMinimax(text, voiceId, config, char) {
          var apiKey = config.minimaxApiKey || state.settings.minimaxApiKey || '';
          if (!apiKey) throw new Error('未配置 MiniMax API Key');
          var model = config.minimaxModel || state.settings.minimaxModel || 'speech-02-hd';
          // 国内推荐用 bj 域名，海外用 api.minimaxi.com
          var endpoint = config.minimaxEndpoint || state.settings.minimaxEndpoint || 'https://api.minimax.chat/v1/t2a_v2';
          var body = {
            model: model,
            text: text,
            stream: false,
            voice_setting: { voice_id: voiceId },
            audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' }
          };
          var r = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify(body)
          });
          if (!r.ok) {
            var t = await r.text();
            throw new Error('MiniMax HTTP ' + r.status + ': ' + t.slice(0, 300));
          }
          // MiniMax 返回 hex 音频 + data.audio_url 字段
          var json = await r.json();
          var url = json.data && (json.data.audio_url || json.data.audio);
          if (!url && json.data && json.data.audio) {
            // hex 格式 → blob URL
            var hex = json.data.audio;
            if (typeof hex === 'string' && /^[0-9a-fA-F]+$/.test(hex)) {
              var bytes = new Uint8Array(hex.length / 2);
              for (var i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
              url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
            }
          }
          if (!url) throw new Error('MiniMax 未返回音频: ' + JSON.stringify(json).slice(0, 300));
          return url;
        }

        // ElevenLabs TTS（直接调用公开 API）
        async function ttsElevenLabs(text, voiceId, config) {
          var apiKey = config.elevenlabsApiKey || state.settings.elevenlabsApiKey || '';
          if (!apiKey) throw new Error('未配置 ElevenLabs API Key');
          var model = config.elevenlabsModel || state.settings.elevenlabsModel || 'eleven_multilingual_v2';
          var url = 'https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(voiceId);
          var r = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': apiKey,
              'Accept': 'audio/mpeg'
            },
            body: JSON.stringify({
              text: text,
              model_id: model,
              voice_settings: { stability: 0.5, similarity_boost: 0.75 }
            })
          });
          if (!r.ok) {
            var t = await r.text();
            throw new Error('ElevenLabs HTTP ' + r.status + ': ' + t.slice(0, 300));
          }
          var blob = await r.blob();
          return URL.createObjectURL(blob);
        }

        // ============================================================
        // AI 对话
        // ============================================================

        async function sendToAI(userText) {
          addCallMessage({ role: 'user', text: userText });
          state.callHistory.push({ role: 'user', content: userText });
          await sendToAIWithoutPush(userText);
        }

        async function sendToAIWithoutPush(userText) {
          updateInterim('');
          state.callState = 'thinking';
          updateStatus('思考中...');

          try {
            var char = state.currentChar;
            var config = getCharConfig(char.id);
            var messages = await buildMessages(char, config, userText);
            var result = await roche.ai.chat({
              messages: messages,
              temperature: state.settings.temperature
            });
            var reply = ((result && result.text) || '').trim();
            if (!reply) {
              addCallMessage({ role: 'sys', text: 'AI 返回了空回复' });
              backToListening();
              return;
            }
            // 提取中文翻译（外语通话时）
            var ttsText = reply;
            var displayText = reply;
            if (state.settings.translateToChinese && state.settings.callLang.indexOf('zh') !== 0) {
              var m = reply.match(/【中文翻译】([\s\S]*?)$/);
              if (m) {
                // TTS 只念原文（不念翻译），显示则两部分都显示
                ttsText = reply.replace(/\n*【中文翻译】[\s\S]*$/, '').trim();
                displayText = ttsText + '\n\n【中文翻译】' + m[1].trim();
              }
            }
            addCallMessage({ role: 'char', text: displayText });
            state.callHistory.push({ role: 'assistant', content: ttsText });
            await speak(ttsText, char, config);
          } catch (e) {
            addCallMessage({ role: 'sys', text: 'AI 调用失败: ' + (e && e.message || e) });
            backToListening();
          }
        }

        function backToListening() {
          state.audio = null;
          if (state.view !== 'call') return;
          if (state.muted) {
            state.callState = 'idle';
            updateStatus('已静音');
            return;
          }
          if (state.callState === 'text_input') return;
          // PTT 模式：不自动开始监听，等用户按住按钮才录音
          if ((state.settings.callMode || 'auto') === 'ptt') {
            state.callState = 'idle';
            updateStatus('按住说话');
            return;
          }
          startListening();
        }

        // ============================================================
        // 通话界面消息管理
        // ============================================================

        function addCallMessage(msg) {
          msg.id = Date.now() + Math.floor(Math.random() * 10000);
          msg.node = null;
          state.callMessages.push(msg);
          if (!state.callMsgListEl) return;
          var node = renderCallMessage(msg);
          state.callMsgListEl.appendChild(node);
          if (shouldAutoScroll()) {
            state.callMsgListEl.scrollTop = state.callMsgListEl.scrollHeight;
          }
          return node;
        }

        // 渲染单条消息（含操作按钮：撤回/编辑/删除）
        function renderCallMessage(msg) {
          if (msg.role === 'sys') {
            return el('div', { class: 'rvc-msg rvc-msg-' + msg.role }, msg.text);
          }
          // user / char 消息：包裹层 + 气泡 + 操作按钮
          var wrap = el('div', { class: 'rvc-msg-wrap' + (msg.role === 'user' ? ' rvc-msg-wrap-user' : ' rvc-msg-wrap-char') });
          wrap.style.alignSelf = msg.role === 'user' ? 'flex-end' : 'flex-start';

          var bubble = el('div', { class: 'rvc-msg rvc-msg-' + msg.role }, msg.text);
          wrap.appendChild(bubble);

          // 操作按钮区
          var actions = el('div', { class: 'rvc-msg-actions' });
          // 撤回：删除该消息及之后所有消息，回到该消息之前状态
          actions.appendChild(el('button', {
            class: 'rvc-msg-action-btn danger',
            title: '撤回到此处（删除该消息及之后所有消息）',
            onclick: function () { rewindToMessage(msg.id); }
          }, '撤回'));

          if (msg.role === 'user') {
            // 编辑：仅 user 消息可编辑，编辑后重新发送
            actions.appendChild(el('button', {
              class: 'rvc-msg-action-btn',
              title: '编辑该消息后重新发送',
              onclick: function () { editMessage(msg.id); }
            }, '编辑'));
          }
          wrap.appendChild(actions);
          msg.node = wrap;
          return wrap;
        }

        // 撤回到指定消息：删除该消息及之后所有消息（包括 AI 回复）
        function rewindToMessage(msgId) {
          var idx = -1;
          for (var i = 0; i < state.callMessages.length; i++) {
            if (state.callMessages[i].id === msgId) { idx = i; break; }
          }
          if (idx === -1) return;
          // 删除 DOM 节点
          for (var j = idx; j < state.callMessages.length; j++) {
            var m = state.callMessages[j];
            if (m && m.node && m.node.parentNode) m.node.parentNode.removeChild(m.node);
          }
          // 截断 callMessages
          state.callMessages = state.callMessages.slice(0, idx);
          // 同步截断 callHistory（user/assistant 消息）
          // callHistory 与 callMessages 的 user/assistant 消息一一对应
          var histKeep = 0;
          for (var k = 0; k < state.callMessages.length; k++) {
            var role = state.callMessages[k].role;
            if (role === 'user' || role === 'char') histKeep++;
          }
          state.callHistory = state.callHistory.slice(0, histKeep);
          // 停止当前 AI 说话/识别，回到监听状态
          if (state.audio) { try { state.audio.pause(); } catch (e) { /* ignore */ } state.audio = null; }
          stopListening();
          addCallMessage({ role: 'sys', text: '已撤回到此处' });
          backToListening();
        }

        // 编辑 user 消息：把气泡换成输入框，编辑后重新发送
        function editMessage(msgId) {
          var idx = -1;
          var msg = null;
          for (var i = 0; i < state.callMessages.length; i++) {
            if (state.callMessages[i].id === msgId) { idx = i; msg = state.callMessages[i]; break; }
          }
          if (!msg || msg.role !== 'user' || !msg.node) return;
          var wrap = msg.node;
          var oldBubble = wrap.querySelector('.rvc-msg');
          var oldActions = wrap.querySelector('.rvc-msg-actions');
          if (oldActions) oldActions.style.display = 'none';

          var input = el('input', {
            class: 'rvc-msg-edit-input',
            value: msg.text
          });
          var btnRow = el('div', { class: 'rvc-msg-actions', style: { opacity: '1' } }, [
            el('button', {
              class: 'rvc-msg-action-btn',
              onclick: function () {
                var newText = (input.value || '').trim();
                if (!newText) return;
                // 撤回到该消息之前（保留该消息位置），用新文本重发
                rewindToMessage(msg.id);
                // 重新发送
                stopListening();
                sendToAI(newText);
              }
            }, '重发'),
            el('button', {
              class: 'rvc-msg-action-btn',
              onclick: function () {
                // 取消编辑，恢复原样
                if (msg.node) {
                  msg.node = null;
                  var newWrap = renderCallMessage(msg);
                  wrap.parentNode.replaceChild(newWrap, wrap);
                }
              }
            }, '取消')
          ]);
          wrap.replaceChild(input, oldBubble);
          wrap.appendChild(btnRow);
          input.focus();
          input.select();
        }

        function updateInterim(text) {
          if (!state.callMsgListEl) return;
          if (!state.callInterimEl) {
            state.callInterimEl = el('div', { class: 'rvc-msg rvc-msg-interim' });
            state.callMsgListEl.appendChild(state.callInterimEl);
          }
          if (text) {
            state.callInterimEl.textContent = text;
            state.callInterimEl.style.display = '';
            if (shouldAutoScroll()) {
              state.callMsgListEl.scrollTop = state.callMsgListEl.scrollHeight;
            }
          } else {
            state.callInterimEl.style.display = 'none';
          }
        }

        function updateStatus(text) {
          if (state.callStatusEl) state.callStatusEl.textContent = text;
        }

        function shouldAutoScroll() {
          if (!state.callMsgListEl) return true;
          return state.callMsgListEl.scrollTop + state.callMsgListEl.clientHeight >=
            state.callMsgListEl.scrollHeight - 50;
        }

        function startCallTimer() {
          state.callStartTime = Date.now();
          if (state.callTimerEl) state.callTimerEl.textContent = '00:00';
          state.callTimerInterval = setInterval(function () {
            if (state.callTimerEl) {
              state.callTimerEl.textContent = formatTime(Date.now() - state.callStartTime);
            }
          }, 1000);
        }

        function stopCallTimer() {
          if (state.callTimerInterval) {
            clearInterval(state.callTimerInterval);
            state.callTimerInterval = null;
          }
        }

        // ============================================================
        // 渲染：视图分发
        // ============================================================

        function renderView() {
          root.replaceChildren();
          if (state.view === 'list') renderList();
          else if (state.view === 'config') renderConfig(state.currentChar);
          else if (state.view === 'call') renderCall(state.currentChar);
          else if (state.view === 'settings') renderSettings();
          else renderList();
        }

        // ============================================================
        // 渲染：角色列表
        // ============================================================

        function renderList() {
          state.view = 'list';
          root.replaceChildren();

          // 顶栏
          var closeBtn = el('button', {
            class: 'rvc-btn rvc-close-btn',
            title: '关闭插件',
            onclick: function () { roche.ui.closeApp(); }
          }, 'X');
          var settingsBtn = el('button', {
            class: 'rvc-btn icon-btn',
            title: '设置',
            onclick: function () { renderSettings(); }
          });
          settingsBtn.innerHTML = SVG.settings;
          root.appendChild(el('div', { class: 'rvc-topbar' }, [
            closeBtn,
            el('div', { class: 'title' }, '语音通话'),
            settingsBtn
          ]));

          var body = el('div', { class: 'rvc-body' });

          // 通话历史入口
          body.appendChild(el('button', {
            class: 'rvc-btn',
            style: { width: '100%', justifyContent: 'center', marginBottom: '12px' },
            onclick: function () { renderCallHistory(); }
          }, '通话历史'));

          // 直接列出全部角色（用户原话：开始界面列出全部 char）
          if (!state.chars || state.chars.length === 0) {
            body.appendChild(el('div', { class: 'rvc-empty' }, '暂无角色，请先在 Roche 中创建角色'));
          } else {
            var grid = el('div', { class: 'rvc-char-grid' });
            for (var i = 0; i < state.chars.length; i++) {
              (function (c) {
                var cfg = state.charConfigs[c.id];
                var configured = !!cfg;
                var subText;
                if (configured && cfg.lastCallTime) {
                  subText = '上次通话 ' + new Date(cfg.lastCallTime).toLocaleString();
                } else if (configured) {
                  subText = '已配置，点击开始通话';
                } else {
                  subText = '未配置，点击进入配置';
                }
                var card = el('div', { class: 'rvc-char-card', onclick: function () {
                  // 已配置直接进通话；未配置进配置页
                  if (configured) {
                    startCall(c);
                  } else {
                    renderConfig(c);
                  }
                } }, [
                  el('div', { class: 'avatar', html: avatarHTML(c) }),
                  el('div', { class: 'name' }, displayName(c)),
                  el('div', { class: 'sub' }, subText)
                ]);
                // 右上角配置按钮（随时修改配置）
                var configBtn = el('button', {
                  class: 'config-icon',
                  title: '配置',
                  onclick: function (e) {
                    e.stopPropagation();
                    renderConfig(c);
                  }
                });
                configBtn.innerHTML = SVG.settings;
                card.appendChild(configBtn);
                grid.appendChild(card);
              })(state.chars[i]);
            }
            body.appendChild(grid);
          }

          root.appendChild(body);
        }

        // ============================================================
        // 渲染：通话历史列表
        // ============================================================

        function renderCallHistory() {
          state.view = 'history';
          root.replaceChildren();

          var backBtn = el('button', {
            class: 'rvc-btn',
            onclick: function () { renderList(); }
          }, '返回');
          var clearBtn = el('button', {
            class: 'rvc-btn primary',
            id: 'rvc-clear-history-btn'
          }, '清空');
          root.appendChild(el('div', { class: 'rvc-topbar' }, [
            backBtn,
            el('div', { class: 'title' }, '通话历史'),
            clearBtn
          ]));

          var body = el('div', { class: 'rvc-body' });
          root.appendChild(body);
          body.appendChild(el('div', { class: 'rvc-hint' }, '加载中...'));

          roche.storage.get('rvc_call_logs').then(function (logs) {
            logs = logs || [];
            root.replaceChildren(el('div', { class: 'rvc-topbar' }, [
              backBtn,
              el('div', { class: 'title' }, '通话历史 (' + logs.length + ')'),
              clearBtn
            ]));
            var body2 = el('div', { class: 'rvc-body' });
            root.appendChild(body2);

            if (logs.length === 0) {
              body2.appendChild(el('div', { class: 'rvc-empty' }, '暂无通话记录。挂断通话时选择「保留」即可保存到这里。'));
            } else {
              for (var i = 0; i < logs.length; i++) {
                (function (log, idx) {
                  var dur = Math.max(0, Math.round((log.endTime - log.startTime) / 1000));
                  var card = el('div', {
                    class: 'rvc-char-card',
                    style: { cursor: 'pointer' },
                    onclick: function () { showCallLogDetail(log); }
                  }, [
                    el('div', { class: 'name' }, log.charName || '未知角色'),
                    el('div', { class: 'sub' }, new Date(log.startTime).toLocaleString() + ' · ' + log.messages.length + ' 条 · ' + dur + 's')
                  ]);
                  // 删除按钮
                  var delBtn = el('button', {
                    class: 'config-icon',
                    title: '删除',
                    onclick: function (e) {
                      e.stopPropagation();
                      showConfirmDialog('删除这条记录？', '将删除与「' + (log.charName || '未知') + '」的通话记录，不可恢复。', '删除', '取消').then(async function (ok) {
                        if (!ok) return;
                        var all = (await roche.storage.get('rvc_call_logs')) || [];
                        all.splice(idx, 1);
                        await roche.storage.set('rvc_call_logs', all);
                        if (roche.ui.toast) roche.ui.toast('已删除');
                        renderCallHistory();
                      });
                    }
                  });
                  delBtn.innerHTML = SVG.close;
                  card.appendChild(delBtn);
                  body2.appendChild(card);
                })(logs[i], i);
              }
            }

            // 清空按钮事件
            var cb = document.getElementById('rvc-clear-history-btn');
            if (cb) {
              cb.addEventListener('click', async function () {
                if (logs.length === 0) {
                  if (roche.ui.toast) roche.ui.toast('无记录可清空');
                  return;
                }
                var ok = await showConfirmDialog('清空通话历史？', '将删除全部 ' + logs.length + ' 条通话记录，不可恢复。', '清空', '取消');
                if (ok) {
                  await roche.storage.set('rvc_call_logs', []);
                  if (roche.ui.toast) roche.ui.toast('已清空');
                  renderCallHistory();
                }
              });
            }
          }).catch(function (e) {
            root.replaceChildren();
            root.appendChild(el('div', { class: 'rvc-topbar' }, [
              backBtn,
              el('div', { class: 'title' }, '通话历史')
            ]));
            root.appendChild(el('div', { class: 'rvc-body' }, [
              el('div', { class: 'rvc-empty' }, '加载失败: ' + (e && e.message || e))
            ]));
          });
        }

        // 通话记录详情弹窗
        function showCallLogDetail(log) {
          var old = document.getElementById('rvc-log-detail');
          if (old) old.remove();
          var overlay = el('div', {
            id: 'rvc-log-detail',
            style: {
              position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
              background: 'rgba(0,0,0,0.6)', zIndex: '99999',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '16px', boxSizing: 'border-box'
            }
          });
          overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
          var box = el('div', {
            style: {
              background: '#fff', borderRadius: '12px', maxWidth: '640px', width: '100%',
              maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
            }
          });
          var dur = Math.max(0, Math.round((log.endTime - log.startTime) / 1000));
          var header = el('div', {
            style: { padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }
          }, [
            el('div', { style: { fontWeight: '600', fontSize: '15px' } }, log.charName || '未知角色'),
            el('button', {
              class: 'rvc-btn',
              style: { padding: '4px 12px', fontSize: '13px' },
              onclick: function () { overlay.remove(); }
            }, '关闭')
          ]);
          box.appendChild(header);
          box.appendChild(el('div', {
            class: 'rvc-hint',
            style: { padding: '4px 16px', fontSize: '11px', color: '#888' }
          }, new Date(log.startTime).toLocaleString() + ' · ' + log.messages.length + ' 条 · ' + dur + 's'));

          var list = el('div', {
            style: { overflow: 'auto', flex: '1', padding: '12px 16px', background: '#fafafa' }
          });
          for (var i = 0; i < log.messages.length; i++) {
            var m = log.messages[i];
            var bubble = el('div', {
              style: {
                marginBottom: '8px', padding: '8px 12px', borderRadius: '10px',
                maxWidth: '85%', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontSize: '13px', lineHeight: '1.5',
                alignSelf: (m.role === 'user') ? 'flex-end' : 'flex-start',
                background: (m.role === 'user') ? '#C20C0C' : (m.role === 'sys' ? '#eee' : '#fff'),
                color: (m.role === 'user') ? '#fff' : '#222',
                border: (m.role === 'assistant') ? '1px solid #eee' : 'none',
                marginLeft: (m.role === 'user') ? 'auto' : '0'
              }
            }, m.text || '');
            list.appendChild(bubble);
          }
          box.appendChild(list);
          overlay.appendChild(box);
          document.body.appendChild(overlay);
        }

        // ============================================================
        // 渲染：角色配置页
        // ============================================================

        function renderConfig(char) {
          state.view = 'config';
          state.currentChar = char;
          root.replaceChildren();

          var config = getCharConfig(char.id);

          // 顶栏
          root.appendChild(el('div', { class: 'rvc-topbar' }, [
            el('button', {
              class: 'rvc-btn rvc-close-btn',
              title: '关闭插件',
              onclick: function () { roche.ui.closeApp(); }
            }, 'X'),
            el('div', { class: 'title' }, displayName(char) + ' 配置'),
            el('button', {
              class: 'rvc-btn primary',
              onclick: function () { saveAndStartCall(); }
            }, '保存并通话')
          ]));

          var body = el('div', { class: 'rvc-body' });

          // 区块1：通话背景
          var bgSection = el('div', { class: 'rvc-section' }, [
            el('h3', {}, '通话背景')
          ]);
          var bgTypeRow = el('div', { class: 'rvc-row' }, [
            el('label', {}, [
              el('input', {
                type: 'radio',
                name: 'bg-type',
                value: 'color',
                checked: config.bg.type === 'color',
                onchange: function () {
                  config.bg.type = 'color';
                  updateBgPreview();
                }
              }),
              '纯色'
            ]),
            el('label', {}, [
              el('input', {
                type: 'radio',
                name: 'bg-type',
                value: 'image',
                checked: config.bg.type === 'image',
                onchange: function () {
                  config.bg.type = 'image';
                  updateBgPreview();
                }
              }),
              '图片 URL'
            ])
          ]);
          bgSection.appendChild(bgTypeRow);

          var colorInput = el('input', {
            type: 'color',
            value: config.bg.type === 'color' ? config.bg.value : '#0d1117',
            oninput: function (e) {
              config.bg.value = e.target.value;
              updateBgPreview();
            }
          });
          bgSection.appendChild(el('div', {}, [colorInput]));

          var imgInput = el('input', {
            type: 'text',
            value: config.bg.type === 'image' ? config.bg.value : '',
            placeholder: 'https://example.com/bg.jpg',
            oninput: function (e) {
              config.bg.value = e.target.value;
              updateBgPreview();
            }
          });
          bgSection.appendChild(el('div', { style: { marginTop: '8px' } }, [imgInput]));

          var bgPreview = el('div', {
            style: {
              width: '100%',
              height: '60px',
              borderRadius: '8px',
              marginTop: '8px',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              background: 'linear-gradient(160deg,#0f0c29 0%,#1a1a2e 45%,#232552 100%)',
              border: '1px solid rgba(255,255,255,0.12)'
            }
          });
          bgSection.appendChild(bgPreview);
          body.appendChild(bgSection);

          function updateBgPreview() {
            if (config.bg.type === 'image' && config.bg.value) {
              bgPreview.style.background = 'url("' + config.bg.value + '") center/cover, linear-gradient(160deg,#0f0c29 0%,#1a1a2e 45%,#232552 100%)';
            } else if (config.bg.value) {
              bgPreview.style.background = config.bg.value;
            } else {
              bgPreview.style.background = 'linear-gradient(160deg,#0f0c29 0%,#1a1a2e 45%,#232552 100%)';
            }
          }
          updateBgPreview();

          // 区块2：语音 voiceId
          var voiceSection = el('div', { class: 'rvc-section' }, [
            el('h3', {}, '语音 voiceId'),
            el('div', { class: 'rvc-hint' }, '留空则从角色字段读取（voiceId / voice / tts.voiceId）')
          ]);
          var charVoiceId = pickVoiceId(char);
          if (charVoiceId) {
            voiceSection.appendChild(el('div', { class: 'rvc-hint' }, '角色已绑定: ' + charVoiceId));
          }
          voiceSection.appendChild(el('input', {
            type: 'text',
            value: config.voiceId || '',
            placeholder: charVoiceId ? '留空使用角色默认: ' + charVoiceId : '填写 voiceId',
            oninput: function (e) { config.voiceId = e.target.value; }
          }));
          body.appendChild(voiceSection);

          // 区块3：单聊记忆
          var dmSection = el('div', { class: 'rvc-section' }, [
            el('h3', {}, '单聊记忆')
          ]);
          dmSection.appendChild(el('label', {}, '短期记忆条数'));
          dmSection.appendChild(el('input', {
            type: 'number',
            min: '0',
            max: '500',
            value: String(config.memory.dm.shortTermLimit),
            oninput: function (e) { config.memory.dm.shortTermLimit = parseInt(e.target.value) || 0; }
          }));
          dmSection.appendChild(el('label', {}, '事实记忆条数'));
          dmSection.appendChild(el('input', {
            type: 'number',
            min: '0',
            max: '50',
            value: String(config.memory.dm.factsLimit),
            oninput: function (e) { config.memory.dm.factsLimit = parseInt(e.target.value) || 0; }
          }));
          dmSection.appendChild(el('div', { class: 'rvc-toggle' }, [
            el('input', {
              type: 'checkbox',
              checked: config.memory.dm.core,
              onchange: function (e) { config.memory.dm.core = e.target.checked; }
            }),
            el('span', {}, '挂载核心记忆')
          ]));
          body.appendChild(dmSection);

          // 区块4：群聊记忆（异步加载）
          var groupSection = el('div', { class: 'rvc-section' }, [
            el('h3', {}, '群聊记忆'),
            el('div', { class: 'rvc-hint' }, '加载中...')
          ]);
          body.appendChild(groupSection);

          roche.conversation.list({ isGroup: true }).then(function (conversations) {
            // 前端再过滤一次：只保留 char 所在的群聊（members 包含 char.id）
            var charId = char.id;
            conversations = (conversations || []).filter(function (conv) {
              if (!conv.members) return false;
              return conv.members.indexOf(charId) !== -1;
            });
            groupSection.replaceChildren(el('h3', {}, '群聊记忆'));
            if (!conversations || conversations.length === 0) {
              groupSection.appendChild(el('div', { class: 'rvc-hint' }, '该角色所在群聊为空'));
              return;
            }
            // 同步 config.memory.groups 与实际会话
            var existingIds = {};
            for (var i = 0; i < config.memory.groups.length; i++) {
              existingIds[config.memory.groups[i].conversationId] = config.memory.groups[i];
            }
            // 清除 config 里存在但实际会话里已不包含该 char 的群聊项
            var validIds = {};
            for (var j = 0; j < conversations.length; j++) {
              validIds[conversations[j].id] = true;
              if (!existingIds[conversations[j].id]) {
                config.memory.groups.push({
                  conversationId: conversations[j].id,
                  name: conversations[j].name || '未命名群聊',
                  enabled: false,
                  shortTermLimit: 0,
                  factsLimit: 0,
                  core: false
                });
              }
            }
            // 过滤掉 config 里已经失效的群聊项（conversation 不再存在或不包含该 char）
            config.memory.groups = config.memory.groups.filter(function (g) {
              return validIds[g.conversationId];
            });

            for (var k = 0; k < config.memory.groups.length; k++) {
              (function (group) {
                var item = el('div', { class: 'rvc-group-item' }, [
                  el('div', { class: 'group-head' }, [
                    el('input', {
                      type: 'checkbox',
                      checked: group.enabled,
                      onchange: function (e) { group.enabled = e.target.checked; }
                    }),
                    el('div', { class: 'name' }, group.name)
                  ])
                ]);
                var fields = el('div', { class: 'group-fields' });
                fields.appendChild(el('label', {}, '短期'));
                fields.appendChild(el('input', {
                  type: 'number',
                  value: String(group.shortTermLimit),
                  oninput: function (e) { group.shortTermLimit = parseInt(e.target.value) || 0; }
                }));
                fields.appendChild(el('label', {}, '事实'));
                fields.appendChild(el('input', {
                  type: 'number',
                  value: String(group.factsLimit),
                  oninput: function (e) { group.factsLimit = parseInt(e.target.value) || 0; }
                }));
                fields.appendChild(el('label', {}, '核心'));
                fields.appendChild(el('input', {
                  type: 'checkbox',
                  checked: group.core,
                  onchange: function (e) { group.core = e.target.checked; }
                }));
                item.appendChild(fields);
                groupSection.appendChild(item);
              })(config.memory.groups[k]);
            }
          }).catch(function () {
            groupSection.replaceChildren(el('h3', {}, '群聊记忆'), el('div', { class: 'rvc-hint' }, '加载失败'));
          });

          // 区块5：世界书（异步加载）
          var wbSection = el('div', { class: 'rvc-section' }, [
            el('h3', {}, '世界书'),
            el('div', { class: 'rvc-hint' }, '加载中...')
          ]);
          body.appendChild(wbSection);

          roche.worldbook.list().then(function (categories) {
            wbSection.replaceChildren(el('h3', {}, '世界书'));
            if (!categories || categories.length === 0) {
              wbSection.appendChild(el('div', { class: 'rvc-hint' }, '暂无世界书分类'));
              return;
            }
            for (var i = 0; i < categories.length; i++) {
              (function (cat) {
                var catId = cat.id || cat.name;
                var checked = config.worldbook.categoryIds.indexOf(catId) !== -1;
                wbSection.appendChild(el('div', { class: 'rvc-toggle' }, [
                  el('input', {
                    type: 'checkbox',
                    checked: checked,
                    onchange: function (e) {
                      if (e.target.checked) {
                        if (config.worldbook.categoryIds.indexOf(catId) === -1) {
                          config.worldbook.categoryIds.push(catId);
                        }
                        config.worldbook.enabled = true;
                      } else {
                        var idx = config.worldbook.categoryIds.indexOf(catId);
                        if (idx !== -1) config.worldbook.categoryIds.splice(idx, 1);
                        if (config.worldbook.categoryIds.length === 0) config.worldbook.enabled = false;
                      }
                    }
                  }),
                  el('span', {}, cat.name || cat.title || catId)
                ]));
              })(categories[i]);
            }
          }).catch(function () {
            wbSection.replaceChildren(el('h3', {}, '世界书'), el('div', { class: 'rvc-hint' }, '加载失败'));
          });

          // 区块6：user 人设选择（每个 char 可绑定不同 user 人设）
          var personaSection = el('div', { class: 'rvc-section' }, [
            el('h3', {}, '通话 user 人设'),
            el('div', { class: 'rvc-hint' }, '选择本次通话用的是哪个 user 人设。每个角色可绑定不同的 user，绑定后通话提示词的 {{user}} {{user_persona}} 会用这个 user 的信息。留空则用当前激活的 user。')
          ]);
          var personaSelect = el('select', {
            style: { width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #e0e0e0', marginTop: '6px' },
            onchange: function (e) { config.userPersonaId = e.target.value; }
          });
          personaSelect.appendChild(el('option', { value: '' }, '（用当前激活的 user）'));
          if (state.userPersonas && state.userPersonas.length) {
            for (var pi = 0; pi < state.userPersonas.length; pi++) {
              var p = state.userPersonas[pi];
              var pName = p.name || p.handle || ('人设#' + (p.id || pi));
              var opt = el('option', { value: p.id }, pName);
              if (config.userPersonaId === p.id) opt.setAttribute('selected', '');
              personaSelect.appendChild(opt);
            }
          } else {
            personaSelect.appendChild(el('option', { value: '', disabled: '' }, '（暂无 user 人设，请先在 Roche 创建）'));
          }
          personaSection.appendChild(personaSelect);
          // 显示当前激活 user（供参考）
          if (state.activeUser) {
            var auName = state.activeUser.name || state.activeUser.handle || '未知';
            personaSection.appendChild(el('div', { class: 'rvc-hint', style: 'color:#888' }, '当前激活的 user：' + auName));
          }
          body.appendChild(personaSection);

          // 区块7：通话提示词
          var promptSection = el('div', { class: 'rvc-section' }, [
            el('h3', {}, '通话提示词'),
            el('div', { class: 'rvc-hint' }, '留空使用内置提示词，支持变量: {{char}} {{user}} {{persona}} {{user_persona}} {{memory}}')
          ]);
          var promptInput = el('textarea', {
            placeholder: '留空使用内置通话提示词...',
            oninput: function (e) { config.callPrompt = e.target.value; }
          });
          promptInput.value = config.callPrompt || '';
          promptSection.appendChild(promptInput);
          body.appendChild(promptSection);

          // 底部保存按钮
          body.appendChild(el('div', { class: 'rvc-config-actions' }, [
            el('button', {
              class: 'rvc-btn',
              onclick: function () {
                saveCharConfigs().then(function () {
                  if (roche.ui.toast) roche.ui.toast('配置已保存');
                  renderList();
                });
              }
            }, '保存配置并返回'),
            el('button', {
              class: 'rvc-btn primary',
              onclick: function () { saveAndStartCall(); }
            }, '保存并通话')
          ]));

          root.appendChild(body);

          // 保存并开始通话
          function saveAndStartCall() {
            saveCharConfigs();
            startCall(char);
          }
        }

        // ============================================================
        // 渲染：通话界面（手机通话 UI）
        // ============================================================

        function renderCall(char) {
          state.view = 'call';
          state.currentChar = char;
          root.replaceChildren();

          var config = getCharConfig(char.id);
          var bgStyle = '';
          if (config.bg.type === 'image' && config.bg.value) {
            bgStyle = 'background-image:url("' + config.bg.value + '")';
          } else if (config.bg.value) {
            bgStyle = 'background-color:' + config.bg.value;
          }
          // 未配置背景时 bgStyle 留空，使用 CSS 默认梦幻渐变

          // 通话视图容器
          var callView = el('div', { class: 'rvc-call-view', style: bgStyle });
          state.callViewEl = callView;
          callView.appendChild(el('div', { class: 'rvc-call-overlay' }));

          // 顶栏：返回 + 计时器 + 静音
          var topbar = el('div', { class: 'rvc-call-topbar' });
          var backBtn = el('button', { class: 'rvc-call-back' }, '返回');
          backBtn.addEventListener('click', function () { hangup(); });
          topbar.appendChild(backBtn);

          state.callTimerEl = el('div', { class: 'rvc-call-timer' }, '00:00');
          topbar.appendChild(state.callTimerEl);

          state.callMuteBtnTop = el('button', { class: 'rvc-call-mute-top' });
          state.callMuteBtnTop.innerHTML = SVG.mic;
          state.callMuteBtnTop.addEventListener('click', function () { toggleMute(); });
          topbar.appendChild(state.callMuteBtnTop);
          callView.appendChild(topbar);

          // 头部：头像 + 名字 + 状态
          var header = el('div', { class: 'rvc-call-header' });
          var avatarDiv = el('div', { class: 'rvc-call-avatar' });
          avatarDiv.innerHTML = avatarHTML(char);
          header.appendChild(avatarDiv);
          header.appendChild(el('div', { class: 'rvc-call-name' }, displayName(char)));
          state.callStatusEl = el('div', { class: 'rvc-call-status' }, '准备中...');
          header.appendChild(state.callStatusEl);

          // 音波频率动画 (状态文字下方, 录音时激活)
          var waveform = el('div', { class: 'rvc-call-waveform' });
          for (var i = 0; i < 16; i++) {
            var bar = el('div', { class: 'rvc-wave-bar' });
            bar.style.animationDelay = (i * 0.08) + 's';
            waveform.appendChild(bar);
          }
          header.appendChild(waveform);
          callView.appendChild(header);

          // 消息列表
          state.callMsgListEl = el('div', { class: 'rvc-call-messages' });
          state.callMsgListEl.addEventListener('scroll', function () {
            var atBottom = state.callMsgListEl.scrollTop + state.callMsgListEl.clientHeight >=
              state.callMsgListEl.scrollHeight - 4;
            state.scrollLocked = atBottom;
          });
          state.callInterimEl = null;
          callView.appendChild(state.callMsgListEl);

          // 底部控制栏
          state.callBottomEl = el('div', { class: 'rvc-call-bottom' });
          renderVoiceControls();
          callView.appendChild(state.callBottomEl);

          root.appendChild(callView);

          // 渲染已有消息
          state.callMessages = [];
          state.callHistory = [];
          state.utteranceBuffer = [];
          state.finalText = '';
          state.interimText = '';
        }

        function renderVoiceControls() {
          if (!state.callBottomEl) return;
          state.callBottomEl.replaceChildren();
          state.callBottomEl.style.justifyContent = 'center';
          state.callBottomEl.style.gap = '28px';

          var isPTT = (state.settings.callMode || 'auto') === 'ptt';

          // 主按钮 (PTT 或 静音) - 放中间
          var mainBtn;
          if (isPTT) {
            // PTT 模式：点击切换 (点一下开始说话, 再点一下停止并发送)
            mainBtn = el('button', { class: 'rvc-call-btn rvc-call-btn-ptt' });
            mainBtn.innerHTML = SVG.mic + '<span class="ptt-label">点击说话</span>';
            var pttActive = false;
            var pttToggle = function (e) {
              e.preventDefault();
              if (pttActive) {
                // 正在录音, 点击 → 停止并发送
                pttActive = false;
                mainBtn.classList.remove('recording');
                mainBtn.innerHTML = SVG.mic + '<span class="ptt-label">点击说话</span>';
                setWaveformActive(false);
                stopPTTRecording();
              } else {
                // 空闲, 点击 → 开始说话
                pttActive = true;
                mainBtn.classList.add('recording');
                mainBtn.innerHTML = SVG.stop + '<span class="ptt-label">点击停止</span>';
                setWaveformActive(true);
                startPTTRecording();
              }
            };
            mainBtn.addEventListener('click', pttToggle);
          } else {
            // auto 模式：静音按钮
            mainBtn = el('button', { class: 'rvc-call-btn rvc-call-btn-mute' + (state.muted ? ' muted' : '') });
            mainBtn.innerHTML = state.muted ? SVG.micOff : SVG.mic;
            mainBtn.addEventListener('click', function () { toggleMute(); });
            state.callMuteBtnBottom = mainBtn;
          }

          // 挂断按钮 (左)
          var hangupBtn = el('button', { class: 'rvc-call-btn rvc-call-btn-hangup' });
          hangupBtn.innerHTML = SVG.phoneHangup;
          hangupBtn.addEventListener('click', function () { hangup(); });

          // 文字按钮 (右)
          var textBtn = el('button', { class: 'rvc-call-btn rvc-call-btn-text' });
          textBtn.innerHTML = SVG.keyboard;
          textBtn.addEventListener('click', function () { switchToTextInput(); });

          // 顺序: 挂断(左) → 主按钮(中) → 文字(右)
          state.callBottomEl.appendChild(hangupBtn);
          state.callBottomEl.appendChild(mainBtn);
          state.callBottomEl.appendChild(textBtn);
        }

        // 音波动画开关
        function setWaveformActive(on) {
          var wf = state.callViewEl && state.callViewEl.querySelector('.rvc-call-waveform');
          if (wf) {
            if (on) wf.classList.add('active');
            else wf.classList.remove('active');
          }
        }

        function renderTextInputControls() {
          if (!state.callBottomEl) return;
          state.callBottomEl.replaceChildren();
          state.callBottomEl.style.justifyContent = 'stretch';
          state.callBottomEl.style.gap = '8px';

          var textBar = el('div', { class: 'rvc-call-text-bar' });
          var input = el('input', {
            class: 'rvc-call-text-input',
            type: 'text',
            placeholder: '输入文字...',
            onkeydown: function (e) {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendTextMessage(input.value);
              }
            }
          });
          textBar.appendChild(input);

          var sendBtn = el('button', { class: 'rvc-call-send-btn' });
          sendBtn.innerHTML = SVG.send;
          sendBtn.addEventListener('click', function () {
            sendTextMessage(input.value);
          });
          textBar.appendChild(sendBtn);

          state.callBottomEl.appendChild(textBar);
          input.focus();
        }

        function switchToTextInput() {
          stopListening();
          state.callState = 'text_input';
          updateStatus('文字输入中...');
          renderTextInputControls();
        }

        function switchToVoiceInput() {
          state.callState = 'idle';
          renderVoiceControls();
          startListening();
        }

        async function sendTextMessage(text) {
          text = (text || '').trim();
          if (!text) return;
          var input = state.callBottomEl.querySelector('.rvc-call-text-input');
          if (input) input.value = '';
          await sendToAI(text);
          // 发送后切回语音
          switchToVoiceInput();
        }

        // ============================================================
        // 通话控制
        // ============================================================

        async function startCall(char) {
          state.currentChar = char;
          state.callMessages = [];
          state.callHistory = [];
          state.finalText = '';
          state.interimText = '';
          state.scrollLocked = true;
          state.muted = false;
          renderCall(char);
          addCallMessage({ role: 'sys', text: '通话已开始' });
          startCallTimer();
          // PTT 模式不自动监听，等用户按住按钮
          if ((state.settings.callMode || 'auto') === 'ptt') {
            state.callState = 'idle';
            updateStatus('按住说话');
          } else {
            startListening();
          }
        }

        async function hangup() {
          stopListening();
          stopCallTimer();
          if (state.audio) { try { state.audio.pause(); } catch (e) { /* ignore */ } state.audio = null; }

          var char = state.currentChar;
          // 快照（清空前保留，用于 syncToChat 注入与通话记录保存）
          var msgSnapshot = state.callMessages.slice();
          var startTs = state.callStartTime || Date.now();

          // 仅在用户开启 syncToChat 时注入消息到 Roche 主聊天会话
          if (state.settings.syncToChat && char && char.conversationId && msgSnapshot.length > 0) {
            var injectable = [];
            for (var i = 0; i < msgSnapshot.length; i++) {
              var m = msgSnapshot[i];
              if (m.role === 'sys') continue;
              injectable.push({
                isMe: m.role === 'user',
                text: m.text,
                timestamp: m.timestamp || Date.now()
              });
            }
            if (injectable.length > 0) {
              try {
                await injectMessagesToRoche(char, injectable);
                if (roche.ui.toast) roche.ui.toast('已同步 ' + injectable.length + ' 条消息到聊天会话');
              } catch (e) {
                if (roche.ui.toast) roche.ui.toast('消息同步失败: ' + (e && e.message || e));
              }
            }
          }

          // 更新最后通话时间（无论是否同步）
          if (char) {
            var cfg = state.charConfigs[char.id];
            if (cfg) {
              cfg.lastCallTime = Date.now();
              await saveCharConfigs();
            }
          }

          // 弹窗：保留通话记录？（仅有消息时才问）
          if (char && msgSnapshot.length > 0) {
            var keep = await showConfirmDialog(
              '保留通话记录？',
              '是否把本次通话记录保存到通话历史？可在列表页「通话历史」随时查看。',
              '保留', '丢弃'
            );
            if (keep) {
              var log = {
                id: 'log_' + Date.now(),
                charId: char.id,
                charName: displayName(char),
                startTime: startTs,
                endTime: Date.now(),
                messages: msgSnapshot.map(function (m) {
                  return { role: m.role, text: m.text, timestamp: m.timestamp || Date.now() };
                })
              };
              try {
                var logs = (await roche.storage.get('rvc_call_logs')) || [];
                logs.unshift(log);
                if (logs.length > 100) logs = logs.slice(0, 100);
                await roche.storage.set('rvc_call_logs', logs);
                if (roche.ui.toast) roche.ui.toast('通话记录已保留');
              } catch (e) {
                if (roche.ui.toast) roche.ui.toast('保存失败: ' + (e && e.message || e));
              }
            }
          }

          state.callState = 'idle';
          state.currentChar = null;
          state.callMessages = [];
          state.callHistory = [];
          state.utteranceBuffer = [];
          state.finalText = '';
          state.interimText = '';
          renderList();
        }

        function toggleMute() {
          state.muted = !state.muted;
          // 更新顶部静音按钮
          if (state.callMuteBtnTop) {
            if (state.muted) {
              state.callMuteBtnTop.classList.add('muted');
              state.callMuteBtnTop.innerHTML = SVG.micOff;
            } else {
              state.callMuteBtnTop.classList.remove('muted');
              state.callMuteBtnTop.innerHTML = SVG.mic;
            }
          }
          // 更新底部静音按钮
          if (state.callMuteBtnBottom) {
            if (state.muted) {
              state.callMuteBtnBottom.classList.add('muted');
              state.callMuteBtnBottom.innerHTML = SVG.micOff;
            } else {
              state.callMuteBtnBottom.classList.remove('muted');
              state.callMuteBtnBottom.innerHTML = SVG.mic;
            }
          }

          if (state.muted) {
            stopListening();
            state.callState = 'idle';
            updateStatus('已静音');
          } else {
            if (state.callState === 'idle' || state.callState === 'listening') {
              startListening();
            }
          }
        }

        // ============================================================
        // 渲染：通用设置
        // ============================================================

        // 提示词预览弹窗（展示实际注入的完整 system prompt）
        function showPromptPreview(text, note) {
          var old = document.getElementById('rvc-prompt-preview');
          if (old) old.remove();
          var overlay = el('div', {
            id: 'rvc-prompt-preview',
            style: {
              position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
              background: 'rgba(0,0,0,0.6)', zIndex: '99999',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '16px', boxSizing: 'border-box'
            }
          });
          overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
          var box = el('div', {
            style: {
              background: '#fff', borderRadius: '12px', maxWidth: '640px', width: '100%',
              maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
            }
          });
          var header = el('div', {
            style: { padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }
          }, [
            el('div', { style: { fontWeight: '600', fontSize: '15px' } }, '实际注入的完整提示词'),
            el('button', {
              class: 'rvc-btn',
              style: { padding: '4px 12px', fontSize: '13px' },
              onclick: function () { overlay.remove(); }
            }, '关闭')
          ]);
          if (note) {
            box.appendChild(header);
            box.appendChild(el('div', { class: 'rvc-hint', style: { padding: '4px 16px 0', fontSize: '11px', color: '#888' } }, note));
          } else {
            box.appendChild(header);
          }
          box.appendChild(el('pre', {
            style: {
              padding: '12px 16px', margin: '0', overflow: 'auto',
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '12px', lineHeight: '1.5',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#222',
              background: '#fafafa', flex: '1', borderTop: '1px solid #eee'
            }
          }, text));
          overlay.appendChild(box);
          document.body.appendChild(overlay);
        }

        // 通用确认弹窗（返回 Promise<boolean>）
        function showConfirmDialog(title, msg, okLabel, cancelLabel) {
          return new Promise(function (resolve) {
            var old = document.getElementById('rvc-confirm-dialog');
            if (old) old.remove();
            var overlay = el('div', {
              id: 'rvc-confirm-dialog',
              style: {
                position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
                background: 'rgba(0,0,0,0.6)', zIndex: '100000',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '16px', boxSizing: 'border-box'
              }
            });
            var box = el('div', {
              style: {
                background: '#fff', borderRadius: '12px', maxWidth: '380px', width: '100%',
                padding: '20px', boxSizing: 'border-box', boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
              }
            });
            box.appendChild(el('div', { style: { fontWeight: '600', fontSize: '16px', marginBottom: '8px' } }, title));
            if (msg) box.appendChild(el('div', { style: { fontSize: '13px', color: '#666', lineHeight: '1.5', marginBottom: '16px' } }, msg));
            var btnRow = el('div', { style: { display: 'flex', gap: '8px' } });
            btnRow.appendChild(el('button', {
              class: 'rvc-btn',
              style: { flex: '1', padding: '8px', justifyContent: 'center' },
              onclick: function () { overlay.remove(); resolve(false); }
            }, cancelLabel || '取消'));
            btnRow.appendChild(el('button', {
              class: 'rvc-btn primary',
              style: { flex: '1', padding: '8px', justifyContent: 'center' },
              onclick: function () { overlay.remove(); resolve(true); }
            }, okLabel || '确定'));
            box.appendChild(btnRow);
            overlay.appendChild(box);
            document.body.appendChild(overlay);
          });
        }

        function renderSettings() {
          state.view = 'settings';
          root.replaceChildren();
          var s = state.settings;

          root.appendChild(el('div', { class: 'rvc-topbar' }, [
            el('button', {
              class: 'rvc-btn rvc-close-btn',
              title: '关闭插件',
              onclick: function () { roche.ui.closeApp(); }
            }, 'X'),
            el('div', { class: 'title' }, '设置'),
            el('button', {
              class: 'rvc-btn primary',
              onclick: function () { saveSettings(); renderList(); }
            }, '保存')
          ]));

          var body = el('div', { class: 'rvc-body rvc-settings-view' });
          var valMs, valT, valH;

          // 悬浮语音球区（置顶，显眼）
          body.appendChild(el('div', { class: 'rvc-section' }, [
            el('h3', {}, '悬浮语音球'),
            el('div', { class: 'rvc-toggle' }, [
              el('input', {
                type: 'checkbox',
                checked: !!s.floatingBall,
                onchange: function (e) {
                  s.floatingBall = e.target.checked;
                  state.settings.floatingBall = s.floatingBall;
                  updateFloatBallVisibility();
                  saveSettings();
                }
              }),
              el('span', {}, '启用悬浮语音球（任意页面点击录音→转文字→注入输入框）')
            ]),
            el('div', { class: 'rvc-hint' }, '开启后屏幕右下角出现红色悬浮球：拖动可移动位置，点击开始录音，再次点击停止并把识别文字注入当前聊天输入框。识别引擎优先用 Vosk（APK），浏览器环境回退到 Web Speech API。开关即时生效并自动保存。'),
            el('div', { class: 'rvc-hint' }, '插件面板关闭后悬浮球仍保留（后台保活），可在任意页面录音注入。如需彻底关闭悬浮球并清理后台，点下方按钮。'),
            el('div', { class: 'rvc-toggle', style: { marginTop: '8px' } }, [
              el('input', {
                type: 'checkbox',
                checked: !!s.floatAutoEnter,
                onchange: function (e) {
                  s.floatAutoEnter = e.target.checked;
                  state.settings.floatAutoEnter = s.floatAutoEnter;
                  saveSettings();
                }
              }),
              el('span', {}, '注入后自动回车发送')
            ]),
            el('div', { class: 'rvc-hint' }, '开启后，悬浮球识别完文字注入输入框后会自动模拟回车键尝试发送。若通话/聊天界面用回车发送消息则直接生效；若用按钮发送则无效，关闭此项改为只注入不发送。'),
            el('button', {
              class: 'rvc-btn danger',
              style: { marginTop: '8px' },
              onclick: function () {
                if (!confirm('确定彻底关闭悬浮球？将停止录音、移除悬浮球并清理后台，需重新在设置里开启才能恢复。')) return;
                forceShutdownFloatBall();
                renderList();
              }
            }, '彻底关闭悬浮球（清理后台）')
          ]));

          // 情绪识别区
          body.appendChild(el('div', { class: 'rvc-section' }, [
            el('h3', {}, '情绪识别（语气 / 音量 / 情绪标签）'),
            el('div', { class: 'rvc-toggle' }, [
              el('input', {
                type: 'checkbox',
                checked: !!s.emotionDetect,
                onchange: function (e) {
                  s.emotionDetect = e.target.checked;
                  state.settings.emotionDetect = s.emotionDetect;
                  saveSettings();
                }
              }),
              el('span', {}, '开启情绪识别（把说话时的语气/音量/情绪标签注入提示词）')
            ]),
            el('div', { class: 'rvc-hint' }, '开启后，用 MediaRecorder 路径（webkit / Groq / MiMo / 百度 / 腾讯 / Wit / Transformers.js / 自托管 Whisper）识别时会提取音量、音高、音色，规则映射成 [音量:大][音高:高/紧张][情绪:激动/兴奋] 标签拼到你的话前注入 char，char 能感知你说话的语气。注意：Vosk 流式识别的音频在 Android 原生层，JS 拿不到 PCM，此开关对 Vosk 无效（不注入标签，不影响原功能）。规则较粗糙，仅供参考。')
          ]));

          // STT 区
          body.appendChild(el('div', { class: 'rvc-section' }, [
            el('h3', {}, '语音识别 (STT)'),
            el('a', {
              href: 'https://console.groq.com/keys',
              target: '_blank',
              class: 'rvc-link'
            }, '去 Groq 注册 API Key (免费)'),
            el('label', {}, '识别引擎'),
            (function () {
              var sel = el('select', {
                onchange: function (e) { s.sttProvider = e.target.value; }
              });
              var opts = [
                ['auto', '自动 (推荐: Chrome/Edge 用浏览器内置, 其他用 Groq)'],
                ['webspeech', 'Web Speech API (仅 Chrome/Edge, 免费)'],
                ['groq', 'Groq Whisper (全浏览器通用, 海外免费)'],
                ['mimo', '小米 MiMo ASR (限时免费, 中文极好, 推荐)'],
                ['baidu', '百度一句话识别 (180天内15万次免费, 中文好)'],
                ['wit', 'Wit.ai (免费, 英文最佳, 适合练口语)'],
                ['whisper_self', '自托管 Whisper (用户自部署, 无限免费, 质量最高)'],
                ['transformers', 'Transformers.js 浏览器内 Whisper (纯前端, 完全免费)'],
                ['tencent', '腾讯云一句话识别 (每月10h永久免费, 中文好)'],
                ['vosk', 'Vosk 离线识别 (APK 专用, 完全免费, 流式实时)']
              ];
              for (var i = 0; i < opts.length; i++) {
                var opt = el('option', { value: opts[i][0] }, opts[i][1]);
                if (s.sttProvider === opts[i][0]) opt.setAttribute('selected', 'selected');
                sel.appendChild(opt);
              }
              return sel;
            })(),
            el('label', {}, 'Groq API Key'),
            el('input', {
              type: 'password',
              value: s.sttApiKey,
              placeholder: 'gsk_xxxxx... (Chrome/Edge 用户可留空)',
              oninput: function (e) { s.sttApiKey = e.target.value; }
            }),
            el('div', { class: 'rvc-hint' }, 'Groq 免费额度: 每天 7000 次识别, 每分钟 25 次'),

            el('a', { href: 'https://platform.xiaomimimo.com/console/api-keys', target: '_blank', class: 'rvc-link' }, '去小米 MiMo 平台获取 API Key (限时免费)'),
            el('label', {}, '小米 MiMo API Key'),
            el('input', {
              type: 'password',
              value: s.mimoApiKey,
              placeholder: '选 MiMo 引擎时填写',
              oninput: function (e) { s.mimoApiKey = e.target.value; }
            }),
            el('div', { class: 'rvc-hint' }, '中文极好: 支持方言/嘈杂环境/歌词, OpenAI 兼容接口'),

            el('a', { href: 'https://console.bce.baidu.com/ai/#/ai/speech/overview/index', target: '_blank', class: 'rvc-link' }, '去百度智能云开通语音识别 (180天内15万次免费)'),
            el('label', {}, '百度 API Key'),
            el('input', {
              type: 'password',
              value: s.baiduApiKey,
              placeholder: '选百度引擎时填写',
              oninput: function (e) { s.baiduApiKey = e.target.value; }
            }),
            el('label', {}, '百度 Secret Key'),
            el('input', {
              type: 'password',
              value: s.baiduSecretKey,
              placeholder: '百度 Secret Key (浏览器端换取 token 会暴露此 Key, 仅自用)',
              oninput: function (e) { s.baiduSecretKey = e.target.value; }
            }),
            el('div', { class: 'rvc-hint' }, '领取后180天内15万次免费(短语音识别, ≤60s), 需在控制台「领取免费额度」+ 把应用关联到「短语音识别」'),

            el('a', { href: 'https://wit.ai/apps', target: '_blank', class: 'rvc-link' }, '去 Wit.ai 创建 App 获取 Token (免费, 英文最佳)'),
            el('label', {}, 'Wit.ai Server Access Token'),
            el('input', {
              type: 'password',
              value: s.witToken,
              placeholder: '选 Wit 引擎时填写 (英文练口语推荐)',
              oninput: function (e) { s.witToken = e.target.value; }
            }),
            el('div', { class: 'rvc-hint' }, 'Meta 旗下免费, 英文识别最佳, 中文不推荐'),

            // ─── 自托管 Whisper ASR Webservice ───
            el('label', {}, '自托管 Whisper ASR 服务地址'),
            el('input', {
              type: 'text',
              value: s.whisperUrl,
              placeholder: '例: http://your-server:9000 (留空则不使用)',
              oninput: function (e) { s.whisperUrl = e.target.value; }
            }),
            el('a', { href: 'https://github.com/ahmetoner/whisper-asr-webservice', target: '_blank', class: 'rvc-link' }, '部署文档: whisper-asr-webservice (Docker 一行命令)'),
            el('div', { class: 'rvc-hint' }, '用户自部署, 完全免费无限量, 质量最高。2核2G 服务器推荐 base 模型+faster-whisper+int8 量化'),

            // ─── Transformers.js 浏览器内 Whisper ───
            el('label', {}, 'Transformers.js Whisper 模型'),
            (function () {
              var sel = el('select', { onchange: function (e) { s.transformersModel = e.target.value; } });
              var models = [
                ['tiny', 'tiny (~75MB, 速度最快, 精度低)'],
                ['base', 'base (~150MB, 平衡推荐)'],
                ['small', 'small (~500MB, 精度好, 速度慢)'],
                ['medium', 'medium (~1.5GB, 精度高, 需好机器)']
              ];
              for (var i = 0; i < models.length; i++) {
                var opt = el('option', { value: models[i][0] }, models[i][1]);
                if (s.transformersModel === models[i][0]) opt.setAttribute('selected', 'selected');
                sel.appendChild(opt);
              }
              return sel;
            })(),
            el('div', { class: 'rvc-hint' }, '纯前端跑 Whisper, 完全免费无配额, 隐私好。需要 Chrome 113+/Edge 113+ (WebGPU), 首次加载模型 1-2 分钟'),

            // ─── 腾讯云一句话识别 ───
            el('a', { href: 'https://console.cloud.tencent.com/asr', target: '_blank', class: 'rvc-link' }, '去腾讯云开通语音识别 (每月10h永久免费)'),
            el('label', {}, '腾讯云 AppID'),
            el('input', {
              type: 'text',
              value: s.tencentAppId,
              placeholder: '腾讯云 AppID',
              oninput: function (e) { s.tencentAppId = e.target.value; }
            }),
            el('label', {}, '腾讯云 SecretId'),
            el('input', {
              type: 'password',
              value: s.tencentSecretId,
              placeholder: '腾讯云 API SecretId',
              oninput: function (e) { s.tencentSecretId = e.target.value; }
            }),
            el('label', {}, '腾讯云 SecretKey'),
            el('input', {
              type: 'password',
              value: s.tencentSecretKey,
              placeholder: '腾讯云 API SecretKey',
              oninput: function (e) { s.tencentSecretKey = e.target.value; }
            }),
            el('div', { class: 'rvc-hint' }, '每月 10h 永久免费额度, 中文识别好, 需实名认证'),

            // ─── Vosk 离线识别 (APK 专用) ───
            el('label', {}, 'Vosk 离线语音识别 (仅 APK 可用)'),
            el('div', { class: 'rvc-hint' }, 'APK 打包时集成 capacitor-offline-speech-recognition 插件后可用'),
            el('a', { href: 'https://github.com/gaudravi09/capacitor-offline-speech-recognition', target: '_blank', class: 'rvc-link' }, '插件文档: capacitor-offline-speech-recognition'),
            el('div', { class: 'rvc-hint' }, '特点: 完全离线、免费、流式实时识别(边说边出字)'),
            el('div', { class: 'rvc-hint' }, '需要先手动下载对应语言模型 ~50MB (从 alphacephei.com), 永久缓存'),
            el('div', { class: 'rvc-hint' }, '浏览器中选此项会提示不可用, 需在 APK 环境使用'),
            el('div', { class: 'rvc-hint' }, '推荐 APK 用户优先选此项: 永久免费、无需 Key、隐私好'),
            // ── Vosk 模型下载区 (手动) ──
            (function () {
              var voskStatusEl = el('div', { class: 'rvc-hint', style: { marginTop: '6px' } }, '检测中...');
              var downloadBtn = el('button', {
                class: 'rvc-btn',
                style: { marginTop: '6px' },
                onclick: async function () {
                  var v = detectVoskAvailable();
                  if (!v) {
                    voskStatusEl.textContent = 'Vosk 插件未安装 (当前不是 APK 环境)';
                    voskStatusEl.style.color = '#c20c0c';
                    return;
                  }
                  downloadBtn.disabled = true;
                  downloadBtn.textContent = '下载中...';
                  voskStatusEl.textContent = '开始下载...';
                  voskStatusEl.style.color = '';
                  try {
                    var progListener = await v.addListener('downloadProgress', function (p) {
                      if (!p) return;
                      var percent = (typeof p.progress === 'number') ? p.progress : 0;
                      var msg = p.message || '下载中...';
                      voskStatusEl.textContent = '下载中 ' + Math.floor(percent) + '% - ' + msg;
                    });
                    // 映射 STT 识别语言(lang) → Vosk 支持的语言代码
                    var voskLang = getVoskLang(s.lang);
                    var langLabel = getVoskLangLabel(s.lang);
                    var result = await v.downloadLanguageModel({ language: voskLang });
                    if (progListener) { try { await progListener.remove(); } catch (e) { /* ignore */ } }
                    if (result && result.success !== false) {
                      voskStatusEl.textContent = '✓ ' + langLabel + '(' + voskLang + ') 模型下载完成, 现在可以选择 Vosk 引擎使用了';
                      voskStatusEl.style.color = '#2ea043';
                      downloadBtn.textContent = '重新下载';
                    } else {
                      voskStatusEl.textContent = '下载失败: ' + (result && result.message || '未知错误');
                      voskStatusEl.style.color = '#c20c0c';
                      downloadBtn.textContent = '下载' + langLabel + '模型';
                    }
                  } catch (e) {
                    var em = String((e && e.message) || e || '');
                    voskStatusEl.textContent = '下载失败: ' + em;
                    voskStatusEl.style.color = '#c20c0c';
                    downloadBtn.textContent = '下载' + getVoskLangLabel(s.lang) + '模型';
                  } finally {
                    downloadBtn.disabled = false;
                  }
                }
              }, '下载' + getVoskLangLabel(s.lang) + '模型');

              // 启动时检测模型状态
              setTimeout(async function () {
                var v = detectVoskAvailable();
                if (!v) {
                  voskStatusEl.textContent = 'Vosk 插件未安装 (当前不是 APK 环境, 浏览器无法使用 Vosk)';
                  voskStatusEl.style.color = '#c20c0c';
                  downloadBtn.disabled = true;
                  return;
                }
                try {
                  var curVoskLang = getVoskLang(s.lang);
                  var curLabel = getVoskLangLabel(s.lang);
                  var langs = await v.getDownloadedLanguageModels();
                  // 兼容多种返回格式: {models:[...]} / [...] / {languages:[...]}
                  var models = [];
                  if (Array.isArray(langs)) models = langs;
                  else if (langs && langs.models) models = langs.models;
                  else if (langs && langs.languages) models = langs.languages;
                  var downloaded = models.map(function (m) {
                    return typeof m === 'string' ? m : (m.language || m.code || m.name || '');
                  });
                  var hasCur = downloaded.indexOf(curVoskLang) !== -1;
                  var allList = downloaded.length ? downloaded.join(', ') : '无';
                  if (hasCur) {
                    voskStatusEl.textContent = '✓ ' + curLabel + '(' + curVoskLang + ') 模型已下载 (已下载: ' + allList + ')';
                    voskStatusEl.style.color = '#2ea043';
                    downloadBtn.textContent = '重新下载';
                  } else {
                    voskStatusEl.textContent = curLabel + '(' + curVoskLang + ') 模型未下载 (已下载: ' + allList + '), 请点上方按钮下载';
                    voskStatusEl.style.color = '#c20c0c';
                  }
                } catch (e) {
                  voskStatusEl.textContent = '检测失败: ' + ((e && e.message) || e);
                  voskStatusEl.style.color = '#c20c0c';
                }
              }, 100);

              return el('div', { style: { marginTop: '8px', padding: '10px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' } }, [
                downloadBtn,
                voskStatusEl
              ]);
            })(),

            el('label', {}, '识别语言'),
            (function () {
              var sel = el('select', {
                onchange: function (e) { s.lang = e.target.value; }
              });
              var langs = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR'];
              for (var i = 0; i < langs.length; i++) {
                var opt = el('option', { value: langs[i] }, langs[i]);
                if (s.lang === langs[i]) opt.setAttribute('selected', 'selected');
                sel.appendChild(opt);
              }
              return sel;
            })(),
            el('label', {}, '句间停顿多久算一句结束 (秒)'),
            el('div', { class: 'rvc-slider-row' }, [
              el('input', {
                type: 'range',
                min: '500',
                max: '5000',
                step: '100',
                value: String(s.silenceMs),
                oninput: function (e) {
                  s.silenceMs = +e.target.value;
                  valMs.textContent = (s.silenceMs / 1000).toFixed(1) + 's';
                }
              }),
              (valMs = el('span', { class: 'rvc-slider-val' }, (s.silenceMs / 1000).toFixed(1) + 's'))
            ]),
            el('label', {}, '攒句后停顿多久整体发送给 char (秒)'),
            (function () {
              var v = el('span', { class: 'rvc-slider-val' }, (s.bufferFlushMs / 1000).toFixed(1) + 's');
              var inp = el('input', {
                type: 'range',
                min: '1000',
                max: '8000',
                step: '200',
                value: String(s.bufferFlushMs),
                oninput: function (e) {
                  s.bufferFlushMs = +e.target.value;
                  v.textContent = (s.bufferFlushMs / 1000).toFixed(1) + 's';
                }
              });
              return el('div', { class: 'rvc-slider-row' }, [inp, v]);
            })(),
            el('div', { class: 'rvc-hint' }, '可连续说多句, 每句换行显示; 停顿超过此值后整体打包发给 char'),
            el('label', {}, 'Groq Whisper 模型'),
            (function () {
              var sel = el('select', { onchange: function (e) { s.sttModel = e.target.value; } });
              var models = [
                ['whisper-large-v3', 'whisper-large-v3 (推荐, 精度高)'],
                ['whisper-large-v3-turbo', 'whisper-large-v3-turbo (快, 精度略低)'],
                ['distil-whisper-large-v3-en', 'distil-whisper-large-v3-en (英文专用, 最快)']
              ];
              for (var i = 0; i < models.length; i++) {
                var opt = el('option', { value: models[i][0] }, models[i][1]);
                if (s.sttModel === models[i][0]) opt.setAttribute('selected', 'selected');
                sel.appendChild(opt);
              }
              return sel;
            })(),
            el('div', { class: 'rvc-hint' }, '仅 Groq 引擎生效; Web Speech API 用浏览器内置模型')
          ]));

          // TTS 区
          body.appendChild(el('div', { class: 'rvc-section' }, [
            el('h3', {}, '语音合成 (TTS)'),
            el('label', {}, 'TTS 引擎'),
            (function () {
              var sel = el('select', { onchange: function (e) { s.ttsProvider = e.target.value; } });
              var opts = [
                ['roche', 'Roche 内置 (用 roche.voice.tts)'],
                ['minimax', 'MiniMax (需 API Key)'],
                ['elevenlabs', 'ElevenLabs (需 API Key)']
              ];
              for (var i = 0; i < opts.length; i++) {
                var opt = el('option', { value: opts[i][0] }, opts[i][1]);
                if (s.ttsProvider === opts[i][0]) opt.setAttribute('selected', 'selected');
                sel.appendChild(opt);
              }
              return sel;
            })(),
            el('label', {}, '默认 voiceId (角色未绑定时回退)'),
            el('input', {
              type: 'text',
              value: s.defaultVoiceId,
              placeholder: '填写 voiceId (Roche/MiniMax/ElevenLabs 通用)',
              oninput: function (e) { s.defaultVoiceId = e.target.value; }
            }),
            el('div', { class: 'rvc-hint' }, '插件会从角色字段 voiceId / voice / tts.voiceId 自动读取'),

            el('label', {}, 'MiniMax API Key'),
            el('input', {
              type: 'password',
              value: s.minimaxApiKey,
              placeholder: '仅在选用 MiniMax 时使用',
              oninput: function (e) { s.minimaxApiKey = e.target.value; }
            }),
            el('a', { href: 'https://www.minimaxi.com/platform', target: '_blank', class: 'rvc-link' }, '去 MiniMax 开放平台获取 Key'),
            el('label', {}, 'MiniMax 模型'),
            el('input', {
              type: 'text',
              value: s.minimaxModel,
              placeholder: 'speech-02-hd',
              oninput: function (e) { s.minimaxModel = e.target.value; }
            }),

            el('label', {}, 'ElevenLabs API Key'),
            el('input', {
              type: 'password',
              value: s.elevenlabsApiKey,
              placeholder: '仅在选用 ElevenLabs 时使用',
              oninput: function (e) { s.elevenlabsApiKey = e.target.value; }
            }),
            el('a', { href: 'https://elevenlabs.io/app/settings/api-keys', target: '_blank', class: 'rvc-link' }, '去 ElevenLabs 获取 Key'),
            el('label', {}, 'ElevenLabs 模型'),
            el('input', {
              type: 'text',
              value: s.elevenlabsModel,
              placeholder: 'eleven_multilingual_v2',
              oninput: function (e) { s.elevenlabsModel = e.target.value; }
            })
          ]));

          // 通话语言区
          body.appendChild(el('div', { class: 'rvc-section' }, [
            el('h3', {}, '通话语言'),
            el('label', {}, 'AI 回复使用的语言'),
            (function () {
              var sel = el('select', { onchange: function (e) { s.callLang = e.target.value; } });
              for (var k in LANG_LABELS) {
                var opt = el('option', { value: k }, LANG_LABELS[k]);
                if (s.callLang === k) opt.setAttribute('selected', 'selected');
                sel.appendChild(opt);
              }
              return sel;
            })(),
            el('label', {}, '外语回复附加中文翻译 (仅文字显示, 不 TTS)'),
            el('input', {
              type: 'checkbox',
              checked: !!(s.translateToChinese && s.callLang.indexOf('zh') !== 0),
              disabled: s.callLang.indexOf('zh') === 0,
              onchange: function (e) { s.translateToChinese = e.target.checked; },
              style: { width: '18px', height: '18px', verticalAlign: 'middle' }
            }),
            el('div', { class: 'rvc-hint' }, s.callLang.indexOf('zh') === 0 ? '当前为中文, 翻译选项不生效' : 'AI 回复末尾会附加 【中文翻译】 行')
          ]));

          // AI 对话区
          body.appendChild(el('div', { class: 'rvc-section' }, [
            el('h3', {}, 'AI 对话'),
            el('label', {}, '回复温度 (temperature)'),
            el('div', { class: 'rvc-slider-row' }, [
              el('input', {
                type: 'range',
                min: '0',
                max: '1.2',
                step: '0.1',
                value: String(s.temperature),
                oninput: function (e) {
                  s.temperature = +e.target.value;
                  valT.textContent = s.temperature.toFixed(1);
                }
              }),
              (valT = el('span', { class: 'rvc-slider-val' }, s.temperature.toFixed(1)))
            ]),
            el('label', {}, '自定义通话提示词 (留空用内置)'),
            (function () {
              var ta = el('textarea', {
                placeholder: '留空使用内置通话提示词, 支持: {{char}} {{user}} {{persona}} {{user_persona}} {{memory}}',
                oninput: function (e) { s.callPrompt = e.target.value; }
              });
              ta.value = s.callPrompt || '';
              return ta;
            })(),
            el('button', {
              class: 'rvc-btn',
              style: { marginTop: '8px', width: '100%', justifyContent: 'center' },
              onclick: async function () {
                var char = state.chars && state.chars[0];
                var config = char ? (state.charConfigs[char.id] || makeDefaultCharConfig()) : null;
                var memoryText = '';
                var note = '';
                if (char && config) {
                  try { memoryText = await loadMemoryForCall(char, config); } catch (e) { /* ignore */ }
                  note = '（用第一个角色「' + displayName(char) + '」替换占位符演示）';
                } else {
                  note = '（暂无角色，占位符未替换。实际通话时会用当前角色替换 {{char}} {{user}} {{persona}} {{memory}}）';
                }
                var sp = buildPrompt(char || { name: '示例角色', persona: '' }, memoryText, config);
                var callLang = s.callLang || 'zh-CN';
                var langName = LANG_LABELS[callLang] || callLang;
                sp += '\n\n【通话语言】（强制追加，不可省略）\n你必须用 ' + langName + ' 回复。无论用户用什么语言说话，你的回复必须用 ' + langName + '。';
                if (s.translateToChinese && callLang.indexOf('zh') !== 0) {
                  sp += '\n\n【中文翻译】（强制追加，仅在外语+开启翻译时）\n在回复末尾另起一行，用 【中文翻译】 开头给出中文译文。例如：\nHello, how are you?\n【中文翻译】你好，你怎么样？\n注意：翻译行仅用于显示，不要影响通话语气。';
                } else if (!(s.translateToChinese && callLang.indexOf('zh') !== 0)) {
                  sp += '\n\n【中文翻译】（当前未启用：需开启翻译且通话语言非中文才会追加）';
                }
                showPromptPreview(sp, note);
              }
            }, '查看实际注入的完整提示词'),
            el('div', { class: 'rvc-hint' }, '【格式规范说明】点上方按钮可查看「实际发给模型的完整 system prompt」= 提示词主体 + 强制追加的【通话语言】【中文翻译】。后两段是插件格式规范，即使用户自定义提示词也不会省略，确保通话语言/翻译解析功能正常。'),
            el('div', { class: 'rvc-hint', style: 'color:#C20C0C' }, '默认内置提示词很粗糙，建议根据角色人设自行定制提示词以获得最佳通话效果。'),
            el('div', { class: 'rvc-hint' }, '内置提示词支持 minimax 语气词标签: (laughs) (chuckle) (sighs) 等')
          ]));

          // 通话历史区
          body.appendChild(el('div', { class: 'rvc-section' }, [
            el('h3', {}, '通话历史'),
            el('label', {}, '携带本轮通话历史条数'),
            el('div', { class: 'rvc-slider-row' }, [
              el('input', {
                type: 'range',
                min: '0',
                max: '200',
                step: '5',
                value: String(s.historyLimit),
                oninput: function (e) {
                  s.historyLimit = +e.target.value;
                  valH.textContent = s.historyLimit;
                }
              }),
              (valH = el('span', { class: 'rvc-slider-val' }, String(s.historyLimit)))
            ]),
            el('div', { class: 'rvc-hint' }, '设为 0 则每条独立发送，不携带历史。最大 200 条（轮）')
          ]));

          // 通话模式 + 同步开关区
          body.appendChild(el('div', { class: 'rvc-section' }, [
            el('h3', {}, '通话模式'),
            el('label', {}, '通话方式'),
            (function () {
              var sel = el('select', { onchange: function (e) { s.callMode = e.target.value; } });
              var modes = [
                ['auto', '自动检测停顿 (连续说话, 停顿后发送)'],
                ['ptt', '按住说话 (按住按钮录音, 松开直接发送)']
              ];
              for (var i = 0; i < modes.length; i++) {
                var opt = el('option', { value: modes[i][0] }, modes[i][1]);
                if (s.callMode === modes[i][0]) opt.setAttribute('selected', 'selected');
                sel.appendChild(opt);
              }
              return sel;
            })(),
            el('div', { class: 'rvc-hint' }, 'auto: 适合连续对话, 可多说几句后停顿自动发送; ptt: 适合安静环境, 按住才录音避免误触发'),
            el('label', {}, '通话记录同步到聊天会话'),
            el('div', { class: 'rvc-toggle' }, [
              el('input', {
                type: 'checkbox',
                checked: !!s.syncToChat,
                onchange: function (e) { s.syncToChat = e.target.checked; }
              }),
              el('span', {}, '挂断后把通话消息注入到角色单聊会话')
            ]),
            el('div', { class: 'rvc-hint' }, '默认关闭。开启后挂断时会把通话中的 user/char 消息同步到 Roche 主聊天会话，char 在下次单聊时能记得通话内容')
          ]));

          // 音频预处理区（降噪/滤波）
          body.appendChild(el('div', { class: 'rvc-section' }, [
            el('h3', {}, '音频降噪'),
            el('label', {}, 'VAD 触发阈值 (越高越不容易被噪音触发)'),
            (function () {
              var v = el('span', { class: 'rvc-slider-val' }, s.vadThreshold.toFixed(3));
              var inp = el('input', {
                type: 'range',
                min: '0.005',
                max: '0.05',
                step: '0.001',
                value: String(s.vadThreshold),
                oninput: function (e) {
                  s.vadThreshold = +e.target.value;
                  v.textContent = s.vadThreshold.toFixed(3);
                }
              });
              return el('div', { class: 'rvc-slider-row' }, [inp, v]);
            })(),
            el('div', { class: 'rvc-hint' }, '推荐 0.020-0.030; 太低会被环境噪音误触发, 太高会听不到小声说话'),
            el('label', {}, '噪声门阈值 (低于此值视为静音)'),
            (function () {
              var v = el('span', { class: 'rvc-slider-val' }, s.noiseGateThreshold.toFixed(3));
              var inp = el('input', {
                type: 'range',
                min: '0.005',
                max: '0.04',
                step: '0.001',
                value: String(s.noiseGateThreshold),
                oninput: function (e) {
                  s.noiseGateThreshold = +e.target.value;
                  v.textContent = s.noiseGateThreshold.toFixed(3);
                }
              });
              return el('div', { class: 'rvc-slider-row' }, [inp, v]);
            })(),
            el('label', {}, '高通滤波频率 (滤除低频噪音, Hz)'),
            (function () {
              var v = el('span', { class: 'rvc-slider-val' }, String(s.highpassFreq) + 'Hz');
              var inp = el('input', {
                type: 'range',
                min: '40',
                max: '200',
                step: '5',
                value: String(s.highpassFreq),
                oninput: function (e) {
                  s.highpassFreq = +e.target.value;
                  v.textContent = s.highpassFreq + 'Hz';
                }
              });
              return el('div', { class: 'rvc-slider-row' }, [inp, v]);
            })(),
            el('div', { class: 'rvc-hint' }, '滤除低频电流声/风噪; 85Hz 适合人声, 过高会吃掉低频语音'),
            el('label', {}, '最短说话时长 (低于此值视为噪音丢弃, ms)'),
            (function () {
              var v = el('span', { class: 'rvc-slider-val' }, String(s.minSpeakMs) + 'ms');
              var inp = el('input', {
                type: 'range',
                min: '100',
                max: '800',
                step: '50',
                value: String(s.minSpeakMs),
                oninput: function (e) {
                  s.minSpeakMs = +e.target.value;
                  v.textContent = s.minSpeakMs + 'ms';
                }
              });
              return el('div', { class: 'rvc-slider-row' }, [inp, v]);
            })(),
            el('div', { class: 'rvc-hint' }, '过滤短脉冲噪音(碰撞声/键盘声); 300ms 适合正常语速')
          ]));

          // 保存按钮
          var saveBtn = el('button', {
            class: 'rvc-btn primary',
            style: { width: '100%', justifyContent: 'center', marginTop: '8px' },
            onclick: async function () {
              await saveSettings();
              if (roche.ui.toast) roche.ui.toast('设置已保存');
              renderList();
            }
          }, '保存并返回');
          body.appendChild(saveBtn);

          // 给 textarea 填值
          var ta = body.querySelector('textarea');
          if (ta) ta.value = s.callPrompt || '';

          root.appendChild(body);
        }

        // ============================================================
        // 初始化
        // ============================================================

        async function init() {
          root.replaceChildren();
          root.appendChild(el('div', { class: 'rvc-topbar' }, [
            el('div', { class: 'title' }, '语音通话')
          ]));
          root.appendChild(el('div', { class: 'rvc-body' }, [
            el('div', { class: 'rvc-empty' }, '加载中...')
          ]));

          try {
            await loadSettings();
            await loadCharConfigs();
            var results = await Promise.all([
              roche.character.list(),
              roche.persona.getActiveUserPersona(),
              roche.persona.getUserPersonas()
            ]);
            state.chars = results[0] || [];
            state.activeUser = results[1];
            state.userPersonas = results[2] || [];
            renderList();
            // 根据设置初始化悬浮球
            updateFloatBallVisibility();
          } catch (e) {
            root.replaceChildren();
            root.appendChild(el('div', { class: 'rvc-topbar' }, [
              el('div', { class: 'title' }, '语音通话')
            ]));
            root.appendChild(el('div', { class: 'rvc-body' }, [
              el('div', { class: 'rvc-empty' }, '初始化失败: ' + (e && e.message || e))
            ]));
          }
        }

        // ============================================================
        // 悬浮语音球 (任意页面 → 录音 → 转文字 → 注入输入框)
        // 使用 window._rvcFloat 全局态，确保插件面板关闭/重新打开后悬浮球仍保留
        // ============================================================

        if (!window._rvcFloat) {
          window._rvcFloat = {
            ball: null,
            tip: null,
            voskListener: null,
            webkitRec: null,
            textBuffer: '',
            recording: false
          };
        }
        var floatState = window._rvcFloat;
        // 便捷局部引用（读写均指向全局对象，保持持久化）
        var floatBall = floatState.ball;       // 悬浮球 DOM
        var floatTip = floatState.tip;         // 实时识别提示
        var floatVoskListener = floatState.voskListener;
        var floatWebkitRec = floatState.webkitRec;
        var floatTextBuffer = floatState.textBuffer;  // 累积识别文字
        var floatRecording = floatState.recording;

        // 保存回全局对象的辅助函数（局部变量变更后需调用）
        function syncFloatState() {
          floatState.ball = floatBall;
          floatState.tip = floatTip;
          floatState.voskListener = floatVoskListener;
          floatState.webkitRec = floatWebkitRec;
          floatState.textBuffer = floatTextBuffer;
          floatState.recording = floatRecording;
        }

        // 注入文字到聊天输入框
        // 判断元素是否可输入（input/textarea/contenteditable）
        function isEditableElement(el) {
          if (!el || el.disabled || el.readOnly) return false;
          var tag = el.tagName;
          if (tag === 'TEXTAREA') return true;
          if (tag === 'INPUT') {
            var t = (el.type || 'text').toLowerCase();
            // 仅文本类 input 可注入
            return t === 'text' || t === 'search' || t === '' || t === 'url' || t === 'tel';
          }
          if (el.isContentEditable) return true;
          return false;
        }

        // 判断元素是否可见（非 display:none / 非 visibility:hidden / 有尺寸）
        function isElementVisible(el) {
          if (!el) return false;
          try {
            var rs = window.getComputedStyle(el);
            if (rs.display === 'none' || rs.visibility === 'hidden') return false;
            var r = el.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) return false;
            return true;
          } catch (e) { return false; }
        }

        // 智能查找注入目标：优先当前聚焦元素，再按优先级扫所有可见可输入元素
        function findInjectTarget() {
          // 1. 当前聚焦元素（用户正在编辑的，包括通话界面的输入框）
          var ae = document.activeElement;
          if (ae && ae !== document.body && isEditableElement(ae) && isElementVisible(ae)) {
            return ae;
          }
          // 2. 按优先级扫描可见可输入元素
          var selectors = [
            '.chat-input-textarea',                    // 主聊天输入框
            'textarea:not([readonly]):not([disabled])', // 所有可见 textarea
            'input[type="text"]:not([readonly]):not([disabled])',
            'input[type="search"]:not([readonly]):not([disabled])',
            'input:not([type]):not([readonly]):not([disabled])', // 无 type 的 input 默认是 text
            '[contenteditable="true"]'                 // contenteditable
          ];
          for (var i = 0; i < selectors.length; i++) {
            var list = document.querySelectorAll(selectors[i]);
            for (var j = 0; j < list.length; j++) {
              if (isElementVisible(list[j]) && isEditableElement(list[j])) {
                return list[j];
              }
            }
          }
          return null;
        }

        // 模拟回车键（尝试触发发送）
        function simulateEnterKey(el) {
          if (!el) return;
          try {
            el.focus();
            var opts = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
            el.dispatchEvent(new KeyboardEvent('keydown', opts));
            el.dispatchEvent(new KeyboardEvent('keypress', opts));
            el.dispatchEvent(new KeyboardEvent('keyup', opts));
            // 部分框架监听 input 事件里的 Enter，再触发一次 input
            el.dispatchEvent(new Event('input', { bubbles: true }));
          } catch (e) { /* ignore */ }
        }

        function injectToChatInput(text) {
          if (!text) return;
          var target = findInjectTarget();
          if (!target) {
            addCallMessageSafe('未找到可输入框（当前页面无可见的 input/textarea/编辑区）');
            return false;
          }
          // 聚焦目标
          try { target.focus(); } catch (e) { /* ignore */ }

          if (target.isContentEditable) {
            // contenteditable：用 execCommand 插入文本（保留光标位置，触发框架感知）
            try {
              // 光标移到末尾
              var sel = window.getSelection();
              var range = document.createRange();
              range.selectNodeContents(target);
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
              // 插入文本
              var ok = document.execCommand('insertText', false, text);
              if (!ok) {
                // execCommand 被废弃时的兜底：直接 appendChild
                target.appendChild(document.createTextNode(text));
                target.dispatchEvent(new Event('input', { bubbles: true }));
              }
            } catch (e) {
              try { target.textContent = (target.textContent || '') + text; } catch (e2) { /* ignore */ }
              target.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } else {
            // input/textarea：用 native setter 触发 React/Vue 感知
            var orig = target.value || '';
            var sep = (orig && !orig.endsWith('\n') && !orig.endsWith(' ')) ? ' ' : '';
            var newVal = orig + sep + text;
            var proto = target.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            var setter = Object.getOwnPropertyDescriptor(proto, 'value');
            if (setter && setter.set) {
              setter.set.call(target, newVal);
            } else {
              target.value = newVal;
            }
            target.dispatchEvent(new Event('input', { bubbles: true }));
            try { target.setSelectionRange(newVal.length, newVal.length); } catch (e) { /* ignore */ }
          }

          // 注入后自动模拟回车发送（可设置开关）
          if (state.settings.floatAutoEnter) {
            // 延迟 50ms 确保框架处理完 input 事件后再发 Enter
            setTimeout(function () { simulateEnterKey(target); }, 50);
          }
          return true;
        }

        // 安全的 sys 消息 (悬浮球可能在非通话界面使用)
        function addCallMessageSafe(text) {
          try {
            if (typeof addCallMessage === 'function') addCallMessage({ role: 'sys', text: text });
            else console.log('[RVC] ' + text);
          } catch (e) { console.log('[RVC] ' + text); }
        }

        // 悬浮球 Vosk 识别结果处理
        function handleFloatVoskResult(result) {
          if (!result) return;
          var text = cleanVoskText(result.text, state.settings.lang);
          if (result.isFinal) {
            if (text) {
              floatTextBuffer = floatTextBuffer ? floatTextBuffer + text : text;
            }
            updateFloatTip(floatTextBuffer || '正在听...');
          } else {
            // partial: 实时显示
            updateFloatTip(floatTextBuffer + (floatTextBuffer && text ? ' ' : '') + text);
          }
        }

        // 更新悬浮球提示
        function updateFloatTip(text) {
          if (!floatTip || !text) return;
          floatTip.textContent = text;
          // 定位到悬浮球上方
          if (floatBall) {
            var rect = floatBall.getBoundingClientRect();
            floatTip.style.left = Math.max(8, rect.left - 100) + 'px';
            floatTip.style.top = (rect.top - 44) + 'px';
          }
        }

        // 启动悬浮球录音
        async function startFloatRecording() {
          if (floatRecording) return;
          floatRecording = true;
          floatTextBuffer = '';
          floatBall.classList.add('recording');
          floatBall.innerHTML = SVG.stop;
          // 显示提示
          if (!floatTip) {
            floatTip = el('div', { class: 'rvc-float-tip' }, '正在听...');
            document.body.appendChild(floatTip);
          }
          updateFloatTip('正在听...');

          // 优先用 Vosk (APK), 回退 webkitSpeechRecognition (浏览器)
          var vosk = detectVoskAvailable();
          if (vosk) {
            try {
              // 请求麦克风权限
              try { await ensureMicPermissionForVosk(); } catch (e) { /* ignore */ }
              var voskLang = getVoskLang(state.settings.lang);
              floatVoskListener = await vosk.addListener('recognitionResult', handleFloatVoskResult);
              await vosk.startRecognition({ language: voskLang });
              return;
            } catch (e) {
              var em = String((e && e.message) || e || '');
              if (/not.*download|model.*not|未下载|No such file/i.test(em)) {
                updateFloatTip('Vosk 模型未下载, 请到设置页下载');
                stopFloatRecording();
                return;
              }
              // 其他错误, 回退到 webkit
            }
          }
          // 回退: webkitSpeechRecognition
          var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (SR) {
            floatWebkitRec = new SR();
            floatWebkitRec.lang = state.settings.lang || 'zh-CN';
            floatWebkitRec.continuous = true;
            floatWebkitRec.interimResults = true;
            floatWebkitRec.onresult = function (event) {
              for (var i = event.resultIndex; i < event.results.length; i++) {
                var r = event.results[i];
                var t = cleanVoskText(r[0].transcript, state.settings.lang);
                if (r.isFinal) {
                  if (t) floatTextBuffer = floatTextBuffer ? floatTextBuffer + t : t;
                }
                updateFloatTip(floatTextBuffer + (floatTextBuffer && t ? ' ' : '') + t);
              }
            };
            floatWebkitRec.onerror = function (e) {
              updateFloatTip('识别错误: ' + (e.error || ''));
              stopFloatRecording();
            };
            floatWebkitRec.onend = function () {
              // 若非用户主动停止, 尝试重启 (continuous 模式)
              if (floatRecording) {
                try { floatWebkitRec.start(); } catch (e) { /* ignore */ }
              }
            };
            try { floatWebkitRec.start(); } catch (e) { /* ignore */ }
          } else {
            updateFloatTip('当前环境不支持语音识别 (需 APK+Vosk 或 Chrome 内核浏览器)');
            stopFloatRecording();
          }
          syncFloatState();
        }

        // 停止悬浮球录音 → 注入输入框
        async function stopFloatRecording() {
          if (!floatRecording) return;
          floatRecording = false;
          floatBall.classList.remove('recording');
          floatBall.innerHTML = SVG.mic;

          // 停止 Vosk
          var vosk = detectVoskAvailable();
          if (vosk) {
            try { await vosk.stopRecognition(); } catch (e) { /* ignore */ }
            if (floatVoskListener) { try { await floatVoskListener.remove(); } catch (e) { /* ignore */ } floatVoskListener = null; }
          }
          // 停止 webkit
          if (floatWebkitRec) {
            try { floatWebkitRec.onend = null; floatWebkitRec.stop(); } catch (e) { /* ignore */ }
            floatWebkitRec = null;
          }

          // 注入识别结果
          var finalText = (floatTextBuffer || '').trim();
          if (finalText) {
            injectToChatInput(finalText);
            updateFloatTip('已输入: ' + (finalText.length > 30 ? finalText.slice(0, 30) + '...' : finalText));
          } else {
            updateFloatTip('未识别到语音');
          }
          // 2 秒后隐藏提示
          setTimeout(function () {
            if (floatTip) { floatTip.remove(); floatTip = null; }
          }, 2000);
          floatTextBuffer = '';
          syncFloatState();
        }

        // 悬浮球点击切换
        function toggleFloatBall() {
          if (floatRecording) {
            stopFloatRecording();
          } else {
            startFloatRecording();
          }
          syncFloatState();
        }

        // 创建/显示悬浮球
        function showFloatBall() {
          if (floatBall) {
            // 球已存在（可能是上次 mount 创建的），确保可见
            floatBall.style.display = 'flex';
            syncFloatState();
            return;
          }
          floatBall = el('div', { class: 'rvc-float-ball' });
          floatBall.innerHTML = SVG.mic;
          syncFloatState();
          // 默认位置: 右下角
          var initX = window.innerWidth - 72;
          var initY = window.innerHeight - 160;
          floatBall.style.left = initX + 'px';
          floatBall.style.top = initY + 'px';
          document.body.appendChild(floatBall);

          // 拖拽 + 点击区分
          var dragging = false;
          var moved = false;
          var startX = 0, startY = 0, ballStartX = 0, ballStartY = 0;

          floatBall.addEventListener('pointerdown', function (e) {
            dragging = true;
            moved = false;
            startX = e.clientX;
            startY = e.clientY;
            ballStartX = parseFloat(floatBall.style.left) || 0;
            ballStartY = parseFloat(floatBall.style.top) || 0;
            floatBall.setPointerCapture(e.pointerId);
            e.preventDefault();
          });

          floatBall.addEventListener('pointermove', function (e) {
            if (!dragging) return;
            var dx = e.clientX - startX;
            var dy = e.clientY - startY;
            if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
            var nx = ballStartX + dx;
            var ny = ballStartY + dy;
            // 边界约束
            nx = Math.max(4, Math.min(window.innerWidth - 56, nx));
            ny = Math.max(4, Math.min(window.innerHeight - 56, ny));
            floatBall.style.left = nx + 'px';
            floatBall.style.top = ny + 'px';
          });

          floatBall.addEventListener('pointerup', function (e) {
            dragging = false;
            try { floatBall.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            // 未拖动则视为点击
            if (!moved) {
              toggleFloatBall();
            }
          });

          // 防止 pointerup 没触发
          floatBall.addEventListener('pointercancel', function () {
            dragging = false;
          });
        }

        // 隐藏悬浮球（只隐藏不删除 DOM，保留位置，便于下次快速显示）
        function hideFloatBall() {
          if (floatRecording) stopFloatRecording();
          if (floatBall) { floatBall.style.display = 'none'; }
          if (floatTip) { floatTip.style.display = 'none'; }
          syncFloatState();
        }

        // 彻底关闭悬浮球：停录音 + 移除 DOM + 移除独立样式 + 清全局态 + 关设置
        // 仅在插件面板打开时（设置页按钮）可调用，面板关闭后此函数随闭包一起销毁
        function forceShutdownFloatBall() {
          if (floatRecording) {
            try { stopFloatRecording(); } catch (e) { /* ignore */ }
          }
          if (floatBall) { try { floatBall.remove(); } catch (e) { /* ignore */ } floatBall = null; }
          if (floatTip) { try { floatTip.remove(); } catch (e) { /* ignore */ } floatTip = null; }
          var fStyle = document.getElementById('rvc-float-styles');
          if (fStyle) fStyle.remove();
          // 清全局态，下次 mount 时重新初始化
          if (window._rvcFloat) { window._rvcFloat = null; delete window._rvcFloat; }
          // 关闭设置并持久化
          state.settings.floatingBall = false;
          syncFloatState();
          try { saveSettings(); } catch (e) { /* ignore */ }
        }

        // 根据设置更新悬浮球显示状态
        function updateFloatBallVisibility() {
          if (state.settings.floatingBall) showFloatBall();
          else hideFloatBall();
        }

        // 设置变更时刷新悬浮球
        function onFloatBallSettingChange() {
          updateFloatBallVisibility();
        }

        // 注意：unmount 时不清理悬浮球（让插件面板关闭后悬浮球仍保留）
        // 悬浮球状态由 window._rvcFloat 全局管理，下次 mount 时复用

        root._rvcCleanup = function () {
          for (var i = 0; i < cleanups.length; i++) {
            try { cleanups[i](); } catch (e) { /* ignore */ }
          }
          stopListening();
          stopCallTimer();
          if (state.audio) { try { state.audio.pause(); } catch (e) { /* ignore */ } state.audio = null; }
          if (state.recognition) { try { state.recognition.stop(); } catch (e) { /* ignore */ } state.recognition = null; }
          var stt = state.stt;
          if (stt.micStream) { stt.micStream.getTracks().forEach(function (t) { t.stop(); }); stt.micStream = null; }
          if (stt.audioCtx) { try { stt.audioCtx.close(); } catch (e) { /* ignore */ } stt.audioCtx = null; }
          stt.analyser = null;
          stt.mediaRecorder = null;
        };

        init();
      },

      async unmount(container, roche) {
        // 调用 mount 里注册的清理函数（停通话录音/音频/识别，不含悬浮球）
        var root = container.querySelector('.rvc-root');
        if (root && typeof root._rvcCleanup === 'function') {
          try { root._rvcCleanup(); } catch (e) { /* ignore */ }
        }
        // 移除面板样式（#rvc-styles），但保留悬浮球独立样式（#rvc-float-styles）
        // 这样插件面板关闭后悬浮球仍有样式，可继续使用
        var styles = document.getElementById('rvc-styles');
        if (styles) styles.remove();
        // 只清面板容器，悬浮球 DOM 挂在 document.body 上不受影响
        // 悬浮球 DOM / 样式 / window._rvcFloat 全局态由设置页「彻底关闭悬浮球」按钮清理
        container.innerHTML = '';
      }
    }]
  };

  window.RochePlugin.register(plugin);
})();