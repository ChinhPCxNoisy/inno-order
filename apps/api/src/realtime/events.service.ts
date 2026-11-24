import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Observable } from 'rxjs';

/** Su kien don de push thoi gian thuc cho admin POS/KDS (BRD 13.1, FR-NTF-01) */
export interface OrderEventPayload {
  type:
    | 'order.created'
    | 'order.status'
    | 'table.call'
    | 'table.call_resolved'
    | 'table.moved'
    | 'print.failed'
    | 'print.recovered'
    | 'print.agent_offline'
    | 'print.printer_error'
    | 'payment.confirmed'
    | 'payment.partial'
    | 'payment.needs_review'
    | 'payment.expired'
    | 'ping';
  storeId: string;
  orderId: string;
  orderNumber: string;
  tableCode: string;
  tableName: string | null;
  status: string;
  totalAmount: number;
  source: string | null;
  createdAt: string;
  // Chi co o su kien table.call / table.call_resolved
  callId?: string;
  // Du lieu rieng cua su kien print.* / table.moved
  data?: Record<string, unknown>;
}

export type OrderEventBase = Omit<OrderEventPayload, 'type' | 'tableName' | 'source'> & {
  tableName?: string | null;
  source?: string | null;
};

const CHANNEL = 'order';

/**
 * Pub/sub trong tieng trinh (1 instance API). Sau nay scale ra nhieu
 * instance thi thay bang Redis pub/sub (REDIS_URL da co trong .env).
 */
@Injectable()
export class EventsService {
  private readonly em = new EventEmitter();

  constructor() {
    // nhieu thi biet admin (POS + KDS + ...) dong thoi
    this.em.setMaxListeners(0);
  }

  orderCreated(p: OrderEventBase): void {
    this.em.emit(CHANNEL, {
      type: 'order.created',
      tableName: p.tableName ?? null,
      source: p.source ?? null,
      ...p,
    } satisfies OrderEventPayload);
  }

  orderStatus(p: OrderEventBase): void {
    this.em.emit(CHANNEL, {
      type: 'order.status',
      tableName: p.tableName ?? null,
      source: p.source ?? null,
      ...p,
    } satisfies OrderEventPayload);
  }

  /** Khach bam "Goi nhan vien" tai ban (BRD FR-NTF — bao realtime cho nhan vien) */
  tableCallCreated(p: { storeId: string; tableCode: string; tableName: string | null; callId: string; createdAt: string }): void {
    this.em.emit(CHANNEL, {
      type: 'table.call',
      storeId: p.storeId,
      orderId: '',
      orderNumber: '',
      tableCode: p.tableCode,
      tableName: p.tableName,
      status: 'PENDING',
      totalAmount: 0,
      source: null,
      createdAt: p.createdAt,
      callId: p.callId,
    } satisfies OrderEventPayload);
  }

  /** Nhan vien da xac nhan xu ly yeu cau goi — bao cac man hinh dang mo biet de bo banner */
  tableCallResolved(p: { storeId: string; tableCode: string; tableName: string | null; callId: string }): void {
    this.em.emit(CHANNEL, {
      type: 'table.call_resolved',
      storeId: p.storeId,
      orderId: '',
      orderNumber: '',
      tableCode: p.tableCode,
      tableName: p.tableName,
      status: 'RESOLVED',
      totalAmount: 0,
      source: null,
      createdAt: new Date().toISOString(),
      callId: p.callId,
    } satisfies OrderEventPayload);
  }

  /** Su kien in (print.failed, print.recovered, print.agent_offline, print.printer_error) va table.moved */
  generic(
    type:
      | 'table.moved'
      | 'print.failed'
      | 'print.recovered'
      | 'print.agent_offline'
      | 'print.printer_error'
      | 'payment.confirmed'
      | 'payment.partial'
      | 'payment.needs_review'
      | 'payment.expired',
    storeId: string,
    data: Record<string, unknown>,
    ref: { tableCode?: string; orderNumber?: string; orderId?: string } = {},
  ): void {
    this.em.emit(CHANNEL, {
      type,
      storeId,
      orderId: ref.orderId ?? '',
      orderNumber: ref.orderNumber ?? '',
      tableCode: ref.tableCode ?? '',
      tableName: null,
      status: '',
      totalAmount: 0,
      source: null,
      createdAt: new Date().toISOString(),
      data,
    } satisfies OrderEventPayload);
  }

  /** Dong su kien co the loc theo dieu kien (VD: theo storeId cua user) */
  stream(match: (e: OrderEventPayload) => boolean): Observable<OrderEventPayload> {
    return new Observable<OrderEventPayload>((subscriber) => {
      const onOrder = (e: OrderEventPayload) => {
        if (!subscriber.closed && match(e)) subscriber.next(e);
      };
      this.em.on(CHANNEL, onOrder);
      return () => {
        this.em.off(CHANNEL, onOrder);
      };
    });
  }
}
