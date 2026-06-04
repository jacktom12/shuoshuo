let allPosts = [];
let filtered = [];
let page = 1;
const perPage = 10;
let isLoading = false;
let isAllLoaded = false; // 核心状态锁：标记是否已经加载了所有年份的全量数据

// 自动获取本机当前年份，来年无需改代码；MIN_YEAR固定最早年限
const START_YEAR = new Date().getFullYear();
const MIN_YEAR = 2025;
let currentLoadYear = START_YEAR;
let noMoreYearFile = false;

const loaderDom = document.getElementById('loader');

let currentGallery = [];
let currentIndex = 0;

let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

let scale = 1;
let lastScale = 1;
let isScaling = false;

const searchWrap = document.getElementById('searchWrap');
const searchToggleBtn = document.getElementById('searchToggleBtn');

searchToggleBtn.onclick = () => {
  searchWrap.classList.toggle('open');
  if (searchWrap.classList.contains('open')) {
    document.getElementById('search').focus();
    
    // 展开搜索时，如果尚未加载全量，立刻在后台静默发起全量并行查询
    if (!isAllLoaded) {
      loadAllRemainingYears();
    }
  }
};

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

// 普通按年滚动加载
async function loadYearMd(year) {
  // 如果正在拉取、或已经拉取到尽头、或者已经全量拉取，直接拦截，不再执行查询逻辑
  if (isLoading || noMoreYearFile || isAllLoaded) return;

  if (year < MIN_YEAR) {
    noMoreYearFile = true;
    loaderDom.textContent = '已经没有更多备忘录了';
    return;
  }

  isLoading = true;
  loaderDom.textContent = `正在翻阅 ${year} 年的记忆...`;

  const fileName = `备忘录_${year}.md`;

  try {
    const res = await fetch(fileName);
    if (!res.ok) throw new Error('无文件');

    const mdContent = await res.text();
    const yearPosts = parseMdToPosts(mdContent, year); // 传入当前年份保证ID唯一

    // 安全去重拦截
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

// 搜索触发：并发拉取剩余所有年份
async function loadAllRemainingYears() {
  if (isAllLoaded || currentLoadYear < MIN_YEAR) return;

  isLoading = true;
  loaderDom.textContent = '正在全量检索往年记忆碎片...';

  // 收集所有尚未加载的年份
  const yearsToFetch = [];
  for (let y = currentLoadYear; y >= MIN_YEAR; y--) {
    yearsToFetch.push(y);
  }

  // 并行发送请求，最大化利用带宽，缩短等待时间
  const fetchPromises = yearsToFetch.map(y =>
    fetch(encodeURIComponent(`备忘录_${y}.md`))
      .then(res => {
        if (!res.ok) throw new Error('无文件');
        return res.text();
      })
      .then(text => ({ year: y, text, ok: true }))
      .catch(e => ({ year: y, ok: false }))
  );

  try {
    const results = await Promise.all(fetchPromises);
    let newPosts = [];
    
    results.forEach(res => {
      if (res.ok) {
        newPosts.push(...parseMdToPosts(res.text, res.year));
      }
    });

    // 严苛去重：基于全量唯一的 Set 结构过滤
    const existingIds = new Set(allPosts.map(p => p.id));
    newPosts.forEach(p => {
      if (!existingIds.has(p.id)) {
        allPosts.push(p);
      }
    });

    // 全量整体重新按时间倒序排序
    allPosts.sort((a, b) => new Date(b.date) - new Date(a.date));

    // 全量拉取完毕，修改状态锁，彻底切断后续滚动的 fetch 逻辑
    currentLoadYear = MIN_YEAR - 1;
    noMoreYearFile = true;
    isAllLoaded = true;
  } catch (e) {
    console.error('合并往年记忆数据时出错:', e);
  }

  isLoading = false;
  loaderDom.textContent = '已经没有更多备忘录了';
  
  // 重新执行过滤渲染，此时过滤池已涵盖全量数据
  applyFilter();
}

async function init() {
  await loadYearMd(currentLoadYear);
  setupInfinite();
  setupLightboxControls();
}

// 增加 fileYear 参数，确保生成的 id 绝对跨年唯一
function parseMdToPosts(mdContent, fileYear) {
  const frontmatterEndIndex = mdContent.indexOf('---', 3);
  const content =
    frontmatterEndIndex > -1
      ? mdContent.slice(frontmatterEndIndex + 3).trim()
      : mdContent.trim();

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
      date = new Date()
        .toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
        .replace(/\//g, '-');
    }

    text = text
      .replace(/^> /gm, '> ')
      .replace(/^- \[ \] /gm, '- [ ] ')
      .replace(/^- \[x\] /gm, '- [x] ')
      .replace(/`([^`]+)`/g, '`$1`');

    posts.push({
      id: `${fileYear}_${idx}`, // 使用年份做前缀，根除重复ID风险
      date: date,
      content: [text],
      images: images
    });
  });

  return posts;
}

function applyFilter() {
  page = 1;
  const kw = document.getElementById('search').value.toLowerCase();

  filtered = allPosts.filter(p => {
    const rawText = Array.isArray(p.content) ? p.content.join(' ') : (p.content || '');
    const cleanText = rawText
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/https?:\/\/\S+/g, '')
      .toLowerCase();

    return cleanText.includes(kw);
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
      const imgsStr = p.images
        .map(url => `<img src="${url}" alt="">`)
        .join('');

      imagesHtml = `
        <div class="post-images">
          <div class="img-slide">${imgsStr}</div>
          <div class="img-dots"></div>
        </div>
      `;
    }

    return `
      <article class="post" id="post-${p.id}">
        <div class="post-left">
          <img
            class="avatar"
            src="https://images.weserv.nl/?url=https://raw.githubusercontent.com/jacktom12/blogpic3/main/Muhteşem Whatsapp Profil Fotoğrafları [Full HD].jpg"
            alt=""
          >
        </div>
        <div class="post-right">
          <div class="post-header">
            <span class="author">迷蒙幻影</span>
            <span class="post-time">${showTime}</span>
          </div>
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
    while (tempDiv.firstChild) {
      box.appendChild(tempDiv.firstChild);
    }
  }

  isLoading = false;
  bindImages();
}

function setupInfinite() {
  window.addEventListener('scroll', async () => {
    if (isLoading) return;

    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 100) {
      // 只要内存缓冲池里还有未显示的过滤内容，滚动触底仅增加分页，属于纯本地DOM操作
      if (page * perPage < filtered.length) {
        page++;
        render(false);
      } 
      // 只有在全量数据未拉取，且没到最早边界年限时，才会触发网络请求加载下一年
      else if (!noMoreYearFile && !isAllLoaded) {
        await loadYearMd(currentLoadYear);
      }
    }
  });
}

let isDraggingGallery = false;

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
      return;
    }

    for (let i = 0; i < total; i++) {
      const dot = document.createElement('span');
      dot.className = 'dot' + (i === 0 ? ' active' : '');
      dot.dataset.idx = i;
      dot.onclick = () => goIndex(i);
      dotsBox.appendChild(dot);
    }

    const dots = dotsBox.querySelectorAll('.dot');

    let startX = 0;
    let dragStartTrans = 0;
    let curIdx = 0;
    let momentumID = null;
    let isDown = false;

    function goIndex(idx) {
      curIdx = idx;
      slide.classList.remove('no-trans');
      const imgWidth = imgs[0].offsetWidth + 8;
      slide.style.transform = `translateX(${-imgWidth * curIdx}px)`;
      dots.forEach(d => d.classList.remove('active'));
      dots[curIdx].classList.add('active');
    }

    function stopMomentum() {
      if (momentumID) cancelAnimationFrame(momentumID);
      momentumID = null;
    }

    function momentum(speed) {
      stopMomentum();

      const animate = () => {
        speed *= 0.92;

        if (Math.abs(speed) < 0.3) {
          const imgW = imgs[0].offsetWidth + 8;
          const trans = getComputedStyle(slide).transform;
          let x = 0;
          if (trans && trans !== 'none') {
            x = parseFloat(trans.split(',')[4]);
          }
          const targetIdx = Math.round(-x / imgW);
          curIdx = Math.max(0, Math.min(total - 1, targetIdx));
          goIndex(curIdx);
          return;
        }

        let nowX = parseFloat(
          slide.style.transform.replace('translateX(', '').replace('px)', '')
        ) || 0;

        slide.style.transform = `translateX(${nowX + speed}px)`;
        momentumID = requestAnimationFrame(animate);
      };

      momentumID = requestAnimationFrame(animate);
    }

    wrap.addEventListener('mousedown', e => {
      isDown = true;
      isDraggingGallery = false;
      wrap.classList.add('dragging');
      slide.classList.add('no-trans');
      stopMomentum();
      startX = e.pageX;

      const trans = getComputedStyle(slide).transform;
      dragStartTrans = trans === 'none' ? 0 : parseFloat(trans.split(',')[4]);

      e.preventDefault();
    });

    wrap.addEventListener('mousemove', e => {
      if (!isDown) return;

      const dx = e.pageX - startX;
      const moveX = dragStartTrans + dx * 1.2;
      slide.style.transform = `translateX(${moveX}px)`;

      if (Math.abs(dx) > 6) isDraggingGallery = true;
    });

    wrap.addEventListener('mouseup', e => {
      if (!isDown) return;

      isDown = false;
      wrap.classList.remove('dragging');
      slide.classList.remove('no-trans');

      const dx = e.pageX - startX;
      momentum(dx * 0.12);
    });

    wrap.addEventListener('mouseleave', () => {
      isDown = false;
      wrap.classList.remove('dragging');
    });

    wrap.addEventListener('touchstart', e => {
      isDown = true;
      slide.classList.add('no-trans');
      stopMomentum();
      startX = e.touches[0].pageX;

      const trans = getComputedStyle(slide).transform;
      dragStartTrans = trans === 'none' ? 0 : parseFloat(trans.split(',')[4]);
    });

    wrap.addEventListener('touchmove', e => {
      if (!isDown) return;

      const dx = e.touches[0].pageX - startX;
      slide.style.transform = `translateX(${dragStartTrans + dx * 1.2}px)`;
    });

    wrap.addEventListener('touchend', e => {
      isDown = false;
      slide.classList.remove('no-trans');

      const dx = e.changedTouches[0].pageX - startX;
      momentum(dx * 0.12);
    });
  });

  document.querySelectorAll('.post').forEach(post => {
    const imgs = Array.from(post.querySelectorAll('.post-right img'));

    imgs.forEach((img, index) => {
      if (img.dataset.bound) return;
      img.dataset.bound = true;

      img.onclick = e => {
        if (isDraggingGallery) {
          e.preventDefault();
          return;
        }

        currentGallery = imgs.map(i => i.src);
        currentIndex = index;
        scale = 1;
        lastScale = 1;
        isScaling = false;
        openLightbox();
      };
    });
  });
}

const lb = document.getElementById('lightbox');
const lbImg = document.getElementById('lightboxImg');
const lbCounter = document.getElementById('lb-counter');

let isAnimating = false;

function openLightbox() {
  updateLightboxView(false);
  lb.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  lbImg.style.transform = 'scale(1)';
  lbImg.style.transition = 'transform 0.1s ease';
}

function closeLightbox() {
  lb.style.display = 'none';
  document.body.style.overflow = '';
  scale = 1;
  lastScale = 1;
}

function updateLightboxView(withTransition = true) {
  if (withTransition) {
    isAnimating = true;
    lbImg.classList.add('fading');

    setTimeout(() => {
      lbImg.src = currentGallery[currentIndex];
      lbCounter.textContent = `${currentIndex + 1} / ${currentGallery.length}`;
      lbImg.classList.remove('fading');
      scale = 1;
      lastScale = 1;
      lbImg.style.transform = 'scale(1)';
      isAnimating = false;
    }, 200);
  } else {
    lbImg.src = currentGallery[currentIndex];
    lbCounter.textContent = `${currentIndex + 1} / ${currentGallery.length}`;
  }

  const displayBtns = currentGallery.length > 1 ? 'flex' : 'none';
  document.getElementById('lb-prev').style.display = displayBtns;
  document.getElementById('lb-next').style.display = displayBtns;
}

function showNext() {
  if (currentGallery.length <= 1 || isAnimating) return;
  currentIndex = (currentIndex + 1) % currentGallery.length;
  updateLightboxView(true);
}

function showPrev() {
  if (currentGallery.length <= 1 || isAnimating) return;
  currentIndex = (currentIndex - 1 + currentGallery.length) % currentGallery.length;
  updateLightboxView(true);
}

function setupLightboxControls() {
  document.getElementById('lb-close').onclick = closeLightbox;

  document.getElementById('lb-next').onclick = e => {
    e.stopPropagation();
    if (!isAnimating) showNext();
  };

  document.getElementById('lb-prev').onclick = e => {
    e.stopPropagation();
    if (!isAnimating) showPrev();
  };

  lb.onclick = e => {
    if (e.target === lb || e.target === lbImg) closeLightbox();
  };

  document.addEventListener('keydown', e => {
    if (lb.style.display !== 'flex') return;

    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight' && !isAnimating) showNext();
    if (e.key === 'ArrowLeft' && !isAnimating) showPrev();
  });

  lb.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;

    if (e.touches.length === 2) {
      isScaling = true;
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dx = touch1.clientX - touch2.clientX;
      const dy = touch1.clientY - touch2.clientY;
      lastScale = Math.sqrt(dx * dx + dy * dy);
    }
  });

  lb.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      isScaling = true;
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dx = touch1.clientX - touch2.clientX;
      const dy = touch1.clientY - touch2.clientY;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);

      scale *= currentDistance / lastScale;
      scale = Math.max(0.5, Math.min(3, scale));
      lbImg.style.transform = `scale(${scale})`;
      lastScale = currentDistance;
      e.preventDefault();
      return;
    }

    if (isScaling) return;

    const touchX = e.changedTouches[0].screenX;
    const swipeX = touchX - touchStartX;

    if (Math.abs(swipeX) > 40) {
      if (swipeX < -40) showNext();
      if (swipeX > 40) showPrev();
      touchStartX = touchX;
    }
  });

  lb.addEventListener('touchend', () => {
    isScaling = false;
  });

  lb.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? -0.1 : 0.1;
      scale = Math.max(0.5, Math.min(3, scale + delta));
      lbImg.style.transform = `scale(${scale})`;
    },
    { passive: false }
  );

  lbImg.addEventListener('dblclick', () => {
    scale = scale === 1 ? 2 : 1;
    lbImg.style.transform = `scale(${scale})`;
  });
}

document.getElementById('search').addEventListener('input', applyFilter);

const themeBtn = document.getElementById('themeBtn');

themeBtn.onclick = () => {
  document.body.classList.toggle('dark');
  const isDark = document.body.classList.contains('dark');
  localStorage.theme = isDark ? 'dark' : 'light';
  themeBtn.textContent = isDark ? '☀️' : '🌙';
};

if (localStorage.theme === 'dark') {
  document.body.classList.add('dark');
  themeBtn.textContent = '☀️';
} else {
  themeBtn.textContent = '🌙';
}

init();