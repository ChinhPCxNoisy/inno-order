import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { roundVnd } from '../common/utils/money';
import { calcLineTotal } from '../common/utils/totals';

export interface PricingMenuItem {
  id: string;
  name: string;
  price: Prisma.Decimal | number;
  active: boolean;
  category: { active: boolean };
  options: { groupName: string; optionName: string; extraPrice: Prisma.Decimal | number; isRequired: boolean }[];
}

export interface PricingInputItem {
  menuItemId: string;
  quantity: number;
  note?: string;
  options?: { groupName: string; optionName: string }[];
}

export interface PricedLine {
  menuItem: PricingMenuItem;
  quantity: number;
  note?: string;
  /** (gia + phu thu option) x so luong, da lam tron dong */
  lineTotal: number;
  options: { optionGroup: string; optionValue: string; extraPrice: Prisma.Decimal | number }[];
}

/**
 * Kiem tra mon/tuy chon va TINH TIEN tung dong. Dung chung cho tao don va bao gia cong khai de
 * hai ben luon ra cung mot con so. Phu thu option nhan voi so luong (2 x (55.000 + 10.000) = 130.000).
 */
export function priceItems(menuById: Map<string, PricingMenuItem>, items: PricingInputItem[]) {
  const lines: PricedLine[] = [];
  let subtotal = 0;
  for (const it of items) {
    const mi = menuById.get(it.menuItemId);
    if (!mi) {
      throw new BadRequestException('Có món không còn trong thực đơn của quán, vui lòng tải lại thực đơn');
    }
    if (!mi.active || !mi.category.active) {
      throw new BadRequestException(`Món "${mi.name}" đã hết hàng, vui lòng bỏ món này khỏi giỏ`);
    }
    const chosenOptions = it.options ?? [];

    // Tung tuy chon gui len phai co that trong mon
    for (const o of chosenOptions) {
      const exists = mi.options.some((x) => x.groupName === o.groupName && x.optionName === o.optionName);
      if (!exists) {
        throw new BadRequestException(
          `Tùy chọn "${o.optionName}" (${o.groupName}) của món "${mi.name}" không còn tồn tại, vui lòng chọn lại`,
        );
      }
    }
    // Moi nhom chi duoc chon 1 (UI khach chon 1 lua chon / nhom)
    const countByGroup = new Map<string, number>();
    for (const o of chosenOptions) countByGroup.set(o.groupName, (countByGroup.get(o.groupName) ?? 0) + 1);
    for (const [g, n] of countByGroup) {
      if (n > 1) {
        throw new BadRequestException(`Nhóm "${g}" của món "${mi.name}" chỉ được chọn 1 tùy chọn`);
      }
    }
    // Moi nhom tuy chon bat buoc phai chon
    const requiredGroups = Array.from(new Set(mi.options.filter((o) => o.isRequired).map((o) => o.groupName)));
    for (const g of requiredGroups) {
      if (!countByGroup.has(g)) throw new BadRequestException(`Vui lòng chọn ${g} cho món ${mi.name}`);
    }

    const options = chosenOptions.map((o) => {
      const mo = mi.options.find((x) => x.groupName === o.groupName && x.optionName === o.optionName)!;
      return { optionGroup: mo.groupName, optionValue: mo.optionName, extraPrice: mo.extraPrice };
    });
    const lineTotal = calcLineTotal(
      mi.price,
      options.map((o) => o.extraPrice),
      it.quantity,
    );
    subtotal += lineTotal;
    lines.push({ menuItem: mi, quantity: it.quantity, note: it.note, lineTotal, options });
  }
  return { lines, subtotal: roundVnd(subtotal) };
}
