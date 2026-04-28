import { useEffect, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

type LogRow = {
  id: number;
  level: string;
  contentType: string;
  action: string;
  message: string;
  requestUid: string | null;
  itemId: string | null;
  statusCode: number | null;
  requestBody: string | null;
  responseBody: string | null;
  metadata: string | null;
  createdAt: string;
};
type LogDbRow = Omit<LogRow, "createdAt"> & { createdAt: Date };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const level = url.searchParams.get("level") ?? "";
  const action = (url.searchParams.get("action") ?? "").trim();
  const contentType = (url.searchParams.get("contentType") ?? "").trim();

  const rows = await prisma.translationLog.findMany({
    where: {
      shop: session.shop,
      ...(level ? { level: { equals: level, mode: "insensitive" } } : {}),
      ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
      ...(contentType ? { contentType: { equals: contentType, mode: "insensitive" } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 300,
    select: {
      id: true,
      level: true,
      contentType: true,
      action: true,
      message: true,
      requestUid: true,
      itemId: true,
      statusCode: true,
      requestBody: true,
      responseBody: true,
      metadata: true,
      createdAt: true,
    },
  });
  const logs: LogRow[] = rows.map((row: LogDbRow) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));

  return { logs, filters: { level, action, contentType } };
};

export default function LogsPage() {
  const { logs, filters } = useLoaderData<typeof loader>();
  const [logsPage, setLogsPage] = useState(1);
  const logsPerPage = 15;

  const totalLogPages = Math.max(1, Math.ceil(logs.length / logsPerPage));
  const paginatedLogs = useMemo(() => {
    const start = (logsPage - 1) * logsPerPage;
    return logs.slice(start, start + logsPerPage);
  }, [logs, logsPage]);

  useEffect(() => {
    setLogsPage(1);
  }, [logs]);

  useEffect(() => {
    if (logsPage > totalLogPages) {
      setLogsPage(totalLogPages);
    }
  }, [logsPage, totalLogPages]);

  const levelBadgeStyle = (level: string) => {
    const lower = level.toLowerCase();
    if (lower === "success") return { background: "#16a34a", color: "#fff" };
    if (lower === "error") return { background: "#dc2626", color: "#fff" };
    return { background: "#6b7280", color: "#fff" };
  };

  return (
    <s-page heading="Lingotuner Logs" inlineSize="large">
      <s-section heading="Translation Activity Log">
        <Form method="GET">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "12px",
              flexWrap: "wrap",
            }}
          >
            <label>
              Level{" "}
              <select
                name="level"
                defaultValue={filters.level}
                style={{ minWidth: "110px", padding: "6px" }}
              >
                <option value="">All</option>
                <option value="success">Success</option>
                <option value="error">Error</option>
                <option value="info">Info</option>
              </select>
            </label>
            <label>
              Action{" "}
              <input
                name="action"
                type="text"
                defaultValue={filters.action}
                style={{ minWidth: "180px", padding: "6px" }}
              />
            </label>
            <label>
              Type{" "}
              <select
                name="contentType"
                defaultValue={filters.contentType}
                style={{ minWidth: "140px", padding: "6px" }}
              >
                <option value="">All</option>
                <option value="product">Product</option>
                <option value="category">Category</option>
                <option value="categories">Categories</option>
                <option value="attribute">Attribute</option>
                <option value="attribute_value">Attribute Value</option>
                <option value="others">Others</option>
              </select>
            </label>
            <s-button type="submit">Filter</s-button>
          </div>
        </Form>

        {logs.length === 0 ? (
          <s-paragraph>No logs yet.</s-paragraph>
        ) : (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "1000px" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "8px" }}>Date</th>
                    <th style={{ textAlign: "left", padding: "8px" }}>Level</th>
                    <th style={{ textAlign: "left", padding: "8px" }}>Type</th>
                    <th style={{ textAlign: "left", padding: "8px" }}>Action</th>
                    <th style={{ textAlign: "left", padding: "8px" }}>Message</th>
                    <th style={{ textAlign: "left", padding: "8px" }}>Request ID</th>
                    <th style={{ textAlign: "left", padding: "8px" }}>Request / Response</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedLogs.map((log) => (
                    <tr key={log.id}>
                      <td style={{ padding: "8px" }}>{new Date(log.createdAt).toLocaleString()}</td>
                      <td style={{ padding: "8px" }}>
                        <span
                          style={{
                            ...levelBadgeStyle(log.level),
                            borderRadius: "14px",
                            padding: "2px 9px",
                            fontSize: "12px",
                            textTransform: "capitalize",
                            display: "inline-block",
                          }}
                        >
                          {log.level}
                        </span>
                      </td>
                      <td style={{ padding: "8px", textTransform: "capitalize" }}>
                        {log.contentType || "others"}
                      </td>
                      <td style={{ padding: "8px" }}>{log.action}</td>
                      <td style={{ padding: "8px" }}>{log.message}</td>
                      <td style={{ padding: "8px" }}>{log.requestUid || "-"}</td>
                      <td style={{ padding: "8px" }}>
                        {log.requestBody || log.responseBody || log.metadata ? (
                          <details>
                            <summary>View</summary>
                            {log.itemId || log.statusCode ? (
                              <pre style={{ whiteSpace: "pre-wrap", maxWidth: "340px" }}>
                                <strong>Meta Fields</strong>
                                {"\n"}
                                Item ID: {log.itemId || "-"}
                                {"\n"}
                                Status: {log.statusCode ?? "-"}
                              </pre>
                            ) : null}
                            {log.requestBody ? (
                              <pre style={{ whiteSpace: "pre-wrap", maxWidth: "340px" }}>
                                <strong>Request</strong>
                                {"\n"}
                                {log.requestBody}
                              </pre>
                            ) : null}
                            {log.responseBody ? (
                              <pre style={{ whiteSpace: "pre-wrap", maxWidth: "340px" }}>
                                <strong>Response</strong>
                                {"\n"}
                                {log.responseBody}
                              </pre>
                            ) : null}
                            {log.metadata ? (
                              <pre style={{ whiteSpace: "pre-wrap", maxWidth: "340px" }}>
                                <strong>Meta</strong>
                                {"\n"}
                                {log.metadata}
                              </pre>
                            ) : null}
                          </details>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {logs.length ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "12px",
                  gap: "12px",
                }}
              >
                <div style={{ color: "#6b7280", fontSize: "13px" }}>
                  Showing {(logsPage - 1) * logsPerPage + 1}-{Math.min(logsPage * logsPerPage, logs.length)} of{" "}
                  {logs.length}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <s-button
                    variant="secondary"
                    disabled={logsPage === 1}
                    onClick={() => setLogsPage((page) => Math.max(1, page - 1))}
                  >
                    Previous
                  </s-button>
                  <span style={{ minWidth: "88px", textAlign: "center", fontSize: "13px" }}>
                    Page {logsPage} / {totalLogPages}
                  </span>
                  <s-button
                    variant="secondary"
                    disabled={logsPage === totalLogPages}
                    onClick={() => setLogsPage((page) => Math.min(totalLogPages, page + 1))}
                  >
                    Next
                  </s-button>
                </div>
              </div>
            ) : null}
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}
