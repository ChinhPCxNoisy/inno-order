import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { flattenErrors } from './common/utils/validation-messages';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Giu rawBody (Buffer) cho cac route can kiem chu ky (webhook ngan hang); khong anh huong cach parse JSON cac route khac
    rawBody: true,
  });
  const config = app.get(ConfigService);

  // Anh mon upload tu dien thoai/may tinh: luu local, serve qua /api/v1/uploads
  // (cung prefix voi /api nen di theo chung 1 duong proxy/reverse-proxy voi cac route khac)
  const uploadsDir = join(process.cwd(), 'uploads');
  mkdirSync(uploadsDir, { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/api/v1/uploads' });

  // Chay sau reverse proxy/CDN: dat TRUST_PROXY de req.ip la IP khach that (giu gioi han tan suat dung).
  // Gia tri: so luong proxy ("1"), "loopback", dai CIDR ("10.0.0.0/8") hoac "true". KHONG dat khi lo truc tiep ra internet
  // (client co the gia header X-Forwarded-For de ne gioi han). Mac dinh tat.
  const tp = process.env.TRUST_PROXY?.trim();
  if (tp) app.set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? true : tp);
  app.setGlobalPrefix('api/v1');
  const origins = config.get<string>('corsOrigins');
  app.enableCors({
    origin: origins ? origins.split(',').map((s) => s.trim()) : true,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errors) => new BadRequestException(flattenErrors(errors)),
    }),
  );
  app.enableShutdownHooks();

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`InnoOrder API: http://localhost:${port}/api/v1 (health: /api/v1/health)`);
}
bootstrap();
