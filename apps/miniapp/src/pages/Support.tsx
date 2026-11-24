import { useState } from 'react';
import { useParams } from 'react-router-dom';
import Icon, { type IconName } from '../components/Icon';
import Shell, { PageTitle, useTable } from '../components/Shell';
import ErrorState from '../components/StateView';
import { useUi } from '../components/ui';
import { errMsg, publicApi, type CallReason } from '../api';

const OPTIONS: { reason: CallReason; icon: IconName; label: string }[] = [
  { reason: 'CALL_STAFF', icon: 'bell', label: 'Gọi nhân viên' },
  { reason: 'WATER', icon: 'cup', label: 'Xin thêm nước' },
  { reason: 'TOOLS', icon: 'menu', label: 'Xin khăn / dụng cụ' },
  { reason: 'BILL', icon: 'wallet', label: 'Yêu cầu tính tiền' },
];

/** Ho tro tai ban (thiet ke v2, man 14): gui yeu cau that den man hinh Phuc vu cua quan. */
export default function Support() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const { table, q } = useTable();
  const { message } = useUi();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<CallReason | null>(null);

  if (!table) {
    return (
      <Shell>
        <ErrorState kind="qr" />
      </Shell>
    );
  }

  const send = async (opt: (typeof OPTIONS)[number]) => {
    if (!storeSlug || busy) return;
    setBusy(opt.reason);
    try {
      await publicApi.callStaff(storeSlug, table, { reason: opt.reason, note: note.trim() || undefined });
      message(
        'Đã gửi yêu cầu',
        `Nhân viên đã nhận yêu cầu “${opt.label}” của bàn ${table} và sẽ đến ngay.`,
      );
      setNote('');
    } catch (e) {
      message('Chưa gửi được yêu cầu', `${errMsg(e)} Bạn có thể vẫy nhân viên để được hỗ trợ.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Shell title="Yêu cầu hỗ trợ">
      <PageTitle to={`/s/${storeSlug}${q}`}>Hỗ trợ tại bàn</PageTitle>

      <div className="cart-table">
        <Icon name="table" size="lg" />
        <div>
          <strong>Bạn đang ở bàn {table}</strong>
          <div className="small muted">Chọn điều bạn cần, quán sẽ hỗ trợ.</div>
        </div>
      </div>

      <h1 style={{ fontSize: 25 }}>
        Chúng tôi có thể
        <br />
        giúp gì cho bạn?
      </h1>
      <p className="muted small mb16">Nhân viên sẽ nhận được thông báo ngay tại quầy.</p>

      <div className="help-grid">
        {OPTIONS.map((o) => (
          <button key={o.reason} className="help-option" disabled={busy !== null} onClick={() => send(o)}>
            <Icon name={o.icon} />
            {busy === o.reason ? 'Đang gửi…' : o.label}
          </button>
        ))}
      </div>

      <div className="card mt24">
        <label className="label" htmlFor="help-note">
          Ghi chú thêm <span className="tiny muted">(không bắt buộc)</span>
        </label>
        <textarea
          id="help-note"
          value={note}
          maxLength={300}
          placeholder="Ví dụ: bàn cần thêm 2 bát nhỏ..."
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <p className="tiny muted center">Yêu cầu hỗ trợ không làm thay đổi đơn món đã gửi.</p>
    </Shell>
  );
}
