import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errMsg } from '../api';
import { useApp } from '../context';
import { fmtAgo, fmtDateTime } from '../format';
import {
  JOB_STATUS,
  JOB_TYPE,
  PAPER_SIZE,
  PRINTER_CONNECTION,
  PRINTER_DETAIL,
  PRINTER_ENCODING,
  PRINTER_STATION,
  PRINTER_STATUS,
} from '../labels';
import { useRealtimeRefresh } from '../realtime';
import type { AgentConfig, PrintAgent, PrintHealth, PrintJob, Printer } from '../types';
import { useFetch } from '../useFetch';
import { Badge, ConfirmModal, Empty, Field, Icon, Loading, Modal, useToast } from '../ui';

const JOB_FILTERS: { label: string; value: string }[] = [
  { label: 'Tất cả', value: '' },
  { label: 'Chờ in', value: 'PENDING' },
  { label: 'Đang gửi', value: 'SENT' },
  { label: 'Đã gửi tới máy in', value: 'PRINTED' },
  { label: 'Lỗi', value: 'FAILED' },
  { label: 'Đã huỷ', value: 'CANCELLED' },
];

/** Cot goi y theo kho giay (agent dung 384 / 576 diem: 32 / 48 cot) */
const COLS_BY_PAPER: Record<string, number> = { P58: 32, P80: 48 };

function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ================= Token + huong dan cai agent =================

function TokenModal({ agentName, token, config, rotated, onClose }: { agentName: string; token: string; config: AgentConfig; rotated: boolean; onClose: () => void }) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      toast('Đã copy token');
    } catch {
      toast('Không thể copy, hãy bôi đen và sao chép thủ công', 'err');
    }
  };
  return (
    <Modal
      title={rotated ? `Token mới của “${agentName}”` : `Đã tạo Print Agent “${agentName}”`}
      subtitle="Token chỉ hiện MỘT LẦN, đóng hộp thoại này là không xem lại được"
      onClose={onClose}
      width={600}
      footer={
        <>
          <label className="check-row" style={{ padding: 0 }}>
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            Tôi đã tải/lưu tệp cấu hình
          </label>
          <button className="button primary" disabled={!saved} onClick={onClose}>
            Xong
          </button>
        </>
      }
    >
      <div className="notice warning" style={{ lineHeight: 1.7 }}>
        Giữ kín token như mật khẩu. {rotated && 'Token cũ đã hết hiệu lực: agent đang chạy sẽ mất kết nối cho tới khi dùng tệp cấu hình mới.'} Lộ token thì thu hồi agent rồi tạo lại.
      </div>
      <div className="token-box">
        <span>{token}</span>
        <button className="button tiny" onClick={copy}>
          <Icon name="copy" size={13} /> Copy
        </button>
      </div>
      <button
        className="button primary"
        onClick={() => {
          downloadJson('agent.config.json', config);
          setSaved(true);
        }}
      >
        <Icon name="download" /> Tải agent.config.json (đã điền sẵn)
      </button>
      <span className="option-label">Cài agent cho quán trong 3 bước</span>
      <ol className="setup-steps">
        <li>
          Trên máy tính quầy (Windows, luôn bật, cùng mạng với máy in) cài Node.js 22 trở lên, đặt thư mục <code>print-agent</code> của InnoOrder rồi chạy <code>npm install</code>.
        </li>
        <li>
          Lưu tệp vừa tải thành <code>agent.config.json</code> trong thư mục agent. Mở tệp, sửa <code>host</code> của từng máy in thành IP máy in trong mạng nội bộ (ví dụ <code>192.168.1.50</code>) và kiểm tra <code>serverUrl</code>.
        </li>
        <li>
          Chạy <code>npm start</code> để thử, sau đó chạy nền: <code>scripts\install-task-windows.ps1</code> (PowerShell quyền Administrator). Khoảng 30 giây sau thẻ agent chuyển “Đang kết nối”; vào từng máy in bấm “In thử”.
        </li>
      </ol>
      <p className="small muted" style={{ marginTop: 10 }}>
        Tệp cấu hình chỉ chứa các máy in đã gán cho agent này. Thêm hoặc đổi máy in sau này: bấm “Cấp lại token” để tải tệp mới.
      </p>
    </Modal>
  );
}

// ================= Form may in =================

function PrinterFormModal({
  initial,
  agents,
  onClose,
  onSaved,
}: {
  initial: Printer | null;
  agents: PrintAgent[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { activeStore } = useApp();
  const isEdit = !!initial;
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    station: initial?.station ?? 'KITCHEN',
    connection: initial?.connection ?? 'LAN',
    host: initial?.host ?? '',
    port: initial?.port ? String(initial.port) : '9100',
    deviceName: initial?.deviceName ?? '',
    paperSize: initial?.paperSize ?? 'P80',
    charsPerLine: initial?.charsPerLine ? String(initial.charsPerLine) : '48',
    cutAtEnd: initial?.cutAtEnd ?? true,
    agentId: initial?.agentId ?? '',
    enabled: initial?.enabled ?? true,
    priority: String(initial?.priority ?? 0),
    encoding: initial?.encoding ?? 'RASTER',
    codePage: initial?.codePage ? String(initial.codePage) : '',
    openDrawer: initial?.openDrawer ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const activeAgents = agents.filter((a) => !a.revokedAt);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      if (!form.name.trim()) throw new Error('Thiếu tên máy in');
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        station: form.station,
        connection: form.connection,
        host: form.host.trim() || null,
        port: form.port ? parseInt(form.port) : 9100,
        deviceName: form.deviceName.trim() || null,
        paperSize: form.paperSize,
        charsPerLine: form.charsPerLine ? parseInt(form.charsPerLine) : COLS_BY_PAPER[form.paperSize],
        cutAtEnd: form.cutAtEnd,
        enabled: form.enabled,
        priority: parseInt(form.priority) || 0,
        encoding: form.encoding,
        openDrawer: form.openDrawer,
      };
      if (form.encoding === 'CP1258') body.codePage = form.codePage ? parseInt(form.codePage) : null;
      else if (isEdit) body.codePage = null;
      if (isEdit) {
        body.agentId = form.agentId || null;
        await api(`/stores/${activeStore!.id}/printers/${initial!.id}`, { method: 'PATCH', body });
        toast('Đã cập nhật máy in');
      } else {
        // tao moi: bo cac truong null khong hop le o DTO tao
        if (!body.host) delete body.host;
        if (!body.deviceName) delete body.deviceName;
        if (form.agentId) body.agentId = form.agentId;
        await api(`/stores/${activeStore!.id}/printers`, { method: 'POST', body });
        toast('Đã thêm máy in');
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? `Sửa máy in: ${initial!.name}` : 'Thêm máy in'}
      subtitle="Máy in hóa đơn / phiếu bếp 58mm hoặc 80mm"
      onClose={onClose}
      width={600}
      footer={
        <>
          <button className="button" onClick={onClose}>
            Huỷ
          </button>
          <button className="button primary" disabled={busy} onClick={submit}>
            {busy ? 'Đang lưu...' : 'Lưu'}
          </button>
        </>
      }
    >
      <Field label="Tên máy" required>
        <input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus placeholder="vd: Máy in bếp 1" />
      </Field>
      <div className="form-grid">
        <Field label="Vị trí / khu in" hint="Phiếu của món thuộc khu Bếp / Bar được gửi tới máy in cùng khu">
          <select value={form.station} onChange={(e) => set('station', e.target.value)}>
            {Object.entries(PRINTER_STATION).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kết nối">
          <select value={form.connection} onChange={(e) => set('connection', e.target.value)}>
            {Object.entries(PRINTER_CONNECTION).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {form.connection !== 'USB' ? (
        <div className="form-grid">
          <Field label="IP / Host (mạng nội bộ)">
            <input value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="192.168.1.50" />
          </Field>
          <Field label="Cổng (port)">
            <input type="number" min={1} max={65535} value={form.port} onChange={(e) => set('port', e.target.value)} />
          </Field>
        </div>
      ) : (
        <Field label="Tên thiết bị (USB)" hint="Agent hiện chỉ in qua mạng LAN; USB cần chia sẻ máy in (chưa hỗ trợ)">
          <input value={form.deviceName} onChange={(e) => set('deviceName', e.target.value)} placeholder="vd: EPSON TM-T88III" />
        </Field>
      )}
      <div className="form-grid">
        <Field label="Khổ giấy">
          <select
            value={form.paperSize}
            onChange={(e) => {
              const p = e.target.value;
              // doi kho giay: dat lai so cot goi y neu dang la gia tri goi y cua kho cu
              setForm((f) => ({
                ...f,
                paperSize: p,
                charsPerLine: Object.values(COLS_BY_PAPER).includes(Number(f.charsPerLine)) || f.charsPerLine === '42' ? String(COLS_BY_PAPER[p]) : f.charsPerLine,
              }));
            }}
          >
            {Object.entries(PAPER_SIZE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Số chữ / dòng" hint="58mm ≈ 32, 80mm ≈ 48">
          <input type="number" min={20} max={80} value={form.charsPerLine} onChange={(e) => set('charsPerLine', e.target.value)} />
        </Field>
      </div>
      <div className="form-grid">
        <Field label="Kiểu in chữ tiếng Việt" hint={PRINTER_ENCODING[form.encoding]?.hint}>
          <select value={form.encoding} onChange={(e) => set('encoding', e.target.value)}>
            {Object.entries(PRINTER_ENCODING).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        {form.encoding === 'CP1258' ? (
          <Field label="Số bảng mã (ESC t)" hint="Tuỳ model máy, mặc định agent: 52. Kiểm tra bằng In thử">
            <input type="number" min={0} max={255} value={form.codePage} onChange={(e) => set('codePage', e.target.value)} placeholder="52" />
          </Field>
        ) : (
          <Field label="Ưu tiên trong cùng khu" hint="Số nhỏ hơn được dùng trước (0-100)">
            <input type="number" min={0} max={100} value={form.priority} onChange={(e) => set('priority', e.target.value)} />
          </Field>
        )}
      </div>
      {form.encoding === 'CP1258' && (
        <Field label="Ưu tiên trong cùng khu" hint="Số nhỏ hơn được dùng trước (0-100)">
          <input type="number" min={0} max={100} value={form.priority} onChange={(e) => set('priority', e.target.value)} />
        </Field>
      )}
      <Field label="Print Agent phụ trách" hint={activeAgents.length === 0 ? 'Chưa có Print Agent: tạo agent trước để in giấy' : 'Máy in chỉ in khi gán cho một agent đang chạy'}>
        <select value={form.agentId} onChange={(e) => set('agentId', e.target.value)}>
          <option value="">— Chưa gán agent —</option>
          {activeAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.online ? ' (đang kết nối)' : ' (mất kết nối)'}
            </option>
          ))}
        </select>
      </Field>
      <label className="check-row">
        <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        Đang bật (nhận lệnh in)
      </label>
      <label className="check-row">
        <input type="checkbox" checked={form.cutAtEnd} onChange={(e) => set('cutAtEnd', e.target.checked)} />
        Cắt giấy cuối phiếu
      </label>
      <label className="check-row">
        <input type="checkbox" checked={form.openDrawer} onChange={(e) => set('openDrawer', e.target.checked)} />
        Có két tiền nối vào máy in này (mở két khi thu tiền mặt)
      </label>
      {err && <div className="form-error">{err}</div>}
    </Modal>
  );
}

// ================= Trang =================

export default function Printers() {
  const { activeStore, me } = useApp();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const role = me?.role ?? '';
  const isOwner = role === 'OWNER' || role === 'SUPER_ADMIN';
  const canManage = isOwner || role === 'MANAGER';
  const sid = activeStore!.id;

  const [modal, setModal] = useState<{ printer: Printer | null } | null>(null);
  const [agentModal, setAgentModal] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentErr, setAgentErr] = useState<string | null>(null);
  const [token, setToken] = useState<{ name: string; token: string; config: AgentConfig; rotated: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'rotate' | 'revoke' | 'cancel'; agent?: PrintAgent; job?: PrintJob } | null>(null);
  const [viewJob, setViewJob] = useState<PrintJob | null>(null);
  const [testBusy, setTestBusy] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(params.get('status') ?? '');
  const [printerFilter, setPrinterFilter] = useState('');

  // dieu huong tu banner/toast (?status=FAILED) khi dang o san trang nay
  useEffect(() => {
    const s = params.get('status');
    if (s) setStatusFilter(s);
  }, [params]);

  const printers = useFetch<Printer[]>(() => api(`/stores/${sid}/printers`), [sid]);
  const agents = useFetch<PrintAgent[]>(() => (canManage ? api(`/stores/${sid}/print-agents`) : Promise.resolve([])), [sid, canManage]);
  const health = useFetch<PrintHealth>(() => api(`/stores/${sid}/printing/health`), [sid]);
  const jobs = useFetch<PrintJob[]>(
    () => {
      const q = new URLSearchParams({ limit: '100' });
      if (statusFilter) q.set('status', statusFilter);
      if (printerFilter) q.set('printerId', printerFilter);
      return api(`/stores/${sid}/print-jobs?${q.toString()}`);
    },
    [sid, statusFilter, printerFilter],
  );

  const refreshAll = () => {
    // bao cho banner toan admin (PrintAlerts) lam moi ngay thay vi doi chu ky 30 giay
    window.dispatchEvent(new Event('innoorder:print-changed'));
    printers.refresh();
    agents.refresh();
    health.refresh();
    jobs.refresh();
  };
  const refreshRef = useRef(refreshAll);
  refreshRef.current = refreshAll;
  useRealtimeRefresh(sid, ['print.failed', 'print.recovered', 'print.agent_offline', 'print.printer_error'], () => refreshRef.current(), 300);
  useEffect(() => {
    const t = setInterval(() => refreshRef.current(), 5000);
    return () => clearInterval(t);
  }, []);

  const agentOf = (id?: string | null) => (agents.data ?? []).find((a) => a.id === id);

  /** Theo doi job (in thu / mo ket) toi khi co ket qua cuoi hoac het 25 giay */
  const followJob = async (jobId: string, printerId: string, what: string) => {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const list = await api<PrintJob[]>(`/stores/${sid}/print-jobs?printerId=${printerId}&limit=20`);
        const j = list.find((x) => x.id === jobId);
        refreshAll();
        if (!j) return;
        if (j.status === 'PRINTED') return toast(`${what}: máy in đã nhận lệnh thành công`);
        if (j.status === 'FAILED' || j.status === 'CANCELLED') {
          return toast(`${what} thất bại: ${j.lastError ?? j.failedReason ?? 'không rõ lý do'}`, 'err', { ttl: 12000 });
        }
      } catch {
        return;
      }
    }
    toast(`${what}: chưa có kết quả, kiểm tra Print Agent có đang chạy không`, 'info', { ttl: 8000 });
  };

  const testPrint = async (p: Printer) => {
    setTestBusy(p.id);
    try {
      const r = await api<{ jobId: string; status: string }>(`/stores/${sid}/printers/${p.id}/test`, { method: 'POST' });
      toast(r.status === 'FAILED' ? 'Không tạo được lệnh in thử' : `Đã tạo lệnh in thử cho ${p.name}, đang chờ agent...`, r.status === 'FAILED' ? 'err' : 'ok');
      refreshAll();
      void followJob(r.jobId, p.id, 'In thử');
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setTestBusy(null);
    }
  };

  const openDrawer = async (p: Printer) => {
    setTestBusy(`d:${p.id}`);
    try {
      const r = await api<{ jobId: string; status: string }>(`/stores/${sid}/printers/${p.id}/open-drawer`, { method: 'POST' });
      toast(`Đã gửi lệnh mở két qua ${p.name}`);
      refreshAll();
      void followJob(r.jobId, p.id, 'Mở két');
    } catch (e) {
      toast(errMsg(e), 'err');
    } finally {
      setTestBusy(null);
    }
  };

  const createAgent = async () => {
    if (!agentName.trim() || agentBusy) return;
    setAgentBusy(true);
    setAgentErr(null);
    try {
      const r = await api<{ agent: { id: string; name: string }; token: string; config: AgentConfig }>(`/stores/${sid}/print-agents`, {
        method: 'POST',
        body: { name: agentName.trim() },
      });
      setAgentModal(false);
      setAgentName('');
      setToken({ name: r.agent.name, token: r.token, config: r.config, rotated: false });
      refreshAll();
    } catch (e) {
      setAgentErr(errMsg(e));
    } finally {
      setAgentBusy(false);
    }
  };

  const rotate = async (a: PrintAgent) => {
    try {
      const r = await api<{ token: string; config: AgentConfig }>(`/stores/${sid}/print-agents/${a.id}/rotate-token`, { method: 'POST' });
      setConfirm(null);
      setToken({ name: a.name, token: r.token, config: r.config, rotated: true });
      refreshAll();
    } catch (e) {
      toast(errMsg(e), 'err');
      setConfirm(null);
    }
  };

  const revoke = async (a: PrintAgent) => {
    try {
      await api(`/stores/${sid}/print-agents/${a.id}`, { method: 'DELETE' });
      toast(`Đã thu hồi Print Agent “${a.name}”`);
      setConfirm(null);
      refreshAll();
    } catch (e) {
      toast(errMsg(e), 'err');
      setConfirm(null);
    }
  };

  const downloadConfig = async (a: PrintAgent) => {
    try {
      const cfg = await api<AgentConfig>(`/stores/${sid}/print-agents/${a.id}/config`);
      downloadJson('agent.config.json', cfg);
      toast('Đã tải cấu hình. Dán token đã lưu vào trường agentToken (hoặc dùng “Cấp lại token”).', 'info', { ttl: 9000 });
    } catch (e) {
      toast(errMsg(e), 'err');
    }
  };

  const jobAction = async (j: PrintJob, act: 'retry' | 'cancel' | 'acknowledge') => {
    if (rowBusy) return;
    setRowBusy(j.id + act);
    try {
      const r = await api<{ jobId?: string; status?: string; failedReason?: string | null }>(`/stores/${sid}/print-jobs/${j.id}/${act}`, { method: 'POST' });
      if (act === 'retry') {
        if (r.status === 'FAILED') toast(`Thử lại thất bại: ${r.failedReason ?? 'máy in lỗi'}`, 'err');
        else toast('Đã tạo lệnh in mới, đang chờ agent');
      } else if (act === 'cancel') toast('Đã huỷ lệnh in');
      else toast('Đã ghi nhận “đã báo bếp bằng miệng”');
      refreshAll();
    } catch (e) {
      toast(errMsg(e), 'err');
      refreshAll();
    } finally {
      setRowBusy(null);
      setConfirm(null);
    }
  };

  if (printers.loading || health.loading) return <Loading />;
  if (printers.error) return <div className="alert-strip">{printers.error}</div>;

  const h = health.data;
  const agentList = agents.data ?? [];
  const jobList = jobs.data ?? [];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Máy in & hàng đợi</h1>
          <p>Print Agent, máy in và từng lệnh in: trạng thái thật theo tín hiệu từ máy tính quầy.</p>
        </div>
        <div className="actions">
          {canManage && (
            <button className="button" onClick={() => { setAgentName(''); setAgentErr(null); setAgentModal(true); }}>
              <Icon name="plus" /> Thêm Print Agent
            </button>
          )}
          {isOwner && (
            <button className="button primary" onClick={() => setModal({ printer: null })}>
              <Icon name="plus" /> Thêm máy in
            </button>
          )}
        </div>
      </header>

      {h && (
        <div className={`print-banner${h.mode === 'KDS_ONLY' ? ' warn' : ''}`} style={h.failedJobs === 0 && h.mode === 'AGENT' ? { background: '#f2f8f3', borderColor: '#e1ece5', color: '#4f7f64' } : undefined}>
          <span>
            {h.mode === 'KDS_ONLY' ? (
              <>
                <b>Chế độ chỉ dùng màn hình bếp.</b> Chưa có Print Agent nào hoạt động nên hệ thống không tạo lệnh in giấy (đơn vẫn hiện trên màn Bếp / Bar). Tạo Print Agent và gán máy in để in phiếu.
              </>
            ) : (
              <>
                <b>Chế độ in qua Print Agent.</b> {h.agents.filter((a) => a.online).length}/{h.agents.length} agent đang kết nối · {h.pendingJobs} lệnh chờ in · {h.failedJobs} lệnh lỗi chưa xử lý (24 giờ).
              </>
            )}
          </span>
          {h.failedJobs > 0 && (
            <button className="button tiny" onClick={() => { setStatusFilter('FAILED'); setParams({}, { replace: true }); }}>
              Xem lệnh lỗi
            </button>
          )}
        </div>
      )}

      {canManage && (
        <>
          <div className="panel-head">
            <h2>Print Agent</h2>
            <span className="small muted">Chương trình chạy trên máy tính quầy, gửi phiếu tới máy in LAN</span>
          </div>
          {agents.loading ? (
            <Loading />
          ) : agentList.length === 0 ? (
            <section className="panel" style={{ marginBottom: 22 }}>
              <Empty title="Chưa có Print Agent" sub="Bấm “Thêm Print Agent” để nhận token và tệp cấu hình cài cho máy tính quầy." />
            </section>
          ) : (
            <div className="agent-grid">
              {agentList.map((a) => (
                <div key={a.id} className={`agent-card${a.revokedAt ? ' revoked' : ''}`}>
                  <h3>
                    <span className={`dot ${a.revokedAt ? '' : a.online ? 'on' : 'off'}`} />
                    {a.name}
                    <span style={{ marginLeft: 'auto' }}>
                      {a.revokedAt ? <Badge cls="grey">Đã thu hồi</Badge> : a.online ? <Badge cls="green">Đang kết nối</Badge> : <Badge cls="red">Mất kết nối</Badge>}
                    </span>
                  </h3>
                  <p>
                    {a.version ? `Phiên bản ${a.version} · ` : ''}
                    {a.lastSeenAt ? (
                      <span title={fmtDateTime(a.lastSeenAt)}>Thấy lần cuối {fmtAgo(a.lastSeenAt)}</span>
                    ) : (
                      'Chưa từng kết nối'
                    )}
                  </p>
                  <div className="small muted" style={{ marginBottom: 12 }}>
                    Máy in: {a.printers.length ? a.printers.map((p) => p.name).join(', ') : 'chưa gán máy in nào'}
                  </div>
                  {!a.revokedAt && (
                    <div className="actions">
                      <button className="button tiny" onClick={() => setConfirm({ kind: 'rotate', agent: a })}>
                        <Icon name="key" size={13} /> Cấp lại token
                      </button>
                      <button className="button tiny" onClick={() => downloadConfig(a)}>
                        <Icon name="download" size={13} /> Tải cấu hình
                      </button>
                      <button className="button tiny danger" onClick={() => setConfirm({ kind: 'revoke', agent: a })}>
                        Thu hồi
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="panel-head">
        <h2>Máy in</h2>
      </div>
      <div className="device-grid">
        {(printers.data ?? []).map((p) => {
          const stt = PRINTER_STATUS[p.status] ?? { label: p.status, cls: 'grey' };
          const ag = agentOf(p.agentId);
          return (
            <div key={p.id} className="device">
              <div className="device-top">
                <Icon name="printer" />
                <span style={{ display: 'flex', gap: 6 }}>
                  {p.enabled === false && <Badge cls="grey">Đang tắt</Badge>}
                  <Badge cls={stt.cls}>{stt.label}</Badge>
                </span>
              </div>
              <h3>{p.name}</h3>
              <p>{p.connection === 'USB' ? p.deviceName ?? 'USB' : `${p.host ?? '—'}:${p.port ?? 9100}`}</p>
              {p.statusDetail && <div className="status-note" style={{ marginTop: -8, marginBottom: 10 }}>{PRINTER_DETAIL[p.statusDetail] ?? p.statusDetail}</div>}
              {!p.agentId && <div className="status-note" style={{ marginTop: -8, marginBottom: 10 }}>Chưa gán Print Agent nên chưa in được giấy.</div>}
              <dl>
                <dt>Vị trí in</dt>
                <dd>{PRINTER_STATION[p.station] ?? p.station}</dd>
                <dt>Khổ giấy · chữ</dt>
                <dd>
                  {PAPER_SIZE[p.paperSize] ?? p.paperSize} · {PRINTER_ENCODING[p.encoding ?? 'RASTER']?.label.split(' (')[0] ?? p.encoding}
                </dd>
                <dt>Print Agent</dt>
                <dd>{p.agentId ? (ag ? `${ag.name}${ag.online ? '' : ' (mất kết nối)'}` : 'Đã gán') : '—'}</dd>
                <dt>Két tiền</dt>
                <dd>{p.openDrawer ? 'Có' : 'Không'}</dd>
                <dt>Số lệnh đã tạo</dt>
                <dd>{p._count?.jobs ?? 0}</dd>
                <dt>Thấy lần cuối</dt>
                <dd title={p.lastSeenAt ? fmtDateTime(p.lastSeenAt) : ''}>{p.lastSeenAt ? fmtAgo(p.lastSeenAt) : '—'}</dd>
              </dl>
              <div className="actions">
                <button className="button tiny" disabled={testBusy === p.id} onClick={() => testPrint(p)}>
                  {testBusy === p.id ? 'Đang gửi...' : 'In thử'}
                </button>
                {p.openDrawer && (
                  <button className="button tiny" disabled={testBusy === `d:${p.id}`} onClick={() => openDrawer(p)}>
                    Mở két
                  </button>
                )}
                {isOwner && (
                  <button className="button tiny" onClick={() => setModal({ printer: p })}>
                    <Icon name="edit" size={13} /> Sửa
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {(printers.data ?? []).length === 0 && (
        <section className="panel">
          <Empty title="Chưa có máy in" sub={isOwner ? 'Thêm máy in để tự động gửi bill và phiếu bếp.' : 'Nhờ chủ quán thêm máy in.'} />
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Hàng đợi in & lịch sử</h2>
          <span className="small muted">100 lệnh gần nhất · tự làm mới</span>
        </div>
        <div className="job-filters">
          <div className="tabs">
            {JOB_FILTERS.map((f) => (
              <button key={f.label} className={`tab${statusFilter === f.value ? ' active' : ''}`} onClick={() => setStatusFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
          <select aria-label="Lọc theo máy in" value={printerFilter} onChange={(e) => setPrinterFilter(e.target.value)}>
            <option value="">Tất cả máy in</option>
            {(printers.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {jobs.loading ? (
          <Loading />
        ) : jobs.error ? (
          <div className="alert-strip">{jobs.error}</div>
        ) : jobList.length === 0 ? (
          <Empty title="Không có lệnh in" sub={statusFilter || printerFilter ? 'Thử bỏ bộ lọc.' : 'Lệnh in xuất hiện khi có đơn mới, bill hoặc in thử.'} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Loại</th>
                  <th>Máy in</th>
                  <th>Đơn</th>
                  <th>Trạng thái</th>
                  <th className="num">Lần thử</th>
                  <th>Thời gian</th>
                  <th>Lỗi</th>
                  <th className="num"></th>
                </tr>
              </thead>
              <tbody>
                {jobList.map((j) => {
                  const js = JOB_STATUS[j.status] ?? { label: j.status, cls: 'grey' };
                  const errText = j.lastError ?? j.failedReason;
                  return (
                    <tr key={j.id}>
                      <td>{JOB_TYPE[j.jobType] ?? j.jobType}</td>
                      <td>{j.printer?.name ?? <span className="muted">—</span>}</td>
                      <td>{j.order ? `#${j.order.orderNumber}` : <span className="muted">—</span>}</td>
                      <td>
                        <Badge cls={js.cls}>{js.label}</Badge>
                        {j.status === 'FAILED' && j.acknowledgedAt && <small>Đã xác nhận</small>}
                        {j.status === 'PENDING' && j.nextAttemptAt && new Date(j.nextAttemptAt).getTime() > Date.now() && <small>Thử lại lúc {new Date(j.nextAttemptAt).toLocaleTimeString('vi-VN')}</small>}
                      </td>
                      <td className="num">
                        {j.attemptCount}
                        {j.maxAttempts ? `/${j.maxAttempts}` : ''}
                      </td>
                      <td className="muted">{fmtDateTime(j.createdAt)}</td>
                      <td className="job-err">
                        {errText ?? ''}
                        {j.errorCode && <small>{j.errorCode}</small>}
                      </td>
                      <td>
                        <div className="job-actions">
                          {j.content && (
                            <button className="button tiny" onClick={() => setViewJob(j)}>
                              Xem
                            </button>
                          )}
                          {(j.status === 'FAILED' || j.status === 'CANCELLED') && (
                            <button className="button tiny primary" disabled={!!rowBusy} onClick={() => jobAction(j, 'retry')}>
                              Thử lại
                            </button>
                          )}
                          {j.status === 'FAILED' && !j.acknowledgedAt && (
                            <button className="button tiny" disabled={!!rowBusy} title="Đã báo bếp bằng miệng, tắt cảnh báo" onClick={() => jobAction(j, 'acknowledge')}>
                              Đã báo miệng
                            </button>
                          )}
                          {j.status === 'PENDING' && canManage && (
                            <button className="button tiny danger" disabled={!!rowBusy} onClick={() => setConfirm({ kind: 'cancel', job: j })}>
                              Huỷ
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal && <PrinterFormModal initial={modal.printer} agents={agentList} onClose={() => setModal(null)} onSaved={refreshAll} />}

      {agentModal && (
        <Modal
          title="Thêm Print Agent"
          subtitle="Mỗi máy tính quầy chạy một agent"
          onClose={() => setAgentModal(false)}
          width={460}
          footer={
            <>
              <button className="button" onClick={() => setAgentModal(false)}>
                Huỷ
              </button>
              <button className="button primary" disabled={agentBusy || !agentName.trim()} onClick={createAgent}>
                {agentBusy ? 'Đang tạo...' : 'Tạo và nhận token'}
              </button>
            </>
          }
        >
          <Field label="Tên agent" required hint="Gợi nhớ máy tính cài agent">
            <input value={agentName} maxLength={100} onChange={(e) => setAgentName(e.target.value)} autoFocus placeholder="vd: PC quầy" onKeyDown={(e) => e.key === 'Enter' && createAgent()} />
          </Field>
          {agentErr && <div className="form-error">{agentErr}</div>}
        </Modal>
      )}

      {token && <TokenModal agentName={token.name} token={token.token} config={token.config} rotated={token.rotated} onClose={() => setToken(null)} />}

      {confirm?.kind === 'rotate' && confirm.agent && (
        <ConfirmModal
          title={`Cấp lại token cho “${confirm.agent.name}”`}
          message="Token cũ hết hiệu lực ngay: agent đang chạy sẽ mất kết nối cho tới khi bạn cập nhật tệp cấu hình mới trên máy tính quầy. Token mới chỉ hiện một lần."
          confirmLabel="Cấp token mới"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => rotate(confirm.agent!)}
        />
      )}
      {confirm?.kind === 'revoke' && confirm.agent && (
        <ConfirmModal
          title={`Thu hồi “${confirm.agent.name}”`}
          message="Agent này sẽ không còn kết nối được và không thể dùng lại (phải tạo agent mới). Lệnh đang giao cho agent được trả về hàng đợi."
          confirmLabel="Thu hồi"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => revoke(confirm.agent!)}
        />
      )}
      {confirm?.kind === 'cancel' && confirm.job && (
        <ConfirmModal
          title="Huỷ lệnh in"
          message={`Huỷ lệnh “${JOB_TYPE[confirm.job.jobType] ?? confirm.job.jobType}”${confirm.job.order ? ` của đơn #${confirm.job.order.orderNumber}` : ''}? Phiếu sẽ không được in.`}
          confirmLabel="Huỷ lệnh in"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => jobAction(confirm.job!, 'cancel')}
        />
      )}
      {viewJob && (
        <Modal title={JOB_TYPE[viewJob.jobType] ?? viewJob.jobType} subtitle={`${viewJob.printer?.name ?? ''} · ${fmtDateTime(viewJob.createdAt)}`} onClose={() => setViewJob(null)} width={560}>
          <div className="job-content">{viewJob.content}</div>
          <p className="small muted" style={{ marginTop: 8 }}>
            Bản xem trước dạng chữ không dấu; phiếu thật do agent dựng theo kiểu in của máy.
          </p>
        </Modal>
      )}
    </>
  );
}
