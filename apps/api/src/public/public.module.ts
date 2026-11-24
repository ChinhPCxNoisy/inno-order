import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { OrdersModule } from '../orders/orders.module';
import { MenuModule } from '../menu/menu.module';
import { StoresModule } from '../stores/stores.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TableCallsModule } from '../table-calls/table-calls.module';
import { BillsModule } from '../bills/bills.module';
import { OffersModule } from '../offers/offers.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [OrdersModule, MenuModule, StoresModule, ReviewsModule, TableCallsModule, BillsModule, OffersModule, PaymentsModule],
  controllers: [PublicController],
})
export class PublicModule {}
