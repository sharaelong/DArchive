const process = require('process');
const puppeteer = require('puppeteer');

// nodejs module
const path = require('path');
const fs = require('fs/promises');
const fileSystem = require('fs');
const readline = require('readline');

// env variables
const DEBUG = !!process.env.DEBUG;

if (!process.env.URL) {
    console.error("Any target url isn't setted. Please check URL env is exist.");
}
const targetURL = new URL(process.env.URL);
let dir = '../archive/' + targetURL.hostname + targetURL.pathname;

async function replay() {
    const browser = await puppeteer.launch({
        headless: !DEBUG,
        args: [
            '--disable-web-security'
        ]
    });
    const [page] = await browser.pages();
    page.setRequestInterception(true);

    let urlResourceMap = await readMapFile();
    
    page.on('request', async (request) => {
        const resourceURL = await request.url().split('/').pop();
        
        let bodyData;
        if (!resourceURL) {
            if (await fileSystem.existsSync(path.join(dir, 'darchive-entry'))) {
                bodyData = await fs.readFile(path.join(dir, 'darchive-entry'));
                console.log(bodyData);
            } else {
                console.error("No entry point! Please check your archive.");
            }
        } else {
            if (Object.values(urlResourceMap).indexOf(await request.url().split('/').pop()) > -1) {
                bodyData = await fs.readFile(path.join(dir, resourceURL));
                console.log("url:", await request.url().split('/').pop());
            } else {
                bodyData = null;
            }
        }
        
        if (bodyData) {
            const newHeader = Object.assign({}, await request, {
                date: new Date().toUTCString(),
                'content-length': bodyData.length
            });
            request.respond({
                status: 200,
                headers: newHeader,
                body: bodyData
            });
        } else {
            request.respond({
                status: 404
            });
        }
    });

    await page.goto(targetURL.href, { waitUntil: 'domcontentloaded' });
}

function readMapFile() {
    let urlResourceMap = {};
    let readStream = fileSystem.createReadStream(path.join(dir, 'map.txt'));
    let reader = readline.createInterface(readStream, process.stdout);

    let promise = new Promise((resolve, reject) => {
        reader.on('line', line => {
            let token = line.split(' ');
            urlResourceMap[token[0]] = token[1];
        });

        reader.on('close', () => {
            resolve(urlResourceMap);
        });
    });
    
    return promise;
}

replay();
