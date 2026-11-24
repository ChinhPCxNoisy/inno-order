// ZaUI stylesheet
import "zmp-ui/zaui.css";
// Giao dien InnoOrder (chuyen tu apps/zalo-mini-app, khong dung Tailwind)
import "@/css/app.scss";

// React core
import React from "react";
import { createRoot } from "react-dom/client";

// Mount the app
import Layout from "@/components/layout";

// Expose app configuration
import appConfig from "../app-config.json";

if (!window.APP_CONFIG) {
  window.APP_CONFIG = appConfig as any;
}

const root = createRoot(document.getElementById("app")!);
root.render(React.createElement(Layout));
