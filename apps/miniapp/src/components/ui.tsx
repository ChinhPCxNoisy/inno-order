import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export interface DialogAction {
  label: string;
  onClick?: () => void;
  /** Nut phu (vien xam) — mac dinh la nut chinh (do) */
  neutral?: boolean;
}

interface UiCtx {
  toast: (text: string) => void;
  /** Hop thoai nho giua man hinh. Khong co actions thi tu them nut "Da hieu". */
  message: (title: string, text: string, actions?: DialogAction[]) => void;
}

const Ctx = createContext<UiCtx | null>(null);

interface DialogState {
  title: string;
  text: string;
  actions: DialogAction[];
}

/** Toast + hop thoai thong bao dung chung cho cac man hinh (thiet ke v2). */
export function UiProvider({ children }: { children: React.ReactNode }) {
  const [toastText, setToastText] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const ref = useRef<HTMLDialogElement>(null);

  const toast = useCallback((text: string) => {
    setToastText(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastText(null), 3300);
  }, []);

  const message = useCallback((title: string, text: string, actions?: DialogAction[]) => {
    setDialog({ title, text, actions: actions ?? [{ label: 'Đã hiểu' }] });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (dialog && el && !el.open) el.showModal();
  }, [dialog]);

  const close = () => {
    ref.current?.close();
    setDialog(null);
  };

  const value = useMemo(() => ({ toast, message }), [toast, message]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastText && (
        <div className="toast" role="status">
          {toastText}
        </div>
      )}
      <dialog ref={ref} className="mini-dialog" onClose={() => setDialog(null)}>
        {dialog && (
          <>
            <h2>{dialog.title}</h2>
            <p className="muted small mt16">{dialog.text}</p>
            {dialog.actions.map((a) => (
              <button
                key={a.label}
                className={`btn${a.neutral ? ' neutral' : ''}`}
                onClick={() => {
                  close();
                  a.onClick?.();
                }}
              >
                {a.label}
              </button>
            ))}
          </>
        )}
      </dialog>
    </Ctx.Provider>
  );
}

export function useUi(): UiCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useUi phai duoc dung trong UiProvider');
  return ctx;
}

/** Cac dong chu ngan cach bang <br> (tieu de/doan gioi thieu ngat dong nhu mau) */
export function Lines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {l}
        </span>
      ))}
    </>
  );
}
