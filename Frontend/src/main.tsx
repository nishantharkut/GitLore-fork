import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { RepoProvider } from "./context/RepoContext";
import { ThemeProvider } from "./context/ThemeContext";
import { router } from "./router";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <ThemeProvider>
      <RepoProvider>
        <RouterProvider router={router} />
      </RepoProvider>
    </ThemeProvider>
  </AuthProvider>,
);
