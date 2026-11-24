import { Module } from '@nestjs/common';
import { PrintersController } from './printers.controller';
import { PrintersService } from './printers.service';
import { PrintService } from './print.service';
import { PrintAgentService } from './print-agent.service';
import { AgentController, PrintAgentGuard } from './agent.controller';

@Module({
  controllers: [PrintersController, AgentController],
  providers: [PrintersService, PrintService, PrintAgentService, PrintAgentGuard],
  exports: [PrintService],
})
export class PrintersModule {}
