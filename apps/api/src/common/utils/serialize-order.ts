import { Order, OrderItem, OrderItemOption } from '@prisma/client';
import { money } from './money';

export type OrderWithItems = Order & { items: (OrderItem & { options: OrderItemOption[] })[] };

/** Chuan hoa order (co items) thanh JSON co so thap thuong thuc */
export function serializeOrder(order: OrderWithItems) {
  return {
    id: order.id,
    storeId: order.storeId,
    tableId: order.tableId,
    orderNumber: order.orderNumber,
    status: order.status,
    subtotal: money(order.subtotal),
    discountAmount: money(order.discountAmount),
    vatAmount: money(order.vatAmount),
    totalAmount: money(order.totalAmount),
    customerNote: order.customerNote,
    source: order.source,
    customerId: order.customerId,
    sessionId: order.sessionId,
    billId: order.billId,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    completedAt: order.completedAt,
    items: order.items.map(serializeItem),
  };
}

export function serializeItem(item: OrderItem & { options?: OrderItemOption[] }) {
  return {
    id: item.id,
    menuItemId: item.menuItemId,
    name: item.nameSnapshot,
    price: money(item.priceSnapshot),
    quantity: item.quantity,
    totalAmount: money(item.totalAmount),
    note: item.note,
    status: item.status,
    createdAt: item.createdAt,
    options: (item.options ?? []).map((o) => ({
      optionGroup: o.optionGroup,
      optionValue: o.optionValue,
      extraPrice: money(o.extraPrice),
    })),
  };
}
