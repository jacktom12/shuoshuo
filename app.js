let allPosts = [];
let filtered = [];
let page = 1;
const perPage = 10;
let isLoading = false;
let isAllLoaded = false;

const START_YEAR = new Date().getFullYear();
const MIN_YEAR = 2025;
let currentLoadYear = START_YEAR;
let noMoreYearFile = false;

const loaderDom = document.getElementById('loader');

// ==============================================
// 完美灯箱核心变量（支持全向平移与双击缩放）
// ==============================================
let currentGallery = [];
let currentIndex = 0;

let scale = 1;
let baseScale = 1;
let translateX = 0;
let translateY = 0;
let startX = 0;
let startY = 0;
let isPointerDown = false;
let pointerCache = [];
let lastPinchDist = 0;
let lastClickTime = 0;

const searchInline = document.getElementById('searchInline');
const searchToggleBtn = document.getElementById('searchToggleBtn');
const searchInput = document.getElementById('search');

searchToggleBtn.onclick = () => {
  searchInline.classList.toggle('open');
  if (searchInline.classList.contains('open')) {
    searchInput.focus();
    if (!isAllLoaded) loadAllRemainingYears();
  } else {
    searchInput.blur();
    if (!searchInput.value.trim()) applyFilter();
  }
};

document.addEventListener('click', (e) => {
  if (!searchInline.contains(e.target) && !searchInput.value.trim()) {
    searchInline.classList.remove('open');
  }
});

function formatRelativeTime(dateStr) {
  const target = new Date(dateStr);
  const now = new Date();
  const diffMs = now - target;
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay < 3) {
    if (diffMin < 60) return `${diffMin}分钟前`;
    return `${diffHour}小时前`;
  } else {
    const y = target.getFullYear();
    const m = String(target.getMonth() + 1).padStart(2, '0');
    const d = String(target.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

async function loadYearMd(year) {
  if (isLoading || noMoreYearFile || isAllLoaded) return;
  if (year < MIN_YEAR) {
    noMoreYearFile = true;
    loaderDom.textContent = '已经没有更多备忘录了';
    return;
  }
  isLoading = true;
  loaderDom.textContent = `正在翻阅 ${year} 年的记忆...`;
  try {
    const res = await fetch(`memos_${year}.md?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error('无文件');
    const mdContent = await res.text();
    const yearPosts = parseMdToPosts(mdContent, year);
    const existingIds = new Set(allPosts.map(p => p.id));
    const uniqueYearPosts = yearPosts.filter(p => !existingIds.has(p.id));
    allPosts.unshift(...uniqueYearPosts);
    allPosts.sort((a, b) => new Date(b.date) - new Date(a.date));
    applyFilter();
    currentLoadYear = year - 1;
  } catch (e) {
    currentLoadYear = year - 1;
  }
  isLoading = false;
}

async function loadAllRemainingYears() {
  if (isAllLoaded || currentLoadYear < MIN_YEAR) return;
  isLoading = true;
  loaderDom.textContent = '正在全量检索往年记忆碎片...';
  const yearsToFetch = [];
  for (let y = currentLoadYear; y >= MIN_YEAR; y--) {
    yearsToFetch.push(y);
  }
  const fetchPromises = yearsToFetch.map(y =>
    fetch(`memos_${y}.md?v=${Date.now()}_${y}`, { cache: "no-store" })
      .then(res => { if (!res.ok) throw new Error('无文件'); return res.text(); })
      .then(text => ({ year: y, text, ok: true }))
      .catch(e => ({ year: y, ok: false }))
  );
  try {
    const results = await Promise.all(fetchPromises);
    let newPosts = [];
    results.forEach(res => { if (res.ok) newPosts.push(...parseMdToPosts(res.text, res.year)); });
    const existingIds = new Set(allPosts.map(p => p.id));
    newPosts.forEach(p => { if (!existingIds.has(p.id)) allPosts.push(p); });
    allPosts.sort((a, b) => new Date(b.date) - new Date(a.date));
    currentLoadYear = MIN_YEAR - 1;
    noMoreYearFile = true;
    isAllLoaded = true;
  } catch (e) {
    console.error(e);
  }
  isLoading = false;
  loaderDom.textContent = '已经没有更多备忘录了';
  applyFilter();
}

async function init() {
  await loadYearMd(currentLoadYear);
  setupInfinite();
  setupPerfectLightbox();
}

function parseMdToPosts(mdContent, fileYear) {
  const frontmatterEndIndex = mdContent.indexOf('---', 3);
  const content = frontmatterEndIndex > -1 ? mdContent.slice(frontmatterEndIndex + 3).trim() : mdContent.trim();
  const items = content.split(/\n\n+/).filter(item => item.trim());
  const posts = [];

  items.forEach((item, idx) => {
    let text = item.trim();
    let date = '';
    let images = [];
    const imgRegex = /!\[.*?\]\((https?:\/\/.+?)\)/g;
    const imgMatches = [...text.matchAll(imgRegex)];
    if (imgMatches.length) {
      images = imgMatches.map(m => m[1]);
      text = text.replace(imgRegex, '');
    }
    const dateRegex = /@(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/;
    const dateMatch = text.match(dateRegex);
    if (dateMatch) {
      date = dateMatch[1];
      text = text.replace(dateRegex, '').trim();
    } else {
      date = new Date().toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-');
    }
    text = text.replace(/^> /gm, '> ').replace(/^- \[ \] /gm, '- [ ] ').replace(/^- \[x\] /gm, '- [x] ').replace(/`([^`]+)`/g, '`$1`');
    posts.push({ id: `${fileYear}_${idx}`, date: date, content: [text], images: images });
  });
  return posts;
}

function applyFilter() {
  page = 1;
  const kw = document.getElementById('search').value.toLowerCase();
  filtered = allPosts.filter(p => {
    const rawText = Array.isArray(p.content) ? p.content.join(' ') : (p.content || '');
    return rawText.replace(/!\[.*?\]\(.*?\)/g, '').replace(/https?:\/\/\S+/g, '').toLowerCase().includes(kw);
  });
  render(true);
}

function render(reset = false) {
  if (!reset) isLoading = true;
  const box = document.getElementById('posts');
  if (reset) box.innerHTML = '';

  const start = reset ? 0 : (page - 1) * perPage;
  const end = page * perPage;
  const show = reset ? filtered.slice(0, end) : filtered.slice(start, end);

  const htmlStrings = show.map(p => {
    const textContent = Array.isArray(p.content) ? p.content.join('\n\n') : (p.content || '');
    const parsedText = marked.parse(textContent);
    const showTime = formatRelativeTime(p.date);
    let imagesHtml = '';
    if (p.images && p.images.length > 0) {
      const imgsStr = p.images.map(url => `<img src="${url}" alt="" draggable="false">`).join('');
      imagesHtml = `
        <div class="post-images">
          <div class="img-slide">${imgsStr}</div>
          <div class="img-dots"></div>
        </div>
      `;
    }
    return `
      <article class="post" id="post-${p.id}">
        <div class="post-header">
          <span class="post-time">${showTime}</span>
        </div>
        <div class="post-right">
          <div class="post-content">${parsedText}</div>
          ${imagesHtml}
        </div>
      </article>
    `;
  });

  if (reset) {
    box.innerHTML = htmlStrings.join('');
  } else {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlStrings.join('');
    while (tempDiv.firstChild) box.appendChild(tempDiv.firstChild);
  }
  isLoading = false;
  bindImages();
}

function setupInfinite() {
  window.addEventListener('scroll', async () => {
    if (isLoading) return;
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 100) {
      if (page * perPage < filtered.length) {
        page++;
        render(false);
      } else if (!noMoreYearFile && !isAllLoaded) {
        await loadYearMd(currentLoadYear);
      }
    }
  });
}

// ==============================================
// 优化版：极其顺滑的无抖动多图轮播
// ==============================================
let globalGalleryLock = false;

function bindImages() {
  document.querySelectorAll('.post-images').forEach(wrap => {
    if (wrap.dataset.boundDrag) return;
    wrap.dataset.boundDrag = true;

    const slide = wrap.querySelector('.img-slide');
    const dotsBox = wrap.querySelector('.img-dots');
    const imgs = slide.querySelectorAll('img');
    const total = imgs.length;

    if (total <= 1) {
      dotsBox.style.display = 'none';
       wrap.classList.add('single-image'); // ← 加这一行
      return;
    }

    dotsBox.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('span');
      dot.className = 'dot' + (i === 0 ? ' active' : '');
      dotsBox.appendChild(dot);
    }
    const dots = dotsBox.querySelectorAll('.dot');

    let startX = 0;
    let startY = 0;         // 新增：记录 Y 轴起点
    let isScrolling = null; // 新增：标记当前是否为上下滚动页面
    let currentTranslate = 0;
    let prevTranslate = 0;
    let animationId = 0;
    let curIdx = 0;
    let isDragging = false;

    // 采用更精准的基于容器宽度的平滑平移方案，彻底解决发颤抖动
    function setSliderPosition() {
      slide.style.transform = `translateX(${currentTranslate}px)`;
    }

    function animation() {
      setSliderPosition();
      if (isDragging) requestAnimationFrame(animation);
    }

    function getPositionX(e) {
      return e.type.includes('mouse') ? e.pageX : e.touches[0].clientX;
    }
function getPositionY(e) {
      return e.type.includes('mouse') ? e.pageY : e.touches[0].clientY;
    }
    wrap.addEventListener('touchstart', touchStart, { passive: true });
    wrap.addEventListener('touchend', touchEnd);
    wrap.addEventListener('touchmove', touchMove, { passive: false });
    wrap.addEventListener('mousedown', touchStart);
    wrap.addEventListener('mouseup', touchEnd);
    wrap.addEventListener('mouseleave', touchEnd);
    wrap.addEventListener('mousemove', touchMove);

     
function touchStart(e) {
      isDragging = true;
      isScrolling = null; // 每次手指落下时，重置滚动状态
      globalGalleryLock = false;
      startX = getPositionX(e);
      startY = getPositionY(e); // 记录初始 Y 坐标
      slide.style.transition = 'none';
      animationId = requestAnimationFrame(animation);
    }

    function touchMove(e) {
      if (!isDragging) return;
      
      const currentX = getPositionX(e);
      const currentY = getPositionY(e);
      const diffX = currentX - startX;
      const diffY = currentY - startY;

      // 核心判断：第一次移动时，判断手指主要是上下走还是左右走
      if (isScrolling === null) {
        // 如果 Y 轴移动距离大于 X 轴，判定为用户在上下滚动页面
        isScrolling = Math.abs(diffY) > Math.abs(diffX);
      }

      // 如果判断为上下滚动页面
      if (isScrolling) {
        isDragging = false; // 放弃图片轮播的拖拽逻辑
        currentTranslate = prevTranslate; // 强制复位，消除纵向滑动时的微弱横向抖动
        return; // 直接 return，不执行 preventDefault，把控制权还给浏览器
      }

      // 如果是左右横向滑动图片
      if (Math.abs(diffX) > 5) {
        globalGalleryLock = true; 
        if (e.cancelable) e.preventDefault(); // 阻止页面在横向翻图时跟着上下乱晃
      }
      currentTranslate = prevTranslate + diffX;
    }
   

    function touchEnd() {
      if (!isDragging) return;
      isDragging = false;
      cancelAnimationFrame(animationId);

      const movedBy = currentTranslate - prevTranslate;
      const threshold = wrap.offsetWidth * 0.2; // 滑动超过20%即翻页

      if (movedBy < -threshold && curIdx < total - 1) curIdx++;
      else if (movedBy > threshold && curIdx > 0) curIdx--;

      goToIndex(curIdx);
      setTimeout(() => { globalGalleryLock = false; }, 50);
    }

    function goToIndex(index) {
      curIdx = index;
      const gap = 8;
      // 基于每张图准确的 offsetLeft 精准锚定，完美防抖
      currentTranslate = -imgs[curIdx].offsetLeft;
      prevTranslate = currentTranslate;
      slide.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
      setSliderPosition();
      
      dots.forEach(d => d.classList.remove('active'));
      if (dots[curIdx]) dots[curIdx].classList.add('active');
    }
  });

  // 绑定点击唤醒灯箱
  document.querySelectorAll('.post').forEach(post => {
    const imgs = Array.from(post.querySelectorAll('.post-right img'));
    imgs.forEach((img, index) => {
      if (img.dataset.bound) return;
      img.dataset.bound = true;
      img.onclick = e => {
        if (globalGalleryLock) {
          e.preventDefault();
          return;
        }
        currentGallery = imgs.map(i => i.src);
        currentIndex = index;
        openPerfectLightbox();
      };
    });
  });
}

// ==============================================
// 工业级终极完美大图灯箱控制（Pointer 统一事件流）
// ==============================================
const lb = document.getElementById('lightbox');
const lbImg = document.getElementById('lb-img');
const lbCounter = document.getElementById('lb-counter');

function openPerfectLightbox() {
  resetTransform();
  lb.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  updateLightboxImage(false);
}

function closePerfectLightbox() {
  lb.style.display = 'none';
  document.body.style.overflow = '';
  resetTransform();
}

function resetTransform() {
  scale = 1;
  baseScale = 1;
  translateX = 0;
  translateY = 0;
  pointerCache = [];
  if (lbImg) {
    lbImg.style.transition = 'none';
    applyTransform();
  }
}

function applyTransform() {
  if (lbImg) {
    lbImg.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  }
}

function updateLightboxImage(animate = true) {
  if (!lbImg) return;
  if (animate) {
    lbImg.style.transition = 'opacity 0.2s ease';
    lbImg.style.opacity = '0';
    setTimeout(() => {
      lbImg.src = currentGallery[currentIndex];
      lbCounter.textContent = `${currentIndex + 1} / ${currentGallery.length}`;
      resetTransform();
      lbImg.style.opacity = '1';
    }, 200);
  } else {
    lbImg.src = currentGallery[currentIndex];
    lbCounter.textContent = `${currentIndex + 1} / ${currentGallery.length}`;
    resetTransform();
  }
  const showNav = currentGallery.length > 1 ? 'flex' : 'none';
  document.getElementById('lb-prev').style.display = showNav;
  document.getElementById('lb-next').style.display = showNav;
}

function setupPerfectLightbox() {
  document.getElementById('lb-close').onclick = closePerfectLightbox;
  document.getElementById('lb-next').onclick = e => { e.stopPropagation(); if(scale===1) { currentIndex = (currentIndex + 1) % currentGallery.length; updateLightboxImage(); } };
  document.getElementById('lb-prev').onclick = e => { e.stopPropagation(); if(scale===1) { currentIndex = (currentIndex - 1 + currentGallery.length) % currentGallery.length; updateLightboxImage(); } };

  // 鼠标滚轮优化：向滑轮上滚动为放大，向下为缩小
  lb.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    const oldScale = scale;
    scale = Math.max(1, Math.min(5, scale + delta));

    // 如果处于缩放状态，支持以鼠标为中心缩放
    if (scale > 1) {
      const rect = lbImg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;
      translateX -= mouseX * (scale / oldScale - 1);
      translateY -= mouseY * (scale / oldScale - 1);
    } else {
      translateX = 0;
      translateY = 0;
    }
    lbImg.style.transition = 'transform 0.1s ease-out';
    applyTransform();
  }, { passive: false });

  // 核心高级交互：绑定 PointerEvents（完美支持多指、单指拖拽、鼠标）
  lbImg.addEventListener('pointerdown', e => {
    e.preventDefault();
    pointerCache.push(e);
    lbImg.style.transition = 'none';

    if (pointerCache.length === 1) {
      isPointerDown = true;
      startX = e.clientX - translateX;
      startY = e.clientY - translateY;
    } else if (pointerCache.length === 2) {
      isPointerDown = false;
      lastPinchDist = getDistance(pointerCache[0], pointerCache[1]);
      baseScale = scale;
    }
  });

  lbImg.addEventListener('pointermove', e => {
    e.preventDefault();
    updatePointerCache(e);

    // 1指：如果当前被放大，则允许自由拖拽移动查看图片区域
    if (pointerCache.length === 1 && isPointerDown) {
      if (scale > 1) {
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        
        // 增加边缘碰撞保护阻尼
        const rect = lbImg.getBoundingClientRect();
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        if (rect.width > winW) {
          const boundX = (rect.width - winW) / 2;
          if (Math.abs(translateX) > boundX) startX = e.clientX - translateX; // 动态平滑边界
        }
        applyTransform();
      }
    } 
    // 2指：移动端捏合缩放（Pinch to Zoom）
    else if (pointerCache.length === 2) {
      const currentDist = getDistance(pointerCache[0], pointerCache[1]);
      const factor = currentDist / lastPinchDist;
      scale = Math.max(1, Math.min(5, baseScale * factor));
      if (scale === 1) { translateX = 0; translateY = 0; }
      applyTransform();
    }
  });

  function handlePointerUp(e) {
    removePointerCache(e);
    if (pointerCache.length < 1) {
      isPointerDown = false;
      // 松手后边界弹性恢复修正
      if (scale <= 1) {
        resetTransform();
      } else {
        // 防止拖出屏幕之外找不到图
        const rect = lbImg.getBoundingClientRect();
        if (rect.width <= window.innerWidth) translateX = 0;
        if (rect.height <= window.innerHeight) translateY = 0;
        lbImg.style.transition = 'transform 0.2s ease-out';
        applyTransform();
      }
    }
    if (pointerCache.length < 2) lastPinchDist = 0;
  }

  lbImg.addEventListener('pointerup', handlePointerUp);
  lbImg.addEventListener('pointercancel', handlePointerUp);
  lbImg.addEventListener('pointerout', handlePointerUp);
  lbImg.addEventListener('pointerleave', handlePointerUp);

  // 终极点击和双击判断
  lb.onclick = e => {
    if (e.target === lb) {
      // 只有在1倍状态下点击空白区才能退出
      if (scale === 1) closePerfectLightbox();
    }
  };

  lbImg.addEventListener('click', e => {
    const now = Date.now();
    if (now - lastClickTime < 280) {
      // 触发双击逻辑
      if (scale > 1) {
        // 当前已被放大：再次双击恢复1倍
        lbImg.style.transition = 'transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)';
        resetTransform();
      } else {
        // 当前是原尺寸：在点击位置放大 2.5 倍
        scale = 2.5;
        const rect = lbImg.getBoundingClientRect();
        const clickX = e.clientX - rect.left - rect.width / 2;
        const clickY = e.clientY - rect.top - rect.height / 2;
        translateX = -clickX * 1.5;
        translateY = -clickY * 1.5;
        lbImg.style.transition = 'transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)';
        applyTransform();
      }
      lastClickTime = 0;
    } else {
      // 单击逻辑：如果是 1 倍大小，单击直接退出
      lastClickTime = now;
      setTimeout(() => {
        if (Date.now() - lastClickTime >= 280 && lastClickTime !== 0) {
          if (scale === 1) closePerfectLightbox();
        }
      }, 290);
    }
  });

  // 键盘快捷键支持
  document.addEventListener('keydown', e => {
    if (lb.style.display !== 'flex') return;
    if (e.key === 'Escape') closePerfectLightbox();
    if (scale === 1) {
      if (e.key === 'ArrowRight') document.getElementById('lb-next').click();
      if (e.key === 'ArrowLeft') document.getElementById('lb-prev').click();
    }
  });
}

// 辅助工具函数
function getDistance(p1, p2) {
  const dx = p1.clientX - p2.clientX;
  const dy = p1.clientY - p2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}
function updatePointerCache(e) {
  for (let i = 0; i < pointerCache.length; i++) {
    if (pointerCache[i].pointerId === e.pointerId) {
      pointerCache[i] = e;
      break;
    }
  }
}
function removePointerCache(e) {
  for (let i = 0; i < pointerCache.length; i++) {
    if (pointerCache[i].pointerId === e.pointerId) {
      pointerCache.splice(i, 1);
      break;
    }
  }
}

// 其他原逻辑保持不变
document.getElementById('search').addEventListener('input', applyFilter);

const SVG_SUN = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><!-- Icon from Lucide by Lucide Contributors - https://github.com/lucide-icons/lucide/blob/main/LICENSE --><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></g></svg>`;
const SVG_MOON = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><!-- Icon from Lucide by Lucide Contributors - https://github.com/lucide-icons/lucide/blob/main/LICENSE --><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>`;

const themeBtn = document.getElementById('themeBtn');
themeBtn.onclick = () => {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.theme = isDark ? 'dark' : 'light';
  themeBtn.innerHTML = isDark ? SVG_MOON : SVG_SUN;
};
if (localStorage.theme === 'dark') {
  document.body.classList.add('dark');
  themeBtn.innerHTML = SVG_MOON;
} else {
  themeBtn.innerHTML = SVG_SUN;
}

init();

// ==============================================
// 发说说功能（不变）
// ==============================================
const AVATAR_URL = "https://raw.githubusercontent.com/jacktom12/blogpic3/main/Muhteşem Whatsapp Profil Fotoğrafları [Full HD].jpg";
const WORKER_URL = "https://solitary-forest-7065.hahagoodboy008.workers.dev";
const PUBLISH_PWD_KEY = "memo_publish_pwd";
const PUBLISH_PWD_DAYS = 30;

let publishModal = null;
let selectedPublishFiles = [];

document.getElementById('openPublishBtn').onclick = openPublishEditor;

function setPublishPassword(password) {
  const expires = new Date(Date.now() + PUBLISH_PWD_DAYS * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${PUBLISH_PWD_KEY}=${encodeURIComponent(password)}; expires=${expires}; path=/; SameSite=Lax`;
}
function getPublishPassword() {
  const match = document.cookie.match(new RegExp(`(?:^|; )${PUBLISH_PWD_KEY}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}
function clearPublishPassword() {
  document.cookie = `${PUBLISH_PWD_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax`;
}
function getNowBeijingString() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
function buildNewPostObject(content, imageUrls = [], dateStr = "") {
  const finalDate = dateStr || getNowBeijingString();
  const text = String(content || "").trim();
  return {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    date: finalDate,
    content: [text],
    images: imageUrls
  };
}
function renderSinglePostHtml(p) {
  const textContent = Array.isArray(p.content) ? p.content.join('\n\n') : (p.content || '');
  const parsedText = marked.parse(textContent);
  const showTime = formatRelativeTime(p.date);
  let imagesHtml = '';
  if (p.images && p.images.length > 0) {
    const imgsStr = p.images.map(url => `<img src="${url}" alt="post-image" loading="lazy" draggable="false" />`).join('');
    imagesHtml = `
      <div class="post-images">
        <div class="img-slide">${imgsStr}</div>
        <div class="img-dots"></div>
      </div>
    `;
  }
  return `
    <article class="post" id="post-${p.id}">
      <div class="post-header">
        <span class="post-time">${showTime}</span>
      </div>
      <div class="post-right">
        <div class="post-content">${parsedText}</div>
        ${imagesHtml}
      </div>
    </article>
  `;
}
function insertNewPostToTop(post) {
  allPosts.unshift(post);
  allPosts.sort((a, b) => new Date(b.date) - new Date(a.date));
  const kw = document.getElementById('search').value.toLowerCase();
  if (kw && !post.content.join(' ').toLowerCase().includes(kw)) return;
  filtered.unshift(post);
  const postsBox = document.getElementById('posts');
  const temp = document.createElement('div');
  temp.innerHTML = renderSinglePostHtml(post);
  if (postsBox.firstChild) postsBox.insertBefore(temp.firstElementChild, postsBox.firstChild);
  else postsBox.appendChild(temp.firstElementChild);
  bindImages();
}
function openPublishEditor() {
  if (publishModal) publishModal.remove();
  selectedPublishFiles = [];
  const savedPwd = getPublishPassword();
  publishModal = document.createElement('div');
  publishModal.className = 'publish-mask';
  publishModal.innerHTML = `
    <div class="publish-panel" onclick="event.stopPropagation()">
      <div class="publish-top"><h3 class="publish-title">发布说说</h3><button id="closeMemo" class="publish-close" type="button">✕</button></div>
      ${savedPwd ? `<div class="publish-field"><div class="publish-empty">已记住发布密码，30 天内无需重复输入。</div></div>` : `<div class="publish-field"><label class="publish-label" for="publishPwd">发布密码</label><input id="publishPwd" class="publish-input" type="password" placeholder="请输入发布密码" /></div>`}
      <div class="publish-field"><label class="publish-label" for="memoContent">这一刻想说什么</label><textarea id="memoContent" class="publish-textarea" placeholder="可以只发文字，也可以配多张图片。"></textarea></div>
      <div class="publish-field"><div class="publish-tools"><button id="selectImg" class="pick-img-btn" type="button">选择照片</button><span id="imgCountText" class="publish-tip">未选择图片</span></div><input type="file" id="imgFile" accept="image/*" multiple hidden /><div id="previewWrap"><div class="publish-empty">可不传图片；支持一次选择多张，也支持重复补选。</div></div></div>
      <div class="publish-footer"><button id="submitMemo" class="publish-submit" type="button">发布</button><button id="closeMemo2" class="publish-cancel" type="button">取消</button></div>
    </div>
  `;
  document.body.appendChild(publishModal);
  publishModal.onclick = () => close();
  const close = () => { if (publishModal) { publishModal.remove(); publishModal = null; selectedPublishFiles.forEach(i => URL.revokeObjectURL(i.previewUrl)); selectedPublishFiles = []; } };
  document.getElementById('closeMemo').onclick = close;
  document.getElementById('closeMemo2').onclick = close;
  document.getElementById('selectImg').onclick = () => document.getElementById('imgFile').click();
  document.getElementById('imgFile').addEventListener('change', handlePublishFiles);
  document.getElementById('submitMemo').onclick = submitMemo;
  renderSelectedImages();
}
function handlePublishFiles(e) {
  const files = Array.from(e.target.files || []);
  files.forEach(file => {
    if (!selectedPublishFiles.some(item => item.file.name === file.name)) {
      selectedPublishFiles.push({ file, previewUrl: URL.createObjectURL(file) });
    }
  });
  e.target.value = '';
  renderSelectedImages();
}
function renderSelectedImages() {
  const wrap = document.getElementById('previewWrap');
  const countText = document.getElementById('imgCountText');
  countText.textContent = selectedPublishFiles.length ? `已选择 ${selectedPublishFiles.length} 张图片` : '未选择图片';
  if (!selectedPublishFiles.length) {
    wrap.innerHTML = `<div class="publish-empty">可不传图片；支持一次选择多张，也支持重复补选。</div>`;
    return;
  }
  wrap.innerHTML = `<div class="preview-grid">${selectedPublishFiles.map((i, idx) => `<div class="preview-item"><img src="${i.previewUrl}" /><button class="preview-del" data-idx="${idx}">✕</button></div>`).join('')}</div>`;
  wrap.querySelectorAll('.preview-del').forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.idx);
      URL.revokeObjectURL(selectedPublishFiles[idx].previewUrl);
      selectedPublishFiles.splice(idx, 1);
      renderSelectedImages();
    };
  });
}
async function submitMemo() {
  const savedPwd = getPublishPassword();
  const pwdInput = document.getElementById('publishPwd');
  const pwd = savedPwd || (pwdInput ? pwdInput.value.trim() : '');
  const content = document.getElementById('memoContent').value.trim();
  if (!pwd || (!content && !selectedPublishFiles.length)) return showToast('请填写完整内容', 'error');

  const btn = document.getElementById('submitMemo');
  btn.textContent = '发布中...'; btn.disabled = true;
  try {
    const imgBase64List = [];
    for (const item of selectedPublishFiles) { const b64 = await toBase64(item.file); imgBase64List.push(b64); }
    const localUrls = selectedPublishFiles.map(i => i.previewUrl);
    const pubTime = getNowBeijingString();

    const res = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publishPassword: pwd, content, imgList: imgBase64List }) });
    const json = await res.json();
    if (json.code === 200) {
      setPublishPassword(pwd);
      insertNewPostToTop(buildNewPostObject(content, localUrls, pubTime));
      if (publishModal) { publishModal.remove(); publishModal = null; }
      selectedPublishFiles = [];
      showToast('发布成功', 'success');
    } else {
      if (json.code === 403) clearPublishPassword();
      showToast(json.msg || '发布失败', 'error');
      btn.textContent = '发布'; btn.disabled = false;
    }
  } catch (e) {
    showToast('网络错误，发布失败', 'error');
    btn.textContent = '发布'; btn.disabled = false;
  }
}
function toBase64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); }); }
function showToast(m, t = "success", d = 2200) {
  let w = document.getElementById("toastWrap") || document.createElement("div");
  if (!w.id) { w.id = "toastWrap"; w.className = "toast-wrap"; document.body.appendChild(w); }
  const toast = document.createElement("div"); toast.className = `toast ${t}`; toast.textContent = m; w.appendChild(toast);
  setTimeout(() => { toast.classList.add("hide"); setTimeout(() => { toast.remove(); if (!w.children.length) w.remove(); }, 220); }, d);
}