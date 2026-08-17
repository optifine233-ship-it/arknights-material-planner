// ==UserScript==
// @name         明日方舟养成统计 · 森空岛脱敏导出
// @namespace    arknights-material-planner
// @version      0.1.0
// @description  在森空岛本地读取养成进度，并下载不含账号凭据和身份信息的 JSON。
// @match        https://www.skland.com/*
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      zonai.skland.com
// ==/UserScript==

(() => {
  'use strict';

  const API_ORIGIN = 'https://zonai.skland.com';
  const PROFILE = { platform: '1', dId: '', vName: '1.21.0' };
  const encoder = new TextEncoder();

  function rotateLeft(value, bits) {
    return (value << bits) | (value >>> (32 - bits));
  }

  function md5Hex(value) {
    const input = encoder.encode(value);
    const bitLength = input.length * 8;
    const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
    const bytes = new Uint8Array(paddedLength);
    bytes.set(input);
    bytes[input.length] = 0x80;
    const view = new DataView(bytes.buffer);
    view.setUint32(paddedLength - 8, bitLength >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

    const shifts = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];
    const constants = Array.from({ length: 64 }, (_, index) => (
      Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0
    ));
    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;

    for (let offset = 0; offset < bytes.length; offset += 64) {
      const words = Array.from({ length: 16 }, (_, index) => view.getUint32(offset + index * 4, true));
      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;
      for (let index = 0; index < 64; index += 1) {
        let f;
        let wordIndex;
        if (index < 16) {
          f = (b & c) | (~b & d);
          wordIndex = index;
        } else if (index < 32) {
          f = (d & b) | (~d & c);
          wordIndex = (5 * index + 1) % 16;
        } else if (index < 48) {
          f = b ^ c ^ d;
          wordIndex = (3 * index + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          wordIndex = (7 * index) % 16;
        }
        const previousD = d;
        d = c;
        c = b;
        b = (b + rotateLeft((a + f + constants[index] + words[wordIndex]) >>> 0, shifts[index])) >>> 0;
        a = previousD;
      }
      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }
    return [a0, b0, c0, d0].map((word) => (
      [0, 8, 16, 24].map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, '0')).join('')
    )).join('');
  }

  async function hmacSha256Hex(key, message) {
    // WebCrypto rejects a zero-length HMAC key. For SHA-256 HMAC, a
    // 64-byte zero block is equivalent to the padded empty key.
    const rawKey = key ? encoder.encode(key) : new Uint8Array(64);
    const cryptoKey = await crypto.subtle.importKey(
      'raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
    return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function sign(token, path, query, timestamp) {
    const signHeader = { platform: PROFILE.platform, timestamp, dId: PROFILE.dId, vName: PROFILE.vName };
    const hmac = await hmacSha256Hex(token, `${path}${query}${timestamp}${JSON.stringify(signHeader)}`);
    return md5Hex(hmac);
  }

  function request(url, headers) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers,
        timeout: 15000,
        responseType: 'json',
        anonymous: true,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`请求失败（HTTP ${response.status}）`));
            return;
          }
          try {
            resolve(response.response && typeof response.response === 'object'
              ? response.response
              : JSON.parse(response.responseText || 'null'));
          } catch {
            reject(new Error('森空岛返回了无法识别的数据。'));
          }
        },
        ontimeout() { reject(new Error('连接森空岛超时，请稍后重试。')); },
        onerror() { reject(new Error('无法连接森空岛接口。')); }
      });
    });
  }

  function headers(timestamp, signature, credential, token = '') {
    return {
      'Content-Type': 'application/json',
      platform: PROFILE.platform,
      'Accept-Language': 'zh-Hans-CN;q=1.0',
      dId: PROFILE.dId,
      vName: PROFILE.vName,
      language: 'zh-hans-CN',
      sign: signature,
      timestamp,
      cred: credential,
      ...(token ? { token } : {})
    };
  }

  async function signedGet(path, query, credential, token) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = await sign(token, path, query, timestamp);
    const suffix = query ? `?${query}` : '';
    return request(`${API_ORIGIN}${path}${suffix}`, headers(timestamp, signature, credential, token));
  }

  function credentialFromStorage() {
    const raw = localStorage.getItem('SK_OAUTH_CRED_KEY') || '';
    const decode = (value) => {
      let decoded = String(value || '').trim();
      for (let index = 0; index < 2; index += 1) {
        try {
          const next = decodeURIComponent(decoded);
          if (next === decoded) break;
          decoded = next;
        } catch { break; }
      }
      return decoded;
    };
    const decodedRaw = decode(raw);
    const candidates = [];
    try {
      const parsed = JSON.parse(decodedRaw);
      if (typeof parsed === 'string') candidates.push(parsed);
      else if (parsed && typeof parsed === 'object') candidates.push(parsed.cred, parsed.value);
    } catch {}
    candidates.push(decodedRaw);
    const credential = candidates
      .map(decode)
      .find((candidate) => candidate.length >= 12 && !candidate.includes('{') && !candidate.includes(';'));
    if (!credential) throw new Error('没有找到森空岛登录状态，请先登录或刷新森空岛网页。');
    return credential.trim().replace(/^['"]|['"]$/g, '');
  }

  function requireOk(body, message) {
    if (!body || body.code !== 0 || !body.data) throw new Error(message);
    return body.data;
  }

  function bindingsFrom(data) {
    const roles = [];
    for (const app of data.list || []) {
      if (app?.appCode !== 'arknights' || !Array.isArray(app.bindingList)) continue;
      for (const role of app.bindingList) {
        if (!role?.uid || role.isDelete === true) continue;
        roles.push({
          uid: String(role.uid),
          nickname: String(role.nickName || role.nickname || '未命名角色').slice(0, 32),
          channel: String(role.channelName || role.channel || '官方').slice(0, 20),
          isDefault: String(role.uid) === String(app.defaultUid || '')
        });
      }
    }
    return roles;
  }

  function selectRole(roles) {
    if (!roles.length) throw new Error('当前账号没有找到已绑定的明日方舟角色。');
    if (roles.length === 1) return roles[0];
    const lines = roles.map((role, index) => `${index + 1}. ${role.nickname} · ${role.channel}${role.isDefault ? '（默认）' : ''}`);
    const answer = window.prompt(`请选择要导出的角色：\n\n${lines.join('\n')}\n\n输入序号`, '1');
    if (answer === null) throw new Error('已取消导出。');
    const selected = roles[Number(answer) - 1];
    if (!selected) throw new Error('角色序号无效，请重新操作。');
    return selected;
  }

  function sanitizeCultivation(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.characters)) {
      throw new Error('森空岛养成数据结构不完整，未生成快照。');
    }
    if (!data.characters.length || data.characters.length > 1_000) {
      throw new Error('森空岛返回的干员数量异常，未生成快照。');
    }
    const seen = new Set();
    const integer = (value, minimum, maximum) => (
      Number.isInteger(value) && value >= minimum && value <= maximum
    );
    const details = (values, label) => {
      if (!Array.isArray(values)) throw new Error(`${label}数据不完整，未生成快照。`);
      return values.map((value) => {
        if (!value || typeof value.id !== 'string' || !value.id || !integer(value.level, 0, 3)) {
          throw new Error(`${label}数据不完整，未生成快照。`);
        }
        return { id: value.id, level: value.level };
      });
    };
    const characters = data.characters.map((character) => {
      if (!character || typeof character.id !== 'string' || !character.id
        || !integer(character.evolvePhase, 0, 2)
        || !integer(character.level, 1, 100)
        || !integer(character.potentialRank, 0, 5)
        || !integer(character.mainSkillLevel, 1, 7)) {
        throw new Error('森空岛干员数据不完整，未生成快照。');
      }
      if (seen.has(character.id)) throw new Error('森空岛返回了重复干员，未生成快照。');
      seen.add(character.id);
      return {
        id: character.id,
        evolvePhase: character.evolvePhase,
        level: character.level,
        potentialRank: character.potentialRank,
        mainSkillLevel: character.mainSkillLevel,
        skills: details(character.skills, '技能'),
        equips: details(character.equips, '模组')
      };
    });
    return {
      format: 'skland-cultivate-snapshot',
      version: 1,
      generatedAt: new Date().toISOString(),
      completeness: { characters: 'partial', items: 'unknown' },
      characters,
      items: []
    };
  }

  function download(snapshot) {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `skland-cultivation-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function exportCultivation(setStatus) {
    let credential = '';
    let token = '';
    let uid = '';
    try {
      setStatus('正在读取角色列表…');
      credential = credentialFromStorage();
      const refresh = requireOk(
        await signedGet('/api/v1/auth/refresh', '', credential, ''),
        '森空岛登录状态已失效，请重新登录。'
      );
      token = String(refresh.token || '');
      if (!token) throw new Error('森空岛没有返回临时授权。');
      const binding = requireOk(
        await signedGet('/api/v1/game/player/binding', '', credential, token),
        '无法读取绑定角色。'
      );
      const selected = selectRole(bindingsFrom(binding));
      uid = selected.uid;
      setStatus('正在读取养成进度…');
      const query = `uid=${encodeURIComponent(uid)}`;
      const cultivation = requireOk(
        await signedGet('/api/v1/game/cultivate/player', query, credential, token),
        '无法读取干员养成进度。'
      );
      const snapshot = sanitizeCultivation(cultivation);
      if (!snapshot.characters.length) throw new Error('没有取得可导出的干员记录。');
      download(snapshot);
      setStatus(`已下载 ${snapshot.characters.length} 名干员的脱敏快照。`);
    } finally {
      credential = '';
      token = '';
      uid = '';
    }
  }

  function mount() {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    const panel = document.createElement('section');
    panel.innerHTML = '<button type="button">导出养成快照</button><span role="status" aria-live="polite">仅生成脱敏 JSON，不会导出账号凭据</span>';
    const style = document.createElement('style');
    style.textContent = `section{width:250px;padding:12px;background:#141a20;color:#fff;border-left:5px solid #e7b53a;box-shadow:0 12px 32px #0004;font:13px/1.5 "Microsoft YaHei UI",sans-serif}button{width:100%;min-height:40px;padding:10px;border:0;background:#e7b53a;color:#141a20;font-weight:800;cursor:pointer}button:disabled{opacity:.65;cursor:wait}span{display:block;margin-top:8px;color:#b7bec4}`;
    root.append(style, panel);
    document.documentElement.append(host);
    const button = panel.querySelector('button');
    const status = panel.querySelector('span');
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await exportCultivation((message) => { status.textContent = message; });
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : '导出失败，请稍后重试。';
      } finally {
        button.disabled = false;
      }
    });
  }

  mount();
})();
