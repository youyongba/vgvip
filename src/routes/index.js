const { Router } = require('express');
const pagesRouter = require('./pages');
const webhookRouter = require('./webhook');

const router = Router();

router.use(pagesRouter);
router.use(webhookRouter);

module.exports = router;
