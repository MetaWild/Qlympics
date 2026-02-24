import http from 'node:http';
import crypto from 'node:crypto';
import { redisClient } from '../redis/client.js';
import type { LobbyState } from '../state/types.js';
import { config } from '../config.js';

type SocketLike = import('node:stream').Duplex & {
  destroyed: boolean;
  write: (data: any) => boolean;
  end: (...args: any[]) => any;
  destroy: (...args: any[]) => any;
  on: (event: any, listener: any) => any;
};

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function writeWsText(socket: SocketLike, text: string) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;

  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}

function okUpgradeHeaders(secKey: string) {
  const accept = crypto.createHash('sha1').update(secKey + WS_GUID).digest('base64');
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    ''
  ].join('\r\n');
}

function parseLobbyIdFromUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  // Expected: /ws/lobbies/:lobbyId
  try {
    const url = new URL(rawUrl, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 3 && parts[0] === 'ws' && parts[1] === 'lobbies' && parts[2]) {
      return parts[2];
    }
  } catch {
    return null;
  }
  return null;
}

class LobbyWsHub {
  private socketsByLobby = new Map<string, Set<SocketLike>>();

  add(lobbyId: string, socket: SocketLike) {
    const set = this.socketsByLobby.get(lobbyId) ?? new Set<SocketLike>();
    set.add(socket);
    this.socketsByLobby.set(lobbyId, set);
  }

  remove(lobbyId: string, socket: SocketLike) {
    const set = this.socketsByLobby.get(lobbyId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.socketsByLobby.delete(lobbyId);
  }

  broadcastState(lobbyId: string, state: LobbyState) {
    const set = this.socketsByLobby.get(lobbyId);
    if (!set || set.size === 0) return;
    const payload = JSON.stringify(state);
    for (const socket of set) {
      if (socket.destroyed) continue;
      try {
        writeWsText(socket, payload);
      } catch {
        // Ignore; socket cleanup happens on 'close'.
      }
    }
  }
}

export const lobbyWsHub = new LobbyWsHub();

export function startGameWebSocketServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.on('upgrade', (req, socket, _head) => {
    const s = socket as unknown as SocketLike;
    const lobbyId = parseLobbyIdFromUrl(req.url);
    const secKey = req.headers['sec-websocket-key'];
    const upgrade = req.headers.upgrade;

    if (!lobbyId || typeof secKey !== 'string' || upgrade !== 'websocket') {
      s.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      s.destroy();
      return;
    }

    s.write(okUpgradeHeaders(secKey));
    // Duplex typing from node:http hides net.Socket helpers; call if present.
    (s as any).setNoDelay?.(true);

    lobbyWsHub.add(lobbyId, s);

    s.on('close', () => {
      lobbyWsHub.remove(lobbyId, s);
    });

    s.on('error', () => {
      lobbyWsHub.remove(lobbyId, s);
    });

    // Send a snapshot immediately so the UI doesn't wait for the next tick.
    void (async () => {
      try {
        const raw = await redisClient.get(`lobby:${lobbyId}:state`);
        if (!raw) return;
        writeWsText(s, raw);
      } catch {
        // Ignore.
      }
    })();
  });

  server.listen(config.wsPort, '0.0.0.0', () => {
    console.log(`Game WebSocket server listening on :${config.wsPort}`);
    console.log(`WS endpoint: ws://localhost:${config.wsPort}/ws/lobbies/<lobbyId>`);
  });

  return server;
}
