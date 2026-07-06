import dgram from 'dgram';
import zlib from 'zlib';

export interface EntityState {
  id: number;
  r: number;
  g: number;
  b: number;
  w: number;
}

export class EHubReceiver {
  private socket: dgram.Socket | null = null;
  private onStateUpdate: (entities: EntityState[]) => void;
  private port: number;

  constructor(port: number, onStateUpdate: (entities: EntityState[]) => void) {
    this.port = port;
    this.onStateUpdate = onStateUpdate;
  }

  public start(): void {
    this.socket = dgram.createSocket('udp4');

    this.socket.on('error', (err) => {
      console.error('eHub Socket error:', err);
      this.stop();
    });

    this.socket.on('message', (msg) => {
      // eHub packets can be:
      // 1. Update message: Gzipped payload containing 6-byte sextuplets (id: 2 bytes, r: 1 byte, g: 1 byte, b: 1 byte, w: 1 byte)
      // 2. Config message: Usually JSON or uncompressed plaintext. We can filter by checking if it starts with Gzip header bytes (0x1f, 0x8b)
      if (msg.length > 2 && msg[0] === 0x1f && msg[1] === 0x8b) {
        // Gzipped update message
        zlib.gunzip(msg, (err, decompressed) => {
          if (err) {
            console.error('Failed to decompress eHub update packet:', err);
            return;
          }
          this.parseUpdatePayload(decompressed);
        });
      } else {
        // Plaintext / JSON config message or other control frame
        try {
          const text = msg.toString('utf8');
          if (text.startsWith('{') || text.startsWith('[')) {
            const config = JSON.parse(text);
            // Log config packets if needed, or trigger layout sync
            console.log('Received eHub Config JSON:', config);
          }
        } catch (e) {
          // Ignore parse errors for binary config
        }
      }
    });

    this.socket.bind(this.port, () => {
      console.log(`eHub Receiver listening on UDP port ${this.port}`);
    });
  }

  private parseUpdatePayload(buf: Buffer): void {
    const entities: EntityState[] = [];
    const payloadLen = buf.length;

    // A sextuplet is 6 bytes:
    // bytes 0-1: entityId (16-bit uint)
    // byte 2: Red (0-255)
    // byte 3: Green (0-255)
    // byte 4: Blue (0-255)
    // byte 5: White (0-255)
    for (let i = 0; i <= payloadLen - 6; i += 6) {
      const id = buf.readUInt16BE(i); // Read as big-endian 16-bit integer
      const r = buf.readUInt8(i + 2);
      const g = buf.readUInt8(i + 3);
      const b = buf.readUInt8(i + 4);
      const w = buf.readUInt8(i + 5);

      entities.push({ id, r, g, b, w });
    }

    if (entities.length > 0) {
      this.onStateUpdate(entities);
    }
  }

  public stop(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {
        // ignore
      }
      this.socket = null;
      console.log('eHub Receiver stopped.');
    }
  }
}
