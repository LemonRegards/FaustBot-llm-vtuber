(function(){
  const api = window.pluginUI;
  if (!api) return;

  const TIER_LABELS = { green: '绿色', yellow: '黄色', red: '红色' };
  const TIER_HINTS = { green: '本机元数据', yellow: '文本与联网', red: '屏幕内容' };
  const ATTENTION_LABELS = { focused: '心流', fragmented: '碎片', chaotic: '狂乱', neutral: '一般' };
  const LEVEL_LABELS = { idle: '离开', calm: '平静', active: '活跃', intense: '激烈' };
  const KIND_LABELS = { motion: '动作', speech: '说话', nimble: '便签', 'event-trigger': '事件', emotion: '表情', attach: '即时附加（不打扰）' };

  async function communicate(payload){
    return api.communicate('desktop-mood', payload || {});
  }

  async function fetchJson(path, options){
    const res = await fetch(api.backendBaseUrl + path, options || {});
    return res.json();
  }

  function esc(value){
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function agoText(ts){
    if (!ts) return '尚未采集';
    const delta = Math.max(0, Math.floor(Date.now() / 1000) - Number(ts));
    if (delta < 60) return delta + ' 秒前采集';
    if (delta < 3600) return Math.floor(delta / 60) + ' 分钟前采集';
    return Math.floor(delta / 3600) + ' 小时前采集';
  }

  function durationText(seconds){
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    if (total < 60) return total + ' 秒';
    if (total < 3600) return Math.floor(total / 60) + ' 分钟';
    return Math.floor(total / 3600) + ' 小时 ' + Math.floor((total % 3600) / 60) + ' 分钟';
  }

  function tierBadge(tier, short){
    const label = short ? (TIER_LABELS[tier] || tier) : ((TIER_LABELS[tier] || tier) + (TIER_HINTS[tier] ? ' · ' + TIER_HINTS[tier] : ''));
    return '<span class="desktop-tier-badge desktop-tier-' + esc(tier) + '">' + esc(label) + '</span>';
  }

  function kindLabel(kind){
    if (!kind) return '-';
    return KIND_LABELS[kind] || kind;
  }

  function pad2(value){
    return (value < 10 ? '0' : '') + value;
  }

  function renderTierGroups(perception){
    const tiers = perception.tiers || [];
    const sources = perception.sources || [];
    return tiers.map(function(tier){
      const sourcesOfTier = sources.filter(function(source){ return source.tier === tier.id; });
      const sourceRows = sourcesOfTier.map(function(source){
        const disabled = tier.enabled ? '' : ' disabled';
        return '<label class="desktop-source-row' + (tier.enabled ? '' : ' is-muted') + '">'
          + '<input type="checkbox" data-source-toggle="' + esc(source.id) + '"' + (source.enabled ? ' checked' : '') + disabled + ' />'
          + '<span class="desktop-source-name">' + esc(source.label) + '</span>'
          + '<span class="card-help">' + esc(source.note) + '（每 ' + String(source.cadence || 10) + 's）</span>'
          + '</label>';
      }).join('') || '<p class="card-help">该分级下暂无感知源</p>';
      return '<div class="desktop-tier-group" data-tier="' + esc(tier.id) + '">'
        + '<label class="desktop-tier-head">'
        + '<input type="checkbox" data-tier-toggle="' + esc(tier.id) + '"' + (tier.enabled ? ' checked' : '') + ' />'
        + tierBadge(tier.id)
        + '</label>'
        + '<p class="card-help">' + esc(tier.note) + '</p>'
        + '<div class="desktop-source-list">' + sourceRows + '</div>'
        + '</div>';
    }).join('');
  }

  function renderCollectionTable(perception){
    const sources = perception.sources || [];
    if (!sources.length) return '<tr><td colspan="5">暂无感知源</td></tr>';
    return sources.map(function(source){
      const status = source.collecting
        ? '<span class="desktop-status desktop-status-on">采集中</span>'
        : (source.enabled
          ? '<span class="desktop-status desktop-status-off">分级已关</span>'
          : '<span class="desktop-status desktop-status-off">已关闭</span>');
      const note = source.status ? '<div class="desktop-field-row"><span class="desktop-field-label">不可用</span><span class="desktop-field-value">' + esc(source.status) + '</span></div>' : '';
      const values = (source.fields || []).map(function(field){
        const text = field.value == null ? '<span class="desktop-value-missing">未采集</span>' : esc(field.value);
        return '<div class="desktop-field-row"><span class="desktop-field-label">' + esc(field.label) + '</span><span class="desktop-field-value">' + text + '</span></div>';
      }).join('') || '<span class="desktop-value-missing">未采集</span>';
      return '<tr>'
        + '<td>' + esc(source.label) + '</td>'
        + '<td>' + tierBadge(source.tier, true) + '</td>'
        + '<td>' + status + '</td>'
        + '<td>' + String(source.cadence || 10) + 's</td>'
        + '<td>' + values + note + '</td>'
        + '</tr>';
    }).join('');
  }

  function renderTimeline(perception){
    const events = perception.recent_events || [];
    const rows = events.slice(-12).reverse().map(function(event){
      const at = new Date(Number(event.at || 0) * 1000);
      const time = isNaN(at.getTime()) ? '--:--' : at.toTimeString().slice(0, 5);
      return '<li><span class="desktop-field-label">' + esc(time) + '</span>' + esc(event.text) + '</li>';
    }).join('');
    const digest = perception.away_digest;
    let awayText = '用户没有离开过（或还没回来）';
    if (digest && digest.items && digest.items.length){
      awayText = '离开 ' + durationText(digest.away_seconds) + '：' + digest.items.map(esc).join('；');
    } else if (digest){
      awayText = '离开 ' + durationText(digest.away_seconds) + '，期间没有特别事件';
    }
    return '<p class="desktop-narrative">' + esc(perception.narrative || '暂无场景摘要') + '</p>'
      + '<p class="card-help">离开期间：' + awayText + '</p>'
      + '<ul class="desktop-event-list">' + (rows || '<li class="desktop-value-missing">暂无事件</li>') + '</ul>';
  }

  function renderRhythm(perception){
    const today = perception.rhythm_today || {};
    const cards = [
      ['清醒', (today.awake_minutes || 0) + ' 分钟', (today.awake_first ? today.awake_first + '~' + (today.awake_last || '') : '')],
      ['专注', (today.focus_minutes || 0) + ' 分钟', ATTENTION_LABELS[perception.attention] || ''],
      ['游戏', (today.game_minutes || 0) + ' 分钟', ''],
      ['离开', (today.leaves || 0) + ' 次', '切换 ' + (today.switches || 0) + ' 次'],
      ['活动强度', LEVEL_LABELS[perception.activity_level] || '未知', ''],
    ];
    return cards.map(function(card){
      return '<div class="desktop-metric"><span class="desktop-metric-label">' + esc(card[0]) + '</span>'
        + '<span class="desktop-metric-value">' + esc(card[1]) + '</span>'
        + '<span class="card-help">' + esc(card[2]) + '</span></div>';
    }).join('');
  }

  function renderDisturb(perception){
    const reasons = perception.disturb_reasons || [];
    return '<p class="card-help">免打扰状态：'
      + (perception.disturbed ? '<span class="desktop-status desktop-status-off">不建议打扰</span> ' + esc(reasons.join('、')) : '<span class="desktop-status desktop-status-on">可以打扰</span>')
      + '</p>';
  }

  function renderRules(items){
    const rows = items.map(function(item){
      return '<tr>'
        + '<td><input type="checkbox" data-rule-id="' + esc(item.id) + '" ' + (item.enabled ? 'checked' : '') + ' /></td>'
        + '<td>' + esc(item.label || item.id) + '<div class="card-help">' + esc(item.summary || '') + '</div></td>'
        + '<td>' + esc(kindLabel(item.kind)) + '</td>'
        + '<td>' + Math.round(Number(item.cooldown_sec || 0) / 60) + ' 分</td>'
        + '</tr>';
    }).join('') || '<tr><td colspan="4">暂无规则</td></tr>';
    return '<table class="simple-table"><thead><tr><th>启用</th><th>规则</th><th>类型</th><th>冷却</th></tr></thead><tbody>'
      + rows + '</tbody></table>'
      + '<p class="card-help">引擎不会自动调整冷却：觉得某条太吵就关掉它、调高它的 cooldown_sec。'
      + '类型为「即时附加」的规则命中时不会说话、不弹窗、不打断：文本先入队，随后随你的下一条消息或前台触发器送达（后台触发器不附加），整段最多 100 字。'
      + '改完按右上角「保存」提交。</p>';
  }

  function renderAttach(attach){
    const data = (attach && typeof attach === 'object') ? attach : null;
    const unknown = '<span class="desktop-value-missing">未知</span>';
    function metric(label, value){
      return '<div class="desktop-metric"><span class="desktop-metric-label">' + esc(label) + '</span>'
        + '<span class="desktop-metric-value">' + value + '</span></div>';
    }
    function flag(value, onText, offText){
      if (data === null || value == null) return unknown;
      return value
        ? '<span class="desktop-status desktop-status-on">' + esc(onText) + '</span>'
        : '<span class="desktop-status desktop-status-off">' + esc(offText) + '</span>';
    }
    function countText(value, unit){
      if (data === null || value == null || isNaN(Number(value))) return unknown;
      return esc(String(Math.max(0, Math.round(Number(value))))) + ' ' + esc(unit);
    }
    function clockText(ts){
      if (data === null) return unknown;
      const seconds = Number(ts);
      if (!seconds || isNaN(seconds)) return '<span class="desktop-value-missing">尚未附加</span>';
      const at = new Date(seconds * 1000);
      if (isNaN(at.getTime())) return unknown;
      return esc(pad2(at.getHours()) + ':' + pad2(at.getMinutes()));
    }
    const lastText = data === null
      ? unknown
      : (data.last_text ? esc(String(data.last_text)) : '<span class="desktop-value-missing">尚未附加过内容</span>');
    const errorLine = (data && data.last_error)
      ? '<p class="card-help desktop-attach-error"><span class="desktop-status desktop-status-off">附加异常</span> ' + esc(data.last_error) + '</p>'
      : '';
    return '<div class="desktop-metric-row">'
      + metric('总开关', flag(data ? data.enabled : null, '已启用', '已关闭'))
      + metric('启发式自动附加', flag(data ? data.auto : null, '已开启', '已关闭'))
      + metric('附加预算', countText(data ? data.budget : null, '字'))
      + metric('排队等待', countText(data ? data.queued : null, '条'))
      + metric('累计附加', countText(data ? data.sent_total : null, '次'))
      + metric('上次附加', clockText(data ? data.last_at : null))
      + '</div>'
      + '<p class="desktop-field-row"><span class="desktop-field-label">上次内容</span><span class="desktop-field-value">' + lastText + '</span></p>'
      + errorLine;
  }

  // 当前活动实例：页面重渲染后旧实例的定时器与在途请求靠它自杀
  let RENDER_TOKEN = 0;

  function render(container){
    // 容器是复用的：切走页面时宿主只清空 innerHTML（div 仍挂在文档里），再次
    // 进入又会调用一次 render()。每次渲染递增 token，旧实例的 5s 定时器据此
    // 自停——否则旧闭包会继续按服务端状态重画面板，把用户还没点「保存」的勾选
    // 覆盖掉（表现为页面"不断重载"）。
    const token = ++RENDER_TOKEN;
    function isAlive(){
      return token === RENDER_TOKEN
        && container.isConnected
        && container.childElementCount > 0
        && container.style.display !== 'none';
    }
    // 所有查询都限定在本页容器内：旧实例即使残留，也只可能写进自己的空容器
    function $(selector){ return container.querySelector(selector); }

    container.innerHTML = ''
      + '<article class="card full-span"><h3 class="card-title">感知引擎 · 桌宠能看什么</h3>'
      + '<p class="card-help">三级隐私开关决定允许采集的范围；每个感知源还能单独关闭。被关闭的源不会写进 faustbot://desktop-mood/（总览见 overview.md），依赖它的规则不会触发。修改后按右上角「保存」，下一个心跳周期（≤10 秒）生效。</p>'
      + '<div id="desktop-tier-list" class="desktop-tier-list">加载中...</div>'
      + '</article>'
      + '<article class="card full-span"><h3 class="card-title">场景与时间线</h3><div id="desktop-narrative-box">加载中...</div></article>'
      + '<article class="card full-span"><h3 class="card-title">今日节律</h3><div id="desktop-rhythm-box" class="desktop-metric-row">加载中...</div></article>'
      + '<article class="card full-span"><h3 class="card-title">数据采集</h3>'
      + '<div class="toolbar"><span id="desktop-perception-stamp" class="card-help">尚未采集</span>'
      + '<button id="desktop-perception-refresh" class="btn btn-secondary">立即采集</button></div>'
      + '<table class="simple-table"><thead><tr><th>来源</th><th>分级</th><th>状态</th><th>间隔</th><th>采集到的数据</th></tr></thead>'
      + '<tbody id="desktop-perception-rows"></tbody></table>'
      + '</article>'
      + '<article class="card full-span"><h3 class="card-title">免打扰</h3><div id="desktop-disturb-box">加载中...</div></article>'
      + '<article class="card full-span"><h3 class="card-title">规则</h3><div id="desktop-rules-box">加载中...</div></article>'
      + '<article class="card full-span"><h3 class="card-title">即时附加</h3><div id="desktop-attach-box">加载中...</div>'
      + '<p class="card-help">附加随你的下一条消息或前台触发器出现，后台触发器不附加；只放相对上次附加发生变化的内容，整段硬上限 100 字、最多 6 行，且不受免打扰闸门拦截。'
      + '补充内容就在「规则」卡片里加一条 kind 为 attach 的规则。</p></article>'
      + '<article class="card full-span"><h3 class="card-title">其他配置</h3>'
      + '<div class="toolbar"><label>当前情绪 <select id="desktop-mood-select"><option value="auto">自动</option><option value="rainy">雨天</option><option value="warm">温暖</option><option value="dark">低沉</option></select></label>'
      + '<label>全局冷却 <input id="desktop-global-cooldown" type="number" min="0" style="width:80px" /></label>'
      + '<label>天气城市 <input id="desktop-weather-city" type="text" style="width:100px" /></label>'
      + '<label>编码监视目录 <input id="desktop-code-dir" type="text" style="width:220px" placeholder="D:\\some\\git\\repo" /></label>'
      + '</div>'
      + '<p class="card-help">规则开关、当前情绪与这里的配置都在右上角「保存」时一并提交。规则文件位于 ~/.faustbot/desktop-mood.rules.json（由 faustbot://plugins/desktop-mood/reload 提交写入）。</p></article>';

    let latest = { perception: null, state: {}, config: {} };
    let tierDirty = false;
    let rulesDirty = false;
    let moodDirty = false;
    let otherDirty = false;

    // 面板草稿交给配置中心右上角的「保存」：本页不再有独立保存按钮
    const persist = api.registerPersistence({
      plugin: 'desktop-mood',
      module: 'desktop-mood',
      save: async function(){
        // 规则开关与当前情绪是插件自己的状态文件，感知分级与其它配置走插件 config
        if (rulesDirty) {
          const res = await communicate({ action: 'set_rules', items: collectRules() });
          if (!res || res.status !== 'ok') throw new Error('保存规则失败：' + ((res && res.detail) || '未知错误'));
          rulesDirty = false;
        }
        if (moodDirty) {
          const select = $('#desktop-mood-select');
          const res = await communicate({ action: 'set_mood', mood: (select && select.value) || 'auto' });
          if (!res || res.status !== 'ok') throw new Error('保存情绪失败：' + ((res && res.detail) || '未知错误'));
          moodDirty = false;
        }
        if (tierDirty || otherDirty) {
          const res = await saveConfig(collectPerceptionValues());
          if (!res || res.status !== 'ok') throw new Error('保存感知设置失败：' + ((res && res.detail) || '未知错误'));
          tierDirty = false;
          otherDirty = false;
        }
        syncDirty();
      }
    });

    function syncDirty(){
      persist.setDirty(tierDirty || rulesDirty || moodDirty || otherDirty);
    }

    function collectRules(){
      return (latest.rules || []).map(function(item){
        const box = container.querySelector('input[data-rule-id="' + item.id + '"]');
        const next = Object.assign({}, item, { enabled: !!(box && box.checked) });
        delete next.summary;
        return next;
      });
    }

    function isMoodDirty(){
      const select = $('#desktop-mood-select');
      if (!select) return false;
      return String(select.value) !== String((latest.state || {}).manual_mood || 'auto');
    }

    function isOtherDirty(){
      const cfg = latest.config || {};
      const cooldown = ($('#desktop-global-cooldown') || {}).value;
      const city = ($('#desktop-weather-city') || {}).value;
      const codeDir = ($('#desktop-code-dir') || {}).value;
      return String(cooldown) !== String(cfg.GLOBAL_COOLDOWN_SEC != null ? cfg.GLOBAL_COOLDOWN_SEC : 180)
        || String(city) !== String(cfg.WEATHER_CITY != null ? cfg.WEATHER_CITY : 'auto')
        || String(codeDir) !== String(cfg.CODE_WATCH_DIR || '');
    }

    const moodSelect = $('#desktop-mood-select');
    if (moodSelect) {
      moodSelect.addEventListener('change', function(){
        moodDirty = isMoodDirty();
        syncDirty();
      });
    }
    ['desktop-global-cooldown', 'desktop-weather-city', 'desktop-code-dir'].forEach(function(id){
      const node = $('#' + id);
      if (node) node.addEventListener('input', function(){
        otherDirty = isOtherDirty();
        syncDirty();
      });
    });

    function bindPerceptionPanel(perception){
      const tierList = $('#desktop-tier-list');
      if (tierList) tierList.innerHTML = renderTierGroups(perception);
      Array.prototype.forEach.call(container.querySelectorAll('input[data-tier-toggle]'), function(toggle){
        toggle.onchange = function(){
          const group = toggle.closest('.desktop-tier-group');
          const sourceToggles = group ? group.querySelectorAll('input[data-source-toggle]') : [];
          Array.prototype.forEach.call(sourceToggles, function(item){ item.disabled = !toggle.checked; });
          if (group) group.classList.toggle('is-muted', !toggle.checked);
          tierDirty = true;
          syncDirty();
        };
      });
      Array.prototype.forEach.call(container.querySelectorAll('input[data-source-toggle]'), function(toggle){
        toggle.onchange = function(){ tierDirty = true; syncDirty(); };
      });
    }

    function bindRulesPanel(){
      Array.prototype.forEach.call(container.querySelectorAll('input[data-rule-id]'), function(toggle){
        toggle.onchange = function(){ rulesDirty = true; syncDirty(); };
      });
    }

    async function refresh(){
      if (!isAlive()) return;
      const results = await Promise.all([
        communicate({ action: 'get_perception' }),
        communicate({ action: 'get_state' }),
        fetchJson('/faust/admin/plugins/desktop-mood/config'),
        communicate({ action: 'get_rules' })
      ]);
      // 在途请求回来时页面可能已被切走或重渲染：旧实例不得再写 DOM
      if (!isAlive()) return;
      const perception = results[0].perception || {};
      const state = results[1].state || {};
      const configValues = (((results[2] || {}).config || {}).values) || {};
      const rules = results[3].items || [];
      latest = { perception: perception, state: state, config: configValues, rules: rules };

      if (!tierDirty) bindPerceptionPanel(perception);
      const rows = $('#desktop-perception-rows');
      if (rows) rows.innerHTML = renderCollectionTable(perception);
      const stamp = $('#desktop-perception-stamp');
      if (stamp) stamp.textContent = agoText(perception.updated_at);
      const narrative = $('#desktop-narrative-box');
      if (narrative) narrative.innerHTML = renderTimeline(perception);
      const rhythm = $('#desktop-rhythm-box');
      if (rhythm) rhythm.innerHTML = renderRhythm(perception);
      const disturb = $('#desktop-disturb-box');
      if (disturb) disturb.innerHTML = renderDisturb(perception);
      const rulesBox = $('#desktop-rules-box');
      if (rulesBox && !rulesDirty) {
        rulesBox.innerHTML = renderRules(rules);
        bindRulesPanel();
      }
      const attachBox = $('#desktop-attach-box');
      if (attachBox) attachBox.innerHTML = renderAttach(perception.attach);

      // 有草稿的字段不被刷新覆盖（否则 5 秒一次的心跳刷新会吃掉用户改动）
      const select = $('#desktop-mood-select');
      if (select && !moodDirty) select.value = state.manual_mood || 'auto';
      const globalCooldown = $('#desktop-global-cooldown');
      if (globalCooldown && !otherDirty) globalCooldown.value = String(configValues.GLOBAL_COOLDOWN_SEC != null ? configValues.GLOBAL_COOLDOWN_SEC : 180);
      const weatherCity = $('#desktop-weather-city');
      if (weatherCity && !otherDirty) weatherCity.value = String(configValues.WEATHER_CITY != null ? configValues.WEATHER_CITY : 'auto');
      const codeDir = $('#desktop-code-dir');
      if (codeDir && !otherDirty) codeDir.value = String(configValues.CODE_WATCH_DIR || '');

      const refreshPerception = $('#desktop-perception-refresh');
      if (refreshPerception) refreshPerception.onclick = async function(){
        await fetchJson('/faust/admin/plugins/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        refresh();
      };
    }

    function collectPerceptionValues(){
      const values = {
        GLOBAL_COOLDOWN_SEC: Number(($('#desktop-global-cooldown') || {}).value || 180),
        WEATHER_CITY: ($('#desktop-weather-city') || {}).value || 'auto',
        CODE_WATCH_DIR: ($('#desktop-code-dir') || {}).value || ''
      };
      Array.prototype.forEach.call(container.querySelectorAll('input[data-tier-toggle]'), function(toggle){
        values['ENABLE_TIER_' + toggle.getAttribute('data-tier-toggle').toUpperCase()] = !!toggle.checked;
      });
      Array.prototype.forEach.call(container.querySelectorAll('input[data-source-toggle]'), function(toggle){
        const id = toggle.getAttribute('data-source-toggle');
        const source = ((latest.perception || {}).sources || []).filter(function(item){ return item.id === id; })[0];
        if (source && source.key) values[source.key] = !!toggle.checked;
      });
      return values;
    }

    async function saveConfig(values){
      // apply_runtime=false：感知开关只改采集范围，没必要重建 agent 运行时（也不会重置对话）
      return fetchJson('/faust/admin/plugins/desktop-mood/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: values, apply_runtime: false, no_initial_chat: true, reset_dialog: false })
      });
    }

    refresh().catch(function(){
      if (!isAlive()) return;
      container.innerHTML = '<article class="card full-span"><h3 class="card-title">感知引擎</h3><p class="card-help">桌面插件状态读取失败</p></article>';
    });
    const timer = setInterval(function(){
      if (!isAlive()) { clearInterval(timer); return; }
      refresh().catch(function(){});
    }, 5000);
  }

  api.addPage({ id: 'desktop-mood', label: '感知引擎', desc: '感知分级、场景时间线与规则管理（数据按域暴露在 faustbot://desktop-mood/）', plugin: 'desktop-mood', render: render });
  api.addCard('plugins', {
    title: '感知引擎',
    priority: 17,
    plugin: 'desktop-mood',
    render: function(container){
      communicate({ action: 'get_perception' }).then(function(data){
        const perception = data.perception || {};
        const tiers = perception.tiers || [];
        const sources = perception.sources || [];
        const tierText = tiers.map(function(tier){ return TIER_LABELS[tier.id] + (tier.enabled ? '开' : '关'); }).join(' / ');
        const live = sources.filter(function(source){ return source.collecting; });
        container.innerHTML = '<div class="plugin-mini-card">'
          + '<p>' + esc(perception.narrative || '暂无场景摘要') + '</p>'
          + '<p class="plugin-mini-muted">感知分级 ' + esc(tierText || '未知') + '，采集中 ' + live.length + '/' + sources.length + ' 个来源'
          + '，' + esc(agoText(perception.updated_at))
          + (perception.disturbed ? '，免打扰中' : '') + '</p></div>';
      }).catch(function(){ container.innerHTML = '<div class="plugin-mini-card">桌面状态不可用</div>'; });
    }
  });
})();
