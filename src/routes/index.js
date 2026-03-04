const { Router } = require('express');
const pagesRouter = require('./pages');
const webhookRouter = require('./webhook');
const apiRouter = require('./api');

const router = Router();

router.use(pagesRouter);
router.use(webhookRouter);
router.use(apiRouter);

module.exports = router;
