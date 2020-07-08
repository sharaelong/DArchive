const process = require('process');
const puppeteer = require('puppeteer');

// nodejs module
const path = require('path');
const fs = require('fs/promises');
const fileSystem = require('fs');
const readline = require('readline');

const DEBUG = !!process.env.DEBUG;
const targetEventTypes = ['click'];

const targetURL = 'https://github.com';
let dir = './archive/' + new URL(targetURL).hostname + new URL(targetURL).pathname;

async function archive() {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'map.txt'), '');
    
    const browser = await puppeteer.launch({
        headless: !DEBUG,
        args: [
            '--disable-web-security'
        ]
    });
    const [page] = await browser.pages();
    await page.setRequestInterception(true);

    page.on('request', request => {
        if (!new URL(request.url()).host.includes("github")) {
            request.abort();
        } else {
            request.continue();
        }
    });
    
    page.on('response', async (response) => {
        //console.log("url:", response.url());
        const status = response.status();
        const resourceType = response.request().resourceType();
        // console.log("Type:", resourceType);
        // console.log("Request headers:", await response.request().headers());
        // console.log("Headers:", await response.headers());
        
        if (!(status >= 200 && status < 300)) {
            console.log('Redirect from', response.url(), 'to', response.headers()['location']);
        } else {
            const fileName = response.url().split('/').pop();
            const filePath = path.join(dir, fileName);
            try {
                const buffer = await response.buffer();
                if (fileName) {
                    await fs.writeFile(filePath.substring(0, 255), buffer);
                    await fs.appendFile(path.join(dir, 'map.txt'), await response.request().url() + " " + await fileName + "\n");
                } else {
                    await fs.writeFile(path.join(filePath.substring(0, 255), 'darchive-entry'), buffer);
                    await fs.appendFile(path.join(dir, 'map.txt'), await response.request().url() + " " + "darchive-entry" + "\n");
                    console.log("entered!");
                }
            } catch (error) {
                console.error(error);
                // console.error('This error originated from ', response);
            }
        }
    });
    
    await page.goto(targetURL, { waitUntil: 'networkidle2' });
    const client = await page.target().createCDPSession();

    // get all eventListeners defined by targetEvent
    const {
        root: {
            nodeId: documentNodeId
        }
    } = await client.send('DOM.getDocument');
    const {
        nodeIds
    } = await client.send('DOM.querySelectorAll', {
        nodeId: documentNodeId,
        selector: '*'
    });
    let eventListeners = (await Promise.all(
        nodeIds.map(nodeId => {
            client.send('DOM.setAttributeValue', { nodeId: nodeId, name: "darchive", value: nodeId.toString() });
            let promise = client.send('DOM.resolveNode', { nodeId }).catch(error => console.error("Error on resolveNode:", error));
            promise = promise.then(({ object: { objectId } }) => {
                let eventListenersPromise = client.send('DOMDebugger.getEventListeners', { objectId });
                return eventListenersPromise;
            }).then(({ listeners }) => {
                let boxModel = client.send('DOM.getBoxModel', { nodeId });
                boxModel = boxModel.then(({ model }) => {
                    let size = model.width * model.height;
                    return ({ nodeId, listeners, size });
                }).catch(error => {});
                return boxModel;
            });
            return promise;
        })
    )) // objectId: Runtime.RemoteObjectId, nodeId: DOM.NodeId
        .filter(eventEl => eventEl)
        .filter(eventEl => eventEl.listeners.some(({ type }) => targetEventTypes.includes(type)));

    const nodeList = (await Promise.all(
        eventListeners.map(eventEl => {
            let node = client.send('DOM.describeNode', { nodeId: eventEl.nodeId });
            return node;
        })
    ));

    // dispatch event prototype
    if (nodeList.length) {
        let temp = nodeList[2].node.attributes;
        console.log(temp);
        for (let i = 0; 2 * i < temp.length; i++) {
            if (temp[2 * i] === 'darchive') {
                let nodeKey = temp[2 * i + 1];
                await page.evaluate(nodeKey => {
                    document.querySelector(`[darchive="${nodeKey}"]`).dispatchEvent(new Event('click'));
                }, nodeKey);
            }
        }
    }
    
    setTimeout(async () => {
        await browser.close();
    }, 1500);
    
}

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
        // console.log("request:", request);
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

    await page.goto(targetURL, { waitUntil: 'domcontentloaded' });
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

// archive();
replay();

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

// test();
