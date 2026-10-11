const $ = s => document.querySelector(s), sh = (e, v) => e.hidden = !v;
let peer, isHost = false, me = {}, hostConn, conns = {}, users = {}, calls = {}, local = null, movieStream = null, mode = 'none', yt = null, ytOK = false, ytId = null, applying = false, invite = '';
let S = { chat: true, mic: true, cam: true, control: false, locked: false, react: true, fctl: false }, unread = 0;
const ready = new Set(), BR = { 1080: 3.2e6, 720: 1.8e6, 480: 9e5 };
const ICE = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  }
};
const send = (c, m) => c && c.open && c.send(m);
const bcast = (m, x) => Object.values(conns).forEach(c => c.peer !== x && send(c, m));
function toast(t, ms = 3500) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, ms) }

/* ---------- connect ---------- */
function start(host) {
  $('#create').disabled = $('#join').disabled = true;
  const name = $('#name').value.trim() || 'Guest' + (Math.random() * 99 | 0), code = $('#code').value.trim();
  if (!host && !code) { $('#create').disabled = $('#join').disabled = false; return toast('Enter a room code') }
  isHost = host;
  peer = host ? new Peer('wr' + Math.random().toString(36).slice(2, 8), ICE) : new Peer(undefined, ICE);
  peer.on('open', id => {
    me = { id, name }; users[id] = { name, host };
    const room = host ? id : code; invite = location.href.split('#')[0] + '#' + room;
    $('#land').hidden = true; $('#app').hidden = false; $('#rc').textContent = 'Room ' + room;
    if (host) { $('#leave').textContent = '🚪 End room'; keepAwake(); sh($('#bar'), true); sh($('#tabadm'), true); applySettings() }
    else {
      hostConn = peer.connect(room, { reliable: true });
      hostConn.on('open', () => { send(hostConn, { t: 'hello', name }); renderUsers() });
      hostConn.on('data', guestRecv);
      hostConn.on('close', () => { toast('The host left, so this room is closed.', 6000); setTimeout(() => { history.replaceState(null, '', location.pathname + location.search); location.reload() }, 3500) });
    }
  });
  peer.on('connection', c => isHost && hostAccept(c));
  peer.on('call', onCall);
  peer.on('disconnected', () => { const t = setInterval(() => { if (peer.destroyed || !peer.disconnected) return clearInterval(t); try { peer.reconnect() } catch { } }, 3000) });
  peer.on('error', e => { $('#create').disabled = $('#join').disabled = false; if (e.type === 'peer-unavailable' && (isHost || (hostConn && hostConn.open))) return; toast(e.type === 'peer-unavailable' ? 'Room not found. Check the code.' : 'Connection error: ' + e.type); if (e.type === 'peer-unavailable') setTimeout(() => location.reload(), 2200) });
}
function hostAccept(c) {
  c.on('data', d => {
    if (d.t === 'hello') {
      if (S.locked) { send(c, { t: 'denied' }); return setTimeout(() => c.close(), 400) }
      conns[c.peer] = c; users[c.peer] = { name: String(d.name).slice(0, 20) };
      send(c, { t: 'init', users, S, mode, ytId }); send(c, { t: 'fstate', playing: mode === 'file' && !$('#fv').paused }); send(c, { t: 'langs', langs: fileLangs }); send(c, { t: 'cue', c: cueNow }); send(c, { t: 'alangs', names: aNames });
      bcast({ t: 'users', users }); renderUsers(); sys(users[c.peer].name + ' joined'); syncCalls();
      if (movieStream) serve(c.peer);
    } else if (conns[c.peer]) {
      if (d.t === 'chat' && S.chat) { const m = { t: 'chat', from: users[c.peer].name, text: String(d.text).slice(0, 500) }; bcast(m, c.peer); addChat(m) }
      if (d.t === 'yt' && (S.control || adm(c.peer))) { applyYT(d); bcast(d, c.peer) }
      if (d.t === 'film' && (S.fctl || adm(c.peer)) && mode === 'file' && movieStream) { const v = $('#fv'); if (d.a === 'play') v.play().catch(() => { }); else if (d.a === 'pause') v.pause() }
      if (d.t === 'resend' && movieStream) { const o = calls['movie:' + c.peer]; if (o) { o.close(); delete calls['movie:' + c.peer] } delete parentOf[c.peer]; serve(c.peer) }
      if (d.t === 'live') {
        if (users[c.peer].live || Object.values(users).filter(u => u.live).length < MAXLIVE) { users[c.peer].live = true; bcast({ t: 'users', users }); renderUsers() }
        else { send(c, { t: 'toast', text: 'The voice & video group is full (' + MAXLIVE + ' people). You can still watch, chat and react.' }); send(c, { t: 'livefull' }) }
      }
      if (d.t === 'yturl' && adm(c.peer) && /^[\w-]{11}$/.test(d.id)) { stopMovie(); hostMode('yt', d.id) }
      if (d.t === 'setting' && adm(c.peer) && S.hasOwnProperty(d.k)) { S[d.k] = !!d.v; bcast({ t: 'settings', S }); applySettings() }
      if (d.t === 'admin' && adm(c.peer) && ['mute', 'kick'].includes(d.a) && users[d.id] && !users[d.id].admin) hostAct(d.a, d.id);
      if (d.t === 'react' && S.react) { bcast(d, c.peer); float(d.e) }
      if (d.t === 'ready') { ready.add(c.peer); updReady() }
    }
  });
  c.on('close', () => {
    if (!conns[c.peer]) return;
    sys(users[c.peer].name + ' left'); delete conns[c.peer]; delete users[c.peer]; reparent(c.peer);
    bcast({ t: 'users', users }); renderUsers(); dropPeer(c.peer);
  });
}
function guestRecv(d) {
  if (d.t === 'init') { users = d.users; S = d.S; renderUsers(); applySettings(); setMode(d.mode, d.ytId) }
  else if (d.t === 'users') { users = d.users; renderUsers(); syncCalls(); document.querySelectorAll('.tile').forEach(t => { if (!users[t.dataset.id]) dropPeer(t.dataset.id) }) }
  else if (d.t === 'settings') { S = d.S; applySettings() }
  else if (d.t === 'mode') setMode(d.mode, d.id)
  else if (d.t === 'chat') addChat(d)
  else if (d.t === 'yt') applyYT(d)
  else if (d.t === 'react') float(d.e)
  else if (d.t === 'fstate') { fplaying = d.playing; fbtn() }
  else if (d.t === 'toast') toast(d.text)
  else if (d.t === 'relay') { if (d.reset) kids.clear(); else { kids.add(d.to); if (relayStream) callKid(d.to) } }
  else if (d.t === 'livefull') { if (local) { local.getTracks().forEach(t => t.stop()); local = null; dropTile(me.id) } updMediaBtns() }
  else if (d.t === 'langs') { fileLangs = d.langs; setLangs() }
  else if (d.t === 'cue') { cueNow = d.c; renderCap() }
  else if (d.t === 'alangs') { aNames = d.names; setAudioList() }
  else if (d.t === 'kick') { toast('The host removed you from the room'); setTimeout(() => location.reload(), 1500) }
  else if (d.t === 'mute') { setTrack('audio', false); toast('The host muted you') }
  else if (d.t === 'denied') toast('This room is locked')
}

/* ---------- chat & people ---------- */
function addChat(m) {
  const d = document.createElement('div'), l = $('#log');
  if (m.sys) { d.className = 'sys'; d.textContent = m.text } else { const b = document.createElement('b'); b.textContent = m.from; d.append(b, document.createTextNode(m.text)) }
  l.append(d); l.scrollTop = l.scrollHeight;
  while (l.childElementCount > 150) l.firstChild.remove();
  if ($('#chat').hidden && !m.sys) { unread++; $('#tabchat').textContent = '💬 Chat (' + unread + ')' }
}
const sys = text => addChat({ sys: true, text });
function sendChat() {
  const i = $('#msg'), t = i.value.trim(); if (!t) return;
  if (isHost) { const m = { t: 'chat', from: me.name, text: t }; bcast(m); addChat(m) }
  else {
    if (!hostConn || !hostConn.open) return toast('Not connected to the host yet. Wait a moment and try again.');
    if (!S.chat) return toast('The host turned chat off'); addChat({ from: me.name, text: t }); send(hostConn, { t: 'chat', text: t });
  }
  i.value = '';
}
function renderUsers() {
  const ul = $('#ulist'); ul.innerHTML = ''; updReady();
  $('#st').textContent = isHost ? '● ' + Object.keys(conns).length + ' watching' : (hostConn && hostConn.open ? '● Connected' : '● Connecting…');
  const mk = (li, a, l) => { const b = document.createElement('button'); b.textContent = l; b.dataset.a = a; li.append(b) };
  for (const id in users) {
    const u = users[id], li = document.createElement('li'), sp = document.createElement('span'); li.dataset.id = id;
    sp.textContent = u.name + (id === me.id ? ' (you)' : ''); li.append(sp);
    const tg = u.host ? 'host' : u.admin ? 'admin' : '';
    if (tg) { const g = document.createElement('em'); g.className = 'tag'; g.textContent = tg; li.append(g) }
    if (!u.host && id !== me.id && isAdm()) {
      if (isHost) mk(li, u.admin ? 'demote' : 'promote', u.admin ? '👤 Make user' : '⭐ Make admin');
      if (isHost || !u.admin) { mk(li, 'mute', '🔇 Mute'); mk(li, 'kick', '❌ Remove') }
    }
    ul.append(li);
  }
  applyRole();
}
$('#ulist').onclick = e => {
  const b = e.target.closest('button'); if (!b) return; const id = b.closest('li').dataset.id, a = b.dataset.a;
  if (isHost) hostAct(a, id); else if (isAdm()) send(hostConn, { t: 'admin', a, id });
};
function hostAct(a, id) {
  const c = conns[id]; if (!c || !users[id]) return;
  if (a === 'mute') send(c, { t: 'mute' });
  else if (a === 'kick') { send(c, { t: 'kick' }); setTimeout(() => c.close(), 300) }
  else if (a === 'promote' || a === 'demote') {
    users[id].admin = a === 'promote'; bcast({ t: 'users', users }); renderUsers();
    send(c, { t: 'toast', text: a === 'promote' ? 'You are now an admin' : 'You are no longer an admin' });
    sys(users[id].name + (a === 'promote' ? ' is now an admin' : ' is no longer an admin'));
  }
}

/* ---------- admin settings ---------- */
function applySettings() {
  document.querySelectorAll('#reacts button').forEach(b => b.disabled = !isHost && !S.react); $('#msg').readOnly = !S.chat && !isHost; $('#msg').placeholder = S.chat || isHost ? 'Say something…' : 'Chat is turned off by the host';
  if (!isAdm()) {
    if (!S.mic) setTrack('audio', false); if (!S.cam) setTrack('video', false);
    $('#mic').disabled = !S.mic; $('#cmt').disabled = !S.cam;
  } else { $('#mic').disabled = $('#cmt').disabled = false }
  fbtn();
  for (const k in S) { const e = $('#s-' + k); if (e) e.checked = S[k] }
}
['chat', 'mic', 'cam', 'control', 'fctl', 'react', 'locked'].forEach(k => $('#s-' + k).onchange = e => {
  if (isHost) { S[k] = e.target.checked; bcast({ t: 'settings', S }); applySettings() }
  else send(hostConn, { t: 'setting', k, v: e.target.checked });
});

/* ---------- independent cam & mic buttons ---------- */
function updMediaBtns() {
  const at = local && local.getAudioTracks()[0], vt = local && local.getVideoTracks()[0];
  $('#mic').textContent = !at ? '🎤 Start Audio' : at.enabled ? '🎤 Mic On' : '🔇 Mic Off';
  $('#mic').classList.toggle('off', !!(at && !at.enabled));
  $('#cmt').textContent = !vt ? '📷 Start Video' : vt.enabled ? '📷 Video On' : '🚫 Video Off';
  $('#cmt').classList.toggle('off', !!(vt && !vt.enabled));
}
function setTrack(kind, on) {
  if (!local) return;
  (kind === 'audio' ? local.getAudioTracks() : local.getVideoTracks()).forEach(t => t.enabled = on);
  updMediaBtns();
}
function refreshCamCalls() {
  if (!local) return;
  for (const id in users) {
    if (id !== me.id && users[id].live) {
      if (calls['cam:' + id]) { try { calls['cam:' + id].close() } catch { } delete calls['cam:' + id] }
      callCam(id);
    }
  }
}
$('#mic').onclick = async () => {
  const at = local && local.getAudioTracks()[0];
  if (at) { at.enabled = !at.enabled; updMediaBtns(); return }
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (!local) local = s; else s.getAudioTracks().forEach(t => local.addTrack(t));
    addTile(me.id, local, true); updMediaBtns(); applySettings(); goLive(); refreshCamCalls();
  } catch { toast('Allow microphone access to start audio') }
};
$('#cmt').onclick = async () => {
  const vt = local && local.getVideoTracks()[0];
  if (vt) { vt.enabled = !vt.enabled; updMediaBtns(); return }
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } });
    if (!local) local = s; else s.getVideoTracks().forEach(t => local.addTrack(t));
    addTile(me.id, local, true); updMediaBtns(); applySettings(); goLive(); refreshCamCalls();
  } catch { toast('Allow camera access to start video') }
};
function callCam(id) {
  const c = peer.call(id, local, { metadata: { type: 'cam' } }); calls['cam:' + id] = c;
  c.on('stream', s => addTile(id, s)); c.on('close', () => delete calls['cam:' + id]); setTimeout(() => capCam(c), 1000);
}
function syncCalls() { if (local && users[me.id] && users[me.id].live) for (const id in users) if (id !== me.id && users[id].live && !calls['cam:' + id]) callCam(id) }
function onCall(call) {
  const t = call.metadata && call.metadata.type;
  if (t === 'movie') {
    call.answer(undefined, { sdpTransform: stereo });
    call.on('stream', s => {
      const g = $('#gv'); g.srcObject = s; g.muted = true; g.play().catch(() => { }); relayStream = s; kids.forEach(callKid);
      const ga = () => { gAudio = s.getAudioTracks(); wireGuestAudio(s); pickAudio(Math.max(0, Math.min(aSel, gAudio.length - 1))) }; ga(); s.onaddtrack = ga;
      setTimeout(() => { if (mode === 'file' && !g.videoWidth && Date.now() - (onCall.rs || 0) > 60000) { onCall.rs = Date.now(); send(hostConn, { t: 'resend' }) } }, 6000); smooth(call); send(hostConn, { t: 'ready' })
    });
  } else {
    call.answer(local || undefined); if (local) setTimeout(() => capCam(call), 1000);
    call.on('stream', s => addTile(call.peer, s)); call.on('close', () => dropTile(call.peer));
  }
}
function addTile(id, s, self) {
  let t = document.querySelector('.tile[data-id="' + id + '"]');
  if (!t) {
    t = document.createElement('div'); t.className = 'tile'; t.dataset.id = id;
    const v = document.createElement('video'); v.autoplay = true; v.playsInline = true; v.muted = !!self; v.dataset.self = self ? 1 : 0;
    const l = document.createElement('span'); l.textContent = self ? 'You' : (users[id] ? users[id].name : 'Guest');
    t.append(v, l); $('#tiles').append(t);
  }
  const v = t.querySelector('video'); v.srcObject = s; v.play().catch(() => sh($('#snd'), true));
}
function dropTile(id) { const t = document.querySelector('.tile[data-id="' + id + '"]'); t && t.remove() }
function dropPeer(id) { dropTile(id);['cam:', 'movie:'].forEach(p => { if (calls[p + id]) { calls[p + id].close(); delete calls[p + id] } }) }

/* ---------- what's playing ---------- */
function setMode(m, id) {
  mode = m; sh($('#ctl'), m === 'file'); sh($('#ph'), m === 'none'); sh($('#ytp'), m === 'yt'); sh($('#fvp'), m === 'file' && isHost); sh($('#gvp'), m === 'file' && !isHost);
  if (m !== 'yt' && ytOK) yt.pauseVideo();
  if (m !== 'file' && !isHost) { $('#gv').srcObject = null; relayStream = null; kids.clear(); Object.keys(calls).filter(k => k.startsWith('movie:')).forEach(k => { calls[k].close(); delete calls[k] }) }
  if (m === 'yt') loadYT(id); setLangs(); setAudioList();
}
function hostMode(m, id) { ytId = id || null; setMode(m, id); bcast({ t: 'mode', mode: m, id }) }

/* YouTube */
function ytReady(cb) {
  if (window.YT && YT.Player) return cb();
  const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.append(s);
  window.onYouTubeIframeAPIReady = cb;
}
function loadYT(id) {
  ytLangs = []; ytTracks.id = null;
  ytId = id;
  ytReady(() => {
    if (yt) { if (ytOK) yt.loadVideoById(id); return }
    yt = new YT.Player('yt', {
      playerVars: { rel: 0, playsinline: 1 }, events: {
        onReady: () => { ytOK = true; yt.loadVideoById(ytId); yt.setPlaybackQuality('hd1080') },
        onStateChange: e => {
          if (e.data === 1) ytTracks();
          if (applying || !(isAdm() || S.control)) return;
          if (e.data === 1 || e.data === 2) {
            const m = { t: 'yt', a: e.data === 1 ? 'play' : 'pause', time: yt.getCurrentTime() };
            isHost ? bcast(m) : send(hostConn, m);
          }
        }
      }
    });
  });
}
function applyYT(m) {
  if (!ytOK) return; applying = true;
  if (Math.abs(yt.getCurrentTime() - m.time) > 2.5) yt.seekTo(m.time, true);
  const st = yt.getPlayerState(), pause = m.a === 'pause' || (m.a === 'sync' && !m.playing);
  if (m.a === 'sync' && st === 3) return applying = false;
  if (pause) { if (st === 1) yt.pauseVideo() } else if (st !== 1) yt.playVideo();
  setTimeout(() => applying = false, 1000);
}
setInterval(() => { if (isHost && mode === 'yt' && ytOK) bcast({ t: 'yt', a: 'sync', time: yt.getCurrentTime(), playing: yt.getPlayerState() === 1 }) }, 4000);
$('#loadyt').onclick = () => {
  const r = $('#yturl').value.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  if (!r) return toast('That is not a valid YouTube link');
  if (isHost) { stopMovie(); hostMode('yt', r[1]) } else send(hostConn, { t: 'yturl', id: r[1] });
};

/* ---------- Video Loading & Browser-Cached Audio/Subtitles ---------- */
$('#pick').onclick = () => $('#file').click();
let lastFile = null, sc = null, rawVs = null, fvUrl = null, fvSrc = null, fvDst = null, fvGain = null, activeFFAud = null, activeFFSub = null;

$('#file').onchange = e => { if (e.target.files.length) loadVideoFile(e.target.files[0]); e.target.value = '' };

const ckey = f => f.size + '_' + f.lastModified;
async function cdir(f, create) { const r = await navigator.storage.getDirectory(), w = await r.getDirectoryHandle('wr-cache', { create: true }); return w.getDirectoryHandle(ckey(f), { create }) }
async function cput(f, name, data) { const d = await cdir(f, true), h = await d.getFileHandle(name, { create: true }), w = await h.createWritable(); await w.write(data); await w.close(); return h.getFile() }
async function cget(f) {
  const o = { audio: [], subs: [] };
  try { const d = await cdir(f, false); for await (const [n, h] of d.entries()) { if (n.startsWith('seg_')) continue; const x = await h.getFile(); (n.endsWith('.vtt') ? o.subs : o.audio).push(x) } } catch { }
  o.audio.sort((a, b) => a.name < b.name ? -1 : 1); o.subs.sort((a, b) => a.name < b.name ? -1 : 1); return o;
}
$('#clr').onclick = async () => { try { const r = await navigator.storage.getDirectory(); await r.removeEntry('wr-cache', { recursive: true }); toast('Saved browser audio and subtitles cleared') } catch { toast('Nothing saved yet') } };

let tracks = [], aSel = 0, aNames = [], gAudio = null;
const ctx = () => sc || (sc = { ac: new (window.AudioContext || window.webkitAudioContext)() });

function ensureFvAudio() {
  if (fvSrc) return;
  const ac = ctx().ac, v = $('#fv');
  fvSrc = ac.createMediaElementSource(v);
  fvDst = ac.createMediaStreamDestination();
  fvGain = ac.createGain();
  fvSrc.connect(feed(ac, fvDst, 1));
  fvSrc.connect(fvGain);
  fvGain.connect(ac.destination);
  fvGain.gain.value = tracks.length ? 0 : vol;
  v.onvolumechange = () => {
    if (v.muted) { v.muted = false; setVol(0, 1) }
    else if (Math.abs(v.volume - 1) > 0.01) { const nv = v.volume; v.volume = 1; setVol(nv, 1) }
  };
}

function addTrack(file, name) {
  const ac = ctx().ac, el = new Audio(), url = URL.createObjectURL(file);
  el.src = url; el.preload = 'auto';
  const src = ac.createMediaElementSource(el), dst = ac.createMediaStreamDestination(), g = ac.createGain();
  src.connect(feed(ac, dst, 1)); src.connect(g); g.connect(ac.destination);
  tracks.push({ el, url, src, dst, g, name }); ac.resume();
}

function attachAudioTrackDynamic(file, name) {
  const v = $('#fv'), wasEmpty = !tracks.length;
  addTrack(file, name);
  const tr = tracks[tracks.length - 1];
  tr.el.currentTime = v.currentTime || 0;
  tr.el.playbackRate = v.playbackRate || 1;
  if (wasEmpty) syncAudio(v);
  if (!v.paused) tr.el.play().catch(() => { });
  aNames = tracks.map(t => t.name);
  bcast({ t: 'alangs', names: aNames });
  setAudioList();
  pickAudio(wasEmpty ? 0 : aSel);
  applyVol();
  if (rawVs) {
    movieStream = new MediaStream([...rawVs.getVideoTracks(), ...tracks.map(t => t.dst.stream.getAudioTracks()[0])]);
    ready.clear(); parentOf = {}; bcast({ t: 'relay', reset: 1 }); Object.keys(conns).forEach(serve); updReady();
  }
}

function pickAudio(i) {
  aSel = i;
  if (isHost) {
    tracks.forEach((t, k) => t.g.gain.value = k === i ? vol : 0);
    if (fvGain) fvGain.gain.value = tracks.length ? 0 : vol;
  } else if (gAudio) {
    gAudio.forEach((t, k) => { t.enabled = k === i; if (gSrc[k]) gSrc[k].g.gain.value = k === i ? 1 : 0 });
  }
  $('#al').value = i;
}

function setAudioList() {
  const s = $('#al'); s.innerHTML = '';
  aNames.forEach((n, i) => { const o = document.createElement('option'); o.value = i; o.textContent = 'Audio: ' + n; s.append(o) });
  sh(s, aNames.length > 1 && mode === 'file'); s.value = aSel;
}
function osd(t) { const e = $('#osd'); e.textContent = t; sh(e, true); clearTimeout(osd.t); osd.t = setTimeout(() => sh(e, false), 1800) }
function chooseAudio(i) {
  pickAudio(i); osd('Audio: ' + (aNames[i] || ''));
}
$('#al').onchange = e => { chooseAudio(+e.target.value); e.target.blur() };

function syncAudio(v) {
  const els = () => tracks.map(t => t.el);
  const set = () => els().forEach(a => { a.currentTime = v.currentTime });
  const go = () => { if (syncAudio.hold) return; set(); els().forEach(a => a.play().catch(() => { })) };
  v.onplay = v.onplaying = go;
  v.onpause = v.onwaiting = () => els().forEach(a => a.pause());
  v.onseeked = () => { if (!syncAudio.hold) set() };
  v.onratechange = () => els().forEach(a => { a.playbackRate = v.playbackRate });
  clearInterval(syncAudio.t);
  syncAudio.t = setInterval(() => { if (!v.paused) els().forEach(a => { if (Math.abs(a.currentTime - v.currentTime) > .25) a.currentTime = v.currentTime }) }, 1000);
}

/* Unsupported Audio Popup Wiring */
$('#aud-no').onclick = () => $('#auddlg').close();
$('#aud-go').onclick = () => {
  $('#auddlg').close();
  fixAudio();
};

async function loadVideoFile(f) {
  if (!f) return;
  const c = await cget(f);
  lastFile = f; stopMovie(); resetCaps();
  sh($('#subx'), true); sh($('#fix'), true);
  if (c.subs.length) await addSubFiles(c.subs);

  ensureFvAudio();
  ctx().ac.resume();

  const v = $('#fv');
  fvUrl = URL.createObjectURL(f);
  v.src = fvUrl; v.muted = false; v.volume = 1;
  hostMode('file');

  c.audio.forEach(x => { const m = x.name.match(/.* - ([^.]+)\.\w+$/); addTrack(x, m ? m[1] : x.name.replace(/\.\w+$/, '')) });
  if (c.audio.length) toast('Loaded saved audio from browser — ready to play without conversion!');
  aNames = tracks.map(t => t.name); bcast({ t: 'alangs', names: aNames }); setAudioList(); pickAudio(0);
  if (tracks.length) syncAudio(v);

  syncAudio.hold = true;
  if (fvGain) fvGain.gain.value = 0; /* keep host speaker silent during initial stream/codec check */
  if (v.readyState < 2) await new Promise(r => { v.addEventListener('loadeddata', r, { once: true }); setTimeout(r, 6000) });
  const cap = v.captureStream || v.mozCaptureStream;
  if (!cap) { syncAudio.hold = false; applyVol(); return toast('Use Chrome, Edge or Firefox to stream files') }

  try { await v.play() } catch { }
  rawVs = cap.call(v);
  for (let i = 0; i < 20 && !rawVs.getVideoTracks().length; i++)await new Promise(r => setTimeout(r, 100));

  /* Let decoder run briefly to verify if native audio codec is supported */
  if (!tracks.length) await new Promise(r => setTimeout(r, 900));
  const bad = !tracks.length && ((v.webkitAudioDecodedByteCount !== undefined && v.webkitAudioDecodedByteCount === 0) || v.mozHasAudio === false || (v.audioTracks && v.audioTracks.length === 0));

  v.pause(); v.currentTime = 0; syncAudio.hold = false; applyVol();

  movieStream = tracks.length
    ? new MediaStream([...rawVs.getVideoTracks(), ...tracks.map(t => t.dst.stream.getAudioTracks()[0])])
    : new MediaStream([...rawVs.getVideoTracks(), ...fvDst.stream.getAudioTracks()]);

  ready.clear(); parentOf = {}; bcast({ t: 'relay', reset: 1 }); Object.keys(conns).forEach(serve); updReady();

  if (bad) {
    if (!$('#auddlg').open) $('#auddlg').showModal();
  } else if (!c.audio.length) {
    toast('Video ready! Press play once everyone is ready, or use 🎧 Extract Audio for dubbed tracks.', 4500);
  }
}

function callMovie(id) {
  if (!movieStream) return;
  if (calls['movie:' + id]) { try { calls['movie:' + id].close() } catch { } delete calls['movie:' + id] }
  const c = peer.call(id, movieStream, { metadata: { type: 'movie' }, sdpTransform: h264 }); calls['movie:' + id] = c;
  [800, 3000].forEach(ms => setTimeout(() => boost(c), ms));
}
function boost(c) {
  const q = +$('#q').value, h = $('#fv').videoHeight || q;
  try {
    c.peerConnection.getSenders().forEach(s => {
      if (!s.track || s.track.kind !== 'video') return;
      s.track.contentHint = 'motion';
      const p = s.getParameters(); p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
      p.encodings[0].maxBitrate = BR[q];
      p.encodings[0].scaleResolutionDownBy = h > q ? +(h / q).toFixed(2) : 1;
      p.encodings[0].maxFramerate = 24;
      p.degradationPreference = 'balanced'; p.encodings[0].priority = 'high'; p.encodings[0].networkPriority = 'high'; s.setParameters(p).catch(() => { });
    })
  } catch { }
}
function stopMovie() {
  if ($('#auddlg').open) $('#auddlg').close();
  if (activeFFAud) { try { activeFFAud.terminate() } catch { } activeFFAud = null; sh($('#cva'), false); $('#fix').disabled = false; $('#fix').textContent = '🎧 Extract Audio' }
  if (activeFFSub) { try { activeFFSub.terminate() } catch { } activeFFSub = null; sh($('#cvs'), false); $('#subx').disabled = false; $('#subx').textContent = '💬 Extract Captions' }
  Object.keys(calls).filter(k => k.startsWith('movie:')).forEach(k => { calls[k].close(); delete calls[k] });
  movieStream = null; rawVs = null; ready.clear(); updReady(); clearInterval(syncAudio.t);
  tracks.forEach(t => { t.el.pause(); t.el.removeAttribute('src'); if (t.url) URL.revokeObjectURL(t.url); try { t.src.disconnect() } catch { } }); tracks = [];
  const v = $('#fv'); v.onplay = v.onplaying = v.onpause = v.onwaiting = v.onseeked = v.onratechange = null; v.pause(); v.removeAttribute('src'); v.load();
  if (fvUrl) { URL.revokeObjectURL(fvUrl); fvUrl = null }
}

/* ---------- ready gate, reactions, playback smoothing ---------- */
function updReady() { const r = $('#rdy'); if (r) r.textContent = isHost && movieStream ? 'Ready: ' + ready.size + '/' + Object.keys(conns).length : '' }
function float(e) {
  const d = document.createElement('div'); d.className = 'fl'; d.textContent = e;
  d.style.left = (8 + Math.random() * 80) + '%';
  d.onanimationend = () => d.remove();
  $('#rx').append(d);
}
document.querySelectorAll('#reacts button').forEach(b => b.onclick = () => {
  const e = b.textContent; float(e); isHost ? bcast({ t: 'react', e }) : send(hostConn, { t: 'react', e });
});
function smooth(c) {
  [500, 2500].forEach(ms => setTimeout(() => {
    try {
      c.peerConnection.getReceivers().forEach(r => {
        if ('jitterBufferTarget' in r) r.jitterBufferTarget = 500; if ('playoutDelayHint' in r) r.playoutDelayHint = 0.5
      })
    } catch { }
  }, ms))
}
function capCam(c) {
  try {
    c.peerConnection.getSenders().forEach(s => {
      if (s.track && s.track.kind === 'video') {
        const p = s.getParameters(); p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}]; p.encodings[0].maxBitrate = 4e5; s.setParameters(p).catch(() => { })
      }
    })
  } catch { }
}
$('#q').onchange = () => Object.keys(calls).filter(k => k.startsWith('movie:')).forEach(k => boost(calls[k]));
$('#fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : $('#stage').requestFullscreen();

$('#gv').onclick = () => ctx().ac.resume();
$('#snd').onclick = () => { ctx().ac.resume(); document.querySelectorAll('.tile video').forEach(v => { v.muted = v.dataset.self === '1'; v.play().catch(() => { }) }); sh($('#snd'), false) };

/* ---------- Background Progress Helpers (Audio & Captions) ---------- */
function cvAud(p, t) {
  const e = $('#cva'); sh(e, true); e.classList.toggle('ind', p == null);
  $('#cvab').style.width = (p == null ? 100 : p) + '%'; $('#cvat').textContent = t;
}
function cvSub(p, t) {
  const e = $('#cvs'); sh(e, true); e.classList.toggle('ind', p == null);
  $('#cvsb').style.width = (p == null ? 100 : p) + '%'; $('#cvst').textContent = t;
}
function parseDurFromLogs(str) {
  const m = str.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0;
}
function parseTimeFromLog(str) {
  const m = str.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : -1;
}
async function createFFInstance(f, onLog, onProg) {
  const ff = new FFmpegWASM.FFmpeg(), { toBlobURL } = FFmpegUtil;
  if (onLog) ff.on('log', onLog);
  if (onProg) ff.on('progress', onProg);
  const C = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm/', W = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/';
  await ff.load({ classWorkerURL: await toBlobURL(W + '814.ffmpeg.js', 'text/javascript'), coreURL: await toBlobURL(C + 'ffmpeg-core.js', 'text/javascript'), wasmURL: await toBlobURL(C + 'ffmpeg-core.wasm', 'application/wasm') });
  const name = 'input.' + (f.name.split('.').pop() || 'mkv');
  await ff.createDir('/in'); await ff.mount('WORKERFS', { files: [new File([f], name)] }, '/in');
  return { ff, name };
}

function chooseTracks(list) {
  if (list.length === 1) return Promise.resolve([0]);
  return new Promise(res => {
    const d = document.createElement('dialog'), fm = document.createElement('form'); fm.method = 'dialog';
    fm.innerHTML = '<h3>🎧 Convert Audio Tracks</h3><p>Selected languages will convert in the background with a live percentage bar and stay saved in your browser for future rewatches.</p>';
    list.forEach(x => { const l = document.createElement('label'); l.className = 'opt'; l.innerHTML = '<input type="checkbox"><div></div>'; l.firstChild.checked = !x.done; l.firstChild.disabled = x.done; l.lastChild.textContent = x.n + ' (' + x.c + ')' + (x.done ? ' · already saved in browser' : ''); fm.append(l) });
    const r = document.createElement('div'); r.className = 'row'; r.innerHTML = '<button value="no">Cancel</button><button value="go" class="pri">🎧 Convert & Save in Browser</button>'; fm.append(r); d.append(fm); document.body.append(d);
    d.onclose = () => { res(d.returnValue === 'go' ? [...fm.querySelectorAll('input')].map((c, i) => c.checked && !c.disabled ? i : -1).filter(i => i >= 0) : []); d.remove() };
    d.showModal();
  });
}

/* ---------- Background Audio Extraction (Saved in Browser Storage) ---------- */
async function fixAudio() {
  const f = lastFile; if (!f) return toast('Choose a video file first');
  const b = $('#fix'); if (b.disabled) return;
  b.disabled = true; b.textContent = '🎧 Scanning…';
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    cvAud(null, '🎧 Loading audio converter…');
    const logs = [];
    let curBase = 0, curSpan = 100, totalDur = $('#fv').duration || 0, activeLabel = '';
    const updPct = rawP => {
      const clamped = Math.max(0, Math.min(99, Math.round(curBase + rawP * curSpan)));
      cvAud(clamped, `🎧 Converting ${activeLabel}… ${clamped}%`);
      b.textContent = `🎧 Audio ${clamped}%`;
    };
    const { ff, name } = await createFFInstance(f, ({ message }) => {
      logs.push(message);
      if (activeLabel && totalDur > 0) {
        const sec = parseTimeFromLog(message);
        if (sec >= 0) updPct(Math.min(0.99, sec / totalDur));
      }
    }, ({ progress, time }) => {
      if (!activeLabel) return;
      if (totalDur > 0 && time > 0) updPct(Math.min(0.99, (time / 1e6) / totalDur));
      else if (progress > 0 && progress <= 1) updPct(progress);
    });
    activeFFAud = ff;
    await ff.exec(['-i', '/in/' + name]);
    const joined = logs.join('\n');
    if (!totalDur || !isFinite(totalDur)) totalDur = parseDurFromLogs(joined) || 7200;
    const found = [];
    joined.replace(/Stream #0:(\d+)(?:\[[^\]]*\])?(?:\((\w+)\))?[^\n]*?: Audio: (\w+)([^\n]*)/g, (m, i, l, c, rest) => {
      if (found.length < 8) found.push({ i: +i, l: l || 'und', c: c.toLowerCase(), stereo: /\b(?:stereo|mono)\b/i.test(rest) })
    });
    if (!found.length) throw new Error('no audio tracks found in this video');
    const names = [];
    found.forEach(x => { let n = nice(x.l), k = 2; while (names.includes(n)) n = nice(x.l) + ' ' + k++; names.push(n) });
    const saved = await cget(f), savedNames = new Set(saved.audio.map(a => a.name));
    const sel = await chooseTracks(found.map((x, k) => ({
      ...x,
      n: names[k],
      done: savedNames.has('aud ' + String(k + 1).padStart(2, '0') + ' - ' + names[k] + '.m4a')
    })));
    if (!sel.length) {
      sh($('#cva'), false); b.disabled = false; b.textContent = '🎧 Extract Audio';
      ff.terminate(); activeFFAud = null; return;
    }

    for (let sIdx = 0; sIdx < sel.length; sIdx++) {
      if (lastFile !== f) return;
      const k = sel[sIdx], tr = found[k], trName = names[k], out = 'a' + k + '.m4a';
      const cacheName = 'aud ' + String(k + 1).padStart(2, '0') + ' - ' + trName + '.m4a';
      curBase = (sIdx / sel.length) * 100;
      curSpan = (1 / sel.length) * 100;
      activeLabel = trName + ` (${sIdx + 1}/${sel.length})`;
      updPct(0);
      let code = 1;
      if (tr.c === 'aac' && tr.stereo) {
        code = await ff.exec(['-loglevel', 'info', '-i', '/in/' + name, '-map', '0:' + tr.i, '-vn', '-c:a', 'copy', out]);
      }
      if (code !== 0) {
        code = await ff.exec(['-loglevel', 'info', '-i', '/in/' + name, '-map', '0:' + tr.i, '-vn', '-c:a', 'aac', '-aac_coder', 'fast', '-b:a', '128k', '-ac', '2', '-ar', '48000', out]);
      }
      if (code !== 0) throw new Error('failed to convert ' + trName);
      const data = await ff.readFile(out);
      await ff.deleteFile(out);
      const savedFile = await cput(f, cacheName, data);
      if (lastFile === f) attachAudioTrackDynamic(savedFile, trName);
    }
    activeLabel = '';
    cvAud(100, '🎧 Audio converted & saved in browser (100%)');
    b.textContent = '🎧 Audio 100%';
    toast('Audio converted and saved in browser for instant rewatch!');
    setTimeout(() => { sh($('#cva'), false); b.textContent = '🎧 Extract Audio' }, 2500);
    ff.terminate(); activeFFAud = null;
  } catch (e) {
    if (activeFFAud) { try { activeFFAud.terminate() } catch { } activeFFAud = null }
    sh($('#cva'), false);
    toast('Audio conversion failed: ' + (e.message || e), 8000);
    b.textContent = '🎧 Extract Audio';
  }
  b.disabled = false;
}
$('#fix').onclick = fixAudio;

/* ---------- Background Caption Extraction (Saved in Browser Storage) ---------- */
async function extractSubs() {
  const f = lastFile; if (!f) return toast('Choose a video file first');
  const b = $('#subx'); if (b.disabled) return;
  b.disabled = true; b.textContent = '💬 Scanning…';
  try {
    cvSub(null, '💬 Loading caption extractor…');
    const logs = [];
    let totalDur = $('#fv').duration || 0, extracting = false;
    const updPct = rawP => {
      const pct = Math.max(0, Math.min(99, Math.round(rawP * 100)));
      cvSub(pct, `💬 Extracting captions in background… ${pct}%`);
      b.textContent = `💬 Captions ${pct}%`;
    };
    const { ff, name } = await createFFInstance(f, ({ message }) => {
      logs.push(message);
      if (extracting && totalDur > 0) {
        const sec = parseTimeFromLog(message);
        if (sec >= 0) updPct(Math.min(0.99, sec / totalDur));
      }
    }, ({ progress, time }) => {
      if (!extracting) return;
      if (totalDur > 0 && time > 0) updPct(Math.min(0.99, (time / 1e6) / totalDur));
      else if (progress > 0 && progress <= 1) updPct(progress);
    });
    activeFFSub = ff;
    await ff.exec(['-i', '/in/' + name]);
    const joined = logs.join('\n');
    if (!totalDur || !isFinite(totalDur)) totalDur = parseDurFromLogs(joined) || 7200;
    const found = [];
    joined.replace(/Stream #0:(\d+)(?:\[[^\]]*\])?(?:\((\w+)\))?[^\n]*?: Subtitle: (\w+)/g, (m, i, l, c) => { if (!/pgs|dvd|dvb|xsub/i.test(c)) found.push({ i: +i, l: l || 'und' }) });
    if (!found.length) throw new Error('no text subtitles found (image-based subtitles cannot be converted)');
    const args = ['-loglevel', 'info', '-i', '/in/' + name];
    found.forEach((x, k) => args.push('-map', '0:' + x.i, '-c:s', 'webvtt', 's' + k + '.vtt'));
    extracting = true;
    updPct(0);
    const code = await ff.exec(args);
    if (code) throw new Error('could not read the subtitles (exit ' + code + ')');
    for (let k = 0; k < found.length; k++) {
      const t = new TextDecoder().decode(await ff.readFile('s' + k + '.vtt'));
      await ff.deleteFile('s' + k + '.vtt');
      if (lastFile === f) addSubs(found[k].l, t);
      cput(f, 'sub ' + String(k + 1).padStart(2, '0') + ' - ' + nice(found[k].l) + '.vtt', t).catch(() => { });
    }
    extracting = false;
    cvSub(100, '💬 Captions extracted & saved in browser (100%)');
    b.textContent = '💬 Captions 100%';
    setTimeout(() => { sh($('#cvs'), false); b.textContent = '💬 Extract Captions' }, 2500);
    ff.terminate(); activeFFSub = null;
  } catch (e) {
    if (activeFFSub) { try { activeFFSub.terminate() } catch { } activeFFSub = null }
    sh($('#cvs'), false);
    toast('Could not extract captions: ' + (e.message || e), 8000);
    b.textContent = '💬 Extract Captions';
  }
  b.disabled = false;
}
$('#subx').onclick = extractSubs;

/* ---------- roles & room lifetime ---------- */
let fplaying = false;
const adm = id => !!(users[id] && (users[id].admin || users[id].host)), isAdm = () => isHost || adm(me.id);
function applyRole() {
  const a = isAdm(); sh($('#tabadm'), a); sh($('#bar'), a);
  document.querySelectorAll('#bar .ho,#adm .ho').forEach(e => {
    if (['fix', 'subx'].includes(e.id)) e.hidden = !isHost || !lastFile;
    else e.hidden = !isHost;
  });
  if (!a && !$('#adm').hidden) $('#tabchat').click();
  applySettings();
}
function fbtn() { sh($('#gp'), !isHost && (S.fctl || isAdm())); $('#gp').textContent = fplaying ? '⏸️ Pause' : '▶️ Play' }
$('#gp').onclick = () => send(hostConn, { t: 'film', a: fplaying ? 'pause' : 'play' });
['play', 'pause'].forEach(ev => $('#fv').addEventListener(ev, () => bcast({ t: 'fstate', playing: !$('#fv').paused })));

let wl = null;
async function keepAwake() { try { wl = await navigator.wakeLock.request('screen') } catch { } }
document.addEventListener('visibilitychange', () => { if (isHost && document.visibilityState === 'visible') keepAwake() });
function closeRoom() {
  Object.values(conns).forEach(c => c.close());
  try { peer.destroy() } catch { }
  history.replaceState(null, '', location.pathname + location.search); location.reload();
}
$('#leave').onclick = () => { if (!isHost || confirm('End the room for everyone? The room code and invite link will stop working.')) closeRoom() };
window.addEventListener('beforeunload', () => { if (peer && !peer.destroyed) try { peer.destroy() } catch { } });

/* ---------- captions (each viewer picks their own on/off and language) ---------- */
let caps = {}, fileLangs = [], cueNow = {}, ccOn = false, ccLang = '', ytLangs = [];
const nice = c => { try { return c.length <= 3 ? new Intl.DisplayNames(['en'], { type: 'language' }).of(c) || c : c } catch { return c } };
function parseSub(txt) {
  const tc = x => { const m = x.trim().match(/(?:(\d+):)?(\d+):(\d+)[,.](\d+)/); return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+('0.' + m[4])) };
  return txt.replace(/\r/g, '').replace(/^\uFEFF/, '').split(/\n\n+/).map(b => {
    const l = b.split('\n'), i = l.findIndex(x => x.includes('-->')); if (i < 0) return null;
    const [a, z] = l[i].split('-->');
    return { s: tc(a), e: tc(z), t: l.slice(i + 1).join('\n').replace(/<[^>]+>|\{[^}]*\}/g, '').trim() };
  }).filter(c => c && c.t);
}
function addSubs(code, text) {
  let name = nice(code), n = 2; while (caps[name]) name = nice(code) + ' ' + n++;
  caps[name] = parseSub(text); fileLangs = Object.keys(caps);
  bcast({ t: 'langs', langs: fileLangs }); setLangs(); toast('Captions ready: ' + name);
}
async function addSubFiles(fs) { for (const f of fs) { const m = f.name.match(/[.\s_-]([A-Za-z]{2,12})\.(?:srt|vtt)$/i); addSubs(m ? m[1] : f.name.replace(/\.\w+$/, ''), await f.text()) } }
function resetCaps() { caps = {}; fileLangs = []; cueNow = {}; bcast({ t: 'langs', langs: [] }); bcast({ t: 'cue', c: {} }); setLangs() }
setInterval(() => {
  if (!isHost || mode !== 'file') return; const ks = Object.keys(caps); if (!ks.length) return;
  const t = $('#fv').currentTime, c = {}; let ch = ks.length !== Object.keys(cueNow).length;
  ks.forEach(k => { const x = caps[k].find(q => t >= q.s && t < q.e); c[k] = x ? x.t : ''; if (c[k] !== cueNow[k]) ch = true });
  if (ch) { cueNow = c; bcast({ t: 'cue', c }); renderCap() }
}, 200);
function ytTracks() {
  if (ytTracks.id === ytId) return; ytTracks.id = ytId;
  try { yt.loadModule('captions') } catch { }
  setTimeout(() => {
    try {
      ytLangs = (yt.getOption('captions', 'tracklist') || []).map(x => ({ v: x.languageCode, l: x.languageName || x.displayName || x.languageCode }));
      if (!(ccOn && ccLang)) yt.unloadModule('captions');
      setLangs();
    } catch { }
  }, 700);
}
function setLangs() {
  const list = mode === 'yt' ? ytLangs : mode === 'file' ? fileLangs.map(k => ({ v: k, l: k })) : [], sel = $('#cl');
  sel.innerHTML = ''; list.forEach(o => { const e = document.createElement('option'); e.value = o.v; e.textContent = o.l; sel.append(e) });
  if (!list.some(o => o.v === ccLang)) ccLang = list.length ? list[0].v : '';
  sel.value = ccLang; sh(sel, list.length > 0); applyCC();
}
function applyCC() {
  const on = ccOn && !!ccLang; $('#cc').textContent = on ? '💬 Captions: On' : '💬 Captions: Off'; $('#cc').classList.toggle('on', on);
  if (mode === 'yt' && ytOK) { try { if (on) { yt.loadModule('captions'); yt.setOption('captions', 'track', { languageCode: ccLang }) } else yt.unloadModule('captions') } catch { } }
  renderCap();
}
function renderCap() { const e = $('#cap'), t = mode === 'file' && ccOn ? cueNow[ccLang] || '' : ''; e.textContent = t; sh(e, !!t) }
$('#cc').onclick = () => {
  if (!ccOn && !ccLang) return toast(isHost ? 'No captions loaded yet. Click 💬 Extract Captions to pull subtitles from the video.' : 'No captions available for this video');
  ccOn = !ccOn; applyCC();
};
$('#cl').onchange = e => { ccLang = e.target.value; ccOn = true; applyCC(); e.target.blur() };

let idleT = null;
function wakeStage() {
  const s = $('#stage'); s.classList.remove('idle'); clearTimeout(idleT);
  if (document.fullscreenElement === s) idleT = setTimeout(() => s.classList.add('idle'), 5000);
}
['mousemove', 'mousedown', 'touchstart', 'keydown'].forEach(ev => document.addEventListener(ev, wakeStage, { passive: true }));

document.addEventListener('fullscreenchange', () => {
  const e = document.fullscreenElement, box = $('#ccbox'), dock = $('#dock');
  if (e === $('#fv') || e === $('#gv')) { document.exitFullscreen().then(() => $('#stage').requestFullscreen()).catch(() => { }); return }
  if (e === $('#stage')) $('#ctl').prepend(box); else if (box.parentNode !== dock) dock.insertBefore(box, dock.querySelector('.sp'));
  wakeStage();
});

function cycleCC() {
  const o = [...$('#cl').options]; if (!o.length) return osd('No subtitles available');
  const v = o.map(x => x.value);
  if (!ccOn) { ccOn = true; ccLang = v[0] } else { const i = v.indexOf(ccLang); if (i >= v.length - 1) ccOn = false; else ccLang = v[i + 1] }
  $('#cl').value = ccLang; applyCC();
  osd(ccOn ? 'Subtitles: ' + $('#cl').selectedOptions[0].textContent : 'Subtitles: Off');
}
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || (e.target.closest && e.target.closest('input,textarea,select,dialog,[contenteditable]'))) return;
  const k = e.key.toLowerCase();
  if (k === 'b') {
    if (mode !== 'file') return;
    if (aNames.length < 2) return osd('This movie has only one audio track');
    chooseAudio((aSel + (e.shiftKey ? -1 : 1) + aNames.length) % aNames.length);
  } else if (k === 'v') cycleCC();
  else if (k === 'arrowup' || k === 'arrowdown') { if (e.target.closest && e.target.closest('video')) return; e.preventDefault(); setVol(vol + (k === 'arrowup' ? .05 : -.05), 1) }
  else if (k === 'm') { if (vol > 0) { pre = vol; setVol(0, 1) } else setVol(pre || 1, 1) }
});

/* ---------- your own volume + bigger rooms ---------- */
let vol = 1, pre = 1, gOut = null, gSrc = [], relayStream = null, parentOf = {}; const kids = new Set(), FAN = 30, MAXLIVE = 8;
try { vol = +(localStorage.getItem('wr-vol') || 1) } catch { }
const stereo = sdp => sdp.replace(/(a=fmtp:\d+ [^\r\n]*useinbandfec=1)/g, '$1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000');
const h264 = sdp => {
  const pts = [...sdp.matchAll(/a=rtpmap:(\d+) H264\/90000/g)].map(m => m[1]); if (!pts.length) return sdp;
  return sdp.replace(/m=video (\d+) ([\w/]+) ([\d ]+)/, (m, p, q, l) => 'm=video ' + p + ' ' + q + ' ' + [...pts, ...l.trim().split(' ').filter(x => !pts.includes(x))].join(' '))
};
function feed(ac, dst, b) { const g = ac.createGain(); g.gain.value = b || 1; g.connect(dst); return g }
function setVol(x, say) { vol = Math.max(0, Math.min(3, x)); try { localStorage.setItem('wr-vol', vol) } catch { } $('#vol').value = vol; applyVol(); if (say) osd(vol ? 'Volume ' + Math.round(vol * 100) + '%' : 'Muted') }
function applyVol() {
  if (isHost) {
    tracks.forEach((t, k) => t.g.gain.value = k === aSel ? vol : 0);
    if (fvGain && !syncAudio.hold) fvGain.gain.value = tracks.length ? 0 : vol;
  }
  if (gOut) gOut.gain.value = vol;
}
function wireGuestAudio(s) {
  const ac = ctx().ac;
  if (!gOut) { gOut = ac.createGain(); gOut.connect(ac.destination) }
  gSrc.forEach(x => { try { x.n.disconnect(); x.g.disconnect() } catch { } });
  gSrc = s.getAudioTracks().map((t, k) => {
    const n = ac.createMediaStreamSource(new MediaStream([t])), g = ac.createGain();
    g.gain.value = k === aSel ? 1 : 0;
    n.connect(g); g.connect(gOut);
    return { n, g };
  });
  gOut.gain.value = vol; ac.resume(); if (ac.state !== 'running') sh($('#snd'), true);
}
$('#vol').oninput = e => setVol(+e.target.value);
function serve(id) {
  const n = q => Object.keys(parentOf).filter(k => parentOf[k] === q).length;
  let q = me.id; if (n(me.id) >= FAN) q = Object.keys(parentOf).find(g => conns[g] && n(g) < FAN) || me.id;
  parentOf[id] = q;
  if (q === me.id) callMovie(id); else send(conns[q], { t: 'relay', to: id });
}
function reparent(gone) { delete parentOf[gone]; if (!movieStream) return; Object.keys(parentOf).filter(k => parentOf[k] === gone).forEach(k => { delete parentOf[k]; serve(k) }) }
function callKid(k) {
  if (!relayStream) return; try { calls['movie:' + k] && calls['movie:' + k].close() } catch { }
  const c = peer.call(k, relayStream, { metadata: { type: 'movie' }, sdpTransform: h264 }); calls['movie:' + k] = c;[800, 3000].forEach(ms => setTimeout(() => boost(c), ms));
}
function goLive() { if (isHost) { users[me.id].live = true; bcast({ t: 'users', users }); renderUsers(); syncCalls() } else send(hostConn, { t: 'live' }) }
setVol(vol);

/* ---------- wiring ---------- */
$('#create').onclick = () => start(true); $('#join').onclick = () => start(false);
$('#cf').onsubmit = e => { e.preventDefault(); sendChat(); $('#msg').focus() };
$('#theatre').onclick = () => document.body.classList.toggle('theatre');
$('#copy').onclick = () => navigator.clipboard.writeText(invite).then(() => toast('Invite link copied'));
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  ['chat', 'ppl', 'adm'].forEach(p => sh($('#' + p), p === b.dataset.tab));
  if (b.dataset.tab === 'chat') { unread = 0; $('#tabchat').textContent = '💬 Chat' }
});
if (location.hash.length > 1) { $('#code').value = location.hash.slice(1); $('#name').focus() }