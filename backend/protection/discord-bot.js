/**
 * Andaflare Discord Bot
 * Admin commands and attack alerts
 */

import { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } from 'discord.js';
import logger from '../logger.js';
import { getProtection } from './ddos.js';

let discordClient = null;
let discordChannel = null;

const ADMIN_USER_IDS = (process.env.DISCORD_ADMIN_IDS || '').split(',').filter(id => id.trim());

export async function initDiscordBot() {
    const token = process.env.DISCORD_BOT_TOKEN;
    const channelId = process.env.DISCORD_CHANNEL_ID;

    if (!token || !channelId) {
        logger.warn('Discord bot not configured - skipping');
        return;
    }

    try {
        discordClient = new Client({
            intents: [GatewayIntentBits.Guilds]
        });

        discordClient.on('ready', async () => {
            logger.info(`✓ Discord bot logged in as ${discordClient.user.tag}`);
            discordChannel = await discordClient.channels.fetch(channelId);
            logger.info('✓ Discord channel ready');

            // Register slash commands
            await registerCommands();
        });

        discordClient.on('error', (error) => {
            logger.error('Discord client error:', error);
        });

        // Handle slash commands
        discordClient.on('interactionCreate', async (interaction) => {
            if (!interaction.isCommand()) return;

            // Check if user is admin
            if (!ADMIN_USER_IDS.includes(interaction.user.id)) {
                return interaction.reply({ 
                    content: '❌ You do not have permission to use this command.', 
                    ephemeral: true 
                });
            }

            try {
                await handleCommand(interaction);
            } catch (error) {
                logger.error('Discord command error:', error);
                await interaction.reply({ 
                    content: `❌ Error: ${error.message}`, 
                    ephemeral: true 
                });
            }
        });

        await discordClient.login(token);
    } catch (error) {
        logger.error('Failed to initialize Discord bot:', error);
    }
}

async function registerCommands() {
    if (!discordClient) return;

    const commands = [
        new SlashCommandBuilder()
            .setName('banip')
            .setDescription('Block an IP address')
            .addStringOption(option =>
                option.setName('ip')
                    .setDescription('IP address to block')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('reason')
                    .setDescription('Reason for blocking')
                    .setRequired(false)),

        new SlashCommandBuilder()
            .setName('unbanip')
            .setDescription('Unblock an IP address')
            .addStringOption(option =>
                option.setName('ip')
                    .setDescription('IP address to unblock')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('banlist')
            .setDescription('List all blocked IPs'),

        new SlashCommandBuilder()
            .setName('stats')
            .setDescription('Show system statistics'),

        new SlashCommandBuilder()
            .setName('attack')
            .setDescription('Manage attack mode for a domain')
            .addStringOption(option =>
                option.setName('domain')
                    .setDescription('Domain name')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('action')
                    .setDescription('Enable or disable')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Enable', value: 'on' },
                        { name: 'Disable', value: 'off' }
                    ))
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

    try {
        logger.info('Registering Discord slash commands...');
        
        await rest.put(
            Routes.applicationCommands(discordClient.user.id),
            { body: commands }
        );

        logger.info('✓ Discord commands registered');
    } catch (error) {
        logger.error('Failed to register Discord commands:', error);
    }
}

async function handleCommand(interaction) {
    const { commandName } = interaction;
    const protection = getProtection();

    switch (commandName) {
        case 'banip': {
            const ip = interaction.options.getString('ip');
            const reason = interaction.options.getString('reason') || 'Banned via Discord';

            if (!/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip)) {
                return interaction.reply({ content: '❌ Invalid IP address', ephemeral: true });
            }

            await protection.blockIP(ip, reason);

            const embed = new EmbedBuilder()
                .setTitle('🚫 IP Blocked')
                .setColor(0xFF0000)
                .addFields(
                    { name: 'IP', value: ip, inline: true },
                    { name: 'Reason', value: reason, inline: true },
                    { name: 'By', value: interaction.user.username, inline: true }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            break;
        }

        case 'unbanip': {
            const ip = interaction.options.getString('ip');
            await protection.unblockIP(ip);

            const embed = new EmbedBuilder()
                .setTitle('✅ IP Unblocked')
                .setColor(0x00FF00)
                .addFields(
                    { name: 'IP', value: ip, inline: true },
                    { name: 'By', value: interaction.user.username, inline: true }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            break;
        }

        case 'banlist': {
            const blocked = await protection.getBlockedIPs();

            if (blocked.length === 0) {
                return interaction.reply({ content: '✅ No blocked IPs', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle('🚫 Blocked IPs')
                .setColor(0xFF0000)
                .setDescription(blocked.slice(0, 20).join('\n') + (blocked.length > 20 ? `\n... and ${blocked.length - 20} more` : ''))
                .addFields({ name: 'Total', value: String(blocked.length) })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            break;
        }

        case 'stats': {
            const domains = await protection.getMonitoredDomains();
            const blockedIPs = await protection.getBlockedIPs();
            
            let domainsUnderAttack = 0;
            for (const domain of domains) {
                if (await protection.isUnderAttack(domain)) {
                    domainsUnderAttack++;
                }
            }

            const embed = new EmbedBuilder()
                .setTitle('📊 Andaflare Statistics')
                .setColor(0x0099FF)
                .addFields(
                    { name: 'Monitored Domains', value: String(domains.length), inline: true },
                    { name: 'Under Attack', value: String(domainsUnderAttack), inline: true },
                    { name: 'Blocked IPs', value: String(blockedIPs.length), inline: true },
                    { name: 'Uptime', value: formatUptime(process.uptime()), inline: true }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            break;
        }

        case 'attack': {
            const domain = interaction.options.getString('domain');
            const action = interaction.options.getString('action');

            if (action === 'on') {
                await protection.enableAttackMode(domain, 0, 0);
                const embed = new EmbedBuilder()
                    .setTitle('🛡️ Attack Mode Enabled')
                    .setColor(0xFFAA00)
                    .addFields(
                        { name: 'Domain', value: domain, inline: true },
                        { name: 'By', value: interaction.user.username, inline: true }
                    )
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
            } else {
                await protection.disableAttackMode(domain);
                const embed = new EmbedBuilder()
                    .setTitle('✅ Attack Mode Disabled')
                    .setColor(0x00FF00)
                    .addFields(
                        { name: 'Domain', value: domain, inline: true },
                        { name: 'By', value: interaction.user.username, inline: true }
                    )
                    .setTimestamp();
                await interaction.reply({ embeds: [embed] });
            }
            break;
        }
    }
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
}

export async function sendAttackAlert(attackData) {
    if (!discordChannel) return;

    try {
        const embed = new EmbedBuilder()
            .setTitle('🚨 DDoS Attack Detected')
            .setColor(0xFF0000)
            .setTimestamp()
            .addFields(
                { name: 'Domain', value: attackData.domain || 'N/A', inline: true },
                { name: 'Requests/sec', value: String(attackData.requestsPerSecond || 0), inline: true },
                { name: 'Requests/min', value: String(attackData.requestsPerMinute || 0), inline: true }
            );

        if (attackData.details) {
            embed.setDescription(attackData.details);
        }

        await discordChannel.send({ embeds: [embed] });
        logger.debug('Attack alert sent to Discord');
    } catch (error) {
        logger.error('Failed to send Discord alert:', error);
    }
}

export async function sendLog(message, type = 'info') {
    if (!discordChannel) return;

    try {
        const colors = {
            info: 0x0099FF,
            success: 0x00FF00,
            warning: 0xFFAA00,
            error: 0xFF0000
        };

        const embed = new EmbedBuilder()
            .setDescription(message)
            .setColor(colors[type] || colors.info)
            .setTimestamp();

        await discordChannel.send({ embeds: [embed] });
    } catch (error) {
        logger.error('Failed to send Discord log:', error);
    }
}
