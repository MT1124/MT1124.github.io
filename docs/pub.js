/* 手机端发布 App（站长专用）：直接调用 GitHub API 发布 Issue，触发 Gmeek 自动构建 */
(function () {
  'use strict';
  var API = 'https://api.github.com';
  var REPO = window.PUB_REPO || '';
  var TOKEN_KEY = 'pub_token';
  var DEFAULT_LABEL = 'post';
  var S = { token: '', labels: [], picked: [], edit: null, nodeId: '' };

  function $(id) { return document.getElementById(id); }
  function show(id, on) { var e = $(id); if (e) e.hidden = !on; }
  function pane(name) {
    show('pubSetup', name === 'setup');
    show('pubForm', name === 'form');
    show('pubManage', name === 'manage');
    var tn = $('pubTabNew'), tm = $('pubTabManage');
    if (tn) tn.classList.toggle('active', name !== 'manage');
    if (tm) tm.classList.toggle('active', name === 'manage');
  }
  function setMsg(id, text, kind) {
    var e = $(id); if (!e) return;
    e.textContent = text || '';
    e.className = 'pub-msg' + (kind ? ' ' + kind : '');
  }
  function gh(method, path, body) {
    var opt = { method: method, headers: { 'Accept': 'application/vnd.github+json' } };
    if (S.token) opt.headers['Authorization'] = 'token ' + S.token;
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    return fetch(API + path, opt).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { message: txt }; }
        if (!res.ok) throw new Error((data && data.message) || ('HTTP ' + res.status));
        return data;
      });
    });
  }
  function graphql(query) {
    return fetch(API + '/graphql', {
      method: 'POST',
      headers: { 'Authorization': 'token ' + S.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query })
    }).then(function (r) { return r.json(); });
  }

  function pagesBase() {
    var parts = (REPO || '').split('/');
    var owner = parts[0] || '';
    var name = parts[1] || '';
    if (!owner) { return ''; }
    if (name.toLowerCase() === (owner.toLowerCase() + '.github.io')) {
      return 'https://' + owner + '.github.io/';
    }
    return 'https://' + owner + '.github.io/' + name + '/';
  }

  function openApp() {
    var a = $('pubApp'); if (!a) return;
    a.classList.add('open'); a.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    try { S.token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { S.token = ''; }
    if (!S.token) { pane('setup'); }
    else { pane('form'); loadLabels(); }
  }
  function closeApp() {
    var a = $('pubApp'); if (!a) return;
    a.classList.remove('open'); a.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function saveToken() {
    var v = ($('pubToken').value || '').trim();
    if (!v) { setMsg('pubSetupMsg', '请先粘贴 Token', 'err'); return; }
    S.token = v;
    setMsg('pubSetupMsg', '正在验证…');
    gh('GET', '/user').then(function (u) {
      try { localStorage.setItem(TOKEN_KEY, v); } catch (e) {}
      setMsg('pubSetupMsg', '已连接：' + (u.login || ''), 'ok');
      pane('form'); loadLabels(); loadPosts();
    }).catch(function (err) {
      S.token = '';
      setMsg('pubSetupMsg', 'Token 无效或权限不足：' + err.message, 'err');
    });
  }

  function renderLabels() {
    var box = $('pubLabels'); if (!box) return;
    box.innerHTML = '';
    S.labels.forEach(function (name) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pub-chip' + (S.picked.indexOf(name) >= 0 ? ' on' : '');
      b.textContent = name;
      b.onclick = function () { pick(name); };
      box.appendChild(b);
    });
    if (!S.labels.length) {
      var t = document.createElement('span');
      t.className = 'pub-chip pub-chip-loading';
      t.textContent = '还没有标签，可在下面新建';
      box.appendChild(t);
    }
  }
  function pick(name) {
    var i = S.picked.indexOf(name);
    if (i >= 0) S.picked.splice(i, 1); else S.picked.push(name);
    renderLabels();
  }
  function loadLabels() {
    var box = $('pubLabels'); if (!box) return;
    box.innerHTML = '<span class="pub-chip pub-chip-loading">标签加载中…</span>';
    gh('GET', '/repos/' + REPO + '/labels?per_page=100').then(function (list) {
      S.labels = (list || []).map(function (l) { return l.name; }).filter(function (n) {
        return ['good first issue', 'help wanted', 'duplicate', 'invalid', 'wontfix'].indexOf(n) < 0;
      });
      renderLabels();
    }).catch(function (e) {
      box.innerHTML = '';
      setMsg('pubMsg', '标签加载失败：' + e.message, 'err');
    });
  }
  function addNewLabel() {
    var v = ($('pubNewLabel').value || '').trim();
    if (!v) return;
    if (S.labels.indexOf(v) < 0) S.labels.unshift(v);
    if (S.picked.indexOf(v) < 0) S.picked.push(v);
    $('pubNewLabel').value = '';
    renderLabels();
  }

  function downscale(file, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1600, w = img.width, h = img.height, s = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * s));
        c.height = Math.max(1, Math.round(h * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        try { cb(c.toDataURL('image/jpeg', 0.85)); } catch (e) { cb(fr.result); }
      };
      img.onerror = function () { cb(fr.result); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }
  function uploadImage(file, i, n) {
    return new Promise(function (resolve, reject) {
      downscale(file, function (dataUrl) {
        var b64 = (dataUrl || '').split(',')[1];
        if (!b64) { reject(new Error('图片读取失败')); return; }
        var base = (file.name || 'img').replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fa5\-]+/g, '_').slice(0, 40) || 'img';
        var fileName = base + '-' + Date.now() + '-' + i + '.jpg';
        var path = 'pwa/images/' + fileName;
        setMsg('pubMsg', '正在上传图片 ' + (i + 1) + '/' + n + '…（发布后约 1 分钟可在站点访问）');
        gh('PUT', '/repos/' + REPO + '/contents/' + path, { message: 'upload image ' + base, content: b64, branch: 'main' })
          .then(function () { resolve(pagesBase() + 'images/' + fileName); })
          .catch(reject);
      });
    });
  }
  function insertAtCursor(ta, text) {
    var start = ta.selectionStart || 0, end = ta.selectionEnd || 0, v = ta.value || '';
    ta.value = v.slice(0, start) + text + v.slice(end);
    ta.selectionStart = ta.selectionEnd = start + text.length;
    ta.focus();
  }

  function publish() {
    var title = ($('pubTitle').value || '').trim();
    var body = $('pubBody').value || '';
    if (!title) { setMsg('pubMsg', '请填写文章标题', 'err'); return; }
    var labels = S.picked.slice();
    var extra = ($('pubNewLabel').value || '').trim();
    if (extra && labels.indexOf(extra) < 0) labels.unshift(extra);
    var btn = $('pubSubmit'); if (btn) btn.disabled = true;
    setMsg('pubMsg', '正在提交…');

    var chain = Promise.resolve();
    labels.forEach(function (name) {
      if (S.labels.indexOf(name) >= 0) return;
      chain = chain.then(function () {
        return gh('POST', '/repos/' + REPO + '/labels', { name: name, color: '6fc79a' }).catch(function () {});
      }).then(function () { S.labels.unshift(name); renderLabels(); });
    });

    chain.then(function () {
      if (!labels.length) labels = [DEFAULT_LABEL];
      var payload = { title: title, body: body, labels: labels };
      var req = S.edit
        ? gh('PATCH', '/repos/' + REPO + '/issues/' + S.edit, payload)
        : gh('POST', '/repos/' + REPO + '/issues', payload);
      return req;
    }).then(function (issue) {
      S.nodeId = issue.node_id || '';
      var wantTop = ($('pubTop') || {}).checked;
      if (!S.nodeId) return null;
      var q = S.edit
        ? (wantTop ? 'mutation{pinIssue(input:{issueId:"' + S.nodeId + '"}){issue{id}}}'
                   : 'mutation{unpinIssue(input:{issueId:"' + S.nodeId + '"}){issue{id}}}')
        : (wantTop ? 'mutation{pinIssue(input:{issueId:"' + S.nodeId + '"}){issue{id}}}' : null);
      if (!q) return null;
      return graphql(q);
    }).then(function () {
      var isEdit = !!S.edit;
      S.edit = null;
      if ($('pubCancelEdit')) $('pubCancelEdit').hidden = true;
      if (btn) { btn.disabled = false; btn.textContent = '发布文章'; }
      setMsg('pubMsg', (isEdit ? '已保存修改' : '已发布') + '，站点正在自动构建，约 1-2 分钟后可刷新查看。', 'ok');
      $('pubTitle').value = '';
      $('pubBody').value = '';
      S.picked = []; renderLabels();
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      setMsg('pubMsg', '发布失败：' + err.message, 'err');
    });
  }

  function renderPosts(list) {
    var box = $('pubPosts'); if (!box) return;
    box.innerHTML = '';
    if (!list.length) { box.innerHTML = '<div class="pub-msg">还没有文章</div>'; return; }
    list.forEach(function (it) {
      var row = document.createElement('div'); row.className = 'pub-post';
      var t = document.createElement('div'); t.className = 'pub-post-title'; t.textContent = it.title;
      var m = document.createElement('div'); m.className = 'pub-post-meta';
      m.textContent = (it.labels || []).map(function (l) { return l.name; }).join(' / ');
      var e = document.createElement('button'); e.type = 'button'; e.className = 'pub-mini'; e.textContent = '编辑';
      e.onclick = function () { startEdit(it); };
      var c = document.createElement('button'); c.type = 'button'; c.className = 'pub-mini'; c.textContent = '关闭';
      c.onclick = function () { closePost(it); };
      row.appendChild(t); row.appendChild(m); row.appendChild(e); row.appendChild(c);
      box.appendChild(row);
    });
  }
  function loadPosts() {
    setMsg('pubManageMsg', '加载中…');
    gh('GET', '/repos/' + REPO + '/issues?state=open&per_page=50&sort=updated').then(function (list) {
      var posts = (list || []).filter(function (it) { return !it.pull_request; });
      renderPosts(posts);
      setMsg('pubManageMsg', '共 ' + posts.length + ' 篇');
    }).catch(function (e) { setMsg('pubManageMsg', '加载失败：' + e.message, 'err'); });
  }
  function startEdit(it) {
    S.edit = it.number;
    $('pubTitle').value = it.title || '';
    $('pubBody').value = it.body || '';
    S.picked = (it.labels || []).map(function (l) { return l.name; });
    renderLabels();
    if ($('pubCancelEdit')) $('pubCancelEdit').hidden = false;
    if ($('pubSubmit')) $('pubSubmit').textContent = '保存修改';
    pane('form');
    setMsg('pubMsg', '正在编辑：' + it.title, '');
    $('pubTitle').scrollIntoView({ block: 'center' });
  }
  function closePost(it) {
    if (!window.confirm('关闭后这篇文章会从博客移除，确定吗？\n' + it.title)) return;
    setMsg('pubManageMsg', '正在关闭…');
    gh('PATCH', '/repos/' + REPO + '/issues/' + it.number, { state: 'closed' })
      .then(function () { loadPosts(); })
      .catch(function (e) { setMsg('pubManageMsg', '关闭失败：' + e.message, 'err'); });
  }

  function init() {
    var fab = $('writeFab');
    if (fab) {
      fab.addEventListener('click', function (e) { e.preventDefault(); openApp(); });
    }
    if ($('pubClose')) $('pubClose').onclick = closeApp;
    if ($('pubTabNew')) $('pubTabNew').onclick = function () { pane('form'); };
    if ($('pubTabManage')) $('pubTabManage').onclick = function () { pane('manage'); loadPosts(); };
    if ($('pubSave')) $('pubSave').onclick = saveToken;
    if ($('pubAddLabel')) $('pubAddLabel').onclick = addNewLabel;
    if ($('pubSubmit')) $('pubSubmit').onclick = publish;
    if ($('pubRefresh')) $('pubRefresh').onclick = loadPosts;
    if ($('pubCancelEdit')) {
      $('pubCancelEdit').onclick = function () {
        S.edit = null; S.picked = []; renderLabels();
        $('pubTitle').value = ''; $('pubBody').value = '';
        this.hidden = true; $('pubSubmit').textContent = '发布文章';
        setMsg('pubMsg', '');
      };
    }
    var img = $('pubImg');
    if (img) {
      img.addEventListener('change', function () {
        var files = Array.prototype.slice.call(img.files || []);
        if (!files.length) return;
        var ta = $('pubBody');
        var chain = Promise.resolve();
        files.forEach(function (f, i) {
          chain = chain.then(function () {
            return uploadImage(f, i, files.length).then(function (url) {
              insertAtCursor(ta, '\n\n![](' + url + ')\n');
            });
          });
        });
        chain.then(function () { setMsg('pubMsg', '图片已上传并插入正文（约 1 分钟后站点上可访问）', 'ok'); img.value = ''; })
             .catch(function (e) { setMsg('pubMsg', '图片上传失败：' + e.message, 'err'); img.value = ''; });
      });
    }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeApp(); });
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function () {});
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
