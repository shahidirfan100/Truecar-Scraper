import { PlaywrightCrawler, Dataset } from 'crawlee';
import { Actor, log } from 'apify';

await Actor.init();

const input = (await Actor.getInput()) || {};
const {
    startUrl,
    make = 'chevrolet',
    model = 'malibu',
    year_min,
    year_max,
    zip,
    results_wanted = 20,
    max_pages = 10,
    proxyConfiguration: proxyConfig,
} = input;

// Build initial URL if not provided
const buildUrl = () => {
    if (startUrl) return startUrl;
    const baseUrl = 'https://www.truecar.com/used-cars-for-sale/listings/';
    const u = new URL(baseUrl);
    if (make) u.searchParams.set('makeSlug', make.toLowerCase());
    if (model) u.searchParams.set('modelSlug', model.toLowerCase());
    if (year_min) u.searchParams.set('yearMin', year_min);
    if (year_max) u.searchParams.set('yearMax', year_max);
    if (zip) u.searchParams.set('zip', zip);
    return u.href;
};

const initialUrl = buildUrl();

// Create proxy configuration (residential recommended for protected sites)
const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfig || {
    useApifyProxy: true,
    apifyProxyGroups: ['RESIDENTIAL'],
});

let savedCount = 0;
const seenVins = new Set();

const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxRequestRetries: 5,
    useSessionPool: true,
    sessionPoolOptions: {
        maxPoolSize: 5,
        sessionOptions: { maxUsageCount: 3 },
    },
    maxConcurrency: 2,
    requestHandlerTimeoutSecs: 180,
    navigationTimeoutSecs: 90,

    // Fingerprint generation for stealth
    browserPoolOptions: {
        useFingerprints: true,
        fingerprintOptions: {
            fingerprintGeneratorOptions: {
                browsers: ['chrome'],
                operatingSystems: ['windows', 'macos'],
                devices: ['desktop'],
            },
        },
    },

    // Pre-navigation hooks for resource blocking and stealth
    preNavigationHooks: [
        async ({ page }) => {
            // Block heavy resources
            await page.route('**/*', (route) => {
                const type = route.request().resourceType();
                const url = route.request().url();

                if (['image', 'font', 'media'].includes(type) ||
                    url.includes('google-analytics') ||
                    url.includes('googletagmanager') ||
                    url.includes('facebook') ||
                    url.includes('doubleclick')) {
                    return route.abort();
                }
                return route.continue();
            });

            // Stealth: Hide webdriver property
            await page.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
            });
        },
    ],

    async requestHandler({ page, request, crawler: crawlerInstance }) {
        log.info(`Processing: ${request.url}`);

        // Wait for page to fully load
        try {
            await page.waitForLoadState('domcontentloaded');
            // Give it a bit more time for hydration
            await page.waitForTimeout(2000);
        } catch (e) {
            log.warning(`Wait failed: ${e.message}`);
        }

        let listings = [];

        // PRIORITY 1: Extract from __NEXT_DATA__
        try {
            listings = await page.evaluate(() => {
                const script = document.querySelector('script#__NEXT_DATA__');
                if (!script) return [];

                try {
                    const json = JSON.parse(script.textContent);
                    const apolloState = json.props?.pageProps?.__APOLLO_STATE__;

                    if (!apolloState) return [];

                    return Object.values(apolloState).filter(obj =>
                        obj?.__typename === 'ConsumerSummaryListing' && obj.vin
                    ).map(l => {
                        const vehicle = l.vehicle || {};
                        const pricing = l.pricing || {};
                        const location = l.location || {};

                        return {
                            listing_id: l.id,
                            vin: l.vin,
                            year: vehicle.year,
                            make: vehicle.make?.name,
                            model: vehicle.model?.name,
                            trim: vehicle.trim?.name,
                            price: pricing.listPrice,
                            mileage: vehicle.mileage,
                            location: location.city && location.state ? `${location.city}, ${location.state}` : null,
                            exterior_color: vehicle.exteriorColor,
                            interior_color: vehicle.interiorColor,
                            fuel_type: vehicle.fuelType,
                            transmission: vehicle.transmission,
                            url: `https://www.truecar.com/used-cars-for-sale/listing/${vehicle.make?.slug}/${vehicle.model?.slug}/${l.vin}/`,
                            _source: 'next_data'
                        };
                    });
                } catch (e) {
                    return [];
                }
            });

            if (listings.length > 0) {
                log.info(`Extracted ${listings.length} listings from __NEXT_DATA__`);
            }
        } catch (e) {
            log.warning(`Failed to extract __NEXT_DATA__: ${e.message}`);
        }

        // PRIORITY 2: DOM Fallback
        if (listings.length === 0) {
            log.warning('No data found in __NEXT_DATA__, attempting DOM fallback...');

            // Wait for cards to appear
            try {
                await page.waitForSelector('[data-test="usedListing"], [data-test="vehicleCard"]', { timeout: 10000 });
            } catch (e) { }

            listings = await page.evaluate(() => {
                const items = [];
                // Look for cards
                const cards = document.querySelectorAll('[data-test="usedListing"], [data-test="vehicleCard"], .vehicle-card');

                cards.forEach(el => {
                    const getTxt = (sel) => el.querySelector(sel)?.innerText?.trim();
                    const getAttr = (sel, attr) => el.querySelector(sel)?.getAttribute(attr);

                    const yearEl = el.querySelector('[data-test="vehicleCardYear"]');
                    const makeEl = el.querySelector('[data-test="vehicleCardMake"]');
                    const modelEl = el.querySelector('[data-test="vehicleCardModel"]');
                    const priceEl = el.querySelector('[data-test="vehicleCardPrice"]');
                    const mileageEl = el.querySelector('[data-test="vehicleCardMileage"]');
                    const linkEl = el.querySelector('a[data-test="vehicleCardLink"]');

                    if (yearEl && makeEl && modelEl) {
                        items.push({
                            year: parseInt(yearEl.innerText) || null,
                            make: makeEl.innerText || null,
                            model: modelEl.innerText || null,
                            price: priceEl ? parseInt(priceEl.innerText.replace(/[^0-9]/g, '')) : null,
                            mileage: mileageEl ? parseInt(mileageEl.innerText.replace(/[^0-9]/g, '')) : null,
                            url: linkEl ? (linkEl.href.startsWith('http') ? linkEl.href : `https://www.truecar.com${linkEl.getAttribute('href')}`) : null,
                            _source: 'dom_fallback'
                        });
                    }
                });
                return items;
            });

            if (listings.length > 0) {
                log.info(`Extracted ${listings.length} listings from DOM`);
            }
        }

        if (listings.length === 0) {
            log.warning('No listings found. Saving screenshot/debug info...');
            await Actor.setValue(`debug-page-${Date.now()}`, await page.content(), { contentType: 'text/html' });
        }

        // Save data
        const uniqueListings = listings.filter(l => {
            if (l.vin && seenVins.has(l.vin)) return false;
            // Also dedupe by URL if VIN missing
            if (!l.vin && l.url && seenVins.has(l.url)) return false;

            const id = l.vin || l.url;
            if (id) seenVins.add(id);
            return true;
        });

        const remaining = results_wanted - savedCount;
        const toSave = uniqueListings.slice(0, Math.max(0, remaining));

        if (toSave.length > 0) {
            await Dataset.pushData(toSave);
            savedCount += toSave.length;
            log.info(`Saved ${toSave.length} listings. Progress: ${savedCount}/${results_wanted}`);
        }

        // Pagination
        if (savedCount < results_wanted) {
            const nextUrl = await page.evaluate(() => {
                const nextBtn = document.querySelector('a[data-test="pagination-next"]');
                return nextBtn ? nextBtn.href : null;
            });

            if (nextUrl) {
                log.info(`Navigating to next page: ${nextUrl}`);
                await crawlerInstance.addRequests([{ url: nextUrl }]);
            } else {
                // Construct URL fallback if next button logic fails or is hidden
                const currentUrl = new URL(request.url);
                const currentPage = parseInt(currentUrl.searchParams.get('page') || '1');
                if (currentPage < max_pages) {
                    currentUrl.searchParams.set('page', (currentPage + 1).toString());
                    log.info(`Constructing next page URL: ${currentUrl.href}`);
                    await crawlerInstance.addRequests([{ url: currentUrl.href }]);
                }
            }
        }
    },

    failedRequestHandler({ request }, error) {
        log.error(`Request ${request.url} failed: ${error.message}`);
    },
});

await crawler.run([{ url: initialUrl }]);
log.info('Scraper finished.');
await Actor.exit();
