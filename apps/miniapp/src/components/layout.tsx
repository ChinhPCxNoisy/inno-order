import { getSystemInfo } from "zmp-sdk";
import {
  App,
  Route,
  SnackbarProvider,
  ZMPRouter,
} from "zmp-ui";
import { AppProps } from "zmp-ui/app";
import { Navigate, Routes } from "react-router-dom";

import { CartProvider } from "@/cart";
import Home from "@/pages/Home";
import Menu from "@/pages/Menu";
import Cart from "@/pages/Cart";
import Orders from "@/pages/Orders";
import Tracking from "@/pages/Tracking";
import Review from "@/pages/Review";
import Sent from "@/pages/Sent";
import Support from "@/pages/Support";
import { UiProvider } from "@/components/ui";
import Voucher from "@/pages/Voucher";
import Profile from "@/pages/Profile";
import Bill from "@/pages/Bill";
import NoStoreRedirect from "@/components/NoStoreRedirect";
import OfferDetail from "@/pages/OfferDetail";

const Layout = () => {
  return (
    <App theme={getSystemInfo().zaloTheme as AppProps["theme"]}>
      <SnackbarProvider>
        <ZMPRouter>
          <UiProvider>
          <CartProvider>
            {/* Routes thuong (khong AnimationRoutes): hieu ung truot trang cua zmp-ui boc trang trong
                phan tu co transform nen thanh tab/dock position:fixed bi truot theo trang khi chuyen man */}
            <Routes>
              <Route path="/" element={<Home />} />
              {/* Luong QR (BRD 8.1): /s/{store_slug}/t/{table_code} -> man chao mung (xac nhan ban),
                  roi sang thuc don /s/{store_slug}?t={table_code} */}
              <Route path="/s/:storeSlug/t/:tableCode" element={<Home />} />
              <Route path="/s/:storeSlug/cart" element={<Cart />} />
              <Route path="/s/:storeSlug/orders" element={<Orders />} />
              <Route path="/s/:storeSlug/voucher" element={<Voucher />} />
              <Route path="/s/:storeSlug/profile" element={<Profile />} />
              <Route path="/s/:storeSlug/bill" element={<Bill />} />
              <Route path="/s/:storeSlug/offer/:offerId" element={<OfferDetail />} />
              <Route path="/s/:storeSlug" element={<Menu />} />
              <Route path="/s/:storeSlug/order/:orderId" element={<Tracking />} />
              <Route path="/s/:storeSlug/order/:orderId/review" element={<Review />} />
              <Route path="/s/:storeSlug/order/:orderId/sent" element={<Sent />} />
              <Route path="/s/:storeSlug/support" element={<Support />} />
              <Route path="*" element={<NoStoreRedirect />} />
            </Routes>
          </CartProvider>
          </UiProvider>
        </ZMPRouter>
      </SnackbarProvider>
    </App>
  );
};
export default Layout;
