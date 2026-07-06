import dgram from 'dgram';

// Art-Net constants
export const ARTNET_PORT = 6454;
const HEADER_ID = 'Art-Net\0';
const OP_DMX = 0x5000; // ArtDmx opcode
const PROTOCOL_VERSION = 14;

export interface ArtNetTarget {
  ip: string;
  port?: number;
}

export class ArtNetSender {
  private socket: dgram.Socket;
  // Cache of pre-allocated buffers per controller/universe to avoid allocations and async overwrites
  private buffers: Map<string, Buffer> = new Map();
  private sequences: Map<string, number> = new Map();

  constructor() {
    this.socket = dgram.createSocket('udp4');
  }

  /**
   * Get or create a pre-allocated buffer for a specific universe and target IP with a given DMX length.
   */
  private getOrCreateBuffer(ip: string, universe: number, dataLength: number): Buffer {
    const key = `${ip}:${universe}`;
    let buf = this.buffers.get(key);
    // Ensure length is even as per ArtNet specifications
    const roundedLength = dataLength % 2 !== 0 ? dataLength + 1 : dataLength;
    const packetSize = 18 + roundedLength;

    if (!buf || buf.length !== packetSize) {
      buf = Buffer.alloc(packetSize);
      // Write constant header parts
      buf.write(HEADER_ID, 0, 'ascii');             // Bytes 0-7
      buf.writeUInt16LE(OP_DMX, 8);                  // Bytes 8-9 (OpCode, little-endian)
      buf.writeUInt16BE(PROTOCOL_VERSION, 10);        // Bytes 10-11 (Protocol version, big-endian)
      buf.writeUInt8(0, 13);                         // Byte 13: Physical port

      // Universe encoding: 15-bit address
      // Byte 14: Universe/Subnet (low 8 bits)
      // Byte 15: Net (high 7 bits)
      buf.writeUInt8(universe & 0xFF, 14);
      buf.writeUInt8((universe >> 8) & 0x7F, 15);

      // Data length (Bytes 16-17, big-endian)
      buf.writeUInt16BE(roundedLength, 16);

      this.buffers.set(key, buf);
    }
    return buf;
  }

  /**
   * Sends DMX data to a target IP address for a specific universe.
   */
  public send(universe: number, dmxData: Uint8Array, target: ArtNetTarget): void {
    const dataLen = dmxData.length;
    if (dataLen === 0 || dataLen > 512) {
      console.error(`Invalid DMX data length: ${dataLen}. Must be between 1 and 512.`);
      return;
    }

    const targetIP = target.ip;
    const targetPort = target.port || ARTNET_PORT;
    const key = `${targetIP}:${universe}`;

    const buf = this.getOrCreateBuffer(targetIP, universe, dataLen);
    
    // Update sequence number (Byte 12, 1-255)
    let seq = (this.sequences.get(key) || 0) + 1;
    if (seq > 255) seq = 1;
    this.sequences.set(key, seq);
    buf.writeUInt8(seq, 12);

    // Copy DMX data into the buffer payload section (starts at offset 18)
    const payload = Buffer.from(dmxData.buffer, dmxData.byteOffset, dmxData.byteLength);
    payload.copy(buf, 18, 0, dataLen);

    // If data length was odd, make sure the padded byte is 0
    if (dataLen % 2 !== 0) {
      buf.writeUInt8(0, 18 + dataLen);
    }

    this.socket.send(buf, 0, buf.length, targetPort, targetIP, (err) => {
      if (err) {
        console.error(`Failed to send ArtNet packet to ${targetIP}:${targetPort} - Universe ${universe}:`, err);
      }
    });
  }

  public close(): void {
    try {
      this.socket.close();
    } catch (e) {
      // socket might be already closed
    }
  }
}
