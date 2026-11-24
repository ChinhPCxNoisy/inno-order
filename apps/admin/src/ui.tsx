import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

// ================= Icon =================

const PATHS: Record<string, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  pos: <path d="M3 4h18v12H3zm5 16h8m-4-4v4M6 8h6m-6 4h4" />,
  kitchen: <path d="M6 10a4 4 0 0 1 0-8 6 6 0 0 1 12 0 4 4 0 0 1 0 8v11H6zM6 16h12" />,
  serve: <path d="M2 17h20M5 17a7 7 0 0 1 14 0M12 6V4M4 21h16" />,
  order: <path d="M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6m-6 4h6m-6 4h3" />,
  receipt: (
    <>
      <path d="M5 3v18l2-1.5L9 21l1.5-1.5L12 21l1.5-1.5L15 21l2-1.5L19 21V3l-2 1.5L15 3l-1.5 1.5L12 3l-1.5 1.5L9 3 7 4.5 5 3z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  table: (
    <>
      <rect x="4" y="5" width="16" height="12" rx="2" />
      <path d="M7 17v4m10-4v4M4 11h16" />
    </>
  ),
  book: (
    <path d="M3 3h7a3 3 0 0 1 3 3v15a4 4 0 0 0-4-2H3zm18 0h-5a3 3 0 0 0-3 3M21 3v16h-4a4 4 0 0 0-4 2" />
  ),
  users: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-3c0-6 12-6 12 0v3M17 4a3 3 0 0 1 0 6m1 4c3 1 3 3 3 7" />
    </>
  ),
  chart: <path d="M3 3v18h18M7 16l4-6 4 3 6-9" />,
  printer: <path d="M7 7V2h10v5M7 16H3V7h18v9h-4M7 13h10v9H7zM17 10h1" />,
  store: (
    <path d="M3 8l3-5h12l3 5v4a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0V8zm2 7v7h14v-7M10 22v-6h4v6" />
  ),
  building: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 21v-4h6v4M8 7h2M14 7h2M8 11h2M14 11h2" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  check: <path d="m4 12 5 5L20 6" />,
  focus: <path d="M3 9V3h6m6 0h6v6m0 6v6h-6M9 21H3v-6" />,
  refresh: (
    <path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 4M4 15l2 4a8 8 0 0 0 13-3" />
  ),
  edit: <path d="m15 3 6 6-12 12H3v-6zM12 6l6 6" />,
  trash: (
    <>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
      <path d="M10 10v6M14 10v6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v1" />
    </>
  ),
  money: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M5 12h1m12 0h1" />
    </>
  ),
  download: <path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12L20 3M16 7l3 3" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9a2.8 2.8 0 1 1 4.4 2.3c-.9.6-1.6 1.1-1.6 2.2" />
      <path d="M12 17h.01" />
    </>
  ),
  qrcode: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 18h3v3" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name] ?? PATHS.grid}
    </svg>
  );
}

// ================= Badge =================

export function Badge({ cls, children }: { cls: string; children: ReactNode }) {
  return <span className={`badge ${cls}`}>{children}</span>;
}

// ================= Modal =================

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  width,
  wide,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  wide?: boolean;
  footer?: ReactNode;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal${wide ? ' wide' : ''}`}
        style={width ? { maxWidth: width } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="close" onClick={onClose} aria-label="Đóng">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ================= Form field =================

export function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required && <em> *</em>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

// ================= Loading / Empty =================

export function Loading() {
  return (
    <div className="center-box">
      <div className="spinner" />
      <span>Đang tải...</span>
    </div>
  );
}

export function Empty({ title = 'Chưa có dữ liệu', sub }: { title?: string; sub?: string }) {
  return (
    <div className="empty">
      <Icon name="check" size={32} />
      <h3>{title}</h3>
      {sub && <p>{sub}</p>}
    </div>
  );
}

// ================= Toast =================

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  msg: string;
  kind: 'ok' | 'err' | 'info';
  action?: ToastAction;
  action2?: ToastAction;
}

export type PushToast = (
  msg: string,
  kind?: 'ok' | 'err' | 'info',
  opts?: { action?: ToastAction; action2?: ToastAction; ttl?: number },
) => void;

const ToastContext = createContext<PushToast>(() => undefined);

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<PushToast>(
    (msg, kind = 'ok', opts) => {
      const id = ++toastId;
      const ttl = opts?.ttl ?? (opts?.action ? 8000 : 3500);
      setItems((prev) => [...prev, { id, msg, kind, action: opts?.action, action2: opts?.action2 }]);
      setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'ok' ? '' : t.kind}`}>
            <span>{t.msg}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  const act = t.action!;
                  dismiss(t.id);
                  act.onClick();
                }}
              >
                {t.action.label}
              </button>
            )}
            {t.action2 && (
              <button
                className="toast-action"
                onClick={() => {
                  const act = t.action2!;
                  dismiss(t.id);
                  act.onClick();
                }}
              >
                {t.action2.label}
              </button>
            )}
            {(t.action || t.action2) && (
              <button className="toast-action" aria-label="Đóng thông báo" onClick={() => dismiss(t.id)} style={{ padding: '6px 8px' }}>
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// ================= Confirm =================

/** Hop thoai xac nhan cho thao tac nhay cam (thu hoi token, gop ban, huy lenh in...). Khoa nut khi dang xu ly. */
export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Xác nhận',
  danger,
  onConfirm,
  onClose,
}: {
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={busy ? () => undefined : onClose}
      width={460}
      footer={
        <>
          <button className="button" disabled={busy} onClick={onClose}>
            Huỷ bỏ
          </button>
          <button
            className={`button ${danger ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Đang xử lý...' : confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13, lineHeight: 1.7 }}>{message}</div>
    </Modal>
  );
}
