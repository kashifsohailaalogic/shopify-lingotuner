import prisma from "../db.server";

type Level = "success" | "error" | "info";

export async function insertTranslationLog(input: {
  shop: string;
  level: Level;
  contentType?: "product" | "categories" | "attributes" | "configuration" | "others";
  action: string;
  message: string;
  requestUid?: string | null;
  itemId?: string | null;
  statusCode?: number | null;
  requestBody?: string | null;
  responseBody?: string | null;
  metadata?: unknown;
}) {
  const metadata =
    input.metadata === undefined ? null : JSON.stringify(input.metadata);

  await prisma.translationLog.create({
    data: {
      shop: input.shop,
      level: input.level,
      contentType: input.contentType ?? "others",
      action: input.action,
      message: input.message,
      requestUid: input.requestUid ?? null,
      itemId: input.itemId ?? null,
      statusCode: input.statusCode ?? null,
      requestBody: input.requestBody ?? null,
      responseBody: input.responseBody ?? null,
      metadata,
    },
  });
}
