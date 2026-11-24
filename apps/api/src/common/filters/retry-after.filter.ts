import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Giu nguyen cach tra loi HttpException mac dinh, chi them header Retry-After (giay) cho 429
 * (lay tu retryAfter trong body, hoac so giay trong thong bao "sau N giay", mac dinh 60).
 */
@Catch(HttpException)
export class RetryAfterFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const body = exception.getResponse();
    if (status === HttpStatus.TOO_MANY_REQUESTS) {
      const obj = typeof body === 'object' && body ? (body as Record<string, unknown>) : {};
      const msg = typeof body === 'string' ? body : typeof obj.message === 'string' ? obj.message : '';
      const n = typeof obj.retryAfter === 'number' ? obj.retryAfter : Number(/(\d+)\s*giây/.exec(msg)?.[1]);
      res.setHeader('Retry-After', String(Number.isFinite(n) && n > 0 ? Math.ceil(n) : 60));
    }
    res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
  }
}
