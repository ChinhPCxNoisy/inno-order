import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useApp } from '../context';
import { errMsg } from '../api';
import { roleHome } from '../labels';

// chi co o che do dev: ban build production bi bo nhanh nay (DEV = false) nen khong nhung mat khau
const DEMO_ACCOUNTS: { label: string; email: string; pass: string }[] = import.meta.env.DEV
  ? [
      { label: 'Quản trị nền tảng', email: 'admin@innoorder.com', pass: 'Admin123!' },
      { label: 'Chủ quán Lẩu Nướng Phố Cổ', email: 'owner@bunbohuong.com', pass: 'Owner123!' },
    ]
  : [];

export default function Login() {
  const { login, me, booting } = useApp();
  const navigate = useNavigate();
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!booting && me) return <Navigate to={roleHome(me.role)} replace />;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!loginValue || !password) {
      setErr('Vui lòng nhập đầy đủ thông tin');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const role = await login(loginValue, password);
      navigate(roleHome(role), { replace: true });
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  };

  const quick = (email: string, pass: string) => {
    setLoginValue(email);
    setPassword(pass);
    setErr(null);
    setBusy(true);
    login(email, pass)
      .then((role) => navigate(roleHome(role), { replace: true }))
      .catch((ex) => {
        setErr(errMsg(ex));
        setBusy(false);
      });
  };

  return (
    <div className="login-wrap">
      <section className="login-card">
        <a className="brand" href="/">
          <img className="brand-mark" src="/brand-mark.png" alt="" />
          <div>
            <strong>InnoOrder</strong>
            <small>RESTAURANT WORKSPACE</small>
          </div>
        </a>
        <span className="eyebrow">ĐĂNG NHẬP VẬN HÀNH</span>
        <h1>Chào mừng trở lại.</h1>
        <p>Đăng nhập để vào không gian làm việc của bộ phận bạn.</p>
        <form className="login-form" onSubmit={submit}>
          <label className="field">
            <span>Email hoặc số điện thoại</span>
            <input
              value={loginValue}
              onChange={(e) => {
                setLoginValue(e.target.value);
                setErr(null);
              }}
              placeholder="vd: admin@innoorder.com"
              autoFocus
              autoComplete="username"
            />
          </label>
          <label className="field">
            <span>Mật khẩu</span>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErr(null);
              }}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </label>
          {err && (
            <p className="login-err" role="alert">
              {err}
            </p>
          )}
          <button className="button primary full" type="submit" disabled={busy}>
            {busy ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>
        {import.meta.env.DEV && DEMO_ACCOUNTS.length > 0 && (
          <>
            <div className="login-divider">
              <span>TÀI KHOẢN DEMO · CHỈ HIỆN Ở CHẾ ĐỘ DEV</span>
            </div>
            <div className="demo-accounts">
              {DEMO_ACCOUNTS.map((a) => (
                <button key={a.email} type="button" className="demo-account" onClick={() => quick(a.email, a.pass)}>
                  <span>
                    <b>{a.label}</b>
                    <small>{a.email}</small>
                  </span>
                  <span className="login-go">→</span>
                </button>
              ))}
            </div>
            <div className="notice">Dữ liệu demo được tạo bởi seed hệ thống, chỉ dùng cho môi trường phát triển.</div>
          </>
        )}
      </section>
    </div>
  );
}
