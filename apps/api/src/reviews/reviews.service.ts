import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertStoreAccess } from '../common/utils/assert-store';
import { isModuleEnabled } from '../common/modules';
import { JwtUser } from '../common/types/jwt-user.interface';
import { CreateReviewDto } from './dto/review.dto';
import { vnDateLabel, vnDayEnd, vnDayStart } from '../common/utils/vn-date';

function dayRange(from?: string, to?: string): { start: Date; end: Date } {
  const start = vnDayStart(from ?? vnDateLabel(new Date(Date.now() - 6 * 86400000)));
  const end = vnDayEnd(to ?? vnDateLabel());
  return { start, end };
}

/** Nguoi phuc vu chinh cua don: ai bam "Da mang ra ban" nhieu mon nhat (BRD module staff_rating) */
function pickMainStaff(items: { servedByUserId: string | null }[]): string | null {
  const counts = new Map<string, number>();
  for (const it of items) {
    if (!it.servedByUserId) continue;
    counts.set(it.servedByUserId, (counts.get(it.servedByUserId) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Khach xem co can/duoc danh gia don nay khong (public, khong can token) */
  async getStatus(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        store: { select: { enabledModules: true } },
        items: { select: { servedByUserId: true } },
        review: { include: { staff: { select: { name: true } } } },
      },
    });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại');

    if (!isModuleEnabled(order.store, 'staff_rating')) {
      return { enabled: false as const };
    }

    if (order.review) {
      return {
        enabled: true as const,
        reviewed: true as const,
        rating: order.review.rating,
        comment: order.review.comment,
        tags: (order.review.tags as string[] | null) ?? [],
        staffName: order.review.staff?.name ?? null,
      };
    }

    if (order.status !== 'COMPLETED') {
      return { enabled: true as const, reviewed: false as const, eligible: false as const };
    }

    const staffId = pickMainStaff(order.items);
    const staff = staffId
      ? await this.prisma.user.findUnique({ where: { id: staffId }, select: { name: true } })
      : null;

    return {
      enabled: true as const,
      reviewed: false as const,
      eligible: true as const,
      staffName: staff?.name ?? null,
    };
  }

  /** Khach gui danh gia (public, khong can token) */
  async createPublic(orderId: string, dto: CreateReviewDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        store: { select: { id: true, enabledModules: true } },
        items: { select: { servedByUserId: true } },
        review: { select: { id: true } },
      },
    });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại');
    if (!isModuleEnabled(order.store, 'staff_rating')) {
      throw new BadRequestException('Quán chưa bật tính năng đánh giá');
    }
    if (order.status !== 'COMPLETED') {
      throw new BadRequestException('Đơn chưa hoàn tất, chưa thể đánh giá');
    }
    if (order.review) {
      throw new ConflictException('Đơn này đã được đánh giá');
    }

    const staffId = pickMainStaff(order.items);
    let review;
    try {
      review = await this.prisma.orderReview.create({
        data: {
          storeId: order.store.id,
          orderId: order.id,
          rating: dto.rating,
          comment: dto.comment,
          tags: dto.tags ?? [],
          staffId,
          zaloUserId: dto.zaloUserId,
        },
      });
    } catch (e) {
      // Gui trung dong thoi: rang buoc duy nhat theo don -> 409 thay vi 500
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Đơn này đã được đánh giá');
      }
      throw e;
    }

    const staff = staffId
      ? await this.prisma.user.findUnique({ where: { id: staffId }, select: { name: true } })
      : null;

    return { ok: true, staffName: staff?.name ?? null, rating: review.rating };
  }

  /** Chu quan xem danh sach danh gia (BRD module staff_rating) */
  async listForStore(user: JwtUser, storeId: string, from?: string, to?: string) {
    assertStoreAccess(user, storeId);
    const { start, end } = dayRange(from, to);
    const reviews = await this.prisma.orderReview.findMany({
      where: { storeId, createdAt: { gte: start, lte: end } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        staff: { select: { name: true } },
        order: { select: { orderNumber: true } },
      },
    });
    // Dau hieu gian lan: cung 1 zaloUserId gui nhieu danh gia tai quan nay (vd nhan vien tu danh gia)
    const zaloCounts = new Map<string, number>();
    for (const r of reviews) {
      if (r.zaloUserId) zaloCounts.set(r.zaloUserId, (zaloCounts.get(r.zaloUserId) ?? 0) + 1);
    }

    return reviews.map((r) => ({
      id: r.id,
      orderNumber: r.order.orderNumber,
      staffName: r.staff?.name ?? null,
      rating: r.rating,
      comment: r.comment,
      tags: (r.tags as string[] | null) ?? [],
      createdAt: r.createdAt,
      zaloVerified: r.zaloUserId != null,
      suspicious: r.zaloUserId != null && (zaloCounts.get(r.zaloUserId) ?? 0) > 1,
    }));
  }
}
