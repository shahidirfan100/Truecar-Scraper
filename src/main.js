import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { HeaderGenerator } from 'header-generator';

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
    proxyConfiguration,
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
const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

const headerGenerator = new HeaderGenerator({
    browsers: [{ name: 'chrome', minVersion: 120 }],
    devices: ['desktop'],
    operatingSystems: ['windows'],
});

let savedCount = 0;
const seenVins = new Set();

const crawler = new CheerioCrawler({
    proxyConfiguration: proxyConf,
    maxConcurrency: 5,
    maxRequestRetries: 3,
    useSessionPool: true,

    async requestHandler({ $, request, enqueueLinks, body }) {
        const pageNo = request.userData?.pageNo || 1;
        log.info(`Processing ${request.url} (Page ${pageNo})`);

        let listings = [];

        // PRIORITY 1: Extract from __NEXT_DATA__
        const scriptContent = $('script#__NEXT_DATA__').text();
        if (scriptContent) {
            try {
                const nextData = JSON.parse(scriptContent);
                const apolloState = nextData.props?.pageProps?.__APOLLO_STATE__;

                if (apolloState) {
                    listings = Object.values(apolloState).filter(obj =>
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

                    if (listings.length > 0) {
                        log.info(`Extracted ${listings.length} listings from __NEXT_DATA__`);
                    }
                }
            } catch (err) {
                log.error(`Failed to parse __NEXT_DATA__: ${err.message}`);
            }
        }

        // PRIORITY 2: Fallback to HTML parsing if NEXT_DATA fails or is empty
        if (listings.length === 0) {
            log.warning('No data found in __NEXT_DATA__, attempting HTML fallback...');
            listings = $('[data-test="cardContent"]').map((_, el) => {
                const $el = $(el);
                return {
                    year: parseInt($el.find('[data-test="vehicleCardYear"]').text()) || null,
                    make: $el.find('[data-test="vehicleCardMake"]').text().trim() || null,
                    model: $el.find('[data-test="vehicleCardModel"]').text().trim() || null,
                    price: parseInt($el.find('[data-test="vehicleCardPrice"]').text().replace(/[^0-9]/g, '')) || null,
                    mileage: parseInt($el.find('[data-test="vehicleCardMileage"]').text().replace(/[^0-9]/g, '')) || null,
                    url: $el.find('a[data-test="vehicleCardLink"]').attr('href') ?
                        new URL($el.find('a[data-test="vehicleCardLink"]').attr('href'), 'https://www.truecar.com').href : null,
                    _source: 'html_fallback'
                };
            }).get().filter(l => l.make && l.model);

            if (listings.length > 0) {
                log.info(`Extracted ${listings.length} listings from HTML`);
            }
        }

        if (listings.length === 0) {
            log.warning('No data extracted! Saving debug HTML...');
            await Actor.setValue(`debug_page_pg${pageNo}`, body || $.html(), { contentType: 'text/html' });
        }

        // Deduplicate and push data
        const uniqueListings = listings.filter(l => {
            if (l.vin && seenVins.has(l.vin)) return false;
            if (l.vin) seenVins.add(l.vin);
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
        if (savedCount < results_wanted && pageNo < max_pages) {
            // Find next page from UI if possible, else construct URL
            const nextButton = $('a[data-test="pagination-next"]');
            let nextUrl;

            if (nextButton.attr('href')) {
                nextUrl = new URL(nextButton.attr('href'), 'https://www.truecar.com').href;
            } else {
                const u = new URL(request.url);
                u.searchParams.set('page', (pageNo + 1).toString());
                nextUrl = u.href;
            }

            await enqueueLinks({
                urls: [nextUrl],
                userData: { pageNo: pageNo + 1 }
            });
        }
    },

    preNavigationHooks: [
        async ({ request }) => {
            const headers = headerGenerator.getHeaders();
            request.headers = {
                ...headers,
                'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'none',
                'sec-fetch-user': '?1',
                'upgrade-insecure-requests': '1',
            };
        }
    ]
});

await crawler.run([{ url: initialUrl, userData: { pageNo: 1 } }]);
log.info('Scraper finished.');
await Actor.exit();
