const express = require('express');
const router = express.Router();
const {Translate} = require('@google-cloud/translate').v2;
const translate = new Translate();

router.get('/translate-pt', async (req, res) => {
    try {
        const textToTranslate = req.query.text;
        if (!textToTranslate) {
            return res.status(400).json({ error: 'Text parameter is required.' });
        }

        let [translations] = await translate.translate(textToTranslate, 'pt');
        const translatedText = Array.isArray(translations) ? translations[0] : translations;

        console.log(`Translated "${textToTranslate}" to "${translatedText}"`);
        res.status(200).json({ originalText: textToTranslate, translatedText: translatedText });

    } catch (error) {
        console.error('Error in /translate-pt endpoint:', error);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});

module.exports = router;
