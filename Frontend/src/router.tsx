import type { ComponentType } from "react";
import { createBrowserRouter } from "react-router-dom";
import { routeTransitionLoader } from "./lib/routeTransitionLoader";
import { RootLayout } from "./RootLayout";

/** Lazy route module + loader so every navigation enters `loading` and UI can paint. */
function lazyPage(importer: () => Promise<{ default: ComponentType<object> }>) {
  return () =>
    importer().then((m) => ({
      Component: m.default,
      loader: routeTransitionLoader,
    }));
}

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <RootLayout />,
      children: [
        {
          index: true,
          lazy: lazyPage(() => import("./pages/Landing")),
        },
        {
          path: "app",
          lazy: lazyPage(() => import("./pages/AppView")),
        },
        {
          path: "patterns",
          lazy: lazyPage(() => import("./pages/Patterns")),
        },
        {
          path: "overview",
          lazy: lazyPage(() => import("./pages/Overview")),
        },
        {
          path: "*",
          lazy: lazyPage(() => import("./pages/NotFound")),
        },
      ],
    },
  ],
  {
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    },
  },
);
