import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Offer, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { JwtUser } from '../common/types/jwt-user.interface';
import { assertStoreAccess } from '../common/utils/assert-store';
import { money } from '../common/utils/money';
import {
  normalizeOfferCode,
  offerConditions,
  offerDiscountAmount,
  offerMinReason,
  offerSummary,
  offerUnavailableReason,
} from './offer-rules';
import { CreateOfferDto, UpdateOfferDto } from './dto/offer.dto';

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ================= ADMIN =================

  private adminDto(o: Offer, extra: Record<string, unknown> = {}) {
    return {
      id: o.id,
      code: o.code,
      tagline: o.tagline,
      headline: o.headline,
      subtitle: o.subtitle,
      description: o.description,
      discountType: o.discountType,
      value: money(o.value),
      maxDiscount: o.maxDiscount === null ? null : money(o.maxDiscount),
      minSubtotal: money(o.minSubtotal),
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      totalLimit: o.totalLimit,
      usedCount: o.usedCount,
      stackable: o.stackable,
      listed: o.listed,
      active: o.active,
      cashierCanApply: o.cashierCanApply,
      extraTerms: o.extraTerms,
      state: this.state(o),
      conditions: offerConditions(o),
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      ...extra,
    };
  }

  private state(o: Offer): 'AVAILABLE' | 'PAUSED' | 'NOT_STARTED' | 'EXPIRED' | 'EXHAUSTED' {
    const now = Date.now();
    if (!o.active) return 'PAUSED';
    if (o.startsAt.getTime() > now) return 'NOT_STARTED';
    if (o.endsAt && o.endsAt.getTime() < now) return 'EXPIRED';
    if (o.totalLimit !== null && o.usedCount >= o.totalLimit) return 'EXHAUSTED';
    return 'AVAILABLE';
  }

  private validate(dto: Partial<CreateOfferDto>, current?: Offer) {
    const type = dto.discountType ?? current?.discountType;
    const value = dto.value ?? (current ? money(current.value) : undefined);
    if (type === 'PERCENT' && value !== undefined && (value <= 0 || value > 100)) {
      throw new BadRequestException('Giảm theo phần trăm phải trong khoảng 1-100%');
    }
    if (type === 'AMOUNT' && value !== undefined && value <= 0) {
      throw new BadRequestException('Số tiền giảm phải lớn hơn 0');
    }
    if (type === 'AMOUNT' && value !== undefined && !Number.isInteger(value)) {
      throw new BadRequestException('Số tiền giảm phải là số nguyên đồng');
    }
    const starts = dto.startsAt ? new Date(dto.startsAt) : current?.startsAt;
    const ends = dto.endsAt === null ? null : dto.endsAt ? new Date(dto.endsAt) : current?.endsAt;
    if (starts && ends && ends.getTime() <= starts.getTime()) {
      throw new BadRequestException('Ngày kết thúc phải sau ngày bắt đầu');
    }
  }

  async list(user: JwtUser, storeId: string) {
    assertStoreAccess(user, storeId);
    const rows = await this.prisma.offer.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' } });
    return rows.map((o) => this.adminDto(o));
  }

  async create(user: JwtUser, storeId: string, dto: CreateOfferDto) {
    assertStoreAccess(user, storeId);
    this.validate(dto);
    const code = normalizeOfferCode(dto.code);
    const dup = await this.prisma.offer.findUnique({ where: { storeId_code: { storeId, code } } });
    if (dup) throw new ConflictException('Mã ưu đãi đã tồn tại trong quán');
    const created = await this.prisma.offer.create({
      data: {
        storeId,
        code,
        tagline: dto.tagline,
        headline: dto.headline.trim(),
        subtitle: dto.subtitle,
        description: dto.description,
        discountType: dto.discountType,
        value: dto.value,
        maxDiscount: dto.maxDiscount ?? null,
        minSubtotal: dto.minSubtotal ?? 0,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : new Date(),
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        totalLimit: dto.totalLimit ?? null,
        stackable: dto.stackable ?? false,
        listed: dto.listed ?? true,
        active: dto.active ?? true,
        cashierCanApply: dto.cashierCanApply ?? true,
        extraTerms: (dto.extraTerms ?? []) as unknown as Prisma.InputJsonValue,
        createdByUserId: user.id,
      },
    });
    await this.audit.log({
      action: 'offer_create',
      entityType: 'Offer',
      entityId: created.id,
      storeId,
      userId: user.id,
      afterData: { code, headline: created.headline, discountType: created.discountType, value: money(created.value) },
    });
    return this.adminDto(created);
  }

  private async must(storeId: string, id: string) {
    const o = await this.prisma.offer.findFirst({ where: { id, storeId } });
    if (!o) throw new NotFoundException('Ưu đãi không tồn tại');
    return o;
  }

  async update(user: JwtUser, storeId: string, id: string, dto: UpdateOfferDto) {
    assertStoreAccess(user, storeId);
    const cur = await this.must(storeId, id);
    this.validate(dto, cur);
    const used = await this.prisma.offerRedemption.count({ where: { offerId: id } });
    // Da co luot dung: khong doi loai/gia tri giam (so lieu lich su sai lech)
    if (used > 0 && (dto.discountType !== undefined || dto.value !== undefined)) {
      throw new ConflictException('Ưu đãi đã có lượt sử dụng, không đổi loại/giá trị giảm. Hãy tạo ưu đãi mới');
    }
    if (dto.totalLimit !== undefined && dto.totalLimit !== null && dto.totalLimit < cur.usedCount) {
      throw new BadRequestException(`Giới hạn lượt không được nhỏ hơn số lượt đã dùng (${cur.usedCount})`);
    }
    const data: Prisma.OfferUncheckedUpdateInput = {};
    if (dto.tagline !== undefined) data.tagline = dto.tagline;
    if (dto.headline !== undefined) data.headline = dto.headline.trim();
    if (dto.subtitle !== undefined) data.subtitle = dto.subtitle;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.discountType !== undefined) data.discountType = dto.discountType;
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.maxDiscount !== undefined) data.maxDiscount = dto.maxDiscount;
    if (dto.minSubtotal !== undefined) data.minSubtotal = dto.minSubtotal;
    if (dto.startsAt !== undefined) data.startsAt = new Date(dto.startsAt);
    if (dto.endsAt !== undefined) data.endsAt = dto.endsAt === null ? null : new Date(dto.endsAt);
    if (dto.totalLimit !== undefined) data.totalLimit = dto.totalLimit;
    if (dto.stackable !== undefined) data.stackable = dto.stackable;
    if (dto.listed !== undefined) data.listed = dto.listed;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.cashierCanApply !== undefined) data.cashierCanApply = dto.cashierCanApply;
    if (dto.extraTerms !== undefined) data.extraTerms = dto.extraTerms as unknown as Prisma.InputJsonValue;
    const updated = await this.prisma.offer.update({ where: { id }, data });
    await this.audit.log({
      action: 'offer_update',
      entityType: 'Offer',
      entityId: id,
      storeId,
      userId: user.id,
      beforeData: { active: cur.active, endsAt: cur.endsAt?.toISOString() ?? null, totalLimit: cur.totalLimit },
      afterData: { active: updated.active, endsAt: updated.endsAt?.toISOString() ?? null, totalLimit: updated.totalLimit },
    });
    return this.adminDto(updated);
  }

  async remove(user: JwtUser, storeId: string, id: string) {
    assertStoreAccess(user, storeId);
    await this.must(storeId, id);
    const used = await this.prisma.offerRedemption.count({ where: { offerId: id } });
    if (used > 0) throw new ConflictException('Ưu đãi đã có lượt sử dụng, chỉ có thể tạm dừng');
    await this.prisma.offer.delete({ where: { id } });
    await this.audit.log({ action: 'offer_delete', entityType: 'Offer', entityId: id, storeId, userId: user.id });
    return { ok: true };
  }

  async redemptions(user: JwtUser, storeId: string, id: string) {
    assertStoreAccess(user, storeId);
    const o = await this.must(storeId, id);
    const rows = await this.prisma.offerRedemption.findMany({
      where: { offerId: id, storeId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const bills = await this.prisma.bill.findMany({
      where: { id: { in: rows.map((r) => r.billId) } },
      select: { id: true, billNo: true, status: true },
    });
    const billMap = new Map(bills.map((b) => [b.id, b]));
    const sum = (st: string) => rows.filter((r) => r.status === st).reduce((s, r) => s + money(r.amount), 0);
    return {
      offer: this.adminDto(o),
      stats: {
        usedCount: o.usedCount,
        reserved: rows.filter((r) => r.status === 'RESERVED').length,
        consumed: rows.filter((r) => r.status === 'CONSUMED').length,
        released: rows.filter((r) => r.status === 'RELEASED').length,
        totalDiscountConsumed: sum('CONSUMED'),
        totalDiscountReserved: sum('RESERVED'),
      },
      redemptions: rows.map((r) => ({
        id: r.id,
        status: r.status,
        amount: money(r.amount),
        billId: r.billId,
        billNo: billMap.get(r.billId)?.billNo ?? null,
        billStatus: billMap.get(r.billId)?.status ?? null,
        appliedByUserId: r.appliedByUserId,
        approvedByUserId: r.approvedByUserId,
        overrideReason: r.overrideReason,
        createdAt: r.createdAt,
        consumedAt: r.consumedAt,
        releasedAt: r.releasedAt,
      })),
    };
  }

  // ================= CONG KHAI (mini app) =================

  /** Danh sach uu dai dang hieu luc, cong khai (chi uu dai listed) */
  async publicList(storeId: string) {
    const now = new Date();
    const rows = await this.prisma.offer.findMany({
      where: {
        storeId,
        active: true,
        listed: true,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows
      .filter((o) => !offerUnavailableReason(o, now))
      .map((o) => this.publicCard(o));
  }

  private publicCard(o: Offer) {
    return {
      id: o.id,
      code: o.code,
      tagline: o.tagline,
      headline: o.headline,
      subtitle: o.subtitle,
      summary: offerSummary(o),
      discountType: o.discountType,
      value: money(o.value),
      maxDiscount: o.maxDiscount === null ? null : money(o.maxDiscount),
      minSubtotal: money(o.minSubtotal),
      endsAt: o.endsAt,
      limited: o.totalLimit !== null,
    };
  }

  /** Chi tiet kem "dieu kien ap dung" do server sinh; tra ca uu dai het han/het luot de hien trang thai mo */
  async publicDetail(storeId: string, id: string) {
    const o = await this.prisma.offer.findFirst({ where: { id, storeId, active: true, listed: true } });
    if (!o) throw new NotFoundException('Ưu đãi không tồn tại hoặc đã dừng');
    return {
      ...this.publicCard(o),
      description: o.description,
      state: this.state(o),
      conditions: offerConditions(o),
      note: 'Ưu đãi chỉ áp dụng khi được quán xác nhận. Không tự động trừ vào giỏ món.',
    };
  }

  /** Kiem tra ma theo tam tinh (KHONG tru luot, KHONG ghi gi) */
  async publicCheck(storeId: string, codeRaw: string, subtotal: number) {
    const code = normalizeOfferCode(codeRaw ?? '');
    const o = code ? await this.prisma.offer.findUnique({ where: { storeId_code: { storeId, code } } }) : null;
    // Thong bao chung de kho do ma: khong phan biet "khong ton tai" va "dang tat/an"
    if (!o || !o.active) return { valid: false, message: 'Mã ưu đãi không hợp lệ' };
    const why = offerUnavailableReason(o);
    if (why) return { valid: false, message: why };
    const min = offerMinReason(o, subtotal);
    if (min) return { valid: false, message: min };
    const amount = offerDiscountAmount(o, subtotal);
    if (amount <= 0) return { valid: false, message: 'Ưu đãi không áp dụng cho đơn này' };
    return {
      valid: true,
      code: o.code,
      headline: o.headline,
      discountAmount: amount,
      message: 'Quán sẽ xác nhận khi thanh toán. Ưu đãi không tự động trừ vào giỏ món.',
    };
  }
}
