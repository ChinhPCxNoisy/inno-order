import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AppController } from './app.controller';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { RetryAfterFilter } from './common/filters/retry-after.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { StoresModule } from './stores/stores.module';
import { UsersModule } from './users/users.module';
import { TablesModule } from './tables/tables.module';
import { MenuModule } from './menu/menu.module';
import { OrdersModule } from './orders/orders.module';
import { BillsModule } from './bills/bills.module';
import { OffersModule } from './offers/offers.module';
import { PaymentsModule } from './payments/payments.module';
import { KitchenModule } from './kitchen/kitchen.module';
import { PosModule } from './pos/pos.module';
import { PrintersModule } from './printers/printers.module';
import { ReportsModule } from './reports/reports.module';
import { PublicModule } from './public/public.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReviewsModule } from './reviews/reviews.module';
import { TableCallsModule } from './table-calls/table-calls.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    CommonModule,
    // JwtModule rieng cho global guard (chung secret voi AuthModule)
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: (config.get<string>('jwt.expiresIn') ?? '7d') as unknown as number,
        },
      }),
    }),
    AuthModule,
    StoresModule,
    UsersModule,
    TablesModule,
    MenuModule,
    OrdersModule,
    BillsModule,
    OffersModule,
    PaymentsModule,
    KitchenModule,
    PosModule,
    PrintersModule,
    ReportsModule,
    PublicModule,
    RealtimeModule,
    ReviewsModule,
    TableCallsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: RetryAfterFilter },
  ],
})
export class AppModule {}
