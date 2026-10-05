const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'postgres',
  // A database password is never optional.  Startup validation in config.js
  // rejects a missing value before this pool is used.
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  ssl: (process.env.DB_HOST && process.env.DB_HOST !== 'localhost' && process.env.DB_HOST !== '127.0.0.1') ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
});

const initSchema = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS cms_reviews (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(255),
        album VARCHAR(255) NOT NULL,
        artist VARCHAR(255) NOT NULL,
        image TEXT,
        release_date INT,
        label VARCHAR(255),
        genre VARCHAR(255),
        subgenres VARCHAR(255),
        description TEXT,
        context TEXT,
        introduction TEXT,
        breakdown JSONB DEFAULT '[]',
        conclusion TEXT,
        similar_albums JSONB DEFAULT '[]',
        comments JSONB DEFAULT '[]',
        score NUMERIC DEFAULT NULL,
        published BOOLEAN DEFAULT FALSE,
        tracklist JSONB DEFAULT '[]',
        total_duration VARCHAR(50),
        producer VARCHAR(255),
        recorded_at VARCHAR(255),
        country VARCHAR(100),
        publish_date VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS cms_list_meta (
        id SERIAL PRIMARY KEY,
        review_id INT NOT NULL REFERENCES cms_reviews(id) ON DELETE CASCADE,
        album VARCHAR(255) NOT NULL,
        artist VARCHAR(255) NOT NULL,
        year INT NOT NULL,
        image TEXT,
        description TEXT,
        date VARCHAR(50),
        genres VARCHAR(255),
        subgenres VARCHAR(255),
        country VARCHAR(100),
        score NUMERIC DEFAULT NULL,
        published BOOLEAN DEFAULT FALSE,
        UNIQUE(review_id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS cms_articles (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(255) UNIQUE,
        publish_date DATE,
        reading_time VARCHAR(50),
        title VARCHAR(255) NOT NULL,
        theme VARCHAR(100),
        keywords VARCHAR(255),
        description TEXT,
        image TEXT,
        content_blocks JSONB DEFAULT '[]',
        published BOOLEAN DEFAULT FALSE,
        placement VARCHAR(50) DEFAULT 'none',
        views INT DEFAULT 0,
        likes INT DEFAULT 0,
        comments JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    // Migrate: add missing columns to existing tables
    await client.query(`ALTER TABLE cms_articles ADD COLUMN IF NOT EXISTS slug VARCHAR(255) UNIQUE;`);
    await client.query(`ALTER TABLE cms_articles ADD COLUMN IF NOT EXISTS content_blocks JSONB DEFAULT '[]';`);
    await client.query(`ALTER TABLE cms_articles ADD COLUMN IF NOT EXISTS placement VARCHAR(50) DEFAULT 'none';`);
    await client.query(`ALTER TABLE cms_articles ADD COLUMN IF NOT EXISTS views INT DEFAULT 0;`);
    await client.query(`ALTER TABLE cms_articles ADD COLUMN IF NOT EXISTS likes INT DEFAULT 0;`);
    await client.query(`ALTER TABLE cms_articles ADD COLUMN IF NOT EXISTS comments JSONB DEFAULT '[]';`);
    await client.query(`ALTER TABLE cms_reviews ADD COLUMN IF NOT EXISTS slug VARCHAR(255);`);
    await client.query(`ALTER TABLE cms_reviews ADD COLUMN IF NOT EXISTS musicbrainz_mbid VARCHAR(36);`);
    await client.query(`ALTER TABLE cms_reviews ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;`);
    await client.query(`ALTER TABLE cms_reviews ADD COLUMN IF NOT EXISTS views INT DEFAULT 0;`);
    await client.query(`ALTER TABLE cms_reviews ADD COLUMN IF NOT EXISTS likes INT DEFAULT 0;`);
    await client.query(`ALTER TABLE cms_reviews ADD COLUMN IF NOT EXISTS shares INT DEFAULT 0;`);
    await client.query(`ALTER TABLE cms_articles ADD COLUMN IF NOT EXISTS shares INT DEFAULT 0;`);
    await client.query(`ALTER TABLE cms_articles ADD COLUMN IF NOT EXISTS youtube_video_id VARCHAR(50);`);
    // Portuguese translation columns
    await client.query(`ALTER TABLE cms_articles ADD COLUMN IF NOT EXISTS title_pt VARCHAR(255);`);
    await client.query(`ALTER TABLE cms_articles ADD COLUMN IF NOT EXISTS description_pt TEXT;`);
    await client.query(`ALTER TABLE cms_articles ADD COLUMN IF NOT EXISTS content_blocks_pt JSONB DEFAULT '[]';`);
    await client.query(`ALTER TABLE cms_reviews ADD COLUMN IF NOT EXISTS context_pt TEXT;`);
    await client.query(`ALTER TABLE cms_reviews ADD COLUMN IF NOT EXISTS introduction_pt TEXT;`);
    await client.query(`ALTER TABLE cms_reviews ADD COLUMN IF NOT EXISTS breakdown_pt JSONB DEFAULT '[]';`);
    await client.query(`ALTER TABLE cms_reviews ADD COLUMN IF NOT EXISTS conclusion_pt TEXT;`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS visitor_interactions (
        id SERIAL PRIMARY KEY,
        visitor_id VARCHAR(36) NOT NULL,
        content_type VARCHAR(10) NOT NULL,
        content_id INT NOT NULL,
        action VARCHAR(10) NOT NULL,
        data JSONB DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_visitor_unique_action
        ON visitor_interactions(visitor_id, content_type, content_id, action)
        WHERE action IN ('view', 'like', 'share');
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS cms_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT
      );
    `);
    // Backfill slugs for existing records that don't have one
    await client.query(`
      UPDATE cms_articles
      SET slug = LOWER(REGEXP_REPLACE(REPLACE(title, ' ', '-'), '[^a-z0-9-]', '', 'g'))
      WHERE slug IS NULL AND title IS NOT NULL;
    `);
    await client.query(`
      UPDATE cms_reviews
      SET slug = LOWER(REGEXP_REPLACE(REPLACE(album || '-' || artist, ' ', '-'), '[^a-z0-9-]', '', 'g'))
      WHERE slug IS NULL AND album IS NOT NULL;
    `);
    console.log('Database schema verified/created successfully.');
  } finally {
    client.release();
  }
};

module.exports = { pool, initSchema };
