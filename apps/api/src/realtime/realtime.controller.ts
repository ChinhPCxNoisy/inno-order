import { Controller, Query, Sse, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { interval, merge, Observable, map } from 'rxjs';
import { Public } from '../common/decorators/public.decorator';
import { JwtPayload } from '../common/guards/jwt-auth.guard';
import { EventsService, OrderEventPayload } from './events.service';

/**
 * Realtime (SSE) cho admin POS/KDS (BRD 13.1, FR-NTF-01).
 *
 * EventSource (browser) khong gui duoc header Authorization nen token
 * JWT duoc truyen qua query va verify chung secret voi cac route khac.
 * Chi user cua store do (hoac Super Admin) moi nhan su kien cua store.
 */
@Public()
@Controller('realtime')
export class RealtimeController {
  constructor(
    private readonly events: EventsService,
    private readonly jwt: JwtService,
  ) {}

  @Sse('events')
  stream(@Query('token') token: string): Observable<{ data: OrderEventPayload }> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Thiếu token hoặc token không hợp lệ');
    }
    const isSuper = payload.role === 'SUPER_ADMIN';
    const events$ = this.events.stream(
      (e) => e.type !== 'ping' && (isSuper || e.storeId === payload.storeId),
    );
    // Ping 25s/lan de proxy/keep-alive khong cat ket noi trong
    const ping$ = interval(25000).pipe(
      map(() => ({ type: 'ping', storeId: '', orderId: '', orderNumber: '', tableCode: '', tableName: null, status: '', totalAmount: 0, source: null, createdAt: '' } as OrderEventPayload)),
    );
    return merge(events$, ping$).pipe(map((data) => ({ data })));
  }
}
