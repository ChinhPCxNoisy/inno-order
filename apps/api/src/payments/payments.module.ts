import { Module } from '@nestjs/common';
import { BillsModule } from '../bills/bills.module';
import { PaymentsController, PaymentsPublicController, WebhookController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { WebhookHandler } from './webhook.handler';

@Module({
  imports: [BillsModule],
  controllers: [PaymentsController, WebhookController, PaymentsPublicController],
  providers: [PaymentsService, WebhookHandler],
  exports: [PaymentsService],
})
export class PaymentsModule {}
