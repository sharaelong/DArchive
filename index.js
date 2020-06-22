const process = require('process');
const puppeteer = require('puppeteer');

// nodejs module
const path = require('path');
const fs = require('fs/promises');

const DEBUG = !!process.env.DEBUG;
const targetEventTypes = ['click'];

const targetURL = 'https://github.com';
let dir = './archive/' + new URL(targetURL).hostname + new URL(targetURL).pathname;

(async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'map.txt'), '');
    
    const browser = await puppeteer.launch({ headless: !DEBUG });
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
        console.log("url:", response.url());
        const status = response.status();
        console.log("status:", status);
        
        if (!(status >= 200 && status < 300)) {
            console.log('Redirect from', response.url(), 'to', response.headers()['location']);
        } else {
            const fileName = response.url().split('/').pop();
            const filePath = path.join(dir, fileName);
            try {
                const buffer = await response.buffer();    
                if (fileName) {
                    await fs.writeFile(filePath, buffer);
                    await fs.appendFile(path.join(dir, 'map.txt'), await response.request().url() + " " + await fileName + "\n");
                }
            } catch (error) {
                console.error(error);
                console.error('This error originated from ', response);
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
    const eventListeners = (await Promise.all(
        nodeIds.map(nodeId => {
            let promise = client.send('DOM.resolveNode', { nodeId }).catch(err => {});
            promise = promise.then(({ object: { objectId } }) => {
                let eventListenersPromise = client.send('DOMDebugger.getEventListeners', { objectId });
                return eventListenersPromise;
            }).then(({ listeners }) => {
                let boxModel = client.send('DOM.getBoxModel', { nodeId });
                boxModel = boxModel.then(({ model }) => {
                    let size = model.width * model.height;
                    return ({ nodeId, listeners, size });
                }).catch(err => {});
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
    let temp = nodeList[2].node.attributes;
    console.log(temp);
    for (let i = 0; 2 * i < temp.length; i++) {
        console.log("??");
        if (temp[2 * i] === 'class') {
            let classKey = temp[2 * i + 1].trim().split(" ");
            console.log(classKey);
            await page.evaluate(classKey => {
                console.log("Waiting...");
                document.querySelector(`.${classKey[0]}`).dispatchEvent(new Event('click'));
                console.log("Dispatched!");
            }, classKey);
        }
    }

    setTimeout(async () => {
        await browser.close();
    }, 1500);
})();
