const fs = require('fs');
const path = require('path');
const fsp = fs.promises;

const token = process.env.DISCORD_TOKEN;
const channelIdResource = process.env.DISCORD_RESOURCE_CHANNEL_ID || '1259392713174814816';
const channelIdMotivation = process.env.DISCORD_MOTIVATION_CHANNEL_ID || '1269536886586609695';
const topicsPath = path.join(__dirname, 'topics.json');
const mediaRoot = path.join(__dirname, 'media');

if (!token) {
  throw new Error('Missing DISCORD_TOKEN environment variable.');
}

const results = {
  generatedAt: new Date().toISOString(),
  resource: { links: [], images: [], videos: [], items: [] },
  motivation: { links: [], images: [], videos: [], items: [] }
};

async function readTopicRules() {
  try {
    const raw = await fsp.readFile(topicsPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.warn('Unable to read topics.json. Falling back to default topic rules.', error.message);
    return { topics: [] };
  }
}

async function fetchAllFromChannel(channelId, section, topicRules) {
  let before = null;
  const seen = new Map();

  while (true) {
    const url = `https://discord.com/api/v9/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: token } });

    if (!res.ok) {
      throw new Error(`Discord API failed for ${section}: ${res.status} ${res.statusText}`);
    }

    const msgs = await res.json();
    if (!Array.isArray(msgs) || !msgs.length) break;

    before = msgs[msgs.length - 1].id;

    for (const msg of msgs) {
      const messageItems = extractMessageItems(msg, section);
      for (const item of messageItems) {
        const key = normalizeItemKey(item);
        if (!key) continue;

        const existing = seen.get(key);
        if (existing) {
          mergeItem(existing, item);
          continue;
        }

        const enriched = await enrichItem(item, topicRules);
        seen.set(key, enriched);
      }
    }
  }

  const items = Array.from(seen.values()).sort(compareNewest);
  results[section].items = items;
  results[section].links = items.filter(item => item.kind === 'link').map(item => item.url);
  results[section].images = items.filter(item => item.type === 'image').map(item => item.url);
  results[section].videos = items.filter(item => item.type === 'discord-video').map(item => item.url);
}

function extractMessageItems(msg, section) {
  const items = [];
  const base = {
    sourceChannel: section,
    discordMessageId: msg.id || '',
    discordAuthor: formatDiscordAuthor(msg.author),
    postedAt: msg.timestamp || '',
    rawMessageText: msg.content || ''
  };

  const linkRegex = /(https?:\/\/[^\s<>"')\]]+)/g;
  let match;
  while ((match = linkRegex.exec(msg.content || '')) !== null) {
    const url = cleanUrl(match[1]);
    if (url) {
      items.push({
        ...base,
        url,
        kind: 'link',
        type: detectLinkType(url)
      });
    }
  }

  (msg.attachments || []).forEach(att => {
    if (!att?.url) return;
    if (att.content_type?.startsWith('image/')) {
      items.push({
        ...base,
        url: att.url,
        originalUrl: att.url,
        kind: 'attachment',
        type: 'image',
        title: att.filename || '',
        filename: att.filename || '',
        attachmentId: att.id || '',
        contentType: att.content_type || ''
      });
      return;
    }

    if (att.content_type?.startsWith('video/')) {
      items.push({
        ...base,
        url: att.url,
        originalUrl: att.url,
        kind: 'attachment',
        type: 'discord-video',
        title: att.filename || '',
        filename: att.filename || '',
        attachmentId: att.id || '',
        contentType: att.content_type || ''
      });
    }
  });

  return items;
}

async function enrichItem(item, topicRules) {
  const sourceUrl = item.originalUrl || item.url;
  const enriched = {
    ...item,
    originalUrl: item.kind === 'attachment' ? sourceUrl : (item.originalUrl || ''),
    domain: getHostname(sourceUrl),
    title: item.title || buildTitleFromUrl(sourceUrl),
    creator: '',
    topic: '',
    thumbnailUrl: ''
  };

  if (enriched.kind === 'attachment' && (enriched.type === 'image' || enriched.type === 'discord-video')) {
    await mirrorDiscordAttachment(enriched);
    enriched.creator = enriched.discordAuthor || enriched.domain || 'Discord';
  } else if (enriched.type === 'youtube') {
    await enrichYoutube(enriched);
  } else if (enriched.type === 'x-post') {
    enriched.creator = extractTwitterHandle(enriched.url) || enriched.domain;
    enriched.title = enriched.title || 'X / Twitter post';
  } else {
    await enrichPage(enriched);
  }

  if (!enriched.creator) {
    enriched.creator = creatorFromDomain(enriched.domain) || enriched.discordAuthor || 'Unknown creator';
  }

  enriched.topic = chooseTopic(enriched, topicRules);
  return enriched;
}

async function enrichYoutube(item) {
  const videoId = extractYoutubeId(item.url);
  if (videoId) {
    item.thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  }

  const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : item.url;
  try {
    const response = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(watchUrl)}`);
    if (!response.ok) throw new Error(`noembed ${response.status}`);
    const data = await response.json();
    item.title = data.title || item.title;
    item.creator = data.author_name || item.creator;
  } catch (error) {
    item.creator = item.creator || 'YouTube';
  }
}

async function enrichPage(item) {
  if (item.type === 'pdf') {
    item.creator = creatorFromDomain(item.domain);
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(item.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CANSLIM Resources metadata scraper' }
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`page ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return;
    const html = await response.text();
    item.title = extractMeta(html, 'og:title') || extractTitle(html) || item.title;
    item.creator = extractMeta(html, 'article:author') || extractMeta(html, 'author') || item.creator;
    item.thumbnailUrl = extractMeta(html, 'og:image') || item.thumbnailUrl;
  } catch (error) {
    item.creator = item.creator || creatorFromDomain(item.domain);
  }
}

function chooseTopic(item, topicRules = {}) {
  const haystack = [
    item.title,
    item.creator,
    item.domain,
    item.url,
    item.originalUrl,
    item.rawMessageText,
    item.type
  ].filter(Boolean).join(' ').toLowerCase();

  for (const rule of topicRules.topics || []) {
    const terms = [
      ...(rule.keywords || []),
      ...(rule.domains || []),
      ...(rule.creators || []),
      ...(rule.types || [])
    ];
    if (terms.some(term => haystack.includes(String(term).toLowerCase()))) {
      return rule.name;
    }
  }

  return item.sourceChannel === 'motivation' ? 'Motivation' : 'Unsorted';
}

function mergeItem(existing, incoming) {
  if (incoming.postedAt && (!existing.postedAt || incoming.postedAt > existing.postedAt)) {
    existing.postedAt = incoming.postedAt;
    existing.discordMessageId = incoming.discordMessageId;
    existing.discordAuthor = incoming.discordAuthor;
    existing.rawMessageText = incoming.rawMessageText;
  }
}

function compareNewest(a, b) {
  return String(b.postedAt || '').localeCompare(String(a.postedAt || ''));
}

function detectLinkType(url) {
  if (isPdf(url)) return 'pdf';
  if (extractYoutubeId(url)) return 'youtube';
  if (extractTwitterHandle(url)) return 'x-post';
  if (/\.(mp4|mov|webm)(\?|$)/i.test(url)) return 'video';
  if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(url)) return 'image-link';
  return 'link';
}

function normalizeItemKey(item) {
  if (item.kind === 'attachment' && item.attachmentId) {
    return `discord-attachment:${item.attachmentId}`;
  }
  return normalizeUrlKey(item.url);
}

function normalizeUrlKey(value) {
  try {
    const url = new URL(cleanUrl(value));
    url.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'si', 'fbclid', 'gclid'].forEach(param => {
      url.searchParams.delete(param);
    });
    const youtubeId = extractYoutubeId(url.toString());
    if (youtubeId) return `youtube:${youtubeId}`;
    const tweetId = extractTwitterStatusId(url.toString());
    if (tweetId) return `x:${tweetId}`;
    return url.toString();
  } catch (error) {
    return '';
  }
}

async function mirrorDiscordAttachment(item) {
  const relativePath = buildMirroredRelativePath(item);
  const diskPath = path.join(__dirname, ...relativePath.split('/'));
  const metadataPath = `${diskPath}.json`;

  item.url = relativePath;
  item.mirroredPath = relativePath;

  if (await isCurrentMirror(diskPath, metadataPath, item)) {
    return;
  }

  await fsp.mkdir(path.dirname(diskPath), { recursive: true });

  const response = await fetch(item.originalUrl, {
    headers: { 'User-Agent': 'CANSLIM Resources attachment mirror' }
  });

  if (!response.ok) {
    throw new Error(`Failed to mirror attachment ${item.originalUrl}: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(diskPath, buffer);
  await fsp.writeFile(metadataPath, JSON.stringify({
    attachmentId: item.attachmentId || '',
    originalUrl: item.originalUrl || '',
    mirroredPath: relativePath,
    contentType: item.contentType || '',
    mirroredAt: new Date().toISOString()
  }, null, 2));
}

function buildMirroredRelativePath(item) {
  const section = sanitizePathSegment(item.sourceChannel || 'resource');
  const typeDirectory = item.type === 'discord-video' ? 'videos' : 'images';
  const messageId = sanitizePathSegment(item.discordMessageId || 'message');
  const attachmentId = sanitizePathSegment(item.attachmentId || extractLastPathSegment(item.originalUrl || item.url) || 'asset');
  const nameBase = sanitizePathSegment(path.parse(item.filename || item.title || attachmentId).name || 'asset');
  const extension = getAttachmentExtension(item);
  return toPosixPath(path.join('media', section, typeDirectory, `${messageId}-${attachmentId}-${nameBase}${extension}`));
}

function sanitizePathSegment(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'asset';
}

function getAttachmentExtension(item) {
  const filenameExt = path.extname(item.filename || item.title || '').toLowerCase();
  if (filenameExt) return filenameExt;

  const urlExt = path.extname(extractLastPathSegment(item.originalUrl || item.url)).toLowerCase();
  if (urlExt) return urlExt;

  const contentType = String(item.contentType || '').toLowerCase();
  if (contentType.includes('jpeg')) return '.jpg';
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('gif')) return '.gif';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('quicktime')) return '.mov';
  if (contentType.includes('webm')) return '.webm';
  if (contentType.includes('mp4')) return '.mp4';
  return item.type === 'discord-video' ? '.mp4' : '.jpg';
}

function extractLastPathSegment(link = '') {
  try {
    const pathname = new URL(link).pathname;
    const parts = pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  } catch (error) {
    return '';
  }
}

function toPosixPath(value = '') {
  return String(value).replace(/\\/g, '/');
}

async function isCurrentMirror(diskPath, metadataPath, item) {
  if (!fs.existsSync(diskPath) || !fs.existsSync(metadataPath)) {
    return false;
  }

  try {
    const raw = await fsp.readFile(metadataPath, 'utf8');
    const metadata = JSON.parse(raw);
    return metadata.attachmentId === (item.attachmentId || '')
      && metadata.originalUrl === (item.originalUrl || '');
  } catch (error) {
    return false;
  }
}

function cleanUrl(value = '') {
  return String(value).trim().replace(/[.,;:!?]+$/, '');
}

function formatDiscordAuthor(author = {}) {
  if (!author) return '';
  return author.global_name || author.username || author.id || '';
}

function isPdf(link) {
  return /\.pdf(\?|$)/i.test(link);
}

function extractYoutubeId(link) {
  try {
    const url = new URL(link);
    const host = url.hostname.replace(/^(www|m)\./, '');
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (!host.endsWith('youtube.com')) return '';
    if (url.pathname === '/watch') return url.searchParams.get('v') || '';
    if (url.pathname.startsWith('/live/') || url.pathname.startsWith('/shorts/')) {
      return url.pathname.split('/')[2] || '';
    }
  } catch (error) {
    return '';
  }
  return '';
}

function extractTwitterHandle(link) {
  try {
    const url = new URL(link);
    const host = url.hostname.replace(/^(www|mobile|m)\./, '');
    if (host !== 'twitter.com' && host !== 'x.com') return '';
    const [handle] = url.pathname.split('/').filter(Boolean);
    return handle ? `@${handle}` : '';
  } catch (error) {
    return '';
  }
}

function extractTwitterStatusId(link) {
  try {
    const url = new URL(link);
    const match = url.pathname.match(/\/status\/(\d+)/);
    return match ? match[1] : '';
  } catch (error) {
    return '';
  }
}

function getHostname(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch (error) {
    return '';
  }
}

function creatorFromDomain(domain = '') {
  return domain
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|edu|gov)$/i, '')
    .split('.')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildTitleFromUrl(link) {
  try {
    const url = new URL(link);
    const segments = url.pathname.split('/').filter(Boolean);
    const segment = decodeURIComponent(segments.pop() || url.hostname);
    return segment.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() || url.hostname;
  } catch (error) {
    return link;
  }
}

function extractMeta(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regexes = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i')
  ];
  for (const regex of regexes) {
    const match = html.match(regex);
    if (match) return decodeHtml(match[1]);
  }
  return '';
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? decodeHtml(match[1]) : '';
}

function decodeHtml(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

async function main() {
  const topicRules = await readTopicRules();
  await fsp.mkdir(mediaRoot, { recursive: true });
  await fetchAllFromChannel(channelIdResource, 'resource', topicRules);
  await fetchAllFromChannel(channelIdMotivation, 'motivation', topicRules);
  await fsp.writeFile('results.txt', JSON.stringify(results, null, 2));
  console.log(`Scraped ${results.resource.items.length} resource items and ${results.motivation.items.length} motivation items.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
