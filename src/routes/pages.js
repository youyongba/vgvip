const { Router } = require('express');
const config = require('../config');

const router = Router();
const paymentAddress = config.tron.merchantAddress;

const subscriptionAmount = config.schedule.subscriptionAmount || 1;

router.get('/', (_req, res) => res.render('pages/vip', { paymentAddress, subscriptionAmount }));
router.get('/vip', (_req, res) => res.render('pages/vip', { paymentAddress, subscriptionAmount }));
router.get('/benefits', (_req, res) => res.render('pages/benefits'));
router.get('/faq', (_req, res) => res.render('pages/faq'));
router.get('/contact', (_req, res) => res.render('pages/contact'));

module.exports = router;
