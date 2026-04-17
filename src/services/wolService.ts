import * as dgram from 'dgram';
import { logger } from '../utils/logger';
import { DeviceRepository } from '../database/deviceRepository';

/**
 * Service for sending Wake-on-LAN magic packets.
 */
export class WolService {
    private readonly deviceRepo: DeviceRepository;

    constructor(deviceRepo: DeviceRepository) {
        this.deviceRepo = deviceRepo;
    }

    /**
     * Send a Wake-on-LAN magic packet to a MAC address.
     * @param macAddress MAC address in format 00:11:22:33:44:55 or 00-11-22-33-44-55
     */
    public async sendMagicPacket(macAddress: string): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                const cleanMac = macAddress.replace(/[: -]/g, '');
                if (cleanMac.length !== 12 || !/^[0-9a-fA-F]+$/.test(cleanMac)) {
                    throw new Error(`Invalid MAC address format: ${macAddress}`);
                }

                const macBuffer = Buffer.from(cleanMac, 'hex');
                const magicPacket = Buffer.alloc(6 + 16 * 6);
                magicPacket.fill(0xff, 0, 6);
                for (let i = 0; i < 16; i++) {
                    macBuffer.copy(magicPacket, 6 + i * 6);
                }

                const client = dgram.createSocket('udp4');
                client.on('error', (err) => {
                    logger.error(`[WOL] Socket error:`, err);
                    client.close();
                    reject(err);
                });

                client.bind(0, () => {
                    try {
                        // Set broadcast permission after binding
                        client.setBroadcast(true);

                        client.send(magicPacket, 0, magicPacket.length, 9, '255.255.255.255', (err) => {
                            if (err) {
                                logger.error(`[WOL] Failed to send packet to ${macAddress}:`, err);
                                client.close();
                                reject(err);
                            } else {
                                logger.info(`[WOL] Magic packet sent to ${macAddress}`);
                                client.close();
                                resolve();
                            }
                        });
                    } catch (err: any) {
                        logger.error(`[WOL] Failed to set broadcast or send:`, err);
                        client.close();
                        reject(err);
                    }
                });

            } catch (error) {
                logger.error(`[WOL] Error preparing magic packet:`, error);
                reject(error);
            }
        });
    }

    /**
     * Resolve a target (name or MAC) and send the WOL packet.
     * @param target Device name or raw MAC address
     */
    public async wakeTarget(target: string): Promise<{ success: boolean; mac: string; name?: string; error?: string }> {
        // Try to find by name first
        const device = this.deviceRepo.findByName(target);
        const mac = device ? device.macAddress : target;
        const name = device ? device.name : undefined;

        try {
            await this.sendMagicPacket(mac);
            return { success: true, mac, name };
        } catch (error: any) {
            return { success: false, mac, name, error: error.message || String(error) };
        }
    }
}
