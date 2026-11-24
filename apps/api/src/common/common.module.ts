import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { EventsService } from '../realtime/events.service';

/** Global de AuditService + EventsService duoc inject vao moi module */
@Global()
@Module({
  providers: [AuditService, EventsService],
  exports: [AuditService, EventsService],
})
export class CommonModule {}
