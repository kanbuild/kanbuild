import { EventEmitter } from 'node:events';
import type { ServerMessage } from '../../shared/types.ts';

/** In-process event bus; the WebSocket layer forwards every message to connected clients. */
class Bus extends EventEmitter {
  publish(msg: ServerMessage) {
    this.emit('message', msg);
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
