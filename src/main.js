import { CheerioCrawler, Dataset } from 'crawlee';
import { Actor, log } from 'apify';
import { HeaderGenerator } from 'header-generator';

// Initialize header generator with latest browsers for stealth
const headerGenerator = new HeaderGenerator({
    browsers: [
        { name: 'chrome', minVersion: 120, maxVersion: 130 },
        { name: 'firefox', minVersion: 115, maxVersion: 125 }
    ],
    devices: ['desktop'],
    operatingSystems: ['windows', 'macos'],
    locales: ['en-US'],
});

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

    // TrueCar uses path-based URLs: /make/model/ not query params
    let baseUrl = 'https://www.truecar.com/used-cars-for-sale/listings/';

    // Add make and model as path segments
    if (make && model) {
        baseUrl += `${make.toLowerCase()}/${model.toLowerCase()}/`;
    } else if (make) {
        baseUrl += `${make.toLowerCase()}/`;
    }

    // Add filters as query parameters
    const u = new URL(baseUrl);
    if (year_min) u.searchParams.set('yearMin', year_min);
    if (year_max) u.searchParams.set('yearMax', year_max);
    if (zip) u.searchParams.set('zip', zip);

    return u.href;
};

const initialUrl = buildUrl();

// Create proxy configuration
const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfig || {
    useApifyProxy: true,
    apifyProxyGroups: ['RESIDENTIAL'],
});

let savedCount = 0;
const seenVins = new Set();

const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxRequestRetries: 5,
    useSessionPool: true,
    sessionPoolOptions: {
        maxPoolSize: 50,
        sessionOptions: {
            maxUsageCount: 10,
            maxErrorScore: 3,
        },
    },
    maxConcurrency: 3, // Lower for better stealth and residential proxy stability

    preNavigationHooks: [
        async ({ request }) => {
            // Generate complete realistic headers with client hints
            const headers = headerGenerator.getHeaders({
                operatingSystems: ['windows'],
                browsers: ['chrome'],
                devices: ['desktop'],
                locales: ['en-US'],
            });

            // Add complete client hint headers for modern browsers
            request.headers = {
                ...headers,
                'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-ch-ua-platform-version': '"15.0.0"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'none',
                'sec-fetch-user': '?1',
                'upgrade-insecure-requests': '1',
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'accept-language': 'en-US,en;q=0.9',
                'accept-encoding': 'gzip, deflate, br',
                'cache-control': 'max-age=0',
            };

            // Human-like delay with jitter (reading time simulation)
            const delay = Math.random() * 2000 + 1000;  // 1-3 seconds
            await new Promise(r => setTimeout(r, delay));
        },
    ],

    async requestHandler({ $, request, body, session }) {
        log.info(`Processing: ${request.url}`);

        let listings = [];

        // PRIORITY 1: Extract from __NEXT_DATA__ (fastest method)
        const nextDataScript = $('script#__NEXT_DATA__').text();
        if (nextDataScript) {
            try {
                const json = JSON.parse(nextDataScript);
                const apolloState = json.props?.pageProps?.__APOLLO_STATE__;

                if (apolloState) {
                    log.debug(`Apollo State has ${Object.keys(apolloState).length} keys`);

                    // Extract all ConsumerSummaryListing objects
                    const listingObjects = Object.values(apolloState).filter(obj =>
                        obj?.__typename === 'ConsumerSummaryListing'
                    );

                    log.debug(`Found ${listingObjects.length} ConsumerSummaryListing objects`);

                    listings = listingObjects.map(l => {
                        const vehicle = l.vehicle || {};
                        const pricing = l.pricing || {};
                        const location = l.location || {};
                        const vin = vehicle.vin || l.vin; // VIN is inside vehicle object

                        return {
                            listing_id: l.id,
                            vin: vin,
                            year: vehicle.year,
                            make: vehicle.make?.name,
                            model: vehicle.model?.name,
                            trim: vehicle.style?.trimName || vehicle.trim?.name,
                            style: vehicle.style?.name,
                            price: pricing.listPrice,
                            mileage: vehicle.mileage,
                            location: location.city && location.state ? `${location.city}, ${location.state}` : null,
                            exterior_color: vehicle.exteriorColor,
                            interior_color: vehicle.interiorColor,
                            fuel_type: vehicle.fuelType,
                            transmission: vehicle.transmission,
                            engine: vehicle.engine,
                            condition: vehicle.condition,
                            url: vin ? `https://www.truecar.com/used-cars-for-sale/listing/${vin}/` : null,
                        };
                    }).filter(l => l.vin); // Only keep listings with VIN

                    log.info(`✅ Extracted ${listings.length} listings from __NEXT_DATA__`);
                } else {
                    log.warning('No __APOLLO_STATE__ found in __NEXT_DATA__');
                }
            } catch (e) {
                log.error(`Failed to parse __NEXT_DATA__: ${e.message}`);
                log.debug(`Error stack: ${e.stack}`);
            }
        } else {
            log.warning('No __NEXT_DATA__ script tag found');
        }

        // Check for blocking
        const title = $('title').text();
        if (title.includes('Access Denied') || title.includes('Captcha') || title.includes('Robot')) {
            log.error('🚫 BLOCKED! Page title suggests anti-bot detection.');
            await Actor.setValue(`blocked-page-${Date.now()}`, $.html(), { contentType: 'text/html' });
        }

        // Save debug info if no data found
        if (listings.length === 0) {
            log.warning('⚠️ No listings extracted. Saving debug HTML...');
            await Actor.setValue(`debug-page-${Date.now()}`, $.html(), { contentType: 'text/html' });

            // Log response info
            log.info(`Response length: ${body?.length || $.html().length} bytes`);
            log.info(`Page title: ${title}`);
        }

        // Deduplicate and save data
        const uniqueListings = listings.filter(l => {
            const id = l.vin || l.listing_id || l.url;
            if (!id || seenVins.has(id)) return false;
            seenVins.add(id);
            return true;
        });

        const remaining = results_wanted - savedCount;
        const toSave = uniqueListings.slice(0, Math.max(0, remaining));

        if (toSave.length > 0) {
            await Dataset.pushData(toSave);
            savedCount += toSave.length;
            log.info(`💾 Saved ${toSave.length} listings. Progress: ${savedCount}/${results_wanted}`);
        }

        // Pagination - only if we need more results
        if (savedCount < results_wanted) {
            // Try to find next page link
            const nextLink = $('a[data-test="pagination-next"]').attr('href') ||
                $('a[aria-label*="Next"]').attr('href') ||
                $('a.pagination-next').attr('href');

            if (nextLink) {
                const nextUrl = nextLink.startsWith('http') ? nextLink : `https://www.truecar.com${nextLink}`;
                log.info(`➡️ Navigating to next page: ${nextUrl}`);
                await crawler.addRequests([{ url: nextUrl }]);
            } else {
                // Construct URL fallback
                const currentUrl = new URL(request.url);
                const currentPage = parseInt(currentUrl.searchParams.get('page') || '1');
                if (currentPage < max_pages) {
                    currentUrl.searchParams.set('page', (currentPage + 1).toString());
                    log.info(`➡️ Constructing next page URL: ${currentUrl.href}`);
                    await crawler.addRequests([{ url: currentUrl.href }]);
                } else {
                    log.info('✋ Reached max_pages limit or no more pages available.');
                }
            }
        } else {
            log.info('✅ Reached desired results_wanted count.');
        }
    },

    failedRequestHandler({ request }, error) {
        log.error(`❌ Request ${request.url} failed: ${error.message}`);
    },
});

await crawler.run([{ url: initialUrl }]);
log.info('🎉 Scraper finished successfully!');
await Actor.exit();
