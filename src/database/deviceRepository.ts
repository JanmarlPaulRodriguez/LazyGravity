import Database from 'better-sqlite3';

/**
 * Device record type definition
 */
export interface DeviceRecord {
    id: number;
    name: string;
    macAddress: string;
    createdAt?: string;
}

/**
 * Repository for persisting devices for Wake-on-LAN in SQLite.
 */
export class DeviceRepository {
    private readonly db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.initialize();
    }

    private initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                mac_address TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    public create(name: string, macAddress: string): DeviceRecord {
        const stmt = this.db.prepare(`
            INSERT INTO devices (name, mac_address)
            VALUES (?, ?)
        `);

        const result = stmt.run(name, macAddress);

        return {
            id: result.lastInsertRowid as number,
            name,
            macAddress,
        };
    }

    public findByName(name: string): DeviceRecord | undefined {
        const row = this.db.prepare(
            'SELECT * FROM devices WHERE name = ?'
        ).get(name) as any;
        if (!row) return undefined;
        return this.mapRow(row);
    }

    public findAll(): DeviceRecord[] {
        const rows = this.db.prepare(
            'SELECT * FROM devices ORDER BY name ASC'
        ).all() as any[];
        return rows.map(this.mapRow);
    }

    public deleteByName(name: string): boolean {
        const result = this.db.prepare(
            'DELETE FROM devices WHERE name = ?'
        ).run(name);
        return result.changes > 0;
    }

    private mapRow(row: any): DeviceRecord {
        return {
            id: row.id,
            name: row.name,
            macAddress: row.mac_address,
            createdAt: row.created_at,
        };
    }
}
