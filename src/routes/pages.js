const { Router } = require('express');
const config = require('../config');

const router = Router();
const PLACEHOLDER = '你的商家TRC20收款地址';
const paymentAddress = (config.tron.merchantAddress && config.tron.merchantAddress !== PLACEHOLDER)
    ? config.tron.merchantAddress
    : 'TE8FC8oisouBXm1rv3V17RSooaghwTyRN3';

router.get('/', (_req, res) => res.render('pages/vip', { paymentAddress }));
router.get('/vip', (_req, res) => res.render('pages/vip', { paymentAddress }));
router.get('/benefits', (_req, res) => res.render('pages/benefits'));
router.get('/faq', (_req, res) => res.render('pages/faq'));
router.get('/contact', (_req, res) => res.render('pages/contact'));

module.exports = router;
