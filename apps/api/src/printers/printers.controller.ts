import { Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtUser } from '../common/types/jwt-user.interface';
import { PrintersService } from './printers.service';
import { PrintAgentService } from './print-agent.service';
import { CreatePrinterDto, UpdatePrinterDto } from './dto/printer.dto';
import { CreateAgentDto } from './dto/agent.dto';

const ALL_STAFF = [
  UserRole.SUPER_ADMIN,
  UserRole.OWNER,
  UserRole.MANAGER,
  UserRole.CASHIER,
  UserRole.WAITER,
  UserRole.KITCHEN,
];
const READ = [UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.CASHIER];
const MANAGE = [UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.MANAGER];
const WRITE = [UserRole.SUPER_ADMIN, UserRole.OWNER];

const idPipe = new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('Không tồn tại') });
type Rq = { protocol: string; get: (h: string) => string | undefined };
/** URL may chu de dien san vao tep cau hinh agent (quan co the sua lai neu di qua proxy) */
const serverUrlOf = (req: Rq) => `${req.protocol}://${req.get('host') ?? 'localhost:3000'}`;

@Controller('stores/:storeId')
export class PrintersController {
  constructor(
    private readonly printers: PrintersService,
    private readonly agents: PrintAgentService,
  ) {}

  @Get('printers')
  @Roles(...READ)
  list(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string) {
    return this.printers.list(user, storeId);
  }

  @Post('printers')
  @Roles(...WRITE)
  create(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Body() dto: CreatePrinterDto) {
    return this.printers.create(user, storeId, dto);
  }

  @Patch('printers/:id')
  @Roles(...WRITE)
  update(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id', idPipe) id: string,
    @Body() dto: UpdatePrinterDto,
  ) {
    return this.printers.update(user, storeId, id, dto);
  }

  /** In thu (BRD FR-PRN-06): tao job that, ket qua theo doi o danh sach job */
  @Post('printers/:id/test')
  @Roles(...READ)
  test(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string) {
    return this.printers.testPrint(user, storeId, id);
  }

  /** Mo ket tien thu cong (audit mo_ket) */
  @Post('printers/:id/open-drawer')
  @Roles(...READ)
  openDrawer(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string) {
    return this.printers.openDrawer(user, storeId, id);
  }

  /** Log cac job in (BRD FR-PRN-07). Loc: status, printerId, orderId, limit (toi da 300) */
  @Get('print-jobs')
  @Roles(...READ)
  listJobs(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Query('status') status?: string,
    @Query('printerId') printerId?: string,
    @Query('orderId') orderId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.printers.listJobs(user, storeId, { status, printerId, orderId, limit: limit ? Number(limit) : undefined });
  }

  @Post('print-jobs/:id/retry')
  @Roles(...READ)
  retry(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string) {
    return this.printers.retryJob(user, storeId, id);
  }

  @Post('print-jobs/:id/cancel')
  @Roles(...MANAGE)
  cancel(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string) {
    return this.printers.cancelJob(user, storeId, id);
  }

  @Post('print-jobs/:id/acknowledge')
  @Roles(...ALL_STAFF)
  acknowledge(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string) {
    return this.printers.acknowledge(user, storeId, id);
  }

  @Get('printing/health')
  @Roles(...ALL_STAFF)
  health(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string) {
    return this.printers.health(user, storeId);
  }

  // ---- Print Agent ----

  @Get('print-agents')
  @Roles(...MANAGE)
  listAgents(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string) {
    return this.agents.listAgents(user, storeId);
  }

  /** Tao agent: token chi hien MOT LAN trong phan hoi (kem tep cau hinh agent dien san) */
  @Post('print-agents')
  @Roles(...MANAGE)
  createAgent(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Body() dto: CreateAgentDto,
    @Req() req: Rq,
  ) {
    return this.agents.createAgent(user, storeId, dto.name, serverUrlOf(req));
  }

  @Get('print-agents/:id/config')
  @Roles(...MANAGE)
  agentConfig(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id', idPipe) id: string,
    @Req() req: Rq,
  ) {
    return this.agents.getConfig(user, storeId, id, serverUrlOf(req));
  }

  @Post('print-agents/:id/rotate-token')
  @Roles(...MANAGE)
  rotate(
    @CurrentUser() user: JwtUser,
    @Param('storeId') storeId: string,
    @Param('id', idPipe) id: string,
    @Req() req: Rq,
  ) {
    return this.agents.rotateToken(user, storeId, id, serverUrlOf(req));
  }

  @Delete('print-agents/:id')
  @Roles(...MANAGE)
  revoke(@CurrentUser() user: JwtUser, @Param('storeId') storeId: string, @Param('id', idPipe) id: string) {
    return this.agents.revokeAgent(user, storeId, id);
  }
}
