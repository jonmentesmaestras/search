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

        // Attempt translation only if API key is available
        const translateApiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
        if (!translateApiKey) {
            console.warn('Translation API key missing (GOOGLE_TRANSLATE_API_KEY). Forwarding original keywords.');
            const apiResponse = await axios.get(internalApiUrl, { params: forwardParams });
            return res.status(apiResponse.status).json(apiResponse.data);
        }

        const translateUrl = 'https://translation.googleapis.com/language/translate/v2';
        let portugueseKeywords = spanishKeywords; // default fallback
        try {
            const translateResponse = await axios.post(translateUrl, null, {
                params: {
                    q: spanishKeywords,
                    target: 'pt',
                    key: translateApiKey
                },
                timeout: 8000
            });
            portugueseKeywords = translateResponse.data.data.translations[0].translatedText;
            console.log(`Translated "${spanishKeywords}" -> "${portugueseKeywords}"`);
        } catch (translateErr) {
            console.error('Translation failed, forwarding original keywords:', translateErr.response?.data || translateErr.message);
        }

        // Replace keywords with (possibly translated) version
        forwardParams.keywords = portugueseKeywords;

        const apiResponse = await axios.get(internalApiUrl, {
            params: forwardParams,
            // Do not send unnecessary headers that would trigger preflight
            headers: {},
            // Follow redirects server-side ONLY (axios default) so browser never sees them
            maxRedirects: 5,
            timeout: 10000
        });
        return res.status(apiResponse.status).json(apiResponse.data);
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
