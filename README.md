# Truecar Used Car Scraper

Extract comprehensive data from Truecar.com with ease. Collect used car listings including VIN, pricing, mileage, and technical specifications at scale. Perfect for market research, price monitoring, and automotive data analysis.

---

## Features

- **High-Performance Extraction** — Collects data with maximum speed and minimum resource usage.
- **Advanced Filtering** — Narrow results by car make, model, year range, and ZIP code.
- **Direct Link Support** — Paste any Truecar search result URL to start scraping immediately.
- **Detailed Vehicle Data** — Get complete information including VIN, trim, colors, and fuel types.
- **Automated Pagination** — Seamlessly navigates through multiple pages of results.
- **Built-in Deduplication** — Automatically filters duplicate listings based on unique identifiers.

---

## Use Cases

### Price Monitoring
Track the market value of specific car models over time. Identify the best times to buy or sell based on historical pricing trends from thousands of listings.

### Inventory Analysis
Analyze the availability and distribution of vehicle makes and models across different geographical locations using ZIP code filtering.

### Competitor Research
Monitor listing strategy and inventory levels of dealerships. Understand market gaps and emerging trends in the used car sector.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | — | Direct URL to a Truecar search results page |
| `make` | String | No | `"toyota"` | Vehicle manufacturer (e.g., Ford, Honda) |
| `model` | String | No | `"camry"` | Specific vehicle model name |
| `year_min` | Integer | No | — | Minimum production year filter |
| `year_max` | Integer | No | — | Maximum production year filter |
| `zip` | String | No | — | Location filter using ZIP code |
| `results_wanted` | Integer | No | `20` | Maximum number of listings to collect |
| `max_pages` | Integer | No | `10` | Maximum number of result pages to crawl |

---

## Output Data

Each item in the dataset contains:

| Field | Type | Description |
|-------|------|-------------|
| `listing_id` | String | Unique Truecar listing identifier |
| `vin` | String | Vehicle Identification Number |
| `year` | Number | Production year of the vehicle |
| `make` | String | Vehicle manufacturer name |
| `model` | String | Vehicle model name |
| `trim` | String | Specific trim or edition |
| `price` | Number | Current listed price in USD |
| `mileage` | Number | Total distance traveled |
| `location` | String | City and state of the listing |
| `exterior_color` | String | Outside paint color |
| `interior_color` | String | Inside cabin color |
| `fuel_type` | String | Engine fuel type (Gas, Electric, etc.) |
| `transmission` | String | Gearbox type (Automatic, Manual) |
| `url` | String | Direct link to the listing page |

---

## Usage Examples

### Search by Car Specifications

Extract specific Honda Civics within a year range:

```json
{
    "make": "honda",
    "model": "civic",
    "year_min": 2018,
    "year_max": 2022,
    "results_wanted": 50
}
```

### Scraping a Specific Location

Collect listings for a specific ZIP code:

```json
{
    "make": "ford",
    "zip": "90210",
    "results_wanted": 25
}
```

### Direct URL Extraction

Collect items from a pre-configured Truecar search:

```json
{
    "startUrl": "https://www.truecar.com/used-cars-for-sale/listings/tesla/model-3/",
    "results_wanted": 100
}
```

---

## Sample Output

```json
{
  "listing_id": "Q29uc3VtZXJTdW1tYXJ5TGlzdGluZy0xRzFaRDVTVDNSRjEwNzQ4Mg==",
  "vin": "1G1ZD5ST3RF107482",
  "year": 2024,
  "make": "Chevrolet",
  "model": "Malibu",
  "trim": "LS",
  "price": 12395,
  "mileage": 62844,
  "location": "Dallas, TX",
  "exterior_color": "Summit White",
  "interior_color": "Jet Black",
  "fuel_type": "Gas",
  "transmission": "Automatic",
  "url": "https://www.truecar.com/used-cars-for-sale/listing/chevrolet/malibu/1G1ZD5ST3RF107482/"
}
```

---

## Tips for Best Results

### Optimize for Reliability
- **Use Residential Proxies** — For the highest success rates, use Apify's residential proxy groups.
- **Start Small** — Run a test with fewer `results_wanted` (e.g., 20) to verify your settings.

### Precise Car Matching
- **Slug Format** — Ensure `make` and `model` are lowercase (e.g., `mercedes-benz` instead of `Mercedes Benz`).
- **ZIP Accuracy** — Use a valid 5-digit ZIP code for accurate location-based results.

---

## Integrations

Connect your data with:

- **Google Sheets** — Export for real-time analysis
- **Airtable** — Build searchable vehicle databases
- **Slack** — Get alerts for new price drops
- **Zapier** — Trigger automated marketing flows

### Export Formats

Download your vehicle data in:
- **JSON** — For developers and system integration
- **CSV** — For spreadsheet monitoring and reporting
- **Excel** — For deep data analysis
- **XML** — For legacy system compatibility

---

## Frequently Asked Questions

### How fast is the data collection?
The scraper is optimized for speed, extracting data directly from the website's structured data layer, enabling high-volume collection in minutes.

### Can I scrape new cars too?
This specific tool is optimized for used car listings. For new vehicle data, please check our other automotive scrapers.

### Are there any limits on search volume?
You can collect as many listings as Truecar displays for your search query. The `results_wanted` parameter helps you manage your data budget.

### Does it handle price drops?
Yes, by running the scraper on a schedule, you can monitor changes in the `price` field to detect discounts and price trends.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Automating Scrapers](https://docs.apify.com/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with website terms of service and applicable laws.