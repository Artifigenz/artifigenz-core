import { EventEmitter } from "node:events";
import type { EventType, EventPayload } from "./event-types";

class EventBus {
  private emitter = new EventEmitter();

  emit<T extends EventType>(type: T, payload: EventPayload[T]): void {
    this.emitter.emit(type, payload);
  }

  on<T extends EventType>(
    type: T,
    handler: (payload: EventPayload[T]) => void,
  ): void {
    this.emitter.on(type, handler);
  }

  off<T extends EventType>(
    type: T,
    handler: (payload: EventPayload[T]) => void,
  ): void {
    this.emitter.off(type, handler);
  }
}

export const eventBus = new EventBus();
