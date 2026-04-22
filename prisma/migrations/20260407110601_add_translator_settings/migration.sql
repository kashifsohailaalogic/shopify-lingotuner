-- CreateTable
CREATE TABLE "TranslatorSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiBaseUrl" TEXT NOT NULL,
    "translationEngine" TEXT NOT NULL DEFAULT 'Google',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TranslatorSettings_shop_key" ON "TranslatorSettings"("shop");
