import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeController } from './realtime.controller';

@Module({
  imports: [
    // JwtService de verify token query cho SSE (chung secret voi AuthModule)
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: (config.get<string>('jwt.expiresIn') ?? '7d') as unknown as number,
        },
      }),
    }),
  ],
  controllers: [RealtimeController],
})
export class RealtimeModule {}
