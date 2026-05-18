const express = require('express');
const router = express.Router();
const { registerUser, authUser, getUserProfile, getUsers } = require('../controllers/AuthController');
const { protect } = require('../middleware/authMiddleware');

router.post('/register', registerUser);
router.post('/login', authUser);
router.get('/profile', protect, getUserProfile);
router.get('/users', protect, getUsers);

module.exports = router;
