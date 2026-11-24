import type { BillData, CancelTicketData, KitchenTicketData } from './document/types.js';

/** Du lieu mau (dung cho `npm run sample`, mock-server --seed va kiem thu) */
export function buildSampleData(): { kitchen: KitchenTicketData; cancel: CancelTicketData; bill: BillData } {
  const kitchen: KitchenTicketData = {
    stationLabel: 'Bếp',
    tableCode: 'B05',
    areaName: 'Trong nhà',
    orderNumber: 1042,
    round: 2,
    createdAt: '2026-11-12T12:42:00.000Z', // 19:42 gio Viet Nam
    source: 'QR',
    items: [
      { name: 'Lẩu Thái hải sản', quantity: 2, options: [{ group: 'Cay', value: 'Vừa' }], note: 'ít hành, không ngò' },
      { name: 'Bánh mì thịt nướng', quantity: 1, note: 'không rau' },
      { name: 'Cơm chiên dương châu', quantity: 3 },
    ],
    orderNote: 'Khách dị ứng đậu phộng',
  };
  const cancel: CancelTicketData = {
    stationLabel: 'Bar',
    tableCode: 'B05',
    orderNumber: 1042,
    createdAt: '2026-11-12T12:50:00.000Z',
    items: [{ name: 'Cà phê sữa đá', quantity: 1 }],
    reason: 'Khách đổi món',
    staffName: 'Nguyễn Thị Hương',
  };
  const bill: BillData = {
    store: { name: 'Quán Nhà Hương', address: '12 Nguyễn Huệ, Quận 1, TP.HCM', phone: '0901 234 567' },
    billNo: 'HD-000123',
    tableCode: 'B05',
    openedAt: '2026-11-12T11:30:00.000Z',
    closedAt: '2026-11-12T13:05:00.000Z',
    cashier: 'Lê Văn Minh',
    orders: [
      {
        orderNumber: 1040,
        createdAt: '2026-11-12T11:30:00.000Z',
        items: [
          { name: 'Lẩu Thái hải sản', quantity: 2, unitPrice: 250000, total: 500000, options: [{ group: 'Cay', value: 'Vừa' }] },
          { name: 'Cà phê sữa đá', quantity: 3, unitPrice: 29000, total: 87000 },
        ],
      },
      {
        orderNumber: 1042,
        round: 2,
        createdAt: '2026-11-12T12:42:00.000Z',
        items: [{ name: 'Bánh mì thịt nướng', quantity: 1, unitPrice: 35000, total: 35000, note: 'không rau' }],
      },
    ],
    subtotal: 622000,
    discounts: [{ label: 'Giảm giá (khách quen)', amount: 62000 }],
    vatPercent: 8,
    vatAmount: 44800,
    total: 604800,
    payments: [{ method: 'Tiền mặt', amount: 604800, tendered: 700000, change: 95200 }],
    qr: 'https://innoorder.example/bill/HD-000123',
  };
  return { kitchen, cancel, bill };
}
