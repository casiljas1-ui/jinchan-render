(() => {
  const api = location.origin;
  const selections = {
    scene: '聚餐脱身',
    caller: '妈妈',
    voiceName: '温柔女声',
    voiceId: 'female-shaonv'
  };
  const voiceProfiles = {
    '温柔女声': {voiceId: 'female-shaonv', speed: .96, pitch: 0, emotion: 'calm', pauseSec: .44},
    '沉稳男声': {voiceId: 'male-qn-qingse', speed: .94, pitch: -1, emotion: 'calm', pauseSec: .48},
    '温和长辈男声': {voiceId: 'male-qn-qingse', speed: .84, pitch: -3, emotion: 'calm', pauseSec: .62},
    '活力青年': {voiceId: 'female-tianmei', speed: 1.06, pitch: 1, emotion: 'happy', pauseSec: .34}
  };
  let lastCopy = '孩子，家里临时有点事情，你方便现在回来吗？';
  let activeAudio = null;
  let activePlayButton = null;
  let activeOriginalAudio = null;
  let activeOriginalButton = null;
  let clonedVoices = [];
  let excuseHistory = [];
  let voiceWorkshopCopy = lastCopy;
  let voiceWorkshopHistoryId = null;
  let voiceWorkshopVoiceName = '温柔女声';
  let cloneStep = 1;
  let cloneStream = null;
  let cloneRecorder = null;
  let cloneChunks = [];
  let cloneRecording = null;
  let cloneUploadedFile = null;
  let cloneStartedAt = 0;
  let cloneTimer = null;
  let cloneLevelFrame = null;
  let cloneQuality = null;
  let cloneVoiceName = '我的声音';
  let lastVoiceFileId = null;
  let savedPlanId = null;
  let lastLocalAudioId = null;
  let planLibraryAudio = null;
  let planLibraryCard = null;
  let customScenes = [];
  let customCallers = [];
  let callFlowCopyConfirmed = false;
  let callFlowSetupConfirmed = false;
  let callFlowVoiceConfirmed = false;
  let callFlowVoiceGenerated = false;
  let callFlowActiveStep = 1;
  const LOCAL_DB_NAME = 'jinchan-local-library-v1';
  const LOCAL_DB_VERSION = 1;
  const MAX_LOCAL_VOICES = 10;
  const MAX_LOCAL_AUDIO_PER_VOICE = 10;
  let localAudioObjectUrls = [];

  function replaceDollAssets() {
    const replacement = 'jinchan-doll-final.png';
    document.querySelectorAll('img.doll, img[src*="jincan_doll"], img[src*="jinchan-doll"]').forEach((image) => {
      image.src = replacement;
    });
    try {
      window.parent.document.querySelectorAll('img.splash-doll, img[src*="jincan_doll"], img[src*="jinchan-doll"]').forEach((image) => {
        image.src = replacement;
      });
    } catch (_) {}
  }

  replaceDollAssets();

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    try {
      const deepseekKey = localStorage.getItem('jinchan-deepseek-api-key') || '';
      const minimaxKey = localStorage.getItem('jinchan-minimax-api-key') || '';
      if (deepseekKey) headers.set('X-DeepSeek-API-Key', deepseekKey);
      if (minimaxKey) headers.set('X-MiniMax-API-Key', minimaxKey);
    } catch (_) {}
    options.headers = headers;
    const response = await fetch(`${api}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || data.error?.message || `请求失败（${response.status}）`);
    return data;
  }

  function userApiHeaders() {
    const headers = {};
    try {
      const deepseekKey = localStorage.getItem('jinchan-deepseek-api-key') || '';
      const minimaxKey = localStorage.getItem('jinchan-minimax-api-key') || '';
      if (deepseekKey) headers['X-DeepSeek-API-Key'] = deepseekKey;
      if (minimaxKey) headers['X-MiniMax-API-Key'] = minimaxKey;
    } catch (_) {}
    return headers;
  }

  function openLocalLibrary() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('当前浏览器不支持本机存储'));
      const request = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('voices')) db.createObjectStore('voices', {keyPath: 'id'});
        if (!db.objectStoreNames.contains('phoneAudio')) {
          const store = db.createObjectStore('phoneAudio', {keyPath: 'id'});
          store.createIndex('voiceName', 'voiceName', {unique: false});
          store.createIndex('createdAt', 'createdAt', {unique: false});
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开本机存储'));
    });
  }

  async function localTransaction(storeName, mode, action) {
    const db = await openLocalLibrary();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result;
      try { result = action(store); } catch (error) { db.close(); reject(error); return; }
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onerror = () => { db.close(); reject(transaction.error || new Error('本机存储操作失败')); };
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error('本机存储操作被取消')); };
    });
  }

  async function readLocalStore(storeName) {
    const db = await openLocalLibrary();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('无法读取本机数据'));
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => { db.close(); reject(transaction.error || new Error('无法读取本机数据')); };
    });
  }

  async function localVoiceCount() {
    return (await readLocalStore('voices')).length;
  }

  async function localAudioCount(voiceName) {
    const items = await readLocalStore('phoneAudio');
    return items.filter((item) => item.voiceName === voiceName).length;
  }

  async function saveLocalVoice(voice) {
    await localTransaction('voices', 'readwrite', (store) => store.put({
      id: String(voice.id || voice.provider_voice_id || voice.name),
      name: voice.name,
      providerVoiceId: voice.provider_voice_id || voice.voice_id || '',
      createdAt: voice.created_at || new Date().toISOString()
    }));
  }

  async function saveLocalPhoneAudio({data, voiceName, voiceId, text}) {
    const count = await localAudioCount(voiceName);
    if (count >= MAX_LOCAL_AUDIO_PER_VOICE) {
      throw new Error(`“${voiceName}”已保存 ${MAX_LOCAL_AUDIO_PER_VOICE} 条电话音频，请删除旧音频后再生成`);
    }
    const response = await fetch(data.audio_url);
    if (!response.ok) throw new Error('电话音频无法保存到本机');
    const blob = await response.blob();
    const id = `audio_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    await localTransaction('phoneAudio', 'readwrite', (store) => store.add({
      id, voiceName, voiceId: voiceId || '', text, blob,
      durationMs: data.duration_ms || 0,
      createdAt: new Date().toISOString()
    }));
    return id;
  }

  function readLocalPlans() {
    try { return JSON.parse(localStorage.getItem('jinchan-local-plans') || '[]').filter((item) => item && item.audioId); } catch (_) { return []; }
  }

  function writeLocalPlans(plans) {
    localStorage.setItem('jinchan-local-plans', JSON.stringify(plans.slice(0, 100)));
  }

  async function getLocalPlanItems() {
    const audioItems = await readLocalStore('phoneAudio');
    const audioMap = new Map(audioItems.map((item) => [item.id, item]));
    return readLocalPlans().map((plan) => {
      const audio = audioMap.get(plan.audioId);
      if (!audio?.blob) return null;
      return {...plan, text: plan.text || audio.text, owner_name: plan.voiceName || audio.voiceName, voice_name: plan.voiceName || audio.voiceName, scene_type: plan.scene || '自定义场景', contact_name: plan.contact || '', plan_name: plan.name || '', audio_url: URL.createObjectURL(audio.blob), duration_ms: plan.durationMs || audio.durationMs || 0};
    }).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function saveGeneratedPlan({audioId, data, voiceName, voiceId, text}) {
    const plans = readLocalPlans();
    const plan = {
      id: `plan_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      name: `${selections.scene} · ${selections.caller}`,
      scene: selections.scene,
      contact: selections.caller,
      voiceName,
      voiceId: voiceId || '',
      text,
      audioId,
      durationMs: data.duration_ms || 0,
      createdAt: new Date().toISOString(),
    };
    writeLocalPlans([plan, ...plans]);
    savedPlanId = plan.id;
    return plan;
  }

  async function deleteGeneratedPlan(planId, audioId) {
    writeLocalPlans(readLocalPlans().filter((item) => item.id !== planId));
    if (audioId) await localTransaction('phoneAudio', 'readwrite', (store) => store.delete(audioId));
    if (localStorage.getItem('jinchan-active-plan-id') === planId) localStorage.removeItem('jinchan-active-plan-id');
    await loadPlanCount();
    await loadPlanLibrary();
    updateLocalStorageSummary();
  }

  function activateGeneratedPlan(item) {
    localStorage.setItem('jinchan-active-plan-id', item.id);
    selections.scene = item.scene || selections.scene;
    selections.caller = item.contact || selections.caller;
    if (item.voiceName) {
      selections.voiceName = item.voiceName;
      selections.voiceId = item.voiceId || selections.voiceId;
    }
    lastCopy = item.text || lastCopy;
    voiceWorkshopCopy = item.text || voiceWorkshopCopy;
    voiceWorkshopVoiceName = item.voiceName || voiceWorkshopVoiceName;
    updateWorkshopValues();
    notice(`已启用方案：${item.name || '来电语音方案'}`);
  }

  async function deleteLocalAudio(id) {
    await localTransaction('phoneAudio', 'readwrite', (store) => store.delete(id));
    renderLocalAudioLibrary();
    updateLocalStorageSummary();
  }

  async function deleteLocalVoice(name) {
    const db = await openLocalLibrary();
    const items = await readLocalStore('phoneAudio');
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['voices', 'phoneAudio'], 'readwrite');
      const voices = transaction.objectStore('voices');
      const audio = transaction.objectStore('phoneAudio');
      voices.openCursor().onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        if (cursor.value.name === name) cursor.delete();
        cursor.continue();
      };
      items.filter((item) => item.voiceName === name).forEach((item) => audio.delete(item.id));
      transaction.oncomplete = () => { db.close(); renderLocalAudioLibrary(); updateLocalStorageSummary(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error || new Error('删除本机声音失败')); };
    });
  }

  async function clearLocalLibrary() {
    const db = await openLocalLibrary();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['voices', 'phoneAudio'], 'readwrite');
      transaction.objectStore('voices').clear();
      transaction.objectStore('phoneAudio').clear();
      transaction.oncomplete = () => { db.close(); localStorage.removeItem('jinchan-local-plans'); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error || new Error('清空本机数据失败')); };
    });
  }

  function localDataToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('导出音频失败'));
      reader.readAsDataURL(blob);
    });
  }

  async function exportLocalLibrary() {
    const voices = await readLocalStore('voices');
    const audio = await readLocalStore('phoneAudio');
    const exportedAudio = [];
    for (const item of audio) {
      exportedAudio.push({...item, blob: await localDataToBase64(item.blob)});
    }
    const file = new Blob([JSON.stringify({version: 1, exportedAt: new Date().toISOString(), voices, phoneAudio: exportedAudio})], {type: 'application/json'});
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `jinchan-local-library-${new Date().toISOString().slice(0,10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function updateLocalStorageSummary() {
    const summary = document.querySelector('#local-storage-summary');
    if (!summary) return;
    try {
      const voices = await readLocalStore('voices');
      const audio = await readLocalStore('phoneAudio');
      summary.textContent = `本机已保存 ${voices.length}/${MAX_LOCAL_VOICES} 个声音 · ${audio.length} 条电话音频`;
    } catch (error) {
      summary.textContent = error.message;
    }
  }

  async function renderLocalAudioLibrary() {
    const section = document.querySelector('#local-audio-library');
    if (!section) return;
    localAudioObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    localAudioObjectUrls = [];
    try {
      const items = (await readLocalStore('phoneAudio')).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      if (!items.length) {
        section.innerHTML = '<h2>本机电话音频</h2><div class="local-audio-empty">成功生成的电话版音频会保存在这里，可直接试听或删除。</div>';
        return;
      }
      section.innerHTML = `<h2>本机电话音频</h2>${items.map((item) => {
        const url = URL.createObjectURL(item.blob);
        localAudioObjectUrls.push(url);
        return `<article class="local-audio-item card"><div class="local-audio-head"><b>${escapeHtml(item.voiceName)}</b><button type="button" class="local-audio-delete" data-local-audio-id="${escapeHtml(item.id)}">删除</button></div><div class="local-audio-text">${escapeHtml(item.text)}</div><audio controls preload="metadata" src="${url}"></audio></article>`;
      }).join('')}`;
      section.querySelectorAll('.local-audio-delete').forEach((button) => button.addEventListener('click', async () => {
        if (!confirm('删除这条本机电话音频？')) return;
        await deleteLocalAudio(button.dataset.localAudioId);
        notice('电话音频已从本机删除');
      }));
    } catch (error) {
      section.innerHTML = `<div class="local-audio-empty">本机音频读取失败：${escapeHtml(error.message)}</div>`;
    }
  }

  function installLocalStorageControls() {
    const localRow = [...document.querySelectorAll('#me .row')].find((row) => row.querySelector('b')?.textContent?.trim() === '本地数据');
    if (localRow && !document.querySelector('#local-storage-panel')) {
      localRow.querySelector('b').textContent = '本机数据';
      const localRight = localRow.querySelector('.right');
      if (localRight) localRight.textContent = '仅当前浏览器保存';
      const panel = document.createElement('section');
      panel.id = 'local-storage-panel';
      panel.className = 'local-storage-panel';
      panel.innerHTML = '<div id="local-storage-summary">正在读取…</div><div class="local-storage-actions"><button type="button" id="local-export">导出本机数据</button><button type="button" id="local-clear">清空本机数据</button></div><small>声音和电话音频只保存在当前浏览器，不会自动同步到其他设备。</small>';
      localRow.insertAdjacentElement('afterend', panel);
      panel.querySelector('#local-export').onclick = async () => { try { await exportLocalLibrary(); notice('本机数据已导出'); } catch (error) { notice(`导出失败：${error.message}`); } };
      panel.querySelector('#local-clear').onclick = async () => { if (!confirm('清空本机保存的声音和电话音频？此操作不可恢复。')) return; try { await clearLocalLibrary(); renderLocalAudioLibrary(); updateLocalStorageSummary(); notice('本机数据已清空'); } catch (error) { notice(`清空失败：${error.message}`); } };
    }
    updateLocalStorageSummary();
  }

  function installLayoutFixes() {
    const style = document.createElement('style');
    style.textContent = `
      *,*::before,*::after{box-sizing:border-box}
      html,body,.phone,.page,.detail{scrollbar-width:none;-ms-overflow-style:none}
      html::-webkit-scrollbar,body::-webkit-scrollbar,.phone::-webkit-scrollbar,.page::-webkit-scrollbar,.detail::-webkit-scrollbar{width:0;height:0;display:none}
      .phone{width:100%;max-width:480px;margin:0 auto;overflow:hidden}
      .page,.detail{width:100%;max-width:480px;min-width:0;margin:0 auto;padding-left:20px!important;padding-right:20px!important;padding-bottom:154px!important;scroll-padding-bottom:154px;overflow-x:hidden;overscroll-behavior-x:none}
      #home>.quick,#home>h2:has(+ .quick){display:none!important}
      #home .core-function-heading{margin:24px 2px 6px;font-size:31px!important;font-weight:600!important;line-height:1.2;color:#493e3a}#home .core-function-sub{margin:0 2px 24px;color:#786e6b;font-size:15px;font-weight:400;line-height:1.55}
      #home .core-features{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:0 0 20px}
      #home .core-feature{position:relative;width:100%;min-width:0;height:152px;padding:16px;border:1px solid #eee6e1;border-radius:24px;background:#fffcf8;color:#493e3a;text-align:left;box-shadow:7px 9px 18px rgba(83,66,58,.11);display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;overflow:hidden;cursor:pointer;transition:transform .18s ease,box-shadow .22s ease}
      #home .core-feature:hover{transform:translateY(-6px);box-shadow:10px 14px 23px rgba(83,66,58,.15)}
      #home .core-feature:active{transform:scale(.98)!important;transition-duration:.18s}
      #home .core-feature.my-plans{grid-column:auto;height:152px;display:flex;padding:16px}
      #home .core-icon{width:48px;height:48px;display:grid;place-items:center;flex:0 0 48px}
      #home .core-icon svg{width:48px;height:48px;margin:0;display:block;fill:none;stroke:#51433e;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
      #home .core-copy{min-width:0}
      #home .core-copy strong{display:block;font-size:18px!important;font-weight:600!important;line-height:1.25;color:#493e3a}
      #home .core-copy small{display:-webkit-box;margin-top:6px;font-size:13px!important;font-weight:400!important;line-height:1.42;color:#786e6b;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      #home .core-badge{position:absolute;right:12px;top:12px;height:28px;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;border-radius:14px;background:#fcede8;color:#d77c6d;font-size:12px!important;font-weight:500!important;line-height:1;white-space:nowrap}
      #home .my-plans .core-badge{position:absolute;right:12px;top:12px;height:28px;padding:0 10px;border-radius:14px;background:#fcede8;color:#d77c6d;font-size:12px!important}
      #home .hero-device-bar{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px;font-size:13px;font-weight:500}.hero-device-status{display:inline-flex;align-items:center;gap:7px;color:#568b63}.hero-device-status i{width:8px;height:8px;border-radius:50%;background:#78b783;box-shadow:0 0 0 4px #edf5ee}.hero-device-battery{display:inline-flex;align-items:center;gap:6px;color:#786e6b}.hero-device-battery svg{width:25px;height:14px;fill:none;stroke:#6fa47c;stroke-width:1.8}.hero-device-battery strong{font-size:13px!important;font-weight:500!important;color:#568b63}
      .page>*,.detail>*{max-width:100%;min-width:0}
      h1,h2,h3,b,strong,button{font-weight:600!important}
      .card,.rows,.voice-card,.voice-hero,.phone-generator,.history-item,.manual-copy-composer,.plan-save-panel{width:100%;max-width:100%;min-width:0}
      .detail>.safety-note:last-of-type{margin-bottom:18px}
      .nav{pointer-events:auto}
      .nav button{pointer-events:auto;cursor:pointer}
      .nav.nav-hidden{display:none!important}
      body.detail-nav-hidden .detail.show{padding-bottom:32px!important}
      #workshop,#voice-workshop{font-family:"PingFang SC",-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#514642}
      .call-stepper{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:2px 0 20px}.call-step{position:relative;min-width:0;display:flex;align-items:center;gap:6px;color:#aaa19e;font-size:12px;font-weight:500;line-height:1.25;cursor:pointer}.call-step:not(:last-child)::after{content:"";position:absolute;left:34px;right:-5px;top:14px;height:2px;background:#eee7e2;z-index:0}.call-step-dot{position:relative;z-index:1;width:28px;height:28px;flex:0 0 28px;display:grid;place-items:center;border-radius:50%;background:#eee7e2;color:#958b88;font-size:12px;font-weight:600}.call-step.active{color:#786e6b}.call-step.active .call-step-dot{background:#fff0eb;color:#df7f6e}.call-step.done{color:#68a17a}.call-step.done .call-step-dot{background:#edf5ee;color:#68a17a}.call-step.done:not(:last-child)::after{background:#cfe4d3}.call-flow-viewport{width:100%;overflow:hidden;touch-action:pan-y}.call-flow-track{width:300%;display:flex;align-items:flex-start;transition:transform 360ms cubic-bezier(.22,1,.36,1);will-change:transform}.call-flow-panel{flex:0 0 33.333333%;width:33.333333%;min-width:0;padding-right:20px}.call-step-stage{margin:0}.call-step-stage-label{display:flex;align-items:center;gap:9px;margin:0 0 10px;color:#514642;font-size:16px;font-weight:600}.call-step-stage-label span{width:28px;height:28px;display:grid;place-items:center;border-radius:10px;background:#fff0eb;color:#df7f6e;font-size:13px}.call-flow-card{margin-top:14px;padding:16px;border:1px solid #eee6e1;border-radius:22px;background:#fffcf8;box-shadow:6px 8px 16px rgba(83,66,58,.08)}.call-flow-track>.call-flow-card{margin-top:0}.call-flow-card[hidden]{display:none!important}.call-flow-head{display:flex;align-items:center;gap:10px}.call-flow-number{width:28px;height:28px;display:grid;place-items:center;border-radius:10px;background:#f2eef7;color:#8d78b2;font-size:13px;font-weight:600}.call-flow-title{font-size:16px;font-weight:600;color:#514642}.call-flow-copy{margin:7px 0 14px;color:#786e6b;font-size:13px;line-height:1.5}.call-flow-selection{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;border-radius:16px;background:#f8f4f1}.call-flow-selection strong{font-size:15px;font-weight:500;color:#514642}.call-flow-selection span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8d78b2;font-size:14px}.call-flow-actions{display:flex;gap:9px;margin-top:12px}.call-flow-actions button{height:42px;border:0;border-radius:14px;padding:0 13px;cursor:pointer;font-size:14px;font-weight:600}.call-flow-actions .choose-call-voice{flex:1;background:#f2eef7;color:#8d78b2}.call-flow-actions .clone-call-voice{background:#fff0eb;color:#df7f6e}.call-flow-card.is-locked{opacity:.52}.call-flow-card.is-locked .call-flow-actions button{cursor:not-allowed}.call-flow-card.call-generator-stage{padding:0;border:0;background:transparent;box-shadow:none}.call-generator-stage #voice-phone-generator{margin-top:0}@media(prefers-reduced-motion:reduce){.call-flow-track{transition-duration:.01ms}}
      #workshop .back,#voice-workshop .back,#clone-flow .back,#voice-picker .back{width:40px;height:40px;display:grid;place-items:center;border:0;border-radius:50%;font-size:0;color:#514642;background:#fffaf5;box-shadow:5px 6px 12px rgba(83,66,58,.13),-5px -5px 11px #fff}
      #workshop .back::before,#voice-workshop .back::before,#clone-flow .back::before,#voice-picker .back::before{content:"";width:11px;height:11px;border-left:2.5px solid #514642;border-bottom:2.5px solid #514642;border-radius:2px;transform:rotate(45deg) translate(1px,-1px)}
      #workshop>h1,#voice-workshop>h1{margin:18px 0 6px!important;font-size:31px!important;line-height:1.2!important;font-weight:600!important;color:#493e3a!important;letter-spacing:0!important}
      #workshop>.sub,#voice-workshop>.sub{margin:0 0 22px;font-size:15px!important;font-weight:400!important;line-height:1.55!important;color:#786e6b!important}
      #workshop .rows{margin-top:0!important;padding:0 16px;border:1px solid #f0e7e1;border-radius:24px;overflow:hidden;background:#fffcf8;box-shadow:7px 9px 18px rgba(83,66,58,.1)}
      #workshop .rows .row{height:64px;min-height:64px;padding:0;gap:12px;cursor:pointer;border-bottom:1px solid #eee5df}
      #workshop .rows .row:last-child{border-bottom:0}
      #workshop .rows .row b{flex:0 0 auto;font-size:15px!important;font-weight:500!important;color:#514642!important}
      #workshop .rows .right{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:400;color:#8e8582}
      .workshop-icon{width:38px;height:38px;flex:0 0 38px;display:grid;place-items:center;border-radius:13px}
      .workshop-icon svg{width:27px;height:27px;fill:none;stroke:#51433e;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round}
      .workshop-icon.peach{background:#fff0eb}.workshop-icon.purple{background:#f2eef7}.workshop-icon.blue{background:#edf3f8}
      #workshop>.primary:not(#generate-voice-button),#voice-workshop>.voice-add{height:52px;margin-top:18px;padding:0 16px;border-radius:18px;background:#df7f6e;color:#fff;font-size:16px!important;font-weight:600!important;display:flex;align-items:center;justify-content:center;gap:8px}
      .generate-spark{display:inline-block;font-size:18px}.is-generating .generate-spark{animation:softPulse 1.1s ease-in-out infinite}
      #generate-voice-button{height:52px;margin-top:12px!important;border:1px solid #cdbce0;background:#f8f4fb;color:#8d78b2;box-shadow:5px 7px 14px rgba(120,96,148,.12);opacity:0;transform:translateY(8px);pointer-events:none;transition:opacity .3s ease,transform .3s ease}
      #generate-voice-button.ready{opacity:1;transform:none;pointer-events:auto}
      #ai-copy-result{display:none!important;margin-top:14px!important;padding:16px!important;border:1px solid #eee5df!important;border-radius:20px!important;background:#fffcf8!important}
      .history-section{margin-top:20px}.history-section h2{font-size:21px;color:#514642;margin:0 0 12px}.history-item{padding:14px 16px;margin-bottom:10px;border-radius:20px;background:#fffcf8}.history-meta{font-size:12px;color:#9a918e;margin-bottom:7px}.history-text{font-size:15px;line-height:1.55;color:#514642;white-space:pre-wrap}.history-actions{display:flex;gap:8px;margin-top:10px}.history-actions button{border:0;border-radius:12px;padding:7px 12px;font-size:13px;cursor:pointer}.history-use{background:#fce8e2;color:#df7f6e}.history-delete{background:#f3efec;color:#958b88}.history-empty{padding:14px 2px;color:#9a918e;font-size:14px}
      .manual-copy-composer{margin-top:16px}.manual-copy-toggle{width:100%;height:48px;border:1px dashed #cbb9db;border-radius:17px;background:#fbf7fd;color:#8d78b2;font-size:15px;font-weight:600;cursor:pointer}.manual-copy-editor{display:none;margin-top:10px;padding:15px;border:1px solid #eee5df;border-radius:20px;background:#fffcf8}.manual-copy-editor.open{display:block;animation:resultIn .28s cubic-bezier(.22,1,.36,1) both}.manual-copy-editor label{display:block;margin-bottom:8px;font-size:13px;color:#786e6b}.manual-copy-editor textarea{width:100%;min-height:120px;resize:vertical;padding:12px 13px;border:1px solid #e7ddd7;border-radius:15px;background:#fffaf6;color:#514642;font:400 15px/1.65 inherit;outline:none}.manual-copy-editor textarea:focus{border-color:#bca9d3;box-shadow:0 0 0 3px #f2eef7}.manual-copy-meta{margin:9px 0 12px;font-size:12px;color:#9a918e}.manual-copy-actions{display:grid;grid-template-columns:1fr 1.5fr;gap:9px}.manual-copy-actions button{height:42px;border:0;border-radius:14px;font-size:14px;font-weight:600;cursor:pointer}.manual-copy-cancel{background:#f3efec;color:#8e8582}.manual-copy-save{background:#df7f6e;color:#fff}
      .plan-save-panel{margin-top:14px;padding:16px;border:1px solid #eee5df;border-radius:20px;background:#fffcf8;box-shadow:6px 8px 16px rgba(83,66,58,.08)}.plan-save-panel label{display:block;margin-bottom:8px;font-size:13px;color:#786e6b}.plan-name-input{width:100%;height:46px;padding:0 13px;border:1px solid #e7ddd7;border-radius:14px;background:#fffaf6;color:#514642;font:400 15px inherit;outline:none}.plan-name-input:focus{border-color:#bca9d3;box-shadow:0 0 0 3px #f2eef7}.plan-audio-status{margin:10px 1px 12px;font-size:13px;line-height:1.5;color:#9a918e}.plan-save-button{width:100%;height:48px;border:0;border-radius:16px;background:#6fa47c;color:#fff;font-size:15px;font-weight:600;cursor:pointer;box-shadow:4px 6px 12px rgba(85,132,96,.18)}.plan-save-button:disabled{background:#c7cec7;box-shadow:none;cursor:not-allowed}.plan-saved-note{margin-top:9px;text-align:center;font-size:12px;color:#68a17a}
      .plan-workshop-mask{position:absolute;inset:0;z-index:90;display:none;align-items:flex-end;padding:18px;background:rgba(81,67,62,.22)}.plan-workshop-mask.show{display:flex}.plan-workshop-dialog{width:100%;padding:18px;border-radius:28px;background:#fffaf5;box-shadow:0 18px 44px rgba(81,67,62,.24);animation:resultIn .3s cubic-bezier(.22,1,.36,1) both}.plan-workshop-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}.plan-workshop-head h2{margin:0;font-size:22px;color:#493e3a}.plan-workshop-close{width:36px;height:36px;border:0;border-radius:50%;background:#f2ebe6;color:#786e6b;font-size:20px}.plan-workshop-dialog .plan-save-panel{margin-top:12px;box-shadow:none}
      #plan-workshop{background:#fbf7f3;font-family:"PingFang SC",-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#493e3a}
      #plan-workshop .back{width:40px;height:40px;display:grid;place-items:center;border:0;border-radius:50%;font-size:0;background:#fffcf8;box-shadow:5px 6px 12px rgba(83,66,58,.13),-5px -5px 11px #fff}
      #plan-workshop .back::before{content:"";width:11px;height:11px;border-left:2.5px solid #514642;border-bottom:2.5px solid #514642;border-radius:2px;transform:rotate(45deg) translate(1px,-1px)}
      #plan-workshop>h1{margin:18px 0 6px;font-size:31px!important;font-weight:600!important;line-height:1.2;color:#493e3a;letter-spacing:0}
      #plan-workshop>.sub{margin:0 0 22px;font-size:15px;font-weight:400;line-height:1.55;color:#786e6b}
      .plan-library-list{display:grid;gap:14px}.plan-library-card{width:100%;padding:20px 18px;border:1px solid #eee6e1;border-radius:24px;background:#fffcf8;box-shadow:0 10px 28px rgba(83,66,58,.10)}
      .plan-owner{display:flex;align-items:center;gap:12px;margin-bottom:15px}.plan-owner-avatar{width:44px;height:44px;flex:0 0 44px;border-radius:15px;display:grid;place-items:center;background:#fff0eb}.plan-owner-avatar.purple{background:#f2eef7}.plan-owner-avatar.blue{background:#edf3f8}.plan-owner-avatar.green{background:#edf5ee}.plan-owner-avatar svg{width:34px;height:34px;fill:none;stroke:#51433e;stroke-width:2.35;stroke-linecap:round;stroke-linejoin:round}.plan-owner-name{font-size:17px;font-weight:600;color:#493e3a}.plan-context{display:flex;flex-wrap:wrap;gap:5px 9px;margin-top:5px}.plan-context span{display:inline-flex;align-items:center;min-height:21px;padding:2px 8px;border-radius:11px;background:#f7f1ed;color:#8e8582;font-size:11px;font-weight:400}.plan-context span:last-child{background:#f2eef7;color:#8d78b2}
      .plan-context{display:flex!important}
      .plan-add-button{width:100%;height:48px;margin:18px 0 4px;border:1px solid #eaded8;border-radius:17px;background:#fffaf6;color:#df7f6e;font-size:15px;font-weight:600;cursor:pointer}.plan-add-button[hidden]{display:none!important}.plan-card-actions{display:grid;grid-template-columns:1fr auto;gap:9px;margin-top:14px}.plan-card-actions button{height:42px;border:0;border-radius:14px;padding:0 16px;font-size:14px;font-weight:600;cursor:pointer}.plan-use{background:#fce8e2;color:#d97868}.plan-delete{background:#f3efec;color:#958b88}.plan-library-card.is-active-plan{border-color:#cfe2d2}.plan-library-card.is-active-plan .plan-use{background:#edf5ee;color:#68a17a}
      .generator-result-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.generator-result-actions[hidden]{display:none!important}.generator-result-actions button{height:46px;border-radius:15px;font-size:14px;font-weight:600;cursor:pointer}.generator-preview{border:1px solid #cdbce0;background:#f8f4fb;color:#8d78b2}.generator-view-plans{border:0;background:#edf5ee;color:#68a17a}
      .plan-full-text{margin:0;padding:14px 0 17px;border-top:1px solid #f0e8e3;color:#625754;font-size:15px;font-weight:400;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
      .plan-player{display:grid;grid-template-columns:42px minmax(0,1fr);align-items:center;gap:12px}.plan-play{width:42px;height:42px;border:0;border-radius:50%;display:grid;place-items:center;background:#f0ebf7;color:#8d78b2;cursor:pointer}.plan-play svg{width:18px;height:18px;fill:#8d78b2}.plan-play .pause-icon{display:none}.plan-library-card.playing .plan-play .play-icon{display:none}.plan-library-card.playing .plan-play .pause-icon{display:block}
      .plan-player-main{min-width:0}.plan-progress{width:100%;height:5px;margin:0;display:block;accent-color:#8d78b2;cursor:pointer}.plan-player-meta{height:20px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;color:#958b88;font-size:12px;font-weight:400}.plan-soft-wave{height:16px;display:flex;align-items:center;gap:2px;opacity:0}.plan-soft-wave i{width:2.5px;height:8px;border-radius:3px;background:#8d78b2}.plan-library-card.playing .plan-soft-wave{opacity:1}.plan-library-card.playing .plan-soft-wave i{animation:miniWave .75s ease-in-out infinite}.plan-library-card.playing .plan-soft-wave i:nth-child(2){height:14px;animation-delay:.12s}.plan-library-card.playing .plan-soft-wave i:nth-child(3){height:10px;animation-delay:.24s}.plan-library-card.playing .plan-soft-wave i:nth-child(4){height:6px;animation-delay:.36s}
      .plan-library-skeleton{pointer-events:none}.plan-skeleton-head{display:flex;align-items:center;gap:12px;margin-bottom:16px}.plan-skeleton-block{display:block;border-radius:8px;background:linear-gradient(90deg,#ede8e4,#f6f2ef,#ede8e4);background-size:200% 100%;animation:skeletonWarm 1.6s ease-in-out infinite}.plan-skeleton-avatar{width:44px;height:44px;border-radius:15px}.plan-skeleton-name{width:92px;height:16px}.plan-skeleton-lines{display:grid;gap:9px;padding:14px 0 17px;border-top:1px solid #f0e8e3}.plan-skeleton-lines i{height:12px}.plan-skeleton-lines i:nth-child(1){width:96%}.plan-skeleton-lines i:nth-child(2){width:91%}.plan-skeleton-lines i:nth-child(3){width:86%}.plan-skeleton-lines i:nth-child(4){width:63%}.plan-skeleton-player{height:42px;border-radius:20px}
      .plan-library-empty{padding:42px 20px;text-align:center;border:1px dashed #ddd0c8;border-radius:24px;background:#fffcf8}.plan-empty-mascot{width:84px;height:84px;margin:0 auto 17px}.plan-empty-mascot svg{width:100%;height:100%}.plan-library-empty h2{margin:0 0 8px;font-size:20px;font-weight:600;color:#493e3a}.plan-library-empty p{margin:0 auto 20px;max-width:300px;font-size:14px;line-height:1.6;color:#786e6b}.plan-empty-go{height:48px;padding:0 22px;border:0;border-radius:17px;background:#df7f6e;color:#fff;font-size:15px;font-weight:600;cursor:pointer;box-shadow:5px 7px 13px rgba(189,103,88,.20)}
      .plan-library-error{padding:28px 18px;text-align:center;color:#786e6b}.plan-library-error button{height:42px;margin-top:14px;padding:0 18px;border:0;border-radius:14px;background:#f0ebf7;color:#8d78b2}
      .permission-mask{position:absolute;inset:0;z-index:95;display:none;align-items:flex-end;padding:16px;background:rgba(81,67,62,.22)}.permission-mask.show{display:flex}.permission-sheet{width:100%;max-height:88%;overflow:auto;padding:22px 18px 18px;border-radius:28px 28px 0 0;background:#fffcf8;box-shadow:0 -12px 34px rgba(83,66,58,.18);animation:resultIn .28s cubic-bezier(.22,1,.36,1) both}.permission-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.permission-head h2{margin:0;color:#493e3a;font-size:22px;font-weight:600}.permission-close{width:34px;height:34px;border:0;border-radius:50%;background:#f3ece8;color:#786e6b;font-size:20px;line-height:1}.permission-copy{margin:7px 0 17px;color:#786e6b;font-size:14px;line-height:1.55}.permission-list{display:grid;gap:9px;margin-bottom:18px}.permission-item{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:11px;padding:11px 12px;border:1px solid #eee6e1;border-radius:17px;background:#fffaf6}.permission-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:13px;background:#f2eef7;color:#8d78b2;font-size:19px}.permission-item:nth-child(2) .permission-icon{background:#edf5ee;color:#68a17a}.permission-item:nth-child(3) .permission-icon{background:#edf3f8;color:#668fba}.permission-item:nth-child(4) .permission-icon{background:#fff0eb;color:#df7f6e}.permission-item:nth-child(5) .permission-icon{background:#fff1d7;color:#b88456}.permission-item b{display:block;font-size:15px;color:#514642;font-weight:600}.permission-item small{display:block;margin-top:3px;color:#958b88;font-size:12px;line-height:1.35}.permission-kind{font-size:11px;color:#9a918e;white-space:nowrap}.permission-authorize{width:100%;height:52px;border:0;border-radius:18px;background:#df7f6e;color:#fff;font-size:16px;font-weight:600;box-shadow:5px 7px 13px rgba(189,103,88,.20);cursor:pointer}
      #ai-copy-result.visible{display:block!important}
      .result-skeleton{display:grid;gap:10px}.result-skeleton i{display:block;height:13px;border-radius:7px;background:linear-gradient(90deg,#ede8e4,#f6f2ef,#ede8e4);background-size:200% 100%;animation:skeletonWarm 1.6s ease-in-out infinite}.result-skeleton i:nth-child(1){width:96%}.result-skeleton i:nth-child(2){width:88%}.result-skeleton i:nth-child(3){width:68%}
      .editable-label{font-size:12px;color:#9a918e;margin-bottom:8px}.editable-copy{min-height:74px;outline:none;font-size:15px;line-height:1.65;color:#514642;white-space:pre-wrap}.result-ready{animation:resultIn .35s cubic-bezier(.22,1,.36,1) both}.generation-error{border:1px solid #f0d6cf!important;background:#fffaf7!important}.generation-error-title{font-size:16px;font-weight:600;color:#c96f61}.generation-error-copy{margin-top:8px;color:#786e6b;font-size:14px;line-height:1.6;overflow-wrap:anywhere}.generation-retry{height:40px;margin-top:14px;padding:0 16px;border:0;border-radius:14px;background:#df7f6e;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
      #voice-workshop .voice-hero{margin:0 0 12px;padding:18px;border:1px solid #eee5df;border-radius:24px;background:#fffcf8;box-shadow:6px 8px 16px rgba(83,66,58,.09);cursor:pointer;transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
      #voice-workshop .voice-hero:hover{transform:translateY(-5px);border-color:#d8c9e6;box-shadow:9px 13px 22px rgba(83,66,58,.14)}#voice-workshop .voice-hero:active{transform:scale(.985)}#voice-workshop .voice-hero:focus-visible{outline:3px solid #e7dcf1;outline-offset:3px}
      .voice-mascot{width:80px;height:80px;margin:0 auto 8px}.voice-mascot svg{width:100%!important;height:100%!important}
      #voice-workshop .voice-hero>b{display:block;font-size:17px;font-weight:600;color:#514642}
      #voice-workshop .voice-section{font-size:21px!important;font-weight:600!important;color:#514642;margin:22px 0 12px}
      #voice-workshop .voice-card{height:88px;min-height:88px;margin-bottom:12px;padding:14px 15px;grid-template-columns:48px minmax(0,1fr) 40px;border-radius:22px;border:1px solid #eee5df;background:#fffcf8;overflow:hidden}
      #voice-workshop .voice-swipe-card{position:relative;isolation:isolate;grid-template-columns:48px minmax(0,1fr) 52px;border-radius:24px;overflow:hidden;outline:none}
      #voice-workshop .voice-swipe-card::after{content:"";position:absolute;z-index:0;top:0;right:0;bottom:0;width:25%;background:linear-gradient(135deg,rgba(249,226,218,.90) 0%,rgba(242,221,236,.92) 52%,rgba(229,220,245,.95) 100%);transform:scaleX(0);transform-origin:right center;transition:transform 360ms cubic-bezier(.22,1,.36,1);pointer-events:none}
      #voice-workshop .voice-swipe-card>*{position:relative;z-index:1}#voice-workshop .voice-swipe-card>div:nth-child(2){min-width:0;max-width:72%}
      #voice-workshop .voice-swipe-card .play{width:52px;height:52px;background:#f2edf8;color:#8d78b2;transition:transform 360ms cubic-bezier(.22,1,.36,1),opacity 250ms ease;z-index:2}
      #voice-workshop .voice-swipe-card .voice-generate-action{position:absolute;z-index:3;top:0;right:0;bottom:0;width:25%;min-width:92px;padding:0 8px;border:0;background:transparent;color:#6f587e;display:flex;align-items:center;justify-content:center;gap:5px;font:600 13px/1.2 inherit;white-space:nowrap;opacity:0;transform:translateX(14px);pointer-events:none;transition:transform 360ms cubic-bezier(.22,1,.36,1),opacity 250ms ease;cursor:pointer}
      #voice-workshop .voice-swipe-card .voice-generate-action svg{width:19px;height:19px;flex:0 0 19px;fill:none;stroke:#8d78b2;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
      #voice-workshop .voice-swipe-card:hover::after,#voice-workshop .voice-swipe-card:focus-visible::after,#voice-workshop .voice-swipe-card:focus-within::after{transform:scaleX(1)}
      #voice-workshop .voice-swipe-card:hover .play,#voice-workshop .voice-swipe-card:focus-visible .play,#voice-workshop .voice-swipe-card:focus-within .play{transform:translateX(12px) scale(.9);opacity:0}
      #voice-workshop .voice-swipe-card:hover .voice-generate-action,#voice-workshop .voice-swipe-card:focus-visible .voice-generate-action,#voice-workshop .voice-swipe-card:focus-within .voice-generate-action{transform:translateX(0);opacity:1;pointer-events:auto}
      #voice-workshop .voice-fixed-actions{grid-template-columns:48px minmax(0,1fr) 52px!important}.voice-fixed-actions::after{display:none}.voice-fixed-actions .play{display:none!important}.voice-fixed-actions .voice-generate-action{position:static!important;grid-column:3;width:52px!important;min-width:52px!important;height:52px;padding:0;border-radius:50%;background:#f2edf8;color:#8d78b2;opacity:1!important;transform:none!important;pointer-events:auto!important}.voice-fixed-actions .voice-generate-action span{display:none}.voice-fixed-actions .voice-generate-action svg{width:20px;height:20px}.voice-fixed-actions .voice-avatar{cursor:pointer}
      .phone-generator{display:none;margin:18px 0 20px;padding:16px;border:1px solid #eee5df;border-radius:24px;background:#fffcf8;box-shadow:7px 9px 18px rgba(83,66,58,.10)}.phone-generator.open{display:block;animation:resultIn .32s cubic-bezier(.22,1,.36,1) both}
      #phone-voice-generator{background:#fbf7f3;font-family:"PingFang SC",-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;color:#493e3a}
      #phone-voice-generator .back{width:40px;height:40px;display:grid;place-items:center;border:0;border-radius:50%;font-size:0;background:#fffcf8;box-shadow:5px 6px 12px rgba(83,66,58,.13),-5px -5px 11px #fff}
      #phone-voice-generator .back::before{content:"";width:11px;height:11px;border-left:2.5px solid #514642;border-bottom:2.5px solid #514642;border-radius:2px;transform:rotate(45deg) translate(1px,-1px)}
      #phone-voice-generator>h1{margin:18px 0 6px;font-size:31px!important;font-weight:600!important;line-height:1.2;color:#493e3a;letter-spacing:0}
      #phone-voice-generator>.sub{margin:0 0 22px;font-size:15px;font-weight:400;line-height:1.55;color:#786e6b}
      #phone-voice-generator .phone-generator{display:block;margin:0;padding:20px 18px;border-color:#eee6e1;border-radius:24px;box-shadow:0 10px 28px rgba(83,66,58,.10)}
      #phone-voice-generator .phone-generator-title{font-size:19px}.phone-generator-host{width:100%;min-width:0}
      #phone-voice-generator .phone-generator-row{min-height:66px}#phone-voice-generator .phone-copy-input{min-height:154px;margin:16px 0 14px;padding:14px 15px;border-radius:20px;font-size:15px;line-height:1.65}#phone-voice-generator .phone-controls{gap:12px;margin-bottom:16px}#phone-voice-generator .phone-control{min-height:96px;padding:14px;border-radius:18px;display:flex;flex-direction:column;justify-content:center}#phone-voice-generator #voice-phone-generate{height:54px;border-radius:19px}#phone-voice-generator .phone-generator-hint{margin-top:12px;line-height:1.5}
      .phone-generator-title{display:flex;align-items:center;gap:9px;margin-bottom:5px;font-size:18px;font-weight:600;color:#514642}.phone-generator-title span{width:34px;height:34px;display:grid;place-items:center;border-radius:12px;background:#fff0eb;color:#df7f6e;font-size:18px}
      .phone-generator-sub{margin:0 0 14px;font-size:13px;line-height:1.5;color:#8e8582}
      .phone-generator-row{width:100%;min-height:58px;padding:0;border:0;border-top:1px solid #eee5df;background:transparent;display:grid;grid-template-columns:78px minmax(0,1fr) 16px;align-items:center;gap:8px;text-align:left;cursor:pointer}
      .phone-generator-row b{font-size:15px;font-weight:500;color:#514642}.phone-generator-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;font-size:14px;color:#8e8582}.phone-generator-arrow{color:#aaa19e;text-align:right}
      .generator-confirm{width:100%;min-height:68px;padding:11px 13px;border:1px solid #eee5df;border-radius:18px;background:#fffaf6;display:grid;grid-template-columns:38px minmax(0,1fr) 24px;align-items:center;gap:11px;text-align:left;cursor:pointer}.generator-confirm+.generator-confirm{margin-top:10px}.generator-confirm-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:13px;background:#fff0eb;color:#df7f6e;font-size:14px;font-weight:600}.generator-confirm-icon.purple{background:#f2eef7;color:#8d78b2}.generator-confirm-copy{min-width:0}.generator-confirm-copy b{display:block;color:#514642;font-size:15px;font-weight:600}.generator-confirm-copy small{display:block;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#958b88;font-size:12px;font-weight:400}.generator-confirm>i{width:22px;height:22px;display:grid;place-items:center;border-radius:50%;background:#eee8e4;color:#aaa19e;font-size:12px;font-style:normal}.generator-confirm.confirmed{border-color:#d9e8dc;background:#fbfdf9}.generator-confirm.confirmed>i{background:#edf5ee;color:#68a17a}.generator-script-preview{margin:12px 0;padding:13px 14px;border-radius:17px;background:#f8f4f1;color:#625754;font-size:14px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
      .phone-copy-preview{margin:10px 0 14px;padding:12px 13px;border-radius:16px;background:#f8f4f1;color:#786e6b;font-size:13px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
      .phone-copy-input{width:100%;min-height:108px;margin:10px 0 12px;padding:12px 13px;resize:vertical;border:1px solid #e7ddd7;border-radius:16px;background:#fffaf6;color:#514642;font:400 14px/1.6 inherit;outline:none}.phone-copy-input:focus{border-color:#bca9d3;box-shadow:0 0 0 3px #f2eef7}
      .phone-controls{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 13px}.phone-control{padding:11px;border-radius:15px;background:#f8f4f1}.phone-control label{display:flex;justify-content:space-between;margin-bottom:8px;font-size:12px;color:#786e6b}.phone-control output{color:#8d78b2;font-weight:600}.phone-control input{width:100%;accent-color:#8d78b2}.telephone-player{display:none;width:100%;height:42px;margin:12px 0 0}.telephone-player.ready{display:block}.telephone-result-meta{display:none;margin-top:8px;text-align:center;font-size:12px;color:#68a17a}.telephone-result-meta.ready{display:block}
      #voice-phone-generate{height:50px;width:100%;margin:0;border:0;border-radius:17px;background:#df7f6e;color:#fff;font-size:16px;font-weight:600;box-shadow:5px 7px 13px rgba(189,103,88,.22);cursor:pointer}
      #voice-phone-generate:disabled{opacity:.58;cursor:wait}.phone-generator-hint{margin-top:9px;text-align:center;font-size:12px;color:#9a918e}
      #voice-workshop .voice-card .ico,#voice-picker .voice-card .ico{width:48px;height:48px;border-radius:15px;font-size:0}
      .voice-avatar svg{width:34px!important;height:34px!important;fill:none;stroke:#51433e;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
      #voice-workshop .voice-card b{font-size:17px;font-weight:600;color:#514642}
      #voice-workshop .voice-source{font-size:13px;color:#8e8582;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
      .current-pill{display:inline-flex;align-items:center;height:21px;padding:0 8px;border-radius:11px;background:#edf5ee;color:#68a17a;font-size:11px;font-weight:500}
      #voice-workshop .play,#voice-picker .play{width:40px;height:40px;display:flex;align-items:center;justify-content:center;gap:2px;border:0;border-radius:50%;background:#f2eef7;color:#8d78b2;box-shadow:4px 5px 10px rgba(120,96,148,.13)}
      .mini-wave{display:none;align-items:center;gap:2px;height:16px}.mini-wave i{width:2.5px;border-radius:3px;background:#8d78b2;animation:miniWave .75s ease-in-out infinite}.mini-wave i:nth-child(1){height:8px}.mini-wave i:nth-child(2){height:15px;animation-delay:.12s}.mini-wave i:nth-child(3){height:11px;animation-delay:.24s}.mini-wave i:nth-child(4){height:6px;animation-delay:.36s}.play.playing .play-glyph{display:none}.play.playing .mini-wave{display:flex}
      .workshop-intro{animation:introIn .35s cubic-bezier(.22,1,.36,1) both}
      .workshop-reveal{opacity:0;transform:translateY(18px)}.workshop-reveal.revealed{animation:cardReveal .45s cubic-bezier(.22,1,.36,1) forwards;animation-delay:var(--reveal-delay,0s)}
      .clone-consent{display:flex;gap:10px;align-items:flex-start;margin:24px 0;padding:14px;border-radius:16px;background:#f4f7ed;color:#5f725f;text-align:left;font-size:13px;line-height:1.55}.clone-consent input{margin-top:3px;accent-color:#e87868}
      .record-status{font-size:14px;color:#786e6b;margin:14px 0}.record-time{font-size:28px!important;font-weight:600!important;color:#493e3a!important;margin:12px 0}.record-level{height:62px;display:flex;align-items:center;justify-content:center;gap:5px}.record-level i{width:6px;height:12px;border-radius:6px;background:#917fb1;transition:height .08s linear}
      .record-preview{width:100%;margin-top:14px}.clone-name{width:100%;height:48px;margin-top:18px;padding:0 14px;border:1px solid #e6dcd6;border-radius:15px;background:#fffcf8;color:#514642;font:400 15px inherit;outline:none}.clone-name:focus{border-color:#bca9d3;box-shadow:0 0 0 3px #f2eef7}
      .clone-upload{display:flex;align-items:center;justify-content:center;width:100%;min-height:48px;margin-top:12px;padding:10px;border:1px dashed #bca9d3;border-radius:15px;background:#fbf7fd;color:#8d78b2;font-size:14px;font-weight:600;cursor:pointer}.clone-upload input{position:absolute;opacity:0;pointer-events:none}.clone-or{margin:11px 0 0;color:#aaa19e;font-size:12px}.clone-file-name{margin-top:8px;color:#68a17a;font-size:12px;word-break:break-all}
      .quality-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px;text-align:left}.quality-item{padding:12px;border-radius:14px;background:#f8f4f1}.quality-item b{display:block;font-size:12px;color:#9a918e;margin-bottom:4px}.quality-item span{font-size:14px;color:#514642}
      .clone-success{width:78px;height:78px;margin:12px auto 18px;display:grid;place-items:center;border-radius:50%;background:#edf5ee;color:#68a17a;font-size:36px}.voice-empty{padding:22px 16px;margin-bottom:12px;border:1px dashed #d8ccc5;border-radius:20px;text-align:center;color:#8e8582;font-size:13px}.voice-actions{display:flex;gap:6px;justify-content:flex-end}.delete-voice{width:32px;height:32px;border:0;border-radius:50%;background:#fff0eb;color:#d66e63;font-size:14px}
      #voice-workshop .voice-card.has-delete{grid-template-columns:48px minmax(0,1fr) 78px}
      .choice-mask{position:absolute;inset:0;z-index:80;display:flex;align-items:flex-end;background:rgba(81,67,62,.18);padding:18px}
      .choice-sheet{width:100%;max-height:70%;overflow:auto;padding:18px;border-radius:26px;background:#fffaf5;box-shadow:0 18px 45px rgba(81,67,62,.24)}
      .choice-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-size:20px;font-weight:600;color:#493e3a}
      .choice-close{border:0;background:#f2ebe6;color:#786e6b;width:34px;height:34px;border-radius:50%;font-size:18px}
      .choice-option{width:100%;min-height:52px;border:0;border-bottom:1px solid #eee5df;background:transparent;text-align:left;padding:12px 6px;color:#514642;font:500 15px/1.4 inherit}
      .choice-option:last-child{border-bottom:0}.choice-option.selected{color:#e87868}
      @keyframes softPulse{0%,100%{opacity:.65;transform:scale(.92)}50%{opacity:1;transform:scale(1.08)}}
      @keyframes skeletonWarm{0%{background-position:100% 0}100%{background-position:-100% 0}}
      @keyframes resultIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
      @keyframes introIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
      @keyframes cardReveal{to{opacity:1;transform:none}}
      @keyframes miniWave{0%,100%{transform:scaleY(.55);opacity:.55}50%{transform:scaleY(1);opacity:1}}
      .local-storage-panel{margin:0;padding:14px 0 4px;border-top:1px solid #eee6e1;background:transparent;box-shadow:none}.local-storage-title{font-size:16px;font-weight:600;color:#493e3a}.local-storage-panel #local-storage-summary{margin-top:6px;color:#786e6b;font-size:13px}.local-storage-panel small{display:block;margin-top:10px;color:#9a918e;font-size:12px;line-height:1.45}.local-storage-actions{display:flex;gap:8px;margin-top:12px}.local-storage-actions button{height:38px;padding:0 12px;border:0;border-radius:13px;background:#f2eef7;color:#8d78b2;font-size:13px;cursor:pointer}.local-storage-actions button:last-child{background:#fff0eb;color:#d66e63}.local-audio-library{margin:18px 0 24px}.local-audio-library h2{margin:0 0 10px;font-size:21px;color:#514642}.local-audio-empty{padding:14px 2px;color:#9a918e;font-size:13px;line-height:1.5}.local-audio-item{padding:14px 15px;margin-bottom:10px;border:1px solid #eee6e1;border-radius:20px;background:#fffcf8}.local-audio-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.local-audio-head b{font-size:16px;color:#493e3a}.local-audio-delete{height:30px;padding:0 10px;border:0;border-radius:12px;background:#fff0eb;color:#d66e63;font-size:12px;cursor:pointer}.local-audio-text{margin:9px 0;color:#625754;font-size:14px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}.local-audio-item audio{width:100%;height:36px}.api-key-label{display:block;margin:0 0 13px;color:#514642;font-size:14px;font-weight:500}.api-key-label input{display:block;width:100%;height:44px;margin-top:7px;padding:0 12px;border:1px solid #e7ddd7;border-radius:13px;background:#fffaf6;color:#514642;font:400 13px inherit;outline:none}.api-key-label input:focus{border-color:#bca9d3;box-shadow:0 0 0 3px #f2eef7}.api-key-clear{display:block;width:100%;margin-top:10px;border:0;background:transparent;color:#958b88;font-size:12px;cursor:pointer}
      #workshop .manual-copy-composer{margin-top:8px}#records .record-v2{height:auto!important;min-height:96px;overflow:hidden}#records .record-meta{width:74px;min-width:74px;align-self:center}#records .record-time{font-size:11px!important;line-height:1.25;white-space:nowrap}#records .record-list:last-of-type{padding-bottom:22px}
      .custom-inline-editor{display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid #eee5df}.custom-inline-editor input{min-width:0;flex:1;height:40px;padding:0 11px;border:1px solid #e7ddd7;border-radius:12px;background:#fffaf6;color:#514642;font:400 14px inherit;outline:none}.custom-inline-editor button{height:40px;padding:0 13px;border:0;border-radius:12px;background:#df7f6e;color:#fff;font-size:13px;cursor:pointer}
      /* Unified interaction states: default / hover / tap / focus-visible / disabled. */
      :where(button,.clickable-row,.core-feature,.voice-card,.voice-hero,.plan-library-card,.history-item,.choice-option,.local-audio-item){transition:transform .26s cubic-bezier(.22,1,.36,1),box-shadow .26s cubic-bezier(.22,1,.36,1),background-color .22s ease,border-color .22s ease,opacity .22s ease}
      :where(button,.clickable-row,.core-feature,.voice-card,.voice-hero,.plan-library-card,.history-item,.choice-option,.local-audio-item):not(:disabled):not([aria-disabled="true"]):hover{transform:translateY(-2px)}
      :where(button,.clickable-row,.core-feature,.voice-card,.voice-hero,.plan-library-card,.history-item,.choice-option,.local-audio-item):not(:disabled):not([aria-disabled="true"]):active{transform:scale(.98);transition-duration:.16s}
      :where(button,.clickable-row,.core-feature,.voice-card,.voice-hero,.plan-library-card,.history-item,.choice-option,.local-audio-item):focus-visible{outline:3px solid rgba(141,120,178,.28);outline-offset:3px}
      :where(button,.clickable-row,.core-feature,.voice-card,.voice-hero,.plan-library-card,.history-item,.choice-option,.local-audio-item):disabled,:where([aria-disabled="true"]){opacity:.52;cursor:not-allowed;pointer-events:none}
      :where(.primary,#voice-phone-generate,.voice-add,.plan-save-button,.plan-empty-go,.permission-authorize,.generation-retry,.manual-copy-save):not(:disabled):hover{transform:translateY(-2px);box-shadow:7px 10px 17px rgba(189,103,88,.24)}
      :where(.primary,#voice-phone-generate,.voice-add,.plan-save-button,.plan-empty-go,.permission-authorize,.generation-retry,.manual-copy-save):not(:disabled):active{transform:scale(.97)}
      :where(.back,.choice-close,.plan-workshop-close,.delete-voice,.plan-play,.play,.local-audio-delete,.local-storage-actions button):not(:disabled):hover{background-color:#f2eef7;transform:scale(1.04)}
      :where(.back,.choice-close,.plan-workshop-close,.delete-voice,.plan-play,.play,.local-audio-delete,.local-storage-actions button):not(:disabled):active{transform:scale(.92);transition-duration:.16s}
      :where(.nav button):not(:disabled):hover{color:#e87868;transform:none}.nav button:active{transform:scale(.96);transition-duration:.16s}.nav{transition:none!important}
      :where(.core-feature,.scene-v2,.record-v2,.voice-card,.plan-library-card,.history-item,.choice-option,.local-audio-item,.clickable-row,.device-state-item,.quick button,.rows .row[onclick],.card[role="button"]):not([aria-disabled="true"]){transition:transform 260ms cubic-bezier(.22,1,.36,1),box-shadow 260ms cubic-bezier(.22,1,.36,1),border-color 220ms ease;will-change:transform,box-shadow}
      @media (hover:hover){:where(.core-feature,.scene-v2,.record-v2,.voice-card,.plan-library-card,.history-item,.choice-option,.local-audio-item,.clickable-row,.device-state-item,.quick button,.rows .row[onclick],.card[role="button"]):not([aria-disabled="true"]):hover{transform:translateY(-8px)!important;box-shadow:12px 16px 30px rgba(107,88,78,.18),-6px -6px 16px rgba(255,255,255,.96)!important;border-color:rgba(255,255,255,.9)}}
      :where(.core-feature,.scene-v2,.record-v2,.voice-card,.plan-library-card,.history-item,.choice-option,.local-audio-item,.clickable-row,.device-state-item,.quick button,.rows .row[onclick],.card[role="button"]):not([aria-disabled="true"]):active{transform:translateY(0) scale(.98)!important;transition-duration:160ms}
      @media (prefers-reduced-motion:reduce){:where(.core-feature,.scene-v2,.record-v2,.voice-card,.plan-library-card,.history-item,.choice-option,.local-audio-item,.clickable-row,.device-state-item,.quick button,.rows .row[onclick],.card[role="button"]){transition-duration:.01ms!important}:where(.core-feature,.scene-v2,.record-v2,.voice-card,.plan-library-card,.history-item,.choice-option,.local-audio-item,.clickable-row,.device-state-item,.quick button,.rows .row[onclick],.card[role="button"]):hover,:where(.core-feature,.scene-v2,.record-v2,.voice-card,.plan-library-card,.history-item,.choice-option,.local-audio-item,.clickable-row,.device-state-item,.quick button,.rows .row[onclick],.card[role="button"]):active{transform:none!important}}
      .call-stepper{grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}.call-step{display:grid;justify-items:center;text-align:center;gap:5px;font-size:10px}.call-step:not(:last-child)::after{left:54%;right:-54%;top:14px}.call-flow-track{width:400%}.call-flow-panel{flex-basis:25%;width:25%}.call-setup-confirm,.call-voice-confirm{width:100%;height:48px;margin-top:14px!important;border-radius:16px}.call-step-stage.is-locked{opacity:.52}#call-generator-stage .phone-generator{display:block;margin-top:0}
      #home .core-feature{border-color:#eee6e1;box-shadow:8px 10px 22px rgba(107,88,78,.13),-5px -5px 14px rgba(255,255,255,.9);transition:transform 220ms cubic-bezier(.22,1,.36,1),box-shadow 220ms cubic-bezier(.22,1,.36,1),border-color 220ms ease}
      #home .core-feature:hover{transform:translateY(-4px);border-color:rgba(255,255,255,.9);box-shadow:12px 16px 30px rgba(107,88,78,.16),-6px -6px 16px rgba(255,255,255,.95)}
      #home .core-feature:active{transform:translateY(0) scale(.98)!important;box-shadow:inset 4px 5px 10px rgba(107,88,78,.1),inset -4px -4px 10px rgba(255,255,255,.9)}
      #home .core-feature:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(141,120,178,.18),8px 10px 22px rgba(107,88,78,.13),-5px -5px 14px rgba(255,255,255,.9)}
      #home .core-feature .core-icon{transition:transform 220ms cubic-bezier(.22,1,.36,1)}
      #home .core-feature:hover .core-icon{transform:scale(1.04)}
      #home .core-feature:active .core-icon{transform:scale(.96)}
      #home .core-feature:disabled{opacity:.52;pointer-events:none}
      #home .core-feature.my-plans{height:152px}
      @media(prefers-reduced-motion:reduce){.workshop-intro,.workshop-reveal,.workshop-reveal.revealed,.result-ready,.generate-spark,.mini-wave i,.plan-soft-wave i,.plan-skeleton-block{animation:none!important;opacity:1!important;transform:none!important}:where(button,.clickable-row,.core-feature,.voice-card,.voice-hero,.plan-library-card,.history-item,.choice-option,.local-audio-item){transition-duration:.01ms!important}:where(button,.clickable-row,.core-feature,.voice-card,.voice-hero,.plan-library-card,.history-item,.choice-option,.local-audio-item):hover,:where(button,.clickable-row,.core-feature,.voice-card,.voice-hero,.plan-library-card,.history-item,.choice-option,.local-audio-item):active{transform:none!important}#voice-workshop .voice-swipe-card::after,#voice-workshop .voice-swipe-card .play,#voice-workshop .voice-swipe-card .voice-generate-action{transition-duration:.01ms!important}}
    `;
    document.head.appendChild(style);
  }

  function notice(message) {
    let node = document.getElementById('api-toast');
    if (!node) {
      node = document.createElement('div');
      node.id = 'api-toast';
      node.style.cssText = 'position:fixed;z-index:99;left:50%;bottom:104px;max-width:310px;transform:translateX(-50%);padding:11px 15px;border-radius:16px;background:#51433e;color:#fffaf5;font-size:13px;line-height:1.5;text-align:center;box-shadow:0 10px 26px #51433e33;opacity:0;transition:opacity .2s;pointer-events:none';
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.style.opacity = '1';
    clearTimeout(window.__apiToastTimer);
    window.__apiToastTimer = setTimeout(() => { node.style.opacity = '0'; }, 3200);
  }

  function openChoices(title, options, current, onChoose) {
    document.querySelector('.choice-mask')?.remove();
    const mask = document.createElement('div');
    mask.className = 'choice-mask';
    mask.innerHTML = `<div class="choice-sheet"><div class="choice-head"><span>${title}</span><button class="choice-close" aria-label="关闭">×</button></div><div class="choice-options"></div></div>`;
    const list = mask.querySelector('.choice-options');
    options.forEach((option) => {
      const button = document.createElement('button');
      button.className = `choice-option${option === current ? ' selected' : ''}`;
      button.textContent = option;
      button.onclick = () => { onChoose(option); mask.remove(); };
      list.appendChild(button);
    });
    mask.querySelector('.choice-close').onclick = () => mask.remove();
    mask.onclick = (event) => { if (event.target === mask) mask.remove(); };
    document.querySelector('.phone').appendChild(mask);
  }

  function openCustomInlineEditor(row, type) {
    document.querySelector('.custom-inline-editor')?.remove();
    const editor = document.createElement('div');
    editor.className = 'custom-inline-editor';
    const label = type === 'scene' ? '场景名称' : '来电人名称';
    editor.innerHTML = `<input type="text" maxlength="20" placeholder="输入${label}"><button type="button">保存</button>`;
    row.insertAdjacentElement('afterend', editor);
    const input = editor.querySelector('input');
    const save = () => {
      const value = input.value.trim();
      if (!value) return notice(`请输入${label}`);
      if (type === 'scene') {
        if (!customScenes.includes(value)) customScenes.push(value);
        selections.scene = value;
        try { localStorage.setItem('jinchan-custom-scenes', JSON.stringify(customScenes)); } catch (_) {}
      } else {
        if (!customCallers.includes(value)) customCallers.push(value);
        selections.caller = value;
        try { localStorage.setItem('jinchan-custom-callers', JSON.stringify(customCallers)); } catch (_) {}
      }
      editor.remove();
      updateWorkshopValues();
      invalidateAfterSetupChange();
      notice(`${label}已保存`);
    };
    editor.querySelector('button').onclick = save;
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') save(); });
    input.focus();
  }

  function prepareWorkshopVisuals() {
    const quickEntries = document.querySelector('#home .quick');
    if (quickEntries) {
      const heading = quickEntries.previousElementSibling;
      if (heading?.tagName === 'H2' && heading.textContent.trim() === '快捷入口') heading.remove();
      quickEntries.remove();
    }
    const entry = document.querySelector('#home .hint');
    entry?.remove();
    prepareHomeAndAccount();
    const workshop = document.getElementById('workshop');
    if (workshop) {
      const title = workshop.querySelector('h1');
      const subtitle = workshop.querySelector(':scope > .sub');
      if (title) title.textContent = '来电工坊';
      if (subtitle) subtitle.textContent = '按顺序完成话术、声音和电话语音';
    }
    const core = document.querySelector('#home .core-features');
    if (core) {
      if (!core.previousElementSibling?.classList.contains('core-function-sub')) {
        core.insertAdjacentHTML('beforebegin', '<h2 class="core-function-heading">核心功能</h2>');
      }
      const coreHeading = core.parentElement?.querySelector('.core-function-heading');
      if (coreHeading) coreHeading.textContent = '来电工坊';
      let coreSub = core.parentElement?.querySelector('.core-function-sub');
      if (!coreSub) {
        coreSub = document.createElement('div');
        coreSub.className = 'core-function-sub';
        coreHeading?.insertAdjacentElement('afterend', coreSub);
      }
      coreSub.textContent = '编写话术、选择声音并生成来电语音';
      const cards = [...core.querySelectorAll('.core-feature')];
      const copyIcon = `<div class="core-icon"><svg viewBox="0 0 48 48"><path d="M6 9q0-5 6-5h20q6 0 6 5v13q0 5-6 5H22l-8 8v-8h-2q-6 0-6-5Z" fill="#fff1d7"/><circle cx="18" cy="16" r="2" fill="#51433e" stroke="none"/><circle cx="27" cy="16" r="2" fill="#51433e" stroke="none"/><path d="M18 22q4 3 8 0M32 32q5-5 10 0M34 35v4m6-4v4" stroke="#e87868"/><path d="m40 7 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" fill="#dcc9ed" stroke="none"/></svg></div>`;
      const voiceIcon = `<div class="core-icon"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="15" fill="#f2eef7"/><path d="M9 25q0-16 15-16t15 16M8 25v8q0 5 5 5h4V23h-4q-5 0-5 5m32-3v8q0 5-5 5h-4V23h4q5 0 5 5" fill="#dcc9ed"/><path d="M18 25v4m6-8v12m6-9v6" stroke="#668fba"/><path d="m39 6 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" fill="#fff1d7" stroke="none"/></svg></div>`;
      const planIcon = `<div class="core-icon"><svg viewBox="0 0 48 48"><path d="M5 14q0-5 5-5h10l4 5h14q5 0 5 5v18q0 5-5 5H10q-5 0-5-5Z" fill="#fff1d7"/><rect x="11" y="19" width="15" height="13" rx="5" fill="#fff0eb"/><path d="M14 24h8m-8 4h5" stroke="#e87868"/><rect x="25" y="23" width="13" height="12" rx="5" fill="#f2eef7"/><path d="M29 29v2m4-5v7m4-4v2" stroke="#668fba"/></svg></div>`;
      if (cards[0]) {
        cards[0].classList.remove('my-plans');
        cards[0].innerHTML = `${copyIcon}<div class="core-copy"><strong>来电工坊</strong><small>生成自然来电语音</small></div>`;
        cards[0].onclick = () => window.openDetail?.('workshop');
      }
      if (cards[1]) {
        cards[1].classList.add('my-plans');
      }
      let plans = core.querySelector('.my-plans');
      if (!plans) {
        plans = document.createElement('button');
        plans.type = 'button';
        plans.className = 'core-feature my-plans';
        core.appendChild(plans);
      }
      plans.innerHTML = `${planIcon}<div class="core-copy"><strong>方案工坊</strong><small>播放克隆语音</small></div><span class="core-badge plan-count">0个</span>`;
      plans.onclick = () => openPlanWorkshop();
    }
    const icons = [
      `<div class="workshop-icon peach"><svg viewBox="0 0 32 32"><path d="M4 7q0-3 3-3h13q3 0 3 3v8q0 3-3 3h-7l-5 5v-5H7q-3 0-3-3Z" fill="#fff1d7"/><path d="m24 18 1.2 3.5 3.5 1.2-3.5 1.2L24 27.5l-1.2-3.6-3.5-1.2 3.5-1.2Z" fill="#e87868"/></svg></div>`,
      `<div class="workshop-icon purple"><svg viewBox="0 0 32 32"><circle cx="14" cy="12" r="6" fill="#fff1d7"/><path d="M4 28q1-10 10-10t10 10" fill="#dcc9ed"/><path d="M23 7q6 1 6 6l-4 2-3-3Z" fill="#e87868"/></svg></div>`,
      `<div class="workshop-icon blue"><svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="9" fill="#f2eef7"/><path d="M6 17q0-10 10-10t10 10M6 17v6h5v-8H8q-2 0-2 2m20 0v6h-5v-8h3q2 0 2 2" fill="#dcc9ed"/><path d="M12 17v3m4-7v10m4-8v6" stroke="#668fba"/></svg></div>`
    ];
    document.querySelectorAll('#workshop .rows .row').forEach((row) => {
      if (row.querySelector('b')?.textContent?.trim() === '来电声音') row.remove();
    });
    document.querySelectorAll('#workshop .rows .row').forEach((row, index) => {
      if (!row.querySelector('.workshop-icon')) row.insertAdjacentHTML('afterbegin', icons[index]);
    });

    const generateButton = document.querySelector('#workshop>.primary');
    if (generateButton) generateButton.innerHTML = '<span class="generate-spark">✦</span><span>AI 生成来电话术</span>';

    const hero = document.querySelector('#voice-workshop .voice-hero');
    if (hero) {
      hero.classList.add('workshop-intro');
      hero.innerHTML = `<div class="voice-mascot"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="28" fill="#f2eef7"/><path d="M18 42q0-25 22-25t22 25" stroke="#8d78b2" stroke-width="4" fill="none"/><rect x="13" y="38" width="13" height="22" rx="6" fill="#dcc9ed"/><rect x="54" y="38" width="13" height="22" rx="6" fill="#dcc9ed"/><path d="M30 41v8m10-15v22m10-18v14" stroke="#668fba" stroke-width="4" stroke-linecap="round"/><circle cx="34" cy="28" r="2" fill="#51433e"/><circle cx="46" cy="28" r="2" fill="#51433e"/><path d="M35 31q5 5 10 0" stroke="#51433e" stroke-width="2" fill="none"/><path d="m65 12 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#fff1d7"/></svg></div><b>AI 声音克隆</b><div class="sub" style="margin-top:6px">点击录制或上传已获本人授权的声音</div>`;
      hero.setAttribute('role', 'button');
      hero.setAttribute('tabindex', '0');
      hero.setAttribute('aria-label', '开始 AI 声音克隆');
      hero.onclick = () => window.startClone?.();
      hero.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.startClone?.(); } };
      document.querySelector('#voice-workshop .voice-workshop-actions')?.remove();
    }
    document.querySelector('#voice-workshop .voice-add')?.remove();

    document.querySelectorAll('#voice-workshop .voice-card, #voice-picker .voice-card').forEach((card) => {
      if (card.querySelector('b')?.textContent === '妈妈的声音') card.remove();
    });
    const recommendedCards = [...document.querySelectorAll('#voice-workshop .voice-card')];
    const steadyCard = recommendedCards.find((card) => card.querySelector('b')?.textContent === '沉稳男声');
    if (steadyCard && !recommendedCards.some((card) => card.querySelector('b')?.textContent === '温和长辈男声')) {
      const elderCard = steadyCard.cloneNode(true);
      elderCard.querySelector('b').textContent = '温和长辈男声';
      elderCard.querySelector('.voice-source').textContent = '系统声音 · 慢语速低音高';
      steadyCard.insertAdjacentElement('afterend', elderCard);
    }

    const avatarColors = ['purple', 'peach', 'blue', 'green'];
    document.querySelectorAll('#voice-workshop .voice-card, #voice-picker .voice-card').forEach((card, index) => {
      const avatar = card.querySelector('.ico');
      if (avatar) {
        avatar.className = `ico voice-avatar ${avatarColors[index % avatarColors.length]}`;
        avatar.innerHTML = `<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="12" fill="${index === 0 ? '#f2eef7' : index === 1 ? '#fff1d7' : index === 2 ? '#dceafa' : '#dcebdc'}"/><path d="M8 19q0-11 10-11t10 11"/><path d="M12 18v5m6-10v12m6-9v7" stroke="${index % 2 ? '#e87868' : '#8d78b2'}"/><circle cx="14" cy="12" r="1.3" fill="#51433e" stroke="none"/><circle cx="22" cy="12" r="1.3" fill="#51433e" stroke="none"/></svg>`;
      }
      const play = card.querySelector('.play');
      if (play) play.innerHTML = '<span class="play-glyph">▶</span><span class="mini-wave"><i></i><i></i><i></i><i></i></span>';
      const name = card.querySelector('b')?.textContent;
      const source = card.querySelector('.voice-source');
      if (name === '温柔女声' && source && !source.querySelector('.current-pill')) source.insertAdjacentHTML('beforeend', '<span class="current-pill">当前使用</span>');
    });
    [...document.querySelectorAll('#voice-workshop .voice-card')].forEach(enhanceVoiceGenerateCard);
  }

  function prepareHomeAndAccount() {
    const hero = document.querySelector('#home .hero');
    const oldPill = hero?.querySelector('.pill');
    if (oldPill) {
      oldPill.className = 'hero-device-bar';
      oldPill.innerHTML = `<span class="hero-device-status"><i></i><span>设备已连接</span></span><span class="hero-device-battery"><svg viewBox="0 0 28 16" aria-hidden="true"><rect x="1" y="2" width="22" height="12" rx="4"/><path d="M25 6v4"/><path d="M5 5h13v6H5Z" fill="#a8cda9" stroke="none"/></svg><strong>86%</strong></span>`;
    }
    document.querySelectorAll('#home .rows .row').forEach((row) => {
      if (row.querySelector('b')?.textContent?.trim() === '设备电量') row.remove();
      const label = row.querySelector('b')?.textContent?.trim();
      if (label === '当前网络' || label === '最近同步') {
        const right = row.querySelector('.right');
        if (right) { right.textContent = ''; right.style.display = 'none'; }
      }
    });
    const voiceRow = [...document.querySelectorAll('#me .rows .row')].find((row) => row.querySelector('b')?.textContent?.trim() === '声音工坊');
    if (voiceRow) {
      voiceRow.classList.add('clickable-row');
      voiceRow.setAttribute('role', 'button');
      voiceRow.setAttribute('tabindex', '0');
      voiceRow.querySelector('b').textContent = '方案工坊';
      const right = voiceRow.querySelector('.right');
      if (right) { right.classList.add('my-plan-count'); right.textContent = '0 个　›'; }
      const icon = voiceRow.querySelector('.ico');
      if (icon) icon.innerHTML = `<svg viewBox="0 0 48 48"><path d="M5 14q0-5 5-5h10l4 5h14q5 0 5 5v18q0 5-5 5H10q-5 0-5-5Z" fill="#FFF1D7"/><rect x="11" y="19" width="15" height="13" rx="5" fill="#FFF0EB"/><path d="M14 24h8m-8 4h5" stroke="#E87868"/><rect x="25" y="23" width="13" height="12" rx="5" fill="#F2EEF7"/><path d="M29 29v2m4-5v7m4-4v2" stroke="#668FBA"/></svg>`;
      voiceRow.onclick = () => openPlanWorkshop();
      voiceRow.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPlanWorkshop(); } };
    }
    const contactRow = [...document.querySelectorAll('#me .rows .row')].find((row) => row.querySelector('b')?.textContent?.trim() === '来电联系人');
    if (contactRow) {
      contactRow.classList.add('clickable-row');
      contactRow.setAttribute('role', 'button');
      contactRow.setAttribute('tabindex', '0');
      contactRow.querySelector('b').textContent = '我的 API KEY';
      const right = contactRow.querySelector('.right');
      if (right) right.textContent = '可选配置　›';
      contactRow.onclick = () => showApiKeyDialog();
      contactRow.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showApiKeyDialog(); } };
    }
    const permissionRow = [...document.querySelectorAll('#me .rows .row')].find((row) => row.querySelector('b')?.textContent?.trim() === '隐私与权限');
    if (permissionRow) {
      permissionRow.classList.add('clickable-row');
      permissionRow.setAttribute('role', 'button');
      permissionRow.setAttribute('tabindex', '0');
      permissionRow.onclick = () => showPermissionDialog();
      permissionRow.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showPermissionDialog(); } };
      try {
        if (localStorage.getItem('jinchan-permissions-confirmed') === '1' && permissionRow.querySelector('.right')) {
          permissionRow.querySelector('.right').textContent = '已授权　›';
          permissionRow.querySelector('.right').style.color = '#68a17a';
        }
      } catch (_) {}
    }
    const reconnectRow = [...document.querySelectorAll('#me .rows .row')].find((row) => row.querySelector('b')?.textContent?.trim() === '重新连接设备');
    if (reconnectRow) {
      reconnectRow.classList.add('clickable-row');
      reconnectRow.setAttribute('role', 'button');
      reconnectRow.setAttribute('tabindex', '0');
      const reconnect = () => {
        const right = reconnectRow.querySelector('.right');
        if (!right || reconnectRow.dataset.reconnecting === 'true') return;
        reconnectRow.dataset.reconnecting = 'true';
        right.textContent = '连接中…';
        right.style.color = '#8d78b2';
        setTimeout(() => {
          right.textContent = '连接成功　›';
          right.style.color = '#68a17a';
          reconnectRow.dataset.reconnecting = 'false';
          notice('设备已重新连接');
        }, 1000);
      };
      reconnectRow.onclick = reconnect;
      reconnectRow.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); reconnect(); } };
    }
  }

  function showApiKeyDialog() {
    let mask = document.querySelector('.api-key-mask');
    if (!mask) {
      mask = document.createElement('div');
      mask.className = 'permission-mask api-key-mask';
      mask.innerHTML = `<section class="permission-sheet" role="dialog" aria-modal="true" aria-labelledby="api-key-title"><div class="permission-head"><h2 id="api-key-title">我的 API KEY</h2><button class="permission-close" type="button" aria-label="关闭">×</button></div><p class="permission-copy">不填写时使用后端环境变量中的 Key；填写后仅用于当前浏览器发起的对应 AI 请求，不写入项目数据库。</p><label class="api-key-label">DeepSeek API Key<input id="deepseek-api-key" type="password" autocomplete="off" placeholder="留空使用环境变量"></label><label class="api-key-label">MiniMax API Key<input id="minimax-api-key" type="password" autocomplete="off" placeholder="留空使用环境变量"></label><button class="permission-authorize api-key-save" type="button">保存 API KEY</button><button class="api-key-clear" type="button">清除本机 Key，恢复使用环境变量</button></section>`;
      document.querySelector('.phone').appendChild(mask);
      const close = () => mask.classList.remove('show');
      mask.querySelector('.permission-close').onclick = close;
      mask.onclick = (event) => { if (event.target === mask) close(); };
      mask.querySelector('.api-key-save').onclick = () => {
        try {
          const deepseek = mask.querySelector('#deepseek-api-key').value.trim();
          const minimax = mask.querySelector('#minimax-api-key').value.trim();
          deepseek ? localStorage.setItem('jinchan-deepseek-api-key', deepseek) : localStorage.removeItem('jinchan-deepseek-api-key');
          minimax ? localStorage.setItem('jinchan-minimax-api-key', minimax) : localStorage.removeItem('jinchan-minimax-api-key');
          close();
          notice('API KEY 已保存到当前浏览器');
        } catch (_) { notice('当前浏览器无法保存 API KEY'); }
      };
      mask.querySelector('.api-key-clear').onclick = () => {
        try { localStorage.removeItem('jinchan-deepseek-api-key'); localStorage.removeItem('jinchan-minimax-api-key'); } catch (_) {}
        mask.querySelector('#deepseek-api-key').value = '';
        mask.querySelector('#minimax-api-key').value = '';
        notice('已恢复使用环境变量中的 API KEY');
      };
    }
    try {
      mask.querySelector('#deepseek-api-key').value = localStorage.getItem('jinchan-deepseek-api-key') || '';
      mask.querySelector('#minimax-api-key').value = localStorage.getItem('jinchan-minimax-api-key') || '';
    } catch (_) {}
    mask.classList.add('show');
    mask.querySelector('#deepseek-api-key')?.focus();
  }

  function showPermissionDialog() {
    let mask = document.querySelector('.permission-mask');
    if (!mask) {
      mask = document.createElement('div');
      mask.className = 'permission-mask';
      mask.innerHTML = `<section class="permission-sheet" role="dialog" aria-modal="true" aria-labelledby="permission-title"><div class="permission-head"><h2 id="permission-title">隐私与权限</h2><button class="permission-close" type="button" aria-label="关闭">×</button></div><p class="permission-copy">金婵只在对应功能使用时申请权限，你可以随时在手机系统设置中关闭。</p><div class="permission-list"><div class="permission-item"><span class="permission-icon">🎙</span><div><b>麦克风</b><small>录制本人授权的声音，用于声音克隆</small></div><span class="permission-kind">使用时申请</span></div><div class="permission-item"><span class="permission-icon">♫</span><div><b>音频文件</b><small>选择已有录音作为参考文件</small></div><span class="permission-kind">可选</span></div><div class="permission-item"><span class="permission-icon">⌁</span><div><b>蓝牙与附近设备</b><small>连接金婵陪伴玩偶</small></div><span class="permission-kind">连接时申请</span></div><div class="permission-item"><span class="permission-icon">●</span><div><b>通知</b><small>提醒声音生成完成和设备状态变化</small></div><span class="permission-kind">可选</span></div><div class="permission-item"><span class="permission-icon">♧</span><div><b>联系人</b><small>帮助你选择来电人，仅按你的操作使用</small></div><span class="permission-kind">可选</span></div></div><button class="permission-authorize" type="button">一键授权</button></section>`;
      document.querySelector('.phone').appendChild(mask);
      const close = () => mask.classList.remove('show');
      mask.querySelector('.permission-close').onclick = close;
      mask.onclick = (event) => { if (event.target === mask) close(); };
      mask.querySelector('.permission-authorize').onclick = () => {
        try { localStorage.setItem('jinchan-permissions-confirmed', '1'); } catch (_) {}
        const row = [...document.querySelectorAll('#me .rows .row')].find((item) => item.querySelector('b')?.textContent?.trim() === '隐私与权限');
        if (row?.querySelector('.right')) { row.querySelector('.right').textContent = '已授权　›'; row.querySelector('.right').style.color = '#68a17a'; }
        close();
        notice('授权设置已保存，可在手机系统设置中调整');
      };
    }
    mask.classList.add('show');
    mask.querySelector('.permission-close')?.focus();
  }

  function enhanceVoiceGenerateCard(card) {
    const name = card?.querySelector('b')?.textContent?.trim();
    if (!name || card.getAttribute('aria-disabled') === 'true') return;
    card.classList.add('voice-swipe-card');
    card.tabIndex = 0;
    const play = card.querySelector('.play');
    if (play) play.setAttribute('aria-label', `试听${name}`);
    let generate = card.querySelector('.voice-generate-action');
    if (!generate) {
      generate = document.createElement('button');
      generate.type = 'button';
      generate.className = 'voice-generate-action';
      generate.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5q5-4 10 0M8 7v4m8-4v4M6 17q6-5 12 0"/><path d="M5 12h14q2 0 2 2v4q0 2-2 2H5q-2 0-2-2v-4q0-2 2-2Z"/></svg><span>生成语音</span>`;
      card.appendChild(generate);
    }
    generate.setAttribute('aria-label', `使用${name}生成电话语音`);
    generate.onclick = (event) => {
      event.stopPropagation();
      voiceWorkshopVoiceName = name;
      selectVoice(name);
      updateVoiceGenerator();
      showVoiceGenerator(generate);
    };
    if (!card.hasAttribute('data-cloned-voice')) {
      card.classList.add('voice-fixed-actions');
      const avatar = card.querySelector('.voice-avatar, .ico');
      if (avatar && !avatar.dataset.previewBound) {
        avatar.dataset.previewBound = 'true';
        avatar.setAttribute('role', 'button');
        avatar.setAttribute('tabindex', '0');
        avatar.setAttribute('aria-label', `试听${name}`);
        const preview = () => {
          selectVoice(name);
          generateVoice(play, name);
        };
        avatar.onclick = (event) => { event.stopPropagation(); preview(); };
        avatar.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); preview(); } };
      }
    }
  }

  function revealWorkshopGroup(cards) {
    cards = cards.filter((card) => card && !card.dataset.revealBound);
    if (!cards.length) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !('IntersectionObserver' in window)) {
      cards.forEach((card) => {
        card.dataset.revealBound = 'true';
        card.classList.add('workshop-reveal', 'revealed');
      });
      return;
    }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('revealed');
      observer.unobserve(entry.target);
    }), {threshold: .2});
    cards.forEach((card, index) => {
      card.dataset.revealBound = 'true';
      card.classList.add('workshop-reveal');
      card.style.setProperty('--reveal-delay', `${Math.min(index * .1, .3)}s`);
      observer.observe(card);
    });
  }

  function setupWorkshopReveal() {
    revealWorkshopGroup([...document.querySelectorAll('#home .core-feature')]);
    revealWorkshopGroup([document.querySelector('#workshop .rows')]);
    revealWorkshopGroup([...document.querySelectorAll('#voice-workshop .voice-card')]);
  }

  function setupDetailNavigation() {
    const originalOpenDetail = window.openDetail;
    const originalCloseDetail = window.closeDetail;
    window.openDetail = (id) => {
      originalOpenDetail?.(id);
      const hideNavigation = id !== 'voice-workshop';
      document.querySelector('.nav')?.classList.toggle('nav-hidden', hideNavigation);
      document.body.classList.toggle('detail-nav-hidden', hideNavigation);
      if (id === 'voice-workshop') {
        const hero = document.querySelector('#voice-workshop .voice-hero');
        hero?.classList.remove('workshop-intro');
        if (hero) void hero.offsetWidth;
        hero?.classList.add('workshop-intro');
      }
      if (id === 'workshop') {
        const generateButton = document.getElementById('ai-generate-copy-button');
        if (generateButton) generateButton.innerHTML = '<span class="generate-spark">✦</span><span>AI 生成来电话术</span>';
        resetCallWorkshopFlow();
      }
    };
    window.closeDetail = () => {
      if (cloneRecorder?.state === 'recording') cloneRecorder.stop();
      stopRecordingResources();
      stopPlanLibraryAudio(true);
      originalCloseDetail?.();
      document.querySelector('.nav')?.classList.remove('nav-hidden');
      document.body.classList.remove('detail-nav-hidden');
    };
  }

  function ensureWorkshopResult() {
    let result = document.getElementById('ai-copy-result');
    if (!result) {
      result = document.createElement('div');
      result.id = 'ai-copy-result';
      result.className = 'card';
      document.querySelector('#workshop .primary')?.insertAdjacentElement('afterend', result);
    }
    return result;
  }

  function ensureVoiceButton() {
    let button = document.getElementById('generate-voice-button');
    if (!button) {
      button = document.createElement('button');
      button.id = 'generate-voice-button';
      button.className = 'primary secondary-action';
      button.textContent = '确认话术，进入下一步';
      ensureWorkshopResult().insertAdjacentElement('afterend', button);
    }
    return button;
  }

  function ensurePlanWorkshopModal() {
    let mask = document.querySelector('.plan-workshop-mask');
    if (mask) return mask;
    mask = document.createElement('div');
    mask.className = 'plan-workshop-mask';
    mask.innerHTML = `<section class="plan-workshop-dialog" role="dialog" aria-modal="true" aria-label="方案工坊"><div class="plan-workshop-head"><h2>方案工坊</h2><button class="plan-workshop-close" type="button" aria-label="关闭">×</button></div><div class="plan-workshop-sub sub">为当前话术和电话语音命名，保存后可直接复用。</div><div class="plan-workshop-body"></div></section>`;
    const close = () => mask.classList.remove('show');
    mask.querySelector('.plan-workshop-close').onclick = close;
    mask.onclick = (event) => { if (event.target === mask) close(); };
    document.querySelector('.phone').appendChild(mask);
    return mask;
  }

  function openPlanWorkshop() {
    ensurePlanLibraryPage();
    window.openDetail?.('plan-workshop');
    loadPlanLibrary();
  }

  function ensurePlanLibraryPage() {
    let page = document.getElementById('plan-workshop');
    if (page) return page;
    page = document.createElement('section');
    page.id = 'plan-workshop';
    page.className = 'detail';
    page.innerHTML = `<button class="back" type="button" aria-label="返回">‹</button><h1>方案工坊</h1><div class="sub">已生成的来电语音方案</div><div class="plan-library-list" aria-live="polite"></div>`;
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'plan-add-button';
    addButton.textContent = '新增方案';
    addButton.onclick = () => {
      window.closeDetail?.();
      window.openDetail?.('workshop');
      resetCallWorkshopFlow();
    };
    page.querySelector('.sub').insertAdjacentElement('afterend', addButton);
    page.querySelector('.back').onclick = () => window.closeDetail?.();
    document.querySelector('.phone').appendChild(page);
    return page;
  }

  function planAvatar(index) {
    const tone = ['purple', 'blue', 'green', ''][index % 4];
    return `<div class="plan-owner-avatar ${tone}"><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="17" r="9" fill="#fff1d7"/><path d="M8 39q1-15 14-15t14 15" fill="#dcc9ed"/><circle cx="19" cy="17" r="1.4" fill="#51433e" stroke="none"/><circle cx="25" cy="17" r="1.4" fill="#51433e" stroke="none"/><path d="M19 21q3 2.5 6 0"/><path d="M33 9q6 1 7 6l-4 2-3-3Z" fill="#e87868"/></svg></div>`;
  }

  function formatPlanTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const whole = Math.floor(seconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  function stopPlanLibraryAudio(reset = true) {
    if (!planLibraryAudio) return;
    planLibraryAudio.pause();
    if (reset) planLibraryAudio.currentTime = 0;
    planLibraryCard?.classList.remove('playing');
    if (reset && planLibraryCard) {
      planLibraryCard.querySelector('.plan-progress').value = 0;
      planLibraryCard.querySelector('.plan-current').textContent = '0:00';
    }
    if (reset) {
      planLibraryAudio = null;
      planLibraryCard = null;
    }
  }

  function bindPlanPlayer(card, item) {
    const button = card.querySelector('.plan-play');
    const progress = card.querySelector('.plan-progress');
    const current = card.querySelector('.plan-current');
    const total = card.querySelector('.plan-total');
    const audio = new Audio(item.audio_url);
    audio.preload = 'metadata';
    total.textContent = formatPlanTime((item.duration_ms || 0) / 1000);
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration)) total.textContent = formatPlanTime(audio.duration);
    });
    audio.addEventListener('timeupdate', () => {
      if (planLibraryAudio !== audio) return;
      current.textContent = formatPlanTime(audio.currentTime);
      progress.value = audio.duration ? Math.round((audio.currentTime / audio.duration) * 1000) : 0;
    });
    audio.addEventListener('ended', () => stopPlanLibraryAudio(true));
    audio.addEventListener('error', () => {
      card.classList.remove('playing');
      notice('这条电话语音暂时无法播放');
    });
    button.onclick = async () => {
      if (planLibraryAudio === audio && !audio.paused) {
        audio.pause();
        card.classList.remove('playing');
        return;
      }
      if (planLibraryAudio && planLibraryAudio !== audio) stopPlanLibraryAudio(true);
      planLibraryAudio = audio;
      planLibraryCard = card;
      try {
        await audio.play();
        card.classList.add('playing');
      } catch (_) {
        card.classList.remove('playing');
        notice('浏览器未允许播放，请再次点击播放');
      }
    };
    progress.oninput = () => {
      if (!Number.isFinite(audio.duration)) return;
      audio.currentTime = (Number(progress.value) / 1000) * audio.duration;
      current.textContent = formatPlanTime(audio.currentTime);
    };
  }

  function renderPlanSkeleton(list) {
    list.innerHTML = [0, 1].map(() => `<article class="plan-library-card plan-library-skeleton"><div class="plan-skeleton-head"><i class="plan-skeleton-block plan-skeleton-avatar"></i><i class="plan-skeleton-block plan-skeleton-name"></i></div><div class="plan-skeleton-lines"><i class="plan-skeleton-block"></i><i class="plan-skeleton-block"></i><i class="plan-skeleton-block"></i><i class="plan-skeleton-block"></i></div><i class="plan-skeleton-block plan-skeleton-player"></i></article>`).join('');
  }

  function renderPlanLibrary(items) {
    const page = ensurePlanLibraryPage();
    const list = page.querySelector('.plan-library-list');
    const addButton = page.querySelector('.plan-add-button');
    if (addButton) addButton.hidden = !items.length;
    stopPlanLibraryAudio(true);
    if (!items.length) {
      list.innerHTML = `<section class="plan-library-empty"><div class="plan-empty-mascot"><svg viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="31" fill="#f2eef7"/><path d="M20 44q0-23 22-23t22 23M19 44v13q0 7 7 7h8V40h-8q-7 0-7 7m46-3v13q0 7-7 7h-8V40h8q7 0 7 7" fill="#dcc9ed" stroke="#51433e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M34 43v8m8-15v22m8-18v15" stroke="#668fba" stroke-width="4" stroke-linecap="round"/><circle cx="38" cy="31" r="2" fill="#51433e"/><circle cx="46" cy="31" r="2" fill="#51433e"/><path d="M38 34q4 4 8 0" fill="none" stroke="#51433e" stroke-width="2" stroke-linecap="round"/><path d="m68 14 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#fff1d7"/></svg></div><h2>还没有来电语音方案</h2><p>前往来电工坊，选择话术和声音生成第一条电话语音</p><button class="plan-empty-go" type="button">前往来电工坊</button></section>`;
      list.querySelector('.plan-empty-go').onclick = () => {
        window.closeDetail?.();
        window.openDetail?.('workshop');
      };
      return;
    }
    list.innerHTML = items.map((item, index) => `<article class="plan-library-card" data-plan-id="${item.id}"><div class="plan-owner">${planAvatar(index)}<div><div class="plan-owner-name">${escapeHtml(item.voice_name || item.owner_name)}</div><div class="plan-context"><span>声音 · ${escapeHtml(item.voice_name || item.owner_name)}</span><span>场景 · ${escapeHtml(item.scene_type || '自定义场景')}</span></div></div></div><div class="plan-full-text">${escapeHtml(item.text)}</div><div class="plan-player"><button class="plan-play" type="button" aria-label="播放或暂停"><svg class="play-icon" viewBox="0 0 20 20"><path d="M6 3.5 16 10 6 16.5Z"/></svg><svg class="pause-icon" viewBox="0 0 20 20"><path d="M5 4h3.5v12H5zm6.5 0H15v12h-3.5z"/></svg></button><div class="plan-player-main"><input class="plan-progress" type="range" min="0" max="1000" value="0" aria-label="播放进度"><div class="plan-player-meta"><span><span class="plan-current">0:00</span> / <span class="plan-total">${formatPlanTime((item.duration_ms || 0) / 1000)}</span></span><span class="plan-soft-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div></div></div></article>`).join('');
    [...list.querySelectorAll('.plan-library-card')].forEach((card, index) => {
      const item = items[index];
      const title = card.querySelector('.plan-owner-name');
      if (title) title.textContent = item.plan_name || item.name || `${item.scene || '来电'} · ${item.contact || '联系人'}`;
      const context = card.querySelector('.plan-context');
      if (context) {
        context.innerHTML = `<span>场景 · ${escapeHtml(item.scene || item.scene_type || '自定义场景')}</span><span>联系人 · ${escapeHtml(item.contact || item.contact_name || '联系人')}</span><span>声音 · ${escapeHtml(item.voiceName || item.voice_name || item.owner_name)}</span>`;
      }
      const actions = document.createElement('div');
      actions.className = 'plan-card-actions';
      actions.innerHTML = '<button class="plan-use" type="button">使用方案</button><button class="plan-delete" type="button">删除</button>';
      card.appendChild(actions);
      actions.querySelector('.plan-use').onclick = () => {
        activateGeneratedPlan(item);
        renderPlanLibrary(items);
      };
      actions.querySelector('.plan-delete').onclick = async () => {
        if (!confirm(`确定删除“${item.plan_name || item.name || '这条方案'}”及其本地电话音频吗？`)) return;
        await deleteGeneratedPlan(item.id, item.audioId);
        notice('方案已删除');
      };
      if (localStorage.getItem('jinchan-active-plan-id') === item.id) {
        card.classList.add('is-active-plan');
        actions.querySelector('.plan-use').textContent = '当前方案';
      }
      bindPlanPlayer(card, item);
    });
  }

  async function loadPlanLibrary() {
    const list = ensurePlanLibraryPage().querySelector('.plan-library-list');
    let settled = false;
    const skeletonTimer = setTimeout(() => { if (!settled) renderPlanSkeleton(list); }, 280);
    try {
      const items = await getLocalPlanItems();
      settled = true;
      clearTimeout(skeletonTimer);
      renderPlanLibrary(items);
      updateHomePlanCount(items.length);
    } catch (error) {
      settled = true;
      clearTimeout(skeletonTimer);
      list.innerHTML = `<div class="plan-library-error">方案暂时没有加载成功<br><button type="button">重新加载</button></div>`;
      list.querySelector('button').onclick = loadPlanLibrary;
    }
  }

  function showVoiceGenerator(button) {
    const page = ensurePhoneGeneratorPage();
    const panel = ensureVoiceGenerator();
    page.querySelector('.phone-generator-host').appendChild(panel);
    panel.classList.add('open');
    button?.setAttribute('aria-expanded', 'true');
    window.openDetail?.('phone-voice-generator');
    page.scrollTop = 0;
  }

  function ensurePhoneGeneratorPage() {
    let page = document.getElementById('phone-voice-generator');
    if (page) return page;
    page = document.createElement('section');
    page.id = 'phone-voice-generator';
    page.className = 'detail';
    page.innerHTML = `<button class="back" type="button" aria-label="返回">‹</button><h1>电话语音</h1><div class="sub">组合已保存的话术与克隆音色</div><div class="phone-generator-host"></div>`;
    page.querySelector('.back').onclick = () => window.closeDetail?.();
    document.querySelector('.phone').appendChild(page);
    return page;
  }

  function updatePlanSaveState() {
    const panel = document.getElementById('plan-save-panel');
    if (!panel) return;
    const status = panel.querySelector('.plan-audio-status');
    const saveButton = panel.querySelector('.plan-save-button');
    saveButton.disabled = !lastVoiceFileId;
    status.textContent = lastVoiceFileId
      ? `电话语音已生成 · ${selections.voiceName} · 可保存并重复使用`
      : `当前音色：${selections.voiceName}。请先生成并试听电话语音。`;
    panel.querySelector('.plan-saved-note').textContent = savedPlanId ? '✓ 方案已保存到本地数据库' : '';
  }

  function invalidateGeneratedVoice() {
    lastVoiceFileId = null;
    lastLocalAudioId = null;
    savedPlanId = null;
    updatePlanSaveState();
  }

  async function resolvePlanUserId() {
    const users = await request('/api/users');
    if (users[0]) return users[0].id;
    const user = await request('/api/users', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: '默认用户'})
    });
    return user.id;
  }

  function updateHomePlanCount(count) {
    const badge = document.querySelector('#home .my-plans .plan-count');
    if (badge) badge.textContent = `${count}个`;
    const myCount = document.querySelector('#me .my-plan-count');
    if (myCount) myCount.textContent = `${count} 个　›`;
  }

  async function loadPlanCount() {
    try {
      const plans = await getLocalPlanItems();
      updateHomePlanCount(plans.length);
    } catch (_) {
      updateHomePlanCount(0);
    }
  }

  async function saveCurrentPlan(button) {
    if (!lastLocalAudioId) return notice('请先生成并试听电话语音再保存方案');
    const panel = document.getElementById('plan-save-panel');
    const input = panel.querySelector('.plan-name-input');
    const name = input.value.trim() || `${selections.scene} · ${selections.caller}`;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '正在保存…';
    try {
      const plans = readLocalPlans();
      const localSaved = {id: savedPlanId || `plan_${Date.now()}`, name, scene: selections.scene, contact: selections.caller, voiceName: selections.voiceName, voiceId: voiceProfiles[selections.voiceName]?.voiceId || '', text: lastCopy, audioId: lastLocalAudioId, createdAt: new Date().toISOString()};
      writeLocalPlans(savedPlanId ? plans.map((item) => item.id === savedPlanId ? localSaved : item) : [localSaved, ...plans]);
      savedPlanId = localSaved.id;
      input.value = name;
      updatePlanSaveState();
      await loadPlanCount();
      await loadPlanLibrary();
      notice('电话语音已保存到方案工坊');
      return;
      const payload = {
        name,
        scene_type: selections.scene,
        contact_role: selections.caller,
        reason: lastCopy,
        voice_file_id: lastVoiceFileId
      };
      let saved;
      if (savedPlanId) {
        saved = await request(`/api/scene-plan/${savedPlanId}`, {
          method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
        });
      } else {
        payload.user_id = await resolvePlanUserId();
        saved = await request('/api/scene-plan', {
          method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
        });
      }
      savedPlanId = saved.id;
      input.value = saved.name;
      updatePlanSaveState();
      await loadPlanCount();
      notice('AI 来电语音已保存到方案，可直接重复使用');
    } catch (error) {
      notice(`方案保存失败：${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = original;
      updatePlanSaveState();
    }
  }

  function ensurePlanSaver() {
    let panel = document.getElementById('plan-save-panel');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'plan-save-panel';
    panel.className = 'plan-save-panel';
    panel.innerHTML = `<label for="plan-name-input">方案名称</label><input id="plan-name-input" class="plan-name-input" maxlength="50" placeholder="例如：聚餐离场方案"><div class="plan-audio-status"></div><button class="plan-save-button" type="button" disabled>保存为来电方案</button><div class="plan-saved-note"></div>`;
    ensurePlanWorkshopModal().querySelector('.plan-workshop-body').appendChild(panel);
    panel.querySelector('.plan-save-button').addEventListener('click', (event) => saveCurrentPlan(event.currentTarget));
    updatePlanSaveState();
    return panel;
  }

  function ensureCallWorkshopFlow() {
    const workshop = document.getElementById('workshop');
    if (!workshop) return;
    let steps = document.getElementById('call-workshop-steps');
    if (!steps) {
      steps = document.createElement('div');
      steps.id = 'call-workshop-steps';
      steps.className = 'call-stepper';
      steps.setAttribute('aria-label', '来电工坊完成进度');
      steps.innerHTML = '<div class="call-step active" data-step="1"><span class="call-step-dot">1</span><span>场景与联系人</span></div><div class="call-step" data-step="2"><span class="call-step-dot">2</span><span>话术确认</span></div><div class="call-step" data-step="3"><span class="call-step-dot">3</span><span>声音确认</span></div><div class="call-step" data-step="4"><span class="call-step-dot">4</span><span>生成语音</span></div>';
      workshop.querySelector(':scope > .sub')?.insertAdjacentElement('afterend', steps);
    }
    if (!steps.dataset.navigationBound) {
      steps.dataset.navigationBound = 'true';
      steps.querySelectorAll('.call-step').forEach((step) => {
        const target = Number(step.dataset.step);
        step.setAttribute('role', 'button');
        step.setAttribute('tabindex', '0');
        const navigate = () => showCallWorkshopStep(target);
        step.onclick = navigate;
        step.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(); } };
      });
    }
    let selectionStage = document.getElementById('call-selection-stage');
    if (!selectionStage) {
      selectionStage = document.createElement('section');
      selectionStage.id = 'call-selection-stage';
      selectionStage.className = 'call-step-stage';
      selectionStage.innerHTML = '<div class="call-step-stage-label"><span>1</span>选择场景与联系人</div><p class="call-flow-copy">先确定使用场景和来电联系人，再进入话术生成。</p>';
      const rows = workshop.querySelector(':scope > .rows');
      if (rows) {
        [...rows.querySelectorAll(':scope > .row')].slice(2).forEach((row) => row.remove());
        selectionStage.appendChild(rows);
      }
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'primary call-setup-confirm';
      confirm.textContent = '确认场景与联系人，进入下一步';
      confirm.onclick = () => { callFlowSetupConfirmed = true; updateCallWorkshopFlow(); showCallWorkshopStep(2); };
      selectionStage.appendChild(confirm);
      steps.insertAdjacentElement('afterend', selectionStage);
    }
    let copyStage = document.getElementById('call-copy-stage');
    if (!copyStage) {
      copyStage = document.createElement('section');
      copyStage.id = 'call-copy-stage';
      copyStage.className = 'call-step-stage';
      copyStage.innerHTML = '<div class="call-step-stage-label"><span>2</span>生成并确认话术</div>';
      selectionStage.insertAdjacentElement('afterend', copyStage);
    }
    const copyParts = [
      workshop.querySelector(':scope > .primary:not(#generate-voice-button)'),
      document.getElementById('ai-copy-result'),
      document.getElementById('generate-voice-button'),
      document.getElementById('manual-copy-composer'),
      document.getElementById('excuse-history')
    ];
    copyParts.filter(Boolean).forEach((node) => copyStage.appendChild(node));
    let voiceStep = document.getElementById('call-voice-step');
    if (!voiceStep) {
      voiceStep = document.createElement('section');
      voiceStep.id = 'call-voice-step';
      voiceStep.className = 'call-flow-card';
      voiceStep.innerHTML = '<div class="call-flow-head"><span class="call-flow-number">3</span><div class="call-flow-title">选择并确认来电声音</div></div><div class="call-flow-copy">选择系统音色，或录制本人授权的声音进行克隆。</div><div class="call-flow-selection"><strong>当前声音</strong><span data-call-voice-name>温柔女声</span></div><div class="call-flow-actions"><button class="choose-call-voice" type="button">选择声音</button><button class="clone-call-voice" type="button">克隆新声音</button></div><button class="primary call-voice-confirm" type="button">确认声音，进入下一步</button>';
      voiceStep.querySelector('.choose-call-voice').onclick = () => {
        if (!callFlowCopyConfirmed) return notice('请先完成第 2 步：确认话术');
        const voices = availableWorkshopVoices();
        openChoices('选择来电声音', voices, selections.voiceName, (name) => {
          selectVoice(name);
          voiceWorkshopVoiceName = name;
          callFlowVoiceConfirmed = false;
          callFlowVoiceGenerated = false;
          updateVoiceGenerator();
          updateCallWorkshopFlow();
          notice(`已选择${name}，请确认后进入下一步`);
        });
      };
      voiceStep.querySelector('.clone-call-voice').onclick = () => {
        if (!callFlowCopyConfirmed) return notice('请先完成第 2 步：确认话术');
        window.startClone?.();
      };
      voiceStep.querySelector('.call-voice-confirm').onclick = () => {
        if (!callFlowCopyConfirmed) return notice('请先确认话术');
        const name = voiceWorkshopVoiceName || selections.voiceName;
        if (!name) return notice('请先选择一个声音');
        voiceWorkshopVoiceName = name;
        callFlowVoiceConfirmed = true;
        callFlowVoiceGenerated = false;
        updateVoiceGenerator();
        updateCallWorkshopFlow();
        showCallWorkshopStep(4);
      };
    }
    copyStage.insertAdjacentElement('afterend', voiceStep);
    let generatorStage = document.getElementById('call-generator-stage');
    if (!generatorStage) {
      generatorStage = document.createElement('section');
      generatorStage.id = 'call-generator-stage';
      generatorStage.className = 'call-flow-card call-generator-stage';
      generatorStage.innerHTML = '<div class="call-step-stage-label"><span>4</span>生成、试听并保存</div>';
    }
    voiceStep.insertAdjacentElement('afterend', generatorStage);
    const generator = document.getElementById('voice-phone-generator');
    const localLibrary = document.getElementById('local-audio-library');
    if (generator && generator.parentElement !== generatorStage) generatorStage.appendChild(generator);
    if (localLibrary && localLibrary.parentElement !== generatorStage) generatorStage.appendChild(localLibrary);
    let viewport = document.getElementById('call-flow-viewport');
    let track;
    if (!viewport) {
      viewport = document.createElement('div');
      viewport.id = 'call-flow-viewport';
      viewport.className = 'call-flow-viewport';
      track = document.createElement('div');
      track.id = 'call-flow-track';
      track.className = 'call-flow-track';
      viewport.appendChild(track);
      steps.insertAdjacentElement('afterend', viewport);
      let swipeStartX = null;
      viewport.addEventListener('touchstart', (event) => { swipeStartX = event.touches[0]?.clientX ?? null; }, {passive: true});
      viewport.addEventListener('touchend', (event) => {
        if (swipeStartX == null) return;
        const delta = (event.changedTouches[0]?.clientX ?? swipeStartX) - swipeStartX;
        swipeStartX = null;
        if (Math.abs(delta) < 48) return;
        showCallWorkshopStep(callFlowActiveStep + (delta < 0 ? 1 : -1));
      }, {passive: true});
    } else {
      track = document.getElementById('call-flow-track');
    }
    [selectionStage, copyStage, voiceStep, generatorStage].forEach((panel) => {
      panel.classList.add('call-flow-panel');
      track?.appendChild(panel);
    });
    if (viewport && !viewport.dataset.resizeBound && typeof ResizeObserver !== 'undefined') {
      viewport.dataset.resizeBound = 'true';
      const resizeObserver = new ResizeObserver(() => {
        const activePanel = [...track.children][callFlowActiveStep - 1];
        if (activePanel) viewport.style.height = `${activePanel.scrollHeight}px`;
      });
      [selectionStage, copyStage, voiceStep, generatorStage].forEach((panel) => resizeObserver.observe(panel));
    }
    updateCallWorkshopFlow();
  }

  function showCallWorkshopStep(step) {
    const maxUnlocked = callFlowSetupConfirmed ? (callFlowCopyConfirmed ? (callFlowVoiceConfirmed ? 4 : 3) : 2) : 1;
    const target = Math.max(1, Math.min(Number(step) || 1, maxUnlocked));
    if (target !== Number(step) && Number(step) > maxUnlocked) {
      notice(`请先完成第 ${maxUnlocked} 步`);
    }
    callFlowActiveStep = target;
    const viewport = document.getElementById('call-flow-viewport');
    const track = document.getElementById('call-flow-track');
    const activePanel = [...document.querySelectorAll('#call-flow-track > .call-flow-panel')][target - 1];
    if (track) track.style.transform = `translateX(-${(target - 1) * 25}%)`;
    requestAnimationFrame(() => {
      if (viewport && activePanel) viewport.style.height = `${activePanel.scrollHeight}px`;
    });
  }

  function updateCallWorkshopFlow() {
    const workshop = document.getElementById('workshop');
    if (!workshop) return;
    const steps = [...workshop.querySelectorAll('.call-step')];
    const progress = [callFlowSetupConfirmed, callFlowCopyConfirmed, callFlowVoiceConfirmed, callFlowVoiceGenerated];
    steps.forEach((step, index) => {
      const complete = progress[index];
      const active = !complete && index + 1 === callFlowActiveStep;
      step.classList.toggle('done', complete);
      step.classList.toggle('active', active);
      step.querySelector('.call-step-dot').textContent = complete ? '✓' : String(index + 1);
    });
    const copyStage = document.getElementById('call-copy-stage');
    const voiceStep = document.getElementById('call-voice-step');
    const generatorStage = document.getElementById('call-generator-stage');
    if (copyStage) {
      copyStage.classList.toggle('is-locked', !callFlowSetupConfirmed);
      copyStage.querySelectorAll('input, textarea, button').forEach((control) => { control.disabled = !callFlowSetupConfirmed; });
    }
    if (voiceStep) {
      voiceStep.classList.toggle('is-locked', !callFlowCopyConfirmed);
      voiceStep.querySelector('[data-call-voice-name]').textContent = callFlowCopyConfirmed ? selections.voiceName : '完成话术后可选择';
      voiceStep.querySelectorAll('button').forEach((button) => { button.disabled = !callFlowCopyConfirmed; });
    }
    if (generatorStage) {
      const locked = !(callFlowCopyConfirmed && callFlowVoiceConfirmed);
      generatorStage.hidden = false;
      generatorStage.classList.toggle('is-locked', locked);
      generatorStage.querySelectorAll('input, textarea, button').forEach((control) => { control.disabled = locked; });
    }
    if (!callFlowSetupConfirmed && callFlowActiveStep !== 1) showCallWorkshopStep(1);
    else if (callFlowSetupConfirmed && !callFlowCopyConfirmed && callFlowActiveStep > 2) showCallWorkshopStep(2);
    else if (callFlowCopyConfirmed && !callFlowVoiceConfirmed && callFlowActiveStep > 3) showCallWorkshopStep(3);
    else showCallWorkshopStep(callFlowActiveStep);
  }

  function resetCallWorkshopFlow() {
    callFlowSetupConfirmed = false;
    callFlowCopyConfirmed = false;
    callFlowVoiceConfirmed = false;
    callFlowVoiceGenerated = false;
    callFlowActiveStep = 1;
    updateCallWorkshopFlow();
  }

  function invalidateAfterSetupChange() {
    callFlowSetupConfirmed = false;
    callFlowCopyConfirmed = false;
    callFlowVoiceConfirmed = false;
    callFlowVoiceGenerated = false;
    invalidateGeneratedVoice();
    updateCallWorkshopFlow();
  }

  function invalidateAfterCopyChange() {
    callFlowCopyConfirmed = false;
    callFlowVoiceConfirmed = false;
    callFlowVoiceGenerated = false;
    invalidateGeneratedVoice();
    updateCallWorkshopFlow();
  }

  function updateWorkshopValues() {
    const rows = document.querySelectorAll('#workshop .rows .row');
    if (rows[0]) rows[0].querySelector('.right').textContent = `${selections.scene}　›`;
    if (rows[1]) rows[1].querySelector('.right').textContent = `${selections.caller}　›`;
  }

  function selectVoice(name) {
    selections.voiceName = name;
    selections.voiceId = (voiceProfiles[name] || voiceProfiles['温柔女声']).voiceId;
    invalidateGeneratedVoice();
    updateWorkshopValues();
    document.querySelectorAll('.selected-voice').forEach((node) => { node.textContent = `${name}　›`; });
    const currentVoice = document.querySelector('#home .hero > .sub');
    if (currentVoice) currentVoice.textContent = `当前语音 · ${name}`;
    document.querySelectorAll('.current-pill').forEach((pill) => pill.remove());
    document.querySelectorAll('#voice-workshop .voice-card, #voice-picker .voice-card').forEach((card) => {
      if (card.querySelector('b')?.textContent !== name) return;
      card.querySelector('.voice-source')?.insertAdjacentHTML('beforeend', '<span class="current-pill">当前使用</span>');
    });
  }

  function bindEditors() {
    const rows = document.querySelectorAll('#workshop .rows .row');
    try {
      customScenes = JSON.parse(localStorage.getItem('jinchan-custom-scenes') || '[]').filter(Boolean);
      customCallers = JSON.parse(localStorage.getItem('jinchan-custom-callers') || '[]').filter(Boolean);
    } catch (_) { customScenes = []; customCallers = []; }
    if (rows[0]) rows[0].onclick = () => openChoices('选择使用场景', ['聚餐脱身', '商务离场', '相亲结束', ...customScenes, '自定义场景'], selections.scene, (value) => {
      if (value === '自定义场景') return openCustomInlineEditor(rows[0], 'scene');
      selections.scene = value; updateWorkshopValues(); invalidateAfterSetupChange();
    });
    if (rows[1]) rows[1].onclick = () => openChoices('选择来电人', ['妈妈', '闺蜜', '同事', '家人', ...customCallers, '自定义来电人'], selections.caller, (value) => {
      if (value === '自定义来电人') return openCustomInlineEditor(rows[1], 'caller');
      selections.caller = value; updateWorkshopValues(); invalidateAfterSetupChange();
    });

    const originalChooseVoice = window.chooseVoice;
    window.chooseVoice = (name, element) => {
      originalChooseVoice?.(name, element);
      selectVoice(name);
    };
    updateWorkshopValues();
  }

  function cloneFile() {
    if (cloneUploadedFile) return cloneUploadedFile;
    const type = cloneRecording?.type || 'audio/webm';
    const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    return new File([cloneRecording], `jinchan-voice-${Date.now()}.${extension}`, {type});
  }

  function setCloneDots() {
    document.querySelectorAll('#clone-flow .clone-dot').forEach((dot, index) => dot.classList.toggle('on', index < cloneStep));
  }

  function renderCloneStep() {
    const panel = document.querySelector('#clone-flow .clone-panel');
    const button = document.querySelector('#clone-flow>.primary');
    if (!panel || !button) return;
    setCloneDots();
    button.disabled = false;
    if (cloneStep === 1) {
      panel.innerHTML = '<h2>声音授权</h2><div class="sub">只可录制本人声音，或已获得声音本人明确授权的声音。</div><label class="clone-consent"><input id="clone-consent" type="checkbox"><span>我确认已获得声音本人授权，并同意将本次录音上传至 MiniMax 用于创建克隆音色。</span></label>';
      button.textContent = '同意并继续';
      button.disabled = true;
      panel.querySelector('#clone-consent').onchange = (event) => { button.disabled = !event.target.checked; };
    } else if (cloneStep === 2) {
      panel.innerHTML = `<h2>录制或上传声音</h2><div class="sub">录制 15–30 秒，或上传 10 秒至 5 分钟的 MP3、M4A、WAV 参考录音。</div><div class="record-time" id="clone-elapsed">${cloneRecording ? '参考录音已就绪' : '00:00'}</div><div class="record-level" id="record-level"><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="record-status">${cloneRecording ? '可以试听，满意后进行音质检测' : '建议朗读：今天过得怎么样？有空的话，晚点给我回个电话。'}</div>${cloneRecording ? `<audio class="record-preview" controls src="${URL.createObjectURL(cloneRecording)}"></audio>` : ''}<div class="clone-or">或者</div><label class="clone-upload">选择参考录音<input id="clone-file-input" type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,.mp3,.m4a,.wav"></label>${cloneUploadedFile ? `<div class="clone-file-name">${escapeHtml(cloneUploadedFile.name)}</div>` : ''}`;
      panel.querySelector('#clone-file-input').onchange = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        cloneUploadedFile = file;
        cloneRecording = file;
        renderCloneStep();
      };
      button.textContent = cloneRecording ? '检测录音质量' : '开始录音';
    } else if (cloneStep === 3) {
      panel.innerHTML = `<h2>音质检测通过</h2><div class="sub">录音可用于创建克隆音色，请为它命名。</div><div class="quality-grid"><div class="quality-item"><b>录音时长</b><span>${(cloneQuality.duration_ms / 1000).toFixed(1)} 秒</span></div><div class="quality-item"><b>音频规格</b><span>${cloneQuality.sample_rate / 1000}kHz · 单声道</span></div></div><input class="clone-name" maxlength="30" value="${escapeHtml(cloneVoiceName)}" placeholder="例如：我的声音、妈妈的声音">`;
      panel.querySelector('.clone-name').oninput = (event) => { cloneVoiceName = event.target.value; };
      button.textContent = '开始 AI 克隆';
    } else if (cloneStep === 4) {
      panel.innerHTML = '<h2>AI 正在创建声音</h2><div class="sub">录音已安全上传，请稍候。请不要关闭当前页面。</div><div class="clone-wave"><i></i><i></i><i></i><i></i><i></i></div><div class="record-status">正在提取音色特征并创建专属 voice_id…</div>';
      button.textContent = '正在克隆…';
      button.disabled = true;
    } else {
      panel.innerHTML = `<div class="clone-success">✓</div><h2>声音已保存</h2><div class="sub">“${escapeHtml(cloneVoiceName)}”已加入我的声音，可立即用于话术试听和来电场景。</div>`;
      button.textContent = '完成';
    }
  }

  function stopRecordingResources() {
    clearInterval(cloneTimer);
    cancelAnimationFrame(cloneLevelFrame);
    cloneStream?.getTracks().forEach((track) => track.stop());
    cloneStream = null;
  }

  async function startRealRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('当前浏览器不支持麦克风录音');
    cloneStream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type)) || '';
    cloneChunks = [];
    cloneRecorder = new MediaRecorder(cloneStream, mimeType ? {mimeType} : undefined);
    cloneRecorder.ondataavailable = (event) => { if (event.data.size) cloneChunks.push(event.data); };
    cloneStartedAt = Date.now();
    cloneRecorder.start(250);
    const button = document.querySelector('#clone-flow>.primary');
    button.textContent = '停止录音';

    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    context.createMediaStreamSource(cloneStream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const drawLevel = () => {
      analyser.getByteFrequencyData(data);
      const average = data.reduce((sum, value) => sum + value, 0) / data.length;
      document.querySelectorAll('#record-level i').forEach((bar, index) => { bar.style.height = `${12 + Math.min(42, average * (0.42 + index * .08))}px`; });
      cloneLevelFrame = requestAnimationFrame(drawLevel);
    };
    drawLevel();
    cloneTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - cloneStartedAt) / 1000);
      const elapsed = document.getElementById('clone-elapsed');
      if (elapsed) elapsed.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }, 250);
    cloneRecorder.addEventListener('stop', () => context.close(), {once: true});
  }

  async function stopRealRecording() {
    if (!cloneRecorder || cloneRecorder.state !== 'recording') return;
    await new Promise((resolve) => {
      cloneRecorder.addEventListener('stop', resolve, {once: true});
      cloneRecorder.stop();
    });
    cloneRecording = new Blob(cloneChunks, {type: cloneRecorder.mimeType || 'audio/webm'});
    stopRecordingResources();
    renderCloneStep();
  }

  async function analyzeCloneRecording() {
    const button = document.querySelector('#clone-flow>.primary');
    button.disabled = true;
    button.textContent = '正在检测…';
    const form = new FormData();
    form.append('file', cloneFile());
    const response = await fetch(`${api}/api/ai/voices/analyze`, {method: 'POST', body: form});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || '录音检测失败');
    cloneQuality = data;
    cloneStep = 3;
    renderCloneStep();
  }

  async function createAndSaveClone() {
    const name = cloneVoiceName.trim();
    if (!name) throw new Error('请填写声音名称');
    const savedVoices = await readLocalStore('voices');
    if (savedVoices.length >= MAX_LOCAL_VOICES && !savedVoices.some((voice) => voice.name === name)) {
      throw new Error(`本机最多保存 ${MAX_LOCAL_VOICES} 个真人声音，请删除旧声音后再克隆`);
    }
    cloneStep = 4;
    renderCloneStep();
    const form = new FormData();
    form.append('voice_name', name);
    form.append('consent_confirmed', 'true');
    form.append('preview_text', '你好，我是金婵。以后需要的时候，我会用这个声音给你打来电话。');
    form.append('file', cloneFile());
    const response = await fetch(`${api}/api/ai/voices/clone`, {method: 'POST', headers: userApiHeaders(), body: form});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || '声音克隆失败');
    try { await saveLocalVoice(data); } catch (error) { notice(`声音已克隆，但本机保存失败：${error.message}`); }
    cloneStep = 5;
    renderCloneStep();
    await loadClonedVoices();
    updateLocalStorageSummary();
    selectVoice(name);
    voiceWorkshopVoiceName = name;
    updateVoiceGenerator();
  }

  function setupCloneFlow() {
    window.startClone = () => {
      stopRecordingResources();
      cloneStep = 1;
      cloneRecorder = null;
      cloneRecording = null;
      cloneUploadedFile = null;
      cloneQuality = null;
      cloneVoiceName = '我的声音';
      renderCloneStep();
      window.openDetail('clone-flow');
    };
    window.nextClone = async () => {
      try {
        if (cloneStep === 1) {
          cloneStep = 2;
          renderCloneStep();
        } else if (cloneStep === 2 && cloneRecorder?.state === 'recording') {
          await stopRealRecording();
        } else if (cloneStep === 2 && !cloneRecording) {
          await startRealRecording();
        } else if (cloneStep === 2) {
          await analyzeCloneRecording();
        } else if (cloneStep === 3) {
          await createAndSaveClone();
        } else if (cloneStep === 5) {
          window.closeDetail();
          window.openDetail('workshop');
          callFlowCopyConfirmed = true;
          callFlowVoiceConfirmed = false;
          callFlowVoiceGenerated = false;
          updateCallWorkshopFlow();
          showCallWorkshopStep(3);
        }
      } catch (error) {
        if (cloneStep === 4) cloneStep = 3;
        renderCloneStep();
        notice(error.message || '操作失败，请重试');
      }
    };
  }

  function bindPlayButton(button) {
    if (!button || button.dataset.voiceBound) return;
    button.dataset.voiceBound = 'true';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const voiceName = button.closest('.voice-card')?.querySelector('b')?.textContent || selections.voiceName;
      selectVoice(voiceName);
      generateVoice(button, voiceName);
    });
  }

  function playOriginalRecording(button, recordingUrl) {
    if (!button || !recordingUrl) {
      notice('这条声音没有可播放的录音文件，请重新录入');
      return;
    }
    const audioUrl = new URL(recordingUrl, location.origin).href;
    if (activeOriginalButton === button && activeOriginalAudio) {
      if (activeOriginalAudio.paused) {
        activeOriginalAudio.play();
        button.classList.add('playing');
      } else {
        activeOriginalAudio.pause();
        button.classList.remove('playing');
      }
      return;
    }
    activeOriginalAudio?.pause();
    activeOriginalButton?.classList.remove('playing');
    activeOriginalAudio = new Audio(audioUrl);
    activeOriginalAudio.preload = 'auto';
    activeOriginalButton = button;
    button.classList.add('playing');
    activeOriginalAudio.onended = () => {
      button.classList.remove('playing');
      activeOriginalAudio = null;
      activeOriginalButton = null;
    };
    activeOriginalAudio.onerror = () => {
      button.classList.remove('playing');
      notice('录音文件无法读取，请重新录入声音');
    };
    activeOriginalAudio.play().catch(() => {
      button.classList.remove('playing');
      notice('浏览器未能播放录音，请再次点击试听');
    });
    notice('正在播放你的原始录音');
  }

  function clonedVoiceCard(voice, allowDelete) {
    const card = document.createElement('div');
    card.className = `voice-card card${allowDelete ? ' has-delete' : ' voice-choice'}`;
    card.dataset.clonedVoice = String(voice.id);
    card.innerHTML = `<div class="ico voice-avatar purple"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="12" fill="#f2eef7"/><path d="M8 19q0-11 10-11t10 11"/><path d="M12 18v5m6-10v12m6-9v7" stroke="#8d78b2"/><path d="m29 5 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" fill="#fff1d7"/></svg></div><div><b>${escapeHtml(voice.name)}</b><div class="voice-source">本人授权 · 已保存</div></div><div class="voice-actions"><button class="play"><span class="play-glyph">▶</span><span class="mini-wave"><i></i><i></i><i></i><i></i></span></button>${allowDelete ? '<button class="delete-voice" aria-label="删除声音">×</button>' : ''}</div>`;
    if (voice.status !== 'ready') card.querySelector('.voice-source').textContent = '历史录音 · 已保存，等待云端克隆后可用';
    if (voice.status === 'ready') voiceProfiles[voice.name] = {voiceId: voice.provider_voice_id, speed: 1, pitch: 0, emotion: 'calm', pauseSec: .45};
    const playButton = card.querySelector('.play');
    playButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      playOriginalRecording(playButton, voice.recording_url);
    });
    if (allowDelete && voice.status === 'ready') {
      card.addEventListener('click', (event) => {
        if (event.target.closest('.play, .delete-voice')) return;
        playOriginalRecording(playButton, voice.recording_url);
      });
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `试听${voice.name}`);
      card.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('.delete-voice')) {
          event.preventDefault();
          playOriginalRecording(playButton, voice.recording_url);
        }
      });
    }
    if (!allowDelete && voice.status === 'ready') card.onclick = () => selectVoice(voice.name);
    if (!allowDelete && voice.status !== 'ready') {
      card.classList.remove('voice-choice');
      card.setAttribute('aria-disabled', 'true');
    }
    const deleteButton = card.querySelector('.delete-voice');
    if (deleteButton) deleteButton.onclick = async (event) => {
      event.stopPropagation();
      if (!confirm(`删除“${voice.name}”及本地录音？`)) return;
      const response = await fetch(`${api}/api/ai/voices/${voice.id}`, {method: 'DELETE'});
      if (!response.ok) return notice('删除失败，请稍后重试');
      try { await deleteLocalVoice(voice.name); } catch (_) {}
      delete voiceProfiles[voice.name];
      if (selections.voiceName === voice.name) selectVoice('温柔女声');
      await loadClonedVoices();
      notice('声音已删除');
    };
    if (allowDelete && voice.status === 'ready') enhanceVoiceGenerateCard(card);
    return card;
  }

  function renderClonedLibrary(scope, allowDelete) {
    const title = [...scope.querySelectorAll('.voice-section')].find((node) => /我的声音|我的克隆声音/.test(node.textContent));
    if (!title) return;
    scope.querySelectorAll('[data-cloned-voice], .voice-empty').forEach((node) => node.remove());
    let anchor = title.nextElementSibling;
    if (!clonedVoices.length) {
      const empty = document.createElement('div');
      empty.className = 'voice-empty';
      empty.textContent = '还没有真实克隆声音，点击上方“AI 声音克隆”开始录制。';
      title.insertAdjacentElement('afterend', empty);
      return;
    }
    clonedVoices.slice().reverse().forEach((voice) => {
      const card = clonedVoiceCard(voice, allowDelete);
      title.insertAdjacentElement('afterend', card);
    });
    revealWorkshopGroup([...scope.querySelectorAll('[data-cloned-voice]')]);
  }

  async function loadClonedVoices() {
    try {
      clonedVoices = await request('/api/ai/voices');
      renderClonedLibrary(document.getElementById('voice-workshop'), true);
      renderClonedLibrary(document.getElementById('voice-picker'), false);
      const available = availableWorkshopVoices();
      if (!available.includes(voiceWorkshopVoiceName)) voiceWorkshopVoiceName = available[0] || '温柔女声';
      updateVoiceGenerator();
    } catch (error) {
      notice(`声音库加载失败：${error.message}`);
    }
  }

  function availableWorkshopVoices() {
    return Object.keys(voiceProfiles).filter((name) => {
      const cloned = clonedVoices.find((voice) => voice.name === name);
      return !cloned || cloned.status === 'ready';
    });
  }

  function updateVoiceGenerator() {
    const panel = document.getElementById('voice-phone-generator');
    if (!panel) return;
    const history = excuseHistory.find((item) => item.id === voiceWorkshopHistoryId);
    const hasCopy = Boolean(voiceWorkshopCopy.trim() && callFlowCopyConfirmed);
    const hasVoice = Boolean(voiceWorkshopVoiceName && callFlowVoiceConfirmed);
    const copyLabel = history ? `${history.scene_type} · ${history.contact_role}` : (hasCopy ? `${selections.scene} · ${selections.caller}` : '尚未确认');
    panel.querySelector('[data-generator-value="copy"]').textContent = copyLabel;
    panel.querySelector('[data-generator-value="voice"]').textContent = hasVoice ? voiceWorkshopVoiceName : '尚未确认';
    panel.querySelector('[data-generator-preview]').textContent = voiceWorkshopCopy || '请先完成第一步，确认要播报的来电话术。';
    panel.querySelector('#voice-generator-copy').classList.toggle('confirmed', hasCopy);
    panel.querySelector('#voice-generator-voice').classList.toggle('confirmed', hasVoice);
    panel.querySelector('#voice-phone-generate').disabled = !(hasCopy && hasVoice);
  }

  function ensureVoiceGenerator() {
    let panel = document.getElementById('voice-phone-generator');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'voice-phone-generator';
    panel.className = 'phone-generator card';
    panel.innerHTML = `<div class="phone-generator-title"><span>☎</span>生成电话语音</div><p class="phone-generator-sub">使用前三步已确认的内容生成 8kHz 电话版语音。</p><button class="generator-confirm" id="voice-generator-copy" type="button"><span class="generator-confirm-icon">1</span><span class="generator-confirm-copy"><b>话术确认</b><small data-generator-value="copy"></small></span><i>✓</i></button><button class="generator-confirm" id="voice-generator-voice" type="button"><span class="generator-confirm-icon purple">2</span><span class="generator-confirm-copy"><b>声音确认</b><small data-generator-value="voice"></small></span><i>✓</i></button><div class="generator-script-preview" data-generator-preview></div><button id="voice-phone-generate" type="button">生成电话语音</button><audio class="telephone-player" controls></audio><div class="telephone-result-meta"></div><div class="generator-result-actions" hidden><button class="generator-preview" type="button">试听电话语音</button><button class="generator-view-plans" type="button">查看方案工坊</button></div><div class="phone-generator-hint">生成成功后将自动保存为完整方案</div>`;
    ensurePhoneGeneratorPage().querySelector('.phone-generator-host').appendChild(panel);
    const localAudioSection = document.createElement('section');
    localAudioSection.id = 'local-audio-library';
    localAudioSection.className = 'local-audio-library';
    panel.insertAdjacentElement('afterend', localAudioSection);
    renderLocalAudioLibrary();
    panel.querySelector('#voice-generator-copy').addEventListener('click', () => {
      showCallWorkshopStep(2);
      notice('可在第二步修改或重新确认话术');
    });
    panel.querySelector('#voice-generator-voice').addEventListener('click', () => {
      showCallWorkshopStep(3);
      notice('可在第三步更换或重新确认声音');
    });
    panel.querySelector('#voice-phone-generate').addEventListener('click', () => {
      if (!callFlowCopyConfirmed || !voiceWorkshopCopy.trim()) return notice('请先完成话术确认');
      if (!callFlowVoiceConfirmed || !voiceWorkshopVoiceName) return notice('请先完成声音确认');
      lastCopy = voiceWorkshopCopy.trim();
      selectVoice(voiceWorkshopVoiceName);
      generateVoice(panel.querySelector('#voice-phone-generate'), voiceWorkshopVoiceName, {
        text: voiceWorkshopCopy.trim(),
        player: panel.querySelector('.telephone-player'),
        meta: panel.querySelector('.telephone-result-meta')
      });
    });
    panel.querySelector('.generator-preview').addEventListener('click', async () => {
      const player = panel.querySelector('.telephone-player');
      if (!player.src) return notice('请先生成电话语音');
      try { await player.play(); } catch (_) { notice('浏览器暂时无法播放，请再次点击'); }
    });
    panel.querySelector('.generator-view-plans').addEventListener('click', async () => {
      await loadPlanLibrary();
      window.openDetail?.('plan-workshop');
    });
    updateVoiceGenerator();
    return panel;
  }

  function ensureManualCopyComposer() {
    let composer = document.getElementById('manual-copy-composer');
    if (composer) return composer;
    composer = document.createElement('section');
    composer.id = 'manual-copy-composer';
    composer.className = 'manual-copy-composer';
    composer.innerHTML = `<button class="manual-copy-toggle" type="button">✎ 自己编写话术</button><div class="manual-copy-editor"><label for="manual-copy-text">来电话术内容</label><textarea id="manual-copy-text" maxlength="500" placeholder="例如：喂，我这边临时有点事，你方便现在回来一下吗？"></textarea><div class="manual-copy-meta"></div><div class="manual-copy-actions"><button class="manual-copy-cancel" type="button">取消</button><button class="manual-copy-save" type="button">保存到历史话术</button></div></div>`;
    const aiButton = document.querySelector('#workshop > .primary:not(#generate-voice-button)');
    (aiButton || ensureVoiceButton()).insertAdjacentElement('afterend', composer);
    const editor = composer.querySelector('.manual-copy-editor');
    const input = composer.querySelector('#manual-copy-text');
    const updateMeta = () => {
      composer.querySelector('.manual-copy-meta').textContent = `${selections.scene} · ${selections.caller} · ${selections.voiceName}`;
    };
    composer.querySelector('.manual-copy-toggle').addEventListener('click', () => {
      editor.classList.toggle('open');
      updateMeta();
      if (editor.classList.contains('open')) input.focus();
    });
    composer.querySelector('.manual-copy-cancel').addEventListener('click', () => editor.classList.remove('open'));
    composer.querySelector('.manual-copy-save').addEventListener('click', async () => {
      const text = input.value.trim();
      if (!text) return notice('请先写下来电话术内容');
      const saveButton = composer.querySelector('.manual-copy-save');
      saveButton.disabled = true;
      saveButton.textContent = '正在保存…';
      try {
        const saved = await request('/api/ai/history', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({scene_type: selections.scene, contact_role: selections.caller, voice_id: selections.voiceId, voice_name: selections.voiceName, text})
        });
        lastCopy = text;
        voiceWorkshopCopy = text;
        voiceWorkshopHistoryId = saved.id;
        callFlowCopyConfirmed = false;
        callFlowVoiceConfirmed = false;
        callFlowVoiceGenerated = false;
        invalidateGeneratedVoice();
        const result = ensureWorkshopResult();
        result.className = 'card visible result-ready';
        result.innerHTML = `<div class="editable-label">手写话术已保存 · 可继续编辑</div><div class="editable-copy" contenteditable="true">${escapeHtml(text)}</div>`;
        result.querySelector('.editable-copy').addEventListener('input', (event) => { lastCopy = event.currentTarget.textContent.trim(); invalidateAfterCopyChange(); });
        ensureVoiceButton().classList.add('ready');
        input.value = '';
        editor.classList.remove('open');
        await loadExcuseHistory();
        updateCallWorkshopFlow();
        notice('已保存到历史话术，可在声音工坊直接使用');
      } catch (error) {
        notice(`保存失败：${error.message}`);
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = '保存到历史话术';
      }
    });
    return composer;
  }

  function ensureHistorySection() {
    let section = document.getElementById('excuse-history');
    if (!section) {
      section = document.createElement('section');
      section.id = 'excuse-history';
      section.className = 'history-section';
      const anchor = document.getElementById('manual-copy-composer') || document.getElementById('generate-voice-button') || ensureWorkshopResult();
      anchor.insertAdjacentElement('afterend', section);
    }
    return section;
  }

  function renderExcuseHistory(items) {
    excuseHistory = items;
    if (!voiceWorkshopHistoryId && items[0]) {
      voiceWorkshopHistoryId = items[0].id;
      voiceWorkshopCopy = items[0].text;
    }
    updateVoiceGenerator();
    const section = ensureHistorySection();
    if (!items.length) {
      section.innerHTML = '<h2>历史话术</h2><div class="history-empty">生成并保存过的话术会出现在这里，可随时复用。</div>';
      return;
    }
    section.innerHTML = `<h2>历史话术</h2>${items.map((item) => `<article class="history-item card"><div class="history-meta">${escapeHtml(item.scene_type)} · ${escapeHtml(item.contact_role)} · ${escapeHtml(item.voice_name || '默认声音')}</div><div class="history-text">${escapeHtml(item.text)}</div><div class="history-actions"><button class="history-use" data-history-id="${item.id}">复用</button><button class="history-delete" data-history-id="${item.id}">删除</button></div></article>`).join('')}`;
    section.querySelectorAll('.history-use').forEach((button) => button.addEventListener('click', () => {
      const item = items.find((entry) => String(entry.id) === button.dataset.historyId);
      if (!item) return;
      lastCopy = item.text;
      invalidateGeneratedVoice();
      const result = ensureWorkshopResult();
      result.className = 'card visible result-ready';
      result.innerHTML = `<div class="editable-label">已复用历史话术 · 可继续编辑</div><div class="editable-copy" contenteditable="true">${escapeHtml(item.text)}</div>`;
      result.querySelector('.editable-copy').addEventListener('input', (event) => { lastCopy = event.currentTarget.textContent.trim(); invalidateAfterCopyChange(); });
      ensureVoiceButton().classList.add('ready');
      callFlowCopyConfirmed = false;
      callFlowVoiceConfirmed = false;
      callFlowVoiceGenerated = false;
      updateCallWorkshopFlow();
      if (item.voice_name) selectVoice(item.voice_name);
      notice('历史话术已复用');
    }));
    section.querySelectorAll('.history-delete').forEach((button) => button.addEventListener('click', async () => {
      await request(`/api/ai/history/${button.dataset.historyId}`, {method: 'DELETE'});
      loadExcuseHistory();
    }));
  }

  async function loadExcuseHistory() {
    try { renderExcuseHistory(await request('/api/ai/history')); } catch (error) { notice(`历史话术加载失败：${error.message}`); }
  }

  async function generateCopy() {
    const button = document.querySelector('#workshop .primary');
    const result = ensureWorkshopResult();
    button.parentElement?.insertBefore(result, button);
    const original = button.innerHTML;
    let generated = false;
    let planSaved = false;
    button.disabled = true;
    options.player?.closest('.phone-generator')?.querySelector('.generator-result-actions')?.setAttribute('hidden', '');
    button.classList.add('is-generating');
    button.innerHTML = '<span class="generate-spark">✦</span><span>正在生成…</span>';
    result.className = 'card visible';
    result.innerHTML = '<div class="result-skeleton" aria-label="正在生成话术"><i></i><i></i><i></i></div>';
    ensureVoiceButton().classList.remove('ready');
    try {
      const data = await request('/api/ai/excuse', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({scene_type: selections.scene, contact_role: selections.caller, tone: '温柔自然'})
      });
      lastCopy = data.reason;
      invalidateGeneratedVoice();
      request('/api/ai/history', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({scene_type: selections.scene, contact_role: selections.caller, voice_id: selections.voiceId, voice_name: selections.voiceName, text: data.reason})
      }).then(loadExcuseHistory).catch(() => {});
      result.className = 'card visible result-ready';
      result.innerHTML = `<div class="editable-label">已生成话术 · 点击文字可继续编辑</div><div class="editable-copy" contenteditable="true" role="textbox" aria-label="生成的话术">${escapeHtml(data.reason)}</div>`;
      result.querySelector('.editable-copy').addEventListener('input', (event) => { lastCopy = event.currentTarget.textContent.trim(); invalidateAfterCopyChange(); });
      ensureVoiceButton().classList.add('ready');
      callFlowCopyConfirmed = false;
      callFlowVoiceConfirmed = false;
      callFlowVoiceGenerated = false;
      updateCallWorkshopFlow();
      generated = true;
      notice('来电话术已生成');
    } catch (error) {
      result.className = 'card visible result-ready generation-error';
      result.innerHTML = `<div class="generation-error-title">✦ AI 生成失败</div><div class="generation-error-copy">${escapeHtml(error.message || 'AI 服务暂时不可用，请稍后重试。')}</div><button type="button" class="generation-retry">重新生成</button>`;
      result.querySelector('.generation-retry')?.addEventListener('click', generateCopy);
      notice(error.message || 'AI 生成失败，请稍后重试');
    } finally {
      button.disabled = false;
      button.classList.remove('is-generating');
      button.innerHTML = generated ? '<span class="generate-spark">✦</span><span>再次生成</span>' : original;
    }
  }

  function resetPlayButton(button) {
    if (!button) return;
    button.classList.remove('playing', 'loading');
    button.disabled = false;
  }

  async function generateVoice(button = ensureVoiceButton(), voiceName = selections.voiceName, options = {}) {
    const isCardPlay = button.classList.contains('play');
    if (isCardPlay && activePlayButton === button && activeAudio && !activeAudio.paused) {
      activeAudio.pause();
      resetPlayButton(button);
      activeAudio = null;
      activePlayButton = null;
      return;
    }
    if (activeAudio) activeAudio.pause();
    resetPlayButton(activePlayButton);
    activeAudio = null;
    activePlayButton = null;
    const original = button.innerHTML;
    const profile = voiceProfiles[voiceName] || voiceProfiles['温柔女声'];
    const requestText = (options.text || lastCopy || '').trim();
    if (!requestText) return notice('请输入电话话术');
    try {
      if (await localAudioCount(voiceName) >= MAX_LOCAL_AUDIO_PER_VOICE) {
        return notice(`“${voiceName}”已达到 ${MAX_LOCAL_AUDIO_PER_VOICE} 条电话音频上限，请删除旧音频后再生成`);
      }
    } catch (error) {
      return notice(`本机存储不可用：${error.message}`);
    }
    let generated = false;
    button.disabled = true;
    if (isCardPlay) button.classList.add('loading');
    else button.textContent = '正在生成电话语音…';
    try {
      const data = await request('/api/ai/voice', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          text: requestText,
          provider: 'minimax',
          voice_id: profile.voiceId,
          voice_name: voiceName,
          scene_type: selections.scene,
          speed: options.speed ?? profile.speed,
          pitch: profile.pitch,
          emotion: profile.emotion,
          pause_sec: options.pauseSec ?? profile.pauseSec,
          telephone: true
        })
      });
      lastVoiceFileId = data.voice_file_id;
      savedPlanId = null;
      updatePlanSaveState();
      try {
        lastLocalAudioId = await saveLocalPhoneAudio({data, voiceName, voiceId: profile.voiceId, text: requestText});
        if (callFlowCopyConfirmed && callFlowVoiceConfirmed) {
          saveGeneratedPlan({audioId: lastLocalAudioId, data, voiceName, voiceId: profile.voiceId, text: requestText});
          planSaved = true;
          await loadPlanCount();
          await loadPlanLibrary();
        }
        renderLocalAudioLibrary();
        updateLocalStorageSummary();
      } catch (error) {
        notice(`语音已生成，但本机保存失败：${error.message}`);
      }
      const audio = options.player || new Audio();
      audio.src = data.audio_url;
      audio.load();
      activeAudio = audio;
      activePlayButton = button;
      button.disabled = false;
      if (isCardPlay) button.classList.add('playing');
      if (options.player) options.player.classList.add('ready');
      if (options.meta) {
        options.meta.textContent = `${data.sample_rate}Hz · 电话版 WAV · ${(data.duration_ms / 1000).toFixed(1)}秒`;
        options.meta.classList.add('ready');
      }
      if (callFlowCopyConfirmed && callFlowVoiceConfirmed && planSaved) {
        callFlowVoiceGenerated = true;
        updateCallWorkshopFlow();
        notice('电话语音已生成，完整方案已保存到方案工坊');
        options.player?.closest('.phone-generator')?.querySelector('.generator-result-actions')?.removeAttribute('hidden');
      } else if (callFlowCopyConfirmed && callFlowVoiceConfirmed) {
        callFlowVoiceGenerated = false;
        updateCallWorkshopFlow();
        notice('电话语音已经生成，但本地方案保存失败，请检查浏览器存储后重试');
      }
      generated = true;
      try {
        await audio.play();
      } catch (_) {
        notice('电话语音已生成，请点击播放器试听');
      }
      audio.onended = () => {
        resetPlayButton(button);
        if (activeAudio === audio) activeAudio = null;
        if (activePlayButton === button) activePlayButton = null;
      };
      notice(`${voiceName}已生成，正在播放`);
    } catch (error) {
      resetPlayButton(button);
      notice(`语音生成失败：${error.message}`);
    } finally {
      if (!isCardPlay) {
        button.disabled = false;
        button.innerHTML = generated && options.player ? '重新生成电话语音' : original;
      }
    }
  }

  async function loadDevice() {
    try {
      const devices = await request('/api/devices');
      const device = devices[0];
      if (!device) return;
      const status = document.querySelector('#home .hero-device-status span');
      if (status) status.textContent = '设备已连接';
    } catch (_) {
      notice('后端暂未连接，当前显示演示数据');
    }
  }

  function bindNavigation() {
    document.querySelectorAll('.nav button').forEach((button) => {
      button.onclick = () => {
        stopPlanLibraryAudio(true);
        document.querySelectorAll('.detail.show').forEach((detail) => detail.classList.remove('show'));
        document.querySelector('.choice-mask')?.remove();
        document.querySelector('.plan-workshop-mask')?.classList.remove('show');
        document.querySelector('.nav')?.classList.remove('nav-hidden');
        document.body.classList.remove('detail-nav-hidden');
        document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
        document.querySelectorAll('.nav button').forEach((item) => item.classList.remove('on'));
        const target = document.getElementById(button.dataset.page);
        target?.classList.add('active');
        target?.scrollTo({top: 0, behavior: 'auto'});
        button.classList.add('on');
      };
    });
  }

  function bind() {
    installLayoutFixes();
    prepareWorkshopVisuals();
    bindEditors();
    setupDetailNavigation();
    setupCloneFlow();
    ensureVoiceGenerator();
    bindNavigation();
    const generateButton = document.querySelector('#workshop > .primary:not(#generate-voice-button)');
    if (generateButton) {
      generateButton.id = 'ai-generate-copy-button';
      generateButton.addEventListener('click', generateCopy);
    }
    ensureVoiceButton().addEventListener('click', () => {
      if (!lastCopy.trim()) return notice('请先生成或填写一条话术');
      voiceWorkshopCopy = lastCopy.trim();
      updateVoiceGenerator();
      callFlowCopyConfirmed = true;
      callFlowVoiceConfirmed = false;
      callFlowVoiceGenerated = false;
      ensureCallWorkshopFlow();
      updateCallWorkshopFlow();
      showCallWorkshopStep(3);
    });
    ensureManualCopyComposer();
    ensureCallWorkshopFlow();
    installLocalStorageControls();
    document.querySelectorAll('#voice-workshop .play, #voice-picker .play').forEach(bindPlayButton);
    setupWorkshopReveal();
    loadClonedVoices();
    loadExcuseHistory();
    loadDevice();
    loadPlanCount();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
