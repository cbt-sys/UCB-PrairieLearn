const ERR = require('async-stacktrace');
const express = require('express');
const router = express.Router();

const logger = require('../../lib/logger');
const config = require('../../lib/config');

//import { Strategy } from 'passport-github2';
const Strategy = require('passport-github2');

router.get('/', function(req, res, next) {
    if (!config.hasGithub2) return next(new Error('GitHub2 login is not enabled'));
    const authData = {
        response: res,
        failureRedirect: '/pl',
        session: false,
        scope: [ 'user:email' ]
    };
    passport.authenticate('github', authData)(req, res, next);
}, function(req, res) {
    res.redirect('/pl');
});

module.exports = router;
