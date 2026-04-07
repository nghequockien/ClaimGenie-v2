import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import "./index.css";
import "./i18n";

const savedTheme = localStorage.getItem("ui-theme");
const initialTheme =
  savedTheme === "mint-default" ||
  savedTheme === "cherry-blossom" ||
  savedTheme === "chocolate-truffle"
    ? savedTheme
    : "mint-default";
document.documentElement.setAttribute("data-theme", initialTheme);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            borderRadius: "10px",
            fontSize: "13px",
          },
        }}
      />
    </QueryClientProvider>
  </React.StrictMode>,
);
