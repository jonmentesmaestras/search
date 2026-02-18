const express = require('express');
const axios = require('axios'); // To make the internal HTTP request
const cors = require('cors');

const translateRouter = require('./routes/translate'); // Import the new router

const ALLOWED_ORIGINS = (process.env.CORS_ALLOW_ORIGINS || '*')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean);

const app = express();

// Fine‑grained cors configuration to ensure preflight replies never redirect
app.use(cors({
    origin: (origin, cb) => {
        if (!origin || ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) {
            return cb(null, true);
        }
        return cb(new Error('CORS origin not allowed: ' + origin));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Length'],
    credentials: false, // adjust if you later need cookies
    maxAge: 600 // cache preflight 10 minutes
}));

// Universal OPTIONS handler without using '*' pattern (avoids path-to-regexp v7 error)
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

// Use the new router for the /translate-pt endpoint
app.use(translateRouter);

// ---------------- Translation Cache (Solution 1) ----------------
// Key: original Spanish keywords (lowercased, trimmed)
// Value: { translated: string, expiresAt: number }
const translationCache = new Map();
const CACHE_TTL_MS = parseInt(process.env.TRANSLATION_CACHE_TTL_MS || '', 10) || 60 * 60 * 1000; // 1h default
const MAX_CACHE_ENTRIES = parseInt(process.env.TRANSLATION_CACHE_MAX || '', 10) || 500;

function cacheGet(original) {
    const key = original.toLowerCase();
    const entry = translationCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        translationCache.delete(key);
        return null;
    }
    return entry.translated;
}

function cacheSet(original, translated) {
    const key = original.toLowerCase();
    if (translationCache.size >= MAX_CACHE_ENTRIES) {
        // naive LRU-ish eviction: delete first iterated key
        const firstKey = translationCache.keys().next().value;
        translationCache.delete(firstKey);
    }
    translationCache.set(key, { translated, expiresAt: Date.now() + CACHE_TTL_MS });
}
// ----------------------------------------------------------------

// This is your new public-facing endpoint
app.get('/search', async (req, res) => {
    // Base target (avoid relying on a redirect). Provide full path to final resource.
    const internalApiUrl = process.env.TARGET_SEARCH_URL || 'https://tueducaciondigital.site/ads/getads/';
    try {
        const rawKeywords = req.query.keywords;
        const hasKeywords = typeof rawKeywords === 'string' && rawKeywords.trim().length > 0;

        // Clone incoming params to forward (will mutate below)
        const forwardParams = { ...req.query };

        // If no usable keywords, remove and forward immediately
        if (!hasKeywords) {
            delete forwardParams.keywords;
            console.log('No keywords provided. Forwarding request without translation.');
            const apiResponse = await axios.get(internalApiUrl, { params: forwardParams });
            return res.status(apiResponse.status).json(apiResponse.data);
        }

        const spanishKeywords = rawKeywords.trim();

        const translateApiKey = process.env.GOOGLE_TRANSLATE_API_KEY;

        // Attempt cache lookup first (even if API key is missing; we may have an older cached value)
        let cached = cacheGet(spanishKeywords);
        let portugueseKeywords = cached || spanishKeywords; // default fallback
        let attempted = false;
        let cacheHit = !!cached;

        if (!cached) {
        if (!translateApiKey) {
                console.warn('Translation API key missing; using original keywords (no cache entry).');
            } else {
                attempted = true;
        const translateUrl = 'https://translation.googleapis.com/language/translate/v2';
        try {
            const translateResponse = await axios.post(translateUrl, null, {
                        params: { q: spanishKeywords, target: 'pt', key: translateApiKey },
                timeout: 8000
            });
            portugueseKeywords = translateResponse.data.data.translations[0].translatedText;
                    cacheSet(spanishKeywords, portugueseKeywords);
                    console.log(`Translated "${spanishKeywords}" -> "${portugueseKeywords}" (cached)`);
        } catch (translateErr) {
            console.error('Translation failed, forwarding original keywords:', translateErr.response?.data || translateErr.message);
        }
            }
        } else {
            console.log(`Translation cache hit for "${spanishKeywords}" -> "${portugueseKeywords}"`);
        }

        forwardParams.keywords = portugueseKeywords; // use translated (or original if not translated)

        const apiResponse = await axios.get(internalApiUrl, {
            params: forwardParams,
            // Do not send unnecessary headers that would trigger preflight
            headers: {},
            // Follow redirects server-side ONLY (axios default) so browser never sees them
            maxRedirects: 5,
            timeout: 10000
        });
        return res
            .set('X-Translate-Attempted', attempted ? '1' : '0')
            .set('X-Translate-Cached', cacheHit ? '1' : '0')
            .set('X-Source-Keywords', spanishKeywords)
            .set('X-Translated-Keywords', portugueseKeywords)
            .status(apiResponse.status)
            .json(apiResponse.data);
    } catch (error) {
        console.error('Error in /search endpoint:', error);
        return res.status(500).json({ error: 'An internal server error occurred.' });
    }
});

const PORT = process.env.PORT || 3000;
// Simple readiness/liveness probe
app.get('/healthz', (req, res) => {
    res.json({ status: 'ok', target: process.env.TARGET_SEARCH_URL || 'https://tueducaciondigital.site/ads/getads/' });
});
app.listen(PORT, () => {
    console.log(`Search proxy server running on port ${PORT}`);
    console.log('Target search URL:', process.env.TARGET_SEARCH_URL || 'https://tueducaciondigital.site/ads/getads/');
});
