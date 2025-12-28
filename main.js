        const loaderElement = document.getElementById('page-loader');
        const rewardNodeList = Array.from(document.querySelectorAll('.reward-track [data-threshold]')).sort((a, b) => {
            return Number(a.dataset.threshold || 0) - Number(b.dataset.threshold || 0);
        });
        const MEMBER_KEY = 'member';
        const ACCESS_CODE = '1111';
        const heroUi = {
            total: document.getElementById('stat-total'),
            pdfs: document.getElementById('stat-pdfs'),
            youtube: document.getElementById('stat-youtube'),
            visuals: document.getElementById('stat-visuals'),
            motivation: document.getElementById('stat-motivation'),
            streak: document.getElementById('streak-count'),
            rewardNote: document.getElementById('reward-note'),
            xpFill: document.getElementById('xp-progress-fill'),
            xpLabel: document.getElementById('xp-progress-label'),
            trackNodes: rewardNodeList.length ? rewardNodeList : null,
            pulseLinks: document.getElementById('pulse-links'),
            pulseVisuals: document.getElementById('pulse-visuals'),
            pulseEnergy: document.getElementById('pulse-energy')
        };
        const numberFormatter = new Intl.NumberFormat('en-US');
        const inlineResults = window.inlineScrapedResults || null;
        const scrapedDataPromise = loadScrapedData();

        const PDF_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
        if (window.pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
        }

        const lightboxState = { container: null, image: null, caption: null, items: [], index: -1 };
        let supportTimer = null;
        const youtubeTitleCache = new Map();

        async function loadScrapedData() {
            if (window.scrapedData && Array.isArray(window.scrapedData.links)) {
                return window.scrapedData;
            }

            try {
                const response = await fetch('results.txt', { cache: 'no-store' });
                if (!response.ok) {
                    throw new Error(`Failed to fetch results.txt (${response.status})`);
                }
                const payload = await response.json();
                const normalized = normalizePayload(payload);
                window.scrapedData = normalized;
                return normalized;
            } catch (error) {
                if (inlineResults) {
                    console.warn('Falling back to inline results bundle.', error);
                    const normalized = normalizePayload(inlineResults);
                    window.scrapedData = normalized;
                    return normalized;
                }
                console.error('Unable to load results from results.txt', error);
                return getEmptyData();
            }
        }

        function normalizePayload(payload = {}) {
            const resource = payload.resource || {};
            const motivation = payload.motivation || {};

            return {
                links: resource.links || [],
                images: resource.images || [],
                videos: resource.videos || [],
                motivation: motivation.links || []
            };
        }

        function getEmptyData() {
            return { links: [], images: [], videos: [], motivation: [] };
        }

        document.addEventListener('DOMContentLoaded', () => {
            setupLightbox();
            initPdfAccessGate();
            scheduleSupportModal();
            showLoader();
            const dataLoad = scrapedDataPromise.then(populateDashboard);
            const minimumDelay = new Promise(resolve => setTimeout(resolve, 1200));
            Promise.allSettled([dataLoad, minimumDelay])
                .finally(() => hideLoader());
        });

        async function populateDashboard(data) {
            const safeData = data || { links: [], images: [], videos: [], motivation: [] };
            const uniqueImages = uniqueList(safeData.images);
            const uniqueVideos = uniqueList(safeData.videos);
            const { pdfLinks, youtubeVideos, otherLinks } = categorizeLinks(safeData.links);
            const motivationLinks = buildLinkItems(safeData.motivation);
            const imageItems = uniqueImages.map(src => ({ src, label: buildImageLabel(src) }));
            const videoItems = uniqueVideos.map(src => ({ src, label: buildMediaLabel(src) }));

            const heroSummary = {
                totalLinks: pdfLinks.length + youtubeVideos.length + otherLinks.length + motivationLinks.length,
                pdfs: pdfLinks.length,
                youtube: youtubeVideos.length,
                visuals: imageItems.length + videoItems.length,
                motivation: motivationLinks.length,
                mediaTotal: imageItems.length + videoItems.length
            };
            updateHeroStats(heroSummary);

            renderPdfGallery('pdf-list', pdfLinks, 'No PDFs available yet.');
            renderLinkList('other-links', otherLinks, 'No other links available yet.');
            renderLinkList('motivation-links', motivationLinks, 'No motivation links available yet.');
            await renderYoutubeVideos('youtube-videos', youtubeVideos, 'No YouTube videos found.');
            renderGallery('images-gallery', imageItems, 'image', 'No images to display.');
            renderGallery('videos-gallery', videoItems, 'video', 'No videos to display.');
        }

        function categorizeLinks(links = []) {
            const pdfLinks = [];
            const youtubeVideos = [];
            const otherLinks = [];
            const seen = new Set();

            (links || []).forEach(rawLink => {
                if (!rawLink) return;
                const link = rawLink.trim();
                if (!link || seen.has(link)) return;
                seen.add(link);

                if (isPdf(link)) {
                    pdfLinks.push({ url: link, label: buildDocumentLabel(link) });
                    return;
                }

                const youtubeId = extractYoutubeId(link);
                if (youtubeId) {
                    youtubeVideos.push({ url: link, id: youtubeId, label: buildYoutubeLabel(link, youtubeId) });
                    return;
                }

                otherLinks.push({ url: link, label: buildGenericLabel(link) });
            });

            return { pdfLinks, youtubeVideos, otherLinks };
        }

        function buildLinkItems(links = []) {
            const items = [];
            const seen = new Set();

            (links || []).forEach(rawLink => {
                if (!rawLink) return;
                const link = rawLink.trim();
                if (!link || seen.has(link)) return;
                seen.add(link);

                if (isPdf(link)) {
                    items.push({ url: link, label: buildDocumentLabel(link) });
                    return;
                }

                const youtubeId = extractYoutubeId(link);
                if (youtubeId) {
                    items.push({ url: link, label: buildYoutubeLabel(link, youtubeId) });
                    return;
                }

                items.push({ url: link, label: buildGenericLabel(link) });
            });

            return items;
        }

        function renderLinkList(containerId, items, emptyText) {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';

            if (!items.length) {
                const li = document.createElement('li');
                li.className = 'empty-state';
                li.textContent = emptyText;
                container.appendChild(li);
                return;
            }

            const fragment = document.createDocumentFragment();
            items.forEach(item => {
                const li = document.createElement('li');
                const titleLink = document.createElement('a');
                titleLink.className = 'link-title';
                titleLink.href = item.url;
                titleLink.target = '_blank';
                titleLink.rel = 'noopener noreferrer';
                titleLink.textContent = item.label;

                const urlCopy = document.createElement('span');
                urlCopy.className = 'link-url';
                urlCopy.textContent = formatDisplayUrl(item.url);

                li.appendChild(titleLink);
                li.appendChild(urlCopy);
                fragment.appendChild(li);
            });
            container.appendChild(fragment);
        }

        function renderPdfGallery(containerId, pdfs, emptyText) {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';

            if (!pdfs.length) {
                const msg = document.createElement('p');
                msg.className = 'empty-state';
                msg.textContent = emptyText;
                container.appendChild(msg);
                return;
            }

            const fragment = document.createDocumentFragment();
            pdfs.forEach(pdf => {
                const card = document.createElement('div');
                card.className = 'pdf-card';
                card.tabIndex = 0;

                const thumb = document.createElement('img');
                thumb.className = 'pdf-thumb';
                thumb.alt = `${pdf.label} preview`;
                thumb.src = createPdfPlaceholder(pdf.label);

                const title = document.createElement('div');
                title.className = 'pdf-title';
                title.textContent = pdf.label;

                card.appendChild(thumb);
                card.appendChild(title);
                card.addEventListener('click', () => window.open(pdf.url, '_blank', 'noopener'));
                card.addEventListener('keypress', event => {
                    if (event.key === 'Enter') {
                        window.open(pdf.url, '_blank', 'noopener');
                    }
                });

                fragment.appendChild(card);
                loadPdfThumbnail(pdf.url, thumb);
            });
            container.appendChild(fragment);
        }

        function renderYoutubeVideos(containerId, videos, emptyText) {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';

            if (!videos.length) {
                const msg = document.createElement('p');
                msg.className = 'empty-state';
                msg.textContent = emptyText;
                container.appendChild(msg);
                return;
            }

            const fragment = document.createDocumentFragment();
            const pendingTitles = [];
            videos.forEach(video => {
                const wrapper = document.createElement('div');
                wrapper.className = 'media-card youtube-card';

                const heading = document.createElement('h3');
                heading.textContent = 'Loading title…';

                const placeholder = document.createElement('button');
                placeholder.type = 'button';
                placeholder.className = 'youtube-placeholder';
                placeholder.setAttribute('aria-label', 'Load video');

                const thumb = document.createElement('img');
                thumb.src = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
                thumb.alt = video.label || 'YouTube thumbnail';
                thumb.loading = 'lazy';

                const play = document.createElement('span');
                play.className = 'youtube-play';
                play.textContent = '▶';

                placeholder.appendChild(thumb);
                placeholder.appendChild(play);

                const loadIframe = () => {
                    const iframe = document.createElement('iframe');
                    iframe.src = `https://www.youtube-nocookie.com/embed/${video.id}?rel=0&modestbranding=1&autoplay=1`;
                    iframe.frameBorder = '0';
                    iframe.allowFullscreen = true;
                    iframe.setAttribute('loading', 'lazy');
                    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
                    iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
                    wrapper.replaceChild(iframe, placeholder);
                };

                placeholder.addEventListener('click', loadIframe);

                const pending = fetchYoutubeTitle(video).then(title => {
                    heading.textContent = title;
                    placeholder.setAttribute('aria-label', `Play ${title}`);
                }).catch(() => {
                    const fallback = video.label || `YouTube Video (${video.id})`;
                    heading.textContent = fallback;
                    placeholder.setAttribute('aria-label', `Play ${fallback}`);
                });
                pendingTitles.push(pending);

                wrapper.appendChild(heading);
                wrapper.appendChild(placeholder);
                fragment.appendChild(wrapper);
            });
            container.appendChild(fragment);
            return Promise.allSettled(pendingTitles);
        }

        function renderGallery(containerId, items, type, emptyText) {
            const container = document.getElementById(containerId);
            if (!container) return;
            container.innerHTML = '';

            if (!items.length) {
                const msg = document.createElement('p');
                msg.className = 'empty-state';
                msg.textContent = emptyText;
                container.appendChild(msg);
                return;
            }

            const fragment = document.createDocumentFragment();
            items.forEach((item, index) => {
                const cell = document.createElement('div');
                cell.className = 'gallery-item';

                if (type === 'image') {
                    const img = document.createElement('img');
                    img.src = item.src;
                    img.alt = item.label || 'Discord image';
                    img.loading = 'lazy';
                    img.addEventListener('click', () => openLightbox(item.src, item.label, index, items));

                    cell.appendChild(img);
                } else {
                    const video = document.createElement('video');
                    video.className = 'video-player';
                    video.controls = true;
                    video.preload = 'metadata';
                    const source = document.createElement('source');
                    source.src = item.src;
                    source.type = guessMimeType(item.src);
                    video.appendChild(source);

                    const caption = document.createElement('p');
                    caption.className = 'media-caption';
                    caption.textContent = item.label;

                    const fallback = document.createElement('a');
                    fallback.href = item.src;
                    fallback.target = '_blank';
                    fallback.rel = 'noopener noreferrer';
                    fallback.textContent = 'Open video';

                    cell.appendChild(caption);
                    cell.appendChild(video);
                    cell.appendChild(fallback);
                }

                fragment.appendChild(cell);
            });
            container.appendChild(fragment);
        }

        function uniqueList(items = []) {
            return Array.from(new Set(items.map(item => item?.trim()).filter(Boolean)));
        }

        function isPdf(link) {
            return /\.pdf(\?|$)/i.test(link);
        }

        function extractYoutubeId(link) {
            try {
                const url = new URL(link);
                const host = url.hostname.replace(/^www\./, '');

                if (host === 'youtu.be') {
                    return url.pathname.replace('/', '');
                }

                if (host.endsWith('youtube.com')) {
                    if (url.pathname === '/watch') {
                        return url.searchParams.get('v');
                    }
                    if (url.pathname.startsWith('/live/')) {
                        return url.pathname.split('/')[2];
                    }
                    if (url.pathname.startsWith('/shorts/')) {
                        return url.pathname.split('/')[2];
                    }
                }
            } catch (error) {
                return null;
            }
            return null;
        }

        function buildDocumentLabel(link) {
            const name = extractLastSegment(link);
            return name || 'PDF Document';
        }

        function buildYoutubeLabel(link, fallbackId) {
            const name = extractLastSegment(link);
            return name || `YouTube Video (${fallbackId})`;
        }

        function buildGenericLabel(link) {
            try {
                const url = new URL(link);
                let path = url.pathname;
                if (path.length > 50) {
                    path = `${path.slice(0, 47)}...`;
                }
                return `${url.hostname}${path === '/' ? '' : path}`;
            } catch (error) {
                return link;
            }
        }

        function buildImageLabel(link) {
            const segment = extractLastSegment(link);
            return segment || getHostname(link) || 'Image';
        }

        function buildMediaLabel(link) {
            const host = getHostname(link);
            const segment = extractLastSegment(link);
            const isDiscordCdn = host?.includes('cdn.discordapp.com');
            if (segment && (!host || isDiscordCdn)) return segment;
            if (segment && host) return `${host} • ${segment}`;
            return segment || host || 'Video';
        }

        function getHostname(link) {
            try {
                const url = new URL(link);
                return url.hostname;
            } catch (error) {
                return '';
            }
        }

        function extractLastSegment(link) {
            try {
                const url = new URL(link);
                const segments = url.pathname.split('/').filter(Boolean);
                if (!segments.length) {
                    return url.hostname;
                }
                const lastSegment = decodeURIComponent(segments.pop());
                return lastSegment.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
            } catch (error) {
                return link;
            }
        }

        function guessMimeType(src) {
            const ext = src.split('.').pop()?.split('?')[0]?.toLowerCase();
            if (ext === 'webm') return 'video/webm';
            return 'video/mp4';
        }

        function formatDisplayUrl(link) {
            try {
                const url = new URL(link);
                const path = url.pathname === '/' ? '' : url.pathname;
                const search = url.search || '';
                return `${url.hostname}${path}${search}`;
            } catch (error) {
                return link;
            }
        }

        function createPdfPlaceholder(label = 'PDF Document') {
            const canvas = document.createElement('canvas');
            canvas.width = 400;
            canvas.height = 520;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#eef2ff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#dbe4ff';
            ctx.fillRect(0, 0, canvas.width, 140);
            ctx.fillStyle = '#1d4ed8';
            ctx.font = 'bold 56px "Segoe UI", Arial';
            ctx.fillText('PDF', 140, 90);
            ctx.fillStyle = '#1f2937';
            ctx.font = '24px "Segoe UI", Arial';
            wrapText(ctx, label, 30, 200, 340, 30);
            return canvas.toDataURL('image/png');
        }

        async function loadPdfThumbnail(url, imgElement) {
            if (!window.pdfjsLib || !imgElement) return;
            const preview = await generatePdfThumbnail(url);
            if (preview) {
                imgElement.src = preview;
            }
        }

        async function generatePdfThumbnail(url) {
            if (!window.pdfjsLib) return null;
            try {
                const loadingTask = pdfjsLib.getDocument({ url, withCredentials: false });
                const pdf = await loadingTask.promise;
                const page = await pdf.getPage(1);
                const viewport = page.getViewport({ scale: 0.5 });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                await page.render({ canvasContext: context, viewport }).promise;
                const dataUrl = canvas.toDataURL('image/png');
                if (typeof pdf.cleanup === 'function') {
                    pdf.cleanup();
                }
                if (typeof pdf.destroy === 'function') {
                    pdf.destroy();
                }
                return dataUrl;
            } catch (error) {
                console.warn('Unable to generate PDF preview for', url, error);
                return null;
            }
        }

        function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
            const words = text.split(/\s+/);
            let line = '';
            words.forEach(word => {
                const testLine = `${line}${word} `;
                const { width } = ctx.measureText(testLine);
                if (width > maxWidth && line) {
                    ctx.fillText(line.trim(), x, y);
                    line = `${word} `;
                    y += lineHeight;
                } else {
                    line = testLine;
                }
            });
            if (line.trim()) {
                ctx.fillText(line.trim(), x, y);
            }
        }

        function setupLightbox() {
            const container = document.getElementById('image-lightbox');
            if (!container) return;
            lightboxState.container = container;
            lightboxState.image = document.getElementById('lightbox-photo');
            lightboxState.caption = document.getElementById('lightbox-caption');

            container.querySelectorAll('[data-lightbox-close]').forEach(element => {
                element.addEventListener('click', closeLightbox);
            });

            container.addEventListener('click', event => {
                if (event.target === container || event.target.classList.contains('lightbox-overlay')) {
                    closeLightbox();
                }
            });

            document.addEventListener('keydown', event => {
                if (event.key === 'Escape') {
                    closeLightbox();
                    return;
                }
                if (event.key === 'ArrowRight') {
                    navigateLightbox(1);
                    return;
                }
                if (event.key === 'ArrowLeft') {
                    navigateLightbox(-1);
                }
            });
        }

        function openLightbox(src, caption, index = null, items = null) {
            if (!lightboxState.container) {
                window.open(src, '_blank', 'noopener');
                return;
            }
            if (Array.isArray(items) && items.length) {
                lightboxState.items = items.map(entry => ({ src: entry.src, label: entry.label }));
            }
            if (typeof index === 'number') {
                lightboxState.index = index;
            } else if (!lightboxState.items.length) {
                lightboxState.index = -1;
            } else if (lightboxState.index === -1) {
                lightboxState.index = Math.max(0, lightboxState.items.findIndex(item => item.src === src));
            }
            setLightboxContent(src, caption);
            lightboxState.container.classList.remove('hidden');
            requestAnimationFrame(() => lightboxState.container.classList.add('visible'));
        }

        function closeLightbox() {
            if (!lightboxState.container || lightboxState.container.classList.contains('hidden')) return;
            lightboxState.container.classList.remove('visible');
            setTimeout(() => {
                lightboxState.container.classList.add('hidden');
                lightboxState.image.src = '';
                lightboxState.caption.textContent = '';
                lightboxState.index = -1;
            }, 200);
        }

        function navigateLightbox(direction) {
            if (!lightboxState.container || lightboxState.container.classList.contains('hidden')) return;
            if (!lightboxState.items.length) return;
            const total = lightboxState.items.length;
            if (total === 0) return;
            const currentIndex = typeof lightboxState.index === 'number' && lightboxState.index >= 0
                ? lightboxState.index
                : 0;
            let nextIndex = currentIndex + direction;
            if (nextIndex < 0) {
                nextIndex = total - 1;
            } else if (nextIndex >= total) {
                nextIndex = 0;
            }
            lightboxState.index = nextIndex;
            const nextItem = lightboxState.items[nextIndex];
            if (nextItem) {
                setLightboxContent(nextItem.src, nextItem.label);
            }
        }

        function setLightboxContent(src, caption) {
            if (!lightboxState.image) return;
            lightboxState.image.src = src;
            lightboxState.image.alt = caption || 'Image preview';
            if (lightboxState.caption) {
                lightboxState.caption.textContent = caption || '';
            }
        }

        function scheduleSupportModal() {
            const modal = document.getElementById('support-modal');
            if (!modal) return;
            const closeBtn = modal.querySelector('.support-close');
            const hideModal = () => {
                modal.classList.remove('visible');
                modal.setAttribute('aria-hidden', 'true');
            };
            closeBtn?.addEventListener('click', hideModal);
            supportTimer = setTimeout(() => {
                modal.classList.add('visible');
                modal.setAttribute('aria-hidden', 'false');
            }, 45000);
        }

        function initPdfAccessGate() {
            const gate = document.getElementById('pdf-access-gate');
            const form = document.getElementById('pdf-code-form');
            const codeInput = document.getElementById('pdf-access-code');
            const pdfList = document.getElementById('pdf-list');
            const locked = document.getElementById('pdf-locked');
            const error = document.getElementById('pdf-error');
            if (!gate || !form || !codeInput || !pdfList || !locked) return;

            const applyState = (unlocked) => {
                gate.classList.toggle('hidden', unlocked);
                pdfList.classList.toggle('hidden', !unlocked);
                locked.classList.toggle('hidden', !!unlocked);
                error?.classList.add('hidden');
            };

            applyState(isMember());

            form.addEventListener('submit', event => {
                event.preventDefault();
                const attempt = codeInput.value.trim();
                if (attempt === ACCESS_CODE) {
                    persistMemberAccess();
                    applyState(true);
                    codeInput.value = '';
                    return;
                }
                clearMemberAccess();
                locked.classList.remove('hidden');
                pdfList.classList.add('hidden');
                gate.classList.remove('hidden');
                if (error) {
                    error.classList.remove('hidden');
                }
            });
        }

        function persistMemberAccess() {
            try {
                localStorage.setItem(MEMBER_KEY, 'true');
            } catch (error) {
                console.warn('Unable to persist membership flag', error);
            }
        }

        function clearMemberAccess() {
            try {
                localStorage.removeItem(MEMBER_KEY);
            } catch (error) {
                console.warn('Unable to clear membership flag', error);
            }
        }

        function isMember() {
            try {
                return localStorage.getItem(MEMBER_KEY) === 'true';
            } catch (error) {
                return false;
            }
        }

        function showLoader() {
            if (loaderElement) {
                loaderElement.classList.remove('hidden');
            }
        }

        function hideLoader() {
            if (loaderElement) {
                loaderElement.classList.add('hidden');
            }
        }

        function updateHeroStats(summary = {}) {
            if (!heroUi.total) return;
            const total = Math.max(0, summary.totalLinks || 0);
            animateCounter(heroUi.total, total);
            animateCounter(heroUi.pdfs, summary.pdfs || 0);
            animateCounter(heroUi.youtube, summary.youtube || 0);
            animateCounter(heroUi.visuals, summary.visuals || 0);
            animateCounter(heroUi.motivation, summary.motivation || 0);

            const streakValue = total === 0
                ? 0
                : Math.max(1, Math.min(99, Math.round(total / 4)));
            if (heroUi.streak) {
                heroUi.streak.textContent = `${streakValue}d`;
            }

            const visualsTotal = summary.mediaTotal ?? summary.visuals ?? 0;
            updateRewardTrack(total);
            updateXpMeter(total, visualsTotal);
            updatePulse(heroUi.pulseLinks, total, 'drops logged');
            updatePulse(heroUi.pulseVisuals, summary.visuals || 0, 'visuals curated');
            updatePulse(heroUi.pulseEnergy, computeXp(total, visualsTotal), 'XP surge');
        }

        function computeXp(total, mediaTotal) {
            return Math.max(0, (total * 9) + (mediaTotal * 5));
        }

        function updateRewardTrack(total) {
            if (!heroUi.trackNodes || heroUi.trackNodes.length === 0) {
                updateRewardNote(total, null);
                return;
            }
            let nextTier = null;
            heroUi.trackNodes.forEach(node => {
                const threshold = Number(node.dataset.threshold || 0);
                const earned = total >= threshold;
                node.classList.toggle('earned', earned);
                if (!earned && !nextTier) {
                    nextTier = { label: node.dataset.tier || 'Next tier', amount: threshold };
                }
            });
            updateRewardNote(total, nextTier);
        }

        function updateRewardNote(total, nextTier) {
            if (!heroUi.rewardNote) return;
            if (!heroUi.trackNodes || heroUi.trackNodes.length === 0) {
                heroUi.rewardNote.textContent = `${numberFormatter.format(Math.max(0, total))} drops logged across the vault.`;
                return;
            }
            if (!nextTier) {
                heroUi.rewardNote.textContent = 'Legend tier reached. Keep compounding the edge.';
                return;
            }
            const diff = Math.max(1, nextTier.amount - total);
            heroUi.rewardNote.textContent = `${diff} more drops to hit ${nextTier.label}.`;
        }

        function updateXpMeter(total, mediaTotal) {
            if (!heroUi.xpFill) return;
            const xp = computeXp(total, mediaTotal);
            const percent = xp % 100;
            const normalized = xp === 0 ? 0 : (percent === 0 ? 100 : percent);
            heroUi.xpFill.style.width = `${normalized}%`;
            if (heroUi.xpLabel) {
                heroUi.xpLabel.textContent = normalized === 100
                    ? 'Bonus ready — drop another link.'
                    : `${100 - Math.round(normalized)} XP to next boost`;
            }
        }

        function updatePulse(element, value, label) {
            if (!element) return;
            const safe = Math.max(0, Math.floor(value || 0));
            element.textContent = `${numberFormatter.format(safe)} ${label}`;
        }

        function animateCounter(element, value) {
            if (!element) return;
            const target = Math.max(0, Math.floor(value || 0));
            const currentStored = Number(element.dataset.value || element.textContent.replace(/[^0-9]/g, '')) || 0;
            const duration = 600;
            if (currentStored === target) {
                element.textContent = numberFormatter.format(target);
                element.dataset.value = target;
                return;
            }
            const startTime = performance.now();
            const step = (now) => {
                const progress = Math.min(1, (now - startTime) / duration);
                const currentValue = Math.round(currentStored + (target - currentStored) * progress);
                element.textContent = numberFormatter.format(currentValue);
                if (progress < 1) {
                    requestAnimationFrame(step);
                } else {
                    element.dataset.value = target;
                }
            };
            requestAnimationFrame(step);
        }

        function showTab(event, tabId) {
            document.querySelectorAll('.content').forEach(section => section.classList.remove('active'));
            const activeSection = document.getElementById(tabId);
            if (activeSection) {
                activeSection.classList.add('active');
            }
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            const trigger = event?.currentTarget || document.querySelector(`.tab[data-tab="${tabId}"]`);
            trigger?.classList.add('active');
        }

        function jumpToSection(tabId) {
            const trigger = document.querySelector(`.tab[data-tab="${tabId}"]`);
            trigger?.click();
            const section = document.getElementById(tabId);
            section?.scrollIntoView({ behavior: 'smooth' });
            trigger?.scrollIntoView({ behavior: 'smooth', inline: 'center' });
        }

        async function fetchYoutubeTitle(video) {
            const cacheKey = video.id;
            if (youtubeTitleCache.has(cacheKey)) {
                return youtubeTitleCache.get(cacheKey);
            }

            const targetUrl = video.url && video.url.includes('youtube')
                ? video.url
                : `https://www.youtube.com/watch?v=${video.id}`;
            const endpoint = `https://noembed.com/embed?url=${encodeURIComponent(targetUrl)}`;

            try {
                const response = await fetch(endpoint);
                if (!response.ok) throw new Error('NoEmbed failed');
                const data = await response.json();
                const title = data.title || video.label || `YouTube Video (${video.id})`;
                youtubeTitleCache.set(cacheKey, title);
                return title;
            } catch (error) {
                const fallback = video.label || `YouTube Video (${video.id})`;
                youtubeTitleCache.set(cacheKey, fallback);
                return fallback;
            }
        }
