import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';
import { useApp } from '../context';
import { JOB_TYPE, PRINTER_DETAIL, PRINTER_STATION } from '../labels';
import { useRealtime } from '../realtime';
import type { PrintHealth, PrintJob } from '../types';
import { useToast } from '../ui';

const RETRY_ROLES = ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'CASHIER'];

/**
 * Canh bao in thoi gian thuc tren toan admin (FR-NTF-04): banner co dinh khi co lenh in loi /
 * agent mat ket noi, va toast khong tu tat nhanh cho print.failed / print.agent_offline / print.recovered.
 * Banner dua tren GET printing/health (lam moi khi co su kien print.* va moi 30 giay).
 */
export default function PrintAlerts() {
  const { activeStore, me } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const sid = activeStore?.id ?? null;
  const canRetry = RETRY_ROLES.includes(me?.role ?? '');
  const [health, setHealth] = useState<PrintHealth | null>(null);
  const [retrying, setRetrying] = useState(false);
  const lastToast = useRef<Record<string, number>>({});
  const retried = useRef<Set<string>>(new Set()); // chong bam doi "Thu lai": moi lenh chi gui mot lan

  const load = async () => {
    if (!sid) return;
    try {
      setHealth(await api<PrintHealth>(`/stores/${sid}/printing/health`));
    } catch {
      /* khong chan giao dien neu khong lay duoc */
    }
  };
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    setHealth(null);
    void loadRef.current();
    const t = setInterval(() => void loadRef.current(), 30000);
    const onChanged = () => void loadRef.current();
    window.addEventListener('innoorder:print-changed', onChanged);
    return () => {
      clearInterval(t);
      window.removeEventListener('innoorder:print-changed', onChanged);
    };
  }, [sid]);

  const retry = async (jobId: string) => {
    if (retried.current.has(jobId)) {
      toast('Lệnh này đã được thử lại, đang chờ in. Xem mục Máy in & hàng đợi.', 'info');
      return;
    }
    retried.current.add(jobId);
    toast('Đang gửi lệnh in lại...', 'info');
    try {
      const r = await api<{ status: string; failedReason?: string | null }>(`/stores/${sid}/print-jobs/${jobId}/retry`, { method: 'POST' });
      if (r.status === 'FAILED') toast(`Thử lại chưa được: ${r.failedReason ?? 'máy in lỗi'}`, 'err', { ttl: 10000 });
      else toast('Đã tạo lệnh in lại, đang chờ agent');
    } catch (e) {
      retried.current.delete(jobId);
      toast(errMsg(e), 'err');
    }
    void load();
  };

  useRealtime(sid, (e) => {
    if (e.type === 'payment.needs_review') {
      if (!canRetry) return;
      const d = (e.data ?? {}) as Record<string, number | undefined>;
      toast(`Có giao dịch ngân hàng cần xử lý${d.amount ? `: ${d.amount.toLocaleString('vi-VN')}đ` : ''}`, 'info', {
        ttl: 20000,
        action: { label: 'Xem giao dịch', onClick: () => navigate('/payments') },
      });
      return;
    }
    if (!e.type.startsWith('print.')) return;
    void load();
    const d = (e.data ?? {}) as Record<string, string | undefined>;
    // chong lap: cung loai + cung doi tuong trong 3 giay
    const key = `${e.type}:${d.jobId ?? d.agentName ?? d.printerName ?? ''}`;
    const now = Date.now();
    if (now - (lastToast.current[key] ?? 0) < 3000) return;
    lastToast.current[key] = now;

    const where = [e.tableCode ? `Bàn ${e.tableCode}` : '', e.orderNumber ? `Đơn #${e.orderNumber}` : ''].filter(Boolean).join(' · ');
    if (e.type === 'print.failed') {
      const what = JOB_TYPE[d.jobType ?? ''] ?? 'Phiếu in';
      const station = d.station ? ` (${PRINTER_STATION[d.station] ?? d.station})` : '';
      toast(`Chưa in được ${what.toLowerCase()}${station}${where ? ` · ${where}` : ''}${d.reason ? ` — ${d.reason}` : ''}`, 'err', {
        ttl: 30000,
        action: { label: 'Xem lệnh in', onClick: () => navigate('/printers?status=FAILED') },
        action2: canRetry && d.jobId ? { label: 'Thử lại', onClick: () => void retry(d.jobId!) } : undefined,
      });
    } else if (e.type === 'print.agent_offline') {
      toast(`Print Agent “${d.agentName ?? ''}” mất kết nối, phiếu in đang chờ trong hàng đợi`, 'err', {
        ttl: 30000,
        action: { label: 'Xem máy in', onClick: () => navigate('/printers') },
      });
    } else if (e.type === 'print.printer_error') {
      toast(`Máy in “${d.printerName ?? ''}”: ${PRINTER_DETAIL[d.status ?? ''] ?? PRINTER_DETAIL[d.detail ?? ''] ?? d.detail ?? 'báo lỗi'}`, 'err', {
        ttl: 20000,
        action: { label: 'Xem máy in', onClick: () => navigate('/printers') },
      });
    } else if (e.type === 'print.recovered') {
      toast(d.scope === 'agent' ? `Print Agent “${d.agentName ?? ''}” đã kết nối lại, phiếu chờ đang được in bù` : `Máy in “${d.printerName ?? ''}” đã hoạt động lại`, 'ok', { ttl: 8000 });
    }
  });

  const retryAll = async () => {
    if (retrying || !sid) return;
    setRetrying(true);
    try {
      const failed = await api<PrintJob[]>(`/stores/${sid}/print-jobs?status=FAILED&limit=100`);
      const todo = failed.filter((j) => !j.acknowledgedAt && Date.now() - new Date(j.createdAt).getTime() < 24 * 3600_000);
      let ok = 0;
      for (const j of todo) {
        try {
          await api(`/stores/${sid}/print-jobs/${j.id}/retry`, { method: 'POST' });
          ok++;
        } catch {
          /* bo qua lenh loi le */
        }
      }
      toast(`Đã tạo lại ${ok}/${todo.length} lệnh in`);
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setRetrying(false);
      void load();
    }
  };

  if (!health || health.mode !== 'AGENT') return null;
  // agent moi tao, chua tung ket noi (lastSeenAt null) chua phai su co
  const offline = health.agents.filter((a) => !a.online && a.lastSeenAt);
  const errPrinters = health.printers.filter((p) => p.enabled && p.status === 'ERROR');
  if (health.failedJobs === 0 && offline.length === 0 && errPrinters.length === 0) return null;

  const parts: string[] = [];
  if (health.failedJobs > 0) parts.push(`${health.failedJobs} lệnh in lỗi chưa xử lý`);
  if (offline.length > 0) parts.push(`Print Agent ${offline.map((a) => `“${a.name}”`).join(', ')} mất kết nối${health.pendingJobs > 0 ? ` (${health.pendingJobs} phiếu đang chờ)` : ''}`);
  if (errPrinters.length > 0) parts.push(errPrinters.map((p) => `Máy in ${p.name}: ${PRINTER_DETAIL[p.detail ?? ''] ?? p.detail ?? 'báo lỗi'}`).join('; '));

  return (
    <div className="print-banner" role="alert">
      <span>
        <b>Máy in cần chú ý:</b> {parts.join(' · ')}.
      </span>
      {canRetry && (
        <div className="actions">
          <Link className="button tiny" to={health.failedJobs > 0 ? '/printers?status=FAILED' : '/printers'}>
            Xem lệnh in
          </Link>
          {health.failedJobs > 0 && (
            <button className="button tiny primary" disabled={retrying} onClick={retryAll}>
              {retrying ? 'Đang thử lại...' : 'Thử lại tất cả'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
