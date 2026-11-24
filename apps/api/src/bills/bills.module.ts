import { Module } from '@nestjs/common';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';
import { SessionsService } from './sessions.service';
import { PrintersModule } from '../printers/printers.module';

@Module({
  imports: [PrintersModule],
  controllers: [BillsController],
  providers: [BillsService, SessionsService],
  exports: [BillsService, SessionsService],
})
export class BillsModule {}
