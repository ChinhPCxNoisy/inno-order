import { Module } from '@nestjs/common';
import { TableCallsController } from './table-calls.controller';
import { TableCallsService } from './table-calls.service';

@Module({
  controllers: [TableCallsController],
  providers: [TableCallsService],
  exports: [TableCallsService],
})
export class TableCallsModule {}
