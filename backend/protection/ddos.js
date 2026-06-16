/**
 * Andaflare DDoS Protection Module
 * Layer 3-7 Protection with automatic CAPTCHA
 */

import { createClient } from 'redis';
import logger from '../logger.js';
import { execSync } from 'child_process';

class DDoSProtection {
    constructor() {
        this.redis = null;
        this.thresholds = {
            l7: {
                requestsPerMinute: parseInt(process.env.ATTACK_THRESHOLD_PER_MINUTE) || 2000,
                requestsPerSecond: parseInt(process.env.ATTACK_THRESHOLD_PER_SECOND) || 100
            }
        };
        this.attackMode = new Map(); // domain -> boolean
    }

    async init() {
        logger.info('🛡️  Initializing DDoS Protection...');
        
        // Connect to Redis
        this.redis = createClient({
            url: process.env.REDIS_URL || 'redis://redis:6379'
        });
        
        await this.redis.connect();
        logger.info('✓ Redis connected for DDoS protection');
        
        // Setup firewall rules
        await this.setupFirewall();
        
        // Start monitoring
        this.startMonitoring();
        
        logger.info('✓ DDoS Protection active');
    }

    async setupFirewall() {
        const rules = [
            // Drop invalid packets
            'iptables -A INPUT -m conntrack --ctstate INVALID -j DROP',
            
            // SYN flood protection
            'iptables -A INPUT -p tcp --syn -m limit --limit 20/s --limit-burst 40 -j ACCEPT',
            
            // ICMP flood protection
            'iptables -A INPUT -p icmp --icmp-type echo-request -m limit --limit 2/s --limit-burst 5 -j ACCEPT',
            
            // Connection limit per IP
            'iptables -A INPUT -p tcp -m connlimit --connlimit-above 80 -j REJECT',
            
            // UDP flood protection
            'iptables -A INPUT -p udp -m limit --limit 20/s --limit-burst 40 -j ACCEPT'
        ];

        for (const rule of rules) {
            try {
                // Check if rule exists
                const checkRule = rule.replace('-A', '-C');
                try {
                    execSync(checkRule, { stdio: 'ignore' });
                } catch {
                    // Rule doesn't exist, add it
                    execSync(rule, { stdio: 'ignore' });
                    logger.debug(`Applied firewall rule: ${rule.substring(0, 50)}...`);
                }
            } catch (error) {
                logger.warn(`Failed to apply firewall rule: ${error.message}`);
            }
        }

        // Optimize kernel
        this.optimizeKernel();
    }

    optimizeKernel() {
        const params = {
            'net.ipv4.tcp_syncookies': 1,
            'net.ipv4.tcp_syn_retries': 2,
            'net.ipv4.tcp_synack_retries': 2,
            'net.ipv4.tcp_max_syn_backlog': 8192,
            'net.core.netdev_max_backlog': 10000
        };

        for (const [key, value] of Object.entries(params)) {
            try {
                execSync(`sysctl -w ${key}=${value}`, { stdio: 'ignore' });
            } catch (error) {
                logger.debug(`Could not set ${key}`);
            }
        }
    }

    startMonitoring() {
        // Check thresholds every 5 seconds
        setInterval(() => this.checkThresholds(), 5000);
    }

    async recordRequest(domain, ip) {
        const now = Date.now();
        const minute = Math.floor(now / 60000);
        const second = Math.floor(now / 1000);

        try {
            // Increment counters
            await this.redis.incr(`req:${domain}:${minute}`);
            await this.redis.expire(`req:${domain}:${minute}`, 120);
            
            await this.redis.incr(`req:${domain}:${second}`);
            await this.redis.expire(`req:${domain}:${second}`, 10);

            // Track IP
            await this.redis.incr(`ip:${ip}:${domain}:${minute}`);
            await this.redis.expire(`ip:${ip}:${domain}:${minute}`, 120);

            // Check IP limit
            const ipCount = parseInt(await this.redis.get(`ip:${ip}:${domain}:${minute}`) || 0);
            if (ipCount > 200) {
                await this.blockIP(ip, `Too many requests: ${ipCount}/min`);
            }
        } catch (error) {
            logger.error('Failed to record request:', error);
        }
    }

    async checkThresholds() {
        try {
            const domains = await this.getMonitoredDomains();

            for (const domain of domains) {
                const minute = Math.floor(Date.now() / 60000);
                const second = Math.floor(Date.now() / 1000);

                const reqsPerMin = parseInt(await this.redis.get(`req:${domain}:${minute}`) || 0);
                const reqsPerSec = parseInt(await this.redis.get(`req:${domain}:${second}`) || 0);

                // Check thresholds
                if (reqsPerSec > this.thresholds.l7.requestsPerSecond || 
                    reqsPerMin > this.thresholds.l7.requestsPerMinute) {
                    await this.enableAttackMode(domain, reqsPerSec, reqsPerMin);
                }
            }
        } catch (error) {
            logger.error('Failed to check thresholds:', error);
        }
    }

    async enableAttackMode(domain, reqsPerSec, reqsPerMin) {
        if (this.attackMode.get(domain)) return;

        this.attackMode.set(domain, true);
        await this.redis.set(`attack:${domain}`, 'true');

        logger.warn(`🚨 Attack mode enabled for ${domain} (${reqsPerSec} req/s, ${reqsPerMin} req/min)`);
    }

    async disableAttackMode(domain) {
        this.attackMode.delete(domain);
        await this.redis.del(`attack:${domain}`);
        logger.info(`✓ Attack mode disabled for ${domain}`);
    }

    async isUnderAttack(domain) {
        const status = await this.redis.get(`attack:${domain}`);
        return status === 'true';
    }

    async blockIP(ip, reason = 'DDoS attack') {
        try {
            // Add to Redis
            await this.redis.set(`blocked:${ip}`, JSON.stringify({
                reason,
                timestamp: Date.now()
            }), { EX: 3600 });

            // Add to iptables
            execSync(`iptables -I INPUT -s ${ip} -j DROP`, { stdio: 'ignore' });
            
            logger.warn(`🚫 Blocked IP: ${ip} (${reason})`);
        } catch (error) {
            logger.error(`Failed to block IP ${ip}:`, error);
        }
    }

    async unblockIP(ip) {
        try {
            await this.redis.del(`blocked:${ip}`);
            execSync(`iptables -D INPUT -s ${ip} -j DROP`, { stdio: 'ignore' });
            logger.info(`✓ Unblocked IP: ${ip}`);
        } catch (error) {
            logger.error(`Failed to unblock IP ${ip}:`, error);
        }
    }

    async getBlockedIPs() {
        try {
            const keys = await this.redis.keys('blocked:*');
            return keys.map(key => key.replace('blocked:', ''));
        } catch (error) {
            return [];
        }
    }

    async getMonitoredDomains() {
        // This will be integrated with NPM's proxy host list
        try {
            const keys = await this.redis.keys('req:*');
            const domains = new Set();
            keys.forEach(key => {
                const parts = key.split(':');
                if (parts[1]) domains.add(parts[1]);
            });
            return Array.from(domains);
        } catch (error) {
            return [];
        }
    }

    async getStats(domain) {
        const minute = Math.floor(Date.now() / 60000);
        const second = Math.floor(Date.now() / 1000);

        const reqsPerMin = parseInt(await this.redis.get(`req:${domain}:${minute}`) || 0);
        const reqsPerSec = parseInt(await this.redis.get(`req:${domain}:${second}`) || 0);
        const underAttack = await this.isUnderAttack(domain);

        return {
            domain,
            requestsPerMinute: reqsPerMin,
            requestsPerSecond: reqsPerSec,
            underAttack
        };
    }
}

// Singleton instance
let protectionInstance = null;

export async function initProtection() {
    if (!protectionInstance) {
        protectionInstance = new DDoSProtection();
        await protectionInstance.init();
    }
    return protectionInstance;
}

export function getProtection() {
    if (!protectionInstance) {
        throw new Error('DDoS Protection not initialized');
    }
    return protectionInstance;
}
