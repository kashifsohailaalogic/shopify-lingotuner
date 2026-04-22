import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { insertTranslationLog } from "../lib/translation-log.server";

type LanguageOption = {
  code: string;
  name: string;
};

type EngineOption = {
  value: string;
  label: string;
};

const FALLBACK_ENGINES: EngineOption[] = [
  { value: "Microsoft", label: "Microsoft" },
  { value: "Google", label: "Google" },
  { value: "DeepL", label: "DeepL" },
  { value: "Agent", label: "Agent" },
];

type ActionData = {
  ok: boolean;
  intent: "save-settings" | "fetch-languages";
  message?: string;
  error?: string;
  settings?: {
    apiBaseUrl: string;
    translationEngine: string;
    enabled: boolean;
    hasApiKey: boolean;
    maskedApiKey: string;
    engines: EngineOption[];
    cachedLanguages: LanguageOption[];
  };
  languages?: LanguageOption[];
};

function maskApiKey(key: string) {
  if (!key) return "";
  if (key.length <= 8) return "*".repeat(key.length);
  return `${key.slice(0, 4)}${"*".repeat(key.length - 8)}${key.slice(-4)}`;
}

function normalizeBaseUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function toShopifyLanguagesUrl(baseUrl: string, engine?: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  const withSlash = normalized.endsWith("/") ? normalized : `${normalized}/`;
  const url = new URL("languages", withSlash);
  if (engine) {
    url.searchParams.set("engine", engine);
    url.searchParams.set("provider", engine);
    url.searchParams.set("translationEngine", engine);
    url.searchParams.set("engineProvider", engine);
  }
  return url.toString();
}

function parseLanguages(payload: unknown): LanguageOption[] {
  if (Array.isArray(payload)) {
    return payload
      .map((item) => {
        if (typeof item === "string") {
          return { code: item, name: item };
        }
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const code = String(obj.code ?? obj.languageCode ?? obj.value ?? "");
          const name = String(obj.name ?? obj.languageName ?? obj.label ?? code);
          if (!code) return null;
          return { code, name };
        }
        return null;
      })
      .filter((item): item is LanguageOption => Boolean(item));
  }

  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.languages)) return parseLanguages(obj.languages);
    if (Array.isArray(obj.data)) return parseLanguages(obj.data);
    if (Array.isArray(obj.items)) return parseLanguages(obj.items);
  }

  return [];
}

function parseEngines(payload: unknown): EngineOption[] {
  const set = new Set<string>();
  const addValue = (value: unknown) => {
    const text = String(value ?? "").trim();
    if (text) set.add(text);
  };

  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    const obj = value as Record<string, unknown>;

    addValue(obj.engine);
    addValue(obj.provider);
    addValue(obj.translationEngine);
    addValue(obj.engineProvider);

    if (Array.isArray(obj.engines)) obj.engines.forEach(addValue);
    if (Array.isArray(obj.providers)) obj.providers.forEach(addValue);

    Object.values(obj).forEach((child) => {
      if (typeof child === "object") walk(child);
    });
  };

  walk(payload);

  return Array.from(set).map((value) => ({
    value,
    label: value,
  }));
}

function mergeEngines(primary: EngineOption[], secondary: EngineOption[]) {
  const seen = new Set<string>();
  const merged: EngineOption[] = [];
  [...primary, ...secondary].forEach((item) => {
    const key = item.value.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(item);
  });
  return merged;
}

type TranslatorSettingsRow = {
  apiKey: string;
  apiBaseUrl: string;
  translationEngine: string;
  fetchedLanguages: string | null;
  enabled: boolean;
};

async function getSettingsByShop(shop: string): Promise<TranslatorSettingsRow | null> {
  const rows = await prisma.$queryRaw<TranslatorSettingsRow[]>`
    SELECT apiKey, apiBaseUrl, translationEngine, fetchedLanguages, enabled
    FROM TranslatorSettings
    WHERE shop = ${shop}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function upsertSettingsByShop(input: {
  shop: string;
  apiKey: string;
  apiBaseUrl: string;
  translationEngine: string;
  enabled: boolean;
}) {
  await prisma.$executeRaw`
    INSERT INTO TranslatorSettings (shop, apiKey, apiBaseUrl, translationEngine, enabled, createdAt, updatedAt)
    VALUES (${input.shop}, ${input.apiKey}, ${input.apiBaseUrl}, ${input.translationEngine}, ${input.enabled}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(shop) DO UPDATE SET
      apiKey = excluded.apiKey,
      apiBaseUrl = excluded.apiBaseUrl,
      translationEngine = excluded.translationEngine,
      enabled = excluded.enabled,
      updatedAt = CURRENT_TIMESTAMP
  `;
}

async function saveFetchedLanguagesByShop(shop: string, languages: LanguageOption[]) {
  await prisma.$executeRaw`
    UPDATE TranslatorSettings
    SET fetchedLanguages = ${JSON.stringify(languages)},
        updatedAt = CURRENT_TIMESTAMP
    WHERE shop = ${shop}
  `;
}

function parseCachedLanguages(payload: string | null | undefined): LanguageOption[] {
  if (!payload) return [];
  try {
    const parsed = JSON.parse(payload) as LanguageOption[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) => item && typeof item.code === "string" && typeof item.name === "string",
    );
  } catch {
    return [];
  }
}

async function fetchShopifyApiData(input: {
  apiBaseUrl: string;
  apiKey: string;
  engine?: string;
}) {
  const endpoint = toShopifyLanguagesUrl(input.apiBaseUrl, input.engine);
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": input.apiKey,
      "api-key": input.apiKey,
      Authorization: `Bearer ${input.apiKey}`,
    },
  });
  const body = (await response.json()) as unknown;
  return { response, body };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettingsByShop(session.shop);
  let engines: EngineOption[] = [];

  if (settings?.apiKey && settings.apiBaseUrl) {
    try {
      const { response, body } = await fetchShopifyApiData({
        apiBaseUrl: settings.apiBaseUrl,
        apiKey: settings.apiKey,
      });
      if (response.ok) {
        engines = parseEngines(body);
      }
    } catch {
      // Ignore API fetch errors in loader; form can still render.
    }
  }

  const selectedEngine = settings?.translationEngine ?? "";
  if (selectedEngine) {
    engines = mergeEngines([{ value: selectedEngine, label: selectedEngine }], engines);
  }
  engines = mergeEngines(engines, FALLBACK_ENGINES);

  const cachedLanguages = parseCachedLanguages(settings?.fetchedLanguages);

  return {
    settings: {
      apiBaseUrl:
        settings?.apiBaseUrl ??
        "https://app-globalize-api-dev-prod.azurewebsites.net/api/v1/service-translate/shopify",
      translationEngine: selectedEngine,
      enabled: settings?.enabled ?? true,
      hasApiKey: Boolean(settings?.apiKey),
      maskedApiKey: settings?.apiKey ? maskApiKey(settings.apiKey) : "",
      engines,
      cachedLanguages,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "save-settings") {
    const apiKeyInput = String(formData.get("apiKey") ?? "").trim();
    const apiBaseUrl = normalizeBaseUrl(String(formData.get("apiBaseUrl") ?? ""));
    const translationEngine = String(formData.get("translationEngine") ?? "").trim();
    const enabled = String(formData.get("enabled") ?? "on") === "on";

    const existing = await getSettingsByShop(session.shop);
    const apiKey = apiKeyInput || existing?.apiKey || "";

    if (!apiKey || !apiBaseUrl) {
      await insertTranslationLog({
        shop: session.shop,
        level: "error",
        contentType: "configuration",
        action: "save_settings",
        message: "API key and API base URL are required.",
      });
      return {
        ok: false,
        intent: "save-settings",
        error: "API key and API base URL are required.",
      } satisfies ActionData;
    }

    await upsertSettingsByShop({
      shop: session.shop,
      apiKey,
      apiBaseUrl,
      translationEngine,
      enabled,
    });
    await insertTranslationLog({
      shop: session.shop,
      level: "success",
      contentType: "configuration",
      action: "save_settings",
      message: "Translator settings saved.",
      metadata: { translationEngine, enabled, apiBaseUrl },
    });

    return {
      ok: true,
      intent: "save-settings",
      message: "Translator settings saved.",
      settings: {
        apiBaseUrl,
        translationEngine,
        enabled,
        hasApiKey: true,
        maskedApiKey: maskApiKey(apiKey),
        engines: [],
        cachedLanguages: parseCachedLanguages(existing?.fetchedLanguages),
      },
    } satisfies ActionData;
  }

  if (intent === "fetch-languages") {
    const settings = await getSettingsByShop(session.shop);
    const apiKeyInput = String(formData.get("apiKey") ?? "").trim();
    const apiBaseUrlInput = normalizeBaseUrl(String(formData.get("apiBaseUrl") ?? ""));
    const translationEngineInput = String(formData.get("translationEngine") ?? "").trim();

    const apiKey = apiKeyInput || settings?.apiKey || "";
    const apiBaseUrl = apiBaseUrlInput || settings?.apiBaseUrl || "";
    const selectedEngine = translationEngineInput || settings?.translationEngine || "";

    if (!apiKey || !apiBaseUrl) {
      await insertTranslationLog({
        shop: session.shop,
        level: "error",
        contentType: "configuration",
        action: "fetch_languages",
        message: "Provide API key and base URL (or save settings first).",
      });
      return {
        ok: false,
        intent: "fetch-languages",
        error: "Provide API key and base URL (or save settings first).",
      } satisfies ActionData;
    }

    try {
      const { response, body } = await fetchShopifyApiData({
        apiBaseUrl,
        apiKey,
        engine: selectedEngine || undefined,
      });
      const languages = parseLanguages(body);

      if (!response.ok) {
        await insertTranslationLog({
          shop: session.shop,
          level: "error",
          contentType: "configuration",
          action: "fetch_languages",
          message: `Language API failed with status ${response.status}.`,
          statusCode: response.status,
          requestBody: JSON.stringify({ engine: selectedEngine || null }),
          responseBody: JSON.stringify(body),
        });
        return {
          ok: false,
          intent: "fetch-languages",
          error: `Language API failed with status ${response.status}.`,
        } satisfies ActionData;
      }

      if (!languages.length) {
        await insertTranslationLog({
          shop: session.shop,
          level: "error",
          contentType: "configuration",
          action: "fetch_languages",
          message: "Languages fetched but no language list was found in response.",
          statusCode: response.status,
          requestBody: JSON.stringify({ engine: selectedEngine || null }),
          responseBody: JSON.stringify(body),
        });
        return {
          ok: false,
          intent: "fetch-languages",
          error: "Languages fetched but no language list was found in response.",
        } satisfies ActionData;
      }

      await saveFetchedLanguagesByShop(session.shop, languages);
      await insertTranslationLog({
        shop: session.shop,
        level: "success",
        contentType: "configuration",
        action: "fetch_languages",
        message: `Fetched ${languages.length} languages.`,
        statusCode: response.status,
        requestBody: JSON.stringify({ engine: selectedEngine || null }),
        responseBody: JSON.stringify(body),
      });

      return {
        ok: true,
        intent: "fetch-languages",
        message: `Fetched ${languages.length} languages.`,
        languages,
      } satisfies ActionData;
    } catch (error) {
      await insertTranslationLog({
        shop: session.shop,
        level: "error",
        contentType: "configuration",
        action: "fetch_languages",
        message: "Could not reach translation API. Please verify URL and API key.",
        metadata: { error: String(error) },
      });
      return {
        ok: false,
        intent: "fetch-languages",
        error: "Could not reach translation API. Please verify URL and API key.",
      } satisfies ActionData;
    }
  }

  return {
    ok: false,
    intent: "save-settings",
    error: "Unknown action.",
  } satisfies ActionData;
};

export default function Index() {
  const { settings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ActionData>();
  const [languages, setLanguages] = useState<LanguageOption[]>(settings.cachedLanguages ?? []);
  const formRef = useRef<HTMLFormElement | null>(null);

  const shopify = useAppBridge();
  const isSubmitting = ["loading", "submitting"].includes(fetcher.state);

  const fetchedLanguages = useMemo(() => languages, [languages]);

  useEffect(() => {
    setLanguages(settings.cachedLanguages ?? []);
  }, [settings.cachedLanguages]);

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message);
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
    if (fetcher.data?.intent === "fetch-languages" && fetcher.data?.languages) {
      setLanguages(fetcher.data.languages);
    }
  }, [
    fetcher.data?.error,
    fetcher.data?.intent,
    fetcher.data?.languages,
    fetcher.data?.message,
    shopify,
  ]);

  const submitWithIntent = (intent: "save-settings" | "fetch-languages") => {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    formData.set("intent", intent);
    fetcher.submit(formData, { method: "POST" });
  };

  return (
    <s-page heading="Lingotuner Translator Settings" inlineSize="large">
      <s-section heading="API Setup">
        <fetcher.Form method="POST" ref={formRef}>
          <s-stack direction="block" gap="base">
            <s-text-field
              label="API Key"
              name="apiKey"
              placeholder={settings?.maskedApiKey || "Enter API key"}
              required={!settings?.hasApiKey}
            />
            <s-text-field
              label="API Base URL"
              name="apiBaseUrl"
              defaultValue={settings?.apiBaseUrl}
              required
            />
            <label style={{ display: "grid", gap: "0.35rem", maxWidth: "420px" }}>
              <span>Translation Engine</span>
              <s-stack direction="inline" gap="base" alignItems="end">
                <select
                  name="translationEngine"
                  defaultValue={settings?.translationEngine || ""}
                  style={{ width: "220px", padding: "8px" }}
                >
                  <option value="">Select engine</option>
                  {settings.engines.map((engine) => (
                    <option key={engine.value} value={engine.value}>
                      {engine.label}
                    </option>
                  ))}
                </select>
                <s-button
                  onClick={() => submitWithIntent("fetch-languages")}
                  {...(isSubmitting ? { loading: true } : {})}
                >
                  Fetch languages
                </s-button>
              </s-stack>
            </label>
            <s-checkbox
              label="Translator enabled"
              name="enabled"
              checked={settings?.enabled ?? true}
            />
            <s-button
              onClick={() => submitWithIntent("save-settings")}
              {...(isSubmitting ? { loading: true } : {})}
            >
              Save settings
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading="Supported Languages">
        <s-paragraph>
          Save settings first, then click <s-text>Fetch languages</s-text> in the page header.
        </s-paragraph>
        {fetchedLanguages.length > 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-unordered-list>
              {fetchedLanguages.map((language) => (
                <s-list-item key={language.code}>
                  {language.name} ({language.code})
                </s-list-item>
              ))}
            </s-unordered-list>
          </s-box>
        ) : (
          <s-paragraph>No languages loaded yet.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
