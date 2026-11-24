import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { PrintAgent } from '@prisma/client';
import { Public } from '../common/decorators/public.decorator';
import { RateLimiter } from '../common/utils/rate-limiter';
import { PrintAgentService } from './print-agent.service';
import { AgentHeartbeatDto, AgentResultDto } from './dto/agent.dto';

/** Token sai: toi da 30 lan / phut / IP (chong do token) */
const badTokenLimiter = new RateLimiter(30, 60_000);

/** Xac thuc Print Agent bang `Authorization: Bearer <agentToken>` (khong dung JWT nhan vien) */
@Injectable()
export class PrintAgentGuard implements CanActivate {
  constructor(private readonly agents: PrintAgentService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; ip?: string; agent?: PrintAgent }>();
    const h = req.headers['authorization'] ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const agent = await this.agents.authenticate(token);
    if (!agent) {
      const wait = badTokenLimiter.hit(`agent-bad|${req.ip ?? 'x'}`);
      if (wait !== null) {
        throw new HttpException('Quá nhiều lần thử token, vui lòng thử lại sau', HttpStatus.TOO_MANY_REQUESTS);
      }
      throw new UnauthorizedException('Token máy in không hợp lệ');
    }
    req.agent = agent;
    return true;
  }
}

/** API cho Print Agent (apps/print-agent/PROTOCOL.md) */
@Public()
@UseGuards(PrintAgentGuard)
@Controller('agent')
export class AgentController {
  constructor(private readonly agents: PrintAgentService) {}

  @Post('heartbeat')
  heartbeat(@Req() req: { agent: PrintAgent }, @Body() dto: AgentHeartbeatDto) {
    return this.agents.heartbeat(req.agent, dto);
  }

  /** Poll dai: tra { jobs, serverTime } */
  @Get('jobs/next')
  async next(
    @Req() req: { agent: PrintAgent; on: (e: string, f: () => void) => void },
    @Query('wait') waitQ?: string,
    @Query('max') maxQ?: string,
  ) {
    let closed = false;
    req.on('close', () => {
      closed = true;
    });
    const wait = Number.isFinite(Number(waitQ)) ? Number(waitQ) : 20;
    const max = Number.isFinite(Number(maxQ)) ? Number(maxQ) : 5;
    return this.agents.poll(req.agent, wait, max, () => closed);
  }

  @Post('jobs/:id/result')
  result(
    @Req() req: { agent: PrintAgent },
    @Param('id', new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException('Job không tồn tại') })) id: string,
    @Body() dto: AgentResultDto,
  ) {
    return this.agents.result(req.agent, id, dto);
  }
}
