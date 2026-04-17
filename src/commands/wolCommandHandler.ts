import { AutocompleteInteraction, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { WolService } from '../services/wolService';
import { DeviceRepository } from '../database/deviceRepository';
import { t } from '../utils/i18n';

/**
 * Handler for WOL-related slash commands (/wake, /device).
 */
export class WolCommandHandler {
    private readonly wolService: WolService;
    private readonly deviceRepo: DeviceRepository;

    constructor(wolService: WolService, deviceRepo: DeviceRepository) {
        this.wolService = wolService;
        this.deviceRepo = deviceRepo;
    }

    /**
     * Handle the /wake command.
     */
    public async handleWake(interaction: ChatInputCommandInteraction): Promise<void> {
        const target = interaction.options.getString('target', true);

        const result = await this.wolService.wakeTarget(target);

        if (result.success) {
            const embed = new EmbedBuilder()
                .setTitle(`📡 ${t('Wake-on-LAN Sent')}`)
                .setDescription(t('Magic packet has been sent to the target device.'))
                .addFields(
                    { name: t('MAC Address'), value: `\`${result.mac}\``, inline: true },
                    { name: t('Name'), value: result.name || t('N/A'), inline: true }
                )
                .setColor(0x5865F2)
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        } else {
            await interaction.editReply({
                content: `❌ ${t('Failed to send magic packet:')} ${result.error}`
            });
        }
    }

    /**
     * Handle autocomplete for /wake command target option.
     */
    public async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
        const focusedValue = interaction.options.getFocused().toLowerCase();
        const devices = this.deviceRepo.findAll();

        const filtered = devices
            .filter(d => d.name.toLowerCase().includes(focusedValue) || d.macAddress.toLowerCase().includes(focusedValue))
            .slice(0, 25);

        await interaction.respond(
            filtered.map(d => ({ name: `${d.name} (${d.macAddress})`, value: d.name }))
        );
    }

    /**
     * Handle the /device command.
     */
    public async handleDevice(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'add':
                await this.handleAdd(interaction);
                break;
            case 'list':
                await this.handleList(interaction);
                break;
            case 'delete':
                await this.handleDelete(interaction);
                break;
            default:
                await interaction.editReply({ content: t('Unknown subcommand') });
        }
    }

    private async handleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
        const name = interaction.options.getString('name', true);
        const mac = interaction.options.getString('mac', true);

        // Basic MAC validation
        const cleanMac = mac.replace(/[: -]/g, '');
        if (cleanMac.length !== 12 || !/^[0-9a-fA-F]+$/.test(cleanMac)) {
            await interaction.editReply({ content: `❌ ${t('Invalid MAC address format. Use 00:11:22:33:44:55.')}` });
            return;
        }

        try {
            this.deviceRepo.create(name, mac);
            await interaction.editReply({
                content: `✅ ${t('Device registered successfully:')} **${name}** (\`${mac}\`)`
            });
        } catch (error: any) {
            if (error.message && error.message.includes('UNIQUE constraint failed')) {
                await interaction.editReply({ content: `❌ ${t('A device with that name already exists.')}` });
            } else {
                await interaction.editReply({ content: `❌ ${t('Failed to register device:')} ${error.message}` });
            }
        }
    }

    private async handleList(interaction: ChatInputCommandInteraction): Promise<void> {
        const devices = this.deviceRepo.findAll();

        if (devices.length === 0) {
            await interaction.editReply({ content: t('No devices registered yet.') });
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(`📠 ${t('Registered Devices')}`)
            .setDescription(devices.map(d => `• **${d.name}**: \`${d.macAddress}\``).join('\n'))
            .setColor(0x9B59B6)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    private async handleDelete(interaction: ChatInputCommandInteraction): Promise<void> {
        const name = interaction.options.getString('name', true);

        const success = this.deviceRepo.deleteByName(name);

        if (success) {
            await interaction.editReply({
                content: `✅ ${t('Device deleted successfully:')} **${name}**`
            });
        } else {
            await interaction.editReply({ content: `❌ ${t('Device not found:')} **${name}**` });
        }
    }
}
