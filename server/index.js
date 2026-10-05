const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const os = require('os');
const puppeteer = require('puppeteer');
const express = require('express');
const cors = require('cors');
const deepl = require('deepl-node');
const deeplTranslator = process.env.DEEPL_API_KEY ? new deepl.Translator(process.env.DEEPL_API_KEY) : null;
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { pool, initSchema } = require('./db');
const { env, validateRuntimeConfig } = require('./config');

const app = express();
const port = env.PORT;

const allowedOrigins = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:4200'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  const headerId = req.headers['x-visitor-id'];
  if (headerId && /^[0-9a-f-]{36}$/.test(headerId)) {
    req.visitor_id = headerId;
  } else if (req.cookies?.visitor_id) {
    req.visitor_id = req.cookies.visitor_id;
  } else {
    const id = uuidv4();
    res.cookie('visitor_id', id, { maxAge: 365 * 24 * 3600 * 1000, httpOnly: false, sameSite: 'lax' });
    req.visitor_id = id;
  }
  next();
});

const ANIMALS = ['Fox', 'Wolf', 'Bear', 'Owl', 'Lynx', 'Deer', 'Hawk', 'Seal',
  'Crow', 'Mole', 'Newt', 'Frog', 'Moth', 'Crab', 'Swan', 'Hare',
  'Ibis', 'Kite', 'Lark', 'Mink', 'Puma', 'Rook', 'Vole', 'Wren'];

function visitorAnimal(visitorId) {
  const hash = [...visitorId].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return `Anonymous ${ANIMALS[hash % ANIMALS.length]}`;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

// --- AUTH MIDDLEWARE ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });
  jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }, (err) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
    next();
  });
}

// --- AUTH ROUTE ---
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  const supplied = Buffer.from(password || '');
  const expected = Buffer.from(env.ADMIN_PASSWORD || '');
  if (!password || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'Invalid password.' });
  }
  const token = jwt.sign({ role: 'admin' }, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '8h' });
  res.json({ token });
});

// --- AWS S3 CONFIGURATION ---
const upload = multer({ storage: multer.memoryStorage() });
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

function generateSlug(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function uniqueSlug(pool, table, baseSlug, excludeId = null) {
  let slug = baseSlug;
  let count = 1;
  while (true) {
    const query = excludeId
      ? `SELECT id FROM ${table} WHERE slug = $1 AND id != $2`
      : `SELECT id FROM ${table} WHERE slug = $1`;
    const params = excludeId ? [slug, excludeId] : [slug];
    const result = await pool.query(query, params);
    if (result.rows.length === 0) return slug;
    slug = `${baseSlug}-${count++}`;
  }
}

function calculateReadingTime(contentBlocks) {
  if (!contentBlocks || contentBlocks.length === 0) return '1 min read';
  
  let totalWords = 0;
  contentBlocks.forEach(block => {
    if ((block.type === 'paragraph' || block.type === 'heading') && block.content) {
      // Split by spaces to count words
      totalWords += block.content.trim().split(/\s+/).length;
    }
  });

  const wpm = 200; // Average words per minute
  const minutes = Math.ceil(totalWords / wpm);
  return `${minutes} min read`;
}

function rowToReview(row) {
  return {
    id: row.id,
    album: row.album,
    artist: row.artist,
    image: row.image,
    releaseDate: row.release_date ? String(row.release_date) : '',
    year: row.release_date,
    genre: row.genre,
    subgenres: row.subgenres,
    country: row.country || '',
    description: row.description || '',
    
    slug: row.slug,
    label: row.label,
    date: row.publish_date || '',
    tracklist: typeof row.tracklist === 'string' ? JSON.parse(row.tracklist) : (row.tracklist || []),
    totalDuration: row.total_duration || '',
    producer: row.producer || '',
    recordedAt: row.recorded_at || '',
    similarAlbums: typeof row.similar_albums === 'string' ? JSON.parse(row.similar_albums) : (row.similar_albums || []),
    
    context: row.context || '',
    introduction: row.introduction || '',
    breakdown: typeof row.breakdown === 'string' ? JSON.parse(row.breakdown) : (row.breakdown || []),
    conclusion: row.conclusion || '',
    score: row.score != null ? Number(row.score) : null,
    published: Boolean(row.published),
    
    comments: typeof row.comments === 'string' ? JSON.parse(row.comments) : (row.comments || []),
    views: row.views || 0,
    likes: row.likes || 0,
    shares: row.shares || 0,
    contextPt: row.context_pt || '',
    introductionPt: row.introduction_pt || '',
    breakdownPt: row.breakdown_pt || [],
    conclusionPt: row.conclusion_pt || '',
  };
}

// ----------------------------------------------------
// ARTICLE ROUTES
// ----------------------------------------------------

function rowToArticle(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    theme: row.theme,
    placement: row.placement || 'none',
    keywords: row.keywords,
    description: row.description,
    date: row.publish_date,
    image: row.image,
    youtubeVideoId: row.youtube_video_id,
    readingTime: row.reading_time,
    views: row.views || 0,
    likes: row.likes || 0,
    shares: row.shares || 0,
    comments: typeof row.comments === 'string' ? JSON.parse(row.comments) : (row.comments || []),
    contentBlocks: row.content_blocks,
    published: row.published,
    titlePt: row.title_pt || '',
    descriptionPt: row.description_pt || '',
    contentBlocksPt: row.content_blocks_pt || [],
  };
}

app.get('/api/articles', async (req, res) => {
  const { published } = req.query;
  try {
    let query = 'SELECT * FROM cms_articles ORDER BY id DESC';
    if (published === 'true') {
      query = 'SELECT * FROM cms_articles WHERE published = true ORDER BY id DESC';
    }
    const result = await pool.query(query);
    res.json({ articles: result.rows.map(rowToArticle) });
  } catch (err) {
    console.error('Error fetching articles:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Supports both slug and legacy numeric id — numeric id returns 301 redirect to slug URL
app.get('/api/articles/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    const isNumeric = /^\d+$/.test(slug);
    const query = isNumeric
      ? 'SELECT * FROM cms_articles WHERE id = $1'
      : 'SELECT * FROM cms_articles WHERE slug = $1';
    const result = await pool.query(query, [slug]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Article not found' });

    const row = result.rows[0];

    // Redirect old numeric-id URLs to slug URL
    if (isNumeric && row.slug) {
      return res.redirect(301, `/api/articles/${row.slug}`);
    }

    res.json(rowToArticle(row));
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/articles', authenticateToken, async (req, res) => {
  try {
    const baseSlug = await uniqueSlug(pool, 'cms_articles', 'untitled-draft');
    const result = await pool.query(`
      INSERT INTO cms_articles (title, slug, theme, published, views, likes, content_blocks)
      VALUES ('Untitled Draft', $1, 'Music', false, 0, 0, '[]'::jsonb)
      RETURNING *;
    `, [baseSlug]);

    res.status(201).json(rowToArticle(result.rows[0]));
  } catch (err) {
    console.error('Error creating draft:', err);
    res.status(500).json({ error: 'Failed to create new article draft' });
  }
});

app.delete('/api/articles/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM cms_articles WHERE id = $1', [id]);
    
    // rowCount tells us if a row was actually found and deleted
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }
    
    res.json({ message: 'Article deleted successfully' });
  } catch (err) {
    console.error('Error deleting article:', err);
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

app.put('/api/articles/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const b = req.body;
  const placement = b.placement || 'none';
  const calculatedReadingTime = calculateReadingTime(b.contentBlocks);

  try {
    const newSlug = await uniqueSlug(pool, 'cms_articles', generateSlug(b.title || 'untitled-draft'), id);

    if (placement === 'main') {
      await pool.query(`UPDATE cms_articles SET placement = 'none' WHERE placement = 'main' AND id != $1`, [id]);
    } else if (placement === 'side') {
      await pool.query(`UPDATE cms_articles SET placement = 'none' WHERE placement = 'side' AND id != $1`, [id]);
    }
    const result = await pool.query(
      `UPDATE cms_articles SET
        title = $1,
        slug = $2,
        theme = $3,
        keywords = $4,
        description = $5,
        image = $6,
        content_blocks = $7::jsonb,
        published = $8,
        reading_time = $9,
        placement = $10,
        youtube_video_id = $11,
        title_pt = $12,
        description_pt = $13,
        content_blocks_pt = $14::jsonb,
        publish_date = CASE WHEN $8 = true AND publish_date IS NULL THEN CURRENT_DATE ELSE publish_date END,
        updated_at = NOW()
      WHERE id = $15
      RETURNING *`,
      [
        b.title || 'Untitled Draft',
        newSlug,
        b.theme || 'Music',
        b.keywords || '',
        b.description || '',
        b.image || '',
        JSON.stringify(b.contentBlocks || []),
        Boolean(b.published),
        calculatedReadingTime,
        placement,
        b.youtubeVideoId || '',
        b.titlePt || '',
        b.descriptionPt || '',
        JSON.stringify(b.contentBlocksPt || []),
        id
      ]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Article not found in DB' });
    res.json({ message: 'Article updated successfully', slug: result.rows[0].slug });
  } catch (err) {
    console.error('Error updating article:', err);
    res.status(500).json({ error: 'Failed to update database' });
  }
});

// ----------------------------------------------------
// ENGAGEMENT ENDPOINTS (articles + reviews)
// ----------------------------------------------------

async function recordView(contentType, contentId, visitorId) {
  const r = await pool.query(
    `INSERT INTO visitor_interactions(visitor_id, content_type, content_id, action)
     VALUES($1,$2,$3,'view') ON CONFLICT DO NOTHING RETURNING id`,
    [visitorId, contentType, contentId]
  );
  if (r.rowCount > 0) {
    const table = contentType === 'article' ? 'cms_articles' : 'cms_reviews';
    await pool.query(`UPDATE ${table} SET views = views + 1 WHERE id = $1`, [contentId]);
  }
}

async function toggleLike(contentType, contentId, visitorId) {
  const table = contentType === 'article' ? 'cms_articles' : 'cms_reviews';
  const existing = await pool.query(
    `SELECT id FROM visitor_interactions WHERE visitor_id=$1 AND content_type=$2 AND content_id=$3 AND action='like'`,
    [visitorId, contentType, contentId]
  );
  if (existing.rowCount > 0) {
    await pool.query(
      `DELETE FROM visitor_interactions WHERE visitor_id=$1 AND content_type=$2 AND content_id=$3 AND action='like'`,
      [visitorId, contentType, contentId]
    );
    const result = await pool.query(
      `UPDATE ${table} SET likes = GREATEST(likes - 1, 0) WHERE id = $1 RETURNING likes`, [contentId]
    );
    return { liked: false, likes: result.rows[0].likes };
  } else {
    await pool.query(
      `INSERT INTO visitor_interactions(visitor_id, content_type, content_id, action) VALUES($1,$2,$3,'like')`,
      [visitorId, contentType, contentId]
    );
    const result = await pool.query(
      `UPDATE ${table} SET likes = likes + 1 WHERE id = $1 RETURNING likes`, [contentId]
    );
    return { liked: true, likes: result.rows[0].likes };
  }
}

async function addComment(contentType, contentId, visitorId, text) {
  const animal = visitorAnimal(visitorId);
  const data = { text, animal_name: animal, date: new Date().toISOString() };
  await pool.query(
    `INSERT INTO visitor_interactions(visitor_id, content_type, content_id, action, data) VALUES($1,$2,$3,'comment',$4::jsonb)`,
    [visitorId, contentType, contentId, JSON.stringify(data)]
  );
  const table = contentType === 'article' ? 'cms_articles' : 'cms_reviews';
  await pool.query(
    `UPDATE ${table} SET comments = comments || $1::jsonb WHERE id = $2`,
    [JSON.stringify([{ user: animal, date: data.date, text }]), contentId]
  );
  return { user: animal, date: data.date, text };
}

async function recordShare(contentType, contentId, visitorId) {
  const table = contentType === 'article' ? 'cms_articles' : 'cms_reviews';
  const r = await pool.query(
    `INSERT INTO visitor_interactions(visitor_id, content_type, content_id, action)
     VALUES($1,$2,$3,'share') ON CONFLICT DO NOTHING RETURNING id`,
    [visitorId, contentType, contentId]
  );
  if (r.rowCount > 0) {
    await pool.query(`UPDATE ${table} SET shares = shares + 1 WHERE id = $1`, [contentId]);
  }
}

async function getVisitorState(contentType, contentId, visitorId) {
  const result = await pool.query(
    `SELECT action FROM visitor_interactions WHERE visitor_id=$1 AND content_type=$2 AND content_id=$3 AND action IN ('like','view')`,
    [visitorId, contentType, contentId]
  );
  const actions = result.rows.map(r => r.action);
  return { liked: actions.includes('like'), viewed: actions.includes('view') };
}

// Articles engagement
app.post('/api/articles/:id/view', async (req, res) => {
  try { await recordView('article', req.params.id, req.visitor_id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: 'Failed to record view' }); }
});

app.post('/api/articles/:id/like', async (req, res) => {
  try { res.json(await toggleLike('article', req.params.id, req.visitor_id)); }
  catch (err) { res.status(500).json({ error: 'Failed to toggle like' }); }
});

app.post('/api/articles/:id/comment', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Comment text required' });
  try { res.json(await addComment('article', req.params.id, req.visitor_id, text.trim())); }
  catch (err) { res.status(500).json({ error: 'Failed to add comment' }); }
});

app.post('/api/articles/:id/share', async (req, res) => {
  try { await recordShare('article', req.params.id, req.visitor_id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: 'Failed to record share' }); }
});

app.get('/api/articles/:id/visitor-state', async (req, res) => {
  try { res.json(await getVisitorState('article', req.params.id, req.visitor_id)); }
  catch (err) { res.status(500).json({ error: 'Failed to get visitor state' }); }
});

// Reviews engagement
app.post('/api/reviews/:id/view', async (req, res) => {
  try { await recordView('review', req.params.id, req.visitor_id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: 'Failed to record view' }); }
});

app.post('/api/reviews/:id/like', async (req, res) => {
  try { res.json(await toggleLike('review', req.params.id, req.visitor_id)); }
  catch (err) { res.status(500).json({ error: 'Failed to toggle like' }); }
});

app.post('/api/reviews/:id/comment', async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Comment text required' });
  try { res.json(await addComment('review', req.params.id, req.visitor_id, text.trim())); }
  catch (err) { res.status(500).json({ error: 'Failed to add comment' }); }
});

app.post('/api/reviews/:id/share', async (req, res) => {
  try { await recordShare('review', req.params.id, req.visitor_id); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: 'Failed to record share' }); }
});

app.get('/api/reviews/:id/visitor-state', async (req, res) => {
  try { res.json(await getVisitorState('review', req.params.id, req.visitor_id)); }
  catch (err) { res.status(500).json({ error: 'Failed to get visitor state' }); }
});

app.get('/api/visitor-liked-review-ids', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT content_id FROM visitor_interactions WHERE visitor_id=$1 AND content_type='review' AND action='like'`,
      [req.visitor_id]
    );
    res.json({ ids: result.rows.map(r => Number(r.content_id)) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get liked IDs' });
  }
});

// Admin analytics
app.get('/api/admin/analytics', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT content_type, content_id, action, COUNT(*) as count
       FROM visitor_interactions GROUP BY content_type, content_id, action ORDER BY content_type, content_id`
    );
    res.json({ analytics: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// --- ADMIN DASHBOARD STATS ---
app.get('/api/admin/dashboard', authenticateToken, async (req, res) => {
  try {
    // Querying the last 7 days, 30 days, and 365 days
    const queries = [
      `SELECT action, COUNT(*) FROM visitor_interactions WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY action`,
      `SELECT action, COUNT(*) FROM visitor_interactions WHERE created_at >= NOW() - INTERVAL '1 month' GROUP BY action`,
      `SELECT action, COUNT(*) FROM visitor_interactions WHERE created_at >= NOW() - INTERVAL '1 year' GROUP BY action`
    ];

    const [weekRes, monthRes, yearRes] = await Promise.all(queries.map(q => pool.query(q)));

    // Helper to map DB rows to a clean object
    const formatStats = (rows) => {
      const stats = { view: 0, like: 0, share: 0, comment: 0 };
      rows.forEach(r => stats[r.action] = parseInt(r.count, 10));
      return stats;
    };

    res.json({
      week: formatStats(weekRes.rows),
      month: formatStats(monthRes.rows),
      year: formatStats(yearRes.rows)
    });
  } catch (err) {
    console.error('Error fetching dashboard stats:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// ----------------------------------------------------
// REVIEWS ROUTES
// ----------------------------------------------------

// GET Route: Fetch reviews
app.get('/api/reviews', async (req, res) => {
  const { published } = req.query;
  try {
    let query = 'SELECT * FROM cms_reviews ORDER BY id DESC';
    
    // If the frontend asks for ?published=true (like the Home Page), filter it
    if (published === 'true') {
      query = 'SELECT * FROM cms_reviews WHERE published = true ORDER BY publish_date DESC NULLS LAST, id DESC';
    }

    const result = await pool.query(query);
    const reviews = result.rows.map(rowToReview);
    res.json({ reviews });
  } catch (err) {
    console.error('Error fetching reviews:', err);
    res.status(500).json({ error: 'Database error fetching reviews' });
  }
});

// GET Route: Single Review — supports slug and legacy numeric id (numeric → 301 redirect to slug)
app.get('/api/reviews/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    const isNumeric = /^\d+$/.test(slug);
    const query = isNumeric
      ? 'SELECT * FROM cms_reviews WHERE id = $1'
      : 'SELECT * FROM cms_reviews WHERE slug = $1';
    const result = await pool.query(query, [slug]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Review not found' });

    const row = result.rows[0];
    if (isNumeric && row.slug) {
      return res.redirect(301, `/api/reviews/${row.slug}`);
    }

    const candidates = await pool.query(
      `SELECT id, slug, album, artist, image, genre, subgenres, country, release_date, score
       FROM cms_reviews
       WHERE published = true AND id != $1`,
      [row.id]
    );
    const rowSubgenres = row.subgenres ? row.subgenres.split(',').map(s => s.trim()).filter(Boolean) : [];
    const similarAlbums = candidates.rows
      .map(r => {
        let s = 0;
        if (r.genre && r.genre === row.genre) s += 3;
        if (r.artist && r.artist === row.artist) s += 2;
        if (r.country && r.country === row.country) s += 1;
        if (row.release_date && r.release_date && Math.abs(r.release_date - row.release_date) <= 10) s += 1;
        if (row.release_date && r.release_date && Math.abs(r.release_date - row.release_date) <= 4) s += 1;
        if (r.subgenres && rowSubgenres.length > 0) {
          const rSubgenres = r.subgenres.split(',').map(sg => sg.trim()).filter(Boolean);
          const matches = rSubgenres.filter(sg => rowSubgenres.includes(sg)).length;
          s += matches * 2;
        }
        return { ...r, _score: s };
      })
      .filter(r => r._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 4)
      .map(({ _score, ...r }) => r);

    res.json({ ...rowToReview(row), similarAlbums });
  } catch (err) {
    console.error('Error fetching single review:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/settings — public
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM cms_settings');
    const settings = Object.fromEntries(result.rows.map(r => [r.key, r.value]));
    res.json(settings);
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT /api/settings — authenticated
app.put('/api/settings', authenticateToken, async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'key is required' });
    await pool.query(
      'INSERT INTO cms_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      [key, value ?? null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Error saving setting:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST Route: Image Upload & Compression
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

app.post('/api/upload', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type. Only JPEG, PNG, WebP and GIF are allowed.' });
    }
    if (req.file.size > MAX_FILE_SIZE) {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }

    // Compress to WebP format
    const compressedImageBuffer = await sharp(req.file.buffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const bucketName = process.env.S3_BUCKET_NAME;
    const uniqueFileName = `${Date.now()}-image.webp`; 

    const params = {
      Bucket: bucketName,
      Key: `blog-images/${uniqueFileName}`, 
      Body: compressedImageBuffer,
      ContentType: 'image/webp'
    };

    // Send to S3
    await s3Client.send(new PutObjectCommand(params));

    const imageUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/blog-images/${uniqueFileName}`;

    res.status(200).json({ url: imageUrl });
  } catch (error) {
    console.error("Compression/Upload Error:", error);
    res.status(500).json({ error: 'Failed to process and upload image' });
  }
});

const ALLOWED_AUDIO_MIME_TYPES = [
  'audio/mpeg', 'audio/mp3',
  'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave', 'audio/x-pn-wav',
  'audio/flac', 'audio/x-flac',
  'audio/aac', 'audio/x-aac',
  'audio/ogg',
  'audio/x-m4a', 'audio/mp4', 'audio/m4a'
];
const MAX_AUDIO_SIZE = 50 * 1024 * 1024; // 50MB
const AUDIO_CLIP_DURATION = 20;

app.post('/api/upload-audio', authenticateToken, upload.single('audio'), async (req, res) => {
  let tmpIn, tmpOut;
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    if (!ALLOWED_AUDIO_MIME_TYPES.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type. Allowed: MP3, WAV, FLAC, AAC, OGG, M4A.' });
    }
    if (req.file.size > MAX_AUDIO_SIZE) {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }

    const ts = Date.now();
    tmpIn = path.join(os.tmpdir(), `audio-in-${ts}`);
    tmpOut = path.join(os.tmpdir(), `audio-out-${ts}.mp3`);

    await fs.promises.writeFile(tmpIn, req.file.buffer);

    await new Promise((resolve, reject) => {
      ffmpeg(tmpIn)
        .audioCodec('libmp3lame')
        .audioBitrate(128)
        .duration(AUDIO_CLIP_DURATION)
        .output(tmpOut)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    const outputBuffer = await fs.promises.readFile(tmpOut);
    const bucketName = process.env.S3_BUCKET_NAME;
    const fileName = `${ts}-clip.mp3`;

    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: `blog-audio/${fileName}`,
      Body: outputBuffer,
      ContentType: 'audio/mpeg'
    }));

    const audioUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/blog-audio/${fileName}`;
    res.status(200).json({ url: audioUrl });
  } catch (error) {
    console.error('Audio upload error:', error);
    res.status(500).json({ error: 'Failed to process and upload audio' });
  } finally {
    if (tmpIn) fs.promises.unlink(tmpIn).catch(() => {});
    if (tmpOut) fs.promises.unlink(tmpOut).catch(() => {});
  }
});

app.put('/api/reviews/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const b = req.body;

  try {
    const current = await pool.query('SELECT album, artist FROM cms_reviews WHERE id = $1', [id]);
    if (current.rowCount === 0) return res.status(404).json({ error: 'Review not found' });
    const { album, artist } = current.rows[0];
    const newSlug = await uniqueSlug(pool, 'cms_reviews', generateSlug(`${album}-${artist}`), id);

    await pool.query(
      `UPDATE cms_reviews SET
        score = $1,
        published = $2,
        introduction = $3,
        conclusion = $4,
        breakdown = $5::jsonb,
        description = $6,
        image = $7,
        context = $8,
        tracklist = $9::jsonb,
        total_duration = $10,
        producer = $11,
        recorded_at = $12,
        country = $13,
        slug = $14,
        comments = $15::jsonb,
        context_pt = $17,
        introduction_pt = $18,
        breakdown_pt = $19::jsonb,
        conclusion_pt = $20,
        publish_date = CASE WHEN $2 = true AND publish_date IS NULL THEN TO_CHAR(NOW(), 'YYYY-MM-DD') ELSE publish_date END,
        updated_at = NOW()
      WHERE id = $16`,
      [
        b.score != null ? Number(b.score) : null,
        Boolean(b.published),
        b.introduction || '',
        b.conclusion || '',
        JSON.stringify(b.breakdown || []),
        b.description || '',
        b.image || '',
        b.context || '',
        JSON.stringify(b.tracklist || []),
        b.totalDuration || '',
        b.producer || '',
        b.recordedAt || '',
        b.country || '',
        newSlug,
        JSON.stringify(b.comments || []),
        id,
        b.contextPt || '',
        b.introductionPt || '',
        JSON.stringify(b.breakdownPt || []),
        b.conclusionPt || '',
      ]
    );

    await pool.query(
      `UPDATE cms_list_meta SET 
        score = $1, 
        published = $2,
        date = (SELECT publish_date FROM cms_reviews WHERE id = $3)
       WHERE review_id = $3`,
      [
        b.score != null ? Number(b.score) : null,
        Boolean(b.published),
        id
      ]
    );

    res.json({ message: 'Review updated successfully' });
  } catch (err) {
    console.error('Error updating review:', err);
    res.status(500).json({ error: 'Failed to update database' });
  }
});

// --- COMMENT MANAGEMENT (ADMIN) ---
app.delete('/api/admin/:type/:id/comments/:index', authenticateToken, async (req, res) => {
  const { type, id, index } = req.params;
  const table = type === 'articles' ? 'cms_articles' : 'cms_reviews';
  const idx = parseInt(index, 10);
  try {
    const r = await pool.query(`SELECT comments FROM ${table} WHERE id=$1`, [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    const comments = r.rows[0].comments || [];
    comments.splice(idx, 1);
    await pool.query(`UPDATE ${table} SET comments=$1::jsonb WHERE id=$2`, [JSON.stringify(comments), id]);
    res.json({ comments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

app.put('/api/admin/:type/:id/comments/:index/reply', authenticateToken, async (req, res) => {
  const { type, id, index } = req.params;
  const { text } = req.body;
  const table = type === 'articles' ? 'cms_articles' : 'cms_reviews';
  const idx = parseInt(index, 10);
  try {
    const r = await pool.query(`SELECT comments FROM ${table} WHERE id=$1`, [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    const comments = r.rows[0].comments || [];
    if (!comments[idx]) return res.status(404).json({ error: 'Comment not found' });
    comments[idx].adminReply = text?.trim() ? { text: text.trim(), date: new Date().toISOString() } : null;
    await pool.query(`UPDATE ${table} SET comments=$1::jsonb WHERE id=$2`, [JSON.stringify(comments), id]);
    res.json({ comments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reply to comment' });
  }
});

// --- AUTO-TRANSLATE ---
app.post('/api/admin/translate', authenticateToken, async (req, res) => {
  if (!deeplTranslator) return res.status(503).json({ error: 'DEEPL_API_KEY not configured' });
  const { textFields = {}, blocks = [] } = req.body;
  try {
    const translatedFields = {};
    for (const [key, text] of Object.entries(textFields)) {
      if (text?.trim()) {
        const r = await deeplTranslator.translateText(text, 'en', 'pt-BR');
        translatedFields[key] = r.text;
      }
    }
    const translatedBlocks = await Promise.all(blocks.map(async (block) => {
      const b = { ...block };
      if ((b.type === 'paragraph' || b.type === 'heading') && b.content) {
        b.content = (await deeplTranslator.translateText(b.content, 'en', 'pt-BR')).text;
      }
      if (b.type === 'image' && b.caption) {
        b.caption = (await deeplTranslator.translateText(b.caption, 'en', 'pt-BR')).text;
      }
      return b;
    }));
    res.json({ translatedFields, translatedBlocks });
  } catch (err) {
    console.error('Translation error:', err);
    res.status(500).json({ error: 'Translation failed', detail: err.message });
  }
});

// --- SHARE CARD ---
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

app.post('/api/share-card', async (req, res) => {
  const { type = 'post', title, desc, artist, image, category, url } = req.body;
  if (!['post','review'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
  const templatePath = path.join(__dirname, '../src/assets/cards', `${type}-card.html`);
  let html;
  try { html = fs.readFileSync(templatePath, 'utf8'); }
  catch { return res.status(400).json({ error: 'Template not found' }); }

  if (title) html = html.replace(/(<div class="title">)[^<]*(<\/div>)/, `$1${escHtml(title)}$2`);
  if (type === 'post' && desc) html = html.replace(/(<div class="description">)[^<]*(<\/div>)/, `$1${escHtml(desc)}$2`);
  if (type === 'review' && artist) html = html.replace(/(<div class="artist">)[^<]*(<\/div>)/, `$1${escHtml(artist)}$2`);
  if (type === 'post' && category) html = html.replace(/<!--\s*Optional[\s\S]*?-->/, `<div class="category">${escHtml(category)}</div>`);
  if (image) html = html.replace(/<div class="image-placeholder">[\s\S]*?<\/div>/, `<img src="${String(image).replace(/"/g,'&quot;')}" alt="Cover">`);

  if (url && type === 'review') {
    try {
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 360,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
      html = html.replace('QR_PLACEHOLDER', qrDataUrl);
    } catch {
      html = html.replace(/(<div class="qr-wrap">)[\s\S]*?(<\/div>)/, '');
    }
  } else {
    html = html.replace(/(<div class="qr-wrap">)[\s\S]*?(<\/div>\s*<\/div>)/, '');
  }

  const isStories = type === 'review';
  const vpHeight = isStories ? 1920 : 1350;

  try {
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: vpHeight, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 800));
    const card = await page.$('.card');
    const buffer = await card.screenshot({ encoding: 'binary', omitBackground: true });
    await browser.close();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="${type}-card.png"`);
    res.send(buffer);
  } catch (err) {
    console.error('Card generation error:', err);
    res.status(500).json({ error: 'Card generation failed' });
  }
});

// --- SITEMAP ---
app.get('/sitemap.xml', async (req, res) => {
  const baseUrl = process.env.SITE_URL || 'https://isaia.com.br';
  try {
    const [articles, reviews] = await Promise.all([
      pool.query(`SELECT slug, updated_at FROM cms_articles WHERE published = true AND slug IS NOT NULL`),
      pool.query(`SELECT slug, updated_at FROM cms_reviews WHERE published = true AND slug IS NOT NULL`)
    ]);

    const articleUrls = articles.rows.map(row => `
  <url>
    <loc>${baseUrl}/articles/${row.slug}</loc>
    <lastmod>${new Date(row.updated_at).toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

    const reviewUrls = reviews.rows.map(row => `
  <url>
    <loc>${baseUrl}/reviews/${row.slug}</loc>
    <lastmod>${new Date(row.updated_at).toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/articles-page</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${baseUrl}/collection-page</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>${articleUrls}${reviewUrls}
</urlset>`;

    res.set('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    console.error('Sitemap error:', err);
    res.status(500).send('Failed to generate sitemap');
  }
});

// --- 4. SERVER START ---
function start() {
  validateRuntimeConfig();
  const server = app.listen(port, () => {
    console.log(`\nBackend server listening on http://localhost:${port}\n`);
  });

  // Schema initialization stays non-blocking, but configuration errors never do.
  initSchema()
    .then(() => console.log('Database schema verified.'))
    .catch((err) => console.error('Database schema init failed:', err.message));
  return server;
}

if (require.main === module) start();

module.exports = { app, start };
