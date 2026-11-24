import { Injectable } from '@nestjs/common';
import { Prisma, TableStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertStoreAccess } from '../common/utils/assert-store';
import { money } from '../common/utils/money';
import { JwtUser } from '../common/types/jwt-user.interface';
import { dayRange, vnDayEnd } from '../common/utils/vn-date';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Bao cao ngay (BRD FR-RPT-01..04, 9.11) */
  async daily(user: JwtUser, storeId: string, date?: string) {
    assertStoreAccess(user, storeId);
    const { start, end, label } = dayRange(date);
    const inDay = { gte: start, lt: end };

    const [payByStatus, payByMethod, refundByMethod, topItems, tableStatus, orderStats] =
      await Promise.all([
        this.prisma.payment.groupBy({
          by: ['status'],
          where: { storeId, paidAt: inDay },
          _sum: { amount: true },
        }),
        this.prisma.payment.groupBy({
          by: ['method'],
          where: { storeId, status: 'COMPLETED', paidAt: inDay },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.payment.groupBy({
          by: ['method'],
          where: { storeId, status: 'REFUNDED', paidAt: inDay },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.$queryRaw<
          { menuItemId: string; name: string; qty: number; revenue: Prisma.Decimal }[]
        >(Prisma.sql`
          SELECT oi."menuItemId" AS "menuItemId",
                 mi.name         AS "name",
                 SUM(oi.quantity)::int  AS qty,
                 SUM(oi."totalAmount")  AS revenue
          FROM order_items oi
          JOIN orders o      ON o.id = oi."orderId"
          JOIN menu_items mi ON mi.id = oi."menuItemId"
          WHERE o."storeId" = ${storeId}::uuid
            AND o.status = 'COMPLETED'
            AND o."completedAt" >= ${start}
            AND o."completedAt" <  ${end}
            AND oi.status <> 'CANCELLED'
          GROUP BY oi."menuItemId", mi.name
          ORDER BY qty DESC
          LIMIT 10
        `),
        this.prisma.table.groupBy({
          by: ['status'],
          where: { storeId },
          _count: { _all: true },
        }),
        this.prisma.$transaction([
          this.prisma.order.count({ where: { storeId, createdAt: inDay } }),
          this.prisma.order.count({
            where: { storeId, status: 'COMPLETED', completedAt: inDay },
          }),
          this.prisma.order.count({
            where: { storeId, status: 'CANCELLED', createdAt: inDay },
          }),
          // Don hoan tien tinh theo ngay hoan (payment REFUNDED), khong theo ngay tao don
          this.prisma.payment.count({
            where: { storeId, status: 'REFUNDED', paidAt: inDay },
          }),
        ]),
      ]);

    const sumOf = (arr: { status: string; _sum: { amount: Prisma.Decimal | null } }[], s: string) =>
      arr.find((r) => r.status === s) ? money(arr.find((r) => r.status === s)!._sum.amount) : 0;

    return {
      date: label,
      revenue: sumOf(payByStatus, 'COMPLETED') - sumOf(payByStatus, 'REFUNDED'),
      grossRevenue: sumOf(payByStatus, 'COMPLETED'),
      refundAmount: sumOf(payByStatus, 'REFUNDED'),
      byMethod: payByMethod.map((m) => ({
        method: m.method,
        amount: money(m._sum.amount),
        count: m._count._all,
      })),
      // Hoan tien theo dung phuong thuc goc (byMethod giu nguyen la tong thu truoc hoan)
      refundByMethod: refundByMethod.map((m) => ({
        method: m.method,
        amount: money(m._sum.amount),
        count: m._count._all,
      })),
      orders: {
        created: orderStats[0],
        completed: orderStats[1],
        cancelled: orderStats[2],
        refunded: orderStats[3],
      },
      topItems: topItems.map((t) => ({
        menuItemId: t.menuItemId,
        name: t.name,
        quantity: t.qty,
        revenue: money(t.revenue),
      })),
      tableStatus: Object.fromEntries(
        tableStatus.map((t) => [t.status, t._count._all]),
      ) as Record<TableStatus, number>,
    };
  }

  /**
   * Uu dai: so luot dung va tong giam theo tung uu dai trong khoang ngay (theo ngay CONSUMED, gio VN).
   * Luot da hoan (RELEASED) khong tinh vao tong giam; hien rieng de doi chieu.
   */
  async offers(user: JwtUser, storeId: string, from?: string, to?: string) {
    assertStoreAccess(user, storeId);
    const { start, end: defEnd, label } = dayRange(from);
    const end = to ? vnDayEnd(to) : defEnd;
    const rows = await this.prisma.offerRedemption.findMany({
      where: {
        storeId,
        OR: [
          { status: 'CONSUMED', consumedAt: { gte: start, lte: end } },
          { status: 'RELEASED', releasedAt: { gte: start, lte: end } },
          { status: 'RESERVED', createdAt: { gte: start, lte: end } },
        ],
      },
      select: { offerId: true, status: true, amount: true },
    });
    const offers = await this.prisma.offer.findMany({
      where: { storeId },
      select: { id: true, code: true, headline: true, usedCount: true, totalLimit: true, active: true },
    });
    const by = new Map(offers.map((o) => [o.id, { offerId: o.id, code: o.code, headline: o.headline, active: o.active, totalLimit: o.totalLimit, usedCount: o.usedCount, consumedCount: 0, totalDiscount: 0, reservedCount: 0, releasedCount: 0 }]));
    for (const r of rows) {
      const b = by.get(r.offerId);
      if (!b) continue;
      if (r.status === 'CONSUMED') {
        b.consumedCount++;
        b.totalDiscount += money(r.amount);
      } else if (r.status === 'RESERVED') b.reservedCount++;
      else b.releasedCount++;
    }
    const list = Array.from(by.values()).sort((a, b) => b.totalDiscount - a.totalDiscount);
    return {
      from: from ?? label,
      to: to ?? from ?? label,
      totalConsumed: list.reduce((s, x) => s + x.consumedCount, 0),
      totalDiscount: list.reduce((s, x) => s + x.totalDiscount, 0),
      byOffer: list,
    };
  }

  /** Mon ban chay trong khoang thoi gian (BRD FR-RPT-03) */
  async items(user: JwtUser, storeId: string, from?: string, to?: string) {
    assertStoreAccess(user, storeId);
    const { start: defaultStart, end: defaultEnd } = dayRange(from);
    const end = to ? vnDayEnd(to) : defaultEnd;
    const rows = await this.prisma.$queryRaw<
      { menuItemId: string; name: string; qty: number; revenue: Prisma.Decimal }[]
    >(Prisma.sql`
      SELECT oi."menuItemId" AS "menuItemId",
             mi.name         AS "name",
             SUM(oi.quantity)::int AS qty,
             SUM(oi."totalAmount") AS revenue
      FROM order_items oi
      JOIN orders o      ON o.id = oi."orderId"
      JOIN menu_items mi ON mi.id = oi."menuItemId"
      WHERE o."storeId" = ${storeId}::uuid
        AND o.status = 'COMPLETED'
        AND o."completedAt" >= ${defaultStart}
        AND o."completedAt" <= ${end}
        AND oi.status <> 'CANCELLED'
      GROUP BY oi."menuItemId", mi.name
      ORDER BY qty DESC
      LIMIT 100
    `);
    return rows.map((r) => ({
      menuItemId: r.menuItemId,
      name: r.name,
      quantity: r.qty,
      revenue: money(r.revenue),
    }));
  }

  /** Doanh thu theo phuong thuc thanh toan + theo ngay (BRD FR-RPT-04) */
  async payments(user: JwtUser, storeId: string, from?: string, to?: string) {
    assertStoreAccess(user, storeId);
    const { start: defaultStart, end: defaultEnd } = dayRange(from);
    const end = to ? vnDayEnd(to) : defaultEnd;

    const rows = await this.prisma.$queryRaw<
      { day: string; method: string; total: Prisma.Decimal; count: number }[]
    >(Prisma.sql`
      SELECT to_char(("paidAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS day,
             method,
             SUM(CASE WHEN status = 'REFUNDED' THEN -amount ELSE amount END) AS total,
             COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS count
      FROM payments
      WHERE "storeId" = ${storeId}::uuid
        AND status IN ('COMPLETED', 'REFUNDED')
        AND "paidAt" >= ${defaultStart}
        AND "paidAt" <= ${end}
      GROUP BY day, method
      ORDER BY day ASC
    `);

    const byDay = new Map<string, { date: string; total: number; byMethod: Record<string, number> }>();
    const byMethodTotal: Record<string, number> = {};
    for (const r of rows) {
      const dayRow = byDay.get(r.day) ?? { date: r.day, total: 0, byMethod: {} };
      dayRow.total += money(r.total);
      dayRow.byMethod[r.method] = (dayRow.byMethod[r.method] ?? 0) + money(r.total);
      byMethodTotal[r.method] = (byMethodTotal[r.method] ?? 0) + money(r.total);
      byDay.set(r.day, dayRow);
    }

    return {
      from: from ?? dayRange().label,
      to: to ?? from ?? dayRange().label,
      total: Object.values(byMethodTotal).reduce((a, b) => a + b, 0),
      byMethod: byMethodTotal,
      byDay: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  /** So mon/ban da phuc vu + rating trung binh theo tung nhan vien (de thuong) */
  async staff(user: JwtUser, storeId: string, from?: string, to?: string) {
    assertStoreAccess(user, storeId);
    const { start: defaultStart, end: defaultEnd } = dayRange(from);
    const end = to ? vnDayEnd(to) : defaultEnd;

    const [servedRows, tableRows, reviewRows] = await Promise.all([
      this.prisma.orderItem.groupBy({
        by: ['servedByUserId'],
        where: {
          servedByUserId: { not: null },
          order: { storeId, createdAt: { gte: defaultStart, lte: end } },
        },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<{ userId: string; tables: number }[]>(Prisma.sql`
        SELECT oi."servedByUserId" AS "userId", COUNT(DISTINCT o."tableId")::int AS tables
        FROM order_items oi
        JOIN orders o ON o.id = oi."orderId"
        WHERE oi."servedByUserId" IS NOT NULL
          AND o."storeId" = ${storeId}::uuid
          AND o."createdAt" >= ${defaultStart}
          AND o."createdAt" <= ${end}
        GROUP BY oi."servedByUserId"
      `),
      this.prisma.orderReview.groupBy({
        by: ['staffId'],
        where: { staffId: { not: null }, storeId, createdAt: { gte: defaultStart, lte: end } },
        _avg: { rating: true },
        _count: { _all: true },
      }),
    ]);

    const userIds = new Set<string>();
    servedRows.forEach((r) => r.servedByUserId && userIds.add(r.servedByUserId));
    reviewRows.forEach((r) => r.staffId && userIds.add(r.staffId));

    const users = await this.prisma.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const tableOf = new Map(tableRows.map((r) => [r.userId, r.tables]));

    const staff = Array.from(userIds)
      .map((id) => {
        const served = servedRows.find((r) => r.servedByUserId === id);
        const review = reviewRows.find((r) => r.staffId === id);
        return {
          userId: id,
          name: nameOf.get(id) ?? '—',
          servedItems: served?._count._all ?? 0,
          servedTables: tableOf.get(id) ?? 0,
          reviewCount: review?._count._all ?? 0,
          avgRating: review?._avg.rating ? Math.round(review._avg.rating * 10) / 10 : null,
        };
      })
      .sort((a, b) => b.servedItems - a.servedItems);

    return {
      from: from ?? dayRange().label,
      to: to ?? from ?? dayRange().label,
      staff,
    };
  }
}
