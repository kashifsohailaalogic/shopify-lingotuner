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

  await prisma.$executeRaw`
    INSERT INTO TranslationLog (
      shop, level, contentType, action, message, requestUid, itemId, statusCode, requestBody, responseBody, metadata, createdAt
    )
    VALUES (
      ${input.shop},
      ${input.level},
      ${input.contentType ?? "others"},
      ${input.action},
      ${input.message},
      ${input.requestUid ?? null},
      ${input.itemId ?? null},
      ${input.statusCode ?? null},
      ${input.requestBody ?? null},
      ${input.responseBody ?? null},
      ${metadata},
      CURRENT_TIMESTAMP
    )
  `;
}
