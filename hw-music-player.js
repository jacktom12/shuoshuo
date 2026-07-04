(function () {
  const NETEASE_SONG_INFO_API = (id) => `https://api.injahow.cn/meting/?server=netease&type=song&id=${id}&format=json`;
  const NETEASE_LRC_API = (id) => `https://api.injahow.cn/meting/?server=netease&type=lrc&id=${id}`;
  const NETEASE_PLAYLIST_API = (id) => `https://api.injahow.cn/meting/?server=netease&type=playlist&id=${id}`;
  const LIKE_STORAGE_KEY = 'hwPlayerLikes';

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.87l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"/></svg>',
    heartFilled: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3"/><path d="M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 4l3 3l-3 3"/><path d="M18 20l3 -3l-3 -3"/><path d="M3 7h3a5 5 0 0 1 5 5a5 5 0 0 0 5 5h5"/><path d="M21 7h-5a4.978 4.978 0 0 0 -3 1"/><path d="M3 17h3a4.984 4.984 0 0 0 3 -1"/></svg>',
    lyrics: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h13"/></svg>',
  };

  const metaCache = new Map();
  const lyricsCache = new Map();
  const playlistCache = new Map();
  let uidSeq = 0;

  const state = { activeId: null, source: null, isPlaying: false, duration: 0, position: 0, queue: null };
  const positions = new Map();
  const repeatFlags = new Map();

  let audioEl = null;
  let audioLoadedTrackId = null;
  let loadGeneration = 0;

  function isRepeatOn(trackId) { return !!repeatFlags.get(trackId); }
  function setRepeat(trackId, on) {
    repeatFlags.set(trackId, on);
    if (state.activeId === trackId && state.source === 'netease' && audioEl && !state.queue) audioEl.loop = on;
  }

  function ensureAudioEl() {
    if (audioEl) return audioEl;
    audioEl = document.createElement('audio');
    audioEl.id = 'hwGlobalAudio';
    audioEl.style.display = 'none';
    audioEl.preload = 'none';
    document.body.appendChild(audioEl);
    audioEl.addEventListener('timeupdate', () => {
      state.duration = (audioEl.duration || 0) * 1000;
      state.position = (audioEl.currentTime || 0) * 1000;
      broadcast();
    });
    audioEl.addEventListener('play', () => { state.isPlaying = true; broadcast(); });
    audioEl.addEventListener('pause', () => { state.isPlaying = false; broadcast(); });
    audioEl.addEventListener('ended', () => {
      positions.delete(state.activeId);
      if (state.queue) advanceQueue();
      else { state.isPlaying = false; state.position = 0; broadcast(); }
    });
    return audioEl;
  }

  function broadcast() { document.dispatchEvent(new CustomEvent('hwplayer:update', { detail: { ...state } })); }

  function saveCurrentPosition() {
    if (!state.activeId) return;
    let pos = state.position;
    if (audioEl && state.source === 'netease') pos = audioEl.currentTime * 1000;
    if (pos > 0) positions.set(state.activeId, pos);
  }
  function getSavedPosition(trackId) { return positions.get(trackId) || 0; }

  function switchToNetease(meta, queueCtx) {
    ensureAudioEl();
    saveCurrentPosition();

    const myGen = ++loadGeneration;
    const resumeMs = getSavedPosition(meta.trackId);
    state.activeId = meta.trackId;
    state.source = 'netease';
    state.duration = 0;
    state.position = resumeMs;
    state.isPlaying = false;
    state.queue = queueCtx || null;
    broadcast();

    let loopFlag = false;
    if (queueCtx) {
      const pls = getPlaylistState(queueCtx.listId);
      loopFlag = pls.repeatMode === 'one';
    } else {
      loopFlag = isRepeatOn(meta.trackId);
    }
    audioEl.loop = loopFlag;

    const startPlayback = () => {
      if (myGen !== loadGeneration) return;
      audioEl.currentTime = resumeMs / 1000;
      audioEl.play().catch(() => {});
    };

    if (audioLoadedTrackId === meta.trackId && audioEl.src) { startPlayback(); return; }
    audioLoadedTrackId = meta.trackId;
    audioEl.src = meta.audioUrl;
    audioEl.load();
    if (audioEl.readyState >= 1) startPlayback();
    else audioEl.addEventListener('loadedmetadata', startPlayback, { once: true });
  }

  function togglePauseCurrent() { if (audioEl) { audioEl.paused ? audioEl.play().catch(() => {}) : audioEl.pause(); } }

  function playTrack(meta, queueCtx) {
    const isSameActiveTrack = state.activeId === meta.trackId && !queueCtx && !state.queue;
    if (isSameActiveTrack) { togglePauseCurrent(); return; }
    switchToNetease(meta, queueCtx || null);
  }

  function loadLikes() { try { return new Set(JSON.parse(localStorage.getItem(LIKE_STORAGE_KEY) || '[]')); } catch (e) { return new Set(); } }
  function saveLikes(set) { try { localStorage.setItem(LIKE_STORAGE_KEY, JSON.stringify([...set])); } catch (e) {} }
  const likedTracks = loadLikes();
  function isLiked(trackId) { return likedTracks.has(trackId); }
  function toggleLike(trackId) {
    if (likedTracks.has(trackId)) likedTracks.delete(trackId); else likedTracks.add(trackId);
    saveLikes(likedTracks);
    document.dispatchEvent(new CustomEvent('hwplayer:like-update', { detail: { trackId, liked: likedTracks.has(trackId) } }));
  }

  function parseNeteaseId(url) { const m = url.match(/[?&]id=(\d+)/); return m ? m[1] : null; }

  async function fetchNeteaseMeta(url) {
    const id = parseNeteaseId(url);
    if (!id) throw new Error('无法解析网易云歌曲 ID');
    const res = await fetch(NETEASE_SONG_INFO_API(id));
    const json = await res.json();
    const data = Array.isArray(json) ? json[0] : json;
    if (!data || !data.url) throw new Error('网易云元数据获取失败');
    return { neteaseId: id, trackId: 'ne-' + id, title: data.name || '未知歌曲', artist: data.artist || '未知歌手', album: data.album || '', cover: data.pic || '', audioUrl: data.url };
  }

  async function getMeta(rawUrl) {
    if (metaCache.has(rawUrl)) return metaCache.get(rawUrl);
    const p = fetchNeteaseMeta(rawUrl).catch((err) => ({
      trackId: 'err-' + (uidSeq++), title: '加载失败', artist: String(err.message || err), album: '', cover: '', audioUrl: ''
    }));
    metaCache.set(rawUrl, p);
    return p;
  }

  function parseLRC(lrcText) {
    if (!lrcText) return [];
    const lines = lrcText.split('\n');
    const timeTag = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    const result = [];
    for (const line of lines) {
      const tags = [...line.matchAll(timeTag)];
      if (!tags.length) continue;
      const text = line.replace(timeTag, '').trim();
      if (!text) continue;
      for (const t of tags) {
        const min = parseInt(t[1], 10), sec = parseInt(t[2], 10);
        const ms = t[3] ? parseInt(t[3].padEnd(3, '0'), 10) : 0;
        result.push({ time: min * 60000 + sec * 1000 + ms, text });
      }
    }
    result.sort((a, b) => a.time - b.time);
    return result;
  }

  async function getLyricsByNeteaseId(neteaseId) {
    if (lyricsCache.has(neteaseId)) return lyricsCache.get(neteaseId);
    const p = (async () => {
      try {
        const res = await fetch(NETEASE_LRC_API(neteaseId));
        const lrcText = await res.text();
        return { lines: parseLRC(lrcText) };
      } catch (e) { return { lines: [] }; }
    })();
    lyricsCache.set(neteaseId, p);
    return p;
  }

  async function fetchPlaylist(listId) {
    if (playlistCache.has(listId)) return playlistCache.get(listId);
    const p = (async () => {
      try {
        const res = await fetch(NETEASE_PLAYLIST_API(listId));
        const json = await res.json();
        const arr = Array.isArray(json) ? json : [];
        const tracks = arr.map((item) => {
          const idMatch = (item.url || '').match(/[?&]id=(\d+)/);
          const neteaseId = idMatch ? idMatch[1] : null;
          return { neteaseId, trackId: 'ne-' + (neteaseId || uidSeq++), title: item.name || '未知歌曲', artist: item.artist || '未知歌手', cover: item.pic || '', audioUrl: item.url || '' };
        }).filter((t) => t.audioUrl);
        return { ok: true, tracks };
      } catch (e) { return { ok: false, tracks: [], error: String(e.message || e) }; }
    })();
    playlistCache.set(listId, p);
    return p;
  }

  function buildOrder(len, shuffle) {
    const arr = Array.from({ length: len }, (_, i) => i);
    if (!shuffle) return arr;
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }

  const playlistStates = new Map();
  function getPlaylistState(listId) {
    if (!playlistStates.has(listId)) playlistStates.set(listId, { tracks: [], order: [], posInOrder: 0, shuffle: false, repeatMode: 'off', lastPlayedIndex: null });
    return playlistStates.get(listId);
  }

  function playFromPlaylist(listId, trackIndex) {
    const pls = getPlaylistState(listId);
    const track = pls.tracks[trackIndex];
    if (!track) return;
    const orderPos = pls.order.indexOf(trackIndex);
    pls.posInOrder = orderPos >= 0 ? orderPos : 0;
    pls.lastPlayedIndex = trackIndex;
    switchToNetease(track, { listId, index: trackIndex });
    document.dispatchEvent(new CustomEvent('hwplayer:queue-change', { detail: { listId } }));
  }

  function advanceQueue() {
    const ctx = state.queue;
    if (!ctx) return;
    const pls = getPlaylistState(ctx.listId);
    let nextOrderPos = pls.posInOrder + 1;
    if (nextOrderPos >= pls.order.length) {
      if (pls.repeatMode === 'all') nextOrderPos = 0;
      else { state.isPlaying = false; state.position = 0; state.queue = null; broadcast(); return; }
    }
    pls.posInOrder = nextOrderPos;
    playFromPlaylist(ctx.listId, pls.order[nextOrderPos]);
  }

  function togglePlaylistShuffle(listId) {
    const pls = getPlaylistState(listId);
    pls.shuffle = !pls.shuffle;
    const currentTrackIndex = state.queue && state.queue.listId === listId ? state.queue.index : null;
    pls.order = buildOrder(pls.tracks.length, pls.shuffle);
    if (currentTrackIndex !== null) {
      const pos = pls.order.indexOf(currentTrackIndex);
      if (pos > 0) { pls.order.splice(pos, 1); pls.order.unshift(currentTrackIndex); }
      pls.posInOrder = 0;
    }
    document.dispatchEvent(new CustomEvent('hwplayer:queue-change', { detail: { listId } }));
  }

  function cyclePlaylistRepeat(listId) {
    const pls = getPlaylistState(listId);
    const modes = ['off', 'all', 'one'];
    pls.repeatMode = modes[(modes.indexOf(pls.repeatMode) + 1) % modes.length];
    if (audioEl && state.queue && state.queue.listId === listId) {
      audioEl.loop = pls.repeatMode === 'one';
    }
    document.dispatchEvent(new CustomEvent('hwplayer:queue-change', { detail: { listId } }));
  }

  const SHORTCODE_SONG_RE = /\{\{<\s*music\s+url=["']([^"']+)["']\s*>\}\}/g;
  const SHORTCODE_LIST_RE = /\{\{<\s*musiclist\s+id=["']([^"']+)["']\s*>\}\}/g;
  function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function parseShortcodes(text) {
    if (!text) return text;
    let out = text;
    if (SHORTCODE_SONG_RE.test(out)) {
      SHORTCODE_SONG_RE.lastIndex = 0;
      out = out.replace(SHORTCODE_SONG_RE, (_, url) => { const mountId = 'hwmount-' + (uidSeq++); return `\n<div class="hw-player-mount" data-hw-url="${escapeAttr(url)}" data-hw-mount-id="${mountId}"></div>\n`; });
    }
    if (SHORTCODE_LIST_RE.test(out)) {
      SHORTCODE_LIST_RE.lastIndex = 0;
      out = out.replace(SHORTCODE_LIST_RE, (_, listId) => { const mountId = 'hwlistmount-' + (uidSeq++); return `\n<div class="hw-playlist-mount" data-hw-list-id="${escapeAttr(listId)}" data-hw-mount-id="${mountId}"></div>\n`; });
    }
    return out;
  }

  function skeletonHTML() { return `<div class="hw-player hw-player-loading"><div class="hw-note-corner">♪</div><div class="hw-player-head"><div class="hw-disc-wrap"><div class="hw-disc"></div></div></div><div class="hw-meta"><div class="hw-title">加载中…</div></div></div>`; }

  function cardHTML(meta) {
    const cover = meta.cover || '';
    const liked = isLiked(meta.trackId);
    const repeatOn = isRepeatOn(meta.trackId);
    return `<div class="hw-player" data-track-id="${meta.trackId}">
      <div class="hw-note-corner">♪</div>
      <div class="hw-view-normal">
        <div class="hw-player-head">
          <div class="hw-disc-wrap"><div class="hw-disc" style="${cover ? `background-image:url('${escapeAttr(cover)}')` : ''}"></div></div>
          <div class="hw-cover">${cover ? `<img class="hw-cover-img" src="${escapeAttr(cover)}" alt="">` : ''}</div>
        </div>
        <div class="hw-meta">
          <div class="hw-title">${escapeAttr(meta.title)}</div>
          <div class="hw-artist">${escapeAttr(meta.artist || '')}</div>
          ${meta.album ? `<div class="hw-album">${escapeAttr(meta.album)}</div>` : ''}
        </div>
      </div>
      <div class="hw-view-lyrics"><div class="hw-lyrics-scroll-full"><div class="hw-lyrics-empty">点击加载歌词…</div></div></div>
      <div class="hw-progress-row">
        <span class="hw-time hw-cur">00:00</span>
        <input type="range" class="hw-progress" min="0" max="1000" value="0">
        <span class="hw-time hw-dur">00:00</span>
      </div>
      <div class="hw-controls">
        <button class="hw-btn hw-like${liked ? ' active' : ''}" title="喜欢">${liked ? ICONS.heartFilled : ICONS.heart}</button>
        <button class="hw-btn hw-lyrics-toggle" title="歌词">${ICONS.lyrics}</button>
        <button class="hw-btn hw-play" title="播放/暂停">${ICONS.play}</button>
        <button class="hw-btn hw-repeat${repeatOn ? ' active' : ''}" title="单曲循环">${ICONS.repeat}</button>
      </div>
    </div>`;
  }

  function fmtTime(ms) {
    if (!ms || isNaN(ms)) return '00:00';
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), ss = s % 60;
    return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  function refreshCardUI(cardEl, meta) {
    const isActive = state.activeId === meta.trackId && !state.queue;
    const playBtn = cardEl.querySelector('.hw-play');
    const discWrap = cardEl.querySelector('.hw-disc-wrap');
    const progress = cardEl.querySelector('.hw-progress');
    const cur = cardEl.querySelector('.hw-cur');
    const dur = cardEl.querySelector('.hw-dur');
    const playing = isActive && state.isPlaying;
    playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;
    discWrap.classList.toggle('spinning', playing);
    if (isActive) {
      const pct = state.duration ? (state.position / state.duration) * 1000 : 0;
      progress.value = Math.min(1000, Math.max(0, pct));
      cur.textContent = fmtTime(state.position);
      dur.textContent = fmtTime(state.duration);
      syncLyrics(cardEl, state.position);
    } else {
      const savedMs = getSavedPosition(meta.trackId);
      progress.value = 0;
      cur.textContent = savedMs > 0 ? fmtTime(savedMs) : '00:00';
      dur.textContent = '00:00';
    }
  }

  function refreshLikeUI(cardEl, trackId) {
    const likeBtn = cardEl.querySelector('.hw-like');
    if (!likeBtn) return;
    const liked = isLiked(trackId);
    likeBtn.classList.toggle('active', liked);
    likeBtn.innerHTML = liked ? ICONS.heartFilled : ICONS.heart;
  }
  function refreshRepeatUI(cardEl, trackId) {
    const repeatBtn = cardEl.querySelector('.hw-repeat');
    if (!repeatBtn) return;
    repeatBtn.classList.toggle('active', isRepeatOn(trackId));
  }

  function renderLyricsList(scrollEl, lyricsResult) {
    if (!lyricsResult.lines.length) { scrollEl.innerHTML = '<div class="hw-lyrics-empty">暂无歌词</div>'; return; }
    scrollEl.innerHTML = lyricsResult.lines.map((l, i) => `<div class="hw-lyrics-line" data-idx="${i}" data-time="${l.time}">${escapeAttr(l.text)}</div>`).join('');
  }

  function syncLyrics(cardEl, positionMs) {
    const scroll = cardEl.querySelector('.hw-lyrics-scroll-full');
    if (!scroll) return;
    const lineEls = scroll.querySelectorAll('.hw-lyrics-line');
    if (!lineEls.length) return;
    let activeIdx = -1;
    lineEls.forEach((el, i) => { if (Number(el.dataset.time) <= positionMs) activeIdx = i; });
    lineEls.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
    if (activeIdx >= 0) {
      const activeEl = lineEls[activeIdx];
      const targetTop = activeEl.offsetTop - scroll.clientHeight / 2 + activeEl.clientHeight / 2;
      scroll.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    }
  }

  function bindCard(cardEl, meta) {
    if (cardEl.dataset.hwBound) { refreshCardUI(cardEl, meta); refreshLikeUI(cardEl, meta.trackId); refreshRepeatUI(cardEl, meta.trackId); return; }
    cardEl.dataset.hwBound = '1';
    const playBtn = cardEl.querySelector('.hw-play');
    const likeBtn = cardEl.querySelector('.hw-like');
    const repeatBtn = cardEl.querySelector('.hw-repeat');
    const lyricsBtn = cardEl.querySelector('.hw-lyrics-toggle');
    const progress = cardEl.querySelector('.hw-progress');

    playBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); playTrack(meta); });
    likeBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleLike(meta.trackId); });
    repeatBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); setRepeat(meta.trackId, !isRepeatOn(meta.trackId)); refreshRepeatUI(cardEl, meta.trackId); });
    progress.addEventListener('input', (e) => {
      e.stopPropagation();
      if (state.activeId !== meta.trackId || state.queue || !audioEl) return;
      audioEl.currentTime = (Number(progress.value) / 1000) * (audioEl.duration || 0);
    });

    let lyricsLoaded = false;
    lyricsBtn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const nowOn = cardEl.classList.toggle('lyrics-mode');
      lyricsBtn.classList.toggle('active', nowOn);
      if (nowOn && !lyricsLoaded) {
        lyricsLoaded = true;
        const lyricsResult = await getLyricsByNeteaseId(meta.neteaseId);
        renderLyricsList(cardEl.querySelector('.hw-lyrics-scroll-full'), lyricsResult);
        if (state.activeId === meta.trackId) syncLyrics(cardEl, state.position);
      }
      if (typeof window.HWonMasonryNeeded === 'function') window.HWonMasonryNeeded();
    });

    cardEl.addEventListener('mousedown', (e) => e.stopPropagation());
    cardEl.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    document.addEventListener('hwplayer:update', () => refreshCardUI(cardEl, meta));
    document.addEventListener('hwplayer:like-update', (e) => { if (e.detail.trackId === meta.trackId) refreshLikeUI(cardEl, meta.trackId); });
    refreshCardUI(cardEl, meta);
    refreshLikeUI(cardEl, meta.trackId);
    refreshRepeatUI(cardEl, meta.trackId);
  }

  async function mountOne(mountEl) {
    const url = mountEl.getAttribute('data-hw-url');
    if (!url) return;
    mountEl.innerHTML = skeletonHTML();
    const meta = await getMeta(url);
    if (typeof window.HWonMasonryNeeded === 'function') window.HWonMasonryNeeded();
    mountEl.innerHTML = cardHTML(meta);
    const cardEl = mountEl.querySelector('.hw-player');
    bindCard(cardEl, meta);
    if (typeof window.HWonMasonryNeeded === 'function') window.HWonMasonryNeeded();
  }

  function playlistSkeletonHTML() { return `<div class="hw-playlist"><div class="hw-pl-loading">歌单加载中…</div></div>`; }
  function playlistErrorHTML(msg) { return `<div class="hw-playlist"><div class="hw-pl-error">歌单加载失败：${escapeAttr(msg)}</div></div>`; }

  function playlistCardHTML(listId, pls) {
    const track = state.queue && state.queue.listId === listId ? pls.tracks[state.queue.index] : pls.tracks[0];
    const cover = (track && track.cover) || '';
    const rowsHTML = pls.tracks.map((t, i) => `
      <div class="hw-pl-row" data-idx="${i}">
        <span class="hw-pl-row-idx">${i + 1}</span>
        <div class="hw-pl-row-thumb">${t.cover ? `<img src="${escapeAttr(t.cover)}" alt="">` : ''}</div>
        <div class="hw-pl-row-info">
          <div class="hw-pl-row-title">${escapeAttr(t.title)}</div>
          <div class="hw-pl-row-artist">${escapeAttr(t.artist)}</div>
        </div>
        <span class="hw-pl-row-playicon">♪</span>
      </div>`).join('');

    return `<div class="hw-playlist" data-list-id="${escapeAttr(listId)}">
      <div class="hw-pl-view-normal">
        <div class="hw-pl-header">
          <div class="hw-pl-cover">${cover ? `<img class="hw-cover-img hw-pl-cover-img" src="${escapeAttr(cover)}" alt="">` : ''}</div>
          <div class="hw-pl-meta">
            <div class="hw-pl-title hw-pl-current-title">${escapeAttr(track ? track.title : '播放列表')}</div>
            <div class="hw-pl-artist hw-pl-current-artist">${escapeAttr(track ? track.artist : '')}</div>
            <div class="hw-pl-count">共 ${pls.tracks.length} 首</div>
          </div>
        </div>
      </div>
      <div class="hw-pl-view-lyrics"><div class="hw-lyrics-scroll-full"><div class="hw-lyrics-empty">点击歌曲开始播放</div></div></div>
      <div class="hw-pl-progress-row">
        <span class="hw-time hw-pl-cur">00:00</span>
        <input type="range" class="hw-progress hw-pl-progress" min="0" max="1000" value="0">
        <span class="hw-time hw-pl-dur">00:00</span>
      </div>
      <div class="hw-pl-controls">
        <button class="hw-btn hw-pl-shuffle${pls.shuffle ? ' active' : ''}" title="随机播放">${ICONS.shuffle}</button>
        <button class="hw-btn hw-pl-lyrics-toggle" title="歌词">${ICONS.lyrics}</button>
        <button class="hw-btn hw-play hw-pl-play" title="播放/暂停">${ICONS.play}</button>
        <button class="hw-btn hw-pl-repeat${pls.repeatMode !== 'off' ? ' active' : ''}" title="循环模式">${ICONS.repeat}${pls.repeatMode === 'one' ? '<span class="hw-repeat-badge">1</span>' : ''}</button>
      </div>
      <div class="hw-pl-list">${rowsHTML}</div>
    </div>`;
  }

  function refreshPlaylistUI(cardEl, listId) {
    const pls = getPlaylistState(listId);
    const isThisQueueActive = state.queue && state.queue.listId === listId;
    const playBtn = cardEl.querySelector('.hw-pl-play');
    const progress = cardEl.querySelector('.hw-pl-progress');
    const cur = cardEl.querySelector('.hw-pl-cur');
    const dur = cardEl.querySelector('.hw-pl-dur');
    const titleEl = cardEl.querySelector('.hw-pl-current-title');
    const artistEl = cardEl.querySelector('.hw-pl-current-artist');
    const shuffleBtn = cardEl.querySelector('.hw-pl-shuffle');
    const repeatBtn = cardEl.querySelector('.hw-pl-repeat');
    const coverImg = cardEl.querySelector('.hw-pl-cover-img');
    const rows = cardEl.querySelectorAll('.hw-pl-row');

    shuffleBtn.classList.toggle('active', pls.shuffle);
    repeatBtn.classList.toggle('active', pls.repeatMode !== 'off');
    repeatBtn.innerHTML = ICONS.repeat + (pls.repeatMode === 'one' ? '<span class="hw-repeat-badge">1</span>' : '');

    const playing = isThisQueueActive && state.isPlaying;
    playBtn.innerHTML = playing ? ICONS.pause : ICONS.play;

    if (isThisQueueActive) {
      const track = pls.tracks[state.queue.index];
      if (track) { titleEl.textContent = track.title; artistEl.textContent = track.artist; if (coverImg && track.cover) coverImg.src = track.cover; }
      const pct = state.duration ? (state.position / state.duration) * 1000 : 0;
      progress.value = Math.min(1000, Math.max(0, pct));
      cur.textContent = fmtTime(state.position);
      dur.textContent = fmtTime(state.duration);
      rows.forEach((row, i) => row.classList.toggle('playing', i === state.queue.index));
      syncLyrics(cardEl, state.position);
    } else {
      const lastTrack = pls.lastPlayedIndex !== null ? pls.tracks[pls.lastPlayedIndex] : null;
      const savedMs = lastTrack ? getSavedPosition(lastTrack.trackId) : 0;
      if (lastTrack) { titleEl.textContent = lastTrack.title; artistEl.textContent = lastTrack.artist; if (coverImg && lastTrack.cover) coverImg.src = lastTrack.cover; }
      progress.value = 0;
      cur.textContent = savedMs > 0 ? fmtTime(savedMs) : '00:00';
      dur.textContent = '00:00';
      rows.forEach((row) => row.classList.remove('playing'));
    }
  }

  function bindPlaylistCard(cardEl, listId) {
    const pls = getPlaylistState(listId);
    const playBtn = cardEl.querySelector('.hw-pl-play');
    const shuffleBtn = cardEl.querySelector('.hw-pl-shuffle');
    const repeatBtn = cardEl.querySelector('.hw-pl-repeat');
    const lyricsBtn = cardEl.querySelector('.hw-pl-lyrics-toggle');
    const progress = cardEl.querySelector('.hw-pl-progress');

    playBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const isThisQueueActive = state.queue && state.queue.listId === listId;
      if (isThisQueueActive) togglePauseCurrent();
      else playFromPlaylist(listId, pls.order[pls.posInOrder] || 0);
    });

    shuffleBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); togglePlaylistShuffle(listId); });
    repeatBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); cyclePlaylistRepeat(listId); });

    progress.addEventListener('input', (e) => {
      e.stopPropagation();
      const isThisQueueActive = state.queue && state.queue.listId === listId;
      if (!isThisQueueActive || !audioEl) return;
      audioEl.currentTime = (Number(progress.value) / 1000) * (audioEl.duration || 0);
    });

    let lyricsLoadedForTrackId = null;
    lyricsBtn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const nowOn = cardEl.classList.toggle('lyrics-mode');
      lyricsBtn.classList.toggle('active', nowOn);
      const isThisQueueActive = state.queue && state.queue.listId === listId;
      if (nowOn && isThisQueueActive) {
        const track = pls.tracks[state.queue.index];
        if (track && lyricsLoadedForTrackId !== track.trackId) {
          lyricsLoadedForTrackId = track.trackId;
          const lyricsResult = await getLyricsByNeteaseId(track.neteaseId);
          renderLyricsList(cardEl.querySelector('.hw-pl-view-lyrics .hw-lyrics-scroll-full'), lyricsResult);
          syncLyrics(cardEl, state.position);
        }
      }
      if (typeof window.HWonMasonryNeeded === 'function') window.HWonMasonryNeeded();
    });

    cardEl.querySelectorAll('.hw-pl-row').forEach((row) => {
      row.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); playFromPlaylist(listId, Number(row.dataset.idx)); });
    });

    cardEl.addEventListener('mousedown', (e) => e.stopPropagation());
    cardEl.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    document.addEventListener('hwplayer:update', () => refreshPlaylistUI(cardEl, listId));
    document.addEventListener('hwplayer:queue-change', (e) => {
      if (e.detail.listId !== listId) return;
      refreshPlaylistUI(cardEl, listId);
      const isThisQueueActive = state.queue && state.queue.listId === listId;
      if (cardEl.classList.contains('lyrics-mode') && isThisQueueActive) {
        const track = pls.tracks[state.queue.index];
        if (track && lyricsLoadedForTrackId !== track.trackId) {
          lyricsLoadedForTrackId = track.trackId;
          const scroll = cardEl.querySelector('.hw-pl-view-lyrics .hw-lyrics-scroll-full');
          getLyricsByNeteaseId(track.neteaseId).then((r) => { renderLyricsList(scroll, r); syncLyrics(cardEl, state.position); });
        }
      }
    });
    refreshPlaylistUI(cardEl, listId);
  }

  async function mountOnePlaylist(mountEl) {
    const listId = mountEl.getAttribute('data-hw-list-id');
    if (!listId) return;
    mountEl.innerHTML = playlistSkeletonHTML();
    const result = await fetchPlaylist(listId);
    if (typeof window.HWonMasonryNeeded === 'function') window.HWonMasonryNeeded();
    if (!result.ok || !result.tracks.length) { mountEl.innerHTML = playlistErrorHTML(result.error || '歌单为空'); return; }
    const pls = getPlaylistState(listId);
    pls.tracks = result.tracks;
    pls.order = buildOrder(pls.tracks.length, pls.shuffle);
    mountEl.innerHTML = playlistCardHTML(listId, pls);
    const cardEl = mountEl.querySelector('.hw-playlist');
    bindPlaylistCard(cardEl, listId);
    if (typeof window.HWonMasonryNeeded === 'function') window.HWonMasonryNeeded();
  }

  function mountAll(container) {
    const root = container || document;
    root.querySelectorAll('.hw-player-mount').forEach((el) => { if (el.dataset.hwMounted) return; el.dataset.hwMounted = '1'; mountOne(el); });
    root.querySelectorAll('.hw-playlist-mount').forEach((el) => { if (el.dataset.hwMounted) return; el.dataset.hwMounted = '1'; mountOnePlaylist(el); });
  }

  window.HWPlayer = { parseShortcodes, mountAll };
})();