import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useFetchers, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const fetchers = useFetchers();

  const isPageBusy =
    navigation.state !== "idle" || fetchers.some((fetcher) => fetcher.state !== "idle");

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app/dashboard">Home</s-link>
        <s-link href="/app">Settings</s-link>
        <s-link href="/app/logs">Logs</s-link>
      </s-app-nav>
      <Outlet />
      {isPageBusy ? (
        <div
          aria-live="polite"
          aria-label="Loading"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(255, 255, 255, 0.72)",
            backdropFilter: "blur(1px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "#111827",
              color: "#ffffff",
              borderRadius: "8px",
              padding: "10px 14px",
              fontSize: "14px",
              fontWeight: 600,
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
            }}
          >
            Processing...
          </div>
        </div>
      ) : null}
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
