/**
 * Andaflare CAPTCHA System
 * SVG CAPTCHA with Redis verification and cookie management
 */

import svgCaptcha from 'svg-captcha';
import crypto from 'crypto';
import { getProtection } from './ddos.js';
import logger from '../logger.js';

export async function generateCaptcha(req, res) {
    try {
        const captcha = svgCaptcha.create({
            size: 6,
            noise: 3,
            color: true,
            background: '#0a0e27',
            width: 250,
            height: 100
        });

        const token = crypto.randomBytes(32).toString('hex');
        const protection = getProtection();
        
        // Store answer in Redis (5 min expiry)
        await protection.redis.set(
            `captcha:${token}`, 
            captcha.text.toLowerCase(), 
            { EX: parseInt(process.env.CAPTCHA_EXPIRE_SECONDS) || 300 }
        );

        res.json({
            token,
            image: captcha.data
        });
    } catch (error) {
        logger.error('Failed to generate CAPTCHA:', error);
        res.status(500).json({ error: 'Failed to generate CAPTCHA' });
    }
}

export async function verifyCaptcha(req, res) {
    try {
        const { token, answer, domain } = req.body;

        if (!token || !answer) {
            return res.status(400).json({ success: false, error: 'Missing parameters' });
        }

        const protection = getProtection();
        const correctAnswer = await protection.redis.get(`captcha:${token}`);

        if (!correctAnswer) {
            return res.json({ success: false, error: 'CAPTCHA expired or invalid' });
        }

        if (answer.toLowerCase().trim() === correctAnswer) {
            // CAPTCHA correct - create verification token
            const verificationToken = crypto.randomBytes(32).toString('hex');
            
            // Store verification token (24h expiry)
            await protection.redis.set(
                `verified:${verificationToken}`,
                JSON.stringify({
                    ip: req.ip,
                    domain,
                    timestamp: Date.now()
                }),
                { EX: parseInt(process.env.COOKIE_EXPIRE_SECONDS) || 86400 }
            );

            // Delete used CAPTCHA
            await protection.redis.del(`captcha:${token}`);

            logger.info(`✓ CAPTCHA verified for ${req.ip} on ${domain}`);

            res.json({
                success: true,
                verificationToken
            });
        } else {
            res.json({
                success: false,
                error: 'Incorrect answer'
            });
        }
    } catch (error) {
        logger.error('Failed to verify CAPTCHA:', error);
        res.status(500).json({ success: false, error: 'Verification failed' });
    }
}

export async function checkVerification(req, res) {
    try {
        const { verificationToken, domain } = req.body;

        if (!verificationToken) {
            return res.json({ valid: false });
        }

        const protection = getProtection();
        const verification = await protection.redis.get(`verified:${verificationToken}`);

        if (!verification) {
            return res.json({ valid: false });
        }

        const data = JSON.parse(verification);
        res.json({ valid: true, data });
    } catch (error) {
        logger.error('Failed to check verification:', error);
        res.status(500).json({ valid: false, error: 'Check failed' });
    }
}

/**
 * Middleware to check if CAPTCHA is required
 */
export async function captchaMiddleware(req, res, next) {
    try {
        // Skip for admin panel and API
        if (req.path.startsWith('/api/') || req.path.startsWith('/admin')) {
            return next();
        }

        const domain = req.get('host')?.split(':')[0];
        if (!domain) return next();

        const protection = getProtection();
        const underAttack = await protection.isUnderAttack(domain);

        if (underAttack) {
            // Check for verification cookie
            const cookieName = `andaflare_verified_${domain.replace(/\./g, '_')}`;
            const verificationToken = req.cookies[cookieName];

            if (verificationToken) {
                // Verify token
                const verification = await protection.redis.get(`verified:${verificationToken}`);
                if (verification) {
                    // Valid token, allow access
                    return next();
                }
            }

            // No valid token, redirect to CAPTCHA
            const returnUrl = encodeURIComponent(req.originalUrl);
            return res.redirect(`/captcha?domain=${encodeURIComponent(domain)}&return=${returnUrl}`);
        }

        // Not under attack, allow access
        next();
    } catch (error) {
        logger.error('CAPTCHA middleware error:', error);
        next(); // On error, allow access to prevent blocking legitimate users
    }
}
