const process = require('process');
const puppeteer = require('puppeteer');

//env variables
const DEBUG = !!process.env.DEBUG;

if (!process.env.URL) {
    console.error("Any target url isn't setted. Please check URL env is exist.");
}
const targetURL = new URL(process.env.URL);
let dir = './archive/' + targetURL.hostname + targetURL.pathname;

async function test() {
    const browser = await puppeteer.launch({ headless: !DEBUG });
    const [page] = await browser.pages();
    page.setRequestInterception(true);
    page.on('request', req => {
        req.respond({
            status: 404,
        });
    });
    await page.goto('https://www.google.com/');
    setTimeout(async () => {
        await browser.close();
    }, 5000);
}

test();
