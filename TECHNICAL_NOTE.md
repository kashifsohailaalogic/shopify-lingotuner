LINGOTUNER TRANSLATION APP - SIMPLE TECHNICAL NOTE

What We Are Building
We are building a Shopify translation app where each store can save its own translator settings.  
Once settings are saved, the app will use the same saved configuration to fetch languages and send product translation requests.

Why This Approach
This keeps the flow clean and reliable:
- Settings are saved once.
- The same settings are reused everywhere.
- Each shop only sees and uses its own data.

Where Configuration Is Saved
Configuration is saved in the `TranslatorSettings` model in `prisma/schema.prisma`.  
There will be one settings record per Shopify shop.

Main fields:
- `shop` (unique shop identifier)
- `apiKey`
- `apiBaseUrl`
- `translationEngine`
- `fetchedLanguages` (cached languages response)
- `enabled`
- `createdAt`, `updatedAt`

How the App Flow Works
1. Merchant opens settings screen and saves API data.
2. Backend validates data and saves it in DB (insert/update by shop).
3. Merchant clicks "Fetch languages".
4. Backend calls language API and stores the response in DB.
5. Merchant goes to product translation page.
6. App reads saved config from DB and sends translation request.

Route Responsibilities
- `app/routes/app._index.tsx`
  - save settings
  - fetch and cache languages
- `app/routes/app.products.tsx`
  - read saved settings
  - send product translation request

Security and Validation
- DB access is backend-only.
- All data is shop-scoped through authenticated requests.
- API key is masked in UI.
- Input validation is required before DB save and API call.
- Recommended for production: encrypt API key at rest.

Done Criteria
This work is complete when:
1. Settings save correctly for each shop.
2. Saved settings load correctly after refresh.
3. Languages are fetched and cached successfully.
4. Product translation uses DB-stored settings.
5. Error handling works for invalid setup or API failure.

