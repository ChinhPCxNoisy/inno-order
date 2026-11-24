import { OrderStatus } from '@prisma/client';

/** Don chua thanh toan - duoc thanh toan */
export const PAYABLE: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
];

/** Don dang mo cua ban (chua thanh toan, chua huy) */
export const OPEN_ORDER: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
];

/** Don da dong: khong duoc huy mon/huy don/thanh toan nua */
export const CLOSED_ORDER: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
  OrderStatus.PARTIAL_REFUND,
];
