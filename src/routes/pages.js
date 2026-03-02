const { Router } = require('express');
const path = require('path');

const router = Router();
const publicDir = path.join(__dirname, '../../public');

router.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'vip.html')));
router.get('/vip', (_req, res) => res.sendFile(path.join(publicDir, 'vip.html')));
router.get('/benefits', (_req, res) => res.sendFile(path.join(publicDir, 'benefits.html')));
router.get('/faq', (_req, res) => res.sendFile(path.join(publicDir, 'faq.html')));
router.get('/contact', (_req, res) => res.sendFile(path.join(publicDir, 'contact.html')));

module.exports = router;
