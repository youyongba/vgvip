const { Router } = require('express');

const router = Router();

router.get('/', (_req, res) => res.render('pages/vip'));
router.get('/vip', (_req, res) => res.render('pages/vip'));
router.get('/benefits', (_req, res) => res.render('pages/benefits'));
router.get('/faq', (_req, res) => res.render('pages/faq'));
router.get('/contact', (_req, res) => res.render('pages/contact'));

module.exports = router;
