import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context';
import { fmtMoney } from '../format';
import { ORDER_SOURCE } from '../labels';
import { connectRealtime, type OrderEvent } from '../realtime';
import { useToast } from '../ui';

let audioCtx: AudioContext | null = null;

/** Beep 2 thanh cho don moi (FR-KDS-07) — bo qua neu browser cha mo phe audio */
function beepNewOrder() {
  try {
    audioCtx = audioCtx ?? new AudioContext();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = t0 + i * 0.18;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    });
  } catch {
    // audio bi khoa (tab chua co user interaction) — khong anh huong UI
  }
}

/**
 * Pop thong bao don thoi gian thuc (FR-NTF-01): don moi (beep + toast co
 * nut "Xem don"), don san sang, don da thanh toan, don bi huy.
 * Chi hien thi su kien cua store dang chon o thanh tren.
 */
export default function OrderNotifier() {
  const { activeStoreId } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const storeRef = useRef(activeStoreId);
  storeRef.current = activeStoreId;

  useEffect(() => {
    return connectRealtime((e: OrderEvent) => {
      if (e.type === 'ping') return;
      const storeId = storeRef.current;
      if (!storeId || e.storeId !== storeId) return;

      if (e.type === 'order.created') {
        beepNewOrder();
        const src = e.source ? ` · ${ORDER_SOURCE[e.source] ?? e.source}` : '';
        toast(`Đơn mới #${e.orderNumber} — Bàn ${e.tableCode || '?'}${src}`, 'info', {
          action: { label: 'Xem đơn', onClick: () => navigate('/orders') },
          ttl: 10000,
        });
        return;
      }

      if (e.type === 'table.call') {
        beepNewOrder();
        toast(`🔔 Bàn ${e.tableCode || '?'} cần hỗ trợ`, 'info', {
          action: { label: 'Xem bàn', onClick: () => navigate('/service') },
          ttl: 15000,
        });
        return;
      }
      if (e.type === 'table.call_resolved') return;

      if (e.status === 'READY') {
        toast(`Đơn #${e.orderNumber} đã sẵn sàng — Bàn ${e.tableCode || '?'}`, 'info', {
          action: { label: 'Xem đơn', onClick: () => navigate('/orders') },
        });
      } else if (e.status === 'COMPLETED') {
        toast(`Đơn #${e.orderNumber} đã thanh toán (${fmtMoney(e.totalAmount)})`);
      } else if (e.status === 'CANCELLED') {
        toast(`Đơn #${e.orderNumber} — Bàn ${e.tableCode || '?'} đã bị huỷ`, 'err');
      }
    });
  }, [navigate, toast]);

  return null;
}
