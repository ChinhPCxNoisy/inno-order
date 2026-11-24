import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './context';
import { Loading, ToastProvider } from './ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Stores from './pages/Stores';
import Pos from './pages/Pos';
import Kitchen from './pages/Kitchen';
import Orders from './pages/Orders';
import Service from './pages/Service';
import Tables from './pages/Tables';
import MenuPage from './pages/Menu';
import Users from './pages/Users';
import Reports from './pages/Reports';
import Printers from './pages/Printers';
import Payments from './pages/Payments';
import Offers from './pages/Offers';
import { roleHome } from './labels';

/** Trang chu: vai tro khong co Tong quan (phuc vu, bep) chuyen thang sang man hinh cua minh */
function HomeRoute() {
  const { me } = useApp();
  if (me && (me.role === 'WAITER' || me.role === 'KITCHEN')) return <Navigate to={roleHome(me.role)} replace />;
  return <Dashboard />;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { me, booting } = useApp();
  if (booting) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function StoreRequired({ children }: { children: React.ReactNode }) {
  const { activeStore } = useApp();
  if (!activeStore) {
    return (
      <div className="center-box" style={{ padding: 60 }}>
        <p>Vui lòng chọn một quán ở thanh trên để tiếp tục.</p>
      </div>
    );
  }
  if (activeStore.status === 'SUSPENDED') {
    return (
      <div className="center-box" style={{ padding: 60 }}>
        <p>Quán đang bị tạm khóa, không thể thao tác. Vui lòng liên hệ Super Admin.</p>
      </div>
    );
  }
  return <>{children}</>;
}

function Shell() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<HomeRoute />} />
        <Route path="stores" element={<Stores />} />
        <Route
          path="pos"
          element={
            <StoreRequired>
              <Pos />
            </StoreRequired>
          }
        />
        <Route
          path="kitchen"
          element={
            <StoreRequired>
              <Kitchen />
            </StoreRequired>
          }
        />
        <Route
          path="orders"
          element={
            <StoreRequired>
              <Orders />
            </StoreRequired>
          }
        />
        <Route
          path="service"
          element={
            <StoreRequired>
              <Service />
            </StoreRequired>
          }
        />
        <Route
          path="tables"
          element={
            <StoreRequired>
              <Tables />
            </StoreRequired>
          }
        />
        <Route
          path="menu"
          element={
            <StoreRequired>
              <MenuPage />
            </StoreRequired>
          }
        />
        <Route
          path="users"
          element={
            <StoreRequired>
              <Users />
            </StoreRequired>
          }
        />
        <Route
          path="reports"
          element={
            <StoreRequired>
              <Reports />
            </StoreRequired>
          }
        />
        <Route
          path="printers"
          element={
            <StoreRequired>
              <Printers />
            </StoreRequired>
          }
        />
        <Route
          path="payments"
          element={
            <StoreRequired>
              <Payments />
            </StoreRequired>
          }
        />
        <Route
          path="offers"
          element={
            <StoreRequired>
              <Offers />
            </StoreRequired>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppProvider>
          <Shell />
        </AppProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
