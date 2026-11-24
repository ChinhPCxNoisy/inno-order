import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PrintersModule } from '../printers/printers.module';
import { BillsModule } from '../bills/bills.module';

@Module({
  imports: [PrintersModule, BillsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
