const { Router } = require('express');
const config = require('../config');
const bot = require('../bot');

const router = Router();

router.post(`/webhook/${config.telegram.botToken}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

module.exports = router;
